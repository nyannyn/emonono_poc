import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { AppNavigator } from './src/navigation/AppNavigator';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { useAppFonts } from './src/theme/fonts';

export default function App() {
  const [fontsLoaded, fontError] = useAppFonts();
  // 絕不因字體而永久白屏：字體載入失敗（fontError）或超過 3 秒未完成都照樣進 app，
  // 缺字體頂多文字回退系統預設字型，不影響功能。
  const [fontTimedOut, setFontTimedOut] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setFontTimedOut(true), 3000);
    return () => clearTimeout(t);
  }, []);

  const ready = fontsLoaded || fontError != null || fontTimedOut;
  if (!ready) {
    return <View style={{ flex: 1, backgroundColor: '#FBFAF6' }} />;
  }
  return (
    <ErrorBoundary>
      <AppNavigator />
      <StatusBar style="dark" />
    </ErrorBoundary>
  );
}
