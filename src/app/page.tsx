"use client";

import React, { useState, useRef, useEffect } from "react";
import type { IngestionResult } from "@/types/ingest";
import type {
  RealtimeConnectionState,
  RealtimeConversationState,
} from "@/lib/realtime/connection";
import type { MicStatus } from "@/lib/realtime/controls";
import {
  TranscriptManager,
  type TranscriptItem,
} from "@/lib/realtime/transcript";
import { cleanupSession } from "@/lib/realtime/connection";
import {
  RealtimeControlsManager,
  setupRecvonlyTransceiver,
} from "@/lib/realtime/controls";
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
    safeProps.initialTextFallback ?? (safeProps.initialMicStatus === "unavailable")
  );
  const [previewExpandedState, setPreviewExpandedState] = useState<boolean>(
    safeProps.previewExpanded ?? false
  );

  // Active / controlled values honoring props if explicitly passed
  const source =
    safeProps.initialSource !== undefined ? safeProps.initialSource : sourceState;
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
    safeProps.initialMuted !== undefined ? safeProps.initialMuted : isMutedState;
  const error =
    safeProps.initialError !== undefined ? safeProps.initialError : errorState;
  const isTextFallback =
    safeProps.initialTextFallback !== undefined
      ? safeProps.initialTextFallback
      : (micStatus === "unavailable" || textFallbackState);
  const isPreviewExpanded =
    safeProps.previewExpanded !== undefined
      ? safeProps.previewExpanded
      : previewExpandedState;

  // Refs for WebRTC resources
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const controlsManagerRef = useRef<RealtimeControlsManager | null>(null);
  const transcriptManagerRef = useRef<TranscriptManager | null>(null);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Deterministic teardown on component unmount (ADR-06 / AC-06.2)
  useEffect(() => {
    const currentAudio = audioRef.current;
    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      cleanupSession({
        peerConnection: peerConnectionRef.current,
        dataChannel: dataChannelRef.current,
        localStream: localStreamRef.current,
        audioElement: currentAudio,
      });
    };
  }, []);

  // PDF Ingestion (Slice 1)
  const handlePdfSelected = async (file: File) => {
    setErrorState(null);
    setConnectionStateState("ingesting");

    // Clean up active session when switching sources
    handleStopVoiceChat();

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
        setConnectionStateState("idle");
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
      setConnectionStateState("idle");
    }
  };

  // YouTube Ingestion (Slice 1)
  const handleYouTubeSubmit = async (url: string) => {
    setErrorState(null);
    setConnectionStateState("ingesting");

    // Clean up active session when switching sources
    handleStopVoiceChat();

    try {
      const res = await fetch("/api/ingest/youtube", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data: IngestionResult = await res.json();
      if (!data.ok) {
        setErrorState(data.message || "Failed to extract YouTube transcript.");
        setConnectionStateState("idle");
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
      setConnectionStateState("idle");
    }
  };

  // Start / Reconnect Voice Session (Slices 2 & 3)
  const handleStartVoiceChat = async () => {
    if (!source) return;
    setErrorState(null);
    setConnectionStateState("connecting");

    // Synchronous audio gesture unlock for iOS Safari (ADR-11 / AC-11.3)
    if (audioRef.current) {
      try {
        void audioRef.current.play?.().catch(() => {});
      } catch {
        // Ignore audio play errors during user gesture
      }
    }

    // 1. Microphone access detection (ADR-09)
    let micUnavailable = false;
    let stream: MediaStream | null = null;

    if (!navigator.mediaDevices?.getUserMedia) {
      micUnavailable = true;
    } else {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localStreamRef.current = stream;
      } catch {
        micUnavailable = true;
      }
    }

    if (micUnavailable) {
      setMicStatusState("unavailable");
      setTextFallbackState(true);
    } else {
      setMicStatusState("available");
      setTextFallbackState(false);
    }

    // 2. Fetch ephemeral session token from backend route (ADR-04, Slice 2)
    let ephemeralKey = "";
    let model = "gpt-4o-realtime-preview";
    try {
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
        setErrorState(
          tokenData.message || "Failed to mint Realtime session token."
        );
        setConnectionStateState("error");
        return;
      }

      ephemeralKey = tokenData.ephemeralKey;
      if (tokenData.model) {
        model = tokenData.model;
      }
    } catch (err) {
      setErrorState(
        err instanceof Error
          ? err.message
          : "Network error minting session token."
      );
      setConnectionStateState("error");
      return;
    }

    // 3. Setup RTCPeerConnection & Audio Transport (Slice 3A)
    try {
      const pc = new RTCPeerConnection();
      peerConnectionRef.current = pc;

      if (micUnavailable) {
        // Add recvonly transceiver for mic-less text fallback (ADR-09 / AC-09.1)
        setupRecvonlyTransceiver(pc);
      } else if (stream) {
        for (const track of stream.getTracks()) {
          pc.addTrack(track, stream);
        }
      }

      // Attach remote audio track to <audio> element
      pc.ontrack = (event: RTCTrackEvent) => {
        const remoteStream = event.streams?.[0] ?? null;
        if (audioRef.current && remoteStream) {
          audioRef.current.srcObject = remoteStream;
          void audioRef.current.play?.().catch(() => {});
        }
      };

      // 4. Create oai-events data channel
      const dc = pc.createDataChannel("oai-events");
      dataChannelRef.current = dc;

      // 5. Initialize TranscriptManager (Slice 3B)
      const tm = new TranscriptManager({
        initialItems: transcript,
        onTranscriptChange: (items) => setTranscriptState([...items]),
        onConversationStateChange: (cState) =>
          setConversationStateState(cState),
      });
      transcriptManagerRef.current = tm;

      // 6. Initialize RealtimeControlsManager (Slice 3C)
      const controls = new RealtimeControlsManager({
        peerConnection: pc,
        dataChannel: dc,
        localAudioTrack: stream?.getAudioTracks?.()[0] ?? null,
        audioElement: audioRef.current,
        transcriptManager: tm,
        onConversationStateChange: (cState) =>
          setConversationStateState(cState),
        onMicStatusChange: (mStatus) => setMicStatusState(mStatus),
        onMuteChange: (m) => setIsMutedState(m),
        onTextFallbackChange: (tf) => setTextFallbackState(tf),
      });
      controlsManagerRef.current = controls;

      dc.onopen = () => {
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
        setConnectionStateState("connected");
      };

      dc.onmessage = (event: MessageEvent) => {
        if (typeof event.data === "string") {
          try {
            const parsed = JSON.parse(event.data);
            // Handle automatic barge-in on Server VAD speech_started (ADR-07)
            if (parsed.type === "input_audio_buffer.speech_started") {
              controls.handleBargeIn(parsed);
            }
            tm.handleEvent(parsed);
          } catch {
            tm.handleEvent(event.data);
          }
        }
      };

      // 7. Monitor ICE / PeerConnection state changes (ADR-10, 10s grace period)
      const handleStateChange = () => {
        const state = pc.connectionState;
        const ice = pc.iceConnectionState;

        if (state === "connected" || ice === "connected") {
          if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
          }
          setConnectionStateState("connected");
        } else if (state === "disconnected" || ice === "disconnected") {
          setConnectionStateState("reconnecting");
          if (!reconnectTimerRef.current) {
            reconnectTimerRef.current = setTimeout(() => {
              cleanupSession({
                peerConnection: pc,
                dataChannel: dc,
                localStream: localStreamRef.current,
                audioElement: audioRef.current,
              });
              setConnectionStateState("error");
            }, 10_000);
          }
        } else if (state === "failed" || ice === "failed") {
          if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
          }
          cleanupSession({
            peerConnection: pc,
            dataChannel: dc,
            localStream: localStreamRef.current,
            audioElement: audioRef.current,
          });
          setConnectionStateState("error");
        }
      };

      pc.onconnectionstatechange = handleStateChange;
      pc.oniceconnectionstatechange = handleStateChange;

      // 8. Create SDP Offer & negotiate with OpenAI Realtime endpoint
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpUrl = "https://api.openai.com/v1/realtime/calls";
      const sdpRes = await fetch(sdpUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          "Content-Type": "application/sdp",
        },
        body: offer.sdp,
      });

      if (!sdpRes.ok) {
        throw new Error(
          `OpenAI Realtime SDP negotiation failed (${sdpRes.status}).`
        );
      }

      const answerSdp = await sdpRes.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
    } catch (err) {
      cleanupSession({
        peerConnection: peerConnectionRef.current,
        dataChannel: dataChannelRef.current,
        localStream: localStreamRef.current,
        audioElement: audioRef.current,
      });
      setErrorState(
        err instanceof Error ? err.message : "Failed to establish WebRTC call."
      );
      setConnectionStateState("error");
    }
  };

  // Stop / End Call Handler (ADR-06 / AC-06.2)
  const handleStopVoiceChat = () => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    cleanupSession({
      peerConnection: peerConnectionRef.current,
      dataChannel: dataChannelRef.current,
      localStream: localStreamRef.current,
      audioElement: audioRef.current,
    });
    peerConnectionRef.current = null;
    dataChannelRef.current = null;
    localStreamRef.current = null;
    controlsManagerRef.current = null;

    setConnectionStateState("ready");
    setConversationStateState("listening");
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

  return (
    <main className="max-w-md mx-auto min-h-dvh flex flex-col overflow-x-hidden bg-slate-50 text-slate-900">
      {/* Remote Audio Element for WebRTC audio playback (ADR-11 / AC-11.3) */}
      <audio
        ref={audioRef}
        autoPlay
        playsInline
        className="hidden"
        aria-hidden="true"
      />

      {/* Top Application Header */}
      <header className="p-4 bg-white border-b border-gray-200">
        <h1 className="text-lg font-bold" style={{ fontSize: "18px", margin: 0 }}>
          Talk to a Document or YouTube Video
        </h1>
        <p
          className="text-xs text-muted"
          style={{ color: "var(--text-muted)", margin: "4px 0 0" }}
        >
          Live voice conversations powered by OpenAI Realtime API
        </p>
      </header>

      {/* Error Alert Banner (AC-01.2, AC-02, AC-03, AC-04) */}
      {error && (
        <div
          role="alert"
          className="m-4 p-3 bg-red-50 border border-red-200 text-red-800 rounded-md text-sm font-medium"
          style={{
            backgroundColor: "#fef2f2",
            borderColor: "#fecaca",
            color: "#991b1b",
          }}
        >
          {error}
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col gap-4 p-4">
        {/* Source Ingestion Controls (Slice 1) */}
        {!isConnected && (
          <SourceIngestion
            connectionState={connectionState}
            canStartVoiceChat={canStartVoiceChat}
            onPdfSelected={handlePdfSelected}
            onYouTubeSubmit={handleYouTubeSubmit}
            onStartVoiceChat={handleStartVoiceChat}
          />
        )}

        {/* Source Text Preview & Truncation Banner (ADR-05, ADR-11 / AC-05, AC-11.1) */}
        {source && (
          <SourcePreview
            source={source}
            expanded={isPreviewExpanded}
            onToggleExpanded={() => setPreviewExpandedState(!isPreviewExpanded)}
          />
        )}

        {/* Session & Network Status Indicators (ADR-06, ADR-10 / AC-06.3, AC-10.1, AC-10.3) */}
        <SessionStatus
          connectionState={connectionState}
          conversationState={conversationState}
          onReconnect={handleStartVoiceChat}
        />

        {/* Real-Time Synchronized Conversation Transcript (Slice 3B / AC-08) */}
        <ConversationTranscript transcript={transcript} />
      </div>

      {/* Sticky Bottom Dock: Voice & Text Controls (ADR-07, ADR-09, ADR-11 / AC-06.2, AC-07.2, AC-09, AC-11.2) */}
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
