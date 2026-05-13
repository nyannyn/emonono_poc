// MembersView — 成員 / 聲紋列表

import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { deleteMember, listMembers, Member } from '../storage/db';
import { Color, FontFamily, Radius } from '../theme/tokens';
import { RootStackParamList } from '../navigation/AppNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Members'>;

export default function MembersView({ navigation }: Props) {
  const [items, setItems] = useState<Member[]>([]);

  useFocusEffect(
    useCallback(() => {
      listMembers().then(setItems);
    }, []),
  );

  const onLongPress = (m: Member) => {
    Alert.alert('刪除成員？', m.name, [
      { text: '取消', style: 'cancel' },
      {
        text: '刪除',
        style: 'destructive',
        onPress: async () => {
          await deleteMember(m.id);
          setItems(await listMembers());
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
        <Text style={styles.mastheadText}>§ 成員 · {items.length}</Text>
      </View>

      <FlatList
        data={items}
        keyExtractor={(m) => String(m.id)}
        contentContainerStyle={styles.listInner}
        ListEmptyComponent={<Text style={styles.empty}>還沒有成員。下方按鈕新增第一位。</Text>}
        renderItem={({ item }) => {
          let count = 0;
          try { count = JSON.parse(item.voiceprint_paths ?? '[]').length; } catch {}
          return (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
              onLongPress={() => onLongPress(item)}
            >
              <Text style={styles.rowName}>{item.name}</Text>
              <Text style={styles.rowMeta}>{count} 段聲紋</Text>
            </Pressable>
          );
        }}
      />

      <View style={styles.bottom}>
        <Pressable
          style={({ pressed }) => [styles.primaryButton, pressed && { opacity: 0.85 }]}
          onPress={() => navigation.navigate('VoiceprintRegister')}
        >
          <Text style={styles.primaryLabel}>＋ 新增成員（錄 5 句聲紋）</Text>
        </Pressable>
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
  listInner: { padding: 20, gap: 10 },
  empty: { fontSize: 13, color: Color.inkMuted, lineHeight: 20, padding: 20 },
  row: {
    backgroundColor: Color.paper, borderRadius: Radius.sm,
    padding: 18, gap: 4,
  },
  rowName: { fontSize: 16, color: Color.ink, fontWeight: '500' },
  rowMeta: {
    fontFamily: FontFamily.mono, fontSize: 9, letterSpacing: 1,
    color: Color.inkFaint, textTransform: 'uppercase',
  },
  bottom: { paddingHorizontal: 20, paddingBottom: 44, paddingTop: 12 },
  primaryButton: {
    paddingHorizontal: 24, paddingVertical: 18,
    borderRadius: Radius.md, backgroundColor: Color.ink, alignItems: 'center',
  },
  primaryLabel: { color: Color.paper, fontSize: 16, fontWeight: '600', letterSpacing: -0.2 },
});
