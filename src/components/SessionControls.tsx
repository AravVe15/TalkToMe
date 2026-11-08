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

  // Do not render controls dock if not connected and not in text fallback mode
  if (!isConnected && !isTextFallback) {
    return null;
  }

  return (
    <footer
      className="sticky bottom-0 left-0 right-0 p-3 bg-white/95 backdrop-blur border-t border-gray-200 shadow-lg flex flex-col gap-2 z-10 sticky-dock"
      style={{
        position: "sticky",
        bottom: 0,
        backgroundColor: "rgba(255, 255, 255, 0.95)",
        borderTop: "1px solid #e2e8f0",
        paddingBottom:
          "calc(0.75rem + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)))",
      }}
    >
      {/* Microphone Unavailable Text Fallback Banner (AC-09.1) */}
      {showTextFallbackBanner && (
        <div
          role="status"
          className="p-2 bg-amber-50 border border-amber-200 text-amber-900 rounded-md text-xs font-semibold text-center"
          style={{
            backgroundColor: "#fffbeb",
            borderColor: "#fde68a",
            color: "#78350f",
          }}
        >
          Microphone unavailable — using text chat mode
        </div>
      )}

      {/* Voice Action Buttons Row (when connected) */}
      {isConnected && (
        <div className="flex items-center justify-between gap-2">
          {/* Mute / Unmute Button (AC-09.3) */}
          {showMuteButton && (
            <button
              type="button"
              onClick={onToggleMute}
              className={`min-h-[44px] min-w-[44px] py-3 px-4 font-semibold text-sm rounded-md border flex-1 ${
                isMuted
                  ? "bg-amber-50 border-amber-300 text-amber-900"
                  : "bg-slate-50 border-gray-200 text-slate-800"
              }`}
              style={{
                minHeight: "44px",
                minWidth: "44px",
                backgroundColor: isMuted ? "#fffbeb" : "#f8fafc",
                borderColor: isMuted ? "#fde68a" : "#e2e8f0",
              }}
            >
              {isMuted ? "Unmute" : "Mute"}
            </button>
          )}

          {/* Manual Interrupt Button (AC-07.2) */}
          {isAssistantSpeaking && (
            <button
              type="button"
              onClick={onInterrupt}
              className="min-h-[44px] min-w-[44px] py-3 px-4 font-bold text-sm text-white bg-amber-600 rounded-md flex-1"
              style={{
                minHeight: "44px",
                minWidth: "44px",
                backgroundColor: "#d97706",
                color: "#ffffff",
              }}
            >
              Interrupt
            </button>
          )}

          {/* Stop / End Call Button (AC-06.2) */}
          <button
            type="button"
            onClick={onStop}
            className="min-h-[44px] min-w-[44px] py-3 px-4 font-bold text-sm text-white bg-red-600 rounded-md flex-1"
            style={{
              minHeight: "44px",
              minWidth: "44px",
              backgroundColor: "#dc2626",
              color: "#ffffff",
            }}
          >
            End Call
          </button>
        </div>
      )}

      {/* Text Chat Input Dock & Send Button (AC-09.2, AC-11.2) */}
      {(isTextFallback || isConnected) && (
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Type a message..."
            className="text-base flex-1 py-3 px-4 border border-gray-200 rounded-md"
            style={{ fontSize: "16px", minHeight: "44px" }}
          />
          <button
            type="submit"
            disabled={!inputText.trim()}
            className="min-h-[44px] min-w-[44px] py-3 px-4 font-bold text-sm text-white bg-blue-600 rounded-md"
            style={{
              minHeight: "44px",
              minWidth: "44px",
              backgroundColor: inputText.trim() ? "#2563eb" : "#94a3b8",
            }}
          >
            Send
          </button>
        </form>
      )}
    </footer>
  );
}
