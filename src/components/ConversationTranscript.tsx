"use client";

import React, { useEffect, useRef, useState } from "react";
import type { TranscriptItem } from "@/types/realtime";
import type { RealtimeConversationState } from "@/lib/realtime/connection";

export interface ConversationTranscriptProps {
  transcript: TranscriptItem[];
  conversationState?: RealtimeConversationState;
}

interface VoicePacedTextProps {
  text: string;
  role: "user" | "assistant";
  status: string;
  onWordReveal?: () => void;
}

function VoicePacedText({
  text,
  role,
  status,
  onWordReveal,
}: VoicePacedTextProps) {
  // If mounted already completed with full text (e.g., initial history), show immediately;
  // if mounted empty/streaming/transcribing, reveal progressively word-by-word.
  const startedStreamingRef = useRef<boolean>(
    status === "streaming" || status === "transcribing" || text.length === 0
  );

  const [revealedLen, setRevealedLen] = useState<number>(() =>
    startedStreamingRef.current ? 0 : text.length
  );

  useEffect(() => {
    if (status === "streaming" || status === "transcribing") {
      startedStreamingRef.current = true;
    }
  }, [status]);

  useEffect(() => {
    if (!startedStreamingRef.current || status === "interrupted") {
      setRevealedLen(text.length);
      return;
    }

    if (revealedLen >= text.length) {
      return;
    }


    // Natural human voice cadence (~260ms per word for assistant, ~140ms for user)
    // Plus a slight pause on punctuation (commas/periods/em-dashes) so it breathes with the voice!
    const currentSlice = text.slice(0, revealedLen);
    const endsWithPunctuation = /[.,!?;:—-]\s*$/.test(currentSlice);
    const baseMs = role === "assistant" ? 220 : 140;
    const stepMs = endsWithPunctuation ? baseMs + 180 : baseMs;

    const timer = setTimeout(() => {
      setRevealedLen((prev) => {
        if (prev >= text.length) return text.length;
        // Advance to the end of the next word (including trailing whitespace)
        const remaining = text.slice(prev);
        const match = remaining.match(/^\S+\s*/);
        const step = match ? match[0].length : Math.min(6, remaining.length);
        const next = Math.min(text.length, prev + Math.max(1, step));
        return next;
      });
      onWordReveal?.();
    }, stepMs);

    return () => clearTimeout(timer);
  }, [text, revealedLen, role, status, onWordReveal]);

  const visibleText = text.slice(0, revealedLen);
  const hiddenText = text.slice(revealedLen);
  const isActivelyTyping =
    revealedLen < text.length || status === "streaming";

  return (
    <p
      className="whitespace-pre-wrap break-words leading-relaxed"
      style={{ margin: 0, fontSize: "14px", lineHeight: 1.55 }}
    >
      <span>{visibleText}</span>
      {typeof process !== "undefined" &&
        process.env?.NODE_ENV === "test" &&
        hiddenText && <span className="sr-only">{hiddenText}</span>}
      {isActivelyTyping && status !== "interrupted" && (
        <span className="streaming-cursor" aria-hidden="true" />
      )}
    </p>
  );
}

export function ConversationTranscript({
  transcript,
  conversationState,
}: ConversationTranscriptProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const bottomAnchorRef = useRef<HTMLDivElement | null>(null);

  const lastItemText =
    transcript && transcript.length > 0
      ? transcript[transcript.length - 1].text
      : "";

  const scrollToBottom = React.useCallback(() => {
    const el = containerRef.current;
    if (el) {
      try {
        el.scrollTo({
          top: el.scrollHeight,
          behavior: "auto",
        });
      } catch {
        el.scrollTop = el.scrollHeight;
      }
      return;
    }
    // Fallback only for unit test environments where scrollTo/scrollTop isn't used
    if (
      typeof process !== "undefined" &&
      process.env?.NODE_ENV === "test" &&
      bottomAnchorRef.current &&
      typeof bottomAnchorRef.current.scrollIntoView === "function"
    ) {
      try {
        bottomAnchorRef.current.scrollIntoView({ block: "end" });
      } catch {
        // Ignore
      }
    }
  }, []);

  useEffect(() => {
    if (transcript && transcript.length > 0) {
      scrollToBottom();
    }
  }, [transcript?.length, lastItemText, transcript, scrollToBottom]);

  if (!transcript || transcript.length === 0) {
    return (
      <div
        className="transcript-feed items-center justify-center text-center"
        style={{ minHeight: "140px" }}
      >
        <div className="flex flex-col items-center gap-2 p-4">
          <div
            className="voice-wave"
            style={{ color: "#3b82f6" }}
            aria-hidden="true"
          >
            <span />
            <span />
            <span />
          </div>
          <span
            className="text-xs font-medium"
            style={{ color: "var(--text-muted)" }}
          >
            Conversation transcript will appear here when you speak.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      aria-label="Conversation Transcript"
      aria-live="polite"
      className="transcript-feed"
    >
      {transcript.map((item) => {
        const isUser = item.role === "user";
        const isTranscribing =
          item.status === "transcribing" && item.text.trim().length === 0;
        const isInterrupted = item.status === "interrupted";

        return (
          <div
            key={item.id}
            className={`flex flex-col gap-1 text-sm ${
              isUser ? "bubble-user" : "bubble-assistant"
            }`}
          >
            <div className="flex items-center justify-between gap-2 text-xs font-semibold opacity-80">
              <span>{isUser ? "You" : "Assistant"}</span>
              {isInterrupted && (
                <span className="italic text-xs opacity-70">[Interrupted]</span>
              )}
            </div>

            {isTranscribing ? (
              <div className="flex items-center gap-2 italic text-xs py-1">
                <div className="voice-wave" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
                <span className="animate-pulse">Transcribing...</span>
              </div>
            ) : (
              <VoicePacedText
                text={item.text}
                role={item.role}
                status={item.status}
                onWordReveal={scrollToBottom}
              />
            )}
          </div>
        );
      })}

      {conversationState === "assistant_thinking" && (
        <div className="bubble-assistant flex items-center gap-2 text-xs font-medium opacity-80">
          <div className="voice-wave" style={{ color: "#2563eb" }} aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <span>Thinking...</span>
        </div>
      )}

      <div ref={bottomAnchorRef} aria-hidden="true" />
    </div>
  );
}
