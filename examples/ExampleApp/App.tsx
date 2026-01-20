/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import { NewAppScreen } from '@react-native/new-app-screen';
import { useEffect, useState } from 'react';
import { StatusBar, StyleSheet, useColorScheme, View, Text } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

function App() {
  const isDarkMode = useColorScheme() === 'dark';

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent() {
  const safeAreaInsets = useSafeAreaInsets();
  const [bundlerInfo, setBundlerInfo] = useState<{
    name: string;
    version?: string;
    isBungae: boolean;
  } | null>(null);

  // Double-check: Verify which bundler was used
  useEffect(() => {
    // Check if Bungae bundler was used
    const isBungae =
      typeof (globalThis as any).__BUNGAE_BUNDLER__ !== 'undefined' &&
      (globalThis as any).__BUNGAE_BUNDLER__ === true;
    const bungaeVersion = (globalThis as any).__BUNGAE_VERSION__;

    const info = {
      name: isBungae ? 'Bungae' : 'Metro',
      version: isBungae ? bungaeVersion : undefined,
      isBungae,
    };

    setBundlerInfo(info);

    if (isBungae) {
      console.log('✅ Bungae Bundler detected!');
      console.log(`📦 Version: ${bungaeVersion || 'unknown'}`);
      console.log('⚡ This bundle was built with Bungae (powered by Bun)');
    } else {
      console.log('📦 Metro Bundler detected');
      console.log('ℹ️  This bundle was built with Metro');
    }

    // Also log in development for easy debugging
    if (__DEV__) {
      console.log('🔍 Bundler check:', {
        isBungae,
        bungaeVersion,
        bundler: isBungae ? 'Bungae' : 'Metro',
      });
    }
  }, []);

  return (
    <View style={styles.container}>
      <NewAppScreen templateFileName="App.tsx" safeAreaInsets={safeAreaInsets} />

      {/* Bundler Info Badge */}
      {bundlerInfo && (
        <View
          style={[
            styles.bundlerBadge,
            {
              backgroundColor: bundlerInfo.isBungae
                ? 'rgba(251, 191, 36, 0.9)' // Amber for Bungae
                : 'rgba(59, 130, 246, 0.9)', // Blue for Metro
            },
          ]}
        >
          <Text style={styles.bundlerText}>
            {bundlerInfo.isBungae ? '⚡' : '📦'} {bundlerInfo.name}
            {bundlerInfo.version && ` v${bundlerInfo.version}`}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  bundlerBadge: {
    position: 'absolute',
    top: 50,
    right: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  bundlerText: {
    color: '#000',
    fontSize: 12,
    fontWeight: '600',
  },
});

export default App;
