import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { agent, group, mountSidebar, workspaces } from "./harness.js";

const SOURCE_PATH = new URL("../src/aia-projects.js", import.meta.url);
const mountAiaProjects = (state, settings = {}) =>
  mountSidebar(state, settings, { sourcePath: SOURCE_PATH });

describe("project grouping", () => {
  test("creates project groups from workspaces sharing a directory", () => {
    const sb = mountAiaProjects({
      workspaces: workspaces(
        { id: "w1", title: "one", directory: "/Users/me/Code/Alpha" },
        { id: "w2", title: "two", directory: "/Users/me/Code/Alpha" },
        { id: "w3", title: "three", directory: "/Users/me/Code/Beta" },
      ),
    });

    assert.deepEqual(sb.take(), [
      {
        method: "workspace.group.create",
        params: {
          name: "Alpha",
          child_workspace_ids: JSON.stringify(["w1", "w2"]),
          idempotency_key: "aia-projects:w1:/Users/me/Code/Alpha",
        },
      },
    ]);

    sb.setData({
      groups: [group("g-alpha", "Alpha", "w1")],
      workspaces: workspaces(
        { id: "w1", title: "one", directory: "/Users/me/Code/Alpha", group: "g-alpha" },
        { id: "w2", title: "two", directory: "/Users/me/Code/Alpha", group: "g-alpha" },
        { id: "w3", title: "three", directory: "/Users/me/Code/Beta" },
      ),
    });

    assert.deepEqual(sb.take(), [
      {
        method: "workspace.group.create",
        params: {
          name: "Beta",
          child_workspace_ids: JSON.stringify(["w3"]),
          idempotency_key: "aia-projects:w3:/Users/me/Code/Beta",
        },
      },
    ]);
  });

  test("a request that never echoes reports its stage and waits for an explicit retry", () => {
    const state = (now) => ({
      now,
      workspaces: workspaces(
        { id: "w1", title: "one", directory: "/Users/me/Code/Alpha" },
        { id: "w2", title: "two", directory: "/Users/me/Code/Alpha" },
      ),
    });
    const sb = mountAiaProjects(state(0));
    sb.take();

    sb.setData(state(16));

    assert.equal(sb.outline().includes("项目归组未完成（创建分组）"), true);

    sb.setData(state(17));
    assert.deepEqual(sb.take(), []);

    sb.tapButton("重试归组");
    assert.deepEqual(sb.take(), [
      {
        method: "workspace.group.create",
        params: {
          name: "Alpha",
          child_workspace_ids: JSON.stringify(["w1", "w2"]),
          idempotency_key: "aia-projects:w1:/Users/me/Code/Alpha",
        },
      },
    ]);
  });
});

describe("Active project folding", () => {
  const project = (collapsed = false) => ({
    groups: [group("g1", "Project", "w1", { collapsed })],
    workspaces: workspaces(
      { id: "w1", title: "running", group: "g1", agents: [agent("working")] },
      { id: "w2", title: "idle", group: "g1", agents: [agent("idle")] },
      { id: "w3", title: "shell", group: "g1" },
    ),
  });

  test("enabling Active expands the project without hiding idle sessions", () => {
    const sb = mountAiaProjects(project(true), { autoProjectGroups: false });

    sb.chip("Active").tap();

    assert.equal(sb.outline().length, 4);
    assert.ok(sb.row("running"));
    assert.ok(sb.row("idle"));
    assert.ok(sb.row("shell"));
    assert.deepEqual(sb.take(), [
      { method: "workspace.group.expand", params: { group_id: "g1" } },
    ]);
  });

  test("disabling Active folds every active project and preserves its rows", () => {
    const sb = mountAiaProjects(project(false), { autoProjectGroups: false });

    sb.chip("Active").tap();
    assert.ok(sb.row("running"));
    assert.ok(sb.row("idle"));
    assert.ok(sb.row("shell"));
    sb.take();

    sb.chip("Active").tap();
    assert.ok(sb.row("running"));
    assert.throws(() => sb.row("idle"));
    assert.throws(() => sb.row("shell"));
    assert.deepEqual(sb.take(), [
      { method: "workspace.group.collapse", params: { group_id: "g1" } },
    ]);

    sb.row("Project").tap();
    assert.ok(sb.row("running"));
    assert.ok(sb.row("idle"));
    assert.ok(sb.row("shell"));
  });
});

describe("favorite controls", () => {
  test("the row menu hides Favorite and Unfavorite when disabled", () => {
    const sb = mountAiaProjects({
      workspaces: workspaces({ id: "w1", title: "plain" }),
    }, { autoProjectGroups: false });

    const labels = sb.row("plain").menuLabels();
    assert.equal(labels.includes("Favorite"), false);
    assert.equal(labels.includes("Unfavorite"), false);
  });
});

describe("conversation status", () => {
  const statusState = (status, extra = {}) => ({
    workspaces: workspaces({
      id: "w1",
      title: "chat",
      latestAt: 90,
      agents: [agent(status, { kind: "codex", name: "Codex", lastActivityAt: 90, ...extra })],
    }),
  });

  test("Running and Ready use different shapes and colors", () => {
    for (const [status, label, color, type] of [
      ["working", "Running", "#FF8A00", "circle"],
      ["needs_input", "Ready", "#30D158", "roundedRectangle"],
      ["idle", "Ready", "#30D158", "roundedRectangle"],
      ["ended", "Ready", "#30D158", "roundedRectangle"],
    ]) {
      const sb = mountAiaProjects(statusState(status), { autoProjectGroups: false });
      const row = sb.row("Codex");
      assert.ok(row.texts.includes(label));
      assert.equal(row.textColor(label), color);
      assert.deepEqual(row.marker(), { type, color });
    }
  });

  test("Ready keeps its green shape after time passes", () => {
    const state = statusState("idle");
    state.now = 100;
    const sb = mountAiaProjects(state, { autoProjectGroups: false });
    state.now = 100 + 2 * 60 * 60;
    sb.setData(state);
    const row = sb.row("Codex");
    assert.ok(row.texts.includes("Ready"));
    assert.equal(row.textColor("Ready"), "#30D158");
    assert.deepEqual(row.marker(), { type: "roundedRectangle", color: "#30D158" });
  });

  test("Ready remains when agent records are pruned but conversation history remains", () => {
    const state = statusState("idle");
    const sb = mountAiaProjects(state, { autoProjectGroups: false });
    state.workspaces[0].agents = [];
    sb.setData(state);
    const row = sb.row("chat");
    assert.ok(row.texts.includes("Ready"));
    assert.equal(row.textColor("Ready"), "#30D158");
    assert.deepEqual(row.marker(), { type: "roundedRectangle", color: "#30D158" });
  });

  test("an older unbound working record cannot override a newer bound idle record", () => {
    const state = statusState("idle", { surfaceId: "s-current" });
    state.now = 100;
    state.workspaces[0].agents.push(
      agent("working", { kind: "codex", name: "Codex", lastActivityAt: 80 }),
    );
    const sb = mountAiaProjects(state, { autoProjectGroups: false });
    assert.ok(sb.row("Codex").texts.includes("Ready"));
  });
});

describe("sidebar readability", () => {
  const state = () => ({
    groups: [group("g1", "Project", "w1")],
    workspaces: workspaces({
      id: "w1",
      title: "running",
      description: "project task",
      group: "g1",
      agents: [agent("working")],
    }),
  });

  test("project and agent text use the larger sidebar scale", () => {
    const sb = mountAiaProjects(state(), { autoProjectGroups: false });
    const row = sb.row("Claude Code");

    assert.equal(sb.row("Project").fontSize("Project"), 14);
    assert.equal(row.fontSize("Claude Code"), 13);
    assert.equal(row.fontSize("Running"), 11.5);
    assert.equal(row.fontSize("project task"), 11.5);
    assert.equal(sb.chip("Active").fontSize(), 13);
  });
});
