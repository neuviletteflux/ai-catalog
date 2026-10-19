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
  let registered;
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
        registered = { options, Component };
        return () => {};
      }
    }
  };
  return { ctx, getRegistered: () => registered, model };
}

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

test("apply registers the primary menu item on the session row menu", () => {
  const mod = loadBundle();
  const state = {
    items: [{ workspaceId: "w1", sessionIds: ["a", "b"] }],
    pinnedSessionIds: ["b"],
    archivedSessionIds: []
  };
  const calls = [];
  const { ctx, getRegistered } = fakeCtx(state, calls);
  mod.apply(ctx);
  const registered = getRegistered();
  assert.equal(registered.options.name, "sidebar.workspaces.session.menu.item");
  assert.equal(registered.options.id, "primary-session");
  assert.equal(registered.options.order, 90);
  assert.equal(registered.options.locale, "primary-session");
  const injected = registered.options.inject();
  assert.equal(typeof injected.hooks.primaryState.getSnapshot, "function");
  assert.equal(typeof injected.hooks.primaryState.subscribe, "function");
  assert.equal(typeof injected.primaryActions.setPrimary, "function");
  assert.equal(typeof injected.primaryActions.clearPrimary, "function");
});

test("menu row labels and actions follow the pin state", async () => {
  const mod = loadBundle();
  const state = {
    items: [{ workspaceId: "w1", sessionIds: ["a", "b"] }],
    pinnedSessionIds: ["b"],
    archivedSessionIds: []
  };
  const calls = [];
  const { ctx, getRegistered } = fakeCtx(state, calls);
  mod.apply(ctx);
  const { Component, options } = getRegistered();
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
