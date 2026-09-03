import { Router } from "express";
import multer from "multer";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { createStore } from "../lib/store.js";
import { notifyLead } from "../lib/mailer.js";
import { requirePermission } from "../lib/adminAuth.js";
import { saveFile } from "../lib/uploads.js";
import { analyzeResume } from "../lib/resumeAnalysis.js";

const store = createStore("internships");
const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const REQUIRED_FIELDS = ["firstName", "surname", "college", "email", "contact", "gender", "dob", "month"];

router.post("/", upload.single("resume"), async (req, res) => {
  const body = req.body ?? {};
  const missing = REQUIRED_FIELDS.filter((key) => !String(body[key] ?? "").trim());
  if (missing.length) {
    return res.status(400).json({ error: `Missing required fields: ${missing.join(", ")}` });
  }

  let resumeUrl = null;
  let resumeText = "";
  if (req.file) {
    try {
      resumeUrl = await saveFile(req.file.buffer, req.file.originalname || "resume.pdf", req.file.mimetype);
      if (req.file.mimetype === "application/pdf" || req.file.originalname?.toLowerCase().endsWith(".pdf")) {
        const parsed = await pdfParse(req.file.buffer);
        resumeText = parsed.text || "";
      }
    } catch (err) {
      console.error("Resume upload/parse failed:", err.message);
    }
  }

  // Scored before saving, not after responding — Vercel can freeze a serverless
  // function immediately once the response is sent, so "fire and forget after
  // res.json()" would silently never run there. This adds real latency to the
  // request instead (a few seconds for the LLM call), which is the correct trade.
  let aiResult = null;
  if (resumeText.trim()) {
    aiResult = await analyzeResume({ resumeText, college: body.college.trim(), mode: (body.mode ?? "Offline").trim(), month: body.month.trim() });
  }

  const record = await store.append({
    firstName: body.firstName.trim(),
    surname: body.surname.trim(),
    preferredName: (body.preferredName ?? "").trim(),
    college: body.college.trim(),
    email: body.email.trim(),
    contact: body.contact.trim(),
    gender: body.gender.trim(),
    mode: (body.mode ?? "Offline").trim(),
    dob: body.dob.trim(),
    month: body.month.trim(),
    resumeUrl,
    aiScore: aiResult?.score ?? null,
    aiVerdict: aiResult?.verdict ?? null,
    aiSummary: aiResult?.summary ?? null,
    status: "new",
  });

  notifyLead(`New internship application — ${record.firstName} ${record.surname}`, [
    `Name: ${record.firstName} ${record.surname} (${record.preferredName || "—"})`,
    `College: ${record.college}`,
    `Email: ${record.email}`,
    `Contact: ${record.contact}`,
    `Gender: ${record.gender}`,
    `Mode of Internship: ${record.mode}`,
    `DOB: ${record.dob}`,
    `Preferred month: ${record.month}`,
    `Resume: ${resumeUrl || "not provided"}`,
    aiResult ? `AI assessment: ${aiResult.verdict} (${aiResult.score}/100) — ${aiResult.summary}` : null,
    `Received: ${record.receivedAt}`,
  ].filter(Boolean));

  res.status(201).json({ ok: true, id: record.id });
});

router.get("/", requirePermission("leads_internship"), async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  res.json(await store.paginate({ page, limit }));
});

router.patch("/:id", requirePermission("leads_internship"), async (req, res) => {
  const { status } = req.body ?? {};
  if (!["new", "contacted", "closed"].includes(status)) {
    return res.status(400).json({ error: "status must be one of: new, contacted, closed" });
  }
  const updated = await store.update(req.params.id, { status });
  if (!updated) return res.status(404).json({ error: "Not found" });
  res.json(updated);
});

router.delete("/:id", requirePermission("leads_internship"), async (req, res) => {
  const removed = await store.remove(req.params.id);
  if (!removed) return res.status(404).json({ error: "Not found" });
  res.status(204).end();
});

export default router;
