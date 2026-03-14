/**
 * Step 4: useState re-render + conditional rendering with badges
 */

import { NewAppScreen } from '@react-native/new-app-screen';
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent() {
  const safeAreaInsets = useSafeAreaInsets();
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    const isBungae = typeof (globalThis as any).__BUNGAE_BUNDLER__ !== 'undefined';
    setInfo(isBungae ? 'Bungae' : 'Metro');
  }, []);

  return (
    <View style={styles.container}>
      <NewAppScreen templateFileName="App.tsx" safeAreaInsets={safeAreaInsets} />
      {info && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{info}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  badge: {
    position: 'absolute',
    top: 50,
    right: 16,
    backgroundColor: 'rgba(251, 191, 36, 0.9)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  badgeText: {
    color: '#000',
    fontSize: 12,
    fontWeight: '600',
  },
});

export default App;
