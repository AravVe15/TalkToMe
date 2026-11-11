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
  const [activeTab, setActiveTab] = useState<"pdf" | "youtube">("pdf");
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const isIngesting = connectionState === "ingesting";
  const isConnecting = connectionState === "connecting";

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFileName(file.name);
      onPdfSelected?.(file);
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
      <span className="sr-only">Choose a Source</span>

      {/* iOS Segmented Mode Picker */}
      <div className="apple-segmented" role="tablist" aria-label="Source type">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "pdf"}
          onClick={() => setActiveTab("pdf")}
          className={`apple-segment-btn ${
            activeTab === "pdf" ? "apple-segment-btn-active" : ""
          }`}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <span>PDF Document</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "youtube"}
          onClick={() => setActiveTab("youtube")}
          className={`apple-segment-btn ${
            activeTab === "youtube" ? "apple-segment-btn-active" : ""
          }`}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M21.58 7.19a2.51 2.51 0 0 0-1.77-1.77C18.25 5 12 5 12 5s-6.25 0-7.81.42a2.51 2.51 0 0 0-1.77 1.77C2 8.75 2 12 2 12s0 3.25.42 4.81a2.51 2.51 0 0 0 1.77 1.77C5.75 19 12 19 12 19s6.25 0 7.81-.42a2.51 2.51 0 0 0 1.77-1.77C22 15.25 22 12 22 12s0-3.25-.42-4.81zM10 15V9l5.2 3-5.2 3z" />
          </svg>
          <span>YouTube Video</span>
        </button>
      </div>

      {/* Tab 1: Tactile Apple PDF Dropzone (Hides ugly native "no file selected") */}
      <div className={activeTab === "pdf" ? "" : "tab-panel-inactive"}>
        <label htmlFor="pdf-upload" className="sr-only">
          Upload PDF Document
        </label>
        <div className="apple-dropzone">
          <input
            id="pdf-upload"
            type="file"
            accept=".pdf,application/pdf"
            disabled={isIngesting || isConnecting}
            onChange={handleFileChange}
            className="apple-dropzone-input text-base"
            style={{ fontSize: "16px", minHeight: "44px" }}
          />
          <div className="apple-dropzone-icon" aria-hidden="true">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.1"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>
          <span
            className="text-sm font-semibold truncate max-w-md"
            style={{ color: "#1d1d1f", fontSize: "14px" }}
          >
            {selectedFileName ? selectedFileName : "Tap to choose a PDF file"}
          </span>
          <span
            className="text-xs"
            style={{ color: "#86868b", fontSize: "12px" }}
          >
            Up to 25 MB • Instant spatial text extraction
          </span>
        </div>
      </div>

      {/* Tab 2: YouTube URL Pill Bar */}
      <form
        onSubmit={handleUrlSubmit}
        className={
          activeTab === "youtube"
            ? "flex flex-col gap-1.5"
            : "tab-panel-inactive"
        }
      >
        <label htmlFor="youtube-url" className="sr-only">
          YouTube Video URL
        </label>
        <div className="apple-url-bar">
          <input
            id="youtube-url"
            type="url"
            value={youtubeUrl}
            onChange={(e) => setYoutubeUrl(e.target.value)}
            placeholder="Paste YouTube video link..."
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
        style={{ minHeight: "52px", minWidth: "44px" }}
      >
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
        </svg>
        <span>Start Voice Chat</span>
      </button>
    </div>
  );
}
