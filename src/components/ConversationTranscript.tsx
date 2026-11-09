"use client";

import React, { useEffect, useRef } from "react";
import type { TranscriptItem } from "@/types/realtime";

export interface ConversationTranscriptProps {
  transcript: TranscriptItem[];
}

export function ConversationTranscript({
  transcript,
}: ConversationTranscriptProps) {
  const bottomAnchorRef = useRef<HTMLDivElement | null>(null);
  const lastItemText =
    transcript && transcript.length > 0
      ? transcript[transcript.length - 1].text
      : "";

  // Auto-scroll to latest message turn or streaming delta on mobile
  useEffect(() => {
    if (
      transcript &&
      transcript.length > 0 &&
      bottomAnchorRef.current &&
      typeof bottomAnchorRef.current.scrollIntoView === "function"
    ) {
      try {
        bottomAnchorRef.current.scrollIntoView({
          behavior: "smooth",
          block: "end",
        });
      } catch {
        // Ignore scrollIntoView errors in non-DOM test environments
      }
    }
  }, [transcript?.length, lastItemText, transcript]);

  if (!transcript || transcript.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center p-6 bg-white rounded-lg border border-gray-200 shadow-sm text-center"
        style={{ minHeight: "140px" }}
      >
        <span
          className="text-xs text-muted font-medium"
          style={{ color: "var(--text-muted)" }}
        >
          Conversation transcript will appear here when you speak.
        </span>
      </div>
    );
  }

  return (
    <div
      aria-label="Conversation Transcript"
      aria-live="polite"
      className="flex flex-col gap-3 p-4 bg-white rounded-lg border border-gray-200 shadow-sm"
    >
      {transcript.map((item) => {
        const isUser = item.role === "user";
        const isTranscribing = item.status === "transcribing";
        const isInterrupted = item.status === "interrupted";

        return (
          <div
            key={item.id}
            className={`flex flex-col gap-1 max-w-[85%] p-3 rounded-lg text-sm ${
              isUser
                ? "self-end bg-blue-600 text-white rounded-br-none ml-auto"
                : "self-start bg-slate-100 text-slate-900 rounded-bl-none mr-auto"
            }`}
            style={{
              alignSelf: isUser ? "flex-end" : "flex-start",
              backgroundColor: isUser ? "#2563eb" : "#f1f5f9",
              color: isUser ? "#ffffff" : "#0f172a",
              maxWidth: "85%",
              borderRadius: isUser
                ? "0.75rem 0.75rem 0.125rem 0.75rem"
                : "0.75rem 0.75rem 0.75rem 0.125rem",
              padding: "0.75rem 0.875rem",
            }}
          >
            <div className="flex items-center justify-between gap-2 text-xs font-semibold opacity-80">
              <span>{isUser ? "You" : "Assistant"}</span>
              {isInterrupted && (
                <span className="italic text-xs opacity-70">[Interrupted]</span>
              )}
            </div>

            {isTranscribing ? (
              <div className="flex items-center gap-2 italic text-xs py-1">
                <span className="animate-pulse">Transcribing...</span>
              </div>
            ) : (
              <p
                className="whitespace-pre-wrap break-words leading-relaxed"
                style={{ margin: 0, fontSize: "14px", lineHeight: 1.5 }}
              >
                {item.text}
              </p>
            )}
          </div>
        );
      })}
      <div ref={bottomAnchorRef} aria-hidden="true" />
    </div>
  );
}
