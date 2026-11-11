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

  return (
    <div className="apple-attachment-pill">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span
              className="text-xs font-semibold uppercase tracking-wider"
              style={{ color: "#007aff", fontSize: "11px" }}
            >
              {source.sourceType === "pdf" ? "PDF Document" : "YouTube Video"}
            </span>
            <span style={{ color: "#d2d2d7" }}>•</span>
            <span
              className="text-xs"
              style={{ color: "#86868b", fontSize: "11px" }}
            >
              {`${source.charCount} chars (~${source.estimatedTokens} tokens)`}
            </span>
          </div>
          <h3
            className="text-sm font-semibold truncate"
            title={source.title}
            style={{ color: "#1d1d1f", fontSize: "14px", marginTop: "1px" }}
          >
            {source.title}
          </h3>
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
        <div className="apple-preview-drawer font-mono">{source.text}</div>
      )}
    </div>
  );
}
