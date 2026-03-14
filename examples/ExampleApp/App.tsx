/**
 * Step 12: ternary baseline re-check
 */

import { View, Text, StyleSheet } from 'react-native';

function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Step 12</Text>
      {true ? <Text style={styles.text}>Ternary baseline</Text> : null}
      {/* padding comment to shift bundle size AAAAAAAAAAAA */}
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
