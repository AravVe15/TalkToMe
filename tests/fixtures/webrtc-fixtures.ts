/**
 * WebRTC Test Fixtures and Mocks for Slice 3A (WebRTC Connection & Audio Transport)
 * Derived strictly from ADR-06, ADR-10, and AC-06.
 */

import { vi } from "vitest";

export const MOCK_LOCAL_SDP_OFFER = `v=0
o=- 123456789 2 IN IP4 127.0.0.1
s=TalkToMe Voice Session Offer
t=0 0
m=audio 9 UDP/TLS/RTP/SAVPF 111
c=IN IP4 0.0.0.0
a=rtcp:9 IN IP4 0.0.0.0
a=sendrecv
`.replace(/\n/g, "\r\n");

export const MOCK_REMOTE_SDP_ANSWER = `v=0
o=- 987654321 2 IN IP4 127.0.0.1
s=OpenAI Realtime WebRTC Answer
t=0 0
m=audio 9 UDP/TLS/RTP/SAVPF 111
c=IN IP4 0.0.0.0
a=rtcp:9 IN IP4 0.0.0.0
a=sendrecv
`.replace(/\n/g, "\r\n");

export class MockMediaStreamTrack {
  id: string;
  kind: string = "audio";
  enabled: boolean = true;
  readyState: "live" | "ended" = "live";
  stop = vi.fn(() => {
    this.readyState = "ended";
  });

  constructor(id: string = "mock-audio-track-1") {
    this.id = id;
  }
}

export class MockMediaStream {
  id: string;
  private tracks: MockMediaStreamTrack[] = [];

  constructor(tracks: MockMediaStreamTrack[] = [new MockMediaStreamTrack()]) {
    this.id = "mock-stream-" + Math.random().toString(36).substring(2, 8);
    this.tracks = [...tracks];
  }

  getTracks = vi.fn((): MockMediaStreamTrack[] => [...this.tracks]);
  getAudioTracks = vi.fn((): MockMediaStreamTrack[] =>
    this.tracks.filter((t) => t.kind === "audio")
  );
  getVideoTracks = vi.fn((): MockMediaStreamTrack[] =>
    this.tracks.filter((t) => t.kind === "video")
  );
  addTrack = vi.fn((track: MockMediaStreamTrack) => {
    this.tracks.push(track);
  });
  removeTrack = vi.fn((track: MockMediaStreamTrack) => {
    this.tracks = this.tracks.filter((t) => t !== track);
  });
}

export class MockRTCDataChannel {
  label: string;
  readyState: "connecting" | "open" | "closing" | "closed" = "connecting";
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;

  send = vi.fn((data: string) => {
    if (this.readyState !== "open") {
      throw new DOMException("RTCDataChannel is not in open state", "InvalidStateError");
    }
  });

  close = vi.fn(() => {
    this.readyState = "closed";
    if (this.onclose) {
      this.onclose(new Event("close"));
    }
  });

  constructor(label: string = "oai-events") {
    this.label = label;
  }

  simulateOpen(): void {
    this.readyState = "open";
    if (this.onopen) {
      this.onopen(new Event("open"));
    }
  }

  simulateMessage(data: string | unknown): void {
    if (this.onmessage) {
      const payload = typeof data === "string" ? data : JSON.stringify(data);
      this.onmessage(new MessageEvent("message", { data: payload }));
    }
  }
}

export class MockRTCPeerConnection {
  connectionState: RTCPeerConnectionState = "new";
  iceConnectionState: RTCIceConnectionState = "new";
  signalingState: RTCSignalingState = "stable";
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;

  localTracks: MockMediaStreamTrack[] = [];
  dataChannels: MockRTCDataChannel[] = [];
  transceivers: Array<{ direction: string }> = [];

  onconnectionstatechange: (() => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  ontrack: ((event: { track: MockMediaStreamTrack; streams: MockMediaStream[] }) => void) | null = null;
  ondatachannel: ((event: { channel: MockRTCDataChannel }) => void) | null = null;

  addTrack = vi.fn((track: MockMediaStreamTrack, _stream?: MockMediaStream) => {
    this.localTracks.push(track);
    return { track };
  });

  createDataChannel = vi.fn((label: string = "oai-events") => {
    const dc = new MockRTCDataChannel(label);
    this.dataChannels.push(dc);
    return dc;
  });

  createOffer = vi.fn(async (): Promise<RTCSessionDescriptionInit> => {
    return {
      type: "offer",
      sdp: MOCK_LOCAL_SDP_OFFER,
    };
  });

  setLocalDescription = vi.fn(async (desc: RTCSessionDescriptionInit) => {
    this.localDescription = desc;
  });

  setRemoteDescription = vi.fn(async (desc: RTCSessionDescriptionInit) => {
    this.remoteDescription = desc;
  });

  addTransceiver = vi.fn((_trackOrKind: unknown, init?: { direction?: string }) => {
    const transceiver = { direction: init?.direction || "sendrecv" };
    this.transceivers.push(transceiver);
    return transceiver;
  });

  close = vi.fn(() => {
    this.connectionState = "closed";
    this.iceConnectionState = "closed";
    this.signalingState = "closed";
  });

  simulateConnectionStateChange(state: RTCPeerConnectionState): void {
    this.connectionState = state;
    if (this.onconnectionstatechange) {
      this.onconnectionstatechange();
    }
  }

  simulateIceStateChange(state: RTCIceConnectionState): void {
    this.iceConnectionState = state;
    if (this.oniceconnectionstatechange) {
      this.oniceconnectionstatechange();
    }
  }

  simulateRemoteTrack(track: MockMediaStreamTrack, stream: MockMediaStream): void {
    if (this.ontrack) {
      this.ontrack({ track, streams: [stream] });
    }
  }
}

export class MockHTMLAudioElement {
  srcObject: unknown = null;
  autoplay: boolean = true;
  playsInline: boolean = true;
  paused: boolean = false;
  muted: boolean = false;

  play = vi.fn(async () => {
    this.paused = false;
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
}

/**
 * Installs mock WebRTC objects into globalThis/navigator for Node.js test environment.
 * Returns an unregister function to cleanly restore globals.
 */
export function setupMockWebRTCGlobals() {
  const originalRTCPeerConnection = (globalThis as unknown as { RTCPeerConnection?: unknown }).RTCPeerConnection;
  const originalMediaStream = (globalThis as unknown as { MediaStream?: unknown }).MediaStream;
  const originalMediaStreamTrack = (globalThis as unknown as { MediaStreamTrack?: unknown }).MediaStreamTrack;
  const originalNavigator = globalThis.navigator;

  let activeStream: MockMediaStream = new MockMediaStream([new MockMediaStreamTrack()]);

  (globalThis as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection = MockRTCPeerConnection;
  (globalThis as unknown as { MediaStream: unknown }).MediaStream = MockMediaStream;
  (globalThis as unknown as { MediaStreamTrack: unknown }).MediaStreamTrack = MockMediaStreamTrack;

  const mockGetUserMedia = vi.fn(async (_constraints?: MediaStreamConstraints) => {
    return activeStream;
  });

  if (!globalThis.navigator) {
    (globalThis as unknown as { navigator: unknown }).navigator = {
      mediaDevices: {
        getUserMedia: mockGetUserMedia,
      },
    };
  } else if (!globalThis.navigator.mediaDevices) {
    Object.defineProperty(globalThis.navigator, "mediaDevices", {
      value: { getUserMedia: mockGetUserMedia },
      configurable: true,
      writable: true,
    });
  } else {
    vi.spyOn(globalThis.navigator.mediaDevices, "getUserMedia").mockImplementation(mockGetUserMedia as unknown as () => Promise<MediaStream>);
  }

  return {
    mockGetUserMedia,
    setActiveStream(stream: MockMediaStream) {
      activeStream = stream;
    },
    cleanup() {
      if (originalRTCPeerConnection) {
        (globalThis as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection = originalRTCPeerConnection;
      } else {
        delete (globalThis as unknown as { RTCPeerConnection?: unknown }).RTCPeerConnection;
      }

      if (originalMediaStream) {
        (globalThis as unknown as { MediaStream: unknown }).MediaStream = originalMediaStream;
      } else {
        delete (globalThis as unknown as { MediaStream?: unknown }).MediaStream;
      }

      if (originalMediaStreamTrack) {
        (globalThis as unknown as { MediaStreamTrack: unknown }).MediaStreamTrack = originalMediaStreamTrack;
      } else {
        delete (globalThis as unknown as { MediaStreamTrack?: unknown }).MediaStreamTrack;
      }

      (globalThis as unknown as { navigator: unknown }).navigator = originalNavigator;
    },
  };
}
