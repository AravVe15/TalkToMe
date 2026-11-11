"use client";

import React, { useState } from "react";

export interface SourceIngestionProps {
  connectionState: string;
  canStartVoiceChat: boolean;
  onPdfSelected?: (file: File) => void;
  onYouTubeSubmit?: (url: string) => void;
  onStartVoiceChat?: () => void;
}

export function SourceIngestion({
  connectionState,
  canStartVoiceChat,
  onPdfSelected,
  onYouTubeSubmit,
  onStartVoiceChat,
}: SourceIngestionProps) {
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const isIngesting = connectionState === "ingesting";
  const isConnecting = connectionState === "connecting";

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onPdfSelected) {
      onPdfSelected(file);
    }
  };

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (youtubeUrl.trim() && onYouTubeSubmit) {
      onYouTubeSubmit(youtubeUrl.trim());
    }
  };

  return (
    <div className="apple-sheet">
      <div className="flex flex-col gap-1">
        <h2
          className="text-lg font-bold tracking-tight"
          style={{ color: "#1d1d1f", fontSize: "19px" }}
        >
          Choose a Source
        </h2>
        <p className="text-xs" style={{ color: "#86868b", fontSize: "13px" }}>
          Upload a PDF (up to 25 MB) or paste a YouTube link.
        </p>
      </div>

      {/* PDF Upload */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="pdf-upload"
          className="text-xs font-semibold"
          style={{ color: "#1d1d1f", fontSize: "13px" }}
        >
          Upload PDF Document
        </label>
        <input
          id="pdf-upload"
          type="file"
          accept=".pdf,application/pdf"
          disabled={isIngesting || isConnecting}
          onChange={handleFileChange}
          className="text-base"
          style={{ fontSize: "16px", minHeight: "44px" }}
        />
      </div>

      <div className="apple-divider">or</div>

      {/* Inline YouTube URL Pill Bar (Input + Button in one row) */}
      <form onSubmit={handleUrlSubmit} className="flex flex-col gap-1.5">
        <label
          htmlFor="youtube-url"
          className="text-xs font-semibold"
          style={{ color: "#1d1d1f", fontSize: "13px" }}
        >
          YouTube Video URL
        </label>
        <div className="apple-url-bar">
          <input
            id="youtube-url"
            type="url"
            value={youtubeUrl}
            onChange={(e) => setYoutubeUrl(e.target.value)}
            placeholder="Paste YouTube video URL..."
            disabled={isIngesting || isConnecting}
            className="apple-url-input text-base"
            style={{ fontSize: "16px", minHeight: "44px" }}
          />
          <button
            type="submit"
            disabled={isIngesting || isConnecting || !youtubeUrl.trim()}
            className="apple-url-submit min-h-[44px] min-w-[44px]"
            style={{ minHeight: "44px", minWidth: "44px" }}
          >
            Load Video
          </button>
        </div>
      </form>

      {/* Extraction / Ingestion Loading State */}
      {isIngesting && (
        <div
          role="status"
          className="p-2.5 rounded-xl text-xs text-center font-semibold animate-pulse"
          style={{ background: "#f5f5f7", color: "#007aff" }}
        >
          Extracting source content...
        </div>
      )}

      {/* Primary Start Voice Chat Pill CTA */}
      <button
        type="button"
        disabled={!canStartVoiceChat}
        onClick={onStartVoiceChat}
        className="apple-primary-btn min-h-[44px] min-w-[44px]"
        style={{ minHeight: "48px", minWidth: "44px" }}
      >
        Start Voice Chat
      </button>
    </div>
  );
}
