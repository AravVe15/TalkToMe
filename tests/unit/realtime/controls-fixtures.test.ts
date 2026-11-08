/**
 * Unit verification tests for controls test fixtures (Slice 3C)
 */

import { describe, it, expect } from "vitest";
import {
  MOCK_RESPONSE_CANCEL_EVENT,
  MOCK_OUTPUT_AUDIO_BUFFER_CLEAR_EVENT,
  MOCK_RESPONSE_CREATE_EVENT,
  createTextInputMessageEvent,
  createMockMicError,
} from "../../fixtures/controls-fixtures";

describe("Controls Fixtures Verification", () => {
  it("conforms to OpenAI cancel and clear event schemas", () => {
    expect(MOCK_RESPONSE_CANCEL_EVENT.type).toBe("response.cancel");
    expect(MOCK_OUTPUT_AUDIO_BUFFER_CLEAR_EVENT.type).toBe("output_audio_buffer.clear");
    expect(MOCK_RESPONSE_CREATE_EVENT.type).toBe("response.create");
  });

  it("createTextInputMessageEvent generates correct conversation.item.create payload", () => {
    const event = createTextInputMessageEvent("Explain quantum physics");
    expect(event.type).toBe("conversation.item.create");
    expect(event.item.type).toBe("message");
    expect(event.item.role).toBe("user");
    expect(event.item.content[0].type).toBe("input_text");
    expect(event.item.content[0].text).toBe("Explain quantum physics");
  });

  it("createMockMicError creates DOMExceptions with expected names", () => {
    const notAllowed = createMockMicError("NotAllowedError");
    expect(notAllowed.name).toBe("NotAllowedError");

    const notFound = createMockMicError("NotFoundError");
    expect(notFound.name).toBe("NotFoundError");

    const notReadable = createMockMicError("NotReadableError");
    expect(notReadable.name).toBe("NotReadableError");

    const overconstrained = createMockMicError("OverconstrainedError");
    expect(overconstrained.name).toBe("OverconstrainedError");
  });
});
