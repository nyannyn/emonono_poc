// HomeView — Variation C「一問兩答」
// 翻譯自 _design/dailyworkweb/project/screens/variation-c.jsx
// 互動：開始錄音 → RecordingView；上傳音檔 → 暫不實作；右上 masthead 點一下 → SettingsView

import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import { Color, FontFamily, Radius } from '../theme/tokens';
import { RootStackParamList } from '../navigation/AppNavigator';
import { countMeetings, countMembers } from '../storage/db';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

export default function HomeView({ navigation }: Props) {
  const pulse = useRef(new Animated.Value(1)).current;
  const [count, setCount] = useState(0);
  const [memberCount, setMemberCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      countMeetings().then(setCount).catch(() => setCount(0));
      countMembers().then(setMemberCount).catch(() => setMemberCount(0));
    }, []),
  );
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.35,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <View style={styles.root}>
      {/* Masthead — 右側 04 · 23 點一下開設定（隱藏入口） */}
      <View style={styles.masthead}>
        <Text style={styles.mastheadText}>Minute</Text>
        <Pressable onPress={() => navigation.navigate('Settings')} hitSlop={10}>
          <Text style={styles.mastheadText}>04 · 23 ⚙</Text>
        </Pressable>
      </View>

      <View style={styles.lede}>
        <Text style={styles.greeting}>午安 Ava。</Text>
        <Text style={styles.hero}>{'要開始\n新會議嗎？'}</Text>
      </View>

      <View style={styles.spacer} />

      <View style={styles.buttons}>
        <Pressable
          style={({ pressed }) => [styles.primaryButton, pressed && styles.pressedSolid]}
          onPress={() => navigation.navigate('Live')}
        >
          <Text style={styles.primaryLabel}>開始錄音（即時字幕）</Text>
          <Feather name="mic" size={18} color={Color.paper} />
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.outlineButton, pressed && styles.pressedOutline]}
          onPress={async () => {
            const res = await DocumentPicker.getDocumentAsync({
              type: ['audio/*'],
              copyToCacheDirectory: true,
              multiple: false,
            });
            if (res.canceled || !res.assets?.[0]) return;
            navigation.navigate('Recording', { uploadedFileUri: res.assets[0].uri });
          }}
        >
          <Text style={styles.outlineLabel}>上傳音檔</Text>
          <Feather name="chevron-right" size={14} color={Color.ink} />
        </Pressable>
      </View>

      <View style={styles.footnote}>
        <Pressable
          onPress={() => navigation.navigate('Meetings')}
          hitSlop={10}
        >
          <Text style={styles.footnoteText}>§ 歷史 · {count}</Text>
        </Pressable>
        <Pressable
          onPress={() => navigation.navigate('Members')}
          hitSlop={10}
        >
          <Text style={styles.footnoteText}>成員 · {memberCount}</Text>
        </Pressable>
        <Animated.View style={[styles.dot, { opacity: pulse }]} />
      </View>
    </View>
  );
}

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
  lede: { paddingHorizontal: 26, paddingTop: 20 },
  greeting: { fontSize: 13, color: Color.inkMuted, marginBottom: 10 },
  hero: {
    fontSize: 34,
    fontWeight: '600',
    letterSpacing: -0.9,
    lineHeight: 39,
    color: Color.ink,
  },
  spacer: { flex: 1 },
  buttons: { paddingHorizontal: 20, paddingBottom: 14, gap: 10 },
  primaryButton: {
    paddingHorizontal: 24,
    paddingVertical: 18,
    borderRadius: Radius.md,
    backgroundColor: Color.ink,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  primaryLabel: { color: Color.paper, fontSize: 16, fontWeight: '600', letterSpacing: -0.2 },
  pressedSolid: { opacity: 0.85 },
  outlineButton: {
    paddingHorizontal: 24,
    paddingVertical: 18,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Color.hairline,
    backgroundColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  outlineLabel: { color: Color.ink, fontSize: 15, fontWeight: '500', letterSpacing: -0.15 },
  pressedOutline: { opacity: 0.6 },
  footnote: {
    paddingHorizontal: 26,
    paddingTop: 14,
    paddingBottom: 34,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  footnoteText: {
    fontFamily: FontFamily.mono,
    fontSize: 10,
    letterSpacing: 1.5,
    color: Color.inkMuted,
    textTransform: 'uppercase',
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Color.ink },
});
