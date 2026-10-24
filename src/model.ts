import { File, Paths } from 'expo-file-system';

export const MODEL_URL =
  'https://huggingface.co/ggml-org/gemma-3-1b-it-GGUF/resolve/main/gemma-3-1b-it-Q8_0.gguf';

// Final location of the model; only exists once a download has fully completed.
export const modelFile = new File(Paths.document, 'gemma-3-1b-it-Q8_0.gguf');
// Downloads land here first so an interrupted download is never mistaken for a finished one.
const partialFile = new File(Paths.document, 'gemma-3-1b-it-Q8_0.gguf.part');

export function isModelDownloaded(): boolean {
  return modelFile.exists;
}

export async function downloadModel(onProgress: (fraction: number) => void): Promise<void> {
  if (partialFile.exists) partialFile.delete();

  await File.downloadFileAsync(MODEL_URL, partialFile, {
    onProgress: ({ bytesWritten, totalBytes }) => {
      if (totalBytes > 0) onProgress(bytesWritten / totalBytes);
    },
  });

  partialFile.move(modelFile);
}

export function deleteModel(): void {
  if (modelFile.exists) modelFile.delete();
}
