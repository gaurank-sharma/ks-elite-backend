import { createStore } from "./store.js";

const teamStore = createStore("team");
const testimonialStore = createStore("testimonials");
const postsStore = createStore("posts");

// Static content that isn't in the CMS — pulled from the actual page copy so the
// bot never contradicts what a visitor can see on the site themselves. Source of
// truth for each block is noted below; if that page's copy changes, update here too.

// frontend/src/pages/About.jsx
const FIRM_STORY = `K.S. Elite Attorneys (legal name: Sharma & Associates) is a premier litigation firm headquartered in New Delhi, built on 24+ years of courtroom experience and a client-first philosophy.

Founder: Mr. K.S. Sharma. An advocate before the Supreme Court of India, multiple High Courts, District Courts, and Tribunals across Delhi, Haryana, and other jurisdictions. Practice spans criminal law, banking & financial disputes, corporate and commercial law, arbitration, civil litigation, and matrimonial & family law. Head — Dispute Resolution, Criminal Litigation Specialist. Law graduate, Lucknow University. His leadership is collaborative, solution-oriented, and client-focused. His own words: "My goal is not merely to win cases but to protect rights, resolve disputes efficiently, and support my clients through their most challenging legal battles."

Firm values: (1) Client-Centric — every matter handled with meticulous preparation and a results-driven mindset, built around the client's actual goals. (2) Precision Over Volume — the firm takes on matters it can give real attention to, not the most cases, the best-argued ones. (3) Protect, Then Win — the goal is not merely to win but to protect rights and resolve disputes efficiently along the way.`;

// frontend/src/components/TrustMarquee.jsx
const COURTS_AND_FORUMS = `The firm appears before: Supreme Court of India, Delhi High Court, District & Sessions Courts, NCLT/NCLAT, Debt Recovery Tribunal, Consumer Forums, and handles Arbitration & ADR matters.`;

// frontend/src/pages/PracticeAreas.jsx
const PRACTICE_AREAS = `Litigation & Disputes: Criminal Law (FIRs, bail, trials, appeals, cheque bounce, special statutes), Consumer Forum (district/state/national forums), Motor Vehicles (licensing, registration, permits, accident claims), Negotiable Instruments (cheque bounce, payment instrument disputes).
Corporate & Commercial: Business Law, Taxation Laws (direct/indirect, GST, customs, transfer pricing), NCLT/NCLAT, Debt Recovery Tribunal (bank/financial institution loan recovery), Intellectual Property Rights (copyright, design, patent, trademark).
Family & Personal: Family Law (matrimonial disputes, trusts, settlement deeds, wills), Insurance Law (disclosure obligations, claim disputes), Property Law (due diligence, registration, title verification, conveyancing).
Regulatory & Specialized: Labour Law (employment contracts, statutory benefits, HR audits), Drug Offenses, Sexual Offences, Cyber Crimes (fraud, data theft), Alternate Dispute Resolution.`;

// frontend/src/pages/Contact.jsx — two distinct numbers, don't conflate them.
const CONTACT_INFO = `Consultation phone line: +91 94670 45415. WhatsApp: +91 98919 67200 (also the number used by the "Book a Consultation" / WhatsApp buttons across the site). Email: support@kseliteattorneys.com. Consultations available 24/7; office hours Mon–Fri, 9:00 AM–6:00 PM.
Offices (all in Delhi): 45/1109, 1st Floor, DDA Flats, Kalkaji, Delhi-110019; Chamber No. 825, Lawyer's Block, Saket, Delhi; G-14, Opposite Anjali Jeweller, Kalkaji, New Delhi.
LinkedIn: linkedin.com/company/ks-elite-attorneys.
Per Bar Council of India rules, advocates may not solicit work or advertise — the website and this chat are for informational/educational purposes only, don't create an advocate-client relationship, and nothing here is legal advice.`;

// frontend/src/pages/Internship.jsx
const INTERNSHIP_INFO = `Internship program: interns assist on real, live matters before the Delhi High Court and subordinate courts; work directly under advocates with 6–30 years of courtroom experience; offline, online, or hybrid mode of internship available to fit a college schedule. Applications are via the /internship page (name, college, contact details, preferred month, optional resume upload).`;

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
    prompt: [
      `FIRM & FOUNDER:\n${FIRM_STORY}`,
      `COURTS & FORUMS:\n${COURTS_AND_FORUMS}`,
      `PRACTICE AREAS:\n${PRACTICE_AREAS}`,
      `CONTACT & OFFICES:\n${CONTACT_INFO}`,
      `INTERNSHIP PROGRAM:\n${INTERNSHIP_INFO}`,
      `CURRENT TEAM (senior associates, not the founder — see FIRM & FOUNDER above for Mr. K.S. Sharma):\n${teamText}`,
      `CLIENT TESTIMONIALS:\n${testimonialText}`,
      `PUBLISHED BLOG ARTICLES (mention by title when relevant; use get_article_content with the slug if the visitor needs more detail than the summary gives; link as kseliteattorneys.com/blog/<slug>):\n${postsText}`,
    ].join("\n\n"),
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
