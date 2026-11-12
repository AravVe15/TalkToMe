"use client";

import React, { useEffect, useState, useRef } from "react";
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

  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!isConnected) {
      setElapsedSeconds(0);
      return;
    }
    const interval = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isConnected]);

  const mins = String(Math.floor(elapsedSeconds / 60)).padStart(2, "0");
  const secs = String(elapsedSeconds % 60).padStart(2, "0");

  const visualState = isConnected ? conversationState : connectionState;

  const orbRef = useRef<HTMLDivElement | null>(null);
  const ring1Ref = useRef<HTMLDivElement | null>(null);
  const ring2Ref = useRef<HTMLDivElement | null>(null);
  const ring3Ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let rafId: number | null = null;
    const startTime = performance.now();

    const isFastPulse =
      visualState === "ingesting" ||
      visualState === "connecting" ||
      visualState === "reconnecting" ||
      visualState === "assistant_thinking";
    const isAudioDriven =
      visualState === "user_speaking" || visualState === "assistant_speaking";

    const tick = (now: number) => {
      const elapsed = (now - startTime) / 1000;

      if (orbRef.current && !isAudioDriven) {
        const speed = isFastPulse ? 4.2 : 2.1;
        const amplitude = isFastPulse ? 0.065 : 0.04;
        const scale = 1 + amplitude * (0.5 + 0.5 * Math.sin(elapsed * speed));
        orbRef.current.style.transform = `scale(${scale.toFixed(4)})`;
      } else if (orbRef.current && isAudioDriven) {
        orbRef.current.style.transform = "scale(var(--orb-scale, 1.06))";
      }

      const rings = [ring1Ref.current, ring2Ref.current, ring3Ref.current];
      const cycleDuration = isFastPulse ? 2.0 : 3.2;
      rings.forEach((ring, idx) => {
        if (!ring) return;
        const phase =
          ((elapsed + idx * (cycleDuration / 3)) % cycleDuration) / cycleDuration;
        const ringScale = 0.92 + phase * 0.55;
        // Clamp minimum opacity to 0.06 so WebKit never zero-opacity-culls the ring
        const ringOpacity = Math.max(0.06, Math.sin(phase * Math.PI) * 0.42);
        ring.style.transform = `scale(${ringScale.toFixed(4)})`;
        ring.style.opacity = ringOpacity.toFixed(3);
      });

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [visualState]);

  return (
    <div className="apple-status-strip">
      {/* Always-Alive Voice Orb on the Upper Stage */}
      <div
        className="apple-voice-orb-wrap"
        data-state={visualState}
        aria-hidden="true"
      >
        <div ref={ring1Ref} className="apple-orb-ring apple-orb-ring-1" />
        <div ref={ring2Ref} className="apple-orb-ring apple-orb-ring-2" />
        <div ref={ring3Ref} className="apple-orb-ring apple-orb-ring-3" />
        <div ref={orbRef} className="apple-voice-orb" data-state={visualState} />
      </div>

      {/* Contextual Stage Headline (Pre-Call vs In-Call) */}
      {!isConnected && (
        <div className="flex flex-col items-center gap-0.5">
          <p className="apple-stage-headline">
            {connectionState === "idle" && "Voice Assistant Standby"}
            {connectionState === "ingesting" && "Reading Your Source..."}
            {connectionState === "ready" && "Source Loaded in Memory"}
            {connectionState === "connecting" && "Starting Voice Session..."}
            {connectionState === "reconnecting" && "Reconnecting Audio..."}
            {connectionState === "error" && "Session Interrupted"}
          </p>
          <p className="apple-stage-subline">
            {connectionState === "idle" &&
              "Select a PDF document or paste a YouTube video below to talk through it."}
            {connectionState === "ingesting" &&
              "Extracting full text and preparing direct context grounding."}
            {connectionState === "ready" &&
              "Tap Start Voice Chat below to ask questions out loud."}
          </p>
        </div>
      )}

      {/* Status + Live Call Duration Timer Row */}
      <div className="flex items-center justify-center gap-2">
        <div
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full"
          style={{ background: "rgba(255, 255, 255, 0.75)" }}
        >
          <span
            className="inline-block rounded-full"
            style={{
              width: "7px",
              height: "7px",
              borderRadius: "50%",
              backgroundColor:
                connectionState === "connected" || connectionState === "ready"
                  ? "#34c759"
                  : connectionState === "connecting" ||
                      connectionState === "ingesting"
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
          <span className="apple-call-timer" aria-hidden="true">
            {`${mins}:${secs}`}
          </span>
        )}

        {isConnected && (
          <div
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold"
            style={{
              backgroundColor: "rgba(0, 122, 255, 0.1)",
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
