/**
 * Slice 3C: Speech Interruption & Text Fallback Mode Unit Test Suite
 *
 * Verifies acceptance criteria:
 * - AC-07.1: Automatic speech barge-in via Server VAD speech_started (ADR-07)
 * - AC-07.2: Manual interrupt button control (response.cancel & audio buffer clear) (ADR-07)
 * - AC-09.1: Automatic fallback to text mode on mic failure with recvonly audio transceiver (ADR-09)
 * - AC-09.2: Text message turn dispatch (conversation.item.create + response.create) (ADR-09)
 * - AC-09.3: Microphone mute/unmute control preserving WebRTC connection (ADR-09)
 * - AC-10.4: Guarded data channel sending during interrupt and text turn dispatch (ADR-10)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  RealtimeControlsManager,
  RealtimeControls,
  interruptAssistant,
  sendTextMessage,
  toggleMute,
  setupRecvonlyTransceiver,
  type MicStatus,
} from "@/lib/realtime/controls";
import { TranscriptManager } from "@/lib/realtime/transcript";
import type { RealtimeConversationState } from "@/lib/realtime/connection";
import {
  MockRTCPeerConnection,
  MockRTCDataChannel,
  MockMediaStreamTrack,
  MockHTMLAudioElement,
  setupMockWebRTCGlobals,
} from "../../fixtures/webrtc-fixtures";
import {
  MOCK_RESPONSE_CANCEL_EVENT,
  MOCK_OUTPUT_AUDIO_BUFFER_CLEAR_EVENT,
  MOCK_RESPONSE_CREATE_EVENT,
  createTextInputMessageEvent,
  createMockMicError,
} from "../../fixtures/controls-fixtures";

describe("Slice 3C: Speech Interruption & Text Fallback Mode (AC-07, AC-09)", () => {
  let webrtcHarness: ReturnType<typeof setupMockWebRTCGlobals>;
  let mockAudioElement: MockHTMLAudioElement;
  let mockPeerConnection: MockRTCPeerConnection;
  let mockDataChannel: MockRTCDataChannel;
  let mockAudioTrack: MockMediaStreamTrack;
  let transcriptManager: TranscriptManager;
  let controlsManager: RealtimeControlsManager;
  let conversationState: RealtimeConversationState;

  beforeEach(() => {
    vi.restoreAllMocks();
    webrtcHarness = setupMockWebRTCGlobals();
    mockAudioElement = new MockHTMLAudioElement();
    mockPeerConnection = new MockRTCPeerConnection();
    mockDataChannel = new MockRTCDataChannel("oai-events");
    mockAudioTrack = new MockMediaStreamTrack("mic-track-1");
    transcriptManager = new TranscriptManager();
    conversationState = "listening";

    controlsManager = new RealtimeControlsManager({
      peerConnection: mockPeerConnection as unknown as RTCPeerConnection,
      dataChannel: mockDataChannel as unknown as RTCDataChannel,
      localAudioTrack: mockAudioTrack as unknown as MediaStreamTrack,
      audioElement: mockAudioElement as unknown as HTMLAudioElement,
      transcriptManager,
      onConversationStateChange: (state) => {
        conversationState = state;
      },
    });
  });

  afterEach(() => {
    webrtcHarness.cleanup();
    vi.restoreAllMocks();
  });

  describe("AC-07.1: Automatic Voice Barge-In via Server VAD", () => {
    it("AC-07.1: transitions state to user_speaking, halts audio playback, and marks assistant turn as interrupted when speech_started arrives while assistant is speaking", () => {
      mockDataChannel.simulateOpen();

      // Setup in-progress assistant turn
      transcriptManager.handleEvent({
        type: "response.output_item.added",
        response_id: "resp_1",
        item: { id: "asst_item_1", role: "assistant" },
      });
      transcriptManager.handleEvent({
        type: "response.audio_transcript.delta",
        item_id: "asst_item_1",
        delta: "The early results indicate that our hypothesis...",
      });

      // Assistant is currently speaking
      conversationState = "assistant_speaking";

      // Server VAD emits speech_started event over oai-events (user barged in by talking)
      const bargeInHandled = controlsManager.handleBargeIn({
        type: "input_audio_buffer.speech_started",
        audio_start_ms: 1200,
        item_id: "item_user_interrupt",
      });

      expect(bargeInHandled).toBe(true);

      // 1. Immediately transitions conversation sub-state to user_speaking
      expect(conversationState).toBe("user_speaking");

      // 2. Immediately halts active remote audio playback
      expect(mockAudioElement.pause).toHaveBeenCalled();

      // 3. Finalizes the in-progress assistant turn, marking it as interrupted while preserving already spoken text
      const items = transcriptManager.getItems();
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe("asst_item_1");
      expect(items[0].text).toBe("The early results indicate that our hypothesis...");
      expect(["interrupted", "completed"]).toContain(items[0].status);

      // 4. Sends cancel and clear buffer events over data channel to stop outbound server audio
      expect(mockDataChannel.send).toHaveBeenCalledWith(
        JSON.stringify(MOCK_RESPONSE_CANCEL_EVENT)
      );
      expect(mockDataChannel.send).toHaveBeenCalledWith(
        JSON.stringify(MOCK_OUTPUT_AUDIO_BUFFER_CLEAR_EVENT)
      );
    });

    it("does not interrupt or send cancel events if speech_started arrives while assistant is NOT speaking", () => {
      mockDataChannel.simulateOpen();
      conversationState = "listening";

      const bargeInHandled = controlsManager.handleBargeIn({
        type: "input_audio_buffer.speech_started",
        audio_start_ms: 500,
        item_id: "item_user_1",
      });

      // No cancellation needed when assistant was not talking
      expect(mockDataChannel.send).not.toHaveBeenCalledWith(
        JSON.stringify(MOCK_RESPONSE_CANCEL_EVENT)
      );
      expect(mockAudioElement.pause).not.toHaveBeenCalled();
    });
  });

  describe("AC-07.2: Manual Interrupt Button Control", () => {
    it("AC-07.2: sends response.cancel and output_audio_buffer.clear over data channel, pauses audio, and finalizes assistant turn", () => {
      mockDataChannel.simulateOpen();

      // Setup assistant turn in transcript
      transcriptManager.handleEvent({
        type: "response.output_item.added",
        item: { id: "asst_item_1", role: "assistant" },
      });
      transcriptManager.handleEvent({
        type: "response.audio_transcript.delta",
        item_id: "asst_item_1",
        delta: "A long explanation that the user decides to cut off.",
      });

      conversationState = "assistant_speaking";

      // User clicks manual Interrupt button
      const interrupted = controlsManager.interrupt();
      expect(interrupted).toBe(true);

      // 1. Dispatches response.cancel and output_audio_buffer.clear over oai-events
      expect(mockDataChannel.send).toHaveBeenCalledWith(
        JSON.stringify(MOCK_RESPONSE_CANCEL_EVENT)
      );
      expect(mockDataChannel.send).toHaveBeenCalledWith(
        JSON.stringify(MOCK_OUTPUT_AUDIO_BUFFER_CLEAR_EVENT)
      );

      // 2. Immediately halts audio element playback
      expect(mockAudioElement.pause).toHaveBeenCalled();

      // 3. Finalizes assistant transcript turn while preserving spoken text
      const items = transcriptManager.getItems();
      expect(items[0].text).toBe("A long explanation that the user decides to cut off.");
      expect(["interrupted", "completed"]).toContain(items[0].status);

      // 4. Transitions conversation state back to listening
      expect(conversationState).toBe("listening");
    });

    it("returns false and is a safe no-op when interrupt() is called and assistant is not speaking", () => {
      mockDataChannel.simulateOpen();
      conversationState = "listening";

      const interrupted = controlsManager.interrupt();
      expect(interrupted).toBe(false);
      expect(mockDataChannel.send).not.toHaveBeenCalled();
    });

    it("AC-10.4: safely returns false without throwing unhandled exception when data channel is closed or connecting", () => {
      // Data channel is connecting (not open)
      expect(mockDataChannel.readyState).toBe("connecting");
      conversationState = "assistant_speaking";

      expect(() => {
        const interrupted = controlsManager.interrupt();
        expect(interrupted).toBe(false);
      }).not.toThrow();

      expect(mockDataChannel.send).not.toHaveBeenCalled();
    });
  });

  describe("AC-09.1: Text-Based Chat Fallback Mode & Transceiver Configuration", () => {
    it("AC-09.1: transitions into Text Fallback Mode when mic permission is denied (NotAllowedError)", () => {
      const micStatusUpdates: MicStatus[] = [];
      const fallbackUpdates: boolean[] = [];

      const manager = new RealtimeControlsManager({
        peerConnection: mockPeerConnection as unknown as RTCPeerConnection,
        onMicStatusChange: (status) => micStatusUpdates.push(status),
        onTextFallbackChange: (fallback) => fallbackUpdates.push(fallback),
      });

      const notAllowedError = createMockMicError("NotAllowedError", "User denied mic permission");
      manager.enableTextFallback(notAllowedError.message);

      expect(manager.isTextFallback).toBe(true);
      expect(manager.micStatus).toBe("unavailable");
      expect(fallbackUpdates).toContain(true);
      expect(micStatusUpdates).toContain("unavailable");
    });

    it("AC-09.1: configures a recvonly audio transceiver on RTCPeerConnection in text fallback mode", () => {
      const pc = new MockRTCPeerConnection();
      const transceiver = setupRecvonlyTransceiver(pc as unknown as RTCPeerConnection);

      expect(pc.addTransceiver).toHaveBeenCalledWith("audio", { direction: "recvonly" });
      expect(transceiver.direction).toBe("recvonly");
    });

    it("AC-09.1: configureRecvonlyTransceiver method configures transceiver on internal peerConnection", () => {
      const pc = new MockRTCPeerConnection();
      const manager = new RealtimeControlsManager({
        peerConnection: pc as unknown as RTCPeerConnection,
      });

      const transceiver = manager.configureRecvonlyTransceiver(pc as unknown as RTCPeerConnection);
      expect(pc.addTransceiver).toHaveBeenCalledWith("audio", { direction: "recvonly" });
      expect(transceiver.direction).toBe("recvonly");
    });
  });

  describe("AC-09.2: Text Message Turn Dispatch", () => {
    it("AC-09.2: dispatches conversation.item.create (input_text) and response.create, and appends user message to transcript", () => {
      mockDataChannel.simulateOpen();

      const userText = "Could you explain the methodology in section 2?";
      const success = controlsManager.sendTextMessage(userText);

      expect(success).toBe(true);

      // 1. Sends conversation.item.create with input_text content
      expect(mockDataChannel.send).toHaveBeenCalledWith(
        JSON.stringify(createTextInputMessageEvent(userText))
      );

      // 2. Follows immediately with response.create to trigger model response
      expect(mockDataChannel.send).toHaveBeenCalledWith(
        JSON.stringify(MOCK_RESPONSE_CREATE_EVENT)
      );

      // 3. Appends user message to transcript
      const items = transcriptManager.getItems();
      expect(items).toHaveLength(1);
      expect(items[0].role).toBe("user");
      expect(items[0].text).toBe(userText);
      expect(items[0].status).toBe("completed");
    });

    it("rejects empty or whitespace-only text messages safely without dispatching events", () => {
      mockDataChannel.simulateOpen();

      expect(controlsManager.sendTextMessage("")).toBe(false);
      expect(controlsManager.sendTextMessage("    \n\t  ")).toBe(false);

      expect(mockDataChannel.send).not.toHaveBeenCalled();
      expect(transcriptManager.getItems()).toHaveLength(0);
    });

    it("trims leading and trailing whitespace on sent text messages", () => {
      mockDataChannel.simulateOpen();

      const success = controlsManager.sendTextMessage("   Padded text question.   ");
      expect(success).toBe(true);

      expect(mockDataChannel.send).toHaveBeenCalledWith(
        JSON.stringify(createTextInputMessageEvent("Padded text question."))
      );

      const items = transcriptManager.getItems();
      expect(items[0].text).toBe("Padded text question.");
    });

    it("AC-10.4: safely returns false without throwing when sending text message and data channel is not open", () => {
      expect(mockDataChannel.readyState).toBe("connecting");

      expect(() => {
        const success = controlsManager.sendTextMessage("Test question");
        expect(success).toBe(false);
      }).not.toThrow();

      expect(mockDataChannel.send).not.toHaveBeenCalled();
    });
  });

  describe("AC-09.3: Microphone Mute & Unmute Control", () => {
    it("AC-09.3: toggleMute sets localAudioTrack.enabled to false (mute) and true (unmute) without dropping connection", () => {
      const muteUpdates: boolean[] = [];
      const manager = new RealtimeControlsManager({
        peerConnection: mockPeerConnection as unknown as RTCPeerConnection,
        localAudioTrack: mockAudioTrack as unknown as MediaStreamTrack,
        onMuteChange: (isMuted) => muteUpdates.push(isMuted),
      });

      expect(mockAudioTrack.enabled).toBe(true);
      expect(manager.isMuted).toBe(false);

      // Toggle Mute -> Muted
      const mutedResult = manager.toggleMute();
      expect(mutedResult).toBe(true);
      expect(mockAudioTrack.enabled).toBe(false);
      expect(manager.isMuted).toBe(true);
      expect(muteUpdates).toContain(true);

      // Connection is NOT closed
      expect(mockPeerConnection.close).not.toHaveBeenCalled();

      // Toggle Mute -> Unmuted
      const unmutedResult = manager.toggleMute();
      expect(unmutedResult).toBe(false);
      expect(mockAudioTrack.enabled).toBe(true);
      expect(manager.isMuted).toBe(false);

      expect(mockPeerConnection.close).not.toHaveBeenCalled();
    });

    it("setMuted explicitly sets mute status", () => {
      controlsManager.setMuted(true);
      expect(mockAudioTrack.enabled).toBe(false);
      expect(controlsManager.isMuted).toBe(true);

      controlsManager.setMuted(false);
      expect(mockAudioTrack.enabled).toBe(true);
      expect(controlsManager.isMuted).toBe(false);
    });

    it("handles toggleMute safely when no audio track exists (e.g. text fallback mode)", () => {
      const manager = new RealtimeControlsManager({
        localAudioTrack: null,
      });

      expect(() => {
        manager.toggleMute();
      }).not.toThrow();
    });
  });

  describe("Standalone Helper Functions", () => {
    it("interruptAssistant helper executes interrupt sequence", () => {
      mockDataChannel.simulateOpen();
      const onStateChange = vi.fn();

      const success = interruptAssistant({
        dataChannel: mockDataChannel as unknown as RTCDataChannel,
        audioElement: mockAudioElement as unknown as HTMLAudioElement,
        transcriptManager,
        onConversationStateChange: onStateChange,
      });

      expect(success).toBe(true);
      expect(mockDataChannel.send).toHaveBeenCalledWith(
        JSON.stringify(MOCK_RESPONSE_CANCEL_EVENT)
      );
      expect(mockAudioElement.pause).toHaveBeenCalled();
      expect(onStateChange).toHaveBeenCalledWith("listening");
    });

    it("sendTextMessage helper sends text turn", () => {
      mockDataChannel.simulateOpen();

      const success = sendTextMessage({
        text: "Direct text question",
        dataChannel: mockDataChannel as unknown as RTCDataChannel,
        transcriptManager,
      });

      expect(success).toBe(true);
      expect(mockDataChannel.send).toHaveBeenCalledWith(
        JSON.stringify(createTextInputMessageEvent("Direct text question"))
      );
      expect(transcriptManager.getItems()).toHaveLength(1);
    });

    it("toggleMute standalone helper toggles track enabled state", () => {
      const track = new MockMediaStreamTrack();
      expect(track.enabled).toBe(true);

      const isMutedNow = toggleMute(track as unknown as MediaStreamTrack, false);
      expect(isMutedNow).toBe(true);
      expect(track.enabled).toBe(false);

      const isUnmutedNow = toggleMute(track as unknown as MediaStreamTrack, true);
      expect(isUnmutedNow).toBe(false);
      expect(track.enabled).toBe(true);
    });
  });

  describe("RealtimeControls Alias Export", () => {
    it("exports RealtimeControls as an alias for RealtimeControlsManager", () => {
      expect(RealtimeControls).toBe(RealtimeControlsManager);
      const instance = new RealtimeControls();
      expect(instance).toBeInstanceOf(RealtimeControlsManager);
    });
  });
});
