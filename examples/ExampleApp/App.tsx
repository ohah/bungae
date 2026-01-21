/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import { NewAppScreen } from '@react-native/new-app-screen';
import { useEffect, useState } from 'react';
import {
  StatusBar,
  StyleSheet,
  useColorScheme,
  View,
  Text,
  TouchableOpacity,
  Alert,
} from 'react-native';
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

    // === Bungae Bundle Debug Info ===
    // React Native 런타임 이벤트 핸들러 연결 문제 확인
    console.log('\n=== Bungae Bundle Debug Info ===');

    // 1. Bundle loaded
    console.log('1. Bundle loaded:', {
      hasBungaeBundler: typeof (globalThis as any).__BUNGAE_BUNDLER__ !== 'undefined',
      bundlerValue: (globalThis as any).__BUNGAE_BUNDLER__,
      hasBungaeVersion: typeof (globalThis as any).__BUNGAE_VERSION__ !== 'undefined',
      bungaeVersion: (globalThis as any).__BUNGAE_VERSION__,
      isDev: __DEV__,
    });

    // 2. Module system
    console.log('2. Module system:', {
      hasDefine: typeof (globalThis as any).__d !== 'undefined',
      hasRequire: typeof (globalThis as any).__r !== 'undefined',
      hasClear: typeof (globalThis as any).__c !== 'undefined',
      metroRequire: typeof (globalThis as any).metroRequire !== 'undefined',
    });

    // 3. React Native components
    try {
      const RN = require('react-native');
      console.log('3. React Native components:');
      console.log('   - TouchableOpacity:', {
        exists: typeof RN.TouchableOpacity !== 'undefined',
        type: typeof RN.TouchableOpacity,
        isFunction: typeof RN.TouchableOpacity === 'function',
      });
      console.log('   - Button:', {
        exists: typeof RN.Button !== 'undefined',
        type: typeof RN.Button,
        isFunction: typeof RN.Button === 'function',
      });
      console.log('   - View:', {
        exists: typeof RN.View !== 'undefined',
        type: typeof RN.View,
      });
      console.log('   - Text:', {
        exists: typeof RN.Text !== 'undefined',
        type: typeof RN.Text,
      });
    } catch (e) {
      console.error('   - Failed to load React Native:', e);
    }

    // 4. NewAppScreen
    console.log('4. NewAppScreen:');
    try {
      const NewAppScreenModule = require('@react-native/new-app-screen');
      console.log('   - Module loaded:', !!NewAppScreenModule);
      console.log('   - Default export:', {
        exists: typeof NewAppScreenModule.default !== 'undefined',
        type: typeof NewAppScreenModule.default,
        isFunction: typeof NewAppScreenModule.default === 'function',
      });
      console.log('   - Named export:', {
        exists: typeof NewAppScreenModule.NewAppScreen !== 'undefined',
        type: typeof NewAppScreenModule.NewAppScreen,
      });
    } catch (e) {
      console.error('   - Failed to load NewAppScreen:', e);
    }

    // 5. Event system
    try {
      const RN = require('react-native');
      const { UIManager } = RN;
      console.log('5. Event system:');
      console.log('   - UIManager:', {
        exists: typeof UIManager !== 'undefined',
        type: typeof UIManager,
      });
      console.log('   - NativeModules:', {
        exists: typeof RN.NativeModules !== 'undefined',
        type: typeof RN.NativeModules,
        keys:
          typeof RN.NativeModules !== 'undefined' ? Object.keys(RN.NativeModules).slice(0, 5) : [],
      });
    } catch (e) {
      console.error('   - Failed to check event system:', e);
    }

    // 6. Module count (if available)
    try {
      const metroRequire = (globalThis as any).__r || (globalThis as any).metroRequire;
      if (metroRequire && typeof metroRequire.getModules === 'function') {
        const modules = metroRequire.getModules();
        console.log('6. Module count:', {
          total: modules ? Object.keys(modules).length : 'unknown',
          hasModules: !!modules,
        });
      } else {
        console.log('6. Module count: getModules() not available');
      }
    } catch (e) {
      console.error('   - Failed to get module count:', e);
    }

    // 7. Test event handler
    console.log('7. Test event handler:');
    const testHandler = () => {
      console.log('✅ Test event handler called!');
    };
    console.log('   - Handler function:', {
      type: typeof testHandler,
      isFunction: typeof testHandler === 'function',
    });

    console.log('=== End Debug Info ===\n');
  }, []);

  // 테스트 이벤트 핸들러
  const handleTestPress = () => {
    console.log('✅ Test button pressed!');
    Alert.alert('Success', 'Button press event is working!', [
      { text: 'OK', onPress: () => console.log('Alert dismissed') },
    ]);
  };

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

      {/* 테스트 버튼 - 이벤트 핸들러 연결 확인용 */}
      <TouchableOpacity onPress={handleTestPress} style={styles.testButton} activeOpacity={0.7}>
        <Text style={styles.testButtonText}>🧪 Test Button (Event Handler Test)</Text>
      </TouchableOpacity>
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
  testButton: {
    position: 'absolute',
    bottom: 100,
    left: 20,
    right: 20,
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  testButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default App;
