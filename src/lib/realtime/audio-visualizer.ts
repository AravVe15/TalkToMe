/**
 * Zero-Re-Render 60FPS Web Audio Visualizer (`src/lib/realtime/audio-visualizer.ts`).
 *
 * Connects to active WebRTC MediaStreams (`localStream` microphone and `audioElement.srcObject`
 * assistant output) via the Web Audio API `AnalyserNode` and writes normalized energy metrics
 * directly to CSS custom properties (`--voice-energy`, `--orb-scale`, `--orb-glow`) on a target
 * DOM element inside a `requestAnimationFrame` loop.
 *
 * Gracefully no-ops in SSR, Node.js, or Vitest/JSDOM test environments.
 */

import type { RealtimeConversationState } from "@/lib/realtime/connection";

export interface AudioVisualizerOptions {
  targetElement?: HTMLElement | null;
  localStream?: MediaStream | null;
  audioElement?: HTMLAudioElement | null;
}

export class RealtimeAudioVisualizer {
  private targetElement: HTMLElement | null = null;
  private audioContext: AudioContext | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private remoteAnalyser: AnalyserNode | null = null;
  private localSource: MediaStreamAudioSourceNode | null = null;
  private remoteSource: MediaStreamAudioSourceNode | null = null;
  private attachedLocalStream: MediaStream | null = null;
  private attachedRemoteStream: MediaStream | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private rafId: number | null = null;
  private smoothedEnergy: number = 0;
  private conversationState: RealtimeConversationState = "listening";
  private isActive: boolean = false;
  private readonly freqBuffer: Uint8Array = new Uint8Array(64);

  constructor(options: AudioVisualizerOptions = {}) {
    this.targetElement = options.targetElement ?? null;
    this.audioElement = options.audioElement ?? null;
    if (options.localStream) {
      this.attachedLocalStream = options.localStream;
    }
  }

  private isBrowserEnvironment(): boolean {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return false;
    }
    if (
      typeof process !== "undefined" &&
      process.env &&
      process.env.NODE_ENV === "test"
    ) {
      return false;
    }
    return typeof window.requestAnimationFrame === "function";
  }

  setTargetElement(element: HTMLElement | null): void {
    this.targetElement = element;
  }

  setConversationState(state: RealtimeConversationState): void {
    this.conversationState = state;
  }

  attachStreams(params: {
    localStream?: MediaStream | null;
    audioElement?: HTMLAudioElement | null;
  }): void {
    if (!this.isBrowserEnvironment()) {
      return;
    }

    if (params.audioElement !== undefined) {
      this.audioElement = params.audioElement;
    }

    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtx) {
        return;
      }

      if (!this.audioContext || this.audioContext.state === "closed") {
        this.audioContext = new AudioCtx();
      }

      if (this.audioContext.state === "suspended") {
        void this.audioContext.resume().catch(() => {});
      }

      if (
        params.localStream &&
        params.localStream !== this.attachedLocalStream
      ) {
        this.connectLocalStream(params.localStream);
      }

      this.syncRemoteStream();
    } catch {
      // Fail-safe no-op if Web Audio API is restricted by browser policy
    }
  }

  private connectLocalStream(stream: MediaStream): void {
    if (!this.audioContext) return;
    try {
      const tracks =
        typeof stream.getAudioTracks === "function"
          ? stream.getAudioTracks()
          : [];
      if (tracks.length === 0) return;

      this.localSource?.disconnect();
      const analyser = this.audioContext.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.75;

      const source = this.audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      this.localSource = source;
      this.localAnalyser = analyser;
      this.attachedLocalStream = stream;
    } catch {
      // Ignore stream attachment failure
    }
  }

  attachRemoteFromAudioElement(): void {
    this.syncRemoteStream();
  }

  private syncRemoteStream(): void {
    if (!this.audioContext || !this.audioElement) return;
    try {
      const srcObj = this.audioElement.srcObject;
      if (
        !srcObj ||
        typeof MediaStream === "undefined" ||
        !(srcObj instanceof MediaStream)
      ) {
        return;
      }
      if (srcObj === this.attachedRemoteStream) {
        return;
      }
      const tracks =
        typeof srcObj.getAudioTracks === "function"
          ? srcObj.getAudioTracks()
          : [];
      if (tracks.length === 0) return;

      this.remoteSource?.disconnect();
      const analyser = this.audioContext.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.72;

      const source = this.audioContext.createMediaStreamSource(srcObj);
      source.connect(analyser);

      this.remoteSource = source;
      this.remoteAnalyser = analyser;
      this.attachedRemoteStream = srcObj;
    } catch {
      // Ignore remote stream attachment failure on cross-origin or synthetic streams
    }
  }

  start(): void {
    if (!this.isBrowserEnvironment() || this.isActive) {
      return;
    }
    this.isActive = true;

    const tick = (timestamp: number) => {
      if (!this.isActive) return;

      this.syncRemoteStream();

      const rawEnergy = this.measureEnergy(timestamp);
      // Asymmetric attack/release smoothing for responsive liquid motion
      const smoothing = rawEnergy > this.smoothedEnergy ? 0.32 : 0.14;
      this.smoothedEnergy =
        this.smoothedEnergy + (rawEnergy - this.smoothedEnergy) * smoothing;

      const clamped = Math.max(0, Math.min(1, this.smoothedEnergy));
      const orbScale = 1 + clamped * 0.28;
      const orbGlow = 0.35 + clamped * 0.65;

      if (this.targetElement) {
        this.targetElement.style.setProperty(
          "--voice-energy",
          clamped.toFixed(3)
        );
        this.targetElement.style.setProperty(
          "--orb-scale",
          orbScale.toFixed(3)
        );
        this.targetElement.style.setProperty("--orb-glow", orbGlow.toFixed(3));
      }

      this.rafId = window.requestAnimationFrame(tick);
    };

    this.rafId = window.requestAnimationFrame(tick);
  }

  private measureEnergy(timestamp: number): number {
    let measured = 0;

    const activeAnalyser =
      this.conversationState === "user_speaking"
        ? this.localAnalyser
        : this.conversationState === "assistant_speaking"
          ? this.remoteAnalyser ?? this.localAnalyser
          : this.localAnalyser ?? this.remoteAnalyser;

    if (activeAnalyser) {
      try {
        activeAnalyser.getByteFrequencyData(this.freqBuffer);
        let sum = 0;
        // Focus on core human vocal harmonics (bins 1..32)
        const bins = Math.min(32, this.freqBuffer.length);
        for (let i = 1; i < bins; i++) {
          sum += this.freqBuffer[i];
        }
        measured = sum / (Math.max(1, bins - 1) * 210);
      } catch {
        measured = 0;
      }
    }

    // Blend with organic harmonic oscillation when in active conversational states
    // so the orb remains fluidly responsive even if WebRTC remote stream is hardware-decoded
    const t = timestamp * 0.001;
    if (this.conversationState === "assistant_speaking") {
      const harmonic =
        0.38 +
        0.24 * Math.sin(t * 5.2) +
        0.16 * Math.sin(t * 8.7 + 1.1) +
        0.1 * Math.cos(t * 13.3);
      return Math.max(measured, harmonic);
    }
    if (this.conversationState === "user_speaking") {
      const harmonic =
        0.32 + 0.22 * Math.sin(t * 6.4) + 0.14 * Math.cos(t * 10.1);
      return Math.max(measured, harmonic);
    }
    if (this.conversationState === "assistant_thinking") {
      return 0.28 + 0.15 * Math.sin(t * 4.5);
    }

    return measured * 0.45;
  }

  stop(): void {
    this.isActive = false;
    if (
      this.rafId !== null &&
      typeof window !== "undefined" &&
      typeof window.cancelAnimationFrame === "function"
    ) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    if (this.targetElement) {
      this.targetElement.style.setProperty("--voice-energy", "0");
      this.targetElement.style.setProperty("--orb-scale", "1");
      this.targetElement.style.setProperty("--orb-glow", "0.35");
    }

    try {
      this.localSource?.disconnect();
      this.remoteSource?.disconnect();
    } catch {
      // Ignore disconnect errors
    }

    this.localSource = null;
    this.remoteSource = null;
    this.localAnalyser = null;
    this.remoteAnalyser = null;
    this.attachedLocalStream = null;
    this.attachedRemoteStream = null;

    if (this.audioContext && this.audioContext.state !== "closed") {
      void this.audioContext.close().catch(() => {});
    }
    this.audioContext = null;
  }
}
