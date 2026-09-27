"use strict";
const { parentPort, workerData } = require("node:worker_threads");
const { parseQuizText, MAX_TEXT } = require("./quiz-import");
const b = Buffer.from(workerData.buffer);
function invalid(message) {
  throw Object.assign(new Error(message), { safe: true });
}
async function checkDocx() {
  const yauzl = require("yauzl");
  await new Promise((resolve, reject) =>
    yauzl.fromBuffer(b, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      let total = 0,
        count = 0,
        document = false;
      zip.on("error", reject);
      zip.on("end", () =>
        document ? resolve() : reject(Error("No document")),
      );
      zip.on("entry", (entry) => {
        total += entry.uncompressedSize;
        count++;
        if (
          total > 16 * 1024 * 1024 ||
          entry.uncompressedSize > 8 * 1024 * 1024 ||
          count > 1500 ||
          entry.generalPurposeBitFlag & 1
        ) {
          zip.close();
          return reject(Error("Archive limit"));
        }
        if (entry.fileName === "word/document.xml") document = true;
        zip.readEntry();
      });
      zip.readEntry();
    }),
  );
}
async function extract() {
  if (workerData.extension === "txt") {
    if (b.includes(0)) invalid("Use a UTF-8 text file, not a binary document.");
    return new TextDecoder("utf-8", { fatal: true }).decode(b);
  }
  if (workerData.extension === "docx") {
    await checkDocx();
    return await require("./document-format").docxText(b);
  }
  if (b.subarray(0, 5).toString() !== "%PDF-")
    invalid(
      "This file is not a readable PDF. Export it as a text PDF or paste its text.",
    );
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: new Uint8Array(b),
    isEvalSupported: false,
    useSystemFonts: false,
    useWorkerFetch: false,
    disableFontFace: true,
    verbosity: 0,
    fontExtraProperties: true,
  });
  let doc;
  try {
    doc = await task.promise;
    if (doc.numPages > 50)
      invalid("Maximum 50 PDF pages. Split the document first.");
    let text = "";
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      text +=
        (await require("./document-format").pdfPageText(page, pdfjs)) + "\n";
      if (text.length > MAX_TEXT)
        invalid("Too much text. Split this document into smaller quizzes.");
      page.cleanup();
    }
    if (!text.trim())
      invalid(
        "No text was found in this PDF. Scanned pages need OCR first; this importer supports text PDFs.",
      );
    return text;
  } finally {
    if (doc) await doc.destroy();
    else await task.destroy();
  }
}
(async () => {
  try {
    const text = await extract();
    parentPort.postMessage({
      result: parseQuizText(text, workerData.title, workerData.styleMode),
    });
  } catch (error) {
    parentPort.postMessage({
      error:
        error.safe || error.status === 400
          ? error.message
          : "Unable to read this file. It may be encrypted, damaged, too large after decompression, or unsupported. Try a text PDF, .docx or pasted text.",
    });
  }
})();
