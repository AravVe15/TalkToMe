/**
 * Direct Context Priming & 48,000-Character Safe Cap (ADR-05 / AC-05).
 *
 * Embeds the extracted document or transcript text directly into the OpenAI
 * Realtime `session.instructions` prompt without chunking, summarization, or RAG.
 * Enforces a 48,000-character (~12,000-token) ceiling to stay safely within
 * OpenAI's 16,384 instruction token limit.
 */

export const MAX_REALTIME_CONTEXT_CHARS = 48_000;

export interface PreparedContext {
  instructions: string;
  isContextTruncated: boolean;
  charCount: number;
}

export function buildSessionInstructions(params: {
  text: string;
  title?: string;
  sourceType?: "pdf" | "youtube" | string;
}): PreparedContext {
  const rawText = typeof params.text === "string" ? params.text : "";
  const totalChars = rawText.length;
  const isContextTruncated = totalChars > MAX_REALTIME_CONTEXT_CHARS;
  const preparedText = isContextTruncated
    ? rawText.slice(0, MAX_REALTIME_CONTEXT_CHARS)
    : rawText;
  const charCount = preparedText.length;

  const title =
    typeof params.title === "string" && params.title.trim().length > 0
      ? params.title.trim()
      : "Untitled Source";

  const sourceType =
    typeof params.sourceType === "string" && params.sourceType.trim().length > 0
      ? params.sourceType.trim()
      : "document";

  const truncationNotice = isContextTruncated
    ? `\nNote: The original source contained ${totalChars} characters and has been capped at the first ${MAX_REALTIME_CONTEXT_CHARS} characters for this live voice session.`
    : "";

  const instructions = [
    "You are a helpful, natural, and conversational voice assistant.",
    "Your role is to help the user explore and understand the provided source document or video transcript through live spoken dialogue.",
    "",
    "Grounding & Voice Rules:",
    "1. Base your answers strictly on the provided source context below.",
    "2. If the user asks about a topic or detail that is not covered, not mentioned, or not provided in the source context, clearly state that you cannot find that information in the provided source rather than guessing or inventing facts.",
    "3. Speak in a concise, natural, conversational voice style suitable for real-time spoken interaction.",
    "",
    "Source Metadata:",
    `- Source Title: ${title}`,
    `- Source Type: ${sourceType}${truncationNotice}`,
    "",
    "--- BEGIN SOURCE CONTEXT ---",
    preparedText,
    "--- END SOURCE CONTEXT ---",
  ].join("\n");

  return {
    instructions,
    isContextTruncated,
    charCount,
  };
}
