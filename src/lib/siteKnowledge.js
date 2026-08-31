import { createStore } from "./store.js";

const teamStore = createStore("team");
const testimonialStore = createStore("testimonials");
const postsStore = createStore("posts");

// Static content that isn't in the CMS (practice areas, office/contact details —
// see frontend/src/pages/PracticeAreas.jsx and Contact.jsx, the source of truth).
const PRACTICE_AREAS = `Litigation & Disputes: Criminal Law (FIRs, bail, trials, appeals, cheque bounce, special statutes), Consumer Forum (district/state/national forums), Motor Vehicles (licensing, registration, permits, accident claims), Negotiable Instruments (cheque bounce, payment instrument disputes).
Corporate & Commercial: Business Law, Taxation Laws (direct/indirect, GST, customs, transfer pricing), NCLT/NCLAT, Debt Recovery Tribunal (bank/financial institution loan recovery), Intellectual Property Rights (copyright, design, patent, trademark).
Family & Personal: Family Law (matrimonial disputes, trusts, settlement deeds, wills), Insurance Law (disclosure obligations, claim disputes), Property Law (due diligence, registration, title verification, conveyancing).
Regulatory & Specialized: Labour Law (employment contracts, statutory benefits, HR audits), Drug Offenses, Sexual Offences, Cyber Crimes (fraud, data theft), Alternate Dispute Resolution.`;

const CONTACT_INFO = `Phone: +91 94670 45415. Email: support@kseliteattorneys.com. Consultations available 24/7.
Offices: 45/1109, 1st Floor, DDA Flats, Kalkaji, Delhi-110019; Chamber No. 825, Lawyer's Block, Saket, Delhi; G-14, Opposite Anjali Jeweller, Kalkaji, New Delhi.`;

let cache = null;
let cacheAt = 0;
const TTL_MS = 5 * 60 * 1000;
const MAX_POSTS_IN_PROMPT = 30;

// Invalidated on every admin write to team/testimonials/posts (see those routes)
// so the chatbot reflects new/edited content immediately rather than waiting
// out the TTL — the TTL is just a safety net against a missed invalidation.
export function invalidateSiteKnowledge() {
  cache = null;
}

export async function getSiteKnowledge() {
  const now = Date.now();
  if (cache && now - cacheAt < TTL_MS) return cache;

  const [team, testimonials, posts] = await Promise.all([teamStore.all(), testimonialStore.all(), postsStore.all()]);
  const publishedPosts = posts
    .filter((p) => p.published)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, MAX_POSTS_IN_PROMPT);

  const teamText = team.length
    ? team
        .map((m) => `- ${m.name}, ${m.title} (${m.exp} experience, ${m.education}). Handles: ${(m.tags || []).join(", ")}. ${m.bio}`)
        .join("\n")
    : "(no team members listed yet)";

  const testimonialText = testimonials.length
    ? testimonials.map((t) => `- "${t.quote}" — ${t.name}, ${t.role}`).join("\n")
    : "(none yet)";

  const postsText = publishedPosts.length
    ? publishedPosts
        .map((p) => `- "${p.title}" [slug: ${p.slug}] (${p.category}, ${new Date(p.date).toLocaleDateString("en-US", { month: "short", year: "numeric" })}): ${p.excerpt}`)
        .join("\n")
    : "(none published yet)";

  cache = {
    prompt: `PRACTICE AREAS:\n${PRACTICE_AREAS}\n\nCONTACT & OFFICES:\n${CONTACT_INFO}\n\nCURRENT TEAM:\n${teamText}\n\nCLIENT TESTIMONIALS:\n${testimonialText}\n\nPUBLISHED BLOG ARTICLES (mention by title when relevant; use get_article_content with the slug if the visitor needs more detail than the summary gives; link as kseliteattorneys.com/blog/<slug>):\n${postsText}`,
  };
  cacheAt = now;
  return cache;
}

export async function getArticleBySlug(slug) {
  const posts = await postsStore.all();
  const post = posts.find((p) => p.slug === slug && p.published);
  if (!post) return null;
  const plainText = (post.sections || [])
    .map((s) => (s.text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
    .join("\n\n");
  return { title: post.title, category: post.category, date: post.date, content: plainText.slice(0, 6000) };
}
