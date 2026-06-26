// RecordingView — 整段錄完才送 + 可選與會者拼前置聲紋讓 Whisper 自動配對講者

import { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AudioModule, IOSOutputFormat, RecordingPresets, useAudioRecorder } from 'expo-audio';
import { Directory, File, Paths } from 'expo-file-system';
import { LLMClient } from '../llm/client';
import { createMeeting, getMeeting, listMembers, Member, updateMeeting } from '../storage/db';
import { loadSettings, Settings } from '../storage/settings';
import { autoMapSpeakers, prependVoiceprints } from '../audio/voiceprintMix';
import { Color, FontFamily, Radius } from '../theme/tokens';
import { RootStackParamList } from '../navigation/AppNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Recording'>;
type Phase = 'idle' | 'recording' | 'attendees' | 'transcribing' | 'done' | 'error';

const KEEP_AWAKE_TAG = 'meeting-record';

export default function RecordingView({ navigation, route }: Props) {
  const WAV_OPTIONS = {
    ...RecordingPresets.LOW_QUALITY,
    extension: '.wav',
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 256000,
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

  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [meetingId, setMeetingId] = useState<number | null>(null);
  const [chunkProg, setChunkProg] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState('');
  const [recordedPath, setRecordedPath] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [mappedSummary, setMappedSummary] = useState('');
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 進背景自動停止並保存（Expo Go 背景錄音本就無效，避免靜默掉錄音）
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const onStopRef = useRef<() => void>(() => {});

  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'background' && phaseRef.current === 'recording') onStopRef.current();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const uri = route.params?.uploadedFileUri;
    const retryId = route.params?.retryMeetingId;
    if (uri) handleIncomingFile(uri);
    else if (retryId != null) retryTranscribe(retryId);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      deactivateKeepAwake(KEEP_AWAKE_TAG);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 上傳檔案：先持久化＋建「待轉譯」紀錄。WAV 且有成員 → attendees phase；否則直接轉譯 */
  const handleIncomingFile = async (uri: string) => {
    try {
      const path = moveToRecordings(uri);
      const id = await createMeeting({
        title: '', started_at: Date.now(), duration_sec: null,
        audio_path: path, transcript: null, notes: null, mode: null,
      });
      setMeetingId(id);
      setRecordedPath(path);
      const isWav = path.toLowerCase().endsWith('.wav');
      if (isWav) {
        const ms = await listMembers();
        if (ms.length > 0) {
          setMembers(ms);
          setSelectedIds(new Set());
          setPhase('attendees');
          return;
        }
      }
      await runTranscribe(id, path, []);
    } catch (e: any) {
      setError(`匯入失敗：${e.message ?? e}`);
      setPhase('error');
    }
  };

  /** 從歷史的「待轉譯」列重新轉譯：取回音檔路徑後重跑。 */
  const retryTranscribe = async (id: number) => {
    try {
      const m = await getMeeting(id);
      if (!m || !m.audio_path) {
        setError('找不到原始音檔，無法重新轉譯');
        setPhase('error');
        return;
      }
      setMeetingId(id);
      setRecordedPath(m.audio_path);
      await runTranscribe(id, m.audio_path, []);
    } catch (e: any) {
      setError(`重新轉譯失敗：${e.message ?? e}`);
      setPhase('error');
    }
  };

  const verifySettings = (s: Settings): string | null => {
    if (s.keySource !== 'managed' && !s.openaiApiKey) return '請先到設定填 OpenAI API Key（STT 用）';
    if (s.mode === 'local' && (!s.llmUrl || !s.username)) {
      return '本地 Ollama 模式還需填 Ollama URL / 帳密';
    }
    return null;
  };

  const moveToRecordings = (sourceUri: string): string => {
    const dir = new Directory(Paths.document, 'recordings');
    if (!dir.exists) dir.create({ intermediates: true });
    const ext = sourceUri.match(/\.\w+$/)?.[0] ?? '.m4a';
    const source = new File(sourceUri);
    const dest = new File(dir, `${Date.now()}${ext}`);
    source.move(dest);
    return dest.uri;
  };

  const checkUploadSize = (uri: string): string | null => {
    let sizeBytes = 0;
    try {
      sizeBytes = new File(uri).size ?? 0;
    } catch {
      return null;
    }
    const mb = sizeBytes / (1024 * 1024);
    if (mb > 24 && !uri.toLowerCase().endsWith('.wav')) {
      return `音檔 ${mb.toFixed(1)} MB 超過雲端轉錄單檔 25MB 上限。\n請改用 app 內錄音（不限長度，會自動分段），或上傳 25MB 以內的音檔。`;
    }
    return null;
  };

  const onStart = async () => {
    setError('');
    const s = await loadSettings();
    const issue = verifySettings(s);
    if (issue) { setError(issue); setPhase('error'); return; }
    const perm = await AudioModule.requestRecordingPermissionsAsync();
    if (!perm.granted) { setError('麥克風權限被拒'); setPhase('error'); return; }
    try {
      await AudioModule.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      await activateKeepAwakeAsync(KEEP_AWAKE_TAG);
      setPhase('recording');
      setElapsed(0);
      setTranscript('');
      setMappedSummary('');
      tickRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } catch (e: any) {
      setError(`啟動失敗：${e.message ?? e}`);
      setPhase('error');
    }
  };

  /** 錄音停止：先存檔 → 載入成員 → 若有成員顯示 AttendeesPicker，沒則直接轉譯。 */
  const onStop = async () => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    try {
      await recorder.stop();
      const sourceUri = recorder.uri;
      deactivateKeepAwake(KEEP_AWAKE_TAG);
      if (!sourceUri) throw new Error('No URI from recorder');
      const path = moveToRecordings(sourceUri);
      setRecordedPath(path);
      // 音檔一落地就建「待轉譯」紀錄，轉譯崩潰也不會掉錄音
      const id = await createMeeting({
        title: '', started_at: Date.now(), duration_sec: elapsed || null,
        audio_path: path, transcript: null, notes: null, mode: null,
      });
      setMeetingId(id);
      const ms = await listMembers();
      setMembers(ms);
      setSelectedIds(new Set());
      if (ms.length === 0) {
        await runTranscribe(id, path, []);
      } else {
        setPhase('attendees');
      }
    } catch (e: any) {
      setError(`停止失敗：${e.message ?? e}`);
      setPhase('error');
    }
  };

  onStopRef.current = onStop;

  const onConfirmAttendees = async () => {
    if (!recordedPath || meetingId == null) return;
    const selected = members.filter((m) => selectedIds.has(m.id));
    await runTranscribe(meetingId, recordedPath, selected);
  };

  const runTranscribe = async (id: number, path: string, selected: Member[]) => {
    setPhase('transcribing');
    setMappedSummary('');
    try {
      const s = await loadSettings();
      let finalPath = path;
      if (selected.length > 0) {
        try {
          finalPath = await prependVoiceprints(path, selected);
        } catch (e: any) {
          // 拼接失敗（多半是錄音不是真的 WAV）→ 退回不串接，純 diarize 後可手動 mapping
          setMappedSummary(`聲紋拼接失敗（${e.message}）→ 改用純轉譯，可在 Notes「對應講者」手動修`);
          finalPath = path;
        }
      }

      const sizeIssue = checkUploadSize(finalPath);
      if (sizeIssue) { setError(sizeIssue); setPhase('error'); return; }

      const client = new LLMClient(s);
      const lang = s.language === 'auto' ? undefined : s.language;
      setChunkProg(null);
      let text = await client.transcribe(finalPath, {
        language: lang,
        prompt: '以下是一段繁體中文（台灣用語）的會議錄音逐字稿，可能夾雜少量英文技術名詞。',
        onProgress: (done, total) => total > 1 && setChunkProg({ done, total }),
      });

      if (selected.length > 0 && /\[speaker[_\s]?\w+\]/i.test(text)) {
        const r = autoMapSpeakers(text, selected);
        text = r.text;
        const total = Object.keys(r.mapping).length + r.ambiguous.length;
        setMappedSummary(`自動對應 ${Object.keys(r.mapping).length}/${total} 位講者${r.ambiguous.length ? '（其餘可在 Notes 點「對應講者」手動修正）' : ''}`);
      } else if (selected.length > 0) {
        setMappedSummary('未偵測到 [speaker_*] 標籤；請確認 Settings 的 Whisper 模型是 gpt-4o-transcribe-diarize');
      }

      setTranscript(text);
      await updateMeeting(id, {
        transcript: text, duration_sec: elapsed || null, mode: s.mode,
      });
      setMeetingId(id);
      setPhase('done');
    } catch (e: any) {
      setError(`轉譯失敗：${e.message ?? e}（錄音已保存，可在歷史重新轉譯）`);
      setPhase('error');
    }
  };

  const onSummarize = () => {
    if (meetingId != null) navigation.navigate('Notes', { meetingId });
    else navigation.navigate('Notes', { transcript });
  };

  const onReset = () => {
    setPhase('idle');
    setTranscript('');
    setMeetingId(null);
    setError('');
    setElapsed(0);
    setRecordedPath(null);
    setSelectedIds(new Set());
    setMappedSummary('');
  };

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  const headerRight =
    phase === 'recording' ? `REC · ${fmt(elapsed)}`
      : phase === 'attendees' ? '與會者'
      : phase === 'transcribing' ? '轉譯中…'
      : phase === 'done' ? '逐字稿'
      : phase === 'error' ? '錯誤'
      : '會議錄音';

  return (
    <View style={styles.root}>
      <View style={styles.masthead}>
        <Pressable
          onPress={() => (phase === 'recording' ? onStop() : navigation.goBack())}
          hitSlop={10}
        >
          <Text style={styles.mastheadText}>
            {phase === 'recording' ? '■ 停止' : '← 返回'}
          </Text>
        </Pressable>
        <Text style={styles.mastheadText}>{headerRight}</Text>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyInner}>
        {phase === 'idle' && (
          <Text style={styles.placeholder}>
            按下方按鈕開始錄音。錄完整段後按停止，會自動上傳轉譯。
          </Text>
        )}
        {phase === 'recording' && (
          <Text style={styles.placeholder}>
            錄音中（{fmt(elapsed)}）。請保持螢幕亮 / app 在前景。錄完按停止。
          </Text>
        )}
        {phase === 'attendees' && (
          <View>
            <Text style={styles.placeholder}>
              選擇本次與會者。被勾選的成員聲紋首句會拼到錄音前面，讓 Whisper diarize 自動配對講者。
            </Text>
            <View style={{ marginTop: 16, gap: 8 }}>
              {members.map((m) => {
                const active = selectedIds.has(m.id);
                return (
                  <Pressable
                    key={m.id}
                    onPress={() => {
                      const next = new Set(selectedIds);
                      if (active) next.delete(m.id); else next.add(m.id);
                      setSelectedIds(next);
                    }}
                    style={[styles.memberChip, active && styles.memberChipActive]}
                  >
                    <Text style={[styles.memberChipLabel, active && styles.memberChipLabelActive]}>
                      {active ? '✓ ' : ''}{m.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}
        {phase === 'transcribing' && (
          <Text style={styles.placeholder}>
            {chunkProg
              ? `音檔較大、自動切段中：${chunkProg.done + 1} / ${chunkProg.total}…`
              : '正在上傳並轉譯，視音檔長度約需數十秒到數分鐘…'}
          </Text>
        )}
        {phase === 'done' && (
          <View>
            {!!mappedSummary && <Text style={styles.placeholder}>✓ {mappedSummary}{'\n'}</Text>}
            {!!transcript && <Text style={styles.transcript}>{transcript}</Text>}
          </View>
        )}
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
        {phase === 'attendees' && (
          <View style={{ width: '100%', paddingHorizontal: 20, gap: 10 }}>
            <Pressable
              style={({ pressed }) => [styles.primaryButton, pressed && { opacity: 0.85 }]}
              onPress={onConfirmAttendees}
            >
              <Text style={styles.primaryLabel}>
                繼續轉譯 ({selectedIds.size} 位)
              </Text>
              <Feather name="chevron-right" size={16} color={Color.paper} />
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.outlineButton, pressed && { opacity: 0.6 }]}
              onPress={() => { setSelectedIds(new Set()); onConfirmAttendees(); }}
            >
              <Text style={styles.outlineLabel}>跳過聲紋對應</Text>
            </Pressable>
          </View>
        )}
        {phase === 'transcribing' && (
          <View style={[styles.recButton, { opacity: 0.5 }]}>
            <Feather name="loader" size={28} color={Color.paper} />
          </View>
        )}
        {phase === 'done' && (
          <View style={{ width: '100%', paddingHorizontal: 20, gap: 10 }}>
            <Pressable
              style={({ pressed }) => [styles.primaryButton, pressed && { opacity: 0.85 }]}
              onPress={onSummarize}
            >
              <Text style={styles.primaryLabel}>整理會議記錄</Text>
              <Feather name="chevron-right" size={16} color={Color.paper} />
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.outlineButton, pressed && { opacity: 0.6 }]}
              onPress={onReset}
            >
              <Text style={styles.outlineLabel}>新錄音</Text>
            </Pressable>
          </View>
        )}
        {phase === 'error' && (
          <Pressable
            style={({ pressed }) => [styles.outlineButton, pressed && { opacity: 0.6 }]}
            onPress={onReset}
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
  bodyInner: { padding: 26, paddingBottom: 16 },
  placeholder: { fontSize: 13, color: Color.inkMuted, lineHeight: 20 },
  transcript: { fontSize: 16, color: Color.ink, lineHeight: 26 },
  error: { fontSize: 14, color: '#a00', lineHeight: 22 },
  bottom: { alignItems: 'center', paddingBottom: 44, paddingTop: 12 },
  recButton: {
    width: 78, height: 78, borderRadius: 39, backgroundColor: Color.ink,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.4, shadowRadius: 40, elevation: 16,
  },
  stopSquare: { width: 22, height: 22, borderRadius: 6, backgroundColor: Color.paper },
  primaryButton: {
    paddingHorizontal: 24, paddingVertical: 18,
    borderRadius: Radius.md, backgroundColor: Color.ink,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  primaryLabel: { color: Color.paper, fontSize: 16, fontWeight: '600', letterSpacing: -0.2 },
  outlineButton: {
    paddingHorizontal: 24, paddingVertical: 16,
    borderRadius: Radius.md, borderWidth: StyleSheet.hairlineWidth,
    borderColor: Color.hairline, alignItems: 'center',
  },
  outlineLabel: { color: Color.ink, fontSize: 15, fontWeight: '500', letterSpacing: -0.15 },
  memberChip: {
    paddingHorizontal: 16, paddingVertical: 12,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth, borderColor: Color.hairline,
    backgroundColor: Color.paper,
  },
  memberChipActive: { backgroundColor: Color.ink, borderColor: Color.ink },
  memberChipLabel: { fontSize: 15, color: Color.ink, fontWeight: '500' },
  memberChipLabelActive: { color: Color.paper, fontWeight: '600' },
});
