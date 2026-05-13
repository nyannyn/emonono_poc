// 極簡 Markdown 渲染器 — 處理 # / ## / ### 標題、- / * / 1. 列表、---、**bold**、`code`、空行
// 為什麼自寫：react-native-markdown-display 套件 npm tarball 缺檔；其它替代方案要拉 marked.js 等大依賴。
// 我們會議記錄輸出格式固定簡單，自寫 60 行夠用。

import { Fragment, ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Color, FontFamily, Radius } from '../theme/tokens';

export function SimpleMarkdown({ source }: { source: string }) {
  const lines = source.split(/\r?\n/);
  return (
    <View>
      {lines.map((line, i) => renderLine(line, i))}
    </View>
  );
}

function renderLine(line: string, key: number): ReactNode {
  // [speaker_0] / [SPEAKER_1] 之類 diarize 標籤 — 視為 H4 樣式
  const speakerMatch = line.match(/^\[(speaker[_\s]?\w+|SPEAKER[_\s]?\w+)\]$/i);
  if (speakerMatch) {
    return <Text key={key} style={styles.speaker}>▸ {speakerMatch[1].replace(/_/g, ' ').toUpperCase()}</Text>;
  }
  if (/^###\s+/.test(line)) {
    return <Text key={key} style={styles.h3}>{stripInlineMarkers(line.replace(/^###\s+/, ''))}</Text>;
  }
  if (/^##\s+/.test(line)) {
    return <Text key={key} style={styles.h2}>{stripInlineMarkers(line.replace(/^##\s+/, ''))}</Text>;
  }
  if (/^#\s+/.test(line)) {
    return <Text key={key} style={styles.h1}>{stripInlineMarkers(line.replace(/^#\s+/, ''))}</Text>;
  }
  if (/^[-*]\s+/.test(line)) {
    const content = line.replace(/^[-*]\s+/, '');
    return (
      <View key={key} style={styles.bulletRow}>
        <Text style={styles.bullet}>•</Text>
        <Text style={styles.bulletText}>{renderInline(content)}</Text>
      </View>
    );
  }
  if (/^\d+\.\s+/.test(line)) {
    const num = line.match(/^(\d+)\./)?.[1];
    const content = line.replace(/^\d+\.\s+/, '');
    return (
      <View key={key} style={styles.bulletRow}>
        <Text style={styles.bullet}>{num}.</Text>
        <Text style={styles.bulletText}>{renderInline(content)}</Text>
      </View>
    );
  }
  if (/^---+$/.test(line)) return <View key={key} style={styles.hr} />;
  if (/^\s*$/.test(line)) return <View key={key} style={styles.spacer} />;
  if (/^>\s+/.test(line)) {
    return (
      <View key={key} style={styles.blockquote}>
        <Text style={styles.p}>{renderInline(line.replace(/^>\s+/, ''))}</Text>
      </View>
    );
  }
  return <Text key={key} style={styles.p}>{renderInline(line)}</Text>;
}

function stripInlineMarkers(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`(.+?)`/g, '$1');
}

// inline: **bold** + `code`
function renderInline(s: string): ReactNode {
  const parts: ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  const re = /\*\*(.+?)\*\*|`(.+?)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (m.index > cursor) parts.push(<Fragment key={key++}>{s.slice(cursor, m.index)}</Fragment>);
    if (m[1]) parts.push(<Text key={key++} style={styles.bold}>{m[1]}</Text>);
    else if (m[2]) parts.push(<Text key={key++} style={styles.code}>{m[2]}</Text>);
    cursor = m.index + m[0].length;
  }
  if (cursor < s.length) parts.push(<Fragment key={key++}>{s.slice(cursor)}</Fragment>);
  return parts;
}

const styles = StyleSheet.create({
  h1: {
    fontSize: 26, fontWeight: '700', color: Color.ink,
    letterSpacing: -0.6, marginTop: 24, marginBottom: 12, lineHeight: 32,
  },
  h2: {
    fontSize: 20, fontWeight: '600', color: Color.ink,
    letterSpacing: -0.4, marginTop: 22, marginBottom: 10, lineHeight: 26,
  },
  h3: {
    fontSize: 17, fontWeight: '600', color: Color.ink,
    letterSpacing: -0.3, marginTop: 20, marginBottom: 8, lineHeight: 24,
  },
  p: { fontSize: 15, color: Color.ink, lineHeight: 24, marginBottom: 6 },
  bulletRow: { flexDirection: 'row', marginBottom: 4, paddingLeft: 4 },
  bullet: {
    width: 22, fontSize: 15, color: Color.inkMuted, lineHeight: 24,
  },
  bulletText: { flex: 1, fontSize: 15, color: Color.ink, lineHeight: 24 },
  hr: { height: 1, backgroundColor: Color.hairline, marginVertical: 16 },
  spacer: { height: 8 },
  bold: { fontWeight: '700', color: Color.ink },
  code: {
    fontFamily: FontFamily.mono, fontSize: 13,
    backgroundColor: Color.canvasDeep, paddingHorizontal: 4, borderRadius: 4,
  },
  speaker: {
    fontFamily: FontFamily.mono,
    fontSize: 11,
    letterSpacing: 1.5,
    color: Color.ink,
    textTransform: 'uppercase',
    marginTop: 14,
    marginBottom: 4,
  },
  blockquote: {
    borderLeftWidth: 3, borderLeftColor: Color.inkFaint,
    paddingLeft: 12, paddingVertical: 4, marginBottom: 12,
    backgroundColor: Color.canvas, borderRadius: Radius.sm / 4,
  },
});
