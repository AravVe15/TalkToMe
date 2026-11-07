/**
 * Slice 3A: WebRTC Connection & Audio Transport (ADR-06, ADR-10 / AC-06, AC-10).
 *
 * Manages the browser WebRTC session lifecycle with OpenAI's Realtime API:
 * - Primary session state machine (`idle` -> `ingesting` -> `ready` -> `connecting` -> `connected` -> `reconnecting` -> `error`)
 * - Conversation flow sub-state tracking (`listening`, `user_speaking`, `assistant_thinking`, `assistant_speaking`)
 * - Microphone audio capture (`getUserMedia`), `oai-events` data channel creation, and SDP offer/answer exchange
 * - Remote audio stream attachment to `<audio>` element
 * - 10-second ICE disconnect recovery grace period (`ADR-10`)
 * - Guarded `RTCDataChannel` event dispatch (`AC-10.4`)
 * - Deterministic resource teardown (`cleanupSession`, `AC-06.2`)
 */

export type RealtimeConnectionState =
  | "idle"
  | "ingesting"
  | "ready"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

export type RealtimeConversationState =
  | "listening"
  | "user_speaking"
  | "assistant_thinking"
  | "assistant_speaking";

export interface RealtimeConnectionOptions {
  audioElement?: HTMLAudioElement | null;
  onStateChange?: (state: RealtimeConnectionState) => void;
  onConversationStateChange?: (state: RealtimeConversationState) => void;
  onError?: (error: Error | string) => void;
  onEvent?: (event: unknown) => void;
  fetchToken?: () => Promise<{ ephemeralKey: string; model?: string }>;
  reconnectTimeoutMs?: number;
}

export interface RealtimeSessionResources {
  peerConnection?: RTCPeerConnection | null;
  dataChannel?: RTCDataChannel | null;
  localStream?: MediaStream | null;
  audioElement?: HTMLAudioElement | null;
}

const DEFAULT_REALTIME_MODEL = "gpt-4o-realtime-preview";
const DEFAULT_RECONNECT_TIMEOUT_MS = 10_000;
const OPENAI_REALTIME_BASE_URL = "https://api.openai.com/v1/realtime";
const OPENAI_REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

/**
 * Deterministically stops all local media tracks, pauses and detaches the
 * remote `<audio>` element, and closes the `oai-events` data channel and
 * `RTCPeerConnection` (ADR-06 / AC-06.2).
 */
export function cleanupSession(resources: RealtimeSessionResources): void {
  if (!resources) {
    return;
  }

  const { localStream, audioElement, dataChannel, peerConnection } = resources;

  // 1. Stop all local MediaStreamTracks
  if (localStream) {
    try {
      const tracks =
        typeof localStream.getTracks === "function"
          ? localStream.getTracks()
          : [];
      for (const track of tracks) {
        try {
          track?.stop?.();
        } catch {
          // Ignore individual track stop errors during teardown
        }
      }
    } catch {
      // Ignore stream inspection errors
    }
  }

  // 2. Pause remote <audio> element and clear srcObject
  if (audioElement) {
    try {
      audioElement.pause?.();
    } catch {
      // Ignore audio pause errors
    }
    try {
      audioElement.srcObject = null;
    } catch {
      // Ignore srcObject assignment errors
    }
  }

  // 3. Close RTCDataChannel
  if (dataChannel) {
    try {
      dataChannel.onopen = null;
      dataChannel.onclose = null;
      dataChannel.onerror = null;
      dataChannel.onmessage = null;
      dataChannel.close?.();
    } catch {
      // Ignore data channel close errors
    }
  }

  // 4. Close RTCPeerConnection
  if (peerConnection) {
    try {
      peerConnection.onconnectionstatechange = null;
      peerConnection.oniceconnectionstatechange = null;
      peerConnection.ontrack = null;
      peerConnection.ondatachannel = null;
      peerConnection.close?.();
    } catch {
      // Ignore peer connection close errors
    }
  }
}

export class RealtimeConnectionManager {
  state: RealtimeConnectionState = "idle";
  conversationState: RealtimeConversationState = "listening";
  peerConnection: RTCPeerConnection | null = null;
  dataChannel: RTCDataChannel | null = null;
  localStream: MediaStream | null = null;
  audioElement: HTMLAudioElement | null = null;

  private readonly options: RealtimeConnectionOptions;
  private readonly reconnectTimeoutMs: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: RealtimeConnectionOptions = {}) {
    this.options = options;
    this.audioElement = options.audioElement ?? null;
    this.reconnectTimeoutMs =
      typeof options.reconnectTimeoutMs === "number" &&
      options.reconnectTimeoutMs > 0
        ? options.reconnectTimeoutMs
        : DEFAULT_RECONNECT_TIMEOUT_MS;
  }

  setState(nextState: RealtimeConnectionState): void {
    if (this.state === nextState) {
      return;
    }
    this.state = nextState;
    this.options.onStateChange?.(nextState);
  }

  setConversationState(nextState: RealtimeConversationState): void {
    this.conversationState = nextState;
    this.options.onConversationStateChange?.(nextState);
  }

  canStartVoiceChat(): boolean {
    return this.state === "ready";
  }

  async connect(params?: {
    ephemeralKey?: string;
    model?: string;
  }): Promise<void> {
    this.clearReconnectTimer();
    this.setState("connecting");

    try {
      let ephemeralKey = params?.ephemeralKey;
      let model = params?.model;

      if (!ephemeralKey && this.options.fetchToken) {
        const tokenData = await this.options.fetchToken();
        ephemeralKey = tokenData.ephemeralKey;
        if (!model && tokenData.model) {
          model = tokenData.model;
        }
      }

      if (!ephemeralKey || !ephemeralKey.trim()) {
        throw new Error(
          "Missing ephemeral token required to establish Realtime WebRTC connection."
        );
      }

      const resolvedModel =
        model && model.trim().length > 0
          ? model.trim()
          : DEFAULT_REALTIME_MODEL;

      if (!globalThis.navigator?.mediaDevices?.getUserMedia) {
        throw new Error("Microphone mediaDevices API is unavailable.");
      }

      // Capture microphone audio stream
      const stream = await globalThis.navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      this.localStream = stream;

      // Initialize RTCPeerConnection
      const pc = new RTCPeerConnection();
      this.peerConnection = pc;

      // Attach local audio tracks to peer connection
      const audioTracks =
        typeof stream.getAudioTracks === "function"
          ? stream.getAudioTracks()
          : typeof stream.getTracks === "function"
            ? stream.getTracks()
            : [];
      for (const track of audioTracks) {
        pc.addTrack(track, stream);
      }

      // Attach remote audio stream when OpenAI track arrives
      pc.ontrack = (event: RTCTrackEvent) => {
        const remoteStream = event.streams?.[0] ?? null;
        if (this.audioElement && remoteStream) {
          this.audioElement.srcObject = remoteStream;
          void this.audioElement.play?.().catch(() => {});
        }
      };

      // Monitor ICE and peer connection states for 10s grace window & failure recovery
      pc.oniceconnectionstatechange = () => {
        this.handleTransportStateChange(pc.iceConnectionState);
      };

      pc.onconnectionstatechange = () => {
        this.handleTransportStateChange(pc.connectionState);
      };

      // Create oai-events data channel
      const dc = pc.createDataChannel("oai-events");
      this.dataChannel = dc;

      dc.onopen = () => {
        this.clearReconnectTimer();
        this.setState("connected");
      };

      dc.onmessage = (event: MessageEvent) => {
        if (typeof event.data === "string") {
          try {
            const parsed: unknown = JSON.parse(event.data);
            this.options.onEvent?.(parsed);
          } catch {
            this.options.onEvent?.(event.data);
          }
        } else {
          this.options.onEvent?.(event.data);
        }
      };

      dc.onerror = () => {
        this.options.onError?.(new Error("WebRTC data channel error."));
      };

      // Create local SDP offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpOffer = offer.sdp ?? "";
      const sdpUrl = `${OPENAI_REALTIME_BASE_URL}?model=${encodeURIComponent(resolvedModel)}`;

      // Exchange SDP with OpenAI Realtime endpoint
      let sdpResponse = await fetch(sdpUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          "Content-Type": "application/sdp",
        },
        body: sdpOffer,
      });

      if (sdpResponse.status === 404) {
        sdpResponse = await fetch(OPENAI_REALTIME_CALLS_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${ephemeralKey}`,
            "Content-Type": "application/sdp",
          },
          body: sdpOffer,
        });
      }

      if (!sdpResponse.ok) {
        throw new Error(
          `OpenAI Realtime SDP negotiation failed with status ${sdpResponse.status}.`
        );
      }

      const answerSdp = await sdpResponse.text();
      if (!answerSdp || !answerSdp.trim().startsWith("v=0")) {
        throw new DOMException(
          "Failed to parse SDP answer: response body is not valid SDP (missing v=0 header).",
          "InvalidSessionDescriptionError"
        );
      }

      await pc.setRemoteDescription({
        type: "answer",
        sdp: answerSdp,
      });
    } catch (err: unknown) {
      this.clearReconnectTimer();
      this.teardownResources();
      this.setState("error");
      const normalizedError =
        err instanceof Error
          ? err
          : new Error(
              typeof err === "string"
                ? err
                : "Failed to establish WebRTC Realtime session."
            );
      this.options.onError?.(normalizedError);
      throw err;
    }
  }

  disconnect(): void {
    this.clearReconnectTimer();
    this.teardownResources();
    this.setConversationState("listening");
    this.setState("idle");
  }

  cleanup(): void {
    this.disconnect();
  }

  sendEvent(event: unknown): boolean {
    if (!this.dataChannel || this.dataChannel.readyState !== "open") {
      return false;
    }

    try {
      const payload =
        typeof event === "string" ? event : JSON.stringify(event);
      this.dataChannel.send(payload);
      return true;
    } catch (err: unknown) {
      const normalizedError =
        err instanceof Error
          ? err
          : new Error("Failed to send event over WebRTC data channel.");
      this.options.onError?.(normalizedError);
      return false;
    }
  }

  private handleTransportStateChange(
    transportState: RTCPeerConnectionState | RTCIceConnectionState
  ): void {
    if (transportState === "disconnected") {
      this.setState("reconnecting");
      this.startReconnectGraceTimer();
      return;
    }

    if (transportState === "connected" || transportState === "completed") {
      this.clearReconnectTimer();
      this.setState("connected");
      return;
    }

    if (transportState === "failed") {
      this.clearReconnectTimer();
      this.teardownResources();
      this.setState("error");
      this.options.onError?.(
        new Error("WebRTC peer connection entered failed state.")
      );
    }
  }

  private startReconnectGraceTimer(): void {
    if (this.reconnectTimer !== null) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.state === "reconnecting") {
        this.teardownResources();
        this.setState("error");
        this.options.onError?.(
          new Error(
            `WebRTC connection failed to recover within ${this.reconnectTimeoutMs}ms grace period.`
          )
        );
      }
    }, this.reconnectTimeoutMs);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private teardownResources(): void {
    cleanupSession({
      localStream: this.localStream,
      peerConnection: this.peerConnection,
      dataChannel: this.dataChannel,
      audioElement: this.audioElement,
    });
    this.localStream = null;
    this.peerConnection = null;
    this.dataChannel = null;
  }
}

export { RealtimeConnectionManager as RealtimeConnection };
