import { describe, expect, it } from "vitest";

import { TransientError, probeFailure } from "./jobs";
import { RecordingReadError } from "./recording-probe";

describe("probeFailure", () => {
  it("uses an attempt for a recording the server refuses, so three refusals end the ingest", () => {
    const refused = probeFailure(new RecordingReadError("recording read failed (404)", true));
    expect(refused).not.toBeInstanceOf(TransientError);
    expect(refused.message).toContain("404");
  });

  it("retries an outage, a rate limit, a timeout or a lost connection without an attempt", () => {
    for (const error of [
      new RecordingReadError("recording read failed (503)", false),
      new RecordingReadError("recording read failed (429)", false),
      new DOMException("The operation was aborted due to timeout", "TimeoutError"),
      new TypeError("fetch failed"),
    ]) {
      expect(probeFailure(error), String(error)).toBeInstanceOf(TransientError);
    }
  });
});
