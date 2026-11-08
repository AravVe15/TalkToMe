/**
 * Controls & Text Fallback Test Fixtures for Slice 3C
 * Derived strictly from ADR-07, ADR-09, AC-07, and AC-09.
 */

export const MOCK_RESPONSE_CANCEL_EVENT = {
  type: "response.cancel",
};

export const MOCK_OUTPUT_AUDIO_BUFFER_CLEAR_EVENT = {
  type: "output_audio_buffer.clear",
};

export const MOCK_RESPONSE_CREATE_EVENT = {
  type: "response.create",
};

export function createTextInputMessageEvent(text: string) {
  return {
    type: "conversation.item.create",
    item: {
      type: "message",
      role: "user",
      content: [
        {
          type: "input_text",
          text,
        },
      ],
    },
  };
}

export function createMockMicError(
  name: "NotAllowedError" | "NotFoundError" | "NotReadableError" | "OverconstrainedError",
  message: string = "Microphone error"
): DOMException {
  return new DOMException(message, name);
}
