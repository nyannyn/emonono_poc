// SpeakerMappingView — 人工把 [speaker_0] / [speaker_1] 對應到成員姓名

import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { getMeeting, listMembers, Meeting, Member, updateMeeting } from '../storage/db';
import { loadSettings, saveSettings } from '../storage/settings';
import { Color, FontFamily, Radius } from '../theme/tokens';
import { RootStackParamList } from '../navigation/AppNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'SpeakerMapping'>;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default function SpeakerMappingView({ navigation, route }: Props) {
  const { meetingId } = route.params;
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      const m = await getMeeting(meetingId);
      setMeeting(m);
      const ms = await listMembers();
      setMembers(ms);
      // 預填上次的 mapping（只填 current transcript 還有的 speaker tag、且該成員仍存在）
      const settings = await loadSettings();
      const memberNames = new Set(ms.map((x) => x.name));
      const prefilled: Record<string, string> = {};
      if (m?.transcript) {
        const re = /\[(speaker[_\s]?\w+)\]/gi;
        const seen = new Set<string>();
        let mm: RegExpExecArray | null;
        while ((mm = re.exec(m.transcript)) !== null) seen.add(mm[1]);
        for (const sp of seen) {
          const last = settings.lastSpeakerMapping?.[sp];
          if (last && memberNames.has(last)) prefilled[sp] = last;
        }
      }
      setMapping(prefilled);
    })();
  }, [meetingId]);

  const speakers = useMemo(() => {
    if (!meeting?.transcript) return [];
    const set = new Set<string>();
    const re = /\[(speaker[_\s]?\w+)\]/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(meeting.transcript)) !== null) set.add(m[1]);
    return Array.from(set);
  }, [meeting]);

  const previewFor = (speaker: string): string => {
    if (!meeting?.transcript) return '';
    const re = new RegExp(`\\[${escapeRegex(speaker)}\\]\\s*([^\\[]+)`, 'i');
    const m = meeting.transcript.match(re);
    return m ? m[1].trim().slice(0, 80) : '';
  };

  const onSave = async () => {
    if (!meeting) return;
    let text = meeting.transcript ?? '';
    for (const [speaker, name] of Object.entries(mapping)) {
      if (!name) continue;
      const re = new RegExp(`\\[${escapeRegex(speaker)}\\]`, 'gi');
      text = text.replace(re, `[${name}]`);
    }
    await updateMeeting(meeting.id, { transcript: text });
    // 把這次 mapping 累積進 settings.lastSpeakerMapping（保留先前其他 speaker 的紀錄）
    const settings = await loadSettings();
    const merged = { ...(settings.lastSpeakerMapping ?? {}) };
    for (const [sp, name] of Object.entries(mapping)) {
      if (name) merged[sp] = name;
    }
    await saveSettings({ ...settings, lastSpeakerMapping: merged });
    navigation.goBack();
  };

  const mappedCount = Object.values(mapping).filter(Boolean).length;

  return (
    <View style={styles.root}>
      <View style={styles.masthead}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
          <Text style={styles.mastheadText}>← 返回</Text>
        </Pressable>
        <Text style={styles.mastheadText}>§ 對應講者 · {mappedCount} / {speakers.length}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {speakers.length === 0 && (
          <Text style={styles.empty}>逐字稿沒有 [speaker_*] 標籤。請先用 gpt-4o-transcribe-diarize 跑過。</Text>
        )}
        {members.length === 0 && speakers.length > 0 && (
          <Text style={styles.empty}>還沒有成員。請先到「設定 → 管理成員」新增。</Text>
        )}
        {speakers.map((sp) => (
          <View key={sp} style={styles.block}>
            <Text style={styles.speakerTag}>▸ {sp.toUpperCase()}</Text>
            {!!previewFor(sp) && (
              <Text style={styles.preview} numberOfLines={2}>「{previewFor(sp)}…」</Text>
            )}
            <View style={styles.memberRow}>
              {members.map((m) => {
                const active = mapping[sp] === m.name;
                return (
                  <Pressable
                    key={m.id}
                    style={[styles.memberChip, active && styles.memberChipActive]}
                    onPress={() => setMapping({ ...mapping, [sp]: active ? '' : m.name })}
                  >
                    <Text style={[styles.memberChipLabel, active && styles.memberChipLabelActive]}>
                      {m.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>

      {speakers.length > 0 && members.length > 0 && (
        <View style={styles.bottom}>
          <Pressable
            style={({ pressed }) => [styles.primaryButton, pressed && { opacity: 0.85 }]}
            onPress={onSave}
            disabled={mappedCount === 0}
          >
            <Text style={styles.primaryLabel}>套用 ({mappedCount})</Text>
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
  body: { padding: 20, gap: 20, paddingBottom: 40 },
  empty: { fontSize: 13, color: Color.inkMuted, lineHeight: 20 },
  block: { backgroundColor: Color.paper, borderRadius: Radius.sm, padding: 18, gap: 10 },
  speakerTag: {
    fontFamily: FontFamily.mono, fontSize: 12, letterSpacing: 1.5,
    color: Color.ink, textTransform: 'uppercase',
  },
  preview: { fontSize: 13, color: Color.inkMuted, lineHeight: 20 },
  memberRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  memberChip: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth, borderColor: Color.hairline,
  },
  memberChipActive: { backgroundColor: Color.ink, borderColor: Color.ink },
  memberChipLabel: { fontSize: 13, color: Color.ink },
  memberChipLabelActive: { color: Color.paper, fontWeight: '600' },
  bottom: { paddingHorizontal: 20, paddingBottom: 44, paddingTop: 12 },
  primaryButton: {
    paddingHorizontal: 24, paddingVertical: 18,
    borderRadius: Radius.md, backgroundColor: Color.ink, alignItems: 'center',
  },
  primaryLabel: { color: Color.paper, fontSize: 16, fontWeight: '600', letterSpacing: -0.2 },
});
