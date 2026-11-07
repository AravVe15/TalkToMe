/**
 * Slice 3B: Real-Time Conversation Transcript Synchronization Unit Test Suite
 *
 * Verifies acceptance criteria:
 * - AC-08.1: Chronological turn order preservation via placeholders keyed by item_id (ADR-08)
 * - AC-08.1: Late-arriving Whisper-1 transcription race condition resolution (ADR-08)
 * - AC-08.2: Streaming assistant transcript deltas (Beta & GA variants) & completion (ADR-08)
 * - AC-06.3: Conversation flow state transitions linked to transcript events (ADR-06)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  TranscriptManager,
  reduceTranscriptEvent,
  type TranscriptItem,
} from "@/lib/realtime/transcript";
import type { RealtimeConversationState } from "@/lib/realtime/connection";
import {
  MOCK_USER_SPEECH_STARTED,
  MOCK_USER_SPEECH_STOPPED,
  MOCK_USER_ITEM_CREATED,
  MOCK_USER_TRANSCRIPT_DELTA_1,
  MOCK_USER_TRANSCRIPT_DELTA_2,
  MOCK_USER_TRANSCRIPT_COMPLETED,
  MOCK_USER_TRANSCRIPT_FAILED,
  MOCK_ASSISTANT_RESPONSE_CREATED,
  MOCK_ASSISTANT_OUTPUT_ITEM_ADDED,
  MOCK_ASSISTANT_AUDIO_DELTA_1,
  MOCK_ASSISTANT_AUDIO_DELTA_2,
  MOCK_ASSISTANT_OUTPUT_AUDIO_DELTA,
  MOCK_ASSISTANT_TEXT_DELTA,
  MOCK_ASSISTANT_AUDIO_DONE,
  MOCK_ASSISTANT_RESPONSE_DONE,
  createUserItemCreatedEvent,
  createUserDeltaEvent,
  createUserCompletedEvent,
  createAssistantItemAddedEvent,
  createAssistantDeltaEvent,
  createAssistantResponseDoneEvent,
} from "../../fixtures/transcript-fixtures";

describe("Slice 3B: Transcript Sync & Turn Ordering (AC-08, ADR-08)", () => {
  let manager: TranscriptManager;
  let transcriptUpdates: TranscriptItem[][];
  let conversationStateUpdates: RealtimeConversationState[];

  beforeEach(() => {
    transcriptUpdates = [];
    conversationStateUpdates = [];

    manager = new TranscriptManager({
      onTranscriptChange: (items) => transcriptUpdates.push(items),
      onConversationStateChange: (state) => conversationStateUpdates.push(state),
    });
  });

  describe("Fundamental Turn Lifecycle & Real-Time Streaming", () => {
    it("creates a user placeholder turn on conversation.item.created with status 'transcribing'", () => {
      manager.handleEvent(MOCK_USER_ITEM_CREATED);

      const items = manager.getItems();
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe("item_user_001");
      expect(items[0].role).toBe("user");
      expect(items[0].status).toBe("transcribing");
    });

    it("appends user streaming transcript deltas incrementally", () => {
      manager.handleEvent(MOCK_USER_ITEM_CREATED);
      manager.handleEvent(MOCK_USER_TRANSCRIPT_DELTA_1);

      let items = manager.getItems();
      expect(items[0].text).toBe("What are the ");
      expect(items[0].status).toBe("transcribing");

      manager.handleEvent(MOCK_USER_TRANSCRIPT_DELTA_2);
      items = manager.getItems();
      expect(items[0].text).toBe("What are the key conclusions?");
      expect(items[0].status).toBe("transcribing");
    });

    it("finalizes user turn on conversation.item.input_audio_transcription.completed", () => {
      manager.handleEvent(MOCK_USER_ITEM_CREATED);
      manager.handleEvent(MOCK_USER_TRANSCRIPT_DELTA_1);
      manager.handleEvent(MOCK_USER_TRANSCRIPT_COMPLETED);

      const items = manager.getItems();
      expect(items).toHaveLength(1);
      expect(items[0].text).toBe("What are the key conclusions?");
      expect(items[0].status).toBe("completed");
    });

    it("handles user transcription failure gracefully without crashing or losing turn", () => {
      manager.handleEvent(MOCK_USER_ITEM_CREATED);
      manager.handleEvent(MOCK_USER_TRANSCRIPT_FAILED);

      const items = manager.getItems();
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe("item_user_001");
      expect(items[0].status).toBe("completed");
    });

    it("creates assistant turn on response.output_item.added with status 'streaming'", () => {
      manager.handleEvent(MOCK_ASSISTANT_RESPONSE_CREATED);
      manager.handleEvent(MOCK_ASSISTANT_OUTPUT_ITEM_ADDED);

      const items = manager.getItems();
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe("item_asst_001");
      expect(items[0].role).toBe("assistant");
      expect(items[0].status).toBe("streaming");
      expect(items[0].text).toBe("");
    });

    it("streams assistant audio transcript deltas incrementally and finalizes on response.done", () => {
      manager.handleEvent(MOCK_ASSISTANT_OUTPUT_ITEM_ADDED);
      manager.handleEvent(MOCK_ASSISTANT_AUDIO_DELTA_1);

      let items = manager.getItems();
      expect(items[0].text).toBe("Based on the provided document, ");
      expect(items[0].status).toBe("streaming");

      manager.handleEvent(MOCK_ASSISTANT_AUDIO_DELTA_2);
      items = manager.getItems();
      expect(items[0].text).toBe(
        "Based on the provided document, the primary conclusion is significant growth."
      );

      manager.handleEvent(MOCK_ASSISTANT_AUDIO_DONE);
      manager.handleEvent(MOCK_ASSISTANT_RESPONSE_DONE);

      items = manager.getItems();
      expect(items[0].status).toBe("completed");
    });
  });

  describe("AC-08.1: The Critical Race Condition & Turn Ordering Guarantee", () => {
    it("AC-08.1: places user turn BEFORE assistant turn when Whisper transcription arrives AFTER assistant reply has started", () => {
      // 1. User finishes speaking -> placeholder created for user turn
      manager.handleEvent(MOCK_USER_ITEM_CREATED);

      expect(manager.getItems()).toHaveLength(1);
      expect(manager.getItems()[0].id).toBe("item_user_001");
      expect(manager.getItems()[0].role).toBe("user");
      expect(manager.getItems()[0].status).toBe("transcribing");

      // 2. Assistant begins streaming reply BEFORE Whisper finishes transcribing!
      manager.handleEvent(MOCK_ASSISTANT_RESPONSE_CREATED);
      manager.handleEvent(MOCK_ASSISTANT_OUTPUT_ITEM_ADDED);
      manager.handleEvent(MOCK_ASSISTANT_AUDIO_DELTA_1);

      let items = manager.getItems();
      expect(items).toHaveLength(2);
      expect(items[0].id).toBe("item_user_001");
      expect(items[0].role).toBe("user");
      expect(items[1].id).toBe("item_asst_001");
      expect(items[1].role).toBe("assistant");
      expect(items[1].text).toContain("Based on the provided document");

      // 3. Whisper completes transcription LATE (after assistant delta has already appeared)
      manager.handleEvent(MOCK_USER_TRANSCRIPT_COMPLETED);

      // 4. CRITICAL VERIFICATION:
      // User turn MUST remain at index 0 (before assistant turn at index 1)
      items = manager.getItems();
      expect(items).toHaveLength(2);

      // Index 0: User turn with completed transcript
      expect(items[0].id).toBe("item_user_001");
      expect(items[0].role).toBe("user");
      expect(items[0].text).toBe("What are the key conclusions?");
      expect(items[0].status).toBe("completed");

      // Index 1: Assistant turn
      expect(items[1].id).toBe("item_asst_001");
      expect(items[1].role).toBe("assistant");
      expect(items[1].text).toContain("Based on the provided document");
    });

    it("AC-08.1: guarantees strict chronological order across multi-turn conversation with delayed Whisper events", () => {
      // --- Turn 1 ---
      // User 1 speaks
      manager.handleEvent(createUserItemCreatedEvent("user_turn_1"));
      // Assistant 1 starts immediately
      manager.handleEvent(createAssistantItemAddedEvent("resp_1", "asst_turn_1"));
      manager.handleEvent(createAssistantDeltaEvent("resp_1", "asst_turn_1", "Answer 1"));
      manager.handleEvent(createAssistantResponseDoneEvent("resp_1"));
      // Whisper 1 completes very late (after Assistant 1 finished)
      manager.handleEvent(createUserCompletedEvent("user_turn_1", "Question 1"));

      // Check Turn 1 order
      let items = manager.getItems();
      expect(items.map((i) => i.id)).toEqual(["user_turn_1", "asst_turn_1"]);
      expect(items.map((i) => i.role)).toEqual(["user", "assistant"]);
      expect(items[0].text).toBe("Question 1");
      expect(items[1].text).toBe("Answer 1");

      // --- Turn 2 ---
      // User 2 speaks
      manager.handleEvent(createUserItemCreatedEvent("user_turn_2"));
      // Assistant 2 starts immediately
      manager.handleEvent(createAssistantItemAddedEvent("resp_2", "asst_turn_2"));
      manager.handleEvent(createAssistantDeltaEvent("resp_2", "asst_turn_2", "Answer 2"));
      // Whisper 2 completes
      manager.handleEvent(createUserCompletedEvent("user_turn_2", "Question 2"));
      manager.handleEvent(createAssistantResponseDoneEvent("resp_2"));

      // Check Multi-Turn order: [User 1, Asst 1, User 2, Asst 2]
      items = manager.getItems();
      expect(items.map((i) => i.id)).toEqual([
        "user_turn_1",
        "asst_turn_1",
        "user_turn_2",
        "asst_turn_2",
      ]);
      expect(items.map((i) => i.role)).toEqual(["user", "assistant", "user", "assistant"]);
    });

    it("AC-08.1: preserves turn order when Whisper transcription deltas arrive interleaved with assistant deltas", () => {
      manager.handleEvent(createUserItemCreatedEvent("user_turn_1"));
      manager.handleEvent(createAssistantItemAddedEvent("resp_1", "asst_turn_1"));

      // Interleaved streaming deltas:
      manager.handleEvent(createAssistantDeltaEvent("resp_1", "asst_turn_1", "I "));
      manager.handleEvent(createUserDeltaEvent("user_turn_1", "Tell "));
      manager.handleEvent(createAssistantDeltaEvent("resp_1", "asst_turn_1", "am "));
      manager.handleEvent(createUserDeltaEvent("user_turn_1", "me "));
      manager.handleEvent(createAssistantDeltaEvent("resp_1", "asst_turn_1", "ready."));
      manager.handleEvent(createUserCompletedEvent("user_turn_1", "Tell me more."));
      manager.handleEvent(createAssistantResponseDoneEvent("resp_1"));

      const items = manager.getItems();
      expect(items).toHaveLength(2);
      expect(items[0].id).toBe("user_turn_1");
      expect(items[0].text).toBe("Tell me more.");
      expect(items[1].id).toBe("asst_turn_1");
      expect(items[1].text).toBe("I am ready.");
    });
  });

  describe("AC-06.3 & ADR-08: Conversation Flow State Machine Synchronization", () => {
    it("transitions state through user_speaking -> assistant_thinking -> assistant_speaking -> listening", () => {
      expect(manager.conversationState).toBe("listening");

      // User starts speaking
      manager.handleEvent(MOCK_USER_SPEECH_STARTED);
      expect(manager.conversationState).toBe("user_speaking");
      expect(conversationStateUpdates).toContain("user_speaking");

      // User stops speaking
      manager.handleEvent(MOCK_USER_SPEECH_STOPPED);

      // Model response begins generating
      manager.handleEvent(MOCK_ASSISTANT_RESPONSE_CREATED);
      expect(manager.conversationState).toBe("assistant_thinking");

      // Model begins streaming audio speech transcript
      manager.handleEvent(MOCK_ASSISTANT_AUDIO_DELTA_1);
      expect(manager.conversationState).toBe("assistant_speaking");

      // Model finishes speaking
      manager.handleEvent(MOCK_ASSISTANT_RESPONSE_DONE);
      expect(manager.conversationState).toBe("listening");
    });
  });

  describe("AC-08.2: Support for GA and Beta Realtime Transcript Event Variants", () => {
    it("accumulates text from response.output_audio_transcript.delta (GA variant)", () => {
      manager.handleEvent(MOCK_ASSISTANT_OUTPUT_ITEM_ADDED);
      manager.handleEvent(MOCK_ASSISTANT_OUTPUT_AUDIO_DELTA);

      const items = manager.getItems();
      expect(items[0].text).toBe(" Additionally, risks were mitigated.");
    });

    it("accumulates text from response.text.delta (text modality variant)", () => {
      manager.handleEvent(MOCK_ASSISTANT_OUTPUT_ITEM_ADDED);
      manager.handleEvent(MOCK_ASSISTANT_TEXT_DELTA);

      const items = manager.getItems();
      expect(items[0].text).toBe(" Summary complete.");
    });

    it("deduplicates redundant dual-emitted deltas with identical content", () => {
      manager.handleEvent(MOCK_ASSISTANT_OUTPUT_ITEM_ADDED);

      // Simulate model emitting both audio delta and text delta for the same piece of text
      const delta1 = {
        type: "response.audio_transcript.delta",
        item_id: "item_asst_001",
        delta: "Unique thought.",
      };
      const delta2 = {
        type: "response.text.delta",
        item_id: "item_asst_001",
        delta: "Unique thought.",
      };

      manager.handleEvent(delta1);
      manager.handleEvent(delta2);

      const items = manager.getItems();
      // Should not duplicate the identical concurrent delta
      expect(items[0].text).toBe("Unique thought.");
    });

    it("finalizes assistant item on response.output_audio_transcript.done", () => {
      manager.handleEvent(MOCK_ASSISTANT_OUTPUT_ITEM_ADDED);
      manager.handleEvent({
        type: "response.output_audio_transcript.done",
        item_id: "item_asst_001",
        transcript: "Full audio output transcript.",
      });

      const items = manager.getItems();
      expect(items[0].text).toBe("Full audio output transcript.");
      expect(items[0].status).toBe("completed");
    });
  });

  describe("Boundary Conditions, Out-of-Order Events & Edge Cases", () => {
    it("handles input_audio_transcription.delta arriving before conversation.item.created", () => {
      // Delta arrives without prior item.created event
      manager.handleEvent(MOCK_USER_TRANSCRIPT_DELTA_1);

      const items = manager.getItems();
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe("item_user_001");
      expect(items[0].role).toBe("user");
      expect(items[0].text).toBe("What are the ");
    });

    it("handles input_audio_transcription.completed arriving before conversation.item.created", () => {
      manager.handleEvent(MOCK_USER_TRANSCRIPT_COMPLETED);

      const items = manager.getItems();
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe("item_user_001");
      expect(items[0].text).toBe("What are the key conclusions?");
      expect(items[0].status).toBe("completed");
    });

    it("handles assistant delta arriving before response.output_item.added", () => {
      manager.handleEvent(MOCK_ASSISTANT_AUDIO_DELTA_1);

      const items = manager.getItems();
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe("item_asst_001");
      expect(items[0].role).toBe("assistant");
      expect(items[0].text).toBe("Based on the provided document, ");
    });

    it("safely ignores empty or undefined deltas without altering text", () => {
      manager.handleEvent(MOCK_ASSISTANT_OUTPUT_ITEM_ADDED);
      manager.handleEvent(MOCK_ASSISTANT_AUDIO_DELTA_1);

      manager.handleEvent({
        type: "response.audio_transcript.delta",
        item_id: "item_asst_001",
        delta: "", // Empty string
      });

      manager.handleEvent({
        type: "response.audio_transcript.delta",
        item_id: "item_asst_001",
        delta: undefined,
      });

      const items = manager.getItems();
      expect(items[0].text).toBe("Based on the provided document, ");
    });

    it("preserves Unicode, accents, emojis, and multiline spacing in deltas", () => {
      manager.handleEvent(MOCK_ASSISTANT_OUTPUT_ITEM_ADDED);
      manager.handleEvent({
        type: "response.audio_transcript.delta",
        item_id: "item_asst_001",
        delta: "Bonjour le monde! 🌍\n• Point 1: 100% naïve.\n• Point 2: café crème.",
      });

      const items = manager.getItems();
      expect(items[0].text).toBe(
        "Bonjour le monde! 🌍\n• Point 1: 100% naïve.\n• Point 2: café crème."
      );
    });

    it("handles malformed JSON data channel message events without throwing unhandled exceptions", () => {
      expect(() => {
        manager.handleEvent("{ malformed json syntax: missing closing brackets");
      }).not.toThrow();

      expect(() => {
        manager.handleEvent(null);
        manager.handleEvent(undefined);
        manager.handleEvent(12345);
        manager.handleEvent("plain string");
      }).not.toThrow();
    });

    it("ignores unrelated server events (rate_limits, session.updated) without affecting items", () => {
      manager.handleEvent(MOCK_USER_ITEM_CREATED);

      manager.handleEvent({
        type: "rate_limits.updated",
        rate_limits: [{ name: "requests", remaining: 99 }],
      });
      manager.handleEvent({
        type: "session.updated",
        session: { id: "sess_1" },
      });

      const items = manager.getItems();
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe("item_user_001");
    });

    it("is idempotent when receiving duplicate conversation.item.created events", () => {
      manager.handleEvent(MOCK_USER_ITEM_CREATED);
      manager.handleEvent(MOCK_USER_ITEM_CREATED); // duplicate

      const items = manager.getItems();
      expect(items).toHaveLength(1);
    });
  });

  describe("Transcript State Operations (Clear, Snapshot, Reducer)", () => {
    it("clears all transcript items on clear()", () => {
      manager.handleEvent(MOCK_USER_ITEM_CREATED);
      manager.handleEvent(MOCK_ASSISTANT_OUTPUT_ITEM_ADDED);
      expect(manager.getItems()).toHaveLength(2);

      manager.clear();
      expect(manager.getItems()).toHaveLength(0);
    });

    it("getItems() returns a clean copy preventing external state mutation", () => {
      manager.handleEvent(MOCK_USER_ITEM_CREATED);
      const itemsCopy = manager.getItems();

      // Mutate the returned array
      itemsCopy.length = 0;

      // Internal manager array remains untouched
      expect(manager.getItems()).toHaveLength(1);
    });

    it("reduceTranscriptEvent pure reducer processes events deterministically", () => {
      let state: TranscriptItem[] = [];

      state = reduceTranscriptEvent(state, MOCK_USER_ITEM_CREATED);
      expect(state).toHaveLength(1);
      expect(state[0].id).toBe("item_user_001");

      state = reduceTranscriptEvent(state, MOCK_USER_TRANSCRIPT_COMPLETED);
      expect(state[0].text).toBe("What are the key conclusions?");
      expect(state[0].status).toBe("completed");

      state = reduceTranscriptEvent(state, MOCK_ASSISTANT_OUTPUT_ITEM_ADDED);
      expect(state).toHaveLength(2);

      state = reduceTranscriptEvent(state, MOCK_ASSISTANT_AUDIO_DELTA_1);
      expect(state[1].text).toContain("Based on the provided document");
    });
  });
});
