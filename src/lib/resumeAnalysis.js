import { llmChat } from "./llm.js";

const SYSTEM_PROMPT = `You are screening internship applications for K.S. Elite Attorneys, a Delhi litigation firm. Interns assist on real casework (bail, cheque bounce, civil, criminal, family, writ matters, tribunals) under practicing advocates.

You'll receive the applicant's resume text and the application details (college, mode, preferred month). Assess general fit: relevant education (law/legal studies preferred but not mandatory for early-year students), any legal or relevant internship/work experience, communication quality of the resume, and overall promise as a law intern. Do not penalize for lack of experience alone — many applicants are students.

Respond with ONLY a JSON object:
{
  "score": number from 0-100,
  "verdict": one of "Strong Fit", "Possible Fit", "Not a Fit",
  "summary": "one or two sentences explaining the assessment"
}`;

// Best-effort — a resume that fails to parse or an LLM call that fails should
// never block the application itself from being saved.
export async function analyzeResume({ resumeText, college, mode, month }) {
  const userPrompt = `College: ${college}\nMode of Internship: ${mode}\nPreferred month: ${month}\n\nResume text:\n${(resumeText || "(no resume text extracted)").slice(0, 8000)}`;

  try {
    const raw = await llmChat(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0.4, maxTokens: 300, json: true }
    );
    const parsed = JSON.parse(raw);
    const score = Number(parsed.score);
    if (!Number.isFinite(score) || !parsed.verdict) return null;
    return {
      score: Math.max(0, Math.min(100, Math.round(score))),
      verdict: parsed.verdict,
      summary: parsed.summary || "",
    };
  } catch (err) {
    console.error("Resume analysis failed:", err.message);
    return null;
  }
}
