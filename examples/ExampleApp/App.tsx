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

  // Debug: check what's available before render
  if (info === 'done') {
    const RN = require('react-native');
    const JSX = require('react/jsx-runtime');
    console.log('[DEBUG] Text:', typeof RN.Text, typeof Text);
    console.log('[DEBUG] jsx:', typeof JSX.jsx, typeof JSX.jsxs);
    console.log('[DEBUG] View:', typeof RN.View, typeof View);
    console.log('[DEBUG] styles:', typeof styles, typeof styles?.text);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.text}>Step 6: {info}</Text>
      {info === 'done' && (
        <Text style={styles.text}>Conditional &&: works!</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  text: {
    fontSize: 24,
    color: '#333',
  },
});

export default App;
