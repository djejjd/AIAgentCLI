import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildModelMap,
  displayModelName,
  extractModel,
  injectModelMap,
  providerForModel,
} from "../scripts/model-map.js";

describe("model map", () => {
  test("extracts the model from Codex resume commands", () => {
    assert.equal(
      extractModel("codex resume abc -c check_for_update_on_startup=false -m deepseek-flash -a never"),
      "deepseek-flash",
    );
    assert.equal(extractModel("codex resume abc --model 'gpt-6.1-sol'"), "gpt-6.1-sol");
  });

  test("maps model families to display names and providers", () => {
    assert.deepEqual(
      ["deepseek-flash", "gpt-6.1-sol", "claude-sonnet-4.5", "gemini-3-pro"].map((model) => [
        displayModelName(model),
        providerForModel(model),
      ]),
      [
        ["DeepSeek Flash", "deepseek"],
        ["GPT-6.1 Sol", "openai"],
        ["Claude Sonnet 4.5", "anthropic"],
        ["Gemini 3 Pro", "google"],
      ],
    );
  });

  test("builds a map keyed by agent session id", () => {
    assert.deepEqual(buildModelMap([
      { agent: "codex", session_id: "s1", resume_command: "codex resume s1 -m deepseek-flash" },
      { agent: "claude", session_id: "s2", resume_command: "claude --resume s2" },
    ]), {
      s1: { model: "deepseek-flash", provider: "deepseek", name: "DeepSeek Flash" },
    });
  });

  test("injects the map into the generated sidebar source", () => {
    const source = "const GENERATED_MODEL_MAP = {};";
    const output = injectModelMap(source, {
      s1: { model: "deepseek-flash", provider: "deepseek", name: "DeepSeek Flash" },
    });
    assert.match(output, /"s1"/);
    assert.match(output, /DeepSeek Flash/);
  });
});
