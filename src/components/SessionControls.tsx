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
              <span>Interrupt</span>
            </button>
          )}

          <button
            type="button"
            onClick={onStop}
            className="dock-pill-btn dock-pill-end min-h-[44px] min-w-[44px]"
            style={{ minHeight: "44px", minWidth: "44px" }}
          >
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
            style={{ minHeight: "38px", minWidth: "60px" }}
          >
            <span>Send</span>
          </button>
        </form>
      )}
    </footer>
  );
}
