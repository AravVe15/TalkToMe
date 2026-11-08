"use client";

import React from "react";
import type {
  RealtimeConnectionState,
  RealtimeConversationState,
} from "@/lib/realtime/connection";

export interface SessionStatusProps {
  connectionState: RealtimeConnectionState;
  conversationState?: RealtimeConversationState;
  onReconnect?: () => void;
}

export function SessionStatus({
  connectionState,
  conversationState = "listening",
  onReconnect,
}: SessionStatusProps) {
  const isConnected = connectionState === "connected";
  const isReconnecting = connectionState === "reconnecting";
  const isError = connectionState === "error";

  return (
    <div className="flex flex-col gap-2 p-3 bg-white rounded-lg border border-gray-200 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        {/* Connection State Badge */}
        <div className="flex items-center gap-2">
          <span
            className="w-2.5 h-2.5 rounded-full inline-block"
            style={{
              width: "10px",
              height: "10px",
              borderRadius: "50%",
              backgroundColor:
                connectionState === "connected"
                  ? "#16a34a"
                  : connectionState === "connecting"
                    ? "#2563eb"
                    : connectionState === "reconnecting"
                      ? "#d97706"
                      : connectionState === "error"
                        ? "#dc2626"
                        : "#94a3b8",
            }}
          />
          <span className="text-xs font-semibold capitalize" style={{ fontSize: "13px" }}>
            {connectionState === "connecting" && "Connecting..."}
            {connectionState === "connected" && "Connected (Live)"}
            {connectionState === "reconnecting" && "Reconnecting (Unstable network)..."}
            {connectionState === "error" && "Connection Error (Failed)"}
            {connectionState === "ready" && "Ready"}
            {connectionState === "idle" && "Idle"}
            {connectionState === "ingesting" && "Ingesting..."}
          </span>
        </div>

        {/* Conversation Sub-State Badge (when connected) */}
        {isConnected && (
          <div
            className="px-2.5 py-1 rounded-full text-xs font-semibold"
            style={{
              backgroundColor:
                conversationState === "assistant_speaking"
                  ? "#dbeafe"
                  : conversationState === "assistant_thinking"
                    ? "#fef3c7"
                    : conversationState === "user_speaking"
                      ? "#dcfce7"
                      : "#f1f5f9",
              color:
                conversationState === "assistant_speaking"
                  ? "#1e40af"
                  : conversationState === "assistant_thinking"
                    ? "#92400e"
                    : conversationState === "user_speaking"
                      ? "#166534"
                      : "#475569",
            }}
          >
            {conversationState === "listening" && "Listening"}
            {conversationState === "user_speaking" && "You are speaking"}
            {conversationState === "assistant_thinking" && "Assistant thinking"}
            {conversationState === "assistant_speaking" && "Assistant speaking"}
          </div>
        )}
      </div>

      {/* Network Unstable Notice (AC-10.1) */}
      {isReconnecting && (
        <div
          role="status"
          className="p-2.5 bg-amber-50 border border-amber-200 text-amber-900 rounded-md text-xs font-medium"
          style={{
            backgroundColor: "#fffbeb",
            borderColor: "#fde68a",
            color: "#78350f",
          }}
        >
          Network unstable — attempting to recover...
        </div>
      )}

      {/* Reconnect Voice Session CTA (AC-10.3) */}
      {isError && (
        <div className="pt-1">
          <button
            type="button"
            onClick={onReconnect}
            className="min-h-[44px] min-w-[44px] py-3 px-4 w-full font-bold text-white bg-blue-600 rounded-md text-sm"
            style={{ minHeight: "44px", minWidth: "44px", width: "100%" }}
          >
            Reconnect Voice Session
          </button>
        </div>
      )}
    </div>
  );
}
