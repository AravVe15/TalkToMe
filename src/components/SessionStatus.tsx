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
  const isConnecting = connectionState === "connecting";
  const isReconnecting = connectionState === "reconnecting";
  const isError = connectionState === "error";
  const showOrb = isConnected || isConnecting || isReconnecting;

  return (
    <div className="apple-status-strip">
      {/* Clean Apple / ChatGPT Breathing Voice Circle (Only during active/connecting session) */}
      {showOrb && (
        <div className="apple-voice-orb-wrap" aria-hidden="true">
          <div className="apple-voice-orb" data-state={conversationState} />
        </div>
      )}

      {/* Minimalist Borderless Status Pill Row */}
      <div className="flex items-center justify-center gap-2">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full">
          <span
            className="inline-block rounded-full"
            style={{
              width: "7px",
              height: "7px",
              borderRadius: "50%",
              backgroundColor:
                connectionState === "connected"
                  ? "#34c759"
                  : connectionState === "connecting"
                    ? "#007aff"
                    : connectionState === "reconnecting"
                      ? "#ff9500"
                      : connectionState === "error"
                        ? "#ff3b30"
                        : "#86868b",
            }}
          />
          <span
            className="text-xs font-medium"
            style={{ color: "#86868b", fontSize: "12px" }}
          >
            {connectionState === "connecting" && "Connecting..."}
            {connectionState === "connected" && "Connected (Live)"}
            {connectionState === "reconnecting" &&
              "Reconnecting (Unstable network)..."}
            {connectionState === "error" && "Connection Error (Failed)"}
            {connectionState === "ready" && "Ready"}
            {connectionState === "idle" && "Idle"}
            {connectionState === "ingesting" && "Ingesting..."}
          </span>
        </div>

        {isConnected && (
          <div
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold"
            style={{
              backgroundColor: "rgba(0, 122, 255, 0.08)",
              color: "#007aff",
              fontSize: "12px",
            }}
          >
            {(conversationState === "assistant_speaking" ||
              conversationState === "user_speaking") && (
              <div className="voice-wave" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            )}
            <span>
              {conversationState === "listening" && "Listening"}
              {conversationState === "user_speaking" && "You are speaking"}
              {conversationState === "assistant_thinking" &&
                "Assistant thinking"}
              {conversationState === "assistant_speaking" &&
                "Assistant speaking"}
            </span>
          </div>
        )}
      </div>

      {isReconnecting && (
        <div role="status" className="apple-alert-warning">
          Network unstable — attempting to recover...
        </div>
      )}

      {isError && (
        <div className="w-full pt-1">
          <button
            type="button"
            onClick={onReconnect}
            className="apple-primary-btn min-h-[44px] min-w-[44px]"
            style={{ minHeight: "44px", minWidth: "44px" }}
          >
            Reconnect Voice Session
          </button>
        </div>
      )}
    </div>
  );
}
