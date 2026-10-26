// Web preview stand-in for model.ts: simulates the download so the UI can be viewed in a browser.
let downloaded = false;

export const modelFile = { uri: '' };

export function isModelDownloaded(): boolean {
  return downloaded;
}

export async function downloadModel(onProgress: (fraction: number) => void): Promise<void> {
  for (let i = 1; i <= 20; i++) {
    await new Promise((r) => setTimeout(r, 100));
    onProgress(i / 20);
  }
  downloaded = true;
}

export function deleteModel(): void {
  downloaded = false;
}
