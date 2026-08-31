import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { put } from "@vercel/blob";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Used for local-dev static serving only — irrelevant once BLOB_READ_WRITE_TOKEN
// is set, since saveImageBuffer then returns absolute Vercel Blob URLs instead.
export const UPLOADS_DIR = path.join(__dirname, "..", "..", "data", "uploads");
export const FILES_DIR = path.join(__dirname, "..", "..", "data", "files");

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

// Saves a Buffer and returns the public URL to serve it from. Uses Vercel Blob
// when configured (persists across serverless instances); falls back to local
// disk for local dev, where a single process/filesystem is all that's needed.
export async function saveImageBuffer(buffer, mimeOrExt) {
  const hash = crypto.createHash("sha1").update(buffer).digest("hex");
  if (imageCache.has(hash)) return imageCache.get(hash);

  const ext = extFromMimeOrPath(mimeOrExt);
  const filename = `${hash}.${ext}`;

  let url;
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(`uploads/${filename}`, buffer, { access: "public" });
    url = blob.url;
  } else {
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
    await fs.writeFile(path.join(UPLOADS_DIR, filename), buffer);
    url = `/uploads/${filename}`;
  }

  imageCache.set(hash, url);
  return url;
}

// Same storage backend as saveImageBuffer but for arbitrary files (resumes, etc.)
// — no extension inference, keeps the caller's filename, stored under files/.
export async function saveFile(buffer, filename, contentType) {
  const hash = crypto.createHash("sha1").update(buffer).digest("hex");
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = `${hash}-${safeName}`;

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(`files/${key}`, buffer, { access: "public", contentType });
    return blob.url;
  }

  await fs.mkdir(FILES_DIR, { recursive: true });
  await fs.writeFile(path.join(FILES_DIR, key), buffer);
  return `/files/${key}`;
}
