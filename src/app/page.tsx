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
import { RealtimeAudioVisualizer } from "../lib/realtime/audio-visualizer";
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

  const mainRef = useRef<HTMLElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const connectionManagerRef = useRef<RealtimeConnectionManager | null>(null);
  const controlsManagerRef = useRef<RealtimeControlsManager | null>(null);
  const transcriptManagerRef = useRef<TranscriptManager | null>(null);
  const visualizerRef = useRef<RealtimeAudioVisualizer | null>(null);

  const teardownActiveSession = useCallback(() => {
    if (visualizerRef.current) {
      visualizerRef.current.stop();
      visualizerRef.current = null;
    }
    if (connectionManagerRef.current) {
      connectionManagerRef.current.disconnect();
      connectionManagerRef.current = null;
    } else if (audioRef.current) {
      cleanupSession({ audioElement: audioRef.current });
    }
    controlsManagerRef.current = null;
    transcriptManagerRef.current = null;
  }, []);

  useEffect(() => {
    const currentAudio = audioRef.current;
    return () => {
      if (visualizerRef.current) {
        visualizerRef.current.stop();
        visualizerRef.current = null;
      }
      if (connectionManagerRef.current) {
        connectionManagerRef.current.disconnect();
        connectionManagerRef.current = null;
      } else {
        cleanupSession({ audioElement: currentAudio });
      }
    };
  }, []);

  // True iOS Safari VisualViewport Container Resizing (Zero phantom gap under text bar)
  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) {
      return;
    }
    const vv = window.visualViewport;
    const handleViewportChange = () => {
      const el = mainRef.current;
      if (!el) return;
      const keyboardHeight = window.innerHeight - vv.height;
      if (keyboardHeight > 60) {
        el.setAttribute("data-keyboard-open", "true");
        el.style.height = `${vv.height}px`;
        el.style.maxHeight = `${vv.height}px`;
        window.scrollTo(0, 0);
      } else {
        el.setAttribute("data-keyboard-open", "false");
        el.style.height = "";
        el.style.maxHeight = "";
      }
      // Keep transcript pinned right above the text input bar when keyboard opens
      const feed = el.querySelector(".transcript-feed");
      if (feed) {
        feed.scrollTop = feed.scrollHeight;
      }
    };
    vv.addEventListener("resize", handleViewportChange);
    vv.addEventListener("scroll", handleViewportChange);
    return () => {
      vv.removeEventListener("resize", handleViewportChange);
      vv.removeEventListener("scroll", handleViewportChange);
    };
  }, []);

  const handlePdfSelected = async (file: File) => {
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

  const handleYouTubeSubmit = async (url: string) => {
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

  const handleStartVoiceChat = async () => {
    if (!source) return;

    teardownActiveSession();
    setErrorState(null);
    setIsMutedState(false);
    setMicStatusState("available");
    setTextFallbackState(false);
    setConnectionStateState("connecting");

    if (audioRef.current) {
      try {
        const playPromise = audioRef.current.play?.();
        if (
          playPromise !== undefined &&
          typeof playPromise.catch === "function"
        ) {
          playPromise.catch(() => {});
        }
      } catch {
        // Ignore synchronous unlock error
      }
    }

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

    const controls = new RealtimeControlsManager({
      audioElement: audioRef.current,
      transcriptManager: tm,
      onConversationStateChange: (cState) => setConversationStateState(cState),
      onMicStatusChange: (mStatus) => setMicStatusState(mStatus),
      onMuteChange: (m) => setIsMutedState(m),
      onTextFallbackChange: (tf) => setTextFallbackState(tf),
    });
    controlsManagerRef.current = controls;

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

        if (mainRef.current) {
          const viz = new RealtimeAudioVisualizer({
            targetElement: mainRef.current,
            localStream: localStream ?? null,
            audioElement: audioRef.current,
          });
          viz.start();
          visualizerRef.current = viz;
        }
      },
      onEvent: (parsed) => {
        if (typeof parsed === "object" && parsed !== null) {
          const evtType = (parsed as { type?: string }).type;
          if (evtType === "input_audio_buffer.speech_started") {
            controls.handleBargeIn(parsed);
          } else if (
            evtType === "response.created" ||
            evtType === "output_audio_buffer.started" ||
            evtType === "response.output_item.added"
          ) {
            controls.ensureAudioPlayback();
            visualizerRef.current?.attachRemoteFromAudioElement();
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
      // Handled inside RealtimeConnectionManager.connect()
    }
  };

  const handleStopVoiceChat = () => {
    teardownActiveSession();
    setConnectionStateState(source ? "ready" : "idle");
    setConversationStateState("listening");
    setIsMutedState(false);
  };

  const handleInterrupt = () => {
    if (controlsManagerRef.current) {
      controlsManagerRef.current.interrupt();
    }
    setConversationStateState("listening");
  };

  const handleToggleMute = () => {
    if (controlsManagerRef.current) {
      const nextMuted = controlsManagerRef.current.toggleMute();
      setIsMutedState(nextMuted);
    } else {
      setIsMutedState(!isMuted);
    }
  };

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
  const isCallView =
    isConnected ||
    connectionState === "connecting" ||
    connectionState === "reconnecting" ||
    isTextFallback;
  const canStartVoiceChat = connectionState === "ready";
  const showTranscriptArea =
    isCallView ||
    transcript.length > 0 ||
    safeProps.initialTranscript !== undefined;

  return (
    <main
      ref={mainRef}
      data-connection-state={connectionState}
      data-conversation-state={conversationState}
      data-text-fallback={String(Boolean(isTextFallback))}
      className={`apple-spatial-shell max-w-md mx-auto flex flex-col ${
        isCallView
          ? "h-dvh max-h-dvh overflow-hidden"
          : "min-h-dvh overflow-x-hidden"
      }`}
    >
      <audio
        ref={audioRef}
        autoPlay
        playsInline
        className="sr-only"
        aria-hidden="true"
      />

      {/* Native iOS Top Bar */}
      <header
        className="apple-nav-bar shrink-0"
        style={{
          paddingTop:
            "calc(0.5rem + var(--safe-area-inset-top, env(safe-area-inset-top, 0px)))",
        }}
      >
        <div className="apple-app-title">
          <span className="apple-app-logo" aria-hidden="true">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            </svg>
          </span>
          <span>TalkToMe</span>
        </div>

        <span className="apple-mode-pill">PDF & YouTube Voice</span>

        <div className="sr-only">
          <h1>Talk to a Document or YouTube Video</h1>
          <p>Live voice conversations powered by OpenAI Realtime API</p>
        </div>
      </header>

      {/* Error Alert Banner */}
      {error && (
        <div role="alert" className="apple-alert-error shrink-0">
          {error}
        </div>
      )}

      {/* TOP-PINNED SOURCE CONTEXT BAR (Always anchored right below header!) */}
      {source && (
        <div className="apple-top-source-bar">
          <SourcePreview
            source={source}
            expanded={isPreviewExpanded}
            onToggleExpanded={() =>
              setPreviewExpandedState(!isPreviewExpanded)
            }
          />
        </div>
      )}

      {/* ZONE 1: THE LIVING VOICE STAGE */}
      <div className="apple-upper-stage">
        <SessionStatus
          connectionState={connectionState}
          conversationState={conversationState}
          onReconnect={handleStartVoiceChat}
        />
      </div>

      {/* Live Conversation Transcript (Sits directly above the text input bar) */}
      {showTranscriptArea && (
        <div className="transcript-wrap flex-1 min-h-0 flex flex-col px-4">
          <ConversationTranscript
            transcript={transcript}
            conversationState={conversationState}
          />
        </div>
      )}

      {/* ZONE 2: GROUNDED iOS BOTTOM SHEET (Pre-Call Thumb Zone) */}
      {!isConnected && (
        <div className="ingestion-wrap apple-bottom-sheet-wrap shrink-0">
          <SourceIngestion
            connectionState={connectionState}
            canStartVoiceChat={canStartVoiceChat}
            onPdfSelected={handlePdfSelected}
            onYouTubeSubmit={handleYouTubeSubmit}
            onStartVoiceChat={handleStartVoiceChat}
          />
        </div>
      )}

      {/* Active Call Bottom Dock */}
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
