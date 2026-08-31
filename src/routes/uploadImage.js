import { Router } from "express";
import multer from "multer";
import { saveImageBuffer } from "../lib/uploads.js";
import { requireAdminAuth } from "../lib/adminAuth.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.post("/", requireAdminAuth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file provided" });
  if (!req.file.mimetype?.startsWith("image/")) return res.status(400).json({ error: "Only image files are supported" });

  const url = await saveImageBuffer(req.file.buffer, req.file.mimetype);
  res.json({ url });
});

export default router;
