// 設定頁
//   STT 永遠 OpenAI Whisper（部門 Ollama 端點不提供 STT）
//   LLM 可切換 OpenAI 雲端 / 本地 Ollama

import { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Color, FontFamily, Radius } from '../theme/tokens';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  Settings,
} from '../storage/settings';
import { deleteAllMeetings } from '../storage/db';
import { RootStackParamList } from '../navigation/AppNavigator';
import { FEATURES, HAS_MANAGED_PROXY, MANAGED_PROXY_TOKEN, MANAGED_PROXY_URL } from '../config/features';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

export default function SettingsView({ navigation }: Props) {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [testing, setTesting] = useState<'idle' | 'running' | 'ok' | 'fail'>('idle');
  const [testMsg, setTestMsg] = useState('');

  const testConnection = async () => {
    setTesting('running');
    setTestMsg('');
    const managed = s.keySource === 'managed';
    try {
      const url = managed
        ? `${MANAGED_PROXY_URL}/v1/models`
        : 'https://api.openai.com/v1/models';
      const token = managed ? MANAGED_PROXY_TOKEN : s.openaiApiKey;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setTesting('fail');
        setTestMsg(`HTTP ${res.status}：${await res.text()}`.slice(0, 200));
        return;
      }
      const data = await res.json();
      setTesting('ok');
      setTestMsg(`✓ 連線成功，可用模型 ${data.data?.length ?? '?'} 個`);
    } catch (e: any) {
      setTesting('fail');
      setTestMsg(`✗ ${e.message ?? e}`);
    }
  };

  useEffect(() => {
    loadSettings().then((v) => {
      // 公開版沒有本地 Ollama，強制走 OpenAI，避免讀到舊的 'local' 值卡住
      setS(FEATURES.localOllamaMode ? v : { ...v, mode: 'openai' });
      setLoaded(true);
    });
  }, []);

  const update = <K extends keyof Settings>(k: K, v: Settings[K]) =>
    setS((prev) => ({ ...prev, [k]: v }));

  const onSave = async () => {
    await saveSettings(s);
    navigation.goBack();
  };

  if (!loaded) return <View style={styles.root} />;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.masthead}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
          <Text style={styles.mastheadText}>← 返回</Text>
        </Pressable>
        <Text style={styles.mastheadText}>§ 設定</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* key 來源：內建額度 vs 自己的 key。只有設好 proxy 才給選 */}
        <Text style={styles.heading}>轉錄服務</Text>
        {HAS_MANAGED_PROXY && (
          <>
            <View style={styles.segment}>
              <ModeButton
                label="內建（免設定）"
                active={s.keySource === 'managed'}
                onPress={() => update('keySource', 'managed')}
              />
              <ModeButton
                label="自己的 API Key"
                active={s.keySource === 'own'}
                onPress={() => update('keySource', 'own')}
              />
            </View>
            <Text style={styles.note}>
              「內建」用 app 提供的額度，免填 key；「自己的 API Key」直接走你自己的 OpenAI 帳號。
            </Text>
          </>
        )}
        {s.keySource !== 'managed' && (
          <Field
            label="OpenAI API Key"
            value={s.openaiApiKey}
            onChangeText={(v) => update('openaiApiKey', v)}
            placeholder="sk-..."
            secureTextEntry
          />
        )}
        <Field
          label="Whisper 模型"
          value={s.openaiTranscriptionModel}
          onChangeText={(v) => update('openaiTranscriptionModel', v)}
          placeholder="whisper-1"
        />
        <Text style={styles.note}>
          想自動標講者就改 `gpt-4o-transcribe-diarize`（同 OpenAI 端點，會多 [speaker_0]/[speaker_1] 標籤）
        </Text>

        <Pressable
          style={({ pressed }) => [styles.testButton, pressed && { opacity: 0.7 }]}
          onPress={() => {
            if (s.keySource !== 'managed' && !s.openaiApiKey) {
              setTesting('fail');
              setTestMsg('請先填 API Key');
              return;
            }
            if (testing !== 'running') testConnection();
          }}
        >
          <Text style={styles.testLabel}>
            {testing === 'running' ? '⏳ 測試中…' : '🔌 測試連線（從 iPhone 打 OpenAI）'}
          </Text>
        </Pressable>
        {!!testMsg && (
          <Text style={[styles.testMsg, testing === 'fail' && { color: '#a00' }]}>
            {testMsg}
          </Text>
        )}

        {/* LLM 模式選擇 — 公開版只露 OpenAI 雲端 */}
        <Text style={styles.heading}>LLM 來源（會議記錄整理）</Text>
        {FEATURES.localOllamaMode && (
          <View style={styles.segment}>
            <ModeButton label="OpenAI GPT" active={s.mode === 'openai'} onPress={() => update('mode', 'openai')} />
            <ModeButton label="本地 Ollama" active={s.mode === 'local'} onPress={() => update('mode', 'local')} />
          </View>
        )}

        {s.mode === 'openai' || !FEATURES.localOllamaMode ? (
          <Field
            label="GPT 模型"
            value={s.openaiChatModel}
            onChangeText={(v) => update('openaiChatModel', v)}
            placeholder="gpt-4.1"
          />
        ) : (
          <>
            <Field
              label="Ollama URL"
              value={s.llmUrl}
              onChangeText={(v) => update('llmUrl', v)}
              placeholder="https://xxx.ngrok.io/v1"
              keyboardType="url"
            />
            <Field
              label="使用者名稱"
              value={s.username}
              onChangeText={(v) => update('username', v)}
            />
            <Field
              label="密碼"
              value={s.password}
              onChangeText={(v) => update('password', v)}
              secureTextEntry
            />
            <Field
              label="模型名"
              value={s.model}
              onChangeText={(v) => update('model', v)}
              placeholder="gpt-oss"
            />
          </>
        )}

        <Text style={styles.heading}>共用</Text>
        <Field
          label="語言"
          value={s.language}
          onChangeText={(v) => update('language', (v as Settings['language']) || 'zh')}
          placeholder="zh / en / auto"
        />

        <Pressable style={styles.saveButton} onPress={onSave}>
          <Text style={styles.saveLabel}>儲存</Text>
        </Pressable>

        <Text style={styles.heading}>成員 / 聲紋</Text>
        <Pressable
          style={({ pressed }) => [styles.linkButton, pressed && { opacity: 0.6 }]}
          onPress={() => navigation.navigate('Members')}
        >
          <Text style={styles.linkLabel}>管理成員（聲紋註冊）→</Text>
        </Pressable>

        {FEATURES.realtimeStreaming && (
          <>
            <Text style={styles.heading}>實驗</Text>
            <Pressable
              style={({ pressed }) => [styles.linkButton, pressed && { opacity: 0.6 }]}
              onPress={() => navigation.navigate('Realtime')}
            >
              <Text style={styles.linkLabel}>Realtime 模式（WebSocket 串流）→</Text>
            </Pressable>
          </>
        )}

        <Text style={styles.heading}>危險區</Text>
        <Pressable
          style={({ pressed }) => [styles.dangerButton, pressed && { opacity: 0.6 }]}
          onPress={() => {
            Alert.alert('清除所有會議資料？', '不可復原（音檔不會刪，只刪 DB 紀錄）。', [
              { text: '取消', style: 'cancel' },
              {
                text: '清除',
                style: 'destructive',
                onPress: async () => {
                  await deleteAllMeetings();
                  Alert.alert('已清除');
                },
              },
            ]);
          }}
        >
          <Text style={styles.dangerLabel}>清除所有會議資料</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function ModeButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={[styles.segmentButton, active && styles.segmentButtonActive]}
      onPress={onPress}
    >
      <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>{label}</Text>
    </Pressable>
  );
}

function Field(props: { label: string } & TextInputProps) {
  const { label, ...rest } = props;
  return (
    <View style={fieldStyles.field}>
      <Text style={fieldStyles.label}>{label}</Text>
      <TextInput
        style={fieldStyles.input}
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor={Color.inkFaint}
        {...rest}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Color.canvas },
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
  scroll: { paddingHorizontal: 20, paddingBottom: 60, gap: 14 },
  heading: {
    fontFamily: FontFamily.mono,
    fontSize: 10,
    letterSpacing: 1.5,
    color: Color.inkMuted,
    textTransform: 'uppercase',
    marginTop: 8,
  },
  note: { fontSize: 12, color: Color.inkMuted, lineHeight: 18, marginTop: -6 },
  segment: {
    flexDirection: 'row',
    backgroundColor: Color.paper,
    borderRadius: Radius.sm,
    padding: 4,
    gap: 4,
  },
  segmentButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: Radius.sm - 4,
  },
  segmentButtonActive: { backgroundColor: Color.ink },
  segmentLabel: { fontSize: 13, fontWeight: '500', color: Color.inkMuted },
  segmentLabelActive: { color: Color.paper, fontWeight: '600' },
  saveButton: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 18,
    borderRadius: Radius.md,
    backgroundColor: Color.ink,
    alignItems: 'center',
  },
  saveLabel: { color: Color.paper, fontSize: 16, fontWeight: '600', letterSpacing: -0.2 },
  testButton: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: Radius.sm,
    backgroundColor: Color.ink,
    alignItems: 'center',
  },
  testLabel: { fontSize: 14, color: Color.paper, fontWeight: '600' },
  testMsg: { fontSize: 12, color: Color.inkMuted, lineHeight: 18 },
  dangerButton: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#a00',
    alignItems: 'center',
  },
  dangerLabel: { fontSize: 14, color: '#a00', fontWeight: '500' },
  linkButton: {
    backgroundColor: Color.paper,
    borderRadius: Radius.sm,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  linkLabel: { fontSize: 15, color: Color.ink, fontWeight: '500' },
});

const fieldStyles = StyleSheet.create({
  field: {
    backgroundColor: Color.paper,
    borderRadius: Radius.sm,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  label: {
    fontFamily: FontFamily.mono,
    fontSize: 9,
    letterSpacing: 1.5,
    color: Color.inkMuted,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  input: { fontSize: 15, color: Color.ink, paddingVertical: 4 },
});
