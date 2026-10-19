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

function fakeCtx(state, calls) {
  const model = {
    list: {
      getSnapshot: () => ({ ...state, items: state.items }),
      subscribe: () => () => {}
    },
    async pinSession(id) {
      calls.push(["pin", id]);
      state.pinnedSessionIds = [id, ...state.pinnedSessionIds.filter((x) => x !== id)];
    },
    async unpinSession(id) {
      calls.push(["unpin", id]);
      state.pinnedSessionIds = state.pinnedSessionIds.filter((x) => x !== id);
    }
  };
  const registrations = [];
  const ctx = {
    get: (name) => {
      assert.equal(name, "workspaces");
      return model;
    },
    effect: (fn) => fn(),
    locale: { register: () => () => {} },
    slots: {
      inject: (_slot, callback) => callback(),
      register: (options, Component) => {
        registrations.push({ options, Component });
        return () => {};
      }
    }
  };
  return { ctx, getRegistrations: () => registrations, model };
}

const entryOf = (registrations, id) => {
  const entry = registrations.find((candidate) => candidate.options.id === id);
  assert.ok(entry, `missing slot entry ${id}`);
  return entry;
};

test("bundle identity and service list match the package contract", () => {
  const definition = (() => {
    let captured;
    const sandbox = {
      window: { __ModuleLoader__: { load: (value) => { captured = value; } } },
      console
    };
    vm.createContext(sandbox);
    vm.runInContext(bundle, sandbox);
    return captured;
  })();
  assert.equal(definition.id, "dsh-primary-session");
  const mod = loadBundle();
  assert.equal(JSON.stringify(mod.inject), JSON.stringify(["slots", "workspaces", "locale"]));
});

test("apply registers both the row-menu action and the leading badge", () => {
  const mod = loadBundle();
  const state = {
    items: [{ workspaceId: "w1", sessionIds: ["a", "b"] }],
    pinnedSessionIds: ["b"],
    archivedSessionIds: []
  };
  const calls = [];
  const { ctx, getRegistrations } = fakeCtx(state, calls);
  mod.apply(ctx);
  const registrations = getRegistrations();

  const menu = entryOf(registrations, "primary-session");
  assert.equal(menu.options.name, "sidebar.workspaces.session.menu.item");
  assert.equal(menu.options.order, 90);
  assert.equal(menu.options.locale, "primary-session");
  const injected = menu.options.inject();
  assert.equal(typeof injected.hooks.primaryState.getSnapshot, "function");
  assert.equal(typeof injected.hooks.primaryState.subscribe, "function");
  assert.equal(typeof injected.primaryActions.setPrimary, "function");
  assert.equal(typeof injected.primaryActions.clearPrimary, "function");

  const badge = entryOf(registrations, "primary-badge");
  assert.equal(badge.options.name, "sidebar.session.row.leading");
  assert.equal(badge.options.order, 50);
  assert.equal(badge.options.locale, "primary-session");
  assert.equal(typeof badge.options.inject().hooks.primaryState.getSnapshot, "function");
});

test("menu row labels and actions follow the pin state", async () => {
  const mod = loadBundle();
  const state = {
    items: [{ workspaceId: "w1", sessionIds: ["a", "b"] }],
    pinnedSessionIds: ["b"],
    archivedSessionIds: []
  };
  const calls = [];
  const { ctx, getRegistrations } = fakeCtx(state, calls);
  mod.apply(ctx);
  const { Component, options } = entryOf(getRegistrations(), "primary-session");
  const injected = options.inject();

  const render = (sessionId) => Component({
    sessionId,
    t: (key) => key,
    useMenuOpenState: () => [true, () => {}],
    usePrimaryState: (selector) => selector(state),
    primaryActions: injected.primaryActions
  });

  const promote = render("a");
  assert.equal(promote.type, "MenuItemButton");
  assert.equal(promote.props.children[0], "menu.setPrimary");
  promote.props.onSelect();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, [["unpin", "b"], ["pin", "a"]]);

  const promoted = render("a");
  assert.equal(promoted.props.children[0], "menu.clearPrimary");

  const archivedState = { ...state, archivedSessionIds: ["b"] };
  const archivedRow = Component({
    sessionId: "b",
    t: (key) => key,
    useMenuOpenState: () => [true, () => {}],
    usePrimaryState: (selector) => selector(archivedState),
    primaryActions: injected.primaryActions
  });
  assert.equal(archivedRow, null);
});

test("badge marks only the most recently pinned session of a workspace", () => {
  const mod = loadBundle();
  const state = {
    items: [{ workspaceId: "w1", sessionIds: ["a", "b", "c"] }],
    pinnedSessionIds: ["b", "a"],
    archivedSessionIds: []
  };
  const { ctx, getRegistrations } = fakeCtx(state, []);
  mod.apply(ctx);
  const { Component } = entryOf(getRegistrations(), "primary-badge");
  const render = (sessionId, snapshot = state) => Component({
    sessionId,
    t: (key) => key,
    usePrimaryState: (selector) => selector(snapshot)
  });

  const badge = render("b");
  assert.equal(badge.type, "span");
  assert.equal(badge.props.children[0], "badge.label");
  assert.equal(render("a"), null);
  assert.equal(render("c"), null);
  assert.equal(render("b", { ...state, pinnedSessionIds: [] }), null);
});
