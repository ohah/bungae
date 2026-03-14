/**
 * Step 2: useState + useEffect re-render test
 */

import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';

function App() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    setCount(1);
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.text}>Step 2: Re-render test</Text>
      <Text style={styles.text}>Count: {count}</Text>
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
    fontSize: 20,
    color: '#333',
  },
});

export default App;
