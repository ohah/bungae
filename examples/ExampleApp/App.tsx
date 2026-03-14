/**
 * Step 4b: useState re-render WITHOUT NewAppScreen
 */

import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';

function App() {
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    const isBungae = typeof (globalThis as any).__BUNGAE_BUNDLER__ !== 'undefined';
    setInfo(isBungae ? 'Bungae' : 'Metro');
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.badgeText}>Step 4b: re-render without NewAppScreen</Text>
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
