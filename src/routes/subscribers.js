import { Router } from "express";
import { createStore } from "../lib/store.js";
import { requirePermission } from "../lib/adminAuth.js";

const store = createStore("subscribers");
const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post("/", async (req, res) => {
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "A valid email is required." });

  const existing = await store.all();
  if (existing.some((s) => s.email === email)) {
    return res.status(200).json({ ok: true, alreadySubscribed: true });
  }

  await store.append({ email });
  res.status(201).json({ ok: true });
});

router.get("/", requirePermission("subscribers"), async (_req, res) => {
  const all = await store.all();
  res.json(all.slice().reverse());
});

router.delete("/:id", requirePermission("subscribers"), async (req, res) => {
  const removed = await store.remove(req.params.id);
  if (!removed) return res.status(404).json({ error: "Not found" });
  res.status(204).end();
});

export default router;
