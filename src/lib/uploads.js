import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// See the same /tmp caveat in store.js — not persistent on Vercel.
export const UPLOADS_DIR = process.env.VERCEL
  ? "/tmp/data/uploads"
  : path.join(__dirname, "..", "..", "data", "uploads");

const EXT_BY_MIME = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

function extFromMimeOrPath(mimeOrExt = "") {
  if (EXT_BY_MIME[mimeOrExt]) return EXT_BY_MIME[mimeOrExt];
  const cleaned = mimeOrExt.replace(/^\./, "").toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(cleaned)) return cleaned === "jpeg" ? "jpg" : cleaned;
  return "png";
}

const imageCache = new Map();

// Saves a Buffer to disk under a content-hash filename (dedupes identical images
// within a process run) and returns the public URL path to serve it from.
export async function saveImageBuffer(buffer, mimeOrExt) {
  const hash = crypto.createHash("sha1").update(buffer).digest("hex");
  if (imageCache.has(hash)) return imageCache.get(hash);

  const ext = extFromMimeOrPath(mimeOrExt);
  const filename = `${hash}.${ext}`;
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOADS_DIR, filename), buffer);

  const url = `/uploads/${filename}`;
  imageCache.set(hash, url);
  return url;
}
