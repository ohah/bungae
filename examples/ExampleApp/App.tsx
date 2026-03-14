/**
 * Step 4c: useState re-render WITHOUT conditional rendering
 */

import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';

function App() {
  const [info, setInfo] = useState('loading');

  useEffect(() => {
    setInfo('done');
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.badgeText}>Step 4c: {info}</Text>
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
