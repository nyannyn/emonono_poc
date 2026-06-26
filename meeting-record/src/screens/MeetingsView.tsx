// MeetingsView — 歷史會議列表

import { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { deleteMeeting, listMeetings, Meeting } from '../storage/db';
import { Color, FontFamily, Radius } from '../theme/tokens';
import { RootStackParamList } from '../navigation/AppNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Meetings'>;

export default function MeetingsView({ navigation }: Props) {
  const [items, setItems] = useState<Meeting[]>([]);
  const [query, setQuery] = useState('');

  useFocusEffect(
    useCallback(() => {
      listMeetings().then(setItems);
    }, []),
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((m) => {
      return (
        (m.title ?? '').toLowerCase().includes(q) ||
        (m.transcript ?? '').toLowerCase().includes(q) ||
        (m.notes ?? '').toLowerCase().includes(q)
      );
    });
  }, [items, query]);

  const onLongPress = (m: Meeting) => {
    Alert.alert('刪除會議？', m.title || formatDate(m.started_at), [
      { text: '取消', style: 'cancel' },
      {
        text: '刪除',
        style: 'destructive',
        onPress: async () => {
          await deleteMeeting(m.id);
          setItems(await listMeetings());
        },
      },
    ]);
  };

  return (
    <View style={styles.root}>
      <View style={styles.masthead}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
          <Text style={styles.mastheadText}>← 返回</Text>
        </Pressable>
        <Text style={styles.mastheadText}>
          § 歷史 · {filtered.length}{query ? ` / ${items.length}` : ''}
        </Text>
      </View>

      <View style={styles.searchWrap}>
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="搜尋標題 / 逐字稿 / 會議記錄"
          placeholderTextColor={Color.inkFaint}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(m) => String(m.id)}
        contentContainerStyle={styles.listInner}
        ListEmptyComponent={<Text style={styles.empty}>還沒有會議。回首頁開始錄音或上傳音檔。</Text>}
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
            onPress={() =>
              item.transcript == null && item.audio_path
                ? navigation.navigate('Recording', { retryMeetingId: item.id })
                : navigation.navigate('Notes', { meetingId: item.id })
            }
            onLongPress={() => onLongPress(item)}
          >
            <Text style={styles.rowDate}>{formatDate(item.started_at)}</Text>
            <Text style={styles.rowTitle} numberOfLines={2}>
              {item.title || preview(item)}
            </Text>
            <Text style={styles.rowMeta}>
              {item.notes
                ? '✓ 已整理'
                : item.transcript
                ? '逐字稿'
                : item.audio_path
                ? '待轉譯 · 點擊重新轉譯'
                : '空'}
              {item.duration_sec ? `  ·  ${formatDuration(item.duration_sec)}` : ''}
              {item.mode ? `  ·  ${item.mode}` : ''}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  const M = String(d.getMonth() + 1).padStart(2, '0');
  const D = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${M}/${D} ${h}:${m}`;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

function preview(m: Meeting): string {
  const t = (m.notes || m.transcript || '').replace(/\s+/g, ' ').trim();
  return t.slice(0, 60) || '（無內容）';
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
  listInner: { padding: 20, gap: 10, paddingBottom: 60 },
  empty: { fontSize: 13, color: Color.inkMuted, lineHeight: 20, padding: 20 },
  row: {
    backgroundColor: Color.paper,
    borderRadius: Radius.sm,
    padding: 18,
    gap: 6,
  },
  rowDate: {
    fontFamily: FontFamily.mono,
    fontSize: 9,
    letterSpacing: 1.5,
    color: Color.inkMuted,
    textTransform: 'uppercase',
  },
  rowTitle: { fontSize: 15, color: Color.ink, fontWeight: '500', lineHeight: 22 },
  rowMeta: {
    fontFamily: FontFamily.mono,
    fontSize: 9,
    letterSpacing: 1,
    color: Color.inkFaint,
    textTransform: 'uppercase',
  },
  searchWrap: { paddingHorizontal: 20, paddingBottom: 12 },
  searchInput: {
    backgroundColor: Color.paper,
    borderRadius: Radius.sm,
    paddingHorizontal: 18,
    paddingVertical: 12,
    fontSize: 14,
    color: Color.ink,
  },
});
