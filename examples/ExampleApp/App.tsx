/**
 * Step 11: && with LogBox disabled
 */

import { View, Text, StyleSheet, LogBox } from 'react-native';

LogBox.ignoreAllLogs();

function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Step 11</Text>
      {true && <Text style={styles.text}>AND with LogBox disabled</Text>}
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
