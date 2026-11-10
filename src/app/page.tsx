"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import type { IngestionResult } from "@/types/ingest";
import {
  RealtimeConnectionManager,
  cleanupSession,
  type RealtimeConnectionState,
  type RealtimeConversationState,
} from "../lib/realtime/connection";
import {
  TranscriptManager,
  type TranscriptItem,
} from "../lib/realtime/transcript";
import {
  RealtimeControlsManager,
  type MicStatus,
} from "../lib/realtime/controls";
import { SourceIngestion } from "@/components/SourceIngestion";
import {
  SourcePreview,
  type SourcePreviewData,
} from "@/components/SourcePreview";
import { SessionStatus } from "@/components/SessionStatus";
import { ConversationTranscript } from "@/components/ConversationTranscript";
import { SessionControls } from "@/components/SessionControls";

export interface HomePageProps {
  initialSource?: SourcePreviewData | null;
  initialConnectionState?: string;
  initialConversationState?: string;
  initialTranscript?: Array<{
    id: string;
    role: "user" | "assistant";
    text: string;
    status: string;
  }>;
  initialMicStatus?: "available" | "unavailable";
  initialMuted?: boolean;
  initialError?: string | null;
  initialTextFallback?: boolean;
  previewExpanded?: boolean;
  [key: string]: unknown;
}

export default function Home(props: any) {
  const safeProps: HomePageProps = (props as HomePageProps) || {};

  // Local state initialized from props (or sensible production defaults)
  const [sourceState, setSourceState] = useState<SourcePreviewData | null>(
    safeProps.initialSource ?? null
  );
  const [connectionStateState, setConnectionStateState] =
    useState<RealtimeConnectionState>(
      (safeProps.initialConnectionState as RealtimeConnectionState) ||
        (safeProps.initialSource ? "ready" : "idle")
    );
  const [conversationStateState, setConversationStateState] =
    useState<RealtimeConversationState>(
      (safeProps.initialConversationState as RealtimeConversationState) ||
        "listening"
    );
  const [transcriptState, setTranscriptState] = useState<TranscriptItem[]>(
    (safeProps.initialTranscript as TranscriptItem[]) ?? []
  );
  const [micStatusState, setMicStatusState] = useState<MicStatus>(
    safeProps.initialMicStatus ??
      (safeProps.initialTextFallback ? "unavailable" : "available")
  );
  const [isMutedState, setIsMutedState] = useState<boolean>(
    safeProps.initialMuted ?? false
  );
  const [errorState, setErrorState] = useState<string | null>(
    safeProps.initialError ?? null
  );
  const [textFallbackState, setTextFallbackState] = useState<boolean>(
    safeProps.initialTextFallback ??
      (safeProps.initialMicStatus === "unavailable")
  );
  const [previewExpandedState, setPreviewExpandedState] = useState<boolean>(
    safeProps.previewExpanded ?? false
  );

  // Active / controlled values honoring props if explicitly passed
  const source =
    safeProps.initialSource !== undefined
      ? safeProps.initialSource
      : sourceState;
  const connectionState =
    safeProps.initialConnectionState !== undefined
      ? (safeProps.initialConnectionState as RealtimeConnectionState)
      : connectionStateState;
  const conversationState =
    safeProps.initialConversationState !== undefined
      ? (safeProps.initialConversationState as RealtimeConversationState)
      : conversationStateState;
  const transcript =
    safeProps.initialTranscript !== undefined
      ? (safeProps.initialTranscript as TranscriptItem[])
      : transcriptState;
  const micStatus =
    safeProps.initialMicStatus !== undefined
      ? safeProps.initialMicStatus
      : micStatusState;
  const isMuted =
    safeProps.initialMuted !== undefined
      ? safeProps.initialMuted
      : isMutedState;
  const error =
    safeProps.initialError !== undefined ? safeProps.initialError : errorState;
  const isTextFallback =
    safeProps.initialTextFallback !== undefined
      ? safeProps.initialTextFallback
      : micStatus === "unavailable" || textFallbackState;
  const isPreviewExpanded =
    safeProps.previewExpanded !== undefined
      ? safeProps.previewExpanded
      : previewExpandedState;

  // Refs for Slice 3 managers and WebRTC resources
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const connectionManagerRef = useRef<RealtimeConnectionManager | null>(null);
  const controlsManagerRef = useRef<RealtimeControlsManager | null>(null);
  const transcriptManagerRef = useRef<TranscriptManager | null>(null);

  // Helper to deterministically tear down active WebRTC resources without overwriting target state
  const teardownActiveSession = useCallback(() => {
    if (connectionManagerRef.current) {
      connectionManagerRef.current.disconnect();
      connectionManagerRef.current = null;
    } else if (audioRef.current) {
      cleanupSession({ audioElement: audioRef.current });
    }
    controlsManagerRef.current = null;
    transcriptManagerRef.current = null;
  }, []);

  // Deterministic teardown on component unmount (ADR-06 / AC-06.2)
  useEffect(() => {
    const currentAudio = audioRef.current;
    return () => {
      if (connectionManagerRef.current) {
        connectionManagerRef.current.disconnect();
        connectionManagerRef.current = null;
      } else {
        cleanupSession({ audioElement: currentAudio });
      }
    };
  }, []);

  // PDF Ingestion (Slice 1)
  const handlePdfSelected = async (file: File) => {
    // 1. Clean up any active call first before entering "ingesting" state
    teardownActiveSession();
    setConversationStateState("listening");
    setErrorState(null);
    setConnectionStateState("ingesting");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/ingest/pdf", {
        method: "POST",
        body: formData,
      });
      const data: IngestionResult = await res.json();
      if (!data.ok) {
        setErrorState(data.message || "Failed to extract text from PDF.");
        setConnectionStateState(source ? "ready" : "idle");
      } else {
        setSourceState({
          sourceType: data.sourceType,
          title: data.title,
          text: data.text,
          charCount: data.charCount,
          estimatedTokens: data.estimatedTokens,
        });
        setTranscriptState([]);
        setConnectionStateState("ready");
      }
    } catch (err) {
      setErrorState(
        err instanceof Error ? err.message : "Network error during PDF upload."
      );
      setConnectionStateState(source ? "ready" : "idle");
    }
  };

  // YouTube Ingestion (Slice 1)
  const handleYouTubeSubmit = async (url: string) => {
    // 1. Clean up any active call first before entering "ingesting" state
    teardownActiveSession();
    setConversationStateState("listening");
    setErrorState(null);
    setConnectionStateState("ingesting");

    try {
      const res = await fetch("/api/ingest/youtube", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data: IngestionResult = await res.json();
      if (!data.ok) {
        setErrorState(data.message || "Failed to extract YouTube transcript.");
        setConnectionStateState(source ? "ready" : "idle");
      } else {
        setSourceState({
          sourceType: data.sourceType,
          title: data.title,
          text: data.text,
          charCount: data.charCount,
          estimatedTokens: data.estimatedTokens,
        });
        setTranscriptState([]);
        setConnectionStateState("ready");
      }
    } catch (err) {
      setErrorState(
        err instanceof Error
          ? err.message
          : "Network error during YouTube ingestion."
      );
      setConnectionStateState(source ? "ready" : "idle");
    }
  };

  // Start / Reconnect Voice Session (Slices 2 & 3)
  const handleStartVoiceChat = async () => {
    if (!source) return;

    teardownActiveSession();
    setErrorState(null);
    setIsMutedState(false);
    setMicStatusState("available");
    setTextFallbackState(false);
    setConnectionStateState("connecting");

    // Synchronous audio gesture unlock for iOS Safari (ADR-11 / AC-11.3)
    if (audioRef.current) {
      try {
        const playPromise = audioRef.current.play?.();
        if (
          playPromise !== undefined &&
          typeof playPromise.catch === "function"
        ) {
          playPromise.catch((err: unknown) => {
            console.error("Audio playback unlock error:", err);
          });
        }
      } catch (err: unknown) {
        console.error("Synchronous audio play unlock error:", err);
      }
    }

    // 1. Initialize TranscriptManager (Slice 3B)
    const tm = new TranscriptManager({
      initialItems: transcript,
      onTranscriptChange: (items) => setTranscriptState([...items]),
      onConversationStateChange: (cState) => {
        setConversationStateState(cState);
        if (controlsManagerRef.current) {
          controlsManagerRef.current.conversationState = cState;
        }
      },
    });
    transcriptManagerRef.current = tm;

    // 2. Initialize RealtimeControlsManager (Slice 3C)
    const controls = new RealtimeControlsManager({
      audioElement: audioRef.current,
      transcriptManager: tm,
      onConversationStateChange: (cState) => setConversationStateState(cState),
      onMicStatusChange: (mStatus) => setMicStatusState(mStatus),
      onMuteChange: (m) => setIsMutedState(m),
      onTextFallbackChange: (tf) => setTextFallbackState(tf),
    });
    controlsManagerRef.current = controls;

    // 3. Initialize RealtimeConnectionManager (Slice 3A)
    const connectionManager = new RealtimeConnectionManager({
      audioElement: audioRef.current,
      allowTextFallback: true,
      fetchToken: async () => {
        const tokenRes = await fetch("/api/realtime/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: source.text,
            title: source.title,
            sourceType: source.sourceType,
          }),
        });
        const tokenData = await tokenRes.json();
        if (!tokenData.ok) {
          throw new Error(
            tokenData.message || "Failed to mint Realtime session token."
          );
        }
        return {
          ephemeralKey: tokenData.ephemeralKey,
          model: tokenData.model,
        };
      },
      onStateChange: (nextState) => {
        setConnectionStateState(nextState);
      },
      onConversationStateChange: (cState) => {
        setConversationStateState(cState);
      },
      onMicFallback: (reason) => {
        controls.enableTextFallback(reason);
      },
      onTransportCreated: ({ peerConnection, dataChannel, localStream }) => {
        controls.peerConnection = peerConnection ?? null;
        controls.dataChannel = dataChannel ?? null;
        controls.localAudioTrack =
          localStream?.getAudioTracks?.()[0] ??
          localStream?.getTracks?.()[0] ??
          null;
      },
      onEvent: (parsed) => {
        if (typeof parsed === "object" && parsed !== null) {
          const evtType = (parsed as { type?: string }).type;
          // Automatic barge-in on Server VAD speech_started (ADR-07 / AC-07.1)
          if (evtType === "input_audio_buffer.speech_started") {
            controls.handleBargeIn(parsed);
          } else if (
            evtType === "response.created" ||
            evtType === "output_audio_buffer.started" ||
            evtType === "response.output_item.added" ||
            evtType === "response.audio_transcript.delta" ||
            evtType === "response.output_audio_transcript.delta" ||
            evtType === "response.audio.delta" ||
            evtType === "response.output_audio.delta"
          ) {
            controls.ensureAudioPlayback();
          }
        }
        tm.handleEvent(parsed);
      },
      onError: (err) => {
        setErrorState(
          err instanceof Error
            ? err.message
            : typeof err === "string"
              ? err
              : "Failed to establish WebRTC call."
        );
      },
    });
    connectionManagerRef.current = connectionManager;

    try {
      await connectionManager.connect();
    } catch {
      // Error state and resource teardown are handled inside RealtimeConnectionManager.connect()
    }
  };

  // Stop / End Call Handler (ADR-06 / AC-06.2)
  const handleStopVoiceChat = () => {
    teardownActiveSession();
    setConnectionStateState(source ? "ready" : "idle");
    setConversationStateState("listening");
    setIsMutedState(false);
  };

  // Manual Speech Interruption (ADR-07 / AC-07.2)
  const handleInterrupt = () => {
    if (controlsManagerRef.current) {
      controlsManagerRef.current.interrupt();
    }
    setConversationStateState("listening");
  };

  // Mute / Unmute Toggle (ADR-09 / AC-09.3)
  const handleToggleMute = () => {
    if (controlsManagerRef.current) {
      const nextMuted = controlsManagerRef.current.toggleMute();
      setIsMutedState(nextMuted);
    } else {
      setIsMutedState(!isMuted);
    }
  };

  // Text Message Dispatch (ADR-09 / AC-09.2)
  const handleSendText = (text: string) => {
    if (controlsManagerRef.current) {
      controlsManagerRef.current.sendTextMessage(text);
    } else {
      setTranscriptState((prev) => [
        ...prev,
        {
          id: `turn_user_${Date.now()}`,
          role: "user",
          text,
          status: "completed",
        },
      ]);
    }
  };

  const isConnected = connectionState === "connected";
  const canStartVoiceChat = connectionState === "ready";
  const showTranscriptArea =
    isConnected ||
    connectionState === "connecting" ||
    connectionState === "reconnecting" ||
    isTextFallback ||
    transcript.length > 0 ||
    safeProps.initialTranscript !== undefined;

  return (
    <main
      className={`max-w-md mx-auto flex flex-col bg-slate-50 text-slate-900 ${
        isConnected || isTextFallback
          ? "h-dvh max-h-dvh overflow-hidden"
          : "min-h-dvh overflow-x-hidden"
      }`}
    >
      {/* Remote Audio Element for WebRTC audio playback (ADR-11 / AC-11.3) */}
      <audio
        ref={audioRef}
        autoPlay
        playsInline
        className="sr-only"
        aria-hidden="true"
      />

      {/* Top Application Header */}
      <header
        className="sticky top-0 z-20 px-4 py-3 bg-white/90 backdrop-blur-md border-b border-slate-200/80 shadow-xs shrink-0"
        style={{
          paddingTop:
            "calc(0.75rem + var(--safe-area-inset-top, env(safe-area-inset-top, 0px)))",
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-base font-bold text-slate-900 tracking-tight">
              Talk to a Document or YouTube Video
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Live voice conversations powered by OpenAI Realtime API
            </p>
          </div>
        </div>
      </header>

      {/* Error Alert Banner */}
      {error && (
        <div
          role="alert"
          className="mx-4 mt-3 p-3 bg-red-50 border border-red-200 text-red-800 rounded-xl text-xs font-medium shadow-xs shrink-0"
        >
          {error}
        </div>
      )}

      {/* Main Content Area */}
      <div
        className={`flex-1 flex flex-col gap-3 p-4 ${
          isConnected || isTextFallback ? "min-h-0 overflow-hidden" : ""
        }`}
      >
        {/* Top Controls / Context Area (shrink-0 during active call so transcript gets remaining space) */}
        <div className="flex flex-col gap-3 shrink-0">
          {!isConnected && (
            <SourceIngestion
              connectionState={connectionState}
              canStartVoiceChat={canStartVoiceChat}
              onPdfSelected={handlePdfSelected}
              onYouTubeSubmit={handleYouTubeSubmit}
              onStartVoiceChat={handleStartVoiceChat}
            />
          )}

          {source && (
            <SourcePreview
              source={source}
              expanded={isPreviewExpanded}
              onToggleExpanded={() =>
                setPreviewExpandedState(!isPreviewExpanded)
              }
            />
          )}

          <SessionStatus
            connectionState={connectionState}
            conversationState={conversationState}
            onReconnect={handleStartVoiceChat}
          />
        </div>

        {/* Real-Time Synchronized Conversation Transcript (scrollable flex-1 container during call) */}
        {showTranscriptArea && (
          <div className="flex-1 min-h-0 flex flex-col">
            <ConversationTranscript
              transcript={transcript}
              conversationState={conversationState}
            />
          </div>
        )}
      </div>

      {/* Sticky Bottom Dock: Voice & Text Controls */}
      <SessionControls
        connectionState={connectionState}
        conversationState={conversationState}
        micStatus={micStatus}
        isMuted={isMuted}
        isTextFallback={isTextFallback}
        onToggleMute={handleToggleMute}
        onInterrupt={handleInterrupt}
        onStop={handleStopVoiceChat}
        onSendText={handleSendText}
      />
    </main>
  );
}
