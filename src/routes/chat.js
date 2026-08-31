import { Router } from "express";
import { llmChatRaw, LlmError } from "../lib/llm.js";
import { createStore } from "../lib/store.js";
import { notifyLead } from "../lib/mailer.js";

const router = Router();
const contactStore = createStore("contacts");

const SYSTEM_PROMPT = `You are the website assistant for K.S. Elite Attorneys, a law firm in Delhi, India.

Firm facts:
- Practice areas: Bail, Cheque Bounce, Civil, Criminal, Family, Writ, Supreme Court & High Court matters, Tribunals, RTI, Corporate, Banking, Service Matters.
- Offices: Kalkaji, Saket, and another Kalkaji location — all in Delhi.
- Phone: +91 94670 45415. Email: support@kseliteattorneys.com. Consultations available 24/7.

Your job: answer visitor questions about the firm, its practice areas, and general legal process/terminology in plain language. Be concise and warm, like a helpful front-desk paralegal.

You can also book a consultation appointment directly using the book_appointment tool:
- Collect the visitor's full name and phone number at minimum — ask for both if missing.
- Also try to get their preferred date/time and the nature of their matter, but don't block the booking on these if the visitor doesn't offer them.
- Once you have name and phone, call book_appointment. After it succeeds, confirm the booking to the visitor and let them know the team will call to confirm details.
- If the tool reports an error, tell the visitor what's missing and ask for it.

Rules:
- Never give specific legal advice or predict case outcomes — general information only.
- For anything specific to a visitor's situation, encourage them to book a consultation (via the tool, phone, or WhatsApp).
- Keep replies short (2-4 sentences) unless the question needs more detail.`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "book_appointment",
      description:
        "Book a consultation appointment with K.S. Elite Attorneys. Call this once the visitor has provided at least their name and phone number.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Visitor's full name" },
          phone: { type: "string", description: "Visitor's phone number" },
          matter: { type: "string", description: "Nature of the legal matter, if mentioned" },
          preferredDate: { type: "string", description: "Preferred date, in whatever format the visitor gave" },
          preferredTime: { type: "string", description: "Preferred time, in whatever format the visitor gave" },
          notes: { type: "string", description: "Any other relevant context worth passing to the team" },
        },
        required: ["name", "phone"],
      },
    },
  },
];

const MAX_MESSAGES = 16;
const MAX_CONTENT_LENGTH = 2000;
const MAX_TOOL_ROUNDS = 3;

async function bookAppointment(args) {
  const name = String(args?.name ?? "").trim();
  const phone = String(args?.phone ?? "").trim();
  if (!name || !phone) return { error: "Missing name or phone — ask the visitor for both before booking." };

  const message = [
    args.notes ? String(args.notes).trim() : null,
    args.preferredDate ? `Preferred date: ${String(args.preferredDate).trim()}` : null,
    args.preferredTime ? `Preferred time: ${String(args.preferredTime).trim()}` : null,
  ]
    .filter(Boolean)
    .join(" · ") || "Booked via website chatbot";

  const record = await contactStore.append({
    name,
    phone,
    matter: args.matter ? String(args.matter).trim() : "",
    message,
    status: "new",
    source: "chatbot",
  });

  notifyLead(`New chatbot appointment — ${record.name}`, [
    `Name: ${record.name}`,
    `Phone: ${record.phone}`,
    `Matter: ${record.matter || "—"}`,
    `Details: ${record.message}`,
    `Booked via: website chatbot`,
    `Received: ${record.receivedAt}`,
  ]);

  return { ok: true, confirmationId: record.id };
}

router.post("/", async (req, res) => {
  const { messages } = req.body ?? {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages must be a non-empty array." });
  }

  const cleaned = messages
    .slice(-MAX_MESSAGES)
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.trim().slice(0, MAX_CONTENT_LENGTH) }));

  if (cleaned.length === 0) {
    return res.status(400).json({ error: "No valid messages provided." });
  }

  const convo = [{ role: "system", content: SYSTEM_PROMPT }, ...cleaned];

  try {
    let message = await llmChatRaw(convo, { temperature: 0.6, maxTokens: 500, tools: TOOLS });
    let rounds = 0;

    while (message.tool_calls?.length && rounds < MAX_TOOL_ROUNDS) {
      convo.push({ role: "assistant", content: message.content || null, tool_calls: message.tool_calls });

      for (const call of message.tool_calls) {
        let result;
        try {
          const args = JSON.parse(call.function.arguments || "{}");
          result = call.function.name === "book_appointment" ? await bookAppointment(args) : { error: "Unknown tool." };
        } catch (err) {
          result = { error: `Failed to process: ${err.message}` };
        }
        convo.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }

      message = await llmChatRaw(convo, { temperature: 0.6, maxTokens: 500, tools: TOOLS });
      rounds++;
    }

    if (!message.content) throw new LlmError("The AI provider returned an empty response.", 502);
    res.json({ reply: message.content });
  } catch (err) {
    if (err instanceof LlmError) return res.status(err.status).json({ error: err.message });
    console.error("Chat error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

export default router;
