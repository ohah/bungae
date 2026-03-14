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

  let extra = null;
  if (info === 'done') {
    extra = <Text style={styles.text}>If-variable: done!</Text>;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.text}>Step 4g: {info}</Text>
      {extra}
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
