"use client";

import React, { useState } from "react";
import type {
  RealtimeConnectionState,
  RealtimeConversationState,
} from "@/lib/realtime/connection";
import type { MicStatus } from "@/lib/realtime/controls";

export interface SessionControlsProps {
  connectionState: RealtimeConnectionState;
  conversationState?: RealtimeConversationState;
  micStatus?: MicStatus;
  isMuted?: boolean;
  isTextFallback?: boolean;
  onToggleMute?: () => void;
  onInterrupt?: () => void;
  onStop?: () => void;
  onSendText?: (text: string) => void;
}

export function SessionControls({
  connectionState,
  conversationState = "listening",
  micStatus = "available",
  isMuted = false,
  isTextFallback = false,
  onToggleMute,
  onInterrupt,
  onStop,
  onSendText,
}: SessionControlsProps) {
  const [inputText, setInputText] = useState("");
  const isConnected = connectionState === "connected";
  const showTextFallbackBanner = isTextFallback || micStatus === "unavailable";
  const isAssistantSpeaking = conversationState === "assistant_speaking";
  const showMuteButton = isConnected && !showTextFallbackBanner;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputText.trim();
    if (trimmed && onSendText) {
      onSendText(trimmed);
      setInputText("");
    }
  };

  if (!isConnected && !isTextFallback) {
    return null;
  }

  return (
    <footer className="ios-dock sticky-dock sticky bottom-0">
      {showTextFallbackBanner && (
        <div role="status" className="apple-alert-warning text-center">
          Microphone unavailable — using text chat mode
        </div>
      )}

      {isConnected && (
        <div className="flex items-center justify-between gap-2">
          {showMuteButton && (
            <button
              type="button"
              onClick={onToggleMute}
              className={`dock-pill-btn min-h-[44px] min-w-[44px] ${
                isMuted ? "dock-pill-muted" : "dock-pill-mute"
              }`}
              style={{ minHeight: "44px", minWidth: "44px" }}
            >
              {isMuted ? (
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <line x1="1" y1="1" x2="23" y2="23" />
                  <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                  <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
                </svg>
              ) : (
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                </svg>
              )}
              <span>{isMuted ? "Unmute" : "Mute"}</span>
            </button>
          )}

          {isAssistantSpeaking && (
            <button
              type="button"
              onClick={onInterrupt}
              className="dock-pill-btn dock-pill-interrupt min-h-[44px] min-w-[44px]"
              style={{ minHeight: "44px", minWidth: "44px" }}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <rect x="6" y="6" width="12" height="12" rx="2.5" />
              </svg>
              <span>Interrupt</span>
            </button>
          )}

          <button
            type="button"
            onClick={onStop}
            className="dock-pill-btn dock-pill-end min-h-[44px] min-w-[44px]"
            style={{ minHeight: "44px", minWidth: "44px" }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            <span>End Call</span>
          </button>
        </div>
      )}

      {(isTextFallback || isConnected) && (
        <form onSubmit={handleSubmit} className="ios-input-pill">
          <input
            type="text"
            aria-label="Message text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Type a message..."
            className="ios-input-field text-base"
            style={{ fontSize: "16px" }}
          />
          <button
            type="submit"
            disabled={!inputText.trim()}
            className={`ios-send-btn min-h-[44px] min-w-[44px] ${
              inputText.trim()
                ? "ios-send-btn-active"
                : "ios-send-btn-disabled"
            }`}
            style={{ minHeight: "36px", minWidth: "60px" }}
          >
            <span>Send</span>
          </button>
        </form>
      )}
    </footer>
  );
}
