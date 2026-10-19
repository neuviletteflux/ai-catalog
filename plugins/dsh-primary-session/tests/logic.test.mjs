import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const bundle = fs.readFileSync(path.join(import.meta.dirname, "..", "lib", "client.js"), "utf8");

function loadBundle() {
  let definition;
  const sandbox = {
    window: { __ModuleLoader__: { load: (value) => { definition = value; } } },
    console,
    Symbol,
    Object,
    Promise,
    Set,
    Map,
    Array,
    Error,
    String
  };
  vm.createContext(sandbox);
  vm.runInContext(bundle, sandbox);
  const requireStub = (name) => {
    if (name === "react") {
      return { createElement: (type, props, ...children) => ({ type, props: { ...(props ?? {}), children } }) };
    }
    if (name === "@deepseek-ai/dsh-client-ui-primitives") {
      return {
        MenuItemButton: "MenuItemButton",
        IconPinFillRegular: "IconPinFillRegular",
        IconPinOutlineRegular: "IconPinOutlineRegular"
      };
    }
    throw new Error(`unexpected require: ${name}`);
  };
  return definition.factory(requireStub);
}

function fakeModel({ items, pinned }) {
  const state = { items, pinnedSessionIds: [...pinned], archivedSessionIds: [] };
  const calls = [];
  const model = {
    list: {
      getSnapshot: () => ({ ...state, items: state.items }),
      subscribe: () => () => {}
    },
    async unpinSession(id) {
      calls.push(["unpin", id]);
      state.pinnedSessionIds = state.pinnedSessionIds.filter((x) => x !== id);
    },
    async pinSession(id) {
      calls.push(["pin", id]);
      state.pinnedSessionIds = [id, ...state.pinnedSessionIds.filter((x) => x !== id)];
    }
  };
  return { model, state, calls };
}

test("promoting a workspace row unpins its pinned siblings first", async () => {
  const mod = loadBundle();
  const { model, state, calls } = fakeModel({
    items: [{ workspaceId: "w1", sessionIds: ["a", "b", "c"] }],
    pinned: ["b"]
  });
  await mod.__test.setPrimary(model, "a");
  assert.deepEqual(calls, [["unpin", "b"], ["pin", "a"]]);
  assert.deepEqual(state.pinnedSessionIds, ["a"]);
});

test("promoting a row with no pinned siblings only pins", async () => {
  const mod = loadBundle();
  const { model, calls } = fakeModel({
    items: [{ workspaceId: "w1", sessionIds: ["a", "b"] }],
    pinned: ["x"]
  });
  await mod.__test.setPrimary(model, "a");
  assert.deepEqual(calls, [["pin", "a"]]);
});

test("ungrouped bucket only releases ungrouped pins", async () => {
  const mod = loadBundle();
  const { model, state, calls } = fakeModel({
    items: [{ workspaceId: "w1", sessionIds: ["a"] }],
    pinned: ["x", "y"]
  });
  await mod.__test.setPrimary(model, "x");
  assert.deepEqual(calls, [["unpin", "y"], ["pin", "x"]]);
  assert.deepEqual(state.pinnedSessionIds, ["x"]);
});

test("clear primary only releases the target", async () => {
  const mod = loadBundle();
  const { model, state, calls } = fakeModel({
    items: [{ workspaceId: "w1", sessionIds: ["a", "b"] }],
    pinned: ["a", "b"]
  });
  await mod.__test.clearPrimary(model, "a");
  assert.deepEqual(calls, [["unpin", "a"]]);
  assert.deepEqual(state.pinnedSessionIds, ["b"]);
});

test("a sibling unpin failure still attempts the final pin and reports", async () => {
  const mod = loadBundle();
  const { model, calls } = fakeModel({
    items: [{ workspaceId: "w1", sessionIds: ["a", "b"] }],
    pinned: ["b"]
  });
  model.unpinSession = async (id) => {
    calls.push(["unpin", id]);
    throw new Error("gone");
  };
  await assert.rejects(mod.__test.setPrimary(model, "a"), /unpin b: gone/);
  assert.deepEqual(calls, [["unpin", "b"], ["pin", "a"]]);
});

test("primaryPlan keeps workspace buckets apart", () => {
  const mod = loadBundle();
  const snapshot = {
    items: [
      { workspaceId: "w1", sessionIds: ["a", "b"] },
      { workspaceId: "w2", sessionIds: ["c"] }
    ],
    pinnedSessionIds: ["b", "c"],
    archivedSessionIds: []
  };
  assert.deepEqual(
    JSON.parse(JSON.stringify(mod.__test.primaryPlan(snapshot, "a"))),
    { pinned: false, siblings: ["b"] }
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(mod.__test.primaryPlan(snapshot, "c"))),
    { pinned: true, siblings: [] }
  );
});
