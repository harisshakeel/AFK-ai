import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { commandParseSchema } from "../commands/ai-schema";
import { answerSchema } from "../commands/answer";
import { learnSchema } from "../memory/learn";
import {
  analysisModelSchema,
  analysisSchema,
  summariesModelSchema,
  summariesSchema,
} from "../summaries/ai-output-schema";
import { ClaudeTimeoutError, classifyClaudeError, estimateCostUsd } from "./claude";
import { romanizedSchema } from "./romanize";

describe("estimateCostUsd", () => {
  const usage = {
    inputTokens: 1_000_000,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };

  it("prices the dated model id the API answers with, like the plain one", () => {
    expect(estimateCostUsd("claude-haiku-4-5", usage)).toBe(1);
    expect(estimateCostUsd("claude-haiku-4-5-20251001", usage)).toBe(1);
  });

  it("is null for a model it has no price for, never a guess", () => {
    expect(estimateCostUsd("claude-haiku-4-5-fast", { ...usage })).toBeNull();
    expect(estimateCostUsd("some-other-model", usage)).toBeNull();
  });
});

describe("classifyClaudeError", () => {
  it("tells a timeout apart from an unreachable Claude", () => {
    expect(classifyClaudeError(new Anthropic.APIConnectionTimeoutError())).toBeInstanceOf(
      ClaudeTimeoutError,
    );
    const unreachable = classifyClaudeError(new Anthropic.APIConnectionError({ message: "down" }));
    expect(unreachable).not.toBeInstanceOf(ClaudeTimeoutError);
    expect(unreachable.name).toBe("ProviderUnavailableError");
  });

  it("never carries the model's output in the message it gives the job", () => {
    const parse = new Anthropic.AnthropicError(
      'Failed to parse structured output: SyntaxError: Unexpected token in JSON at "Sam is on a PIP"',
    );
    const classified = classifyClaudeError(parse);
    expect(classified.message).not.toContain("PIP");
    expect(classified.name).toBe("ClaudeRunError");
  });
});

describe("the schemas sent to Claude", () => {
  const sent = {
    commandParseSchema,
    answerSchema,
    learnSchema,
    analysisModelSchema,
    summariesModelSchema,
    romanizedSchema,
  };

  it("carry no hard limit, which the SDK would check only after the call is paid for", () => {
    for (const [name, schema] of Object.entries(sent)) {
      const json = JSON.stringify(zodOutputFormat(schema).schema);
      expect(json, name).not.toMatch(/"(maxItems|maxLength|maximum|exclusiveMaximum)"/);
      expect(JSON.stringify(z.toJSONSchema(schema)), name).not.toMatch(
        /"(maxItems|maxLength|maximum|exclusiveMaximum)"/,
      );
    }
  });

  it("each converts to the API's output format, so no job fails on its schema alone", () => {
    const schemas = { ...sent, analysisSchema, summariesSchema };
    for (const [name, schema] of Object.entries(schemas)) {
      const format = zodOutputFormat(schema);
      expect(format.type, name).toBe("json_schema");
      expect(format.schema, name).toMatchObject({ type: "object" });
    }
  });
});
