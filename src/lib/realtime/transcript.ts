/**
 * Slice 3B: Real-Time Conversation Transcript Synchronization & Turn Ordering
 * (ADR-08 / AC-08.1, AC-08.2, AC-06.3).
 *
 * Synchronizes asynchronous user speech transcription (`whisper-1`) with
 * streaming assistant audio/text deltas over the `oai-events` data channel:
 * - Inserts chronological user turn placeholders (`status: "transcribing"`) keyed by `item_id`
 *   as soon as user speech commits (`conversation.item.created`), locking turn order before
 *   the assistant reply begins streaming (`AC-08.1`).
 * - Updates user turns on `conversation.item.input_audio_transcription.delta` and finalizes
 *   on `conversation.item.input_audio_transcription.completed` (or `.failed`).
 * - Streams assistant transcript deltas across both Beta and GA event names
 *   (`response.audio_transcript.delta`, `response.output_audio_transcript.delta`,
 *   `response.text.delta`, `response.output_text.delta`) and finalizes on `.done` / `response.done` (`AC-08.2`).
 * - Tracks conversation flow sub-states (`listening`, `user_speaking`, `assistant_thinking`, `assistant_speaking`).
 */

import type {
  TranscriptItem,
  TranscriptRole,
  TranscriptStatus,
} from "@/types/realtime";
import type { RealtimeConversationState } from "@/lib/realtime/connection";

export type { TranscriptItem, TranscriptRole, TranscriptStatus };

export interface TranscriptManagerOptions {
  onTranscriptChange?: (items: TranscriptItem[]) => void;
  onConversationStateChange?: (state: RealtimeConversationState) => void;
  initialItems?: TranscriptItem[];
}

function parseRealtimeEvent(rawEvent: unknown): Record<string, unknown> | null {
  if (typeof rawEvent === "string") {
    const trimmed = rawEvent.trim();
    if (!trimmed.startsWith("{")) {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        !Array.isArray(parsed)
      ) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }

  if (
    typeof rawEvent === "object" &&
    rawEvent !== null &&
    !Array.isArray(rawEvent)
  ) {
    return rawEvent as Record<string, unknown>;
  }

  return null;
}

function extractInitialItemText(itemObj: Record<string, unknown>): {
  text: string;
  hasCompletedText: boolean;
} {
  const content = itemObj.content;
  if (!Array.isArray(content)) {
    return { text: "", hasCompletedText: false };
  }

  for (const part of content) {
    if (typeof part === "object" && part !== null) {
      const partRecord = part as Record<string, unknown>;
      if (
        (partRecord.type === "input_text" || partRecord.type === "text") &&
        typeof partRecord.text === "string" &&
        partRecord.text.length > 0
      ) {
        return { text: partRecord.text, hasCompletedText: true };
      }
      if (
        typeof partRecord.transcript === "string" &&
        partRecord.transcript.length > 0
      ) {
        return { text: partRecord.transcript, hasCompletedText: true };
      }
    }
  }

  return { text: "", hasCompletedText: false };
}

/**
 * Pure state reducer that applies an OpenAI Realtime event to an immutable list
 * of `TranscriptItem`s while preserving chronological turn order (ADR-08).
 */
export function reduceTranscriptEvent(
  items: TranscriptItem[],
  event: unknown
): TranscriptItem[] {
  const parsed = parseRealtimeEvent(event);
  if (!parsed || typeof parsed.type !== "string") {
    return items;
  }

  const eventType = parsed.type;
  const now = Date.now();

  switch (eventType) {
    case "conversation.item.create":
    case "conversation.item.created":
    case "conversation.item.added": {
      const itemObj =
        typeof parsed.item === "object" && parsed.item !== null
          ? (parsed.item as Record<string, unknown>)
          : null;
      if (!itemObj) {
        return items;
      }

      const itemId =
        typeof itemObj.id === "string" && itemObj.id.length > 0
          ? itemObj.id
          : `item_user_msg_${now}_${Math.random().toString(36).slice(2, 8)}`;

      const existingIndex = items.findIndex((i) => i.id === itemId);
      if (existingIndex !== -1) {
        return items;
      }

      const role: TranscriptRole =
        itemObj.role === "assistant" ? "assistant" : "user";
      const { text, hasCompletedText } = extractInitialItemText(itemObj);
      const status: TranscriptStatus =
        role === "user"
          ? hasCompletedText
            ? "completed"
            : "transcribing"
          : "streaming";

      return [
        ...items,
        {
          id: itemId,
          role,
          text,
          status,
          createdAt: now,
          updatedAt: now,
        },
      ];
    }

    case "conversation.item.input_audio_transcription.delta": {
      const itemId =
        typeof parsed.item_id === "string" ? parsed.item_id : "";
      const delta = typeof parsed.delta === "string" ? parsed.delta : "";
      if (!itemId || !delta) {
        return items;
      }

      const existingIndex = items.findIndex((i) => i.id === itemId);
      if (existingIndex === -1) {
        return [
          ...items,
          {
            id: itemId,
            role: "user",
            text: delta,
            status: "transcribing",
            createdAt: now,
            updatedAt: now,
          },
        ];
      }

      const existing = items[existingIndex];
      if (existing.status === "completed") {
        return items;
      }

      const nextItems = [...items];
      nextItems[existingIndex] = {
        ...existing,
        text: existing.text + delta,
        status: "transcribing",
        updatedAt: now,
      };
      return nextItems;
    }

    case "conversation.item.input_audio_transcription.completed": {
      const itemId =
        typeof parsed.item_id === "string" ? parsed.item_id : "";
      const transcript =
        typeof parsed.transcript === "string" ? parsed.transcript : "";
      if (!itemId) {
        return items;
      }

      const existingIndex = items.findIndex((i) => i.id === itemId);
      if (existingIndex === -1) {
        return [
          ...items,
          {
            id: itemId,
            role: "user",
            text: transcript,
            status: "completed",
            createdAt: now,
            updatedAt: now,
          },
        ];
      }

      const existing = items[existingIndex];
      const nextItems = [...items];
      nextItems[existingIndex] = {
        ...existing,
        text: transcript.length > 0 ? transcript : existing.text,
        status: "completed",
        updatedAt: now,
      };
      return nextItems;
    }

    case "conversation.item.input_audio_transcription.failed": {
      const itemId =
        typeof parsed.item_id === "string" ? parsed.item_id : "";
      if (!itemId) {
        return items;
      }

      const existingIndex = items.findIndex((i) => i.id === itemId);
      if (existingIndex === -1) {
        return [
          ...items,
          {
            id: itemId,
            role: "user",
            text: "",
            status: "completed",
            createdAt: now,
            updatedAt: now,
          },
        ];
      }

      const existing = items[existingIndex];
      const nextItems = [...items];
      nextItems[existingIndex] = {
        ...existing,
        status: "completed",
        updatedAt: now,
      };
      return nextItems;
    }

    case "response.output_item.added": {
      const itemObj =
        typeof parsed.item === "object" && parsed.item !== null
          ? (parsed.item as Record<string, unknown>)
          : null;
      if (!itemObj || typeof itemObj.id !== "string" || !itemObj.id) {
        return items;
      }

      const itemId = itemObj.id;
      const existingIndex = items.findIndex((i) => i.id === itemId);
      if (existingIndex !== -1) {
        return items;
      }

      const role: TranscriptRole =
        itemObj.role === "user" ? "user" : "assistant";

      return [
        ...items,
        {
          id: itemId,
          role,
          text: "",
          status: role === "assistant" ? "streaming" : "transcribing",
          createdAt: now,
          updatedAt: now,
        },
      ];
    }

    case "response.audio_transcript.delta":
    case "response.output_audio_transcript.delta":
    case "response.text.delta":
    case "response.output_text.delta": {
      const itemId =
        typeof parsed.item_id === "string" ? parsed.item_id : "";
      const delta = typeof parsed.delta === "string" ? parsed.delta : "";
      if (!itemId || delta.length === 0) {
        return items;
      }

      const existingIndex = items.findIndex((i) => i.id === itemId);
      if (existingIndex === -1) {
        return [
          ...items,
          {
            id: itemId,
            role: "assistant",
            text: delta,
            status: "streaming",
            createdAt: now,
            updatedAt: now,
          },
        ];
      }

      const existing = items[existingIndex];
      const isTextModalityDelta =
        eventType === "response.text.delta" ||
        eventType === "response.output_text.delta";

      // Deduplicate redundant dual-emitted deltas across audio/text modalities
      if (
        existing.text === delta ||
        (isTextModalityDelta && existing.text.endsWith(delta))
      ) {
        return items;
      }

      const nextItems = [...items];
      nextItems[existingIndex] = {
        ...existing,
        text: existing.text + delta,
        status:
          existing.status === "interrupted" ? "interrupted" : "streaming",
        updatedAt: now,
      };
      return nextItems;
    }

    case "response.audio_transcript.done":
    case "response.output_audio_transcript.done":
    case "response.text.done":
    case "response.output_text.done": {
      const itemId =
        typeof parsed.item_id === "string" ? parsed.item_id : "";
      const finalTranscript =
        typeof parsed.transcript === "string"
          ? parsed.transcript
          : typeof parsed.text === "string"
            ? parsed.text
            : "";

      if (!itemId) {
        return items;
      }

      const existingIndex = items.findIndex((i) => i.id === itemId);
      if (existingIndex === -1) {
        return [
          ...items,
          {
            id: itemId,
            role: "assistant",
            text: finalTranscript,
            status: "completed",
            createdAt: now,
            updatedAt: now,
          },
        ];
      }

      const existing = items[existingIndex];
      const nextItems = [...items];
      nextItems[existingIndex] = {
        ...existing,
        text:
          finalTranscript.length > 0 ? finalTranscript : existing.text,
        status:
          existing.status === "interrupted" ? "interrupted" : "completed",
        updatedAt: now,
      };
      return nextItems;
    }

    case "response.output_item.done": {
      const itemObj =
        typeof parsed.item === "object" && parsed.item !== null
          ? (parsed.item as Record<string, unknown>)
          : null;
      if (!itemObj || typeof itemObj.id !== "string" || !itemObj.id) {
        return items;
      }

      const existingIndex = items.findIndex((i) => i.id === itemObj.id);
      if (existingIndex === -1) {
        return items;
      }

      const existing = items[existingIndex];
      const nextItems = [...items];
      nextItems[existingIndex] = {
        ...existing,
        status:
          existing.status === "interrupted" ? "interrupted" : "completed",
        updatedAt: now,
      };
      return nextItems;
    }

    case "response.done": {
      let modified = false;
      const nextItems = items.map((item) => {
        if (item.role === "assistant" && item.status === "streaming") {
          modified = true;
          return {
            ...item,
            status: "completed" as const,
            updatedAt: now,
          };
        }
        return item;
      });

      return modified ? nextItems : items;
    }

    case "response.cancel":
    case "response.cancelled": {
      let modified = false;
      const nextItems = items.map((item) => {
        if (item.role === "assistant" && item.status === "streaming") {
          modified = true;
          return {
            ...item,
            status: "interrupted" as const,
            updatedAt: now,
          };
        }
        return item;
      });

      return modified ? nextItems : items;
    }

    default:
      return items;
  }
}

export class TranscriptManager {
  items: TranscriptItem[];
  conversationState: RealtimeConversationState = "listening";
  isAudioOutputActive: boolean = false;

  private readonly options: TranscriptManagerOptions;

  constructor(options: TranscriptManagerOptions = {}) {
    this.options = options;
    this.items = options.initialItems
      ? options.initialItems.map((item) => ({ ...item }))
      : [];
  }

  handleEvent(event: unknown | string): void {
    const parsed = parseRealtimeEvent(event);
    if (!parsed || typeof parsed.type !== "string") {
      return;
    }

    const eventType = parsed.type;

    // Update conversation flow sub-state (AC-06.3 / ADR-08)
    this.updateConversationStateForEvent(eventType, parsed);

    // Apply transcript item state reduction
    const previousItems = this.items;
    const nextItems = reduceTranscriptEvent(previousItems, parsed);

    if (nextItems !== previousItems) {
      this.items = nextItems;
      this.options.onTranscriptChange?.(this.getItems());
    }
  }

  getItems(): TranscriptItem[] {
    return this.items.map((item) => ({ ...item }));
  }

  markAssistantInterrupted(): void {
    this.isAudioOutputActive = false;
    let modified = false;
    const now = Date.now();
    this.items = this.items.map((item) => {
      if (item.role === "assistant" && item.status === "streaming") {
        modified = true;
        return {
          ...item,
          status: "interrupted" as const,
          updatedAt: now,
        };
      }
      return item;
    });

    // If server token generation already emitted response.done while buffered WebRTC
    // audio was still playing, mark the most recent completed assistant turn as interrupted.
    if (!modified) {
      for (let i = this.items.length - 1; i >= 0; i--) {
        const candidate = this.items[i];
        if (candidate.role === "assistant") {
          if (candidate.status === "completed") {
            const nextItems = [...this.items];
            nextItems[i] = {
              ...candidate,
              status: "interrupted",
              updatedAt: now,
            };
            this.items = nextItems;
            modified = true;
          }
          break;
        }
      }
    }

    if (modified) {
      this.options.onTranscriptChange?.(this.getItems());
    }
  }

  appendUserMessage(text: string): TranscriptItem {
    const trimmed = text.trim();
    const now = Date.now();
    const item: TranscriptItem = {
      id: `item_user_msg_${now}_${Math.random().toString(36).slice(2, 8)}`,
      role: "user",
      text: trimmed,
      status: "completed",
      createdAt: now,
      updatedAt: now,
    };
    this.items = [...this.items, item];
    this.options.onTranscriptChange?.(this.getItems());
    return item;
  }

  clear(): void {
    this.items = [];
    this.isAudioOutputActive = false;
    this.setConversationState("listening");
    this.options.onTranscriptChange?.([]);
  }

  private updateConversationStateForEvent(
    eventType: string,
    parsed?: Record<string, unknown>
  ): void {
    switch (eventType) {
      case "input_audio_buffer.speech_started":
        this.isAudioOutputActive = false;
        this.setConversationState("user_speaking");
        break;

      case "response.created":
        this.setConversationState("assistant_thinking");
        break;

      case "output_audio_buffer.started":
        this.isAudioOutputActive = true;
        this.setConversationState("assistant_speaking");
        break;

      case "response.audio_transcript.delta":
      case "response.output_audio_transcript.delta":
      case "response.text.delta":
      case "response.output_text.delta":
      case "response.audio.delta":
      case "response.output_audio.delta":
        if (this.conversationState !== "user_speaking") {
          this.isAudioOutputActive = true; 
          this.setConversationState("assistant_speaking");
        }
        break;

      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared":
        this.isAudioOutputActive = false;
        if (this.conversationState !== "user_speaking") {
          this.setConversationState("listening");
        }
        break;

      case "response.done": {
        const respObj =
          parsed && typeof parsed.response === "object" && parsed.response !== null
            ? (parsed.response as Record<string, unknown>)
            : null;
        const respStatus =
          respObj && typeof respObj.status === "string" ? respObj.status : "";

        if (respStatus === "cancelled" || respStatus === "incomplete") {
          this.isAudioOutputActive = false;
        }

        // Preserve user_speaking if response.done arrives asynchronously after barge-in,
        // and preserve assistant_speaking while WebRTC output_audio_buffer is still draining.
        if (
          this.conversationState !== "user_speaking" &&
          !this.isAudioOutputActive
        ) {
          this.setConversationState("listening");
        }
        break;
      }

      case "response.cancelled":
      case "response.cancel":
        this.isAudioOutputActive = false;
        if (this.conversationState !== "user_speaking") {
          this.setConversationState("listening");
        }
        break;

      default:
        break;
    }
  }

  private setConversationState(nextState: RealtimeConversationState): void {
    if (this.conversationState === nextState) {
      return;
    }
    this.conversationState = nextState;
    this.options.onConversationStateChange?.(nextState);
  }
}
