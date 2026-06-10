// NotesView — 兩種入口：
//   (a) 帶 meetingId 進來：從 DB 載入；若已有 notes 直接顯示，沒有就生成 + 更新
//   (b) 帶 transcript 進來：生成 notes，但不寫 DB

import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { SimpleMarkdown } from '../components/SimpleMarkdown';
import { LLMClient, TokenUsage } from '../llm/client';
import { loadSettings, Mode } from '../storage/settings';
import { getMeeting, updateMeeting } from '../storage/db';
import { Color, FontFamily, Radius } from '../theme/tokens';
import { RootStackParamList } from '../navigation/AppNavigator';
import { FEATURES } from '../config/features';

type Props = NativeStackScreenProps<RootStackParamList, 'Notes'>;
type Phase = 'loading' | 'generating' | 'done' | 'error';

export default function NotesView({ navigation, route }: Props) {
  const { transcript: paramTranscript, meetingId } = route.params || {};
  const [phase, setPhase] = useState<Phase>('loading');
  const [transcript, setTranscript] = useState(paramTranscript ?? '');
  const [notes, setNotes] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [audioPath, setAudioPath] = useState<string | null>(null);
  const [usage, setUsage] = useState<TokenUsage | null>(null);
  // 比對另一個 LLM
  const [altMode, setAltMode] = useState<Mode | null>(null);
  const [altNotes, setAltNotes] = useState('');
  const [altLoading, setAltLoading] = useState(false);
  const [altError, setAltError] = useState('');
  const [altUsage, setAltUsage] = useState<TokenUsage | null>(null);

  useEffect(() => {
    (async () => {
      let trans = paramTranscript ?? '';
      if (meetingId != null) {
        const m = await getMeeting(meetingId);
        if (!m) {
          setError('找不到會議紀錄');
          setPhase('error');
          return;
        }
        trans = m.transcript ?? '';
        setTranscript(trans);
        setTitle(m.title ?? '');
        setAudioPath(m.audio_path ?? null);
        if (m.notes) {
          setNotes(m.notes);
          setPhase('done');
          return;
        }
      }
      if (!trans) {
        setError('沒有逐字稿可以整理');
        setPhase('error');
        return;
      }
      await generate(trans);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramTranscript, meetingId]);

  const generate = async (trans: string) => {
    setPhase('generating');
    try {
      const s = await loadSettings();
      const client = new LLMClient(s);
      const out = await client.generateMeetingNotes(trans);
      setNotes(out.text);
      setUsage(out.usage);
      setPhase('done');
      if (meetingId != null) await updateMeeting(meetingId, { notes: out.text });
    } catch (e: any) {
      setError(`整理失敗：${e.message ?? e}`);
      setPhase('error');
    }
  };

  const onTitleBlur = async () => {
    if (meetingId != null) await updateMeeting(meetingId, { title });
  };

  const onShare = async () => {
    try {
      const header = title ? `# ${title}\n\n` : '';
      await Share.share({ message: header + notes });
    } catch {}
  };

  const onRegenerate = () => {
    setAltMode(null);
    setAltNotes('');
    setAltError('');
    setAltUsage(null);
    setUsage(null);
    if (transcript) generate(transcript);
  };

  const onCompare = async () => {
    if (!transcript) return;
    setAltError('');
    setAltNotes('');
    setAltUsage(null);
    const s = await loadSettings();
    const other: Mode = s.mode === 'openai' ? 'local' : 'openai';
    if (other === 'openai' && !s.openaiApiKey) {
      setAltMode(other);
      setAltError('要切到 OpenAI 比對需先填 API Key');
      return;
    }
    if (other === 'local' && (!s.llmUrl || !s.username)) {
      setAltMode(other);
      setAltError('要切到 Ollama 比對需先填 Ollama URL / 帳密');
      return;
    }
    setAltMode(other);
    setAltLoading(true);
    try {
      const client = new LLMClient({ ...s, mode: other });
      const out = await client.generateMeetingNotes(transcript);
      setAltNotes(out.text);
      setAltUsage(out.usage);
    } catch (e: any) {
      setAltError(`${other} 整理失敗：${e.message ?? e}`);
    } finally {
      setAltLoading(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.masthead}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
          <Text style={styles.mastheadText}>← 返回</Text>
        </Pressable>
        <Text style={styles.mastheadText}>§ 會議記錄</Text>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyInner}>
        {(phase === 'loading' || phase === 'generating') && (
          <Text style={styles.placeholder}>
            {phase === 'loading' ? '載入中…' : '正在用 LLM 整理會議記錄，視逐字稿長度約需 10–60 秒…'}
          </Text>
        )}
        {phase === 'error' && <Text style={styles.error}>{error}</Text>}
        {phase === 'done' && (
          <View>
            {meetingId != null && (
              <TextInput
                style={styles.titleInput}
                value={title}
                onChangeText={setTitle}
                onBlur={onTitleBlur}
                placeholder="無標題（點此編輯）"
                placeholderTextColor={Color.inkFaint}
                multiline
              />
            )}
            {!!audioPath ? (
              <AudioPlayerControl uri={audioPath} />
            ) : (
              meetingId != null && (
                <Text style={styles.audioMissing}>（這筆會議沒有音檔，可能合併失敗或上傳模式無音檔）</Text>
              )
            )}
            {usage && <UsageBadge usage={usage} />}
            <SimpleMarkdown source={notes} />
            {altMode && (
              <>
                <Text style={styles.divider}>
                  — 比對：{altMode === 'openai' ? 'OpenAI GPT' : '本地 Ollama'} —
                </Text>
                {altLoading && (
                  <Text style={styles.placeholder}>跑 {altMode} 中…</Text>
                )}
                {!!altError && <Text style={styles.error}>{altError}</Text>}
                {altUsage && <UsageBadge usage={altUsage} />}
                {!altLoading && !!altNotes && <SimpleMarkdown source={altNotes} />}
              </>
            )}
            {!!transcript && (
              <>
                <Text style={styles.divider}>— 原始逐字稿 —</Text>
                <SimpleMarkdown source={transcript} />
              </>
            )}
          </View>
        )}
      </ScrollView>

      {phase === 'done' && (
        <View style={styles.bottom}>
          <View style={styles.buttonRow}>
            <Pressable
              style={({ pressed }) => [styles.outlineButton, pressed && { opacity: 0.6 }]}
              onPress={onRegenerate}
            >
              <Text style={styles.outlineLabel}>重新</Text>
            </Pressable>
            {FEATURES.localOllamaMode && (
              <Pressable
                style={({ pressed }) => [styles.outlineButton, pressed && { opacity: 0.6 }]}
                onPress={onCompare}
                disabled={altLoading}
              >
                <Text style={styles.outlineLabel}>{altLoading ? '比對中…' : '比對'}</Text>
              </Pressable>
            )}
            {meetingId != null && /\[speaker[_\s]?\w+\]/i.test(transcript) && (
              <Pressable
                style={({ pressed }) => [styles.outlineButton, pressed && { opacity: 0.6 }]}
                onPress={() => navigation.navigate('SpeakerMapping', { meetingId })}
              >
                <Text style={styles.outlineLabel}>對應講者</Text>
              </Pressable>
            )}
            <Pressable
              style={({ pressed }) => [styles.primaryButton, pressed && { opacity: 0.85 }]}
              onPress={onShare}
            >
              <Text style={styles.primaryLabel}>分享</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

function UsageBadge({ usage }: { usage: TokenUsage }) {
  const fmtNum = (n: number) =>
    n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  return (
    <View style={usageStyles.row}>
      <Text style={usageStyles.label}>
        {usage.model} · in {fmtNum(usage.input)} · out {fmtNum(usage.output)} · total {fmtNum(usage.total)} · {(usage.elapsedMs / 1000).toFixed(1)}s
      </Text>
    </View>
  );
}

const usageStyles = StyleSheet.create({
  row: {
    marginBottom: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: Color.canvas,
    borderRadius: Radius.sm,
    alignSelf: 'flex-start',
  },
  label: {
    fontFamily: FontFamily.mono,
    fontSize: 10,
    letterSpacing: 0.5,
    color: Color.inkMuted,
  },
});

function AudioPlayerControl({ uri }: { uri: string }) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);

  const fmt = (sec: number) => {
    const s = Math.max(0, Math.floor(sec || 0));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };

  const onExport = async () => {
    try {
      const Sharing = await import('expo-sharing');
      const can = await Sharing.isAvailableAsync();
      if (!can) return;
      await Sharing.shareAsync(uri, {
        mimeType: 'audio/wav',
        dialogTitle: '匯出會議音檔',
        UTI: 'com.microsoft.waveform-audio',
      });
    } catch {
      // ignore
    }
  };

  return (
    <View style={audioStyles.row}>
      <Pressable
        style={({ pressed }) => [audioStyles.bar, pressed && { opacity: 0.7 }]}
        onPress={() => {
          try {
            if (status.playing) player.pause();
            else player.play();
          } catch {
            // ignore
          }
        }}
      >
        <Feather
          name={status.playing ? 'pause' : 'play'}
          size={14}
          color={Color.ink}
        />
        <Text style={audioStyles.label}>
          {fmt(status.currentTime)} / {fmt(status.duration)}
        </Text>
      </Pressable>
      <Pressable
        style={({ pressed }) => [audioStyles.bar, pressed && { opacity: 0.7 }]}
        onPress={onExport}
      >
        <Feather name="share" size={14} color={Color.ink} />
        <Text style={audioStyles.label}>匯出</Text>
      </Pressable>
    </View>
  );
}

const audioStyles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: Color.canvas,
    borderRadius: Radius.sm,
  },
  label: {
    fontFamily: FontFamily.mono,
    fontSize: 11,
    letterSpacing: 1,
    color: Color.inkMuted,
    textTransform: 'uppercase',
  },
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Color.paper },
  masthead: {
    paddingHorizontal: 26,
    paddingTop: 60,
    paddingBottom: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  mastheadText: {
    fontFamily: FontFamily.mono,
    fontSize: 10,
    letterSpacing: 2,
    color: Color.inkMuted,
    textTransform: 'uppercase',
  },
  body: { flex: 1 },
  bodyInner: { padding: 26, paddingBottom: 24 },
  placeholder: { fontSize: 13, color: Color.inkMuted, lineHeight: 20 },
  error: { fontSize: 14, color: '#a00', lineHeight: 22 },
  titleInput: {
    fontSize: 22,
    fontWeight: '600',
    color: Color.ink,
    letterSpacing: -0.4,
    lineHeight: 30,
    marginBottom: 16,
    paddingVertical: 4,
    minHeight: 36,
  },
  divider: {
    marginTop: 32,
    marginBottom: 12,
    fontFamily: FontFamily.mono,
    fontSize: 10,
    letterSpacing: 1.5,
    color: Color.inkMuted,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  transcript: { fontSize: 13, color: Color.inkMuted, lineHeight: 21 },
  audioMissing: {
    fontSize: 12, color: Color.inkFaint, marginBottom: 16, fontStyle: 'italic',
  },
  bottom: { paddingHorizontal: 20, paddingBottom: 44, paddingTop: 12 },
  buttonRow: { flexDirection: 'row', gap: 10 },
  primaryButton: {
    flex: 2,
    paddingHorizontal: 24,
    paddingVertical: 18,
    borderRadius: Radius.md,
    backgroundColor: Color.ink,
    alignItems: 'center',
  },
  primaryLabel: { color: Color.paper, fontSize: 16, fontWeight: '600', letterSpacing: -0.2 },
  outlineButton: {
    flex: 1,
    paddingHorizontal: 18,
    paddingVertical: 18,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Color.hairline,
    alignItems: 'center',
  },
  outlineLabel: { color: Color.ink, fontSize: 14, fontWeight: '500', letterSpacing: -0.15 },
});
