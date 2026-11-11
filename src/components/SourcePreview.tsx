"use client";

import React from "react";

export interface SourcePreviewData {
  sourceType: "pdf" | "youtube";
  title: string;
  text: string;
  charCount: number;
  estimatedTokens: number;
}

export interface SourcePreviewProps {
  source: SourcePreviewData;
  expanded?: boolean;
  onToggleExpanded?: () => void;
}

export function SourcePreview({
  source,
  expanded = false,
  onToggleExpanded,
}: SourcePreviewProps) {
  const isTruncated = source.charCount > 48_000;
  const readingMinutes = Math.max(1, Math.round(source.charCount / 1150));
  const memoryPct = Math.min(
    100,
    Math.max(4, Math.round((source.charCount / 48_000) * 100))
  );

  return (
    <div className="apple-attachment-pill">
      <div className="flex items-center justify-between gap-2.5">
        <div className="apple-source-icon" aria-hidden="true">
          {source.sourceType === "pdf" ? (
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          ) : (
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M21.58 7.19a2.51 2.51 0 0 0-1.77-1.77C18.25 5 12 5 12 5s-6.25 0-7.81.42a2.51 2.51 0 0 0-1.77 1.77C2 8.75 2 12 2 12s0 3.25.42 4.81a2.51 2.51 0 0 0 1.77 1.77C5.75 19 12 19 12 19s6.25 0 7.81-.42a2.51 2.51 0 0 0 1.77-1.77C22 15.25 22 12 22 12s0-3.25-.42-4.81zM10 15V9l5.2 3-5.2 3z" />
            </svg>
          )}
        </div>

        <div className="flex flex-col flex-1 min-w-0 gap-0.5">
          <h3
            className="text-sm font-semibold truncate"
            title={source.title}
            style={{ color: "#1d1d1f", fontSize: "14px", lineHeight: 1.25 }}
          >
            {source.title}
          </h3>
          <div className="flex items-center gap-1.5 truncate whitespace-nowrap">
            <span className="apple-read-time-badge">
              {`~${readingMinutes} min read`}
            </span>
            <span
              className="text-xs font-medium whitespace-nowrap"
              style={{ color: "#007aff", fontSize: "11px" }}
            >
              {source.sourceType === "pdf" ? "PDF Document" : "YouTube Video"}
            </span>
            <span style={{ color: "#d2d2d7", fontSize: "11px" }}>•</span>
            <span
              className="text-xs truncate whitespace-nowrap"
              style={{ color: "#86868b", fontSize: "11px" }}
            >
              {`${source.charCount} chars (~${source.estimatedTokens} tokens)`}
            </span>
          </div>
        </div>

        <button
          type="button"
          aria-expanded={expanded}
          onClick={onToggleExpanded}
          className="apple-preview-toggle min-h-[44px] min-w-[44px]"
          style={{ minHeight: "44px", minWidth: "44px" }}
        >
          {expanded ? "Hide Preview" : "Show Preview"}
        </button>
      </div>

      {isTruncated && (
        <div role="alert" className="apple-alert-warning">
          This source exceeds the Realtime voice context limit (~12,000 tokens).
          Full text is shown in the preview, and the voice assistant is primed
          with the first 48,000 characters.
        </div>
      )}

      {expanded && (
        <div className="apple-reader-sheet">
          <div className="flex items-center justify-between text-xs">
            <span style={{ color: "#86868b", fontSize: "11px", fontWeight: 600 }}>
              Extracted Source Reader
            </span>
            <span style={{ color: "#007aff", fontSize: "11px", fontWeight: 600 }}>
              {`${memoryPct}% of 48k voice memory`}
            </span>
          </div>
          <div className="apple-memory-bar-track" aria-hidden="true">
            <div
              className="apple-memory-bar-fill"
              style={{ width: `${memoryPct}%` }}
            />
          </div>
          <div className="apple-reader-body">{source.text}</div>
        </div>
      )}
    </div>
  );
}
