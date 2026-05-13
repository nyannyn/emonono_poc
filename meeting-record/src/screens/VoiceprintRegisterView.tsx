// VoiceprintRegisterView — 5 句標準句註冊
// 翻譯自 _design/dailyworkweb/project/screens/voiceprint.jsx

import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { AudioModule, RecordingPresets, useAudioRecorder } from 'expo-audio';
import { Directory, File, Paths } from 'expo-file-system';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Color, FontFamily, Radius, VOICEPRINT_SENTENCES } from '../theme/tokens';
import { createMember } from '../storage/db';
import { RootStackParamList } from '../navigation/AppNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'VoiceprintRegister'>;

const WAV_OPTIONS = {
  ...RecordingPresets.LOW_QUALITY,
  extension: '.wav',
  sampleRate: 16000,
  numberOfChannels: 1,
  ios: {
    ...((RecordingPresets.LOW_QUALITY as any).ios ?? {}),
    extension: '.wav',
    sampleRate: 16000,
    numberOfChannels: 1,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
    outputFormat: 'lpcm',
  },
} as any;

export default function VoiceprintRegisterView({ navigation }: Props) {
  const recorder = useAudioRecorder(WAV_OPTIONS);
  const [idx, setIdx] = useState(0);
  const [recording, setRecording] = useState(false);
  const [paths, setPaths] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [phase, setPhase] = useState<'recording' | 'naming' | 'saving'>('recording');
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const total = VOICEPRINT_SENTENCES.length;

  useEffect(() => () => {
    if (elapsedRef.current) clearInterval(elapsedRef.current);
    try {
      if (recorder.isRecording) recorder.stop().catch(() => {});
    } catch {
      // recorder shared object 可能已被釋放
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const moveTo = (sourceUri: string, slot: number): string => {
    const dir = new Directory(Paths.document, 'voiceprints');
    if (!dir.exists) dir.create({ intermediates: true });
    const dest = new File(dir, `vp_${Date.now()}_${slot}.wav`);
    new File(sourceUri).move(dest);
    return dest.uri;
  };

  const onToggleRecord = async () => {
    if (recording) {
      // stop + save current
      if (elapsedRef.current) clearInterval(elapsedRef.current);
      await recorder.stop();
      const src = recorder.uri;
      if (src) {
        const dest = moveTo(src, idx);
        const next = [...paths, dest];
        setPaths(next);
        if (idx + 1 >= total) {
          setPhase('naming');
        } else {
          setIdx(idx + 1);
        }
      }
      setRecording(false);
      setElapsed(0);
    } else {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('麥克風權限被拒');
        return;
      }
      await AudioModule.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
      setElapsed(0);
      elapsedRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    }
  };

  const onSave = async () => {
    if (!name.trim()) {
      Alert.alert('請輸入姓名');
      return;
    }
    setPhase('saving');
    await createMember(name.trim(), paths);
    navigation.goBack();
  };

  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  return (
    <View style={styles.root}>
      <View style={styles.masthead}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
          <Text style={styles.mastheadText}>← 返回</Text>
        </Pressable>
        <Text style={styles.mastheadText}>
          {phase === 'naming' ? '§ 命名' : `聲紋 · ${String(idx + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`}
        </Text>
      </View>

      {phase === 'recording' && (
        <>
          <View style={styles.intro}>
            <Text style={styles.introCaption}>§ 請唸出</Text>
          </View>
          <View style={styles.cardWrap}>
            <View style={styles.card}>
              <Text style={styles.cardSentence}>{VOICEPRINT_SENTENCES[idx]}</Text>
            </View>
          </View>
          <View style={{ flex: 1 }} />
          <View style={styles.recordArea}>
            <Pressable
              style={({ pressed }) => [styles.recButton, pressed && { opacity: 0.85 }]}
              onPress={onToggleRecord}
            >
              {recording ? (
                <View style={styles.stopSquare} />
              ) : (
                <Feather name="mic" size={28} color={Color.paper} />
              )}
            </Pressable>
            <Text style={styles.recHint}>
              {recording ? `REC · ${fmt(elapsed)}` : '按一下開始'}
            </Text>
          </View>
        </>
      )}

      {phase === 'naming' && (
        <View style={styles.namingArea}>
          <Text style={styles.namingHint}>5 句都錄好了。請輸入這位成員的名字：</Text>
          <TextInput
            style={styles.nameInput}
            value={name}
            onChangeText={setName}
            placeholder="例如：Ava Chen"
            placeholderTextColor={Color.inkFaint}
            autoFocus
          />
          <Pressable
            style={({ pressed }) => [styles.saveButton, pressed && { opacity: 0.85 }]}
            onPress={onSave}
          >
            <Text style={styles.saveLabel}>儲存</Text>
          </Pressable>
        </View>
      )}
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
  intro: { paddingHorizontal: 26, paddingTop: 16 },
  introCaption: {
    fontFamily: FontFamily.mono, fontSize: 10, letterSpacing: 1.5,
    color: Color.inkMuted, textTransform: 'uppercase', marginBottom: 10,
  },
  cardWrap: { paddingHorizontal: 20, paddingTop: 16 },
  card: {
    backgroundColor: Color.paper, borderRadius: 32, padding: 36,
    shadowColor: '#000', shadowOffset: { width: 0, height: 24 },
    shadowOpacity: 0.15, shadowRadius: 48, elevation: 12,
  },
  cardSentence: { fontSize: 24, fontWeight: '500', lineHeight: 34, color: Color.ink, letterSpacing: -0.4 },
  recordArea: { alignItems: 'center', paddingBottom: 44, paddingTop: 4, gap: 10 },
  recButton: {
    width: 78, height: 78, borderRadius: 39, backgroundColor: Color.ink,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.4, shadowRadius: 40, elevation: 16,
  },
  stopSquare: { width: 22, height: 22, borderRadius: 6, backgroundColor: Color.paper },
  recHint: {
    fontFamily: FontFamily.mono, fontSize: 10, letterSpacing: 1.5,
    color: Color.inkMuted, textTransform: 'uppercase',
  },
  namingArea: { padding: 20, gap: 16 },
  namingHint: { fontSize: 14, color: Color.inkMuted, lineHeight: 22 },
  nameInput: {
    backgroundColor: Color.paper, borderRadius: Radius.sm,
    paddingHorizontal: 18, paddingVertical: 14,
    fontSize: 18, color: Color.ink,
  },
  saveButton: {
    paddingHorizontal: 24, paddingVertical: 18,
    borderRadius: Radius.md, backgroundColor: Color.ink, alignItems: 'center',
  },
  saveLabel: { color: Color.paper, fontSize: 16, fontWeight: '600', letterSpacing: -0.2 },
});
