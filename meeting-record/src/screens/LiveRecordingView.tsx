// LiveRecordingView — 即時字幕模式
// 每 N 秒 stop + 立即 restart 錄音，並把上一段送 Whisper 即時 append 到 transcript
// caveat: expo-audio 沒提供連續 streaming，stop/restart 之間會有 ~200-500ms 空檔

import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AudioModule, IOSOutputFormat, RecordingPresets, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { Directory, File, Paths } from 'expo-file-system';
import { LLMClient } from '../llm/client';
import { createMeeting } from '../storage/db';
import { loadSettings, Settings } from '../storage/settings';
import { concatWavs } from '../audio/voiceprintMix';
import { useDeviceLiveTranscription } from '../audio/useDeviceLiveTranscription';
import { Color, FontFamily, Radius } from '../theme/tokens';
import { RootStackParamList } from '../navigation/AppNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Live'>;
type Phase = 'idle' | 'recording' | 'finalizing' | 'done' | 'error';

const KEEP_AWAKE_TAG = 'meeting-record-live';
// 已知 Whisper 對靜默/噪音段會吐 YouTube credits / sign-off 樣式
const HALLUCINATION_PATTERNS: RegExp[] = [
  // Amara / 字幕組
  /字幕由\s*Amara\.org\s*(社[區区]|社[群群])\s*提供/gi,
  /(Untertitel|Subtítulos|Sous-titres|字幕)\s*[:：]?\s*Amara\.org[^\n。]*/gi,
  /Amara\.org[^\n。]{0,30}/gi,
  /字幕(志[願願愿]者|[組组])[:：]?[^\n。]{0,40}/g,
  /Subtitled?\s*by[^\n。]*/gi,
  /Subs\s*by[^\n。]*/gi,
  // YouTube sign-off
  /請不吝(地)?點(讚|贊)[^\n。]{0,40}/g,
  /(請)?(訂閱|轉發|打賞|點贊|點讚|按讚|分享)[^\n。]{0,30}/g,
  /(歡迎|感謝)(收看|觀看|訂閱|分享)[^\n。]{0,30}/g,
  /明鏡(與)?點點(欄目|频道|頻道)?[^\n。]*/g,
  /Thanks?\s*for\s*(watching|listening)[^\n。]*/gi,
  // Music / sound markers
  /[\(\[]?(輕快的|柔和的|背景|前奏|間奏)?(音樂|背景音樂|音效)(結束|播放|响起|響起)?[\)\]]?/g,
  /[\(\[]?(掌聲|笑聲|歡呼聲)[\)\]]?/g,
  // News intros / sign-offs（廣東話 / 國語）
  /MBC\s*뉴스[^\n。]*/gi,
  /多謝(您|你)?收(睇|看)[^\n。]{0,40}/g,
  /(承)?蒙(您|你)?(收睇|收看|觀看|捧場)[^\n。]{0,40}/g,
  /(時局|無線|TVB|HKTV)?\s*新聞[^\n。]{0,10}(再會|再见|再見)[!！。]?/g,
  /^再會[!！。]?$/gm,
  // 簡體常見廣告詞
  /关注我们[的別别]渠道[^\n。]*/g,
];

function filterHallucinations(text: string): string {
  let out = text;
  for (const re of HALLUCINATION_PATTERNS) out = out.replace(re, '');
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * 整段判定：若 filterHallucinations 把超過 50% 字元砍掉 → 整段是 hallucination 主導，丟
 * 同時：若原文長度 < 8 字 + 含任何 hallucination 殘留 → 也丟
 */
function isMostlyHallucination(original: string, cleaned: string): boolean {
  const o = original.replace(/\s+/g, '');
  const c = cleaned.replace(/\s+/g, '');
  if (o.length === 0) return true;
  if (c.length / o.length < 0.5) return true;
  if (o.length < 8) {
    // 短句嚴格：任何已知模式殘存就丟
    for (const re of HALLUCINATION_PATTERNS) {
      const t = new RegExp(re.source, re.flags.replace('g', ''));
      if (t.test(cleaned)) return true;
    }
  }
  return false;
}

/**
 * 偵測「重複字串」幻覺：同一短語在輸出裡重複 ≥3 次幾乎都是 hallucination
 * 例如「請不吝點贊訂閱請不吝點贊訂閱請不吝點贊...」
 */
function isLikelyHallucination(text: string): boolean {
  const t = text.replace(/\s+/g, '');
  if (t.length < 10) return false;
  // 找 5~30 字的重複片段
  for (let len = 5; len <= Math.min(30, Math.floor(t.length / 3)); len++) {
    for (let i = 0; i + len * 3 <= t.length; i++) {
      const piece = t.slice(i, i + len);
      if (t.slice(i + len, i + len * 2) === piece && t.slice(i + len * 2, i + len * 3) === piece) {
        return true;
      }
    }
  }
  return false;
}

// Silence detection 切段：句子停頓 → 自動送 Whisper
// dB 越接近 0 越大聲；人聲 -30 ~ -10、安靜環境 -50 以下、吵雜辦公室可能 -40
const SILENCE_DB = -30;          // ≤ 此值視為靜默
const SILENCE_MS_REQUIRED = 350; // 連續靜默 → commit
const MIN_CHUNK_MS = 2000;       // 至少 2 秒給模型上下文（短段準度差很多）
const MAX_CHUNK_MS = 12000;

// ── 雲端（OpenAI）即時字幕：原本的 chunk + silence-detect 實作，準度較高、付費 ──
function OpenAiLiveView({ navigation }: Props) {
  const WAV_OPTIONS = {
    ...RecordingPresets.LOW_QUALITY,
    extension: '.wav',
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 256000,
    isMeteringEnabled: true,
    ios: {
      ...((RecordingPresets.LOW_QUALITY as any).ios ?? {}),
      extension: '.wav',
      sampleRate: 16000,
      numberOfChannels: 1,
      linearPCMBitDepth: 16,
      linearPCMIsBigEndian: false,
      linearPCMIsFloat: false,
      outputFormat: (IOSOutputFormat as any)?.LINEARPCM ?? 'lpcm',
    },
    android: {
      ...((RecordingPresets.LOW_QUALITY as any).android ?? {}),
      extension: '.wav',
      sampleRate: 16000,
      numberOfChannels: 1,
    },
  } as any;
  const recorder = useAudioRecorder(WAV_OPTIONS);
  const recorderState = useAudioRecorderState(recorder);

  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [chunks, setChunks] = useState<string[]>([]); // index → text
  const [pending, setPending] = useState(0);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [debug, setDebug] = useState<{ db: number; silMs: number; age: number }>({ db: 0, silMs: 0, age: 0 });

  const chunksRef = useRef<string[]>([]);
  const chunkPathsRef = useRef<string[]>([]);
  const idxRef = useRef(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const clientRef = useRef<LLMClient | null>(null);
  const settingsRef = useRef<Settings | null>(null);
  const startTimeRef = useRef<number>(0);
  const scrollRef = useRef<ScrollView>(null);
  // silence detection state
  const chunkStartRef = useRef<number>(0);
  const silenceAccRef = useRef<number>(0);
  const lastMeteringTickRef = useRef<number>(0);
  const rotatingRef = useRef<boolean>(false);
  const pendingRef = useRef<number>(0);
  const hadSoundRef = useRef<boolean>(false);
  const soundTicksRef = useRef<number>(0); // 段內 metering 樣本中「有聲」的數
  const totalTicksRef = useRef<number>(0); // 段內總 metering 樣本數
  const lastTextRef = useRef<string>('');   // 上一段文字，用於偵測迴圈幻覺

  useEffect(() => () => cleanup(), []);

  // Silence detection — 以 metering 變化驅動切段
  useEffect(() => {
    if (phase !== 'recording') return;
    const metering = (recorderState as any).metering ?? -160;
    const now = Date.now();
    if (lastMeteringTickRef.current === 0) {
      lastMeteringTickRef.current = now;
      return;
    }
    const dt = now - lastMeteringTickRef.current;
    lastMeteringTickRef.current = now;
    const chunkAge = now - chunkStartRef.current;

    totalTicksRef.current += 1;
    if (metering < SILENCE_DB) {
      silenceAccRef.current += dt;
    } else {
      silenceAccRef.current = 0;
      hadSoundRef.current = true;
      soundTicksRef.current += 1;
    }

    setDebug({ db: Math.round(metering), silMs: silenceAccRef.current, age: chunkAge });

    const shouldRotate =
      (silenceAccRef.current >= SILENCE_MS_REQUIRED && chunkAge >= MIN_CHUNK_MS) ||
      chunkAge >= MAX_CHUNK_MS;

    if (shouldRotate && !rotatingRef.current) {
      rotatingRef.current = true;
      silenceAccRef.current = 0;
      chunkStartRef.current = now;
      // 計算「有聲比例」— 段內超過 25% 時間有聲音才送
      const soundRatio = totalTicksRef.current > 0 ? soundTicksRef.current / totalTicksRef.current : 0;
      const tooQuiet = !hadSoundRef.current || soundRatio < 0.25;
      hadSoundRef.current = false;
      soundTicksRef.current = 0;
      totalTicksRef.current = 0;
      rotateChunk(tooQuiet)
        .catch((e: any) => setError(`切段失敗：${e.message ?? e}`))
        .finally(() => { rotatingRef.current = false; });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorderState, phase]);

  const cleanup = () => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    deactivateKeepAwake(KEEP_AWAKE_TAG);
    try { if (recorder.isRecording) recorder.stop().catch(() => {}); } catch {}
  };

  const setSlot = (i: number, text: string) => {
    chunksRef.current[i] = text;
    setChunks([...chunksRef.current]);
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  };

  const transcribeChunk = async (path: string, slot: number) => {
    pendingRef.current += 1;
    setPending((n) => n + 1);
    try {
      const lang = settingsRef.current?.language === 'auto' ? undefined : settingsRef.current?.language;
      const text = await clientRef.current!.transcribe(path, {
        language: lang,
        temperature: 0,
        prompt:
          '這是一段繁體中文（台灣）軟體工程會議錄音逐字稿，可能夾雜英文技術名詞如 API、SDK、Expo、React Native、TypeScript、WebSocket、VAD、Whisper、LLM、prompt、token、chunk、buffer、stream、async、UI、debug、commit。' +
          '請使用繁體中文（台灣用語）輸出，技術名詞保留英文原文，不要翻譯成中文。' +
          '只輸出實際聽到的內容，不要加入任何字幕來源、感謝詞、訂閱呼籲、廣告。',
      });
      const cleaned = filterHallucinations(text);
      // 跳過：(1) 空字串 (2) 重複迴圈幻覺 (3) 跟上一段一模一樣 (4) 過濾砍掉 >50% 字元
      if (!cleaned) return;
      if (isLikelyHallucination(cleaned)) return;
      if (cleaned === lastTextRef.current) return;
      if (isMostlyHallucination(text, cleaned)) return;
      lastTextRef.current = cleaned;
      setSlot(slot, cleaned);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      // OpenAI 「audio_too_short」/ 0 sec 等錯誤靜默吞掉，不污染字幕區
      if (/audio_too_short|0\.0 seconds|shorter than/i.test(msg)) return;
      setSlot(slot, `[轉譯失敗：${msg}]`);
    } finally {
      pendingRef.current = Math.max(0, pendingRef.current - 1);
      setPending((n) => Math.max(0, n - 1));
    }
  };

  const moveToCache = (sourceUri: string, slot: number): string => {
    // 改存到 documents（不是 cache），避免 iOS 在錄音中清掉
    const dir = new Directory(Paths.document, 'live_chunks');
    if (!dir.exists) dir.create({ intermediates: true });
    const dest = new File(dir, `live_${startTimeRef.current}_${slot}.wav`);
    new File(sourceUri).move(dest);
    return dest.uri;
  };

  /** 切段：先 stop → 立刻 move file（趁 prepare 還沒清掉）→ 再 prepare 下一段 → 驗大小 → 送轉譯 */
  const rotateChunk = async (wasSilent: boolean = false) => {
    const slot = idxRef.current++;
    await recorder.stop();
    const sourceUri = recorder.uri;

    let movedPath: string | null = null;
    if (sourceUri) {
      try {
        movedPath = moveToCache(sourceUri, slot);
      } catch {
        movedPath = null;
      }
    }

    // 先 prepare 下一段（不要 await 太久，會掉音）
    await recorder.prepareToRecordAsync();
    recorder.record();

    // 整段都靜默 → 不送（避免 Whisper 對空白音檔幻覺出 YouTube 字幕收尾）
    if (wasSilent) return;

    if (movedPath) {
      // 不論大小都記錄路徑，最後 concat 整段音檔不會漏靜默/短段
      chunkPathsRef.current[slot] = movedPath;
      let size = 0;
      try { size = new File(movedPath).size ?? 0; } catch {}
      // 但只有 ≥60KB (~1.9s) 才送 Whisper，避過 audio_too_short 與大多幻覺
      if (size > 60 * 1024) {
        transcribeChunk(movedPath, slot);
      }
    }
  };

  const onStart = async () => {
    setError('');
    const s = await loadSettings();
    if (s.keySource !== 'managed' && !s.openaiApiKey) {
      setError('請先到設定填 OpenAI API Key');
      setPhase('error');
      return;
    }
    // Live 模式用 gpt-4o-transcribe (full)：mini 較不準；full 版幻覺仍低、準度大幅高
    const liveSettings = { ...s, openaiTranscriptionModel: 'gpt-4o-transcribe' };
    settingsRef.current = liveSettings;
    clientRef.current = new LLMClient(liveSettings);

    const perm = await AudioModule.requestRecordingPermissionsAsync();
    if (!perm.granted) {
      setError('麥克風權限被拒');
      setPhase('error');
      return;
    }
    try {
      await AudioModule.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      // 把 metering / status 更新頻率拉到 50ms（預設可能 500ms+，會錯過短停頓）
      try {
        (recorder as any).setProgressUpdateIntervalMillis?.(50);
      } catch {}
      recorder.record();
      await activateKeepAwakeAsync(KEEP_AWAKE_TAG);
      startTimeRef.current = Date.now();
      idxRef.current = 0;
      chunksRef.current = [];
      chunkPathsRef.current = [];
      setChunks([]);
      setPending(0);
      setElapsed(0);
      setPhase('recording');

      tickRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);

      // 預先建 cache dir
      try {
        const dir = new Directory(Paths.cache, 'live_chunks');
        if (!dir.exists) dir.create({ intermediates: true });
      } catch {}

      // 重設 silence detection 計時
      chunkStartRef.current = Date.now();
      silenceAccRef.current = 0;
      lastMeteringTickRef.current = 0;
    } catch (e: any) {
      setError(`啟動失敗：${e.message ?? e}`);
      setPhase('error');
    }
  };

  const onStop = async () => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    setPhase('finalizing');

    try {
      // 收末段
      const slot = idxRef.current++;
      await recorder.stop();
      const sourceUri = recorder.uri;
      deactivateKeepAwake(KEEP_AWAKE_TAG);
      if (sourceUri) {
        let movedPath: string | null = null;
        try { movedPath = moveToCache(sourceUri, slot); } catch {}
        if (movedPath) {
          chunkPathsRef.current[slot] = movedPath; // 末段也記錄路徑
          let size = 0;
          try { size = new File(movedPath).size ?? 0; } catch {}
          if (size > 60 * 1024) await transcribeChunk(movedPath, slot);
        }
      }
      // 等剩餘 pending 完成（用 ref 避免 closure stale；最多等 5 秒）
      const waitStart = Date.now();
      while (pendingRef.current > 0 && Date.now() - waitStart < 5000) {
        await new Promise((r) => setTimeout(r, 200));
      }

      const fullText = chunksRef.current.filter(Boolean).join(' ');

      // 同步 concat 音檔（讓 NotesView 一進去就有 audio_path）
      let finalAudioPath: string | null = null;
      let mergeError = '';
      const validPaths = chunkPathsRef.current.filter(Boolean);
      if (validPaths.length > 0) {
        try {
          setError('');
          setInfo(`合併 ${validPaths.length} 段音檔中…`);
          const combined = await concatWavs(validPaths);
          const dir = new Directory(Paths.document, 'recordings');
          if (!dir.exists) dir.create({ intermediates: true });
          const dest = new File(dir, `live_${startTimeRef.current}.wav`);
          new File(combined).move(dest);
          finalAudioPath = dest.uri;
        } catch (e: any) {
          mergeError = String(e?.message ?? e);
          setInfo(`音檔合併失敗（${mergeError}），但 transcript 已保留`);
        }
      }

      // 強制顯示診斷
      const totalSlots = chunkPathsRef.current.length;
      const valid = validPaths.length;
      let fileExists = false;
      let fileSize = 0;
      if (finalAudioPath) {
        try {
          const f = new File(finalAudioPath);
          fileExists = f.exists ?? false;
          fileSize = f.size ?? 0;
        } catch {}
      }
      const report =
        `slots: ${totalSlots}, 有效: ${valid}\n` +
        `finalAudioPath: ${finalAudioPath ? '有' : '無'}\n` +
        `檔案存在: ${fileExists}, 大小: ${fileSize} bytes\n` +
        `合併錯誤: ${mergeError || '無'}`;
      await new Promise<void>((resolve) => {
        Alert.alert('音檔診斷', report, [
          { text: '繼續', onPress: () => resolve() },
        ]);
      });

      const id = await createMeeting({
        title: '',
        started_at: startTimeRef.current,
        duration_sec: elapsed,
        audio_path: finalAudioPath,
        transcript: fullText,
        notes: null,
        mode: settingsRef.current?.mode ?? 'openai',
      });

      setPhase('done');
      navigation.replace('Notes', { meetingId: id });
    } catch (e: any) {
      setError(`結束失敗：${e.message ?? e}`);
      setPhase('error');
    }
  };

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  return (
    <View style={styles.root}>
      <View style={styles.masthead}>
        <Pressable
          onPress={() => (phase === 'recording' ? onStop() : navigation.goBack())}
          hitSlop={10}
        >
          <Text style={styles.mastheadText}>
            {phase === 'recording' ? '■ 結束' : '← 返回'}
          </Text>
        </Pressable>
        <Text style={styles.mastheadText}>
          {phase === 'recording' ? `LIVE · ${fmt(elapsed)}`
            : phase === 'finalizing' ? '收尾…'
            : '即時字幕'}
        </Text>
      </View>

      {phase === 'recording' && (
        <Text style={styles.debug}>
          dB {debug.db}  ·  silence {debug.silMs}/{SILENCE_MS_REQUIRED}ms  ·  chunk {debug.age}ms
          {debug.db < SILENCE_DB ? '  ·  ◌ 靜默' : '  ·  ● 有聲'}
        </Text>
      )}

      <ScrollView ref={scrollRef} style={styles.body} contentContainerStyle={styles.bodyInner}>
        {phase === 'idle' && (
          <Text style={styles.placeholder}>
            按下方圓鈕開始錄音。偵測到句末停頓（{SILENCE_MS_REQUIRED}ms 靜默）就自動送 Whisper、字幕一段一段冒出來。
            {'\n\n'}結束後會把所有段落合併成一個音檔存為一筆會議。
          </Text>
        )}
        {(phase === 'recording' || phase === 'finalizing') && chunks.filter(Boolean).length === 0 && (
          <Text style={styles.placeholder}>等你開口…（講完句子停頓一下就送）</Text>
        )}
        {chunks
          .filter(Boolean)
          .flatMap((text) => text.split(/(?<=[。！？，；,.!?;])\s*/).filter((s) => s.trim()))
          .map((line, i) => (
            <Text key={i} style={styles.line}>{line.trim()}</Text>
          ))}
        {pending > 0 && (
          <Text style={styles.pending}>… {pending} 段轉譯中</Text>
        )}
        {!!info && <Text style={styles.pending}>{info}</Text>}
        {phase === 'error' && <Text style={styles.error}>{error}</Text>}
      </ScrollView>

      <View style={styles.bottom}>
        {phase === 'idle' && (
          <Pressable style={styles.recButton} onPress={onStart}>
            <Feather name="mic" size={28} color={Color.paper} />
          </Pressable>
        )}
        {phase === 'recording' && (
          <Pressable style={styles.recButton} onPress={onStop}>
            <View style={styles.stopSquare} />
          </Pressable>
        )}
        {phase === 'finalizing' && (
          <View style={[styles.recButton, { opacity: 0.5 }]}>
            <Feather name="loader" size={28} color={Color.paper} />
          </View>
        )}
        {phase === 'error' && (
          <Pressable
            style={({ pressed }) => [styles.outlineButton, pressed && { opacity: 0.6 }]}
            onPress={() => { setPhase('idle'); setError(''); }}
          >
            <Text style={styles.outlineLabel}>重試</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

// ── 裝置端（Apple Speech / Android on-device）即時字幕：免費、離線、音訊不離開手機 ──
function DeviceLiveView({ navigation }: Props) {
  const stt = useDeviceLiveTranscription();
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [info, setInfo] = useState('');
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const langRef = useRef<'zh' | 'en' | 'auto'>('zh');
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => () => {
    if (tickRef.current) clearInterval(tickRef.current);
    deactivateKeepAwake(KEEP_AWAKE_TAG);
    try { stt.stop(); } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, [stt.lines, stt.partial]);

  const onStart = async () => {
    try {
      const s = await loadSettings();
      langRef.current = s.language;
      stt.reset();
      await stt.start(s.language === 'auto' ? 'zh' : s.language);
      await activateKeepAwakeAsync(KEEP_AWAKE_TAG);
      startTimeRef.current = Date.now();
      setElapsed(0);
      setPhase('recording');
      tickRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } catch (e: any) {
      setError2(`啟動失敗：${e.message ?? e}`);
    }
  };

  const [error, setError] = useState('');
  const setError2 = (m: string) => { setError(m); setPhase('error'); };

  const onStop = async () => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    deactivateKeepAwake(KEEP_AWAKE_TAG);
    setPhase('finalizing');
    stt.stop();
    // 等末段定稿 + audioend 落地
    await new Promise((r) => setTimeout(r, 800));

    const fullText = [...stt.lines, stt.partial].filter((t) => t && t.trim()).join('\n');

    // 把裝置端持久化的多段音檔 concat 成一個（失敗就不存音檔，transcript 仍保留）
    let finalAudioPath: string | null = null;
    const uris = stt.audioUris.filter(Boolean);
    if (uris.length > 0) {
      try {
        setInfo(`合併 ${uris.length} 段音檔中…`);
        const combined = await concatWavs(uris);
        const dir = new Directory(Paths.document, 'recordings');
        if (!dir.exists) dir.create({ intermediates: true });
        const dest = new File(dir, `live_device_${startTimeRef.current}.wav`);
        new File(combined).move(dest);
        finalAudioPath = dest.uri;
      } catch {
        finalAudioPath = uris.length === 1 ? uris[0] : null;
      }
    }

    // 逐句時間戳（僅 SpeechAnalyzer 引擎會給）→ 存 segments 供 NotesView 點字幕跳播。
    // 任一句有秒數才存；全 null（如 expo fallback）就存 null，NotesView 自動退回純文字。
    const finalLines = stt.lines.filter((t) => t && t.trim());
    const finalTimes = stt.timestamps.slice(0, finalLines.length);
    const hasAnyTime = finalTimes.some((t) => typeof t === 'number');
    const segments = hasAnyTime
      ? JSON.stringify(finalLines.map((text, i) => ({ t: finalTimes[i] ?? null, text })))
      : null;

    try {
      const id = await createMeeting({
        title: '',
        started_at: startTimeRef.current,
        duration_sec: elapsed,
        audio_path: finalAudioPath,
        transcript: fullText,
        notes: null,
        mode: 'openai', // 摘要仍走 LLM；STT 來源與此無關
        segments,
      });
      setPhase('done');
      navigation.replace('Notes', { meetingId: id });
    } catch (e: any) {
      setError2(`結束失敗：${e.message ?? e}`);
    }
  };

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  return (
    <View style={styles.root}>
      <View style={styles.masthead}>
        <Pressable onPress={() => (phase === 'recording' ? onStop() : navigation.goBack())} hitSlop={10}>
          <Text style={styles.mastheadText}>{phase === 'recording' ? '■ 結束' : '← 返回'}</Text>
        </Pressable>
        <Text style={styles.mastheadText}>
          {phase === 'recording' ? `裝置端 · ${fmt(elapsed)}`
            : phase === 'finalizing' ? '收尾…'
            : '即時字幕（離線）'}
        </Text>
      </View>

      <ScrollView ref={scrollRef} style={styles.body} contentContainerStyle={styles.bodyInner}>
        {phase === 'idle' && (
          <Text style={styles.placeholder}>
            按下方圓鈕開始。語音在手機本機即時轉文字，免費、不連網、音訊不離開裝置。
            {'\n\n'}（此模式需 dev build，Expo Go 無法使用。）
          </Text>
        )}
        {(phase === 'recording' || phase === 'finalizing') && stt.lines.length === 0 && !stt.partial && (
          <Text style={styles.placeholder}>等你開口…</Text>
        )}
        {stt.lines.map((line, i) => (
          <Text key={i} style={styles.line}>{line}</Text>
        ))}
        {!!stt.partial && <Text style={[styles.line, { color: Color.inkMuted }]}>{stt.partial}</Text>}
        {!!info && <Text style={styles.pending}>{info}</Text>}
        {!!stt.error && phase === 'recording' && <Text style={styles.pending}>{stt.error}</Text>}
        {phase === 'error' && <Text style={styles.error}>{error}</Text>}
      </ScrollView>

      <View style={styles.bottom}>
        {phase === 'idle' && (
          <Pressable style={styles.recButton} onPress={onStart}>
            <Feather name="mic" size={28} color={Color.paper} />
          </Pressable>
        )}
        {phase === 'recording' && (
          <Pressable style={styles.recButton} onPress={onStop}>
            <View style={styles.stopSquare} />
          </Pressable>
        )}
        {phase === 'finalizing' && (
          <View style={[styles.recButton, { opacity: 0.5 }]}>
            <Feather name="loader" size={28} color={Color.paper} />
          </View>
        )}
        {phase === 'error' && (
          <Pressable
            style={({ pressed }) => [styles.outlineButton, pressed && { opacity: 0.6 }]}
            onPress={() => { setPhase('idle'); setError(''); }}
          >
            <Text style={styles.outlineLabel}>重試</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

// 依設定挑「裝置端（免費/離線）」或「OpenAI（較準）」
export default function LiveRecordingView(props: Props) {
  const [source, setSource] = useState<'device' | 'openai' | null>(null);
  useEffect(() => {
    loadSettings().then((s) => setSource(s.liveSttSource));
  }, []);
  if (source === null) return <View style={styles.root} />;
  return source === 'device' ? <DeviceLiveView {...props} /> : <OpenAiLiveView {...props} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Color.canvas },
  masthead: {
    paddingHorizontal: 26, paddingTop: 60, paddingBottom: 20,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  mastheadText: {
    fontFamily: FontFamily.mono, fontSize: 10, letterSpacing: 2,
    color: Color.inkMuted, textTransform: 'uppercase',
  },
  body: { flex: 1 },
  bodyInner: { padding: 26, paddingBottom: 16, gap: 8 },
  placeholder: { fontSize: 13, color: Color.inkMuted, lineHeight: 20 },
  line: { fontSize: 16, color: Color.ink, lineHeight: 26 },
  pending: {
    fontFamily: FontFamily.mono, fontSize: 10, letterSpacing: 1.5,
    color: Color.inkMuted, textTransform: 'uppercase', marginTop: 4,
  },
  debug: {
    paddingHorizontal: 26, paddingBottom: 8,
    fontFamily: FontFamily.mono, fontSize: 10, letterSpacing: 0.5,
    color: Color.inkFaint,
  },
  error: { fontSize: 14, color: '#a00', lineHeight: 22 },
  bottom: { alignItems: 'center', paddingBottom: 44, paddingTop: 12 },
  recButton: {
    width: 78, height: 78, borderRadius: 39, backgroundColor: Color.ink,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.4, shadowRadius: 40, elevation: 16,
  },
  stopSquare: { width: 22, height: 22, borderRadius: 6, backgroundColor: Color.paper },
  outlineButton: {
    paddingHorizontal: 24, paddingVertical: 16,
    borderRadius: Radius.md, borderWidth: StyleSheet.hairlineWidth,
    borderColor: Color.hairline, alignItems: 'center',
  },
  outlineLabel: { color: Color.ink, fontSize: 15, fontWeight: '500', letterSpacing: -0.15 },
});
