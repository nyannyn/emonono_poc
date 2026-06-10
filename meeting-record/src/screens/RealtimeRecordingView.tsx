// RealtimeRecordingView — 試用 OpenAI Realtime API (WebSocket)
// 流程：WS 連線 → session.update 設 pcm16 + transcription → 每 500ms 切段 PCM 傳 input_audio_buffer.append
// 接 conversation.item.input_audio_transcription.delta / completed 事件即時顯示
//
// 限制：
// - Expo Go 沒原生 mic stream，仍要靠 expo-audio chunked recording (stop/restart loop)
// - 真實 streaming 要 EAS dev build + native audio module
// - 此版本不存音檔（chunk 太小無法穩定 concat）

import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AudioModule, IOSOutputFormat, RecordingPresets, useAudioRecorder } from 'expo-audio';
import { Directory, File, Paths } from 'expo-file-system';
import { createMeeting } from '../storage/db';
import { loadSettings, Settings } from '../storage/settings';
import { concatWavs } from '../audio/voiceprintMix';
import { Color, FontFamily, Radius } from '../theme/tokens';
import { RootStackParamList } from '../navigation/AppNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Realtime'>;
type Phase = 'idle' | 'connecting' | 'streaming' | 'finalizing' | 'done' | 'error';

const CHUNK_MS = 500;
const SAMPLE_RATE = 24000; // Realtime API 偏好 24kHz pcm16
const COMPACT_EVERY = 30; // 每 30 個 500ms chunks (= 15 秒) 邊錄邊壓成一個 block，避免最後 OOM
const REALTIME_MODEL = 'gpt-realtime-whisper';
const TRANSCRIBE_MODEL = 'gpt-4o-transcribe';

function uint8ToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(bin);
}

function findDataChunk(bytes: Uint8Array): { dataStart: number } | null {
  for (let i = 12; i < Math.min(bytes.length - 8, 2000); i++) {
    if (bytes[i] === 0x64 && bytes[i + 1] === 0x61 && bytes[i + 2] === 0x74 && bytes[i + 3] === 0x61) {
      return { dataStart: i + 8 };
    }
  }
  return null;
}

export default function RealtimeRecordingView({ navigation }: Props) {
  const WAV_OPTIONS = {
    ...RecordingPresets.LOW_QUALITY,
    extension: '.wav',
    sampleRate: SAMPLE_RATE,
    numberOfChannels: 1,
    bitRate: 384000,
    ios: {
      ...((RecordingPresets.LOW_QUALITY as any).ios ?? {}),
      extension: '.wav',
      sampleRate: SAMPLE_RATE,
      numberOfChannels: 1,
      linearPCMBitDepth: 16,
      linearPCMIsBigEndian: false,
      linearPCMIsFloat: false,
      outputFormat: (IOSOutputFormat as any)?.LINEARPCM ?? 'lpcm',
    },
    android: {
      ...((RecordingPresets.LOW_QUALITY as any).android ?? {}),
      extension: '.wav',
      sampleRate: SAMPLE_RATE,
      numberOfChannels: 1,
    },
  } as any;
  const recorder = useAudioRecorder(WAV_OPTIONS);

  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [transcript, setTranscript] = useState<string[]>([]); // committed segments
  const [partial, setPartial] = useState(''); // current delta accumulator
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const wsRef = useRef<WebSocket | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chunkRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const settingsRef = useRef<Settings | null>(null);
  const startTimeRef = useRef<number>(0);
  const idxRef = useRef(0);
  const partialRef = useRef('');
  const transcriptRef = useRef<string[]>([]);
  const scrollRef = useRef<ScrollView>(null);
  const chunkPathsRef = useRef<string[]>([]);
  const pendingPathsRef = useRef<string[]>([]);
  const blockPathsRef = useRef<string[]>([]);
  const inflightCompactsRef = useRef<number>(0);
  const compactErrorRef = useRef<string>('');

  useEffect(() => () => cleanup(), []);

  const cleanup = () => {
    if (tickRef.current) clearInterval(tickRef.current);
    if (chunkRef.current) clearInterval(chunkRef.current);
    tickRef.current = null;
    chunkRef.current = null;
    deactivateKeepAwake('rt');
    try { if (recorder.isRecording) recorder.stop().catch(() => {}); } catch {}
    try { wsRef.current?.close(); } catch {}
    wsRef.current = null;
  };

  const appendCommitted = (text: string) => {
    transcriptRef.current = [...transcriptRef.current, text];
    setTranscript([...transcriptRef.current]);
    setPartial('');
    partialRef.current = '';
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  };

  const onStart = async () => {
    setError('');
    setInfo('');
    const s = await loadSettings();
    if (!s.openaiApiKey) {
      setError('請先到設定填 OpenAI API Key');
      setPhase('error');
      return;
    }
    settingsRef.current = s;

    const perm = await AudioModule.requestRecordingPermissionsAsync();
    if (!perm.granted) {
      setError('麥克風權限被拒');
      setPhase('error');
      return;
    }

    setPhase('connecting');

    // 連 WebSocket（RN 的 WebSocket 第三個參數可帶 headers）
    const url = `wss://api.openai.com/v1/realtime?model=${REALTIME_MODEL}`;
    let ws: WebSocket;
    try {
      // RN 的 WebSocket 支援第三個 options 參數帶 headers，但型別只宣告 1-2 個參數
      ws = new (WebSocket as any)(url, undefined, {
        headers: {
          Authorization: `Bearer ${s.openaiApiKey}`,
          'OpenAI-Beta': 'realtime=v1',
        },
      });
    } catch (e: any) {
      setError(`WebSocket 建立失敗：${e.message ?? e}`);
      setPhase('error');
      return;
    }
    wsRef.current = ws;

    ws.onopen = async () => {
      setInfo('已連線');
      // 純轉譯 session：server VAD + prompt 鎖繁中 + 不啟用 conversation
      ws.send(JSON.stringify({
        type: 'session.update',
        session: {
          modalities: ['text'],
          instructions: '只轉譯使用者說的話。輸出繁體中文（台灣）。不要加入字幕來源、感謝詞、訂閱呼籲、廣告等錄音中不存在的文字。',
          input_audio_format: 'pcm16',
          input_audio_transcription: {
            model: TRANSCRIBE_MODEL,
            prompt: '繁體中文（台灣）會議錄音，可能夾雜英文技術名詞。',
            language: 'zh',
          },
          turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500,
          },
        },
      }));

      // 開始錄音 + chunk loop
      try {
        await AudioModule.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync();
        recorder.record();
        await activateKeepAwakeAsync('rt');
        startTimeRef.current = Date.now();
        idxRef.current = 0;
        transcriptRef.current = [];
        partialRef.current = '';
        setTranscript([]);
        setPartial('');
        setElapsed(0);
        setPhase('streaming');

        const dir = new Directory(Paths.cache, 'rt_chunks');
        if (!dir.exists) dir.create({ intermediates: true });

        tickRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
        chunkRef.current = setInterval(() => rotateAndSend().catch(() => {}), CHUNK_MS);
      } catch (e: any) {
        setError(`錄音啟動失敗：${e.message ?? e}`);
        setPhase('error');
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case 'conversation.item.input_audio_transcription.delta': {
            const delta = msg.delta ?? '';
            partialRef.current += delta;
            setPartial(partialRef.current);
            break;
          }
          case 'conversation.item.input_audio_transcription.completed': {
            const t = (msg.transcript ?? '').trim();
            if (t) appendCommitted(t);
            break;
          }
          case 'error': {
            setError(`Realtime: ${msg.error?.message ?? JSON.stringify(msg.error)}`);
            break;
          }
          case 'session.created':
          case 'session.updated':
            // ok
            break;
          default:
            // 其他事件忽略
            break;
        }
      } catch {
        // not JSON
      }
    };

    ws.onerror = (e: any) => {
      setError(`WebSocket 錯誤：${e?.message ?? '連線中斷'}`);
      setPhase('error');
    };
    ws.onclose = (e) => {
      if (phase === 'streaming') {
        setInfo(`連線關閉 (${e.code})`);
      }
    };
  };

  /** 把一批小 chunks concat 成一個 block 檔；成功後刪除原始 chunks */
  const compactBlock = async (paths: string[]) => {
    if (paths.length === 0) return;
    inflightCompactsRef.current += 1;
    try {
      const combined = await concatWavs(paths);
      const dir = new Directory(Paths.document, 'rt_blocks');
      if (!dir.exists) dir.create({ intermediates: true });
      const dest = new File(dir, `block_${startTimeRef.current}_${blockPathsRef.current.length}.wav`);
      new File(combined).move(dest);
      blockPathsRef.current.push(dest.uri);
      for (const p of paths) {
        try { new File(p).delete(); } catch {}
      }
    } catch (e: any) {
      compactErrorRef.current = String(e?.message ?? e);
    } finally {
      inflightCompactsRef.current -= 1;
    }
  };

  const rotateAndSend = async () => {
    const slot = idxRef.current++;
    await recorder.stop();
    const sourceUri = recorder.uri;

    // 先把 chunk 從 recorder 暫存搬到 documents（避免被下次 prepare 清掉）
    let kept: string | null = null;
    if (sourceUri) {
      try {
        const dir = new Directory(Paths.document, 'rt_chunks');
        if (!dir.exists) dir.create({ intermediates: true });
        const dest = new File(dir, `rt_${startTimeRef.current}_${slot}.wav`);
        new File(sourceUri).move(dest);
        kept = dest.uri;
        chunkPathsRef.current[slot] = kept;
        pendingPathsRef.current.push(kept);
        // 達到門檻就背景壓 block（不阻塞錄音 / WS send）
        if (pendingPathsRef.current.length >= COMPACT_EVERY) {
          const toCompact = pendingPathsRef.current.splice(0);
          compactBlock(toCompact).catch(() => {});
        }
      } catch {
        kept = null;
      }
    }

    // 立刻 prepare 下一段
    await recorder.prepareToRecordAsync();
    recorder.record();

    if (!kept) return;
    let bytes: Uint8Array;
    try {
      bytes = await (new File(kept) as any).bytes();
    } catch { return; }
    if (!bytes || bytes.length < 1024) return;

    const dc = findDataChunk(bytes);
    if (!dc) return;
    const pcm = bytes.subarray(dc.dataStart);
    if (pcm.length < 1024) return;

    const b64 = uint8ToBase64(pcm);
    const ws = wsRef.current;
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: b64 }));
  };

  const onStop = async () => {
    if (tickRef.current) clearInterval(tickRef.current);
    if (chunkRef.current) clearInterval(chunkRef.current);
    tickRef.current = null;
    chunkRef.current = null;
    setPhase('finalizing');

    try {
      // 收末段
      await rotateAndSend();
    } catch {}

    // 通知 server commit + 等剩餘 transcription
    try {
      wsRef.current?.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
    } catch {}
    await new Promise((r) => setTimeout(r, 1500)); // 等末段轉譯回來

    try { wsRef.current?.close(); } catch {}
    wsRef.current = null;
    deactivateKeepAwake('rt');

    const fullText = [...transcriptRef.current, partialRef.current].filter(Boolean).join(' ');

    setInfo('等待背景 compact 完成…');
    // 等待先前 fire-and-forget 的 compactBlock 全部跑完，避免漏 block
    const waitStart = Date.now();
    while (inflightCompactsRef.current > 0 && Date.now() - waitStart < 15000) {
      await new Promise((r) => setTimeout(r, 200));
    }

    // 收尾：把剩下不滿一個 block 的 chunks 也壓進來
    if (pendingPathsRef.current.length > 0) {
      const tail = pendingPathsRef.current.splice(0);
      await compactBlock(tail);
    }

    let finalAudioPath: string | null = null;
    const blocks = blockPathsRef.current.filter(Boolean);
    const remainingChunks = chunkPathsRef.current.filter(Boolean); // 給 fallback 用
    setInfo(`合併中… blocks=${blocks.length}, in-flight=${inflightCompactsRef.current}, compactErr=${compactErrorRef.current || '無'}`);

    // 先用 blocks 合併（首選）
    if (blocks.length > 0) {
      try {
        const combined = await concatWavs(blocks);
        const dir = new Directory(Paths.document, 'recordings');
        if (!dir.exists) dir.create({ intermediates: true });
        const dest = new File(dir, `realtime_${startTimeRef.current}.wav`);
        new File(combined).move(dest);
        finalAudioPath = dest.uri;
        for (const b of blocks) { try { new File(b).delete(); } catch {} }
      } catch (e: any) {
        setInfo(`block 合併失敗：${e.message ?? e}（試 fallback…）`);
      }
    }

    // Fallback：blocks 失敗或都空 → 直接 concat 原始 chunks
    if (!finalAudioPath && remainingChunks.length > 0) {
      try {
        const combined = await concatWavs(remainingChunks);
        const dir = new Directory(Paths.document, 'recordings');
        if (!dir.exists) dir.create({ intermediates: true });
        const dest = new File(dir, `realtime_${startTimeRef.current}.wav`);
        new File(combined).move(dest);
        finalAudioPath = dest.uri;
      } catch (e: any) {
        setInfo(`chunks fallback 也失敗：${e.message ?? e}`);
      }
    }

    if (!finalAudioPath) {
      // 強制顯示診斷，讓使用者看得到為什麼沒音檔
      const report =
        `chunks 記錄: ${chunkPathsRef.current.filter(Boolean).length}\n` +
        `blocks 已壓: ${blockPathsRef.current.length}\n` +
        `等待中 compact: ${inflightCompactsRef.current}\n` +
        `compact 錯: ${compactErrorRef.current || '無'}\n` +
        `總長度: ${elapsed}s`;
      await new Promise<void>((resolve) => {
        Alert.alert('音檔合併失敗（transcript 仍會存）', report, [
          { text: '繼續到 Notes', onPress: () => resolve() },
        ]);
      });
    }

    if (fullText.trim() || finalAudioPath) {
      const id = await createMeeting({
        title: '',
        started_at: startTimeRef.current,
        duration_sec: elapsed,
        audio_path: finalAudioPath,
        transcript: fullText.trim(),
        notes: null,
        mode: settingsRef.current?.mode ?? 'openai',
      });
      navigation.replace('Notes', { meetingId: id });
    } else {
      setPhase('done');
    }
  };

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  return (
    <View style={styles.root}>
      <View style={styles.masthead}>
        <Pressable
          onPress={() => (phase === 'streaming' ? onStop() : navigation.goBack())}
          hitSlop={10}
        >
          <Text style={styles.mastheadText}>
            {phase === 'streaming' ? '■ 結束' : '← 返回'}
          </Text>
        </Pressable>
        <Text style={styles.mastheadText}>
          {phase === 'streaming' ? `RT · ${fmt(elapsed)}`
            : phase === 'connecting' ? '連線中…'
            : phase === 'finalizing' ? '收尾…'
            : 'Realtime 字幕'}
        </Text>
      </View>

      <ScrollView ref={scrollRef} style={styles.body} contentContainerStyle={styles.bodyInner}>
        {phase === 'idle' && (
          <Text style={styles.placeholder}>
            按下方圓鈕連接 OpenAI Realtime API、開始串流轉譯。每 {CHUNK_MS}ms 送一次 PCM，server VAD 自動斷句。
            {'\n\n'}模型：{REALTIME_MODEL} + {TRANSCRIBE_MODEL}
          </Text>
        )}
        {!!info && <Text style={styles.info}>{info}</Text>}
        {transcript.map((t, i) => (
          <Text key={i} style={styles.line}>{t}</Text>
        ))}
        {!!partial && <Text style={styles.partial}>{partial}</Text>}
        {phase === 'error' && <Text style={styles.error}>{error}</Text>}
      </ScrollView>

      <View style={styles.bottom}>
        {(phase === 'idle' || phase === 'done') && (
          <Pressable style={styles.recButton} onPress={onStart}>
            <Feather name="mic" size={28} color={Color.paper} />
          </Pressable>
        )}
        {(phase === 'connecting' || phase === 'finalizing') && (
          <View style={[styles.recButton, { opacity: 0.5 }]}>
            <Feather name="loader" size={28} color={Color.paper} />
          </View>
        )}
        {phase === 'streaming' && (
          <Pressable style={styles.recButton} onPress={onStop}>
            <View style={styles.stopSquare} />
          </Pressable>
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
  info: {
    fontFamily: FontFamily.mono, fontSize: 10, letterSpacing: 1.5,
    color: Color.inkFaint, textTransform: 'uppercase',
  },
  line: { fontSize: 16, color: Color.ink, lineHeight: 26 },
  partial: { fontSize: 16, color: Color.inkMuted, lineHeight: 26, fontStyle: 'italic' },
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
