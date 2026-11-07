/**
 * Transcript Test Fixtures and Mock Data for Slice 3B (Transcript Sync & Turn Ordering)
 * Derived strictly from ADR-08 and AC-08 in decisions.md and requirements.md.
 */

export const MOCK_USER_SPEECH_STARTED = {
  type: "input_audio_buffer.speech_started",
  audio_start_ms: 500,
  item_id: "item_user_001",
};

export const MOCK_USER_SPEECH_STOPPED = {
  type: "input_audio_buffer.speech_stopped",
  audio_end_ms: 2500,
  item_id: "item_user_001",
};

export const MOCK_USER_ITEM_CREATED = {
  type: "conversation.item.created",
  previous_item_id: null,
  item: {
    id: "item_user_001",
    object: "realtime.item",
    type: "message",
    status: "completed",
    role: "user",
    content: [
      {
        type: "input_audio",
        transcript: null,
      },
    ],
  },
};

export const MOCK_USER_TRANSCRIPT_DELTA_1 = {
  type: "conversation.item.input_audio_transcription.delta",
  item_id: "item_user_001",
  content_index: 0,
  delta: "What are the ",
};

export const MOCK_USER_TRANSCRIPT_DELTA_2 = {
  type: "conversation.item.input_audio_transcription.delta",
  item_id: "item_user_001",
  content_index: 0,
  delta: "key conclusions?",
};

export const MOCK_USER_TRANSCRIPT_COMPLETED = {
  type: "conversation.item.input_audio_transcription.completed",
  item_id: "item_user_001",
  content_index: 0,
  transcript: "What are the key conclusions?",
};

export const MOCK_USER_TRANSCRIPT_FAILED = {
  type: "conversation.item.input_audio_transcription.failed",
  item_id: "item_user_001",
  content_index: 0,
  error: {
    code: "transcription_failed",
    message: "Whisper-1 audio transcription error occurred.",
  },
};

export const MOCK_ASSISTANT_RESPONSE_CREATED = {
  type: "response.created",
  response: {
    id: "resp_asst_001",
    object: "realtime.response",
    status: "in_progress",
  },
};

export const MOCK_ASSISTANT_OUTPUT_ITEM_ADDED = {
  type: "response.output_item.added",
  response_id: "resp_asst_001",
  output_index: 0,
  item: {
    id: "item_asst_001",
    object: "realtime.item",
    type: "message",
    status: "in_progress",
    role: "assistant",
    content: [],
  },
};

export const MOCK_ASSISTANT_AUDIO_DELTA_1 = {
  type: "response.audio_transcript.delta",
  response_id: "resp_asst_001",
  item_id: "item_asst_001",
  output_index: 0,
  content_index: 0,
  delta: "Based on the provided document, ",
};

export const MOCK_ASSISTANT_AUDIO_DELTA_2 = {
  type: "response.audio_transcript.delta",
  response_id: "resp_asst_001",
  item_id: "item_asst_001",
  output_index: 0,
  content_index: 0,
  delta: "the primary conclusion is significant growth.",
};

export const MOCK_ASSISTANT_OUTPUT_AUDIO_DELTA = {
  type: "response.output_audio_transcript.delta",
  response_id: "resp_asst_001",
  item_id: "item_asst_001",
  output_index: 0,
  content_index: 0,
  delta: " Additionally, risks were mitigated.",
};

export const MOCK_ASSISTANT_TEXT_DELTA = {
  type: "response.text.delta",
  response_id: "resp_asst_001",
  item_id: "item_asst_001",
  output_index: 0,
  content_index: 0,
  delta: " Summary complete.",
};

export const MOCK_ASSISTANT_AUDIO_DONE = {
  type: "response.audio_transcript.done",
  response_id: "resp_asst_001",
  item_id: "item_asst_001",
  output_index: 0,
  content_index: 0,
  transcript: "Based on the provided document, the primary conclusion is significant growth.",
};

export const MOCK_ASSISTANT_RESPONSE_DONE = {
  type: "response.done",
  response: {
    id: "resp_asst_001",
    object: "realtime.response",
    status: "completed",
  },
};

export function createUserItemCreatedEvent(itemId: string, role: string = "user") {
  return {
    type: "conversation.item.created",
    item: {
      id: itemId,
      role,
      type: "message",
      content: [{ type: "input_audio" }],
    },
  };
}

export function createUserDeltaEvent(itemId: string, delta: string) {
  return {
    type: "conversation.item.input_audio_transcription.delta",
    item_id: itemId,
    delta,
  };
}

export function createUserCompletedEvent(itemId: string, transcript: string) {
  return {
    type: "conversation.item.input_audio_transcription.completed",
    item_id: itemId,
    transcript,
  };
}

export function createAssistantItemAddedEvent(responseId: string, itemId: string) {
  return {
    type: "response.output_item.added",
    response_id: responseId,
    item: {
      id: itemId,
      role: "assistant",
      type: "message",
    },
  };
}

export function createAssistantDeltaEvent(
  responseId: string,
  itemId: string,
  delta: string,
  type: string = "response.audio_transcript.delta"
) {
  return {
    type,
    response_id: responseId,
    item_id: itemId,
    delta,
  };
}

export function createAssistantResponseDoneEvent(responseId: string) {
  return {
    type: "response.done",
    response: {
      id: responseId,
      status: "completed",
    },
  };
}
