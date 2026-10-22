/**
 * A quick look at a menu photo on the phone itself (Tesseract.js, free, nothing uploaded) before it's sent
 * to the AI: a blurry, dark or far-away photo reads as few words with low confidence. It only warns; the owner
 * can always send the photo anyway. Any failure (offline, slow phone) counts as readable, so it never blocks.
 */
export interface Readability { ok: boolean; words: number; confidence: number }

const READABLE: Readability = { ok: true, words: 0, confidence: 0 };

export async function checkReadable(image: Blob, timeoutMs = 15000): Promise<Readability> {
  try {
    const run = (async () => {
      const { createWorker } = await import("tesseract.js");
      // English plus Hindi (Devanagari), so Hindi menus aren't taken for unreadable ones.
      const worker = await createWorker(["eng", "hin"]);
      try {
        const { data } = await worker.recognize(image);
        const words = (data.text.match(/[\p{L}\p{N}]{2,}/gu) || []).length;
        return { ok: words >= 8 && data.confidence >= 45, words, confidence: Math.round(data.confidence) };
      } finally {
        await worker.terminate();
      }
    })();
    const late = new Promise<Readability>((ok) => setTimeout(() => ok(READABLE), timeoutMs));
    return await Promise.race([run, late]);
  } catch {
    return READABLE;
  }
}
