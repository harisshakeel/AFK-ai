import { describe, expect, it } from "vitest";

import { RefusedError, TransientError, probeFailure, transcriptRejection } from "./jobs";
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

describe("transcriptRejection", () => {
  it("ends the ingest at once when the database refuses the transcript, so it is not paid for again", () => {
    // A check (a turn past the duration), bad input, or a raised exception: the same
    // transcript would be refused the same way on every retry.
    for (const code of ["23514", "22023", "P0001"]) {
      const error = transcriptRejection({ code, message: "turn ends past the duration" });
      expect(error, code).toBeInstanceOf(RefusedError);
      expect(error.message).toContain("transcript was rejected");
    }
  });

  it("uses an attempt when the store broke for a reason a retry can mend", () => {
    for (const code of ["57014", "40001", ""]) {
      const error = transcriptRejection({ code, message: "canceling statement" });
      expect(error, code).not.toBeInstanceOf(RefusedError);
      expect(error, code).not.toBeInstanceOf(TransientError);
    }
  });
});
