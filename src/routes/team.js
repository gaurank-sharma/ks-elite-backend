import { Router } from "express";
import { createStore } from "../lib/store.js";
import { requireAdminAuth } from "../lib/adminAuth.js";
import { invalidateSiteKnowledge } from "../lib/siteKnowledge.js";

const store = createStore("team");
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

router.get("/admin/all", requireAdminAuth, async (_req, res) => {
  const all = await store.all();
  res.json(all.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
});

router.get("/admin/:id", requireAdminAuth, async (req, res) => {
  const all = await store.all();
  const member = all.find((m) => m.id === req.params.id);
  if (!member) return res.status(404).json({ error: "Not found" });
  res.json(member);
});

router.post("/admin", requireAdminAuth, async (req, res) => {
  const { name, title, exp, education, bio, tags = [], image = null, order = 0 } = req.body ?? {};
  if (!name?.trim()) return res.status(400).json({ error: "name is required." });

  const record = await store.append({
    name: name.trim(),
    title: (title ?? "").trim(),
    exp: (exp ?? "").trim(),
    education: (education ?? "").trim(),
    bio: (bio ?? "").trim(),
    tags: Array.isArray(tags) ? tags : [],
    image,
    order: Number(order) || 0,
  });
  res.status(201).json(record);
});

router.put("/admin/:id", requireAdminAuth, async (req, res) => {
  const { name, title, exp, education, bio, tags, image, order } = req.body ?? {};
  const patch = {};
  if (name !== undefined) patch.name = name.trim();
  if (title !== undefined) patch.title = title.trim();
  if (exp !== undefined) patch.exp = exp.trim();
  if (education !== undefined) patch.education = education.trim();
  if (bio !== undefined) patch.bio = bio.trim();
  if (tags !== undefined) patch.tags = Array.isArray(tags) ? tags : [];
  if (image !== undefined) patch.image = image;
  if (order !== undefined) patch.order = Number(order) || 0;

  const updated = await store.update(req.params.id, patch);
  if (!updated) return res.status(404).json({ error: "Not found" });
  res.json(updated);
});

router.delete("/admin/:id", requireAdminAuth, async (req, res) => {
  const removed = await store.remove(req.params.id);
  if (!removed) return res.status(404).json({ error: "Not found" });
  res.status(204).end();
});

export default router;
