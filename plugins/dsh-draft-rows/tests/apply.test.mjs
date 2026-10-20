import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";

function makeLocalStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    get length() { return map.size; },
    key(index) { return Array.from(map.keys())[index] ?? null; },
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); }
  };
}

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

function loadBundle() {
  let captured;
  const sandbox = {
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
  sandbox.window = { __ModuleLoader__: { load: ({ factory }) => { captured = factory; } } };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(new URL("../lib/client.js", import.meta.url), "utf8"), sandbox);
  return { bundle: captured(() => {}), sandbox };
}

const { bundle, sandbox } = loadBundle();

function makeHarness({ drafts = {}, workspaceSessionIds = ["a"], sessionOverrides = {}, current = "a", view = undefined, viewState = undefined } = {}) {
  const creates = [];
  const sessions = {
    create: undefined,
    list: undefined
  };
  const stockState = {
    phase: "ready",
    current,
    ids: workspaceSessionIds,
    byId: Object.fromEntries(workspaceSessionIds.map((id) => [id, summary(id, sessionOverrides[id] ?? {})]))
  };
  const store = {
    getSnapshot: () => stockState,
    subscribe: () => () => {},
    set: () => {}
  };
  sessions.list = store;
  sessions.create = async (request) => {
    creates.push(request);
    return request.sessionId ?? "minted";
  };
  sessions.scope = () => undefined;

  const workspaces = {
    list: {
      getSnapshot: () => ({
        phase: "ready",
        items: [{ workspaceId: "w", path: "/w", title: "W", sessionIds: workspaceSessionIds }],
        archivedSessionIds: []
      }),
      subscribe: () => () => {}
    }
  };

  const opened = [];
  const stockStarts = [];
  const uiWorkspace = {
    startSession: (...args) => { stockStarts.push(args); },
    openSession: (id) => { opened.push(id); }
  };
  if (view !== undefined) uiWorkspace.view = view;

  const cleanups = [];
  const ctx = {
    effect: (fn) => {
      const off = fn();
      if (typeof off === "function") cleanups.push(off);
      return off;
    },
    locale: {
      register: () => {},
      bind: () => (key) => ({
        newSession: "新会话",
        draftPrefix: "草稿｜",
        attachment: "[附件]"
      })[key]
    },
    sessions,
    workspaces,
    conversation: { input: { for: () => { throw new Error("not staged"); } } },
    uiWorkspace
  };

  const previousLocalStorage = sandbox.localStorage;
  const entries = { ...drafts };
  if (viewState !== undefined) entries["dsh.workspace.view.v5"] = JSON.stringify(viewState);
  sandbox.localStorage = makeLocalStorage(entries);

  bundle.apply(ctx);

  return {
    sessions,
    creates,
    uiWorkspace,
    opened,
    stockStarts,
    cleanup: () => {
      for (const off of cleanups.splice(0)) {
        try { off(); } catch { /* ignore */ }
      }
      if (previousLocalStorage === undefined) delete sandbox.localStorage;
      else sandbox.localStorage = previousLocalStorage;
    }
  };
}

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

test("New Session reuses the workspace's empty draft", async () => {
  const harness = makeHarness();
  harness.uiWorkspace.startSession();
  await tick();
  assert.equal(JSON.stringify(harness.creates), JSON.stringify([{ workspaceId: "w", sessionId: "a" }]));
  assert.equal(JSON.stringify(harness.opened), JSON.stringify(["a"]));
  harness.cleanup();
});

test("New Session mints when the draft already has text", async () => {
  const harness = makeHarness({ drafts: { "dsh.conversation.a": JSON.stringify({ draft: { text: "hello" }, references: [] }) } });
  harness.uiWorkspace.startSession();
  await tick();
  assert.equal(JSON.stringify(harness.creates), JSON.stringify([{ workspaceId: "w" }]));
  assert.equal(JSON.stringify(harness.opened), JSON.stringify(["minted"]));
  harness.cleanup();
});

test("single mode reuses a typed draft", async () => {
  const harness = makeHarness({
    drafts: {
      "dsh.drafts.mode": "single",
      "dsh.conversation.a": JSON.stringify({ draft: { text: "hello" }, references: [] })
    }
  });
  harness.uiWorkspace.startSession();
  await tick();
  assert.equal(JSON.stringify(harness.creates), JSON.stringify([{ workspaceId: "w", sessionId: "a" }]));
  harness.cleanup();
});

test("options-bearing startSession stays stock", async () => {
  const harness = makeHarness();
  harness.uiWorkspace.startSession(undefined, { agentPreset: "standard" });
  await tick();
  assert.equal(harness.creates.length, 0);
  assert.equal(harness.stockStarts.length, 1);
  harness.cleanup();
});

test("the visible list collapses extra empty drafts to the current one", () => {
  const harness = makeHarness({
    workspaceSessionIds: ["a", "b", "c"],
    current: "c",
    sessionOverrides: {
      a: { updatedAt: 1 },
      b: { updatedAt: 2 },
      c: { updatedAt: 0 }
    }
  });
  const snapshot = harness.sessions.list.getSnapshot();
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot.ids)), ["c"]);
  assert.equal(snapshot.byId.a, undefined);
  assert.equal(snapshot.byId.b, undefined);
  assert.equal(snapshot.byId.c.title, "新会话");
  harness.cleanup();
});

test("typed drafts stay while the stock list order is preserved", async () => {
  const harness = makeHarness({
    drafts: { "dsh.conversation.a": JSON.stringify({ draft: { text: "hello" }, references: [] }) },
    workspaceSessionIds: ["a", "b", "c"],
    current: "c",
    sessionOverrides: {
      a: { updatedAt: 1 },
      b: { updatedAt: 2 },
      c: { updatedAt: 0 }
    }
  });
  const snapshot = harness.sessions.list.getSnapshot();
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot.ids)), ["a", "c"], "the stock ids order survives projection");
  assert.equal(snapshot.byId.c.title, "新会话");
  assert.equal(snapshot.byId.a.title, "草稿｜hello");
  assert.equal(snapshot.byId.b, undefined);

  harness.uiWorkspace.startSession();
  await tick();
  assert.equal(JSON.stringify(harness.creates), JSON.stringify([{ workspaceId: "w", sessionId: "c" }]), "New Session reuses the visible empty draft");
  harness.cleanup();
});

test("manual order leads a new Session through the stock view action", async () => {
  const orders = [];
  const harness = makeHarness({
    workspaceSessionIds: ["a", "b"],
    current: "a",
    sessionOverrides: {
      a: { updatedAt: 1 },
      b: { blank: false, updatedAt: 2 }
    },
    view: { syncSessionOrders: (value) => orders.push(value) },
    viewState: {
      orderBy: "manual",
      sessionOrderByAccount: { w: ["a"] }
    }
  });
  await tick(200);
  assert.equal(orders.length, 1, "the saved order is repaired once");
  assert.equal(JSON.stringify(orders[0].w), JSON.stringify(["a", "b"]), "the draft stays first and the new ordinary Session follows");
  harness.cleanup();
});

test("updated order never writes the saved manual order", async () => {
  const orders = [];
  const harness = makeHarness({
    workspaceSessionIds: ["a", "b"],
    current: "a",
    sessionOverrides: {
      a: { updatedAt: 1 },
      b: { blank: false, updatedAt: 2 }
    },
    view: { syncSessionOrders: (value) => orders.push(value) },
    viewState: {
      orderBy: "updated",
      sessionOrderByAccount: { w: ["a"] }
    }
  });
  await tick(200);
  assert.equal(orders.length, 0, "recent-update mode is left to the stock recency sort");
  harness.cleanup();
});
