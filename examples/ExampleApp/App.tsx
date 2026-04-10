/**
 * Bungae Example App
 * Network test + bundler diagnostics
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  StatusBar,
  StyleSheet,
  useColorScheme,
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withRepeat,
  withSequence,
  withDelay,
  interpolateColor,
  useDerivedValue,
  FadeIn,
  FadeOut,
  SlideInRight,
} from 'react-native-reanimated';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

const testIcon = require('./src/assets/test-icon.png');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TestStatus = 'idle' | 'running' | 'success' | 'error';

interface TestResult {
  status: TestStatus;
  message: string;
  duration?: number;
}

// ---------------------------------------------------------------------------
// Network test helpers
// ---------------------------------------------------------------------------

async function runWithTiming<T>(fn: () => Promise<T>): Promise<{ result: T; duration: number }> {
  const start = Date.now();
  const result = await fn();
  return { result, duration: Date.now() - start };
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

function App() {
  const isDarkMode = useColorScheme() === 'dark';
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
        <AppContent isDarkMode={isDarkMode} />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function AppContent({ isDarkMode }: { isDarkMode: boolean }) {
  const insets = useSafeAreaInsets();
  const bg = isDarkMode ? '#1a1a2e' : '#f5f5f7';
  const cardBg = isDarkMode ? '#16213e' : '#fff';
  const textColor = isDarkMode ? '#e0e0e0' : '#1c1c1e';
  const dimColor = isDarkMode ? '#8e8e93' : '#8e8e93';

  // Bundler info
  const [bundlerName, setBundlerName] = useState('');
  const [hermesEnabled, setHermesEnabled] = useState(false);

  useEffect(() => {
    const isBungae = (globalThis as any).__BUNGAE_BUNDLER__ === true;
    const ver = (globalThis as any).__BUNGAE_VERSION__;
    setBundlerName(isBungae ? `Bungae${ver ? ' v' + ver : ''}` : 'Metro');
    setHermesEnabled(!!(globalThis as any).HermesInternal);
  }, []);

  // Network test states
  const [fetchGet, setFetchGet] = useState<TestResult>({ status: 'idle', message: '' });
  const [fetchPost, setFetchPost] = useState<TestResult>({ status: 'idle', message: '' });
  const [fetchError, setFetchError] = useState<TestResult>({ status: 'idle', message: '' });
  const [wsTest, setWsTest] = useState<TestResult>({ status: 'idle', message: '' });
  const [timeoutTest, setTimeoutTest] = useState<TestResult>({ status: 'idle', message: '' });
  const [multiTest, setMultiTest] = useState<TestResult>({ status: 'idle', message: '' });
  const [errorTest, setErrorTest] = useState<TestResult>({ status: 'idle', message: '' });
  const [consoleTest, setConsoleTest] = useState<TestResult>({ status: 'idle', message: '' });

  // --- Test: GET ---
  const runFetchGet = useCallback(async () => {
    setFetchGet({ status: 'running', message: 'Fetching...' });
    try {
      const { result: res, duration } = await runWithTiming(() =>
        fetch('https://jsonplaceholder.typicode.com/posts/1'),
      );
      const json = await res.json();
      setFetchGet({
        status: 'success',
        message: `${res.status} OK  |  title: "${(json.title as string).slice(0, 40)}..."`,
        duration,
      });
    } catch (e: any) {
      setFetchGet({ status: 'error', message: e.message });
    }
  }, []);

  // --- Test: POST ---
  const runFetchPost = useCallback(async () => {
    setFetchPost({ status: 'running', message: 'Posting...' });
    try {
      const { result: res, duration } = await runWithTiming(() =>
        fetch('https://jsonplaceholder.typicode.com/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'bungae-test', body: 'hello', userId: 1 }),
        }),
      );
      const json = await res.json();
      setFetchPost({
        status: 'success',
        message: `${res.status} Created  |  id: ${json.id}`,
        duration,
      });
    } catch (e: any) {
      setFetchPost({ status: 'error', message: e.message });
    }
  }, []);

  // --- Test: Error handling (404) ---
  const runFetchError = useCallback(async () => {
    setFetchError({ status: 'running', message: 'Requesting 404...' });
    try {
      const { result: res, duration } = await runWithTiming(() => fetch('https://httpstat.us/404'));
      setFetchError({
        status: res.ok ? 'success' : 'error',
        message: `${res.status} ${res.statusText || 'Not Found'}`,
        duration,
      });
    } catch (e: any) {
      setFetchError({ status: 'error', message: e.message });
    }
  }, []);

  // --- Test: WebSocket ---
  const runWsTest = useCallback(async () => {
    setWsTest({ status: 'running', message: 'Connecting...' });
    const start = Date.now();
    try {
      const ws = new WebSocket('wss://echo.websocket.org');
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          ws.close();
          reject(new Error('Connection timeout (5s)'));
        }, 5000);

        ws.onopen = () => {
          ws.send('bungae-ping');
        };
        ws.onmessage = (ev) => {
          clearTimeout(timer);
          const duration = Date.now() - start;
          setWsTest({
            status: 'success',
            message: `Echo: "${ev.data}"`,
            duration,
          });
          ws.close();
          resolve();
        };
        ws.onerror = () => {
          clearTimeout(timer);
          reject(new Error('WebSocket error'));
        };
      });
    } catch (e: any) {
      setWsTest({ status: 'error', message: e.message, duration: Date.now() - start });
    }
  }, []);

  // --- Test: Timeout ---
  const runTimeoutTest = useCallback(async () => {
    setTimeoutTest({ status: 'running', message: 'Testing timeout (3s limit)...' });
    const start = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);

    try {
      await fetch('https://httpstat.us/200?sleep=10000', { signal: controller.signal });
      clearTimeout(timer);
      setTimeoutTest({
        status: 'success',
        message: 'Completed (unexpected)',
        duration: Date.now() - start,
      });
    } catch (e: any) {
      clearTimeout(timer);
      const duration = Date.now() - start;
      const aborted = e.name === 'AbortError';
      setTimeoutTest({
        status: aborted ? 'success' : 'error',
        message: aborted ? `Aborted after ${duration}ms (correct)` : e.message,
        duration,
      });
    }
  }, []);

  // --- Test: Parallel requests ---
  const runMultiTest = useCallback(async () => {
    setMultiTest({ status: 'running', message: 'Sending 5 parallel requests...' });
    const start = Date.now();
    try {
      const urls = Array.from(
        { length: 5 },
        (_, i) => `https://jsonplaceholder.typicode.com/posts/${i + 1}`,
      );
      const responses = await Promise.all(urls.map((u) => fetch(u)));
      const allOk = responses.every((r) => r.ok);
      const duration = Date.now() - start;
      setMultiTest({
        status: allOk ? 'success' : 'error',
        message: `${responses.length} requests  |  all ${allOk ? 'OK' : 'FAILED'}`,
        duration,
      });
    } catch (e: any) {
      setMultiTest({ status: 'error', message: e.message, duration: Date.now() - start });
    }
  }, []);

  // --- Test: Error (throw) ---
  const runErrorTest = useCallback(() => {
    setErrorTest({ status: 'running', message: 'Throwing error...' });
    try {
      const nested = () => {
        throw new Error('Bungae Error Test: intentional error for Red Screen / LogBox testing');
      };
      nested();
    } catch (e: any) {
      console.error('Error test:', e.message);
      console.error('Stack:', e.stack);
      setErrorTest({
        status: 'error',
        message: `Caught: ${e.message.slice(0, 60)}`,
      });
    }
  }, []);

  // --- Test: Console levels ---
  const runConsoleTest = useCallback(() => {
    setConsoleTest({ status: 'running', message: 'Logging...' });
    console.log('[Bungae] console.log test');
    console.info('[Bungae] console.info test');
    console.warn('[Bungae] console.warn test');
    console.error('[Bungae] console.error test');
    console.debug('[Bungae] console.debug test');

    // Object / Array test
    console.log('Object test:', {
      bundler: 'Bungae',
      version: '0.0.1',
      features: ['HMR', 'Fast Refresh', 'Source Maps'],
      nested: { platform: 'ios', dev: true },
    });
    console.log('Array test:', [1, 'two', { three: 3 }, [4, 5]]);

    setConsoleTest({
      status: 'success',
      message: 'Sent 7 logs (5 levels + object + array) — check terminal',
    });
  }, []);

  // Run all
  const runAll = useCallback(async () => {
    runErrorTest();
    runConsoleTest();
    await Promise.all([
      runFetchGet(),
      runFetchPost(),
      runFetchError(),
      runWsTest(),
      runTimeoutTest(),
      runMultiTest(),
    ]);
  }, [
    runFetchGet,
    runFetchPost,
    runFetchError,
    runWsTest,
    runTimeoutTest,
    runMultiTest,
    runErrorTest,
    runConsoleTest,
  ]);

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: bg }]}
      contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={[styles.title, { color: textColor }]}>Bungae</Text>
        <Text style={[styles.subtitle, { color: dimColor }]}>Network Test</Text>
      </View>

      {/* Status badges */}
      <View style={styles.badgeRow}>
        <Badge
          label={bundlerName}
          color={bundlerName.startsWith('Bungae') ? '#f59e0b' : '#3b82f6'}
        />
        <Badge
          label={hermesEnabled ? 'Hermes' : 'JSC'}
          color={hermesEnabled ? '#22c55e' : '#ef4444'}
        />
        <View style={styles.assetBadge}>
          <Image source={testIcon} style={styles.testIcon} />
          <Text style={styles.badgeLabel}>Asset</Text>
        </View>
      </View>

      {/* Run all */}
      <TouchableOpacity onPress={runAll} style={styles.runAllBtn} activeOpacity={0.8}>
        <Text style={styles.runAllText}>Run All Tests</Text>
      </TouchableOpacity>

      {/* Test cards */}
      <View style={styles.section}>
        <TestCard
          title="GET Request"
          desc="jsonplaceholder /posts/1"
          result={fetchGet}
          onRun={runFetchGet}
          cardBg={cardBg}
          textColor={textColor}
          dimColor={dimColor}
        />
        <TestCard
          title="POST Request"
          desc="jsonplaceholder /posts"
          result={fetchPost}
          onRun={runFetchPost}
          cardBg={cardBg}
          textColor={textColor}
          dimColor={dimColor}
        />
        <TestCard
          title="Error Handling"
          desc="httpstat.us/404"
          result={fetchError}
          onRun={runFetchError}
          cardBg={cardBg}
          textColor={textColor}
          dimColor={dimColor}
        />
        <TestCard
          title="WebSocket Echo"
          desc="echo.websocket.org"
          result={wsTest}
          onRun={runWsTest}
          cardBg={cardBg}
          textColor={textColor}
          dimColor={dimColor}
        />
        <TestCard
          title="Abort Timeout"
          desc="3s timeout on 10s delay"
          result={timeoutTest}
          onRun={runTimeoutTest}
          cardBg={cardBg}
          textColor={textColor}
          dimColor={dimColor}
        />
        <TestCard
          title="Parallel Fetch"
          desc="5 concurrent GET requests"
          result={multiTest}
          onRun={runMultiTest}
          cardBg={cardBg}
          textColor={textColor}
          dimColor={dimColor}
        />
        <TestCard
          title="Error / SourceMap"
          desc="Throw error — check Red Screen + stack trace"
          result={errorTest}
          onRun={runErrorTest}
          cardBg={cardBg}
          textColor={textColor}
          dimColor={dimColor}
        />
        <TestCard
          title="Console Levels"
          desc="log, info, warn, error, debug — check terminal"
          result={consoleTest}
          onRun={runConsoleTest}
          cardBg={cardBg}
          textColor={textColor}
          dimColor={dimColor}
        />

        {/* Reanimated Demo */}
        <ReanimatedDemo cardBg={cardBg} textColor={textColor} dimColor={dimColor} />
      </View>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Reanimated Demo
// ---------------------------------------------------------------------------

function ReanimatedDemo({
  cardBg,
  textColor,
  dimColor,
}: {
  cardBg: string;
  textColor: string;
  dimColor: string;
}) {
  // 1. Spring bounce + rotation
  const scale = useSharedValue(1);
  const rotation = useSharedValue(0);
  const bounceStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }, { rotateZ: `${rotation.value}deg` }],
  }));

  // 2. Draggable box (Gesture Handler)
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const dragStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }],
  }));
  const dragGesture = Gesture.Pan()
    .onUpdate((e) => {
      translateX.value = e.translationX;
      translateY.value = e.translationY;
    })
    .onEnd(() => {
      translateX.value = withSpring(0);
      translateY.value = withSpring(0);
    });

  // 3. Color interpolation
  const progress = useSharedValue(0);
  const bgColor = useDerivedValue(() =>
    interpolateColor(progress.value, [0, 1], ['#3b82f6', '#ef4444']),
  );
  const colorStyle = useAnimatedStyle(() => ({
    backgroundColor: bgColor.value,
  }));

  // 4. Toggle for layout animation
  const [showExtra, setShowExtra] = useState(false);

  const runAll = () => {
    // Bounce
    scale.value = withSequence(withSpring(1.4, { damping: 4 }), withSpring(1));
    rotation.value = withSequence(
      withTiming(360, { duration: 500 }),
      withTiming(0, { duration: 0 }),
    );
    // Color cycle
    progress.value = withSequence(
      withTiming(1, { duration: 600 }),
      withDelay(200, withTiming(0, { duration: 600 })),
    );
    // Layout toggle
    setShowExtra((v) => !v);
  };

  return (
    <View style={[styles.card, { backgroundColor: cardBg }]}>
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.cardTitle, { color: textColor }]}>Reanimated + Gesture</Text>
          <Text style={[styles.cardDesc, { color: dimColor }]}>
            Spring, drag, color interpolation, layout animation
          </Text>
        </View>
        <TouchableOpacity onPress={runAll} style={styles.runBtn} activeOpacity={0.7}>
          <Text style={styles.runBtnText}>Run</Text>
        </TouchableOpacity>
      </View>

      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-around',
          alignItems: 'center',
          paddingVertical: 20,
        }}
      >
        {/* Spring + Rotation */}
        <Animated.View
          style={[
            {
              width: 56,
              height: 56,
              borderRadius: 12,
              backgroundColor: '#f59e0b',
              justifyContent: 'center',
              alignItems: 'center',
            },
            bounceStyle,
          ]}
        >
          <Text style={{ fontSize: 20 }}>⚡</Text>
        </Animated.View>

        {/* Draggable */}
        <GestureDetector gesture={dragGesture}>
          <Animated.View
            style={[
              {
                width: 56,
                height: 56,
                borderRadius: 28,
                backgroundColor: '#22c55e',
                justifyContent: 'center',
                alignItems: 'center',
              },
              dragStyle,
            ]}
          >
            <Text style={{ fontSize: 14, color: '#fff', fontWeight: '700' }}>Drag</Text>
          </Animated.View>
        </GestureDetector>

        {/* Color Interpolation */}
        <Animated.View
          style={[
            {
              width: 56,
              height: 56,
              borderRadius: 12,
              justifyContent: 'center',
              alignItems: 'center',
            },
            colorStyle,
          ]}
        >
          <Text style={{ fontSize: 14, color: '#fff', fontWeight: '700' }}>Color</Text>
        </Animated.View>
      </View>

      {/* Layout Animation */}
      {showExtra && (
        <Animated.View
          entering={SlideInRight.duration(300)}
          exiting={FadeOut.duration(200)}
          style={{ backgroundColor: '#6366f1', padding: 12, borderRadius: 8, marginTop: 4 }}
        >
          <Text style={{ color: '#fff', fontSize: 13 }}>
            Layout animation working! (SlideInRight + FadeOut)
          </Text>
        </Animated.View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: color }]}>
      <Text style={styles.badgeLabel}>{label}</Text>
    </View>
  );
}

function TestCard({
  title,
  desc,
  result,
  onRun,
  cardBg,
  textColor,
  dimColor,
}: {
  title: string;
  desc: string;
  result: TestResult;
  onRun: () => void;
  cardBg: string;
  textColor: string;
  dimColor: string;
}) {
  const statusColor =
    result.status === 'success'
      ? '#22c55e'
      : result.status === 'error'
        ? '#ef4444'
        : result.status === 'running'
          ? '#3b82f6'
          : dimColor;

  return (
    <View style={[styles.card, { backgroundColor: cardBg }]}>
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.cardTitle, { color: textColor }]}>{title}</Text>
          <Text style={[styles.cardDesc, { color: dimColor }]}>{desc}</Text>
        </View>
        <TouchableOpacity
          onPress={onRun}
          style={[styles.runBtn, result.status === 'running' && styles.runBtnDisabled]}
          activeOpacity={0.7}
          disabled={result.status === 'running'}
        >
          {result.status === 'running' ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.runBtnText}>Run</Text>
          )}
        </TouchableOpacity>
      </View>

      {result.status !== 'idle' && (
        <View style={[styles.resultRow, { borderTopColor: dimColor + '22' }]}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.resultText, { color: textColor }]} numberOfLines={2}>
            {result.message}
          </Text>
          {result.duration != null && (
            <Text style={[styles.durationText, { color: dimColor }]}>{result.duration}ms</Text>
          )}
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  title: {
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 17,
    fontWeight: '400',
    marginTop: 2,
  },
  badgeRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 8,
    marginTop: 12,
  },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
  },
  badgeLabel: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  assetBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#6366f1',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
    gap: 4,
  },
  testIcon: {
    width: 18,
    height: 18,
  },
  runAllBtn: {
    marginHorizontal: 20,
    marginTop: 20,
    backgroundColor: '#007AFF',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  runAllText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  section: {
    paddingHorizontal: 20,
    marginTop: 16,
    gap: 10,
  },
  card: {
    borderRadius: 12,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  cardDesc: {
    fontSize: 13,
    marginTop: 1,
  },
  runBtn: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 8,
    minWidth: 60,
    alignItems: 'center',
  },
  runBtnDisabled: {
    backgroundColor: '#007AFF88',
  },
  runBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  resultText: {
    flex: 1,
    fontSize: 13,
  },
  durationText: {
    fontSize: 12,
    fontWeight: '500',
  },
});

export default App;
