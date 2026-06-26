import { registerRootComponent } from 'expo';
import React from 'react';
import { ScrollView, Text } from 'react-native';

// 啟動診斷層：production build 沒有 console，若 app 在「模組求值 / 啟動」階段就拋例外，
// 畫面只會一片空白且 ErrorBoundary 也攔不到（它只接 render 階段、且在 App 之內）。
// 這裡在註冊根元件「之前」攔截所有未捕捉 JS 例外，並改用 require()（可被 try/catch 捕捉）
// 載入 App 整棵樹，任何啟動錯誤都直接印在螢幕上，方便在真機上看到原因。

let startupError: unknown = null;

const g = global as unknown as {
  ErrorUtils?: {
    setGlobalHandler?: (h: (e: unknown, isFatal?: boolean) => void) => void;
    getGlobalHandler?: () => ((e: unknown, isFatal?: boolean) => void) | undefined;
  };
};
if (g.ErrorUtils?.setGlobalHandler) {
  const prev = g.ErrorUtils.getGlobalHandler?.();
  g.ErrorUtils.setGlobalHandler((e, isFatal) => {
    if (!startupError) startupError = e;
    if (prev) {
      try {
        prev(e, isFatal);
      } catch {
        // 忽略前一個 handler 的二次錯誤
      }
    }
  });
}

function errText(e: unknown): { message: string; stack: string } {
  if (e && typeof e === 'object') {
    const anyE = e as { message?: unknown; stack?: unknown };
    return {
      message: String(anyE.message ?? e),
      stack: String(anyE.stack ?? ''),
    };
  }
  return { message: String(e), stack: '' };
}

function StartupErrorScreen() {
  const { message, stack } = errText(startupError);
  return React.createElement(
    ScrollView,
    {
      style: { flex: 1, backgroundColor: '#1b1b1b' },
      contentContainerStyle: { padding: 24, paddingTop: 80 },
    },
    React.createElement(
      Text,
      { style: { color: '#ff6b6b', fontSize: 18, fontWeight: '700', marginBottom: 12 } },
      '啟動錯誤（請截圖回報）',
    ),
    React.createElement(
      Text,
      { selectable: true, style: { color: '#fff', fontSize: 13, lineHeight: 20 } },
      message,
    ),
    React.createElement(
      Text,
      { selectable: true, style: { color: '#aaa', fontSize: 11, lineHeight: 16, marginTop: 16 } },
      stack,
    ),
  );
}

// require 而非 static import，才能捕捉 App 整棵 import 樹在求值階段的例外。
let Root: React.ComponentType | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Root = require('./App').default;
} catch (e) {
  startupError = e;
}

function Entry() {
  if (startupError || !Root) {
    return React.createElement(StartupErrorScreen);
  }
  return React.createElement(Root);
}

registerRootComponent(Entry);
