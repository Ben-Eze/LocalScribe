// Web preview stand-in for llama.rn: streams a canned reply so the chat UI can be viewed in a browser.
const REPLY = 'This is a web preview. The real model only runs in the iPhone build.';

export async function initLlama(_params: unknown) {
  let stopped = false;
  return {
    gpu: false,
    async completion(_params: unknown, onToken: (data: { token: string }) => void) {
      stopped = false;
      for (const word of REPLY.split(' ')) {
        if (stopped) break;
        await new Promise((r) => setTimeout(r, 80));
        onToken({ token: word + ' ' });
      }
      return { text: REPLY, timings: { predicted_per_second: 0 } };
    },
    async stopCompletion() {
      stopped = true;
    },
    async release() {},
  };
}
