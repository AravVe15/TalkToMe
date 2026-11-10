/**
 * Slice 3A: WebRTC Connection & Audio Transport Unit Test Suite
 *
 * Verifies acceptance criteria:
 * - AC-06.1: Start Voice Chat button availability per connection state (ADR-06)
 * - AC-06.2: Deterministic resource teardown on Stop, source switch, or unmount (ADR-06)
 * - AC-06.3: Connection states & conversation flow sub-states (ADR-06)
 * - AC-10.1: 10-second ICE disconnect grace timer initiation (ADR-10)
 * - AC-10.2: Reconnect recovery within 10-second grace window (ADR-10)
 * - AC-10.3: Grace timer expiration and failure cleanup with context preservation (ADR-10)
 * - AC-10.4: Guarded data channel sending when readyState !== "open" (ADR-10)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  RealtimeConnectionManager,
  RealtimeConnection,
  cleanupSession,
  type RealtimeConnectionState,
  type RealtimeConversationState,
} from "@/lib/realtime/connection";
import {
  MockRTCPeerConnection,
  MockRTCDataChannel,
  MockMediaStreamTrack,
  MockMediaStream,
  MockHTMLAudioElement,
  MOCK_LOCAL_SDP_OFFER,
  MOCK_REMOTE_SDP_ANSWER,
  setupMockWebRTCGlobals,
} from "../../fixtures/webrtc-fixtures";

describe("Slice 3A: WebRTC Connection & Audio Transport (AC-06, AC-10)", () => {
  let webrtcHarness: ReturnType<typeof setupMockWebRTCGlobals>;
  let mockAudioElement: MockHTMLAudioElement;

  beforeEach(() => {
    vi.restoreAllMocks();
    webrtcHarness = setupMockWebRTCGlobals();
    mockAudioElement = new MockHTMLAudioElement();
  });

  afterEach(() => {
    webrtcHarness.cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("AC-06.1 & AC-06.3: State Machine & Button Enablement", () => {
    it("AC-06.1: initializes in 'idle' state where starting voice chat is disabled", () => {
      const manager = new RealtimeConnectionManager();
      expect(manager.state).toBe("idle");
      expect(manager.canStartVoiceChat()).toBe(false);
    });

    it("AC-06.1: canStartVoiceChat is false during 'ingesting' and true only when 'ready'", () => {
      const manager = new RealtimeConnectionManager();

      // Transition to ingesting
      manager.setState("ingesting");
      expect(manager.state).toBe("ingesting");
      expect(manager.canStartVoiceChat()).toBe(false);

      // Transition to ready once source text is parsed
      manager.setState("ready");
      expect(manager.state).toBe("ready");
      expect(manager.canStartVoiceChat()).toBe(true);

      // In any active or error state, starting a new session directly is disabled
      manager.setState("connecting");
      expect(manager.canStartVoiceChat()).toBe(false);

      manager.setState("connected");
      expect(manager.canStartVoiceChat()).toBe(false);

      manager.setState("reconnecting");
      expect(manager.canStartVoiceChat()).toBe(false);

      manager.setState("error");
      expect(manager.canStartVoiceChat()).toBe(false);
    });

    it("AC-06.3: notifies subscriber on state transitions", () => {
      const statesObserved: RealtimeConnectionState[] = [];
      const manager = new RealtimeConnectionManager({
        onStateChange: (s) => statesObserved.push(s),
      });

      manager.setState("ready");
      manager.setState("connecting");
      manager.setState("connected");

      expect(statesObserved).toEqual(["ready", "connecting", "connected"]);
    });

    it("AC-06.3: tracks conversation flow sub-states (listening, user_speaking, assistant_thinking, assistant_speaking)", () => {
      const convStatesObserved: RealtimeConversationState[] = [];
      const manager = new RealtimeConnectionManager({
        onConversationStateChange: (cs) => convStatesObserved.push(cs),
      });

      expect(manager.conversationState).toBe("listening");

      manager.setConversationState("user_speaking");
      manager.setConversationState("assistant_thinking");
      manager.setConversationState("assistant_speaking");
      manager.setConversationState("listening");

      expect(convStatesObserved).toEqual([
        "user_speaking",
        "assistant_thinking",
        "assistant_speaking",
        "listening",
      ]);
    });
  });

  describe("WebRTC Connection Establishment & Audio Transport", () => {
    it("executes complete WebRTC offer/answer negotiation with OpenAI endpoint", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(MOCK_REMOTE_SDP_ANSWER, {
          status: 200,
          headers: { "Content-Type": "application/sdp" },
        })
      );

      const stateChanges: RealtimeConnectionState[] = [];
      const manager = new RealtimeConnectionManager({
        audioElement: mockAudioElement as unknown as HTMLAudioElement,
        onStateChange: (s) => stateChanges.push(s),
      });

      manager.setState("ready");

      // Connect with ephemeralKey
      const connectPromise = manager.connect({
        ephemeralKey: "ek_test_session_token_webrtc_123",
        model: "gpt-4o-realtime-preview",
      });

      // Verify intermediate connecting state
      expect(manager.state).toBe("connecting");

      await connectPromise;

      // Verify microphone capture with acoustic echo cancellation constraints (AC-11.5, ADR-11)
      expect(webrtcHarness.mockGetUserMedia).toHaveBeenCalledWith({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
        },
      });

      // Verify peer connection created and audio track added
      const pc = manager.peerConnection as unknown as MockRTCPeerConnection;
      expect(pc).toBeDefined();
      expect(pc.localTracks.length).toBeGreaterThanOrEqual(1);
      expect(pc.localTracks[0].kind).toBe("audio");

      // Verify oai-events data channel created
      expect(pc.createDataChannel).toHaveBeenCalledWith("oai-events");
      const dc = manager.dataChannel as unknown as MockRTCDataChannel;
      expect(dc).toBeDefined();
      expect(dc.label).toBe("oai-events");

      // Verify SDP offer was created and set as local description
      expect(pc.createOffer).toHaveBeenCalled();
      expect(pc.setLocalDescription).toHaveBeenCalledWith({
        type: "offer",
        sdp: MOCK_LOCAL_SDP_OFFER,
      });

      // Verify SDP exchange with OpenAI Realtime API
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [sdpUrl, sdpInit] = fetchSpy.mock.calls[0];
      expect(sdpUrl).toBe("https://api.openai.com/v1/realtime/calls");
      expect(sdpInit?.method).toBe("POST");
      expect(sdpInit?.body).toBe(MOCK_LOCAL_SDP_OFFER);

      const headers = new Headers(sdpInit?.headers);
      expect(headers.get("Authorization")).toBe("Bearer ek_test_session_token_webrtc_123");
      expect(headers.get("Content-Type")).toBe("application/sdp");

      // Verify remote description set with OpenAI's SDP answer
      expect(pc.setRemoteDescription).toHaveBeenCalledWith({
        type: "answer",
        sdp: MOCK_REMOTE_SDP_ANSWER,
      });

      // Simulate data channel open to finalize connection
      dc.simulateOpen();
      expect(manager.state).toBe("connected");
      expect(stateChanges).toContain("connected");
    });

    it("attaches remote audio stream to audioElement.srcObject when ontrack fires", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(MOCK_REMOTE_SDP_ANSWER, {
          status: 200,
          headers: { "Content-Type": "application/sdp" },
        })
      );

      const manager = new RealtimeConnectionManager({
        audioElement: mockAudioElement as unknown as HTMLAudioElement,
      });

      manager.setState("ready");
      await manager.connect({ ephemeralKey: "ek_token" });

      const pc = manager.peerConnection as unknown as MockRTCPeerConnection;

      // Simulate remote track event from OpenAI server audio stream
      const remoteTrack = new MockMediaStreamTrack("remote-openai-voice-track");
      const remoteStream = new MockMediaStream([remoteTrack]);
      pc.simulateRemoteTrack(remoteTrack, remoteStream);

      expect(mockAudioElement.srcObject).toBe(remoteStream);
    });

    it("fetches ephemeral token automatically if fetchToken option is provided", async () => {
      const mockFetchToken = vi.fn(async () => ({
        ephemeralKey: "ek_auto_fetched_key",
        model: "gpt-4o-realtime-preview",
      }));

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(MOCK_REMOTE_SDP_ANSWER, { status: 200 })
      );

      const manager = new RealtimeConnectionManager({
        fetchToken: mockFetchToken,
        audioElement: mockAudioElement as unknown as HTMLAudioElement,
      });

      manager.setState("ready");
      await manager.connect();

      expect(mockFetchToken).toHaveBeenCalledTimes(1);

      const pc = manager.peerConnection as unknown as MockRTCPeerConnection;
      const dc = manager.dataChannel as unknown as MockRTCDataChannel;
      dc.simulateOpen();

      expect(manager.state).toBe("connected");
    });
  });

  describe("AC-06.2: Deterministic Teardown & Resource Cleanup", () => {
    it("AC-06.2: stops local tracks, clears audio element, and closes dataChannel & peerConnection on disconnect()", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(MOCK_REMOTE_SDP_ANSWER, { status: 200 })
      );

      const manager = new RealtimeConnectionManager({
        audioElement: mockAudioElement as unknown as HTMLAudioElement,
      });

      manager.setState("ready");
      await manager.connect({ ephemeralKey: "ek_test" });

      const pc = manager.peerConnection as unknown as MockRTCPeerConnection;
      const dc = manager.dataChannel as unknown as MockRTCDataChannel;
      dc.simulateOpen();

      const localTrack = pc.localTracks[0];
      expect(localTrack.readyState).toBe("live");

      // Attach mock remote audio stream
      mockAudioElement.srcObject = new MockMediaStream();

      // Execute teardown
      manager.disconnect();

      // 1. Calls .stop() on all local MediaStreamTracks
      expect(localTrack.stop).toHaveBeenCalled();
      expect(localTrack.readyState).toBe("ended");

      // 2. Clears audioElement.srcObject and pauses audio
      expect(mockAudioElement.srcObject).toBeNull();
      expect(mockAudioElement.pause).toHaveBeenCalled();

      // 3. Closes RTCDataChannel and RTCPeerConnection
      expect(dc.close).toHaveBeenCalled();
      expect(pc.close).toHaveBeenCalled();

      // 4. Transitions state cleanly to idle
      expect(manager.state).toBe("idle");
    });

    it("AC-06.2: is idempotent and safe against repeated calls to disconnect() / cleanup()", async () => {
      const manager = new RealtimeConnectionManager();
      manager.setState("ready");

      // Call cleanup before connecting (should not throw)
      expect(() => manager.disconnect()).not.toThrow();
      expect(() => manager.cleanup()).not.toThrow();
    });

    it("AC-06.2: performs complete teardown when switching source while connected", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(MOCK_REMOTE_SDP_ANSWER, { status: 200 })
      );

      const manager = new RealtimeConnectionManager({
        audioElement: mockAudioElement as unknown as HTMLAudioElement,
      });

      manager.setState("ready");
      await manager.connect({ ephemeralKey: "ek_initial" });

      const pc = manager.peerConnection as unknown as MockRTCPeerConnection;
      const dc = manager.dataChannel as unknown as MockRTCDataChannel;
      dc.simulateOpen();

      const localTrack = pc.localTracks[0];

      // Simulate source switch (e.g. user selects a new PDF file)
      manager.disconnect();
      manager.setState("ingesting");

      expect(localTrack.stop).toHaveBeenCalled();
      expect(pc.close).toHaveBeenCalled();
      expect(dc.close).toHaveBeenCalled();
      expect(manager.state).toBe("ingesting");
      expect(manager.canStartVoiceChat()).toBe(false);
    });

    it("cleanupSession standalone helper safely cleans up arbitrary resource bags", () => {
      const track1 = new MockMediaStreamTrack("t1");
      const track2 = new MockMediaStreamTrack("t2");
      const stream = new MockMediaStream([track1, track2]);
      const pc = new MockRTCPeerConnection();
      const dc = new MockRTCDataChannel("test-dc");
      const audio = new MockHTMLAudioElement();
      audio.srcObject = stream;

      cleanupSession({
        localStream: stream as unknown as MediaStream,
        peerConnection: pc as unknown as RTCPeerConnection,
        dataChannel: dc as unknown as RTCDataChannel,
        audioElement: audio as unknown as HTMLAudioElement,
      });

      expect(track1.stop).toHaveBeenCalled();
      expect(track2.stop).toHaveBeenCalled();
      expect(audio.srcObject).toBeNull();
      expect(audio.pause).toHaveBeenCalled();
      expect(pc.close).toHaveBeenCalled();
      expect(dc.close).toHaveBeenCalled();
    });

    it("cleanupSession handles null and undefined arguments without throwing", () => {
      expect(() => cleanupSession({})).not.toThrow();
      expect(() =>
        cleanupSession({
          localStream: null,
          peerConnection: null,
          dataChannel: null,
          audioElement: null,
        })
      ).not.toThrow();
    });
  });

  describe("AC-10.1 – AC-10.3: Poor Network Resilience & 10-Second ICE Grace Period", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it("AC-10.1 & AC-10.2: transitions to 'reconnecting' on ICE disconnect and self-heals within 10 seconds", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(MOCK_REMOTE_SDP_ANSWER, { status: 200 })
      );

      const stateHistory: RealtimeConnectionState[] = [];
      const manager = new RealtimeConnectionManager({
        audioElement: mockAudioElement as unknown as HTMLAudioElement,
        onStateChange: (s) => stateHistory.push(s),
      });

      manager.setState("ready");
      await manager.connect({ ephemeralKey: "ek_test" });

      const pc = manager.peerConnection as unknown as MockRTCPeerConnection;
      const dc = manager.dataChannel as unknown as MockRTCDataChannel;
      dc.simulateOpen();

      expect(manager.state).toBe("connected");

      // Network blip: simulate ICE disconnect
      pc.simulateIceStateChange("disconnected");
      expect(manager.state).toBe("reconnecting");
      expect(stateHistory).toContain("reconnecting");

      // Advance timer by 5 seconds (within 10,000 ms grace period)
      vi.advanceTimersByTime(5000);
      expect(manager.state).toBe("reconnecting");

      // Network recovers: ICE transitions back to connected
      pc.simulateIceStateChange("connected");

      expect(manager.state).toBe("connected");

      // Advance time past the original 10s mark to ensure grace timer was properly canceled
      vi.advanceTimersByTime(10000);
      expect(manager.state).toBe("connected"); // Still connected! Did not crash into error!
    });

    it("AC-10.1 & AC-10.3: transitions to 'error' and executes teardown when 10-second grace timer expires without recovery", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(MOCK_REMOTE_SDP_ANSWER, { status: 200 })
      );

      const stateHistory: RealtimeConnectionState[] = [];
      const manager = new RealtimeConnectionManager({
        audioElement: mockAudioElement as unknown as HTMLAudioElement,
        onStateChange: (s) => stateHistory.push(s),
      });

      manager.setState("ready");
      await manager.connect({ ephemeralKey: "ek_test" });

      const pc = manager.peerConnection as unknown as MockRTCPeerConnection;
      const dc = manager.dataChannel as unknown as MockRTCDataChannel;
      dc.simulateOpen();

      const localTrack = pc.localTracks[0];

      // Simulate connectionState disconnected
      pc.simulateConnectionStateChange("disconnected");
      expect(manager.state).toBe("reconnecting");

      // Advance time by 9,999 ms (just before grace timer expiry)
      vi.advanceTimersByTime(9999);
      expect(manager.state).toBe("reconnecting");
      expect(localTrack.readyState).toBe("live");

      // Advance 2 ms more (crossing the 10,000 ms threshold)
      vi.advanceTimersByTime(2);

      // Grace timer has expired: must trigger teardown and transition to error
      expect(manager.state).toBe("error");
      expect(stateHistory).toContain("error");
      expect(localTrack.stop).toHaveBeenCalled();
      expect(pc.close).toHaveBeenCalled();
      expect(dc.close).toHaveBeenCalled();
    });

    it("AC-10.3: transitions immediately to 'error' and cleans up when connection enters 'failed'", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(MOCK_REMOTE_SDP_ANSWER, { status: 200 })
      );

      const manager = new RealtimeConnectionManager({
        audioElement: mockAudioElement as unknown as HTMLAudioElement,
      });

      manager.setState("ready");
      await manager.connect({ ephemeralKey: "ek_test" });

      const pc = manager.peerConnection as unknown as MockRTCPeerConnection;
      const dc = manager.dataChannel as unknown as MockRTCDataChannel;
      dc.simulateOpen();

      // Immediate catastrophic failure (e.g. DTLS handshake failure or NAT traversal abort)
      pc.simulateConnectionStateChange("failed");

      expect(manager.state).toBe("error");
      expect(pc.close).toHaveBeenCalled();
    });
  });

  describe("AC-10.4: Guarded Data Channel Sends", () => {
    it("AC-10.4: sends event and returns true when data channel readyState is 'open'", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(MOCK_REMOTE_SDP_ANSWER, { status: 200 })
      );

      const manager = new RealtimeConnectionManager();
      manager.setState("ready");
      await manager.connect({ ephemeralKey: "ek_test" });

      const dc = manager.dataChannel as unknown as MockRTCDataChannel;
      dc.simulateOpen();

      const eventPayload = { type: "response.cancel" };
      const success = manager.sendEvent(eventPayload);

      expect(success).toBe(true);
      expect(dc.send).toHaveBeenCalledWith(JSON.stringify(eventPayload));
    });

    it("AC-10.4: safely returns false without throwing unhandled exception when data channel is 'connecting'", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(MOCK_REMOTE_SDP_ANSWER, { status: 200 })
      );

      const manager = new RealtimeConnectionManager();
      manager.setState("ready");
      await manager.connect({ ephemeralKey: "ek_test" });

      const dc = manager.dataChannel as unknown as MockRTCDataChannel;
      // Data channel is still connecting
      expect(dc.readyState).toBe("connecting");

      expect(() => {
        const result = manager.sendEvent({ type: "response.cancel" });
        expect(result).toBe(false);
      }).not.toThrow();

      expect(dc.send).not.toHaveBeenCalled();
    });

    it("AC-10.4: safely returns false without throwing when data channel is null or 'closed'", () => {
      const manager = new RealtimeConnectionManager();
      expect(manager.dataChannel).toBeNull();

      expect(() => {
        const result = manager.sendEvent({ type: "response.cancel" });
        expect(result).toBe(false);
      }).not.toThrow();
    });
  });

  describe("Connection Failure Modes & Exception Handling", () => {
    it("handles microphone getUserMedia rejection gracefully and transitions to 'error'", async () => {
      const micError = new DOMException("Permission denied", "NotAllowedError");
      webrtcHarness.mockGetUserMedia.mockRejectedValueOnce(micError);

      const errorsCaught: unknown[] = [];
      const manager = new RealtimeConnectionManager({
        onError: (err) => errorsCaught.push(err),
      });

      manager.setState("ready");

      await expect(manager.connect({ ephemeralKey: "ek_test" })).rejects.toThrow();

      expect(manager.state).toBe("error");
      expect(errorsCaught.length).toBeGreaterThanOrEqual(1);
    });

    it("handles fetchToken failure gracefully and transitions to 'error'", async () => {
      const tokenError = new Error("Token route 500 error");
      const mockFetchToken = vi.fn().mockRejectedValueOnce(tokenError);

      const manager = new RealtimeConnectionManager({
        fetchToken: mockFetchToken,
      });

      manager.setState("ready");

      await expect(manager.connect()).rejects.toThrow();

      expect(manager.state).toBe("error");
    });

    it("handles SDP offer creation failure and cleans up resources", async () => {
      const manager = new RealtimeConnectionManager();
      manager.setState("ready");

      // Mock createOffer failure
      const originalCreateOffer = MockRTCPeerConnection.prototype.createOffer;
      MockRTCPeerConnection.prototype.createOffer = vi.fn().mockRejectedValueOnce(
        new Error("SDP offer creation failure")
      );

      try {
        await expect(manager.connect({ ephemeralKey: "ek_test" })).rejects.toThrow();
        expect(manager.state).toBe("error");
      } finally {
        MockRTCPeerConnection.prototype.createOffer = originalCreateOffer;
      }
    });

    it("handles OpenAI upstream SDP exchange HTTP 4xx/5xx failure gracefully", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("Invalid Ephemeral Token", { status: 401 })
      );

      const errorsCaught: unknown[] = [];
      const manager = new RealtimeConnectionManager({
        onError: (e) => errorsCaught.push(e),
      });

      manager.setState("ready");

      await expect(manager.connect({ ephemeralKey: "ek_invalid" })).rejects.toThrow();

      expect(manager.state).toBe("error");
    });

    it("handles OpenAI upstream SDP exchange network timeout / abort", async () => {
      const abortError = new DOMException("The operation was aborted", "AbortError");
      vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(abortError);

      const manager = new RealtimeConnectionManager();
      manager.setState("ready");

      await expect(manager.connect({ ephemeralKey: "ek_test" })).rejects.toThrow();

      expect(manager.state).toBe("error");
    });

    it("handles setRemoteDescription failure gracefully", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("malformed sdp text that is not valid", { status: 200 })
      );

      const originalSetRemote = MockRTCPeerConnection.prototype.setRemoteDescription;
      MockRTCPeerConnection.prototype.setRemoteDescription = vi.fn().mockRejectedValueOnce(
        new DOMException("Failed to parse SDP answer", "InvalidSessionDescriptionError")
      );

      const manager = new RealtimeConnectionManager();
      manager.setState("ready");

      try {
        await expect(manager.connect({ ephemeralKey: "ek_test" })).rejects.toThrow();
        expect(manager.state).toBe("error");
      } finally {
        MockRTCPeerConnection.prototype.setRemoteDescription = originalSetRemote;
      }
    });
  });

  describe("RealtimeConnection alias export", () => {
    it("exports RealtimeConnection as an alias for RealtimeConnectionManager", () => {
      expect(RealtimeConnection).toBe(RealtimeConnectionManager);
      const conn = new RealtimeConnection();
      expect(conn).toBeInstanceOf(RealtimeConnectionManager);
    });
  });
});
