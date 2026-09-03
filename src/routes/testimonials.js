import { Router } from "express";
import { createStore } from "../lib/store.js";
import { requirePermission } from "../lib/adminAuth.js";
import { invalidateSiteKnowledge } from "../lib/siteKnowledge.js";

const store = createStore("testimonials");
const router = Router();

router.use("/admin", (req, _res, next) => {
  if (req.method !== "GET") invalidateSiteKnowledge();
  next();
});

// ── public ───────────────────────────────────────────────────────────────

router.get("/", async (_req, res) => {
  const all = await store.all();
  res.json(all.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
});

// ── admin ────────────────────────────────────────────────────────────────

router.get("/admin/all", requirePermission("testimonials"), async (_req, res) => {
  const all = await store.all();
  res.json(all.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
});

router.get("/admin/:id", requirePermission("testimonials"), async (req, res) => {
  const all = await store.all();
  const item = all.find((t) => t.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Not found" });
  res.json(item);
});

router.post("/admin", requirePermission("testimonials"), async (req, res) => {
  const { name, role = "", quote, order = 0 } = req.body ?? {};
  if (!name?.trim() || !quote?.trim()) return res.status(400).json({ error: "name and quote are required." });

  const record = await store.append({
    name: name.trim(),
    role: role.trim(),
    quote: quote.trim(),
    order: Number(order) || 0,
  });
  res.status(201).json(record);
});

router.put("/admin/:id", requirePermission("testimonials"), async (req, res) => {
  const { name, role, quote, order } = req.body ?? {};
  const patch = {};
  if (name !== undefined) patch.name = name.trim();
  if (role !== undefined) patch.role = role.trim();
  if (quote !== undefined) patch.quote = quote.trim();
  if (order !== undefined) patch.order = Number(order) || 0;

  const updated = await store.update(req.params.id, patch);
  if (!updated) return res.status(404).json({ error: "Not found" });
  res.json(updated);
});

router.delete("/admin/:id", requirePermission("testimonials"), async (req, res) => {
  const removed = await store.remove(req.params.id);
  if (!removed) return res.status(404).json({ error: "Not found" });
  res.status(204).end();
});

export default router;
