// Design tokens — translated from _design/dailyworkweb/project/screens/shared.jsx
// 風格：黑色 ink + 紙感暖白 + 大圓角 + 編輯感 masthead

export const Color = {
  // Ink
  ink: '#111111',
  inkMuted: 'rgba(17,17,17,0.55)',
  inkFaint: 'rgba(17,17,17,0.32)',
  hairline: 'rgba(17,17,17,0.09)',

  // Surfaces
  canvas: '#F3F1EC',
  canvasDeep: '#EAE6DD',
  paper: '#FBFAF6',
  avatarBg: 'rgba(17,17,17,0.08)',

  // Dark variant (Variation B reference, not used in current C)
  darkBg: '#15140F',
  darkText: '#F3F1EC',
} as const;

// 圓角階層（卡片 22-32，按鈕 32-36）
export const Radius = {
  sm: 22,
  md: 32,
  lg: 36,
} as const;

// Spacing 從 design 抽出的常用值
export const Spacing = {
  xs: 4,
  sm: 10,
  md: 14,
  lg: 20,
  xl: 26,
  xxl: 36,
} as const;

// Font families — body 用系統字（iOS=SF Pro，CJK 自動 fallback），
// mono 用 JetBrains Mono（要透過 @expo-google-fonts/jetbrains-mono 載入）
export const FontFamily = {
  body: undefined as string | undefined,
  mono: 'JetBrainsMono_400Regular',
  monoMedium: 'JetBrainsMono_500Medium',
} as const;

// 紙感陰影（iOS 用 shadow*；Android 自動降為 elevation）
export const Shadow = {
  paper: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 24 },
    shadowOpacity: 0.15,
    shadowRadius: 48,
    elevation: 12,
  },
  button: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.4,
    shadowRadius: 40,
    elevation: 16,
  },
} as const;

// iPhone 390x844 是 design 鎖定的尺寸（Variation C target）
export const Layout = {
  pagePaddingX: 26,
  buttonPaddingX: 20,
} as const;

// 5 句聲紋預設（Phase 9 用）
export const VOICEPRINT_SENTENCES = [
  '你好，我是 __（請說出你的名字）。',
  '今天的天氣看起來很適合開會。',
  'The quick brown fox jumps over the lazy dog.',
  '一、二、三、四、五、六、七、八、九、十。',
  '謝謝大家，會議就先到這裡。',
];
