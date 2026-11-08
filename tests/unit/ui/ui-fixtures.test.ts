/**
 * Unit verification tests for UI test fixtures (Slice 4)
 */

import { describe, it, expect } from "vitest";
import {
  MOCK_PDF_SOURCE_SMALL,
  MOCK_PDF_SOURCE_EXACT_48K,
  MOCK_PDF_SOURCE_OVER_48K,
  MOCK_YOUTUBE_SOURCE,
  MOCK_UI_TRANSCRIPT_CONVERSATION,
  hasTouchTargetConstraints,
  has16pxInputFontSize,
} from "../../fixtures/ui-fixtures";

describe("UI Fixtures Verification", () => {
  it("conforms to IngestionSuccess contracts for PDF and YouTube sources", () => {
    expect(MOCK_PDF_SOURCE_SMALL.sourceType).toBe("pdf");
    expect(MOCK_PDF_SOURCE_SMALL.charCount).toBe(MOCK_PDF_SOURCE_SMALL.text.length);
    expect(MOCK_PDF_SOURCE_SMALL.estimatedTokens).toBe(
      Math.ceil(MOCK_PDF_SOURCE_SMALL.charCount / 4)
    );

    expect(MOCK_YOUTUBE_SOURCE.sourceType).toBe("youtube");
    expect(MOCK_YOUTUBE_SOURCE.charCount).toBe(MOCK_YOUTUBE_SOURCE.text.length);
  });

  it("accurately represents context boundaries (exact 48k vs over 48k)", () => {
    expect(MOCK_PDF_SOURCE_EXACT_48K.charCount).toBe(48_000);
    expect(MOCK_PDF_SOURCE_OVER_48K.charCount).toBeGreaterThan(48_000);
  });

  it("provides multi-turn conversation fixture", () => {
    expect(MOCK_UI_TRANSCRIPT_CONVERSATION).toHaveLength(4);
    expect(MOCK_UI_TRANSCRIPT_CONVERSATION[0].role).toBe("user");
    expect(MOCK_UI_TRANSCRIPT_CONVERSATION[1].role).toBe("assistant");
  });

  it("hasTouchTargetConstraints detects 44px classes and padding", () => {
    expect(hasTouchTargetConstraints('<button class="min-h-[44px]">Click</button>')).toBe(true);
    expect(hasTouchTargetConstraints('<button class="h-11">Click</button>')).toBe(true);
    expect(hasTouchTargetConstraints('<button class="py-3 px-4">Click</button>')).toBe(true);
    expect(hasTouchTargetConstraints('<button class="h-6 w-6">Tiny</button>')).toBe(false);
  });

  it("has16pxInputFontSize detects 16px classes", () => {
    expect(has16pxInputFontSize('<input class="text-base" />')).toBe(true);
    expect(has16pxInputFontSize('<input style="font-size: 16px" />')).toBe(true);
    expect(has16pxInputFontSize('<input class="text-xs" />')).toBe(false);
  });
});
