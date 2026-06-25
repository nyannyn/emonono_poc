import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { AppNavigator } from './src/navigation/AppNavigator';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { useAppFonts } from './src/theme/fonts';

export default function App() {
  const [fontsLoaded] = useAppFonts();
  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: '#FBFAF6' }} />;
  }
  return (
    <ErrorBoundary>
      <AppNavigator />
      <StatusBar style="dark" />
    </ErrorBoundary>
  );
}
