import { View, Text, StyleSheet } from 'react-native';

export default function LazyScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Lazy Loaded Screen</Text>
      <Text style={styles.subtitle}>This screen was loaded via code splitting!</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#e94560',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#aaa',
  },
});
