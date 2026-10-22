/**
 * Lazy-loaded PDF renderer using pdfjs-dist.
 * Converts up to 4 pages of a PDF menu file to JPEG blobs in the browser.
 */
export async function renderPdfPages(file: File, maxPages = 4): Promise<Blob[]> {
  const pdfjsLib = await import("pdfjs-dist");
  try {
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
    }
  } catch {
    /* fallback to main thread rendering */
  }

  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
  const pdf = await loadingTask.promise;
  const numPages = Math.min(pdf.numPages, maxPages);
  const blobs: Blob[] = [];

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    // Render white background first so transparent PDFs don't end up black in JPEG
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // @ts-expect-error canvasContext type in pdfjs-dist
    await page.render({ canvasContext: ctx, viewport }).promise;

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (blob) blobs.push(blob);
  }

  return blobs;
}

/**
 * The text inside a PDF menu, if it has real text (most menus exported from a computer do). Sending text
 * instead of page pictures is cheaper and reads prices more reliably. Returns "" for a scanned PDF.
 */
export async function pdfText(file: File, maxPages = 12): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist");
  try {
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
    }
  } catch {
    /* fallback to main thread */
  }
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  let out = "";
  for (let p = 1; p <= Math.min(pdf.numPages, maxPages); p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    out += tc.items.map((i) => ("str" in i ? i.str : "")).join(" ") + "\n";
    if (out.length > 24000) break;
  }
  const text = out.replace(/[ \t]+/g, " ").trim();
  // A few stray characters (page numbers, a logo's name) mean it's really a scan.
  return (text.match(/[\p{L}]{2,}/gu) || []).length >= 25 ? text.slice(0, 24000) : "";
}
