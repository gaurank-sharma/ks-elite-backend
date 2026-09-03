import { Router } from "express";
import multer from "multer";
import { saveFile } from "../lib/uploads.js";
import { requirePermission } from "../lib/adminAuth.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.post("/", requirePermission("cases"), upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file provided" });

  const url = await saveFile(req.file.buffer, req.file.originalname || "document", req.file.mimetype);
  res.json({ url });
});

export default router;
