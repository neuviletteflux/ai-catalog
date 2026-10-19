import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";

/** Load the browser bundle and capture the module factory. */
function loadBundle() {
  let captured;
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load: ({ id, factory }) => {
          captured = { id, factory };
        }
      }
    },
    console,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    Map,
    Set,
    Date,
    JSON,
    Object,
    Array,
    String,
    Number,
    Symbol,
    Promise
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(new URL("../lib/client.js", import.meta.url), "utf8"), sandbox);
  assert.ok(captured, "bundle called __ModuleLoader__.load");
  assert.equal(captured.id, "dsh-draft-rows");
  const exports = captured.factory(() => {});
  assert.equal(typeof exports.apply, "function");
  assert.equal(exports.inject.join(","), "sessions,workspaces,conversation,locale,uiWorkspace");
  return exports;
}

const bundle = loadBundle();
const { previewOf, isDraft, mainSessionIdOf, findReusableDraft, planDraftRows, projectDraftList } = bundle.__test;

function summary(id, overrides = {}) {
  return {
    id,
    origin: "main",
    blank: true,
    cwd: "/w",
    updatedAt: 1,
    ...overrides
  };
}

function list(ids, byId, extra = {}) {
  return { phase: "ready", ids, byId, ...extra };
}

test("previewOf collapses whitespace and caps length", () => {
  assert.equal(previewOf(""), undefined);
  assert.equal(previewOf("  \n\t "), undefined);
  assert.equal(previewOf("  hello   world  "), "hello world");
  const long = "a".repeat(80);
  assert.equal(previewOf(long).length, 61); // 60 + ellipsis
  assert.ok(previewOf(long).endsWith("…"));
});

test("isDraft accepts placeholders and host metadata, rejects subagents and sent sessions", () => {
  assert.equal(isDraft(summary("a")), true);
  assert.equal(isDraft(summary("b", {
    blank: false,
    projectionValues: { sessionListMetadata: { blank: true } }
  })), true);
  assert.equal(isDraft(summary("c", {
    blank: false,
    projectionValues: { sessionListMetadata: { blank: false } }
  })), false);
  assert.equal(isDraft(summary("d", { origin: "subagent" })), false);
  assert.equal(isDraft(undefined), false);
});

test("mainSessionIdOf follows retainedBy.mainView", () => {
  const a = summary("a", { retainedBy: { mainView: 0 } });
  const b = summary("b", { retainedBy: { mainView: 1 } });
  assert.equal(mainSessionIdOf(list(["a", "b"], { a, b })), "b");
});

test("projectDraftList turns drafts into titled ordinary rows and leaves stock intact", () => {
  const a = summary("a", { updatedAt: 1 });
  const b = summary("b", { blank: false, updatedAt: 2, projectionValues: { sessionListMetadata: { blank: true } } });
  const c = summary("c", { blank: false, updatedAt: 3, projectionValues: { sessionListMetadata: { blank: false } } });
  const d = summary("d", { origin: "subagent", updatedAt: 4 });
  const stock = list(["a", "b", "c", "d"], { a, b, c, d }, { current: "a" });
  const previews = new Map([["a", "hello"], ["b", "world"]]);

  const projected = projectDraftList(stock, previews, "新会话", new Set(), "草稿｜");
  assert.notEqual(projected, stock);
  assert.equal(projected.byId.a.blank, false);
  assert.equal(projected.byId.a.title, "草稿｜hello");
  assert.equal(projected.byId.b.title, "草稿｜world");
  assert.equal(projected.byId.c, c, "sent sessions keep object identity");
  assert.equal(projected.byId.d, d, "subagents keep object identity");
  assert.equal(projected.ids, stock.ids);
  assert.equal(stock.byId.a.blank, true, "stock snapshot is not mutated");

  const empty = projectDraftList(stock, new Map([["a", undefined], ["b", "world"]]), "新会话", new Set(), "草稿｜");
  assert.equal(empty.byId.a.title, "新会话");
  assert.equal(empty.byId.b.title, "草稿｜world");

  const archived = projectDraftList(stock, previews, "新会话", new Set(["a"]), "草稿｜");
  assert.equal(archived.byId.a, a, "archived drafts stay stock");
  assert.equal(archived.byId.b.title, "草稿｜world");

  const hidden = projectDraftList(stock, previews, "新会话", new Set(), "草稿｜", new Set(["a"]));
  assert.equal(hidden.byId.a, undefined, "hidden drafts leave byId");
  assert.deepEqual(Array.from(hidden.ids), ["b", "c", "d"], "hidden drafts leave ids");
  assert.equal(hidden.byId.b.title, "草稿｜world");

  const noDrafts = list(["c"], { c });
  assert.equal(projectDraftList(noDrafts, previews, "新会话", new Set(), "草稿｜"), noDrafts, "no drafts returns the stock snapshot untouched");
});

test("planDraftRows keeps one empty draft per workspace and every typed draft", () => {
  const ids = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
  const byId = {
    a: summary("a", { updatedAt: 1 }), // typed, w1
    b: summary("b", { updatedAt: 2 }), // empty, current, w1
    c: summary("c", { updatedAt: 3 }), // empty, w1 -> hidden
    d: summary("d", { blank: false, updatedAt: 4 }), // sent, w1
    e: summary("e", { updatedAt: 5 }), // archived empty, w1
    f: summary("f", { updatedAt: 1 }), // empty, w2 -> hidden
    g: summary("g", { updatedAt: 6 }), // empty, w2 -> canonical
    h: summary("h", { updatedAt: 1 }), // empty, ungrouped -> hidden
    i: summary("i", { updatedAt: 7 }) // empty, ungrouped -> canonical
  };
  const stock = list(ids, byId, { current: "b" });
  const workspaces = {
    items: [
      { workspaceId: "w1", sessionIds: ["a", "b", "c", "d", "e"] },
      { workspaceId: "w2", sessionIds: ["f", "g"] }
    ]
  };
  const previews = new Map([["a", "typed a"]]);
  const archived = new Set(["e"]);

  const plan = planDraftRows(stock, workspaces, previews, archived, "b");
  assert.deepEqual(Array.from(plan.hidden).sort(), ["c", "f", "h"], "extra empty drafts collapse");
  assert.deepEqual(Array.from(plan.canonical).sort(), ["b", "g", "i"], "one empty draft per bucket");
  assert.deepEqual(Array.from(plan.visible).sort(), ["a", "b", "g", "i"], "typed drafts and one empty per bucket stay");
  assert.ok(plan.ordered.indexOf("b") < plan.ordered.indexOf("a"), "the New Session row leads typed drafts in its workspace");
  assert.ok(!plan.ordered.includes("c"), "hidden drafts never enter the row order");

  const noCurrent = planDraftRows(stock, workspaces, previews, archived, "d");
  assert.ok(noCurrent.canonical.has("c"), "without an empty current draft the newest empty is canonical");
  assert.ok(!noCurrent.canonical.has("b"), "the older empty draft stays collapsed");
});

test("findReusableDraft: multi skips occupied drafts, single reuses the blank", () => {
  const a = summary("a", { updatedAt: 1 });
  const b = summary("b", { updatedAt: 2 });
  const stock = list(["a", "b"], { a, b });
  const workspace = {
    items: [{ workspaceId: "w", path: "/w", sessionIds: ["a", "b"] }],
    archivedSessionIds: []
  };
  const previews = new Map([["a", "typed"]]);

  const multi = findReusableDraft(stock, workspace, previews, "w", "multi");
  assert.equal(multi.id, "b", "multi reuses the empty draft");

  const multiAllOccupied = findReusableDraft(stock, workspace, new Map([["a", "x"], ["b", "y"]]), "w", "multi");
  assert.equal(multiAllOccupied, undefined, "multi mints when every draft is occupied");

  const singleWorkspace = { ...workspace, items: [{ ...workspace.items[0], sessionIds: ["a"] }] };
  const single = findReusableDraft(stock, singleWorkspace, previews, "w", "single");
  assert.equal(single.id, "a", "single reuses a typed draft");

  const singlePreferred = findReusableDraft(stock, workspace, previews, "w", "single", "a");
  assert.equal(singlePreferred.id, "a", "single prefers the current draft over a newer empty one");

  const multiPreferred = findReusableDraft(
    list(["a", "b"], { a: summary("a", { updatedAt: 1 }), b: summary("b", { updatedAt: 5 }) }),
    workspace,
    new Map(),
    "w",
    "multi",
    "a"
  );
  assert.equal(multiPreferred.id, "a", "multi reuses the visible empty draft even when another blank is newer");

  const otherCwd = { ...workspace, items: [{ ...workspace.items[0], path: "/other" }] };
  assert.equal(findReusableDraft(stock, otherCwd, previews, "w", "multi"), undefined);
});
