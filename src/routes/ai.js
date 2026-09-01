import { Router } from "express";
import { llmChat, LlmError } from "../lib/llm.js";
import { requireAdminAuth } from "../lib/adminAuth.js";
import { suggestHeroImages } from "../lib/imageSearch.js";

const router = Router();

const CATEGORIES = ["Technology", "Inter-State Dispute", "Courts", "Laws", "Divorce"];

const DRAFT_SYSTEM_PROMPT = `You are a legal content writer for Sharma & Associates, a Delhi-based Indian law firm. Write clear, accurate, engagement-friendly blog content about Indian law for a general audience — informative, not overly technical, no fabricated case citations or statistics.

Respond with ONLY a JSON object shaped exactly like this:
{
  "title": "string, punchy and specific, under 100 characters",
  "excerpt": "string, 1-2 sentences summarizing the piece",
  "category": "one of: ${CATEGORIES.join(", ")}",
  "sections": [
    { "heading": "string or null", "paragraphs": ["string", "string"], "list": ["string", "string"] or null }
  ]
}
Produce 3-6 sections. The first section may omit its heading.

Formatting rules — this gets inserted into HTML by the server, not rendered as markdown:
- Never use markdown syntax anywhere (no **, no #, no backticks, no "1." or "-" prefixes).
- Each "paragraphs" entry must be ONE clean paragraph of flowing prose — no embedded line breaks, no numbering.
- If a section naturally has a list of items (types, conditions, steps), put those items in the optional "list" array instead — one item's plain text per array entry, no numbering or bullet characters (numbering is added automatically).
- Do not include markdown or HTML tags inside any string value.`;

function sectionsToHtml(sections) {
  if (!Array.isArray(sections)) return [];
  return sections.map((s) => {
    const heading = s?.heading ? `<h2>${escapeHtml(s.heading)}</h2>` : "";
    const paragraphs = Array.isArray(s?.paragraphs) ? s.paragraphs : [];
    const body = paragraphs.map((p) => `<p>${escapeHtml(String(p))}</p>`).join("");
    const list = Array.isArray(s?.list) && s.list.length
      ? `<ul>${s.list.map((li) => `<li>${escapeHtml(String(li))}</li>`).join("")}</ul>`
      : "";
    return { text: heading + body + list, image: null };
  });
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

router.post("/draft", requireAdminAuth, async (req, res) => {
  const { topic, notes = "" } = req.body ?? {};
  if (!topic?.trim()) return res.status(400).json({ error: "topic is required." });

  const userPrompt = `Topic: ${topic.trim()}${notes.trim() ? `\nAdditional notes / angle: ${notes.trim()}` : ""}`;

  try {
    const raw = await llmChat(
      [
        { role: "system", content: DRAFT_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0.8, maxTokens: 2000, json: true }
    );

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return res.status(502).json({ error: "The AI response wasn't valid JSON. Try again." });
    }

    if (!parsed.title || !parsed.category || !Array.isArray(parsed.sections)) {
      return res.status(502).json({ error: "The AI response was missing required fields. Try again." });
    }

    res.json({
      title: parsed.title,
      excerpt: parsed.excerpt || "",
      category: CATEGORIES.includes(parsed.category) ? parsed.category : CATEGORIES[0],
      sections: sectionsToHtml(parsed.sections),
    });
  } catch (err) {
    if (err instanceof LlmError) return res.status(err.status).json({ error: err.message });
    console.error("AI draft error:", err);
    res.status(500).json({ error: "Something went wrong generating the draft." });
  }
});

const FIX_SYSTEM_PROMPT = `You are a copy editor for Sharma & Associates, a law firm blog CMS. You'll receive one content section — it may be plain text, partially-tagged HTML, or messy HTML with typos.

Fix it:
- Correct spelling, grammar, and punctuation mistakes.
- Output valid HTML using only <p>, <h2>, <h3>, <ul>, <ol>, <li>, <strong>, <em> tags as appropriate.
- If the input is plain text with no tags, wrap each paragraph in <p> tags (split on blank lines / natural paragraph breaks). If a short line reads like a heading, use <h2> or <h3>.
- If the input already has valid tags, keep that structure and just fix the text and any malformed tags.
- Do not add new claims, statistics, or content — only fix formatting and language. Do not shorten or summarize.

Respond with ONLY a JSON object: { "html": "<the corrected HTML>" }`;

router.post("/fix-section", requireAdminAuth, async (req, res) => {
  const { html } = req.body ?? {};
  if (!html?.trim()) return res.status(400).json({ error: "html is required." });

  try {
    const raw = await llmChat(
      [
        { role: "system", content: FIX_SYSTEM_PROMPT },
        { role: "user", content: html.trim() },
      ],
      { temperature: 0.3, maxTokens: 2000, json: true }
    );

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return res.status(502).json({ error: "The AI response wasn't valid JSON. Try again." });
    }

    if (typeof parsed.html !== "string" || !parsed.html.trim()) {
      return res.status(502).json({ error: "The AI response was empty. Try again." });
    }

    res.json({ html: parsed.html });
  } catch (err) {
    if (err instanceof LlmError) return res.status(err.status).json({ error: err.message });
    console.error("AI fix-section error:", err);
    res.status(500).json({ error: "Something went wrong fixing this section." });
  }
});

router.post("/suggest-images", requireAdminAuth, async (req, res) => {
  const { title, category = "", excerpt = "" } = req.body ?? {};
  if (!title?.trim()) return res.status(400).json({ error: "title is required." });

  try {
    const { query, results } = await suggestHeroImages({ title: title.trim(), category, excerpt });
    if (results.length === 0) return res.status(404).json({ error: `No images found for "${query}". Try adjusting the title/excerpt.` });
    res.json({ query, results });
  } catch (err) {
    if (err instanceof LlmError) return res.status(err.status).json({ error: err.message });
    console.error("Image suggestion error:", err);
    res.status(500).json({ error: "Something went wrong finding images." });
  }
});

export default router;
