import { llmChat, LlmError } from "./llm.js";

// Turns an article's title/category/excerpt into a short, effective stock-photo
// search query — "Bail Provisions Under the New Criminal Law" makes a poor image
// search string on its own, so let the LLM distill it into visual keywords.
async function buildSearchQuery({ title, category, excerpt }) {
  try {
    const raw = await llmChat(
      [
        {
          role: "system",
          content: `Turn a law-firm blog article's details into a short stock-photo search query (2-5 words, visual/concrete nouns, no legal jargon a photo can't depict — e.g. "courtroom gavel", "handshake contract signing", "law books library"). Respond with ONLY the search query as plain text — no quotes, no punctuation, no explanation.`,
        },
        { role: "user", content: `Title: ${title}\nCategory: ${category}\nExcerpt: ${excerpt || "(none)"}` },
      ],
      // gpt-oss-120b is a reasoning model — it spends tokens on hidden chain-of-thought
      // before the final answer, so a small max_tokens can leave zero room for the
      // actual reply and return empty content. Give it headroom.
      { temperature: 0.5, maxTokens: 300 }
    );
    const query = raw.trim().replace(/^["']|["']$/g, "");
    if (query) return query;
  } catch (err) {
    console.error("Search query generation failed, falling back to category:", err.message);
  }
  return category || title;
}

export async function suggestHeroImages({ title, category, excerpt }) {
  const accessKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!accessKey) throw new LlmError("UNSPLASH_ACCESS_KEY is not configured on the server.", 503);

  const query = await buildSearchQuery({ title, category, excerpt });

  const res = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=5&orientation=landscape`, {
    headers: { Authorization: `Client-ID ${accessKey}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new LlmError(`Unsplash search failed: ${res.status} ${body}`.trim(), res.status === 403 ? 429 : 502);
  }

  const data = await res.json();
  const results = (data.results || []).map((photo) => ({
    url: photo.urls.regular,
    thumbUrl: photo.urls.thumb,
    description: photo.alt_description || photo.description || query,
    photographer: photo.user?.name,
    photographerUrl: photo.user?.links?.html,
  }));

  return { query, results };
}
