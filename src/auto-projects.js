// aia-projects: cmux 项目式侧栏，按本机目录组织工作区并保留完整会话列表。
// Fork: https://github.com/djejjd/AIAgentCLI
// Upstream: https://github.com/s4ff0x/cmux-sidebar
// Based on cmux Examples/CustomSidebars/workspaces.js, Copyright Manaflow, Inc.
// SPDX-License-Identifier: GPL-3.0-or-later

// 按当前窗口的本机目录规划原生分组；不关闭工作区，不读取对话正文。
function projectDirectory(w) {
  if (w.remote?.target) return "";
  const path = String(w.directory ?? "").trim();
  if (!path.startsWith("/") && !path.startsWith("~/")) return "";
  const parts = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { if (parts.length && parts.at(-1) !== "~") parts.pop(); }
    else parts.push(part);
  }
  return (path.startsWith("/") ? "/" : "") + parts.join("/");
}

// 目录同名也不合并；标题加父目录消歧，完整路径仅用于内部身份。
function projectBuckets(ws) {
  const buckets = new Map();
  for (const w of ws) {
    const path = projectDirectory(w);
    if (!path) continue;
    if (!buckets.has(path)) buckets.set(path, { path, members: [] });
    buckets.get(path).members.push(w);
  }
  for (const b of buckets.values()) {
    const base = b.path.split("/").at(-1) || "根目录";
    const same = [...buckets.keys()].filter((p) => (p.split("/").at(-1) || "根目录") === base);
    const parent = b.path.split("/").slice(0, -1).filter(Boolean).join(" › ");
    b.name = same.length > 1 ? base + " · " + (parent || "根目录") : base;
  }
  return [...buckets.values()];
}

// 一次只发送一条原生命令，后续操作等待宿主数据确认；混合目录组不能成为目标。
function planProjectActions(ws, groups) {
  const byGroup = new Map(groups.map((g) => [g.id, g]));
  if (ws.some((w) => w.group && !byGroup.has(w.group))) return [];
  return projectBuckets(ws).flatMap((b) => {
    const groupIds = [...new Set(b.members.map((w) => w.group).filter(Boolean))];
    const target = groupIds.find((id) => ws.filter((w) => w.group === id).every((w) => projectDirectory(w) === b.path));
    const ids = b.members.map((w) => w.id);
    if (!target) return [{ stage: "创建分组", path: b.path, ids,
      method: "workspace.group.create", params: { name: b.name, child_workspace_ids: JSON.stringify(ids),
        idempotency_key: "aia-projects:" + ids[0] + ":" + b.path } }];
    const outside = b.members.filter((w) => w.group !== target);
    if (outside.length) return outside.map((w) => ({ stage: "加入项目", path: b.path, ids: [w.id],
      method: "workspace.group.add", params: { group_id: target, workspace_id: w.id } }));
    return byGroup.get(target).name === b.name ? [] : [{ stage: "命名项目", path: b.path, ids,
      method: "workspace.group.rename", params: { group_id: target, name: b.name } }];
  });
}

// 判断宿主是否真的完成请求，避免把已发送当作已完成。
function projectActionDone(a, ws, groups) {
  const members = a.ids.map((id) => ws.find((w) => w.id === id));
  if (a.method === "workspace.group.rename") return groups.some((g) => g.id === a.params.group_id && g.name === a.params.name);
  if (a.method === "workspace.group.add") return members[0]?.group === a.params.group_id;
  const id = members[0]?.group;
  return !!id && members.every((w) => w?.group === id) && groups.some((g) => g.id === id);
}

// 状态机无计时器或后台句柄。等待失败后只允许显式重试，不每秒重发。
function createProjectReconciler(send) {
  let pending = null;
  let failure = "";
  const blocked = new Set();
  const signature = (a) => JSON.stringify([a.path, a.method, a.params]);
  return {
    tick(ws, groups, now) {
      if (pending) {
        const obsolete = pending.ids.some((id) => projectDirectory(ws.find((w) => w.id === id) ?? {}) !== pending.path);
        if (obsolete || projectActionDone(pending, ws, groups)) pending = null;
        else if (now - pending.started >= 15) {
          failure = pending.stage;
          blocked.add(signature(pending));
          pending = null;
        } else return { state: "waiting", failure };
      }
      const next = planProjectActions(ws, groups).find((a) => !blocked.has(signature(a)));
      if (next) {
        pending = { ...next, started: now };
        try { send(next.method, next.params); }
        catch {
          failure = next.stage;
          blocked.add(signature(next));
          pending = null;
        }
      }
      if (!planProjectActions(ws, groups).length) { blocked.clear(); failure = ""; }
      return { state: pending ? "waiting" : failure ? "failed" : "idle", failure };
    },
    retry() { pending = null; failure = ""; blocked.clear(); },
  };
}
