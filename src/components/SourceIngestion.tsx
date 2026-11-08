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
    <div className="flex flex-col gap-4 p-4 bg-white rounded-lg border border-gray-200 shadow-sm">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">1. Choose a Source</h2>
        <p className="text-xs text-muted" style={{ color: "var(--text-muted)" }}>
          Upload a PDF (up to 25 MB) or enter a YouTube video URL with captions.
        </p>
      </div>

      {/* PDF Upload */}
      <div className="flex flex-col gap-2">
        <label
          htmlFor="pdf-upload"
          className="text-sm font-semibold"
          style={{ fontSize: "14px" }}
        >
          Upload PDF Document
        </label>
        <input
          id="pdf-upload"
          type="file"
          accept=".pdf,application/pdf"
          disabled={isIngesting || isConnecting}
          onChange={handleFileChange}
          className="text-base py-2 px-3 border border-gray-200 rounded-md"
          style={{ fontSize: "16px", minHeight: "44px" }}
        />
      </div>

      <div className="text-xs text-center text-muted" style={{ color: "var(--text-muted)" }}>
        — OR —
      </div>

      {/* YouTube URL Input */}
      <form onSubmit={handleUrlSubmit} className="flex flex-col gap-2">
        <label
          htmlFor="youtube-url"
          className="text-sm font-semibold"
          style={{ fontSize: "14px" }}
        >
          YouTube Video URL
        </label>
        <div className="flex flex-col gap-2">
          <input
            id="youtube-url"
            type="url"
            value={youtubeUrl}
            onChange={(e) => setYoutubeUrl(e.target.value)}
            placeholder="Paste YouTube video URL (e.g. https://youtu.be/...)"
            disabled={isIngesting || isConnecting}
            className="text-base py-3 px-4 border border-gray-200 rounded-md"
            style={{ fontSize: "16px", minHeight: "44px" }}
          />
          <button
            type="submit"
            disabled={isIngesting || isConnecting || !youtubeUrl.trim()}
            className="min-h-[44px] min-w-[44px] py-3 px-4 font-semibold text-white bg-blue-600 rounded-md"
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
          className="p-3 bg-slate-100 border border-gray-200 rounded-md text-sm text-center font-semibold"
        >
          Extracting source content...
        </div>
      )}

      {/* Start Voice Chat CTA */}
      <div className="pt-2">
        <button
          type="button"
          disabled={!canStartVoiceChat}
          onClick={onStartVoiceChat}
          className={`min-h-[44px] min-w-[44px] py-3 px-4 w-full font-bold text-white rounded-md text-base ${
            canStartVoiceChat
              ? "bg-blue-600 cursor-pointer shadow-md"
              : "bg-gray-400 cursor-not-allowed opacity-60"
          }`}
          style={{
            minHeight: "44px",
            minWidth: "44px",
            backgroundColor: canStartVoiceChat ? "#2563eb" : "#94a3b8",
            width: "100%",
          }}
        >
          Start Voice Chat
        </button>
      </div>
    </div>
  );
}
