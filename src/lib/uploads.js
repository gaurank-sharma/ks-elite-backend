import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const cloudinaryConfigured = () =>
  Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);

function uploadToCloudinary(buffer, options) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (err, result) => (err ? reject(err) : resolve(result)));
    stream.end(buffer);
  });
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Local-dev fallback only, used when Cloudinary env vars aren't set — irrelevant
// in production, where saveImageBuffer/saveFile return absolute Cloudinary URLs.
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

// Saves an image Buffer and returns the public URL to serve it from. Uses
// Cloudinary when configured (persists across serverless instances); falls
// back to local disk for local dev without Cloudinary credentials set.
export async function saveImageBuffer(buffer, mimeOrExt) {
  const hash = crypto.createHash("sha1").update(buffer).digest("hex");
  if (imageCache.has(hash)) return imageCache.get(hash);

  let url;
  if (cloudinaryConfigured()) {
    const result = await uploadToCloudinary(buffer, { folder: "ks-elite/images", public_id: hash, resource_type: "image" });
    url = result.secure_url;
  } else {
    const ext = extFromMimeOrPath(mimeOrExt);
    const filename = `${hash}.${ext}`;
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
    await fs.writeFile(path.join(UPLOADS_DIR, filename), buffer);
    url = `/uploads/${filename}`;
  }

  imageCache.set(hash, url);
  return url;
}

// Same storage backend as saveImageBuffer but for arbitrary files (resumes,
// etc.) — uploaded as Cloudinary's "raw" resource type, which needs the
// extension baked into public_id since raw uploads don't infer format.
export async function saveFile(buffer, filename, contentType) {
  const hash = crypto.createHash("sha1").update(buffer).digest("hex");
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = `${hash}-${safeName}`;

  if (cloudinaryConfigured()) {
    const result = await uploadToCloudinary(buffer, { folder: "ks-elite/files", public_id: key, resource_type: "raw" });
    return result.secure_url;
  }

  await fs.mkdir(FILES_DIR, { recursive: true });
  await fs.writeFile(path.join(FILES_DIR, key), buffer);
  return `/files/${key}`;
}
