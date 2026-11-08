/**
 * UI Test Fixtures and Mock Data for Slice 4 (Mobile-First UI)
 * Derived strictly from ADR-05, ADR-11, AC-05, AC-06, AC-07, AC-08, AC-09, AC-10, and AC-11.
 */

export const MOCK_PDF_SOURCE_SMALL = {
  sourceType: "pdf" as const,
  title: "quarterly_financials.pdf",
  text: "Q3 revenue grew by 18% year-over-year, driven by enterprise subscriptions.",
  charCount: 74,
  estimatedTokens: 19,
};

export const MOCK_PDF_SOURCE_EXACT_48K = {
  sourceType: "pdf" as const,
  title: "boundary_document.pdf",
  text: "A".repeat(48_000),
  charCount: 48_000,
  estimatedTokens: 12_000,
};

export const MOCK_PDF_SOURCE_OVER_48K = {
  sourceType: "pdf" as const,
  title: "massive_annual_report.pdf",
  text: "Large text section for mobile preview truncation testing. ".repeat(1200), // ~70,800 chars
  charCount: 70_800,
  estimatedTokens: 17_700,
};

export const MOCK_YOUTUBE_SOURCE = {
  sourceType: "youtube" as const,
  title: "Steve Jobs 2005 Stanford Commencement Address",
  text: "Your time is limited, so don't waste it living someone else's life.",
  charCount: 67,
  estimatedTokens: 17,
};

export const MOCK_UI_TRANSCRIPT_CONVERSATION = [
  {
    id: "turn_user_1",
    role: "user" as const,
    text: "Can you summarize the primary thesis of the document?",
    status: "completed" as const,
  },
  {
    id: "turn_asst_1",
    role: "assistant" as const,
    text: "The document establishes that mobile-first responsive architecture is essential for low-latency voice streaming.",
    status: "completed" as const,
  },
  {
    id: "turn_user_2",
    role: "user" as const,
    text: "What about battery and audio performance?",
    status: "completed" as const,
  },
  {
    id: "turn_asst_2",
    role: "assistant" as const,
    text: "Synchronous gesture unlocking for playsInline audio prevents background drain and Safari audio throttling.",
    status: "streaming" as const,
  },
];

export const MOCK_UI_TRANSCRIPT_TRANSCRIBING = [
  {
    id: "turn_user_3",
    role: "user" as const,
    text: "",
    status: "transcribing" as const,
  },
];

export const MOCK_INGESTION_ERROR_FILE_TOO_LARGE = {
  code: "FILE_TOO_LARGE",
  message: "PDF exceeds the 25 MB upload limit. Please upload a smaller file.",
  retryable: true,
};

export const MOCK_INGESTION_ERROR_NO_OCR = {
  code: "EMPTY_OR_SCANNED_PDF",
  message:
    "This PDF contains no extractable text (it may be a scanned image). OCR is not supported; please upload a text-based PDF.",
  retryable: true,
};

export const MOCK_INGESTION_ERROR_YOUTUBE_BLOCKED = {
  code: "YOUTUBE_CLOUD_IP_BLOCKED",
  message:
    "YouTube blocked requests from cloud provider IPs. Please run locally or configure YOUTUBE_PROXY_URL.",
  retryable: true,
};

export interface HomePageProps {
  initialSource?: {
    sourceType: "pdf" | "youtube";
    title: string;
    text: string;
    charCount: number;
    estimatedTokens: number;
  } | null;
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

/**
 * Checks whether an HTML string contains minimum 44px touch target sizing indicators.
 * Matches Tailwind 44px min-height/min-width utility classes, h-11 (44px), py-3 (with content >= 44px),
 * or inline CSS style rules with 44px.
 */
export function hasTouchTargetConstraints(html: string): boolean {
  return (
    /min-h-\[44px\]|min-w-\[44px\]|h-11|h-12|h-14|min-height:\s*44px|minHeight:\s*["']?44px/i.test(
      html
    ) ||
    /py-3|py-3\.5|py-4|p-3|p-3\.5|p-4/i.test(html)
  );
}

/**
 * Checks whether an input element HTML string enforces font size >= 16px to prevent iOS Safari auto-zoom.
 * Matches Tailwind `text-base` (16px), `text-lg` (18px), or style rules `font-size: 16px` / `fontSize: "16px"`.
 */
export function has16pxInputFontSize(html: string): boolean {
  return /text-base|text-lg|text-xl|font-size:\s*16px|fontSize:\s*["']?16px/i.test(html);
}
