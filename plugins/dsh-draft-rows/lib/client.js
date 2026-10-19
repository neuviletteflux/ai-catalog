window.__ModuleLoader__.load({ id: "dsh-draft-rows", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
"use strict";

/**
 * dsh-draft-rows, browser half.
 *
 * Unsent New Sessions are first-class draft rows:
 *
 * 1. Visibility: the stock tree hides every blank session that is not the
 *    current one. We shadow `sessions.list.getSnapshot` and project each
 *    blank draft as `blank: false` with a preview title, so the stock tree
 *    renders it as an ordinary row. No renderer or core file is modified.
 * 2. Preview: the current draft's composer is subscribed through
 *    `conversation.input`; its text becomes the row title live and is
 *    mirrored to localStorage so previews survive reloads. On install the
 *    existing `dsh.conversation.*` keys are scanned, which also surfaces
 *    drafts orphaned by the stock 0.2.1 behavior.
 * 3. New Session: the stock "always mint a fresh id" rule is replaced.
 *    - multi (default): reuse the workspace's EMPTY draft; when every draft
 *      carries text, mint a fresh one. Typed drafts stay as their own rows.
 *    - single: reuse the workspace's single blank regardless of text (the
 *      pre-0.2.1 behavior).
 *    Switch with localStorage["dsh.drafts.mode"] = "single" and reload.
 * 4. Discard: the stock row menu's Archive discards a draft; the preview is
 *    pruned when the archived-set changes.
 *
 * Fail-soft: any missing service leaves the stock behavior untouched.
 */

var NS = "draftRows";
var STORAGE_KEY = "dsh.drafts.v1";
var MODE_KEY = "dsh.drafts.mode";
var PATCH = Symbol.for("dsh-draft-rows/patch");
var PREVIEW_MAX = 60;
var PREVIEW_CAP = 200;
var PREVIEW_TTL = 45 * 86400000;

var zh = {
  newSession: "新会话",
  draftPrefix: "草稿｜",
  attachment: "[附件]"
};
var en = {
  newSession: "New Session",
  draftPrefix: "Draft｜",
  attachment: "[Attachment]"
};

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests; no React, no context, no DOM).
// ---------------------------------------------------------------------------

/** One-line preview of unsent composer text, or undefined for empty input. */
function previewOf(text, max) {
  var cap = typeof max === "number" ? max : PREVIEW_MAX;
  var collapsed = String(text === undefined || text === null ? "" : text).replace(/\s+/g, " ").trim();
  if (collapsed === "") return undefined;
  return collapsed.length <= cap ? collapsed : collapsed.slice(0, cap).trimEnd() + "…";
}

/**
 * Whether a summary is an unsent draft. `blank: true` is the never-engaged
 * placeholder; `blank: false` plus host metadata `blank: true` is an opened
 * but never-prompted draft (the 0.2 client blank bit flips on engagement).
 */
function isDraft(summary) {
  if (summary === undefined || summary === null) return false;
  if (summary.origin === "subagent") return false;
  if (summary.blank === true) return true;
  return summary.projectionValues !== undefined
    && summary.projectionValues !== null
    && summary.projectionValues.sessionListMetadata !== undefined
    && summary.projectionValues.sessionListMetadata !== null
    && summary.projectionValues.sessionListMetadata.blank === true;
}

/** The current session: the row retained by the main view. */
function mainSessionIdOf(list) {
  if (list === undefined || list === null) return undefined;
  var ids = list.ids || [];
  for (var i = 0; i < ids.length; i += 1) {
    var summary = list.byId === undefined ? undefined : list.byId[ids[i]];
    if (summary !== undefined && summary !== null
      && summary.retainedBy !== undefined && summary.retainedBy !== null
      && summary.retainedBy.mainView > 0) return summary.id;
  }
  return list.current;
}

/** Stable tie-breaking follows the stock host Workspace order. */
function recentWorkspace(workspaces, sessions) {
  var selected;
  var selectedTime = Number.NEGATIVE_INFINITY;
  var items = (workspaces && workspaces.items) || [];
  for (var i = 0; i < items.length; i += 1) {
    var workspace = items[i];
    var latest = Number.NEGATIVE_INFINITY;
    var workspaceSessionIds = workspace.sessionIds || [];
    for (var j = 0; j < workspaceSessionIds.length; j += 1) {
      var summary = sessions === undefined ? undefined : sessions[workspaceSessionIds[j]];
      if (summary !== undefined && summary !== null && typeof summary.updatedAt === "number") {
        latest = Math.max(latest, summary.updatedAt);
      }
    }
    if (latest === Number.NEGATIVE_INFINITY) {
      var created = Date.parse(workspace.createdAt);
      latest = Number.isNaN(created) ? 0 : created;
    }
    if (selected === undefined || latest > selectedTime) {
      selected = workspace.workspaceId;
      selectedTime = latest;
    }
  }
  return selected;
}

/**
 * Newest draft of one workspace that the New Session rule may reuse.
 * multi: only drafts without unsent text; single: any blank.
 */
function findReusableDraft(stock, workspaceSnapshot, previews, workspaceId, mode, preferredId) {
  if (stock === undefined || workspaceSnapshot === undefined) return undefined;
  var items = workspaceSnapshot.items || [];
  var workspace;
  for (var i = 0; i < items.length; i += 1) {
    if (items[i].workspaceId === workspaceId) { workspace = items[i]; break; }
  }
  if (workspace === undefined) return undefined;
  var archived = new Set(workspaceSnapshot.archivedSessionIds || []);
  var members = new Set(workspace.sessionIds || []);
  if (mode === "single" && preferredId !== undefined) {
    var preferred = stock.byId === undefined ? undefined : stock.byId[preferredId];
    if (preferred !== undefined && preferred !== null && isDraft(preferred)
      && members.has(preferredId) && !archived.has(preferredId)
      && (workspace.path === undefined || preferred.cwd === workspace.path)) return preferred;
  }
  var best;
  var ids = stock.ids || [];
  for (var j = 0; j < ids.length; j += 1) {
    var id = ids[j];
    var summary = stock.byId === undefined ? undefined : stock.byId[id];
    if (summary === undefined || summary === null || !isDraft(summary)) continue;
    if (!members.has(id) || archived.has(id)) continue;
    if (workspace.path !== undefined && summary.cwd !== workspace.path) continue;
    if (mode !== "single" && previews.has(id)) continue;
    if (best === undefined
      || summary.updatedAt > best.updatedAt
      || (summary.updatedAt === best.updatedAt && id < best.id)) best = summary;
  }
  return best;
}

/** Project every visible draft into an ordinary row with a preview title. */
function projectDraftList(stock, previews, fallbackTitle, archived, prefix) {
  if (stock === undefined || stock === null || typeof stock.byId !== "object" || stock.byId === null) {
    return stock;
  }
  var byId = Object.assign({}, stock.byId);
  var changed = false;
  var ids = stock.ids || [];
  for (var i = 0; i < ids.length; i += 1) {
    var id = ids[i];
    var summary = stock.byId[id];
    if (summary === undefined || !isDraft(summary)) continue;
    if (archived !== undefined && archived !== null && archived.has(id)) continue;
    var preview = previews === undefined ? undefined : previews.get(id);
    var title = preview === undefined ? fallbackTitle : prefix + preview;
    byId[id] = Object.assign({}, summary, {
      blank: false,
      title: title,
      displayTitle: title
    });
    changed = true;
  }
  if (!changed) return stock;
  return Object.assign({}, stock, { byId: byId });
}

// ---------------------------------------------------------------------------
// Install.
// ---------------------------------------------------------------------------

/** Create a namespaced style tag (idempotent across HMR generations). */
function installStyles() {
  if (typeof document === "undefined") return function () {};
  var tagId = "dsh-draft-rows/style";
  if (document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") !== null) {
    return function () {};
  }
  var tag = document.createElement("style");
  tag.dataset.plugin = "dsh-draft-rows";
  tag.dataset.pluginCss = tagId;
  tag.textContent = [
    '[role="treeitem"][data-dsh-draft="true"] > span:nth-child(2){',
    '  color: var(--dsw-alias-label-secondary);',
    '}',
    '[role="treeitem"][data-dsh-draft="true"] > span:first-child::after{',
    '  content: "";',
    '  width: 12px; height: 12px;',
    '  background-color: var(--dsw-alias-label-tertiary);',
    '  -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 16 16\'%3E%3Cpath d=\'M11.3 2.7a1.7 1.7 0 0 1 2.4 2.4L5.2 13.6l-3.2.8.8-3.2z\' fill=\'none\' stroke=\'%23000\' stroke-width=\'1.4\' stroke-linejoin=\'round\' stroke-linecap=\'round\'/%3E%3C/svg%3E") center/12px 12px no-repeat;',
    '  mask: url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 16 16\'%3E%3Cpath d=\'M11.3 2.7a1.7 1.7 0 0 1 2.4 2.4L5.2 13.6l-3.2.8.8-3.2z\' fill=\'none\' stroke=\'%23000\' stroke-width=\'1.4\' stroke-linejoin=\'round\' stroke-linecap=\'round\'/%3E%3C/svg%3E") center/12px 12px no-repeat;',
    '}'
  ].join("\n");
  document.head.appendChild(tag);
  return function () {
    tag.remove();
  };
}

/** Read the configured New Session rule. */
function readMode() {
  try {
    if (typeof localStorage !== "undefined" && localStorage.getItem(MODE_KEY) === "single") return "single";
  } catch (_error) {
    // Private mode / disabled storage: the default still works.
  }
  return "multi";
}

/** Load the preview mirror and scan existing per-session draft texts. */
function loadPreviews(previews) {
  try {
    if (typeof localStorage === "undefined") return;
    var raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      var parsed = JSON.parse(raw);
      var now = Date.now();
      var loaded = 0;
      for (var id in parsed) {
        if (!Object.prototype.hasOwnProperty.call(parsed, id)) continue;
        if (loaded >= PREVIEW_CAP) break;
        var entry = parsed[id];
        if (entry === null || typeof entry !== "object") continue;
        if (typeof entry.p !== "string" || entry.p === "") continue;
        if (typeof entry.at === "number" && now - entry.at > PREVIEW_TTL) continue;
        previews.set(id, entry.p);
        loaded += 1;
      }
    }
  } catch (_error) {
    // Corrupt JSON: persistence silently disables.
  }
  try {
    if (typeof localStorage === "undefined") return;
    var scanned = 0;
    for (var i = 0; i < localStorage.length && scanned < PREVIEW_CAP * 4; i += 1) {
      var key = localStorage.key(i);
      if (key === null || key.indexOf("dsh.conversation.") !== 0) continue;
      scanned += 1;
      var sessionId = key.slice("dsh.conversation.".length);
      if (sessionId === "" || previews.has(sessionId)) continue;
      var value = JSON.parse(localStorage.getItem(key) || "null");
      if (value === null || value === undefined) continue;
      var draft = value.draft;
      if (draft === null || typeof draft !== "object") continue;
      var preview = previewOf(draft.text);
      if (preview !== undefined) previews.set(sessionId, preview);
    }
  } catch (_error) {
    // A malformed entry must not break the scan.
  }
}

function installBehavior(ctx) {
  var sessions = ctx.sessions;
  var workspaces = ctx.workspaces;
  var conversation = ctx.conversation;
  var uiWorkspace = ctx.uiWorkspace;
  var listStore = sessions === undefined || sessions === null ? undefined : sessions.list;
  if (sessions === undefined || sessions === null
    || workspaces === undefined || workspaces === null
    || conversation === undefined || conversation === null
    || uiWorkspace === undefined || uiWorkspace === null
    || listStore === undefined || listStore === null
    || typeof listStore.getSnapshot !== "function"
    || typeof uiWorkspace.startSession !== "function"
    || typeof sessions.create !== "function") {
    console.warn("[draft-rows] runtime shape unsupported — stock behavior left intact");
    return function () {};
  }
  if (listStore[PATCH] !== undefined) return function () {};

  var mode = readMode();
  var previews = new Map();
  var archived = new Set((workspaces.list.getSnapshot().archivedSessionIds) || []);
  var cache = undefined;
  var version = 0;
  var shells = new Map();
  var persistTimer;
  var wakeTimer;
  var scanFrame;
  var observer;
  var disposed = false;
  var connecting = new Map();

  var hadOwnGet = Object.prototype.hasOwnProperty.call(listStore, "getSnapshot");
  var originalGet = listStore.getSnapshot;
  var stockGet = originalGet.bind(listStore);
  var hadOwnStart = Object.prototype.hasOwnProperty.call(uiWorkspace, "startSession");
  var originalStart = uiWorkspace.startSession;
  var stockStart = originalStart.bind(uiWorkspace);
  listStore[PATCH] = true;

  var t = function (key) {
    try {
      var bound = ctx.locale.bind(NS);
      var text = bound(key);
      if (typeof text === "string" && text !== "") return text;
    } catch (_error) {
      // Fall through to the built-in dictionary.
    }
    return (zh[key] !== undefined ? zh[key] : en[key]) || key;
  };

  function previewTitle(preview) {
    return preview === undefined ? t("newSession") : t("draftPrefix") + preview;
  }

  function project() {
    var stock = stockGet();
    if (cache !== undefined && cache.stock === stock && cache.version === version) return cache.value;
    var value = projectDraftList(stock, previews, t("newSession"), archived, t("draftPrefix"));
    cache = { stock: stock, version: version, value: value };
    return value;
  }

  function persistSoon() {
    if (persistTimer !== undefined) return;
    persistTimer = setTimeout(function () {
      persistTimer = undefined;
      if (disposed) return;
      try {
        if (typeof localStorage === "undefined") return;
        var now = Date.now();
        var payload = {};
        var entries = Array.from(previews.entries()).slice(-PREVIEW_CAP);
        for (var i = 0; i < entries.length; i += 1) {
          payload[entries[i][0]] = { p: entries[i][1], at: now };
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch (_error) {
        // Quota / private mode: previews remain in memory for this run.
      }
    }, 400);
  }

  function wake() {
    if (wakeTimer !== undefined) return;
    wakeTimer = setTimeout(function () {
      wakeTimer = undefined;
      if (disposed) return;
      version += 1;
      cache = undefined;
      try {
        if (typeof listStore.set === "function") {
          var raw = stockGet();
          listStore.set(Object.assign({}, raw));
        }
      } catch (error) {
        console.warn("[draft-rows] list wake failed:", error);
      }
      scanRowsSoon();
    }, 60);
  }

  function setPreview(sessionId, text, attachmentCount) {
    if (disposed) return;
    var preview = previewOf(text);
    if (preview === undefined && attachmentCount > 0) preview = t("attachment");
    if (preview === undefined) {
      if (previews.delete(sessionId)) { persistSoon(); wake(); }
      return;
    }
    if (previews.get(sessionId) === preview) return;
    previews.set(sessionId, preview);
    persistSoon();
    wake();
  }

  function prunePreviews() {
    if (disposed) return;
    var stock = stockGet();
    var changed = false;
    previews.forEach(function (_preview, sessionId) {
      if (archived.has(sessionId)) {
        previews.delete(sessionId);
        changed = true;
        return;
      }
      var summary = stock.byId === undefined ? undefined : stock.byId[sessionId];
      // Positive knowledge only: an absent row may be the boot race.
      if (summary !== undefined && !isDraft(summary)) {
        previews.delete(sessionId);
        changed = true;
      }
    });
    if (changed) { persistSoon(); wake(); }
  }

  function syncShells() {
    if (disposed) return;
    var stock = stockGet();
    var current = mainSessionIdOf(stock);
    var draftIds = new Set();
    var ids = stock.ids || [];
    for (var i = 0; i < ids.length; i += 1) {
      var summary = stock.byId === undefined ? undefined : stock.byId[ids[i]];
      if (summary !== undefined && isDraft(summary)) draftIds.add(ids[i]);
    }
    Array.from(shells.keys()).forEach(function (sessionId) {
      if (sessionId === current && draftIds.has(sessionId)) return;
      var off = shells.get(sessionId);
      if (off !== undefined) off();
      shells.delete(sessionId);
    });
    if (current === undefined || !draftIds.has(current) || shells.has(current)) return;
    try {
      var scope = typeof sessions.scope === "function" ? sessions.scope(current) : undefined;
      if (scope === undefined) return; // not staged yet
      var shell = conversation.input.for(scope);
      var update = function () {
        var snapshot = shell.state.getSnapshot();
        var attachmentIds = snapshot.attachmentIds || [];
        setPreview(current, snapshot.draft, attachmentIds.length);
      };
      var off = shell.state.subscribe(update);
      shells.set(current, off);
      update();
    } catch (_error) {
      // The current composer is not materialized yet; the next list change retries.
    }
  }

  function syncArchived() {
    if (disposed) return;
    var snapshot = workspaces.list.getSnapshot();
    var next = new Set((snapshot.archivedSessionIds) || []);
    var changed = next.size !== archived.size;
    if (!changed) {
      next.forEach(function (id) { if (!archived.has(id)) changed = true; });
    }
    archived = next;
    if (changed) { version += 1; cache = undefined; prunePreviews(); wake(); }
    scanRowsSoon();
  }

  function resolveTarget(workspaceId) {
    var workspaceSnapshot = workspaces.list.getSnapshot();
    var stock = stockGet();
    if (workspaceSnapshot.phase !== "ready" || stock.phase !== "ready") return undefined;
    var current = mainSessionIdOf(stock);
    var currentWorkspaceId;
    if (current !== undefined) {
      var items = workspaceSnapshot.items || [];
      for (var i = 0; i < items.length; i += 1) {
        if ((items[i].sessionIds || []).indexOf(current) !== -1) {
          currentWorkspaceId = items[i].workspaceId;
          break;
        }
      }
    }
    var recent = recentWorkspace(workspaceSnapshot, stock.byId);
    return workspaceId !== undefined ? workspaceId : (currentWorkspaceId !== undefined ? currentWorkspaceId : recent);
  }

  function isWriterHeld(error) {
    if (error === null || error === undefined) return false;
    var code = error.rpcError !== undefined && error.rpcError !== null
      ? error.rpcError.code
      : error.code;
    return code === "session/writer-held";
  }

  function startFresh(workspaceId) {
    var target = resolveTarget(workspaceId);
    if (target === undefined) {
      stockStart(workspaceId, undefined);
      return;
    }
    var pending = connecting.get(target);
    if (pending !== undefined) return;
    var stock = stockGet();
    var reusable = findReusableDraft(stock, workspaces.list.getSnapshot(), previews, target, mode, mainSessionIdOf(stock));
    var attempt = (reusable === undefined
      ? sessions.create({ workspaceId: target })
      : sessions.create({ workspaceId: target, sessionId: reusable.id }).catch(function (error) {
          if (isWriterHeld(error)) return sessions.create({ workspaceId: target });
          throw error;
        })
    ).then(function (sessionId) {
      try {
        uiWorkspace.openSession(sessionId);
      } catch (error) {
        console.warn("[draft-rows] openSession failed:", error);
      }
      queueMicrotask(syncShells);
      setTimeout(syncShells, 120);
      setTimeout(syncShells, 500);
      setTimeout(scanRowsSoon, 120);
      return sessionId;
    }).catch(function (error) {
      console.warn("[draft-rows] new session failed; falling back to stock:", error && (error.stack || error.message || String(error)));
      try { stockStart(workspaceId, undefined); } catch (_fallbackError) { /* stock's own notice */ }
    }).finally(function () {
      if (connecting.get(target) === attempt) connecting.delete(target);
    });
    connecting.set(target, attempt);
  }

  function scanRows() {
    scanFrame = undefined;
    if (disposed || typeof document === "undefined" || typeof document.querySelectorAll !== "function") return;
    var stock = stockGet();
    var draftIds = new Set();
    var ids = stock.ids || [];
    for (var i = 0; i < ids.length; i += 1) {
      var summary = stock.byId === undefined ? undefined : stock.byId[ids[i]];
      if (summary !== undefined && isDraft(summary) && !archived.has(ids[i])) draftIds.add(ids[i]);
    }
    var rows = document.querySelectorAll('[role="treeitem"][data-row-key^="session:"]');
    for (var j = 0; j < rows.length; j += 1) {
      var row = rows[j];
      var key = row.getAttribute("data-row-key");
      if (key === null) continue;
      var sessionId = key.slice("session:".length);
      if (draftIds.has(sessionId)) row.setAttribute("data-dsh-draft", "true");
      else if (row.hasAttribute("data-dsh-draft")) row.removeAttribute("data-dsh-draft");
    }
  }

  function scanRowsSoon() {
    if (scanFrame !== undefined || disposed) return;
    if (typeof requestAnimationFrame === "function") {
      scanFrame = requestAnimationFrame(scanRows);
    } else {
      scanFrame = setTimeout(scanRows, 60);
    }
  }

  listStore.getSnapshot = project;
  uiWorkspace.startSession = function patchedStartSession(workspaceId, options) {
    if (options !== undefined) return stockStart(workspaceId, options);
    startFresh(workspaceId);
  };

  var offList = listStore.subscribe(function () {
    syncShells();
    prunePreviews();
    scanRowsSoon();
  });
  var offWorkspaces = workspaces.list.subscribe(function () {
    syncArchived();
  });

  if (typeof MutationObserver !== "undefined" && typeof document !== "undefined") {
    observer = new MutationObserver(function () { scanRowsSoon(); });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function blockDraftRename(event) {
    if (event === null || event === undefined || typeof event.target.closest !== "function") return;
    var row = event.target.closest('[role="treeitem"][data-row-key^="session:"][data-dsh-draft="true"]');
    if (row === null) return;
    event.preventDefault();
    event.stopPropagation();
  }
  if (typeof document !== "undefined") document.addEventListener("dblclick", blockDraftRename, true);

  loadPreviews(previews);
  syncArchived();
  syncShells();
  scanRowsSoon();
  setTimeout(function () {
    if (disposed) return;
    syncArchived();
    syncShells();
    prunePreviews();
    scanRowsSoon();
  }, 0);

  console.info("[draft-rows] installed; New Session mode =", mode);

  return function cleanup() {
    disposed = true;
    try {
      if (hadOwnGet) listStore.getSnapshot = originalGet;
      else delete listStore.getSnapshot;
    } catch (_error) { /* store already disposed */ }
    try {
      if (hadOwnStart) uiWorkspace.startSession = originalStart;
      else delete uiWorkspace.startSession;
    } catch (_error) { /* service already disposed */ }
    delete listStore[PATCH];
    try { offList(); } catch (_error) { /* already gone */ }
    try { offWorkspaces(); } catch (_error) { /* already gone */ }
    shells.forEach(function (off) { try { off(); } catch (_error) { /* already gone */ } });
    shells.clear();
    if (persistTimer !== undefined) clearTimeout(persistTimer);
    if (wakeTimer !== undefined) clearTimeout(wakeTimer);
    if (scanFrame !== undefined) {
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(scanFrame);
      else clearTimeout(scanFrame);
    }
    if (observer !== undefined) observer.disconnect();
    if (typeof document !== "undefined") {
      document.removeEventListener("dblclick", blockDraftRename, true);
      var rows = document.querySelectorAll('[role="treeitem"][data-dsh-draft]');
      for (var i = 0; i < rows.length; i += 1) rows[i].removeAttribute("data-dsh-draft");
    }
  };
}

/** Browser plugin entry. */
function apply(ctx) {
  ctx.effect(function () {
    if (typeof ctx.locale !== "undefined" && ctx.locale !== null && typeof ctx.locale.register === "function") {
      return ctx.locale.register(NS, { zh: zh, en: en });
    }
    return function () {};
  }, "dsh-draft-rows: dictionaries");
  ctx.effect(function () {
    return installStyles();
  }, "dsh-draft-rows: styles");
  ctx.effect(function () {
    return installBehavior(ctx);
  }, "dsh-draft-rows: behavior");
}

exports.inject = ["sessions", "workspaces", "conversation", "locale", "uiWorkspace"];
exports.apply = apply;
exports.__test = {
  previewOf: previewOf,
  isDraft: isDraft,
  mainSessionIdOf: mainSessionIdOf,
  recentWorkspace: recentWorkspace,
  findReusableDraft: findReusableDraft,
  projectDraftList: projectDraftList
};

return module.exports; } });
