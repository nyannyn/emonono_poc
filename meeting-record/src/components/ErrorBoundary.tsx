// 全域 ErrorBoundary：攔截 render 期間的例外，避免整個 app 白畫面只能強關。
// 非同步錯誤（fetch / Promise）各畫面已自行 try/catch；這裡專門接 render 例外。

import { Component, ErrorInfo, ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Color, FontFamily, Radius } from '../theme/tokens';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 留個 log 方便 dev build 抓問題
    console.error('ErrorBoundary 攔截到 render 例外：', error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.title}>畫面發生錯誤</Text>
          <Text style={styles.desc}>
            程式遇到未預期的問題。你的會議紀錄已保存在本機，重試通常即可恢復。
          </Text>
          <Text style={styles.detail}>{String(error.message ?? error)}</Text>
          <Pressable
            style={({ pressed }) => [styles.button, pressed && { opacity: 0.85 }]}
            onPress={this.reset}
          >
            <Text style={styles.buttonLabel}>重試</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Color.canvas },
  body: { flexGrow: 1, justifyContent: 'center', padding: 32, gap: 16 },
  title: { fontSize: 20, fontWeight: '600', color: Color.ink },
  desc: { fontSize: 14, color: Color.inkMuted, lineHeight: 22 },
  detail: {
    fontFamily: FontFamily.mono, fontSize: 11, color: '#a00',
    lineHeight: 18,
  },
  button: {
    marginTop: 8, paddingHorizontal: 24, paddingVertical: 16,
    borderRadius: Radius.md, backgroundColor: Color.ink, alignItems: 'center',
  },
  buttonLabel: { color: Color.paper, fontSize: 16, fontWeight: '600' },
});
