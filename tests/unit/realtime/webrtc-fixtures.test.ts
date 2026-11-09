/**
 * Unit verification tests for WebRTC test fixtures
 */

import { describe, it, expect } from "vitest";
import {
  MockMediaStreamTrack,
  MockMediaStream,
  MockRTCDataChannel,
  MockRTCPeerConnection,
  MockHTMLAudioElement,
  MOCK_LOCAL_SDP_OFFER,
  MOCK_REMOTE_SDP_ANSWER,
  setupMockWebRTCGlobals,
} from "../../fixtures/webrtc-fixtures";

describe("WebRTC Test Harness & Fixtures Verification", () => {
  it("MockMediaStreamTrack handles lifecycle and stop()", () => {
    const track = new MockMediaStreamTrack("audio-1");
    expect(track.id).toBe("audio-1");
    expect(track.kind).toBe("audio");
    expect(track.enabled).toBe(true);
    expect(track.readyState).toBe("live");

    track.stop();
    expect(track.readyState).toBe("ended");
  });

  it("MockMediaStream provides track filtering and management", () => {
    const track1 = new MockMediaStreamTrack("a1");
    const stream = new MockMediaStream([track1]);

    expect(stream.getTracks()).toHaveLength(1);
    expect(stream.getAudioTracks()).toHaveLength(1);
    expect(stream.getVideoTracks()).toHaveLength(0);

    const track2 = new MockMediaStreamTrack("a2");
    stream.addTrack(track2);
    expect(stream.getTracks()).toHaveLength(2);

    stream.removeTrack(track1);
    expect(stream.getTracks()).toHaveLength(1);
  });

  it("MockRTCDataChannel simulates open, close, and message events", () => {
    const dc = new MockRTCDataChannel("oai-events");
    expect(dc.label).toBe("oai-events");
    expect(dc.readyState).toBe("connecting");

    let opened = false;
    dc.onopen = () => {
      opened = true;
    };
    dc.simulateOpen();
    expect(opened).toBe(true);
    expect(dc.readyState).toBe("open");

    let receivedMsg = "";
    dc.onmessage = (ev) => {
      receivedMsg = ev.data;
    };
    dc.simulateMessage("test-payload");
    expect(receivedMsg).toBe("test-payload");

    dc.close();
    expect(dc.readyState).toBe("closed");
  });

  it("MockRTCPeerConnection manages tracks, data channels, and state simulation", async () => {
    const pc = new MockRTCPeerConnection();
    const track = new MockMediaStreamTrack();
    pc.addTrack(track);

    const dc = pc.createDataChannel("oai-events");
    expect(pc.dataChannels).toContain(dc);

    const offer = await pc.createOffer();
    expect(offer.type).toBe("offer");
    expect(offer.sdp).toBe(MOCK_LOCAL_SDP_OFFER);

    await pc.setLocalDescription(offer);
    expect(pc.localDescription).toEqual(offer);

    await pc.setRemoteDescription({ type: "answer", sdp: MOCK_REMOTE_SDP_ANSWER });
    expect(pc.remoteDescription?.sdp).toBe(MOCK_REMOTE_SDP_ANSWER);

    let iceChanged = false;
    pc.oniceconnectionstatechange = () => {
      iceChanged = true;
    };
    pc.simulateIceStateChange("disconnected");
    expect(iceChanged).toBe(true);
    expect(pc.iceConnectionState).toBe("disconnected");

    pc.close();
    expect(pc.connectionState).toBe("closed");
  });

  it("MockHTMLAudioElement handles playback, muting, and srcObject assignment", () => {
    const audio = new MockHTMLAudioElement();
    const stream = new MockMediaStream();
    audio.srcObject = stream;
    expect(audio.srcObject).toBe(stream);
    expect(audio.paused).toBe(false);
    expect(audio.muted).toBe(false);

    audio.muted = true;
    expect(audio.muted).toBe(true);
    expect(audio.paused).toBe(false);

    audio.pause();
    expect(audio.pause).toHaveBeenCalled();
    expect(audio.paused).toBe(true);

    audio.play();
    expect(audio.play).toHaveBeenCalled();
    expect(audio.paused).toBe(false);
  });

  it("setupMockWebRTCGlobals installs and restores global objects cleanly", () => {
    const harness = setupMockWebRTCGlobals();
    expect(globalThis.RTCPeerConnection).toBeDefined();
    expect(globalThis.MediaStream).toBeDefined();
    expect(globalThis.navigator.mediaDevices.getUserMedia).toBeDefined();
    harness.cleanup();
  });
});
