"use strict";
// Browser-side proof of the event-capacity hardening:
// a large camera-style photo must not reach the server at full size, and the
// soundtrack warning must appear for an oversized audio file.
const { expect } = require("@playwright/test");
const crypto = require("crypto");
const zlib = require("zlib");

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 0);
  return Buffer.concat([head, data, crc]);
}
// A smooth, photo-like image. Stored (uncompressed) so the file on disk is the
// size a real camera photo would be, while still re-encoding small as WebP.
function largePhoto(width = 1800, height = 1200) {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < width; x++) {
      const i = y * stride + 1 + x * 3;
      const d = Math.hypot(x - width * 0.4, y - height * 0.5) / 260;
      raw[i] = Math.max(0, 235 - 120 * d + 40 * Math.sin(x / 90));
      raw[i + 1] = Math.max(0, 200 - 90 * d + 35 * Math.cos(y / 110));
      raw[i + 2] = Math.max(0, 210 - 70 * d + 30 * Math.sin((x + y) / 140));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 0 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
function largeWav(seconds = 40) {
  const data = seconds * 44100 * 2;
  const buffer = Buffer.alloc(44 + data);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(44100, 24);
  buffer.writeUInt32LE(44100 * 4, 28);
  buffer.writeUInt16LE(4, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(data, 40);
  crypto.randomFillSync(buffer, 44);
  return buffer;
}
module.exports = async function capacityBrowser({ page, password }) {
  // The main workflow ends signed out, so sign back in as the same host.
  await page.goto("/");
  await page.getByRole("button", { name: "Host sign in" }).click();
  await page.locator("#emailInput").fill("browser@example.test");
  await page.locator("#passwordInput").fill(password);
  await page.locator("#submitAuth").click();
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "＋ Create quiz" }).first().click();
  await page.locator("#quizSettings").evaluate((el) => (el.open = true));
  await page
    .getByLabel("Quiz title", { exact: true })
    .fill("Event readiness image check");
  const photo = largePhoto();
  expect(photo.length).toBeGreaterThan(2 * 1024 * 1024);
  await page
    .locator(".question-card")
    .first()
    .locator("input[type=file]")
    .setInputFiles({
      name: "venue-photo.png",
      mimeType: "image/png",
      buffer: photo,
    });
  await expect(page.locator(".question-card").first().locator(".question-media")).toBeVisible();
  await expect(page.locator("#toast")).toContainText("Image optimized");
  console.log(`      toast: ${await page.locator("#toast").textContent()}`);

  const stored = await page.evaluate(async () => {
    const url = draft.rounds[0].questions[0].media;
    const res = await fetch(url);
    const blob = await res.blob();
    return {
      url,
      size: blob.size,
      type: res.headers.get("content-type"),
    };
  });
  // 100 phones download this file; it must be a small fraction of the original.
  expect(stored.size).toBeLessThan(1024 * 1024);
  expect(stored.size).toBeGreaterThan(1000);
  expect(stored.type).toMatch(/^image\//);
  console.log(
    `      image: ${(photo.length / 1024 / 1024).toFixed(2)} MB uploaded as ` +
      `${(stored.size / 1024).toFixed(0)} KB (${stored.type})`,
  );

  const wav = largeWav();
  expect(wav.length).toBeGreaterThan(3 * 1024 * 1024);
  await page
    .locator("#musicFile")
    .setInputFiles({ name: "theme.wav", mimeType: "audio/wav", buffer: wav });
  await expect(page.locator("#toast")).toContainText("Every phone downloads this");

  return stored;
};
