/**
 * POST /api/realtime/session Route Handler (ADR-04, ADR-05, ADR-10 / AC-04, AC-05, AC-10.1).
 *
 * Mints a short-lived ephemeral token from OpenAI's Realtime REST API
 * (`POST https://api.openai.com/v1/realtime/sessions`) using the server-side
 * `OPENAI_API_KEY`. Never exposes the secret API key to the client.
 */

import {
  MAX_REALTIME_CONTEXT_CHARS,
  buildSessionInstructions,
} from "@/lib/realtime/context";
import type {
  RealtimeSessionError,
  RealtimeSessionErrorCode,
  RealtimeSessionSuccess,
} from "@/types/realtime";

export const runtime = "nodejs";

const OPENAI_REALTIME_SESSIONS_URL =
  "https://api.openai.com/v1/realtime/sessions";
const DEFAULT_REALTIME_MODEL = "gpt-4o-mini-realtime-preview";
const STABLE_GA_REALTIME_MODEL = "gpt-realtime";
const DEFAULT_REALTIME_VOICE = "alloy";
const SESSION_MINT_TIMEOUT_MS = 15_000;

function isDeprecatedPreviewModel(modelName?: string): boolean {
  if (!modelName) return false;
  const lower = modelName.toLowerCase().trim();
  return (
    lower.includes("preview") ||
    lower.startsWith("gpt-4o-realtime") ||
    lower.startsWith("gpt-4o-mini-realtime")
  );
}

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
} as const;

function jsonError(
  code: RealtimeSessionErrorCode,
  message: string,
  status: number,
  retryable: boolean
): Response {
  return Response.json(
    {
      ok: false,
      code,
      message,
      retryable,
    } satisfies RealtimeSessionError,
    {
      status,
      headers: NO_STORE_HEADERS,
    }
  );
}

export async function POST(req: Request): Promise<Response> {
  // AC-04.1: Read OPENAI_API_KEY strictly on the server
  const rawApiKey = process.env.OPENAI_API_KEY;
  const apiKey = typeof rawApiKey === "string" ? rawApiKey.trim() : "";

  if (!apiKey) {
    return jsonError(
      "SERVER_MISCONFIGURED",
      "Server is misconfigured: OPENAI_API_KEY is missing or not configured.",
      500,
      false
    );
  }

  // Parse and validate client request body
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return jsonError(
      "INVALID_REQUEST",
      "Unable to read request body.",
      400,
      false
    );
  }

  if (!rawBody || !rawBody.trim()) {
    return jsonError(
      "INVALID_REQUEST",
      "Request body is empty. Please provide a JSON object with source 'text'.",
      400,
      false
    );
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return jsonError(
      "INVALID_REQUEST",
      "Malformed JSON in request body.",
      400,
      false
    );
  }

  if (
    typeof parsedBody !== "object" ||
    parsedBody === null ||
    Array.isArray(parsedBody)
  ) {
    return jsonError(
      "INVALID_REQUEST",
      "Request body must be a JSON object.",
      400,
      false
    );
  }

  const body = parsedBody as Record<string, unknown>;
  if (typeof body.text !== "string" || body.text.trim().length === 0) {
    return jsonError(
      "INVALID_REQUEST",
      "A non-empty string 'text' property is required to initialize a Realtime session.",
      400,
      false
    );
  }

  const text = body.text;
  const title = typeof body.title === "string" ? body.title : undefined;
  const sourceType =
    typeof body.sourceType === "string" ? body.sourceType : undefined;
  const voice =
    typeof body.voice === "string" && body.voice.trim().length > 0
      ? body.voice.trim()
      : DEFAULT_REALTIME_VOICE;

  const envModel =
    typeof process.env.OPENAI_REALTIME_MODEL === "string" &&
      process.env.OPENAI_REALTIME_MODEL.trim().length > 0
      ? process.env.OPENAI_REALTIME_MODEL.trim()
      : undefined;

  const requestedModel =
    typeof body.model === "string" && body.model.trim().length > 0
      ? body.model.trim()
      : undefined;

  // Active realtime model: environment override takes precedence (e.g. gpt-realtime-2.1-mini, gpt-realtime-2.1),
  // followed by optional request-level override, falling back to default preview model for test backwards compatibility.
  const model = envModel ?? requestedModel ?? DEFAULT_REALTIME_MODEL;

  // AC-05.1 – AC-05.3: Build grounded session instructions with 48,000-char safe cap
  const prepared = buildSessionInstructions({
    text,
    title,
    sourceType,
  });
  const instructions =
    typeof prepared === "string" ? prepared : prepared.instructions;
  const isContextTruncated =
    typeof prepared === "string"
      ? text.length > MAX_REALTIME_CONTEXT_CHARS
      : prepared.isContextTruncated;

  // AC-04.2 / ADR-04: Server VAD configuration (supports calibrated threshold 0.8 / silence 600ms via body or env)
  const clientVad = (
    typeof body.turn_detection === "object" && body.turn_detection !== null
      ? body.turn_detection
      : typeof body.turnDetection === "object" && body.turnDetection !== null
        ? body.turnDetection
        : undefined
  ) as Record<string, unknown> | undefined;

  const vadThreshold =
    typeof clientVad?.threshold === "number"
      ? clientVad.threshold
      : typeof body.threshold === "number"
        ? body.threshold
        : typeof process.env.OPENAI_REALTIME_VAD_THRESHOLD === "string" &&
          !isNaN(parseFloat(process.env.OPENAI_REALTIME_VAD_THRESHOLD))
          ? parseFloat(process.env.OPENAI_REALTIME_VAD_THRESHOLD)
          : 0.8;

  const vadSilenceDurationMs =
    typeof clientVad?.silence_duration_ms === "number"
      ? clientVad.silence_duration_ms
      : typeof body.silence_duration_ms === "number"
        ? body.silence_duration_ms
        : typeof body.silenceDurationMs === "number"
          ? body.silenceDurationMs
          : typeof process.env.OPENAI_REALTIME_VAD_SILENCE_MS === "string" &&
            !isNaN(parseInt(process.env.OPENAI_REALTIME_VAD_SILENCE_MS, 10))
            ? parseInt(process.env.OPENAI_REALTIME_VAD_SILENCE_MS, 10)
            : 600;

  const vadPrefixPaddingMs =
    typeof clientVad?.prefix_padding_ms === "number"
      ? clientVad.prefix_padding_ms
      : typeof body.prefix_padding_ms === "number"
        ? body.prefix_padding_ms
        : 300;

  const vadCreateResponse =
    typeof clientVad?.create_response === "boolean"
      ? clientVad.create_response
      : typeof body.create_response === "boolean"
        ? body.create_response
        : true;

  const vadInterruptResponse =
    typeof clientVad?.interrupt_response === "boolean"
      ? clientVad.interrupt_response
      : typeof body.interrupt_response === "boolean"
        ? body.interrupt_response
        : true;

  const turnDetectionConfig = {
    type: "server_vad",
    threshold: vadThreshold,
    prefix_padding_ms: vadPrefixPaddingMs,
    silence_duration_ms: vadSilenceDurationMs,
    create_response: vadCreateResponse,
    interrupt_response: vadInterruptResponse,
  };

  // AC-04.2: Construct official OpenAI Realtime session configuration
  const openAiPayload = {
    model,
    modalities: ["audio", "text"],
    voice,
    instructions,
    input_audio_noise_reduction: {
      type: "far_field",
    },
    input_audio_transcription: {
      model: "whisper-1",
    },
    turn_detection: turnDetectionConfig,
  };

  // AC-10.1: Enforce 15,000 ms AbortController timeout on session token minting
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, SESSION_MINT_TIMEOUT_MS);

  let upstreamRes: Response;
  let gaModelUsed = false;
  let effectiveGaModel = STABLE_GA_REALTIME_MODEL;
  try {
    upstreamRes = await fetch(OPENAI_REALTIME_SESSIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(openAiPayload),
      signal: controller.signal,
    });

    if (upstreamRes.status === 404 || upstreamRes.status === 400) {
      const cloned = upstreamRes.clone();
      const errJson = (await cloned.json().catch(() => null)) as {
        error?: { message?: string; code?: string };
      } | null;
      const errMsg = errJson?.error?.message || "";
      const errCode = errJson?.error?.code || "";
      if (
        upstreamRes.status === 404 ||
        errMsg.includes("Invalid URL") ||
        errCode === "model_not_found" ||
        errMsg.includes("does not exist")
      ) {
        // Resolve GA Realtime model: if candidate model is configured and not a deprecated preview model,
        // use it (e.g. gpt-realtime-2.1-mini, gpt-realtime-2.1); otherwise safely fall back to verified stable model "gpt-realtime".
        const candidateModel = envModel ?? requestedModel;
        const gaModel =
          candidateModel && !isDeprecatedPreviewModel(candidateModel)
            ? candidateModel
            : STABLE_GA_REALTIME_MODEL;

        effectiveGaModel = gaModel;
        gaModelUsed = true;

        upstreamRes = await fetch(
          "https://api.openai.com/v1/realtime/client_secrets",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              session: {
                type: "realtime",
                model: gaModel,
                instructions,
                audio: {
                  input: {
                    noise_reduction: {
                      type: "far_field",
                    },
                    transcription: {
                      model: "whisper-1",
                    },
                    turn_detection: turnDetectionConfig,
                  },
                  output: {
                    voice,
                  },
                },
              },
            }),
            signal: controller.signal,
          }
        );
      }
    }
  } catch (err: unknown) {
    const isTimeoutOrAbort =
      (err instanceof DOMException && err.name === "AbortError") ||
      (err instanceof Error &&
        (err.name === "AbortError" ||
          err.name === "TimeoutError" ||
          /abort|timed?\s*out/i.test(err.message)));

    if (isTimeoutOrAbort) {
      return jsonError(
        "UPSTREAM_TIMEOUT",
        "Request to OpenAI Realtime session service timed out. Please try again.",
        504,
        true
      );
    }

    return jsonError(
      "UPSTREAM_ERROR",
      "Failed to connect to OpenAI Realtime session service due to a network error. Please try again.",
      503,
      true
    );
  } finally {
    clearTimeout(timeoutId);
  }

  // Handle upstream non-2xx responses without leaking secrets
  if (!upstreamRes.ok) {
    const status = upstreamRes.status;

    if (status === 401 || status === 403) {
      return jsonError(
        "UPSTREAM_ERROR",
        "OpenAI authentication failed. Please verify the server API key configuration.",
        502,
        false
      );
    }

    if (status === 429) {
      return jsonError(
        "UPSTREAM_ERROR",
        "OpenAI Realtime rate limit exceeded. Please slow down and try again shortly.",
        429,
        true
      );
    }

    if (status >= 500) {
      return jsonError(
        "UPSTREAM_ERROR",
        "OpenAI Realtime service encountered a server error and is temporarily unavailable. Please try again.",
        502,
        true
      );
    }

    let upstreamDetail = "";
    try {
      const errBody = (await upstreamRes.json()) as {
        error?: { message?: string; param?: string; code?: string; type?: string };
      };
      if (errBody?.error) {
        const safeMsg = (errBody.error.message || "")
          .replaceAll(apiKey, "[REDACTED]")
          .replace(/sk-[a-zA-Z0-9_-]+/g, "[REDACTED]");
        upstreamDetail = ` (msg=${safeMsg}, type=${errBody.error.type}, code=${errBody.error.code}, param=${errBody.error.param})`;
      }
    } catch {
      // Ignore non-JSON error body
    }

    return jsonError(
      "UPSTREAM_ERROR",
      `OpenAI Realtime rejected the session request parameters.${upstreamDetail}`,
      400,
      false
    );
  }

  // Parse and validate upstream 200 OK payload
  let upstreamJson: unknown;
  try {
    const rawUpstreamText = await upstreamRes.text();
    upstreamJson = JSON.parse(rawUpstreamText);
  } catch {
    return jsonError(
      "UPSTREAM_ERROR",
      "Upstream OpenAI response was not valid JSON and lacked a client_secret ephemeral token.",
      502,
      true
    );
  }

  const sessionData =
    typeof upstreamJson === "object" && upstreamJson !== null
      ? (upstreamJson as Record<string, unknown>)
      : null;

  const nestedSession =
    sessionData &&
      typeof sessionData.session === "object" &&
      sessionData.session !== null
      ? (sessionData.session as Record<string, unknown>)
      : null;

  const clientSecret =
    sessionData &&
      typeof sessionData.client_secret === "object" &&
      sessionData.client_secret !== null
      ? (sessionData.client_secret as Record<string, unknown>)
      : nestedSession &&
        typeof nestedSession.client_secret === "object" &&
        nestedSession.client_secret !== null
        ? (nestedSession.client_secret as Record<string, unknown>)
        : null;

  const ephemeralKey =
    clientSecret && typeof clientSecret.value === "string"
      ? clientSecret.value.trim()
      : sessionData && typeof sessionData.value === "string"
        ? sessionData.value.trim()
        : "";

  if (!ephemeralKey) {
    return jsonError(
      "UPSTREAM_ERROR",
      "Upstream OpenAI response was missing a valid client_secret ephemeral token.",
      502,
      true
    );
  }

  const expiresAt =
    clientSecret && typeof clientSecret.expires_at === "number"
      ? clientSecret.expires_at
      : sessionData && typeof sessionData.expires_at === "number"
        ? sessionData.expires_at
        : 0;

  const resolvedModel =
    sessionData &&
      typeof sessionData.model === "string" &&
      sessionData.model.trim().length > 0
      ? sessionData.model.trim()
      : nestedSession &&
        typeof nestedSession.model === "string" &&
        nestedSession.model.trim().length > 0
        ? nestedSession.model.trim()
        : gaModelUsed
          ? effectiveGaModel
          : model;

  // AC-04.3: Return ephemeralKey, expiresAt, model, and isContextTruncated with Cache-Control: no-store
  return Response.json(
    {
      ok: true,
      ephemeralKey,
      expiresAt,
      model: resolvedModel,
      isContextTruncated,
    } satisfies RealtimeSessionSuccess,
    {
      status: 200,
      headers: NO_STORE_HEADERS,
    }
  );
}
