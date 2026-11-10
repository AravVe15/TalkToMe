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
    <footer className="ios-dock sticky-dock">
      {/* Microphone Unavailable Text Fallback Banner (AC-09.1) */}
      {showTextFallbackBanner && (
        <div
          role="status"
          className="p-2 bg-amber-50 border border-amber-200 text-amber-900 rounded-lg text-xs font-semibold text-center"
        >
          Microphone unavailable — using text chat mode
        </div>
      )}

      {/* Voice Action Pill Buttons Row (when connected) */}
      {isConnected && (
        <div className="flex items-center justify-between gap-2">
          {/* Mute / Unmute Button (AC-09.3) */}
          {showMuteButton && (
            <button
              type="button"
              onClick={onToggleMute}
              className={`dock-pill-btn ${
                isMuted ? "dock-pill-muted" : "dock-pill-mute"
              }`}
            >
              {isMuted ? (
                <svg
                  width="16"
                  height="16"
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
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              ) : (
                <svg
                  width="16"
                  height="16"
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
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              )}
              <span>{isMuted ? "Unmute" : "Mute"}</span>
            </button>
          )}

          {/* Manual Interrupt Button (AC-07.2) */}
          {isAssistantSpeaking && (
            <button
              type="button"
              onClick={onInterrupt}
              className="dock-pill-btn dock-pill-interrupt"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <rect x="6" y="6" width="12" height="12" rx="2.5" />
              </svg>
              <span>Interrupt</span>
            </button>
          )}

          {/* Stop / End Call Button (AC-06.2) */}
          <button
            type="button"
            onClick={onStop}
            className="dock-pill-btn dock-pill-end"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" />
              <line x1="22" y1="2" x2="2" y2="22" />
            </svg>
            <span>End Call</span>
          </button>
        </div>
      )}

      {/* iMessage-Style Text Input Pill (AC-09.2, AC-11.2) */}
      {(isTextFallback || isConnected) && (
        <form onSubmit={handleSubmit} className="ios-input-pill">
          <input
            type="text"
            aria-label="Message text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Type a message..."
            className="ios-input-field"
          />
          <button
            type="submit"
            disabled={!inputText.trim()}
            className={`ios-send-btn ${
              inputText.trim()
                ? "ios-send-btn-active"
                : "ios-send-btn-disabled"
            }`}
          >
            <span>Send</span>
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
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
          </button>
        </form>
      )}
    </footer>
  );
}
