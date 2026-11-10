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
    <div className="ios-card flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col flex-1 min-w-0">
          <span
            className="text-xs font-semibold text-muted uppercase tracking-wider"
            style={{ color: "var(--text-muted)" }}
          >
            {source.sourceType === "pdf" ? "PDF Document" : "YouTube Video"}
          </span>
          <h3
            className="text-sm font-bold truncate"
            title={source.title}
            style={{ fontSize: "15px", margin: "2px 0" }}
          >
            {source.title}
          </h3>
          <span
            className="text-xs text-muted"
            style={{ color: "var(--text-muted)", fontSize: "13px" }}
          >
            {`${source.charCount} chars (~${source.estimatedTokens} tokens)`}
          </span>
        </div>

        {/* Collapsible Disclosure Toggle */}
        <button
          type="button"
          aria-expanded={expanded}
          onClick={onToggleExpanded}
          className="min-h-[38px] min-w-[44px] py-2 px-3.5 text-xs font-semibold rounded-full border border-gray-200 bg-slate-100 text-slate-800"
          style={{
            minHeight: "38px",
            minWidth: "44px",
            borderRadius: "9999px",
            backgroundColor: expanded ? "#e2e8f0" : "#f1f5f9",
            borderColor: "#cbd5e1",
            color: "#1e293b",
            whiteSpace: "nowrap",
          }}
        >
          {expanded ? "Hide Preview" : "Show Preview"}
        </button>
      </div>

      {/* 48,000-character context truncation warning (ADR-05) */}
      {isTruncated && (
        <div
          role="alert"
          className="p-3 bg-amber-50 border border-amber-200 rounded-md text-xs font-medium text-amber-900"
          style={{
            backgroundColor: "#fffbeb",
            borderColor: "#fde68a",
            color: "#78350f",
            lineHeight: 1.4,
          }}
        >
          This source exceeds the Realtime voice context limit (~12,000 tokens).
          Full text is shown in the preview, and the voice assistant is primed
          with the first 48,000 characters.
        </div>
      )}

      {/* Expanded Text Preview Container */}
      {expanded && (
        <div
          className="p-3 bg-slate-50 border border-gray-200 rounded-md text-xs overflow-y-auto whitespace-pre-wrap font-mono"
          style={{
            maxHeight: "180px",
            borderRadius: "12px",
            backgroundColor: "#f8fafc",
            borderColor: "#e2e8f0",
            fontSize: "12px",
            lineHeight: 1.5,
          }}
        >
          {source.text}
        </div>
      )}
    </div>
  );
}
