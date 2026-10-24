import { useState } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';

import { downloadModel } from './model';

export default function DownloadScreen({ onDone }: { onDone: () => void }) {
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setError(null);
    setProgress(0);
    try {
      await downloadModel(setProgress);
      onDone();
    } catch (e) {
      setError(String(e));
      setProgress(null);
    }
  }

  const downloading = progress !== null;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Gemma 3 1B (Q8_0)</Text>
      <Text style={styles.subtitle}>~1.07 GB download, stored on the device</Text>

      {downloading ? (
        <>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${progress * 100}%` }]} />
          </View>
          <Text>{(progress * 100).toFixed(1)}%</Text>
        </>
      ) : (
        <Button title="Download model" onPress={start} />
      )}

      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 16 },
  title: { fontSize: 22, fontWeight: '600' },
  subtitle: { color: '#666' },
  barTrack: { height: 8, backgroundColor: '#eee', borderRadius: 4, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: '#2563eb' },
  error: { color: '#dc2626' },
});
