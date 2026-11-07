/**
 * Test fixtures and mock data for Realtime Session test suites (Slice 2).
 * Derived strictly from requirements.md (AC-04, AC-05, AC-10.1) and decisions.md (ADR-04, ADR-05, ADR-10).
 */

export const MOCK_OPENAI_SESSION_RESPONSE = {
  id: "sess_mock_test_12345",
  object: "realtime.session",
  model: "gpt-4o-realtime-preview",
  modalities: ["audio", "text"],
  instructions: "You are a helpful voice assistant grounded in the provided document...",
  voice: "alloy",
  input_audio_format: "pcm16",
  output_audio_format: "pcm16",
  input_audio_transcription: {
    model: "whisper-1",
  },
  turn_detection: {
    type: "server_vad",
    threshold: 0.5,
    prefix_padding_ms: 300,
    silence_duration_ms: 500,
    create_response: true,
    interrupt_response: true,
  },
  tools: [],
  tool_choice: "auto",
  temperature: 0.8,
  max_response_output_tokens: "inf",
  client_secret: {
    value: "ek_mock_client_secret_token_1234567890abcdef",
    expires_at: 1731000600,
  },
};

export const MOCK_OPENAI_CUSTOM_MODEL_RESPONSE = {
  ...MOCK_OPENAI_SESSION_RESPONSE,
  model: "gpt-4o-realtime-preview-2024-12-17",
  client_secret: {
    value: "ek_mock_custom_model_token_abcdef123456",
    expires_at: 1731000900,
  },
};

export const MOCK_OPENAI_401_UNAUTHORIZED = {
  error: {
    message: "Incorrect API key provided: sk-inv***. You can find your API key at https://platform.openai.com/account/api-keys.",
    type: "invalid_request_error",
    param: null,
    code: "invalid_api_key",
  },
};

export const MOCK_OPENAI_429_RATE_LIMIT = {
  error: {
    message: "Rate limit reached for requests. Please slow down your requests.",
    type: "requests",
    param: null,
    code: "rate_limit_exceeded",
  },
};

export const MOCK_OPENAI_500_SERVER_ERROR = {
  error: {
    message: "The server had an error processing your request. Sorry about that! You can retry your request.",
    type: "server_error",
    param: null,
    code: null,
  },
};

export const MOCK_OPENAI_400_BAD_PARAM = {
  error: {
    message: "Unknown parameter: 'invalid_field'",
    type: "invalid_request_error",
    param: "invalid_field",
    code: "unknown_parameter",
  },
};

export const HTML_502_BAD_GATEWAY = `
<!DOCTYPE html>
<html>
<head><title>502 Bad Gateway</title></head>
<body>
<center><h1>502 Bad Gateway</h1></center>
<hr><center>cloudflare</center>
</body>
</html>
`.trim();

/**
 * Deterministically generates an exact character-length ASCII string for boundary testing.
 */
export function createExactLengthText(length: number, prefix: string = "X"): string {
  if (length <= 0) return "";
  const base = prefix || "X";
  const repetitions = Math.floor(length / base.length);
  const remainder = length % base.length;
  return base.repeat(repetitions) + base.slice(0, remainder);
}

/**
 * Creates a standard POST Request for the /api/realtime/session endpoint.
 */
export function createSessionRequest(
  body: unknown,
  headers: Record<string, string> = { "Content-Type": "application/json" }
): Request {
  const isString = typeof body === "string";
  return new Request("http://localhost/api/realtime/session", {
    method: "POST",
    headers: new Headers(headers),
    body: isString ? body : JSON.stringify(body),
  });
}
