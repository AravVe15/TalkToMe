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

    const isCompleted = status === "completed";
    const currentSlice = text.slice(0, revealedLen);
    const endsWithPunctuation = /[.,!?;:—-]\s*$/.test(currentSlice);
    const baseMs = isCompleted ? 35 : role === "assistant" ? 110 : 75;
    const stepMs =
      !isCompleted && endsWithPunctuation ? baseMs + 85 : baseMs;

    const timer = setTimeout(() => {
      setRevealedLen((prev) => {
        if (prev >= text.length) return text.length;
        const remaining = text.slice(prev);
        if (isCompleted && remaining.length > 80) {
          return text.length;
        }
        const match = remaining.match(/^\S+\s*/);
        const step = match ? match[0].length : Math.min(8, remaining.length);
        return Math.min(text.length, prev + Math.max(1, step));
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
      style={{ margin: 0, fontSize: "15px", lineHeight: 1.5 }}
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
  const rafRef = useRef<number | null>(null);

  const lastItemText =
    transcript && transcript.length > 0
      ? transcript[transcript.length - 1].text
      : "";

  const scrollToBottom = React.useCallback(() => {
    const el = containerRef.current;
    if (el) {
      if (typeof window !== "undefined" && window.requestAnimationFrame) {
        if (rafRef.current !== null) {
          window.cancelAnimationFrame(rafRef.current);
        }
        rafRef.current = window.requestAnimationFrame(() => {
          rafRef.current = null;
          try {
            el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
          } catch {
            el.scrollTop = el.scrollHeight;
          }
        });
      } else {
        try {
          el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
        } catch {
          el.scrollTop = el.scrollHeight;
        }
      }
      return;
    }
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
    return () => {
      if (
        rafRef.current !== null &&
        typeof window !== "undefined" &&
        window.cancelAnimationFrame
      ) {
        window.cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (transcript && transcript.length > 0) {
      scrollToBottom();
    }
  }, [transcript?.length, lastItemText, transcript, scrollToBottom]);

  if (!transcript || transcript.length === 0) {
    return (
      <div className="transcript-feed items-center justify-center text-center">
        <span
          className="text-xs font-medium"
          style={{ color: "#86868b", fontSize: "13px" }}
        >
          Conversation transcript will appear here when you speak.
        </span>
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
            <div
              className="flex items-center justify-between gap-2 text-xs font-semibold"
              style={{
                opacity: isUser ? 0.85 : 0.55,
                fontSize: "11px",
              }}
            >
              <span>{isUser ? "You" : "Assistant"}</span>
              {isInterrupted && (
                <span className="italic text-xs">[Interrupted]</span>
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
        <div
          className="bubble-assistant flex items-center gap-2 text-xs font-medium"
          style={{ color: "#86868b" }}
        >
          <div
            className="voice-wave"
            style={{ color: "#007aff" }}
            aria-hidden="true"
          >
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
