/**
 * Slice 3C: Speech Interruption & Text Fallback Mode
 * (ADR-07, ADR-09, ADR-10 / AC-07, AC-09, AC-10.4).
 *
 * Implements conversational control functions and state management:
 * - Automatic speech barge-in via Server VAD (`input_audio_buffer.speech_started`) (ADR-07 / AC-07.1)
 * - Manual interrupt button control (`response.cancel` + `output_audio_buffer.clear`) (ADR-07 / AC-07.2)
 * - Automatic text fallback mode with `recvonly` audio transceiver (ADR-09 / AC-09.1)
 * - Text turn dispatch (`conversation.item.create` + `response.create`) (ADR-09 / AC-09.2)
 * - Microphone mute/unmute preserving WebRTC connection (ADR-09 / AC-09.3)
 * - Guarded data channel sending preventing unhandled exceptions (ADR-10 / AC-10.4)
 */

import type { RealtimeConversationState } from "@/lib/realtime/connection";
import {
  TranscriptManager,
  type TranscriptItem,
} from "@/lib/realtime/transcript";

export type MicStatus = "available" | "unavailable";

export interface RealtimeControlsOptions {
  peerConnection?: RTCPeerConnection | null;
  dataChannel?: RTCDataChannel | null;
  localAudioTrack?: MediaStreamTrack | null;
  audioElement?: HTMLAudioElement | null;
  transcriptManager?: TranscriptManager | null;
  onMicStatusChange?: (status: MicStatus) => void;
  onMuteChange?: (isMuted: boolean) => void;
  onTextFallbackChange?: (isFallback: boolean) => void;
  onConversationStateChange?: (state: RealtimeConversationState) => void;
  sendEvent?: (event: unknown) => boolean;
}

export function createTextInputMessageEvent(text: string) {
  return {
    type: "conversation.item.create",
    item: {
      type: "message",
      role: "user",
      content: [
        {
          type: "input_text",
          text,
        },
      ],
    },
  };
}

/**
 * Adds a `recvonly` audio transceiver to the RTCPeerConnection prior to offer
 * creation when connecting without local microphone access (ADR-09 / AC-09.1).
 */
export function setupRecvonlyTransceiver(
  pc: RTCPeerConnection
): RTCRtpTransceiver {
  if (!pc || typeof pc.addTransceiver !== "function") {
    throw new Error("Invalid RTCPeerConnection provided");
  }
  return pc.addTransceiver("audio", { direction: "recvonly" });
}

/**
 * Toggles a MediaStreamTrack enabled state without closing or renegotiating
 * the WebRTC peer connection (ADR-09 / AC-09.3).
 *
 * @param track Local audio track to toggle
 * @param currentMuted Current mute status (defaults to false)
 * @returns The next mute status (true = muted, false = unmuted)
 */
export function toggleMute(
  track?: MediaStreamTrack | null,
  currentMuted: boolean = false
): boolean {
  const nextMuted = !currentMuted;
  if (track) {
    try {
      track.enabled = !nextMuted;
    } catch {
      // Ignore errors if mock track or platform does not allow mutating enabled
    }
  }
  return nextMuted;
}

/**
 * Halts active remote audio playback, finalizes in-progress assistant transcript turn,
 * and sends `response.cancel` and `output_audio_buffer.clear` over the data channel (ADR-07 / AC-07.2, AC-10.4).
 */
export function interruptAssistant(options: {
  dataChannel?: RTCDataChannel | null;
  audioElement?: HTMLAudioElement | null;
  transcriptManager?: TranscriptManager | null;
  onConversationStateChange?: (state: RealtimeConversationState) => void;
  sendEvent?: (event: unknown) => boolean;
}): boolean {
  const {
    dataChannel,
    audioElement,
    transcriptManager,
    onConversationStateChange,
    sendEvent,
  } = options;

  const cancelEvent = { type: "response.cancel" };
  const clearBufferEvent = { type: "output_audio_buffer.clear" };

  let sent = false;
  if (typeof sendEvent === "function") {
    try {
      const s1 = sendEvent(cancelEvent);
      const s2 = sendEvent(clearBufferEvent);
      sent = s1 || s2;
    } catch {
      return false;
    }
    if (!sent) {
      return false;
    }
  } else if (dataChannel) {
    if (dataChannel.readyState !== "open") {
      return false;
    }
    try {
      dataChannel.send(JSON.stringify(cancelEvent));
      dataChannel.send(JSON.stringify(clearBufferEvent));
      sent = true;
    } catch {
      return false;
    }
  } else {
    return false;
  }

  // 1. Immediately halt remote audio playback
  if (audioElement) {
    try {
      audioElement.pause?.();
    } catch {
      // Ignore audio pause errors
    }
  }

  // 2. Finalize in-progress assistant turn in transcript
  if (transcriptManager) {
    const ext = transcriptManager as unknown as {
      markAssistantInterrupted?: () => void;
    };
    if (typeof ext.markAssistantInterrupted === "function") {
      ext.markAssistantInterrupted();
    } else {
      transcriptManager.handleEvent?.(cancelEvent);
    }
  }

  // 3. Transition conversation state back to listening
  onConversationStateChange?.("listening");
  return sent;
}

/**
 * Dispatches a text message turn over the data channel (`conversation.item.create` + `response.create`)
 * and appends the user message to the transcript (ADR-09 / AC-09.2, AC-10.4).
 */
export function sendTextMessage(options: {
  text: string;
  dataChannel?: RTCDataChannel | null;
  transcriptManager?: TranscriptManager | null;
  sendEvent?: (event: unknown) => boolean;
}): boolean {
  const trimmed = (options.text ?? "").trim();
  if (!trimmed) {
    return false;
  }

  const itemEvent = createTextInputMessageEvent(trimmed);
  const responseEvent = { type: "response.create" };

  let sent = false;
  if (typeof options.sendEvent === "function") {
    try {
      const s1 = options.sendEvent(itemEvent);
      const s2 = options.sendEvent(responseEvent);
      sent = s1 && s2;
    } catch {
      return false;
    }
    if (!sent) {
      return false;
    }
  } else if (options.dataChannel) {
    if (options.dataChannel.readyState !== "open") {
      return false;
    }
    try {
      options.dataChannel.send(JSON.stringify(itemEvent));
      options.dataChannel.send(JSON.stringify(responseEvent));
      sent = true;
    } catch {
      return false;
    }
  } else {
    return false;
  }

  // Append user message to transcript
  if (options.transcriptManager) {
    const ext = options.transcriptManager as unknown as {
      appendUserMessage?: (text: string) => TranscriptItem;
    };
    if (typeof ext.appendUserMessage === "function") {
      ext.appendUserMessage(trimmed);
    } else {
      options.transcriptManager.handleEvent?.(itemEvent);
    }
  }

  return true;
}

/**
 * Manages speech interruption, barge-in, microphone mute states, and text chat fallback.
 */
export class RealtimeControlsManager {
  isMuted: boolean = false;
  micStatus: MicStatus = "available";
  isTextFallback: boolean = false;
  peerConnection: RTCPeerConnection | null = null;
  dataChannel: RTCDataChannel | null = null;
  localAudioTrack: MediaStreamTrack | null = null;
  audioElement: HTMLAudioElement | null = null;
  transcriptManager: TranscriptManager | null = null;
  conversationState: RealtimeConversationState = "listening";

  private readonly options: RealtimeControlsOptions;

  constructor(options: RealtimeControlsOptions = {}) {
    this.options = options;
    this.peerConnection = options.peerConnection ?? null;
    this.dataChannel = options.dataChannel ?? null;
    this.localAudioTrack = options.localAudioTrack ?? null;
    this.audioElement = options.audioElement ?? null;
    this.transcriptManager = options.transcriptManager ?? null;

    if (this.localAudioTrack) {
      this.isMuted = !this.localAudioTrack.enabled;
    }
  }

  /**
   * Manual Interrupt: sends `response.cancel` and `output_audio_buffer.clear`
   * when the assistant is speaking (ADR-07 / AC-07.2).
   */
  interrupt(): boolean {
    if (this.dataChannel && this.dataChannel.readyState !== "open") {
      return false;
    }
    if (!this.isAssistantSpeaking()) {
      return false;
    }

    return interruptAssistant({
      dataChannel: this.dataChannel,
      audioElement: this.audioElement,
      transcriptManager: this.transcriptManager,
      onConversationStateChange: (state) => {
        this.setConversationState(state);
      },
      sendEvent: this.options.sendEvent,
    });
  }

  /**
   * Server VAD Automatic Barge-In: halts playback, marks in-progress assistant
   * turn as interrupted, transitions to user_speaking, and clears server audio buffers (ADR-07 / AC-07.1).
   */
  handleBargeIn(event?: unknown): boolean {
    if (!this.isAssistantSpeaking()) {
      return false;
    }

    // 1. Immediately transition conversation sub-state to user_speaking
    this.setConversationState("user_speaking");

    // 2. Immediately halt active remote audio playback
    if (this.audioElement) {
      try {
        this.audioElement.pause?.();
      } catch {
        // Ignore audio pause errors
      }
    }

    // 3. Finalize in-progress assistant turn, marking it as interrupted
    if (this.transcriptManager) {
      const ext = this.transcriptManager as unknown as {
        markAssistantInterrupted?: () => void;
      };
      if (typeof ext.markAssistantInterrupted === "function") {
        ext.markAssistantInterrupted();
      } else {
        this.transcriptManager.handleEvent?.({ type: "response.cancel" });
      }
    }

    // 4. Send cancel and clear buffer events over data channel to stop outbound server audio
    const cancelEvent = { type: "response.cancel" };
    const clearBufferEvent = { type: "output_audio_buffer.clear" };

    if (typeof this.options.sendEvent === "function") {
      try {
        this.options.sendEvent(cancelEvent);
        this.options.sendEvent(clearBufferEvent);
      } catch {
        // Safe guard against send errors
      }
    } else if (this.dataChannel && this.dataChannel.readyState === "open") {
      try {
        this.dataChannel.send(JSON.stringify(cancelEvent));
        this.dataChannel.send(JSON.stringify(clearBufferEvent));
      } catch {
        // Safe guard against closed channel during send
      }
    }

    return true;
  }

  /**
   * Sends a user text message turn and triggers response generation (ADR-09 / AC-09.2).
   */
  sendTextMessage(text: string): boolean {
    return sendTextMessage({
      text,
      dataChannel: this.dataChannel,
      transcriptManager: this.transcriptManager,
      sendEvent: this.options.sendEvent,
    });
  }

  /**
   * Toggles microphone mute status without dropping the WebRTC connection (ADR-09 / AC-09.3).
   */
  toggleMute(): boolean {
    this.isMuted = toggleMute(this.localAudioTrack, this.isMuted);
    this.options.onMuteChange?.(this.isMuted);
    return this.isMuted;
  }

  /**
   * Explicitly sets microphone mute status (ADR-09 / AC-09.3).
   */
  setMuted(muted: boolean): boolean {
    this.isMuted = muted;
    if (this.localAudioTrack) {
      try {
        this.localAudioTrack.enabled = !muted;
      } catch {
        // Ignore errors
      }
    }
    this.options.onMuteChange?.(this.isMuted);
    return this.isMuted;
  }

  /**
   * Transitions into text fallback mode when microphone is unavailable (ADR-09 / AC-09.1).
   */
  enableTextFallback(reason?: string): void {
    this.isTextFallback = true;
    this.micStatus = "unavailable";
    this.options.onMicStatusChange?.("unavailable");
    this.options.onTextFallbackChange?.(true);
  }

  /**
   * Configures a recvonly audio transceiver on RTCPeerConnection (ADR-09 / AC-09.1).
   */
  configureRecvonlyTransceiver(pc?: RTCPeerConnection): RTCRtpTransceiver {
    const targetPc = pc ?? this.peerConnection;
    if (!targetPc) {
      throw new Error(
        "RTCPeerConnection is required to configure recvonly transceiver"
      );
    }
    return setupRecvonlyTransceiver(targetPc);
  }

  setConversationState(state: RealtimeConversationState): void {
    this.conversationState = state;
    this.options.onConversationStateChange?.(state);
    if (this.transcriptManager) {
      this.transcriptManager.conversationState = state;
    }
  }

  private isAssistantSpeaking(): boolean {
    if (this.conversationState === "assistant_speaking") {
      return true;
    }
    if (this.transcriptManager) {
      if (this.transcriptManager.conversationState === "assistant_speaking") {
        return true;
      }
      const items = this.transcriptManager.getItems();
      if (
        items.some(
          (item) => item.role === "assistant" && item.status === "streaming"
        )
      ) {
        return true;
      }
    }
    return false;
  }
}

export { RealtimeControlsManager as RealtimeControls };
