import { Router } from "express";
import { createStore } from "../lib/store.js";
import { notifyLead } from "../lib/mailer.js";
import { requireAdminAuth } from "../lib/adminAuth.js";

const store = createStore("internships");
const router = Router();

const REQUIRED_FIELDS = ["firstName", "surname", "college", "email", "contact", "gender", "dob", "month"];

router.post("/", async (req, res) => {
  const body = req.body ?? {};
  const missing = REQUIRED_FIELDS.filter((key) => !String(body[key] ?? "").trim());
  if (missing.length) {
    return res.status(400).json({ error: `Missing required fields: ${missing.join(", ")}` });
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
    status: "new",
  });

  notifyLead(`New internship application — ${record.firstName} ${record.surname}`, [
    `Name: ${record.firstName} ${record.surname} (${record.preferredName || "—"})`,
    `College: ${record.college}`,
    `Email: ${record.email}`,
    `Contact: ${record.contact}`,
    `Gender: ${record.gender}`,
    `Mode: ${record.mode}`,
    `DOB: ${record.dob}`,
    `Preferred month: ${record.month}`,
    `Received: ${record.receivedAt}`,
  ]);

  res.status(201).json({ ok: true, id: record.id });
});

router.get("/", requireAdminAuth, async (_req, res) => {
  const all = await store.all();
  res.json(all.slice().reverse());
});

router.patch("/:id", requireAdminAuth, async (req, res) => {
  const { status } = req.body ?? {};
  if (!["new", "contacted", "closed"].includes(status)) {
    return res.status(400).json({ error: "status must be one of: new, contacted, closed" });
  }
  const updated = await store.update(req.params.id, { status });
  if (!updated) return res.status(404).json({ error: "Not found" });
  res.json(updated);
});

router.delete("/:id", requireAdminAuth, async (req, res) => {
  const removed = await store.remove(req.params.id);
  if (!removed) return res.status(404).json({ error: "Not found" });
  res.status(204).end();
});

export default router;
