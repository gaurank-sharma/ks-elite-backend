// Thin client for an OpenAI-compatible chat completions API. Currently pointed
// at Groq's free tier (see .env.example) — swap LLM_BASE_URL/LLM_API_KEY/LLM_MODEL
// to use a different OpenAI-compatible provider (xAI, OpenAI, etc.) without
// touching callers.
const BASE_URL = process.env.LLM_BASE_URL || "https://api.groq.com/openai/v1";

export class LlmError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function callLlm(body) {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) throw new LlmError("LLM_API_KEY is not configured on the server.", 503);

  const model = process.env.LLM_MODEL || "openai/gpt-oss-120b";

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, ...body }),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const message = data?.error?.message || data?.error || `LLM request failed with status ${res.status}`;
    throw new LlmError(typeof message === "string" ? message : JSON.stringify(message), res.status);
  }

  return data?.choices?.[0]?.message;
}

// Returns the full response message (content + tool_calls, if any) — needed when
// the caller has to inspect/execute tool calls before producing a final reply.
export async function llmChatRaw(messages, { temperature = 0.7, maxTokens = 1024, json = false, tools = null } = {}) {
  const body = { messages, temperature, max_tokens: maxTokens };
  if (json) body.response_format = { type: "json_object" };
  if (tools) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const message = await callLlm(body);
  if (!message) throw new LlmError("The AI provider returned an empty response.", 502);
  return message;
}

// Convenience wrapper for the common case: no tools, just want the text back.
export async function llmChat(messages, options = {}) {
  const message = await llmChatRaw(messages, options);
  if (!message.content) throw new LlmError("The AI provider returned an empty response.", 502);
  return message.content;
}
