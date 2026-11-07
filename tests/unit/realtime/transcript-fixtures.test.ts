/**
 * Unit verification tests for transcript test fixtures
 */

import { describe, it, expect } from "vitest";
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
  MOCK_ASSISTANT_AUDIO_DONE,
  MOCK_ASSISTANT_RESPONSE_DONE,
  createUserItemCreatedEvent,
  createUserDeltaEvent,
  createUserCompletedEvent,
  createAssistantItemAddedEvent,
  createAssistantDeltaEvent,
  createAssistantResponseDoneEvent,
} from "../../fixtures/transcript-fixtures";

describe("Transcript Fixtures Verification", () => {
  it("conforms to OpenAI Realtime user speech and transcription schemas", () => {
    expect(MOCK_USER_SPEECH_STARTED.type).toBe("input_audio_buffer.speech_started");
    expect(MOCK_USER_SPEECH_STOPPED.type).toBe("input_audio_buffer.speech_stopped");
    expect(MOCK_USER_ITEM_CREATED.item.role).toBe("user");
    expect(MOCK_USER_TRANSCRIPT_DELTA_1.delta).toBe("What are the ");
    expect(MOCK_USER_TRANSCRIPT_COMPLETED.transcript).toBe("What are the key conclusions?");
    expect(MOCK_USER_TRANSCRIPT_FAILED.error.code).toBe("transcription_failed");
  });

  it("conforms to OpenAI Realtime assistant response and delta schemas", () => {
    expect(MOCK_ASSISTANT_RESPONSE_CREATED.type).toBe("response.created");
    expect(MOCK_ASSISTANT_OUTPUT_ITEM_ADDED.item.role).toBe("assistant");
    expect(MOCK_ASSISTANT_AUDIO_DELTA_1.delta).toContain("Based on the provided document");
    expect(MOCK_ASSISTANT_AUDIO_DONE.transcript).toContain("significant growth");
    expect(MOCK_ASSISTANT_RESPONSE_DONE.type).toBe("response.done");
  });

  it("factory helpers generate valid custom events", () => {
    const userEvent = createUserItemCreatedEvent("u-99");
    expect(userEvent.item.id).toBe("u-99");
    expect(userEvent.item.role).toBe("user");

    const userDelta = createUserDeltaEvent("u-99", "chunk ");
    expect(userDelta.item_id).toBe("u-99");
    expect(userDelta.delta).toBe("chunk ");

    const userDone = createUserCompletedEvent("u-99", "chunk complete");
    expect(userDone.item_id).toBe("u-99");
    expect(userDone.transcript).toBe("chunk complete");

    const asstEvent = createAssistantItemAddedEvent("r-1", "a-1");
    expect(asstEvent.item.id).toBe("a-1");
    expect(asstEvent.response_id).toBe("r-1");

    const asstDelta = createAssistantDeltaEvent("r-1", "a-1", "answer");
    expect(asstDelta.delta).toBe("answer");

    const asstDone = createAssistantResponseDoneEvent("r-1");
    expect(asstDone.response.id).toBe("r-1");
  });
});
