/**
 * Step 7: && test without array destructuring (avoid _sliced_to_array)
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

function App() {
  const state = React.useState('loading');
  const info = state[0];
  const setInfo = state[1];

  React.useEffect(function () {
    setInfo('done');
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.text}>Step 8: {info}</Text>
      {info === 'done' ? (
        <Text style={styles.text}>Conditional: works!</Text>
      ) : null}
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
