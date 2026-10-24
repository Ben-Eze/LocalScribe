import { useEffect, useRef, useState } from 'react';
import { Button, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { initLlama, type LlamaContext } from 'llama.rn';

import { deleteModel, modelFile } from './model';

export default function ChatScreen({ onModelDeleted }: { onModelDeleted: () => void }) {
  const contextRef = useRef<LlamaContext | null>(null);
  const [status, setStatus] = useState('Loading model…');
  const [input, setInput] = useState('');
  const [reply, setReply] = useState('');
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();

    initLlama({
      model: modelFile.uri,
      n_ctx: 2048,
      n_gpu_layers: 99, // offload everything to Metal
    })
      .then((ctx) => {
        if (cancelled) {
          ctx.release();
          return;
        }
        contextRef.current = ctx;
        setStatus(`Loaded in ${((Date.now() - startedAt) / 1000).toFixed(1)}s (GPU: ${ctx.gpu ? 'yes' : 'no'})`);
      })
      .catch((e) => setStatus(`Failed to load model: ${e}`));

    return () => {
      cancelled = true;
      contextRef.current?.release();
      contextRef.current = null;
    };
  }, []);

  async function send() {
    const ctx = contextRef.current;
    if (!ctx || !input.trim()) return;

    setReply('');
    setGenerating(true);
    try {
      // No history: every message is a fresh single-turn prompt.
      const result = await ctx.completion(
        {
          messages: [{ role: 'user', content: input.trim() }],
          n_predict: 512,
          stop: ['<end_of_turn>', '<eos>'],
        },
        ({ token }) => setReply((prev) => prev + token),
      );
      setReply(result.text);
      setStatus(`${result.timings.predicted_per_second.toFixed(1)} tokens/s`);
    } catch (e) {
      setStatus(`Generation failed: ${e}`);
    } finally {
      setGenerating(false);
    }
  }

  async function removeModel() {
    await contextRef.current?.release();
    contextRef.current = null;
    deleteModel();
    onModelDeleted();
  }

  return (
    <View style={styles.container}>
      <Text style={styles.status}>{status}</Text>

      <ScrollView style={styles.reply} contentContainerStyle={{ padding: 12 }}>
        <Text style={styles.replyText}>{reply}</Text>
      </ScrollView>

      <TextInput
        style={styles.input}
        value={input}
        onChangeText={setInput}
        placeholder="Ask something…"
        multiline
      />
      <View style={styles.row}>
        {generating ? (
          <Button title="Stop" onPress={() => contextRef.current?.stopCompletion()} />
        ) : (
          <Button title="Send" onPress={send} disabled={!contextRef.current} />
        )}
        <Button title="Delete model" color="#dc2626" onPress={removeModel} disabled={generating} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, paddingTop: 64, gap: 12 },
  status: { color: '#666', fontSize: 12 },
  reply: { flex: 1, backgroundColor: '#f4f4f5', borderRadius: 8 },
  replyText: { fontSize: 16, lineHeight: 22 },
  input: { borderWidth: 1, borderColor: '#d4d4d8', borderRadius: 8, padding: 12, minHeight: 60, fontSize: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingBottom: 24 },
});
