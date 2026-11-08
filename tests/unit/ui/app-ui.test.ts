/**
 * Slice 4: Mobile-First UI Comprehensive Component Test Suite
 *
 * Verifies acceptance criteria:
 * - AC-11.1: Collapsible extracted text preview with char count, token estimates & truncation banner (ADR-11, ADR-05)
 * - AC-11.2: Mobile viewport optimization (~390px), min 44x44px touch targets & 16px input font sizing (ADR-11)
 * - AC-11.3: Remote <audio autoPlay playsInline> element configuration (ADR-11)
 * - AC-06.1: Start Voice Chat button disabled in idle/ingesting, enabled in ready (ADR-06)
 * - AC-06.2: Stop Voice Chat button & clean resource teardown control (ADR-06)
 * - AC-06.3: Connection status badges & conversation flow sub-state indicators (ADR-06)
 * - AC-07.2: Accessible manual Interrupt button rendered when assistant is speaking (ADR-07)
 * - AC-08.1 & AC-08.2: Synchronized live conversation transcript with transcribing indicators (ADR-08)
 * - AC-09.1 & AC-09.2: Text fallback mode banner, text chat input dock, and Send button (ADR-09)
 * - AC-09.3: Microphone mute/unmute control button (ADR-09)
 * - AC-10.1 & AC-10.3: Network reconnecting notice, Reconnect button, and transcript preservation on error (ADR-10)
 * - AC-01.2: User-friendly error alert banners on ingestion failures (ADR-01, ADR-02, ADR-03)
 */

import React from "react";
(globalThis as unknown as { React: typeof React }).React = React;
import { renderToString } from "react-dom/server";
import { describe, it, expect } from "vitest";
import Home from "@/app/page";
import {
  MOCK_PDF_SOURCE_SMALL,
  MOCK_PDF_SOURCE_EXACT_48K,
  MOCK_PDF_SOURCE_OVER_48K,
  MOCK_YOUTUBE_SOURCE,
  MOCK_UI_TRANSCRIPT_CONVERSATION,
  MOCK_UI_TRANSCRIPT_TRANSCRIBING,
  MOCK_INGESTION_ERROR_FILE_TOO_LARGE,
  MOCK_INGESTION_ERROR_NO_OCR,
  MOCK_INGESTION_ERROR_YOUTUBE_BLOCKED,
  hasTouchTargetConstraints,
  has16pxInputFontSize,
  HomePageProps,
} from "../../fixtures/ui-fixtures";

const App: React.ComponentType<HomePageProps> = Home as unknown as React.ComponentType<HomePageProps>;

describe("Slice 4: Mobile-First UI (ADR-11, AC-11, AC-05 to AC-10)", () => {
  describe("Suite 1: Mobile-First Responsive Layout & Viewport Optimization (ADR-11, AC-11.1–11.3)", () => {
    it("AC-11.1 & ADR-11: root container uses single-column mobile-first layout (max-w-md, mx-auto, min-h-dvh, overflow-x-hidden)", () => {
      const html = renderToString(React.createElement(App));

      // Viewport width & layout constraints for ~390px mobile screens
      expect(html).toMatch(/max-w-md/i);
      expect(html).toMatch(/mx-auto/i);
      expect(html).toMatch(/overflow-x-hidden/i);
      expect(html).toMatch(/min-h-(?:dvh|screen)/i);
    });

    it("AC-11.2: primary interactive buttons have minimum 44x44px touch target constraints", () => {
      const html = renderToString(
        React.createElement(App, {
          initialSource: MOCK_PDF_SOURCE_SMALL,
          initialConnectionState: "connected",
          initialConversationState: "assistant_speaking",
          initialTextFallback: true,
        })
      );

      // Verify touch target constraints on the rendered UI
      expect(hasTouchTargetConstraints(html)).toBe(true);

      // Extract all button elements and verify touch target compliance
      const buttonMatches = html.match(/<button[^>]*>.*?<\/button>/gi) || [];
      expect(buttonMatches.length).toBeGreaterThanOrEqual(1);

      const compliantButtons = buttonMatches.filter((btn) => hasTouchTargetConstraints(btn));
      // At least the primary action buttons must enforce 44px touch targets
      expect(compliantButtons.length).toBeGreaterThanOrEqual(1);
    });

    it("AC-11.2: text inputs enforce minimum 16px (text-base) font size to prevent iOS Safari auto-zoom", () => {
      const html = renderToString(
        React.createElement(App, {
          initialTextFallback: true,
        })
      );

      expect(has16pxInputFontSize(html)).toBe(true);

      const inputMatches = html.match(/<input[^>]*>/gi) || [];
      expect(inputMatches.length).toBeGreaterThanOrEqual(1);

      const compliantInputs = inputMatches.filter((inp) => has16pxInputFontSize(inp));
      expect(compliantInputs.length).toBeGreaterThanOrEqual(1);
    });

    it("AC-11.3: configures remote WebRTC <audio> element with autoPlay and playsInline", () => {
      const html = renderToString(React.createElement(App));

      expect(html).toMatch(/<audio[^>]*>/i);
      expect(html).toMatch(/<audio[^>]*(?:autoplay|autoPlay)[^>]*>/i);
      expect(html).toMatch(/<audio[^>]*(?:playsinline|playsInline)[^>]*>/i);
    });
  });

  describe("Suite 2: Source Ingestion Controls & State Flow (AC-01, AC-02, AC-03, AC-06.1)", () => {
    it("AC-06.1: in initial 'idle' state, renders ingestion inputs and disables 'Start Voice Chat' button", () => {
      const html = renderToString(React.createElement(App));

      // PDF file upload input (accepts .pdf)
      expect(html).toMatch(/<input[^>]*type=["']file["'][^>]*>/i);
      expect(html).toMatch(/accept=["'][^"']*\.pdf[^"']*["']/i);

      // YouTube URL input
      expect(html).toMatch(/youtube|video url|youtu\.be/i);

      // "Start Voice Chat" button is disabled in idle state
      expect(html).toMatch(/start voice chat/i);
      expect(html).toMatch(/<button[^>]*disabled[^>]*>[\s\S]*?start voice chat[\s\S]*?<\/button>/i);
    });

    it("AC-06.1: in 'ingesting' state, shows extraction loading indicator and keeps 'Start Voice Chat' disabled", () => {
      const html = renderToString(
        React.createElement(App, {
          initialConnectionState: "ingesting",
        })
      );

      // Loading / progress indicator
      expect(html).toMatch(/extracting|ingesting|loading|processing/i);

      // Start button remains disabled
      expect(html).toMatch(/<button[^>]*disabled[^>]*>[\s\S]*?start voice chat[\s\S]*?<\/button>/i);
    });

    it("AC-06.1: in 'ready' state, displays source title and enables 'Start Voice Chat' button", () => {
      const html = renderToString(
        React.createElement(App, {
          initialSource: MOCK_PDF_SOURCE_SMALL,
          initialConnectionState: "ready",
        })
      );

      // Displays document title
      expect(html).toContain(MOCK_PDF_SOURCE_SMALL.title);

      // "Start Voice Chat" button is enabled (not disabled)
      const startButtonMatch = html.match(
        /<button(?![^>]*disabled)[^>]*>[\s\S]*?start voice chat[\s\S]*?<\/button>/i
      );
      expect(startButtonMatch).not.toBeNull();
    });
  });

  describe("Suite 3: Collapsible Text Preview & 48,000-Char Truncation Warning (ADR-05, ADR-11, AC-05.1, AC-05.2, AC-11.1)", () => {
    it("AC-11.1: displays source title, character count, and estimated token count", () => {
      const html = renderToString(
        React.createElement(App, {
          initialSource: MOCK_PDF_SOURCE_SMALL,
          initialConnectionState: "ready",
        })
      );

      expect(html).toContain(MOCK_PDF_SOURCE_SMALL.title);
      expect(html).toMatch(/74\s*chars?|74\s*characters/i);
      expect(html).toMatch(/~?\s*19\s*tokens?/i);
    });

    it("AC-11.1: preview contains a collapsible disclosure toggle (Show/Hide Preview)", () => {
      const html = renderToString(
        React.createElement(App, {
          initialSource: MOCK_PDF_SOURCE_SMALL,
          initialConnectionState: "ready",
          previewExpanded: false,
        })
      );

      // Accessible toggle button for collapsible panel
      expect(html).toMatch(/show preview|preview|hide preview|collapse|expand/i);
      expect(html).toMatch(/aria-expanded/i);
    });

    it("AC-05.1: sources <= 48,000 characters display text in preview without truncation warning banner", () => {
      const html = renderToString(
        React.createElement(App, {
          initialSource: MOCK_PDF_SOURCE_SMALL,
          initialConnectionState: "ready",
          previewExpanded: true,
        })
      );

      // Full text is displayed in preview
      expect(html).toContain(MOCK_PDF_SOURCE_SMALL.text);

      // Truncation warning must NOT be shown
      expect(html).not.toMatch(/exceeds.*context limit|primed with the first 48,000/i);
    });

    it("AC-05.2 & ADR-05: sources > 48,000 characters render non-blocking truncation warning banner and preserve full preview text", () => {
      const html = renderToString(
        React.createElement(App, {
          initialSource: MOCK_PDF_SOURCE_OVER_48K,
          initialConnectionState: "ready",
          previewExpanded: true,
        })
      );

      // Renders prominent, non-blocking truncation warning banner (ADR-05)
      expect(html).toMatch(
        /exceeds.*(?:context limit|12,000 tokens)|primed with the first 48,000/i
      );

      // Full text is still accessible/rendered in the preview (Option 2B)
      expect(html).toContain("Large text section for mobile preview truncation testing.");
    });
  });

  describe("Suite 4: Voice Session Controls Dock & Conversation Flow States (AC-06.2, AC-06.3, AC-07.1, AC-07.2)", () => {
    it("ADR-11: houses primary controls in a sticky bottom dock for mobile one-thumb access", () => {
      const html = renderToString(
        React.createElement(App, {
          initialSource: MOCK_PDF_SOURCE_SMALL,
          initialConnectionState: "connected",
        })
      );

      // Sticky or fixed bottom dock
      expect(html).toMatch(/(?:sticky|fixed)\s+bottom-0/i);
    });

    it("AC-06.3: renders visual connection status indicators (connecting, connected, reconnecting, error)", () => {
      const connectingHtml = renderToString(
        React.createElement(App, { initialConnectionState: "connecting" })
      );
      expect(connectingHtml).toMatch(/connecting/i);

      const connectedHtml = renderToString(
        React.createElement(App, { initialConnectionState: "connected" })
      );
      expect(connectedHtml).toMatch(/connected|live/i);

      const reconnectingHtml = renderToString(
        React.createElement(App, { initialConnectionState: "reconnecting" })
      );
      expect(reconnectingHtml).toMatch(/reconnecting|unstable/i);

      const errorHtml = renderToString(
        React.createElement(App, { initialConnectionState: "error" })
      );
      expect(errorHtml).toMatch(/error|failed/i);
    });

    it("AC-06.3: renders active conversation flow sub-states (listening, user_speaking, assistant_thinking, assistant_speaking)", () => {
      const listeningHtml = renderToString(
        React.createElement(App, {
          initialConnectionState: "connected",
          initialConversationState: "listening",
        })
      );
      expect(listeningHtml).toMatch(/listening/i);

      const userSpeakingHtml = renderToString(
        React.createElement(App, {
          initialConnectionState: "connected",
          initialConversationState: "user_speaking",
        })
      );
      expect(userSpeakingHtml).toMatch(/speaking|listening|you are speaking/i);

      const thinkingHtml = renderToString(
        React.createElement(App, {
          initialConnectionState: "connected",
          initialConversationState: "assistant_thinking",
        })
      );
      expect(thinkingHtml).toMatch(/thinking/i);

      const assistantSpeakingHtml = renderToString(
        React.createElement(App, {
          initialConnectionState: "connected",
          initialConversationState: "assistant_speaking",
        })
      );
      expect(assistantSpeakingHtml).toMatch(/speaking/i);
    });

    it("AC-07.2: renders manual 'Interrupt' button when assistant is speaking", () => {
      const html = renderToString(
        React.createElement(App, {
          initialConnectionState: "connected",
          initialConversationState: "assistant_speaking",
        })
      );

      expect(html).toMatch(/<button[^>]*>[\s\S]*?interrupt[\s\S]*?<\/button>/i);
    });

    it("AC-06.2: renders 'Stop' / 'End Call' button during active voice session", () => {
      const html = renderToString(
        React.createElement(App, {
          initialSource: MOCK_PDF_SOURCE_SMALL,
          initialConnectionState: "connected",
        })
      );

      expect(html).toMatch(/stop|end call|disconnect/i);
    });
  });

  describe("Suite 5: Synchronized Live Conversation Transcript Display (AC-08.1, AC-08.2)", () => {
    it("AC-08.1 & AC-08.2: renders multi-turn user and assistant bubbles with distinct styling", () => {
      const html = renderToString(
        React.createElement(App, {
          initialSource: MOCK_PDF_SOURCE_SMALL,
          initialConnectionState: "connected",
          initialTranscript: MOCK_UI_TRANSCRIPT_CONVERSATION,
        })
      );

      // Contains user spoken turn
      expect(html).toContain("Can you summarize the primary thesis of the document?");
      // Contains assistant spoken reply
      expect(html).toContain(
        "The document establishes that mobile-first responsive architecture is essential"
      );
    });

    it("AC-08.1: renders visual indicator for transcribing user turns", () => {
      const html = renderToString(
        React.createElement(App, {
          initialSource: MOCK_PDF_SOURCE_SMALL,
          initialConnectionState: "connected",
          initialTranscript: MOCK_UI_TRANSCRIPT_TRANSCRIBING,
        })
      );

      // Transcribing indicator (e.g. "Transcribing...", pulse animation, "...")
      expect(html).toMatch(/transcribing|\.\.\.|listening/i);
    });

    it("AC-08.1: preserves chronological turn order in DOM", () => {
      const html = renderToString(
        React.createElement(App, {
          initialSource: MOCK_PDF_SOURCE_SMALL,
          initialConnectionState: "connected",
          initialTranscript: MOCK_UI_TRANSCRIPT_CONVERSATION,
        })
      );

      // Verify Turn 1 user question appears in DOM before Turn 1 assistant reply
      const user1Index = html.indexOf("Can you summarize the primary thesis");
      const asst1Index = html.indexOf("The document establishes that mobile-first");
      const user2Index = html.indexOf("What about battery and audio performance?");

      expect(user1Index).toBeGreaterThan(-1);
      expect(asst1Index).toBeGreaterThan(user1Index);
      expect(user2Index).toBeGreaterThan(asst1Index);
    });
  });

  describe("Suite 6: Text Chat Fallback Mode & Mute Controls (AC-09.1–09.3)", () => {
    it("AC-09.1: displays 'Microphone unavailable — using text chat mode' notice in text fallback mode", () => {
      const html = renderToString(
        React.createElement(App, {
          initialSource: MOCK_PDF_SOURCE_SMALL,
          initialConnectionState: "connected",
          initialMicStatus: "unavailable",
          initialTextFallback: true,
        })
      );

      expect(html).toMatch(/microphone unavailable/i);
      expect(html).toMatch(/text chat mode/i);
    });

    it("AC-09.2: renders text chat input bar and Send button in text fallback mode", () => {
      const html = renderToString(
        React.createElement(App, {
          initialSource: MOCK_PDF_SOURCE_SMALL,
          initialConnectionState: "connected",
          initialTextFallback: true,
        })
      );

      // Text input box
      expect(html).toMatch(/<input[^>]*type=["']text["'][^>]*>|<textarea/i);

      // Send button
      expect(html).toMatch(/send|<button[^>]*>[\s\S]*?send[\s\S]*?<\/button>/i);
    });

    it("AC-09.3: renders Mute / Unmute control button when microphone is active", () => {
      const unmutedHtml = renderToString(
        React.createElement(App, {
          initialSource: MOCK_PDF_SOURCE_SMALL,
          initialConnectionState: "connected",
          initialMuted: false,
        })
      );
      expect(unmutedHtml).toMatch(/mute/i);

      const mutedHtml = renderToString(
        React.createElement(App, {
          initialSource: MOCK_PDF_SOURCE_SMALL,
          initialConnectionState: "connected",
          initialMuted: true,
        })
      );
      expect(mutedHtml).toMatch(/unmute/i);
    });
  });

  describe("Suite 7: Error States, Poor Network & Reconnection (AC-01.2, AC-10.1, AC-10.3)", () => {
    it("AC-01.2 & AC-02.3: renders actionable error alert banner when PDF is scanned / empty (No-OCR)", () => {
      const html = renderToString(
        React.createElement(App, {
          initialError: MOCK_INGESTION_ERROR_NO_OCR.message,
        })
      );

      expect(html).toMatch(/OCR is not supported/i);
      expect(html).toMatch(/text-based PDF/i);
    });

    it("AC-01.2 & AC-02.1: renders error alert banner when PDF exceeds 25 MB", () => {
      const html = renderToString(
        React.createElement(App, {
          initialError: MOCK_INGESTION_ERROR_FILE_TOO_LARGE.message,
        })
      );

      expect(html).toMatch(/25\s*MB/i);
    });

    it("AC-01.2 & AC-03.4: renders error alert banner when YouTube cloud datacenter IP is blocked", () => {
      const html = renderToString(
        React.createElement(App, {
          initialError: MOCK_INGESTION_ERROR_YOUTUBE_BLOCKED.message,
        })
      );

      expect(html).toMatch(/YOUTUBE_PROXY_URL|cloud provider IPs/i);
    });

    it("AC-10.1: renders 'Network unstable — attempting to recover...' notice during reconnecting state", () => {
      const html = renderToString(
        React.createElement(App, {
          initialSource: MOCK_PDF_SOURCE_SMALL,
          initialConnectionState: "reconnecting",
        })
      );

      expect(html).toMatch(/network unstable|attempting to recover/i);
    });

    it("AC-10.3: renders 'Reconnect Voice Session' button and preserves transcript and source text on connection error", () => {
      const html = renderToString(
        React.createElement(App, {
          initialSource: MOCK_PDF_SOURCE_SMALL,
          initialConnectionState: "error",
          initialTranscript: MOCK_UI_TRANSCRIPT_CONVERSATION,
        })
      );

      // Shows Reconnect CTA button
      expect(html).toMatch(/reconnect/i);

      // Preserves extracted source text on screen
      expect(html).toContain(MOCK_PDF_SOURCE_SMALL.title);

      // Preserves existing conversation transcript on screen
      expect(html).toContain("Can you summarize the primary thesis");
    });
  });
});
