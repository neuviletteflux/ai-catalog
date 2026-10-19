/**
 * dsh-primary-session — browser half.
 *
 * Adds one `sidebar.workspaces.session.menu.item` entry: “设为主会话 / 取消主会话”.
 * “设为主会话” keeps the existing pin mechanism, but first unpins every other
 * pinned Session in the *same* workspace (or in the ungrouped bucket), so the
 * workspace has exactly one pinned row — the primary Session, rendered with the
 * built-in pin marker and fronted above normal rows.
 *
 * No host API, schema, or session event is added: the pin set is already durable
 * on the Host and streamed through `workspaces.list`.
 */
window.__ModuleLoader__.load({
	id: "dsh-primary-session",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");
		const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		/** Dictionary namespace owned by this plugin. */
		const NS = "primary-session";
		const zh = {
			"menu.setPrimary": "设为主会话",
			"menu.clearPrimary": "取消主会话"
		};
		const en = {
			"menu.setPrimary": "Set as primary",
			"menu.clearPrimary": "Clear primary"
		};
		/**
		 * The Workspace (or the ungrouped bucket) that owns a Session.
		 * @param snapshot - `workspaces.list` snapshot (`items` + pinned/archived ids).
		 * @param sessionId - target Session id.
		 * @returns the owning Workspace row, or undefined for an ungrouped Session.
		 */
		function workspaceOf(snapshot, sessionId) {
			const items = Array.isArray(snapshot.items) ? snapshot.items : [];
			return items.find((workspace) => Array.isArray(workspace.sessionIds) && workspace.sessionIds.includes(sessionId));
		}
		/**
		 * Decide what “primary” means for one row right now: whether it is already
		 * pinned, and which sibling pins in the same bucket must be released first.
		 * Archived rows are excluded by the caller, not here.
		 * @param snapshot - `workspaces.list` snapshot.
		 * @param sessionId - target Session id.
		 * @returns `{ pinned, siblings }`.
		 */
		function primaryPlan(snapshot, sessionId) {
			const pinnedIds = Array.isArray(snapshot.pinnedSessionIds) ? snapshot.pinnedSessionIds : [];
			const pinned = new Set(pinnedIds);
			const items = Array.isArray(snapshot.items) ? snapshot.items : [];
			const owner = workspaceOf(snapshot, sessionId);
			if (owner !== undefined) {
				return {
					pinned: pinned.has(sessionId),
					siblings: owner.sessionIds.filter((id) => id !== sessionId && pinned.has(id))
				};
			}
			// Ungrouped bucket: pinned ids that belong to no Workspace at all.
			const accounted = new Set(items.flatMap((workspace) => Array.isArray(workspace.sessionIds) ? workspace.sessionIds : []));
			return {
				pinned: pinned.has(sessionId),
				siblings: pinnedIds.filter((id) => id !== sessionId && !accounted.has(id))
			};
		}
		/** Readable message for a thrown service error. */
		function errorMessage(error) {
			return error instanceof Error ? error.message : String(error);
		}
		/**
		 * Make `sessionId` the only pinned Session of its bucket.
		 * Unpin failures are collected and the final pin is still attempted, so one
		 * stale id cannot block the user's intent.
		 * @param model - client `workspaces` service (`pinSession` / `unpinSession`).
		 * @param sessionId - Session to promote.
		 * @returns nothing; throws when any step fails.
		 */
		async function setPrimary(model, sessionId) {
			const plan = primaryPlan(model.list.getSnapshot(), sessionId);
			const failures = [];
			for (const id of plan.siblings) {
				try {
					await model.unpinSession(id);
				} catch (error) {
					failures.push(`unpin ${id}: ${errorMessage(error)}`);
				}
			}
			try {
				await model.pinSession(sessionId);
			} catch (error) {
				failures.push(`pin ${sessionId}: ${errorMessage(error)}`);
			}
			if (failures.length > 0) throw new Error(failures.join("; "));
		}
		/**
		 * Release the target's pin without touching other pins.
		 * @param model - client `workspaces` service.
		 * @param sessionId - Session to demote.
		 * @returns nothing; throws when the Host rejects the call.
		 */
		async function clearPrimary(model, sessionId) {
			await model.unpinSession(sessionId);
		}
		/**
		 * One list-slot row: label and icon follow the row's current pin state.
		 * @param props - composed slot props (`t`, `useMenuOpenState`, injected share).
		 * @returns the menu row, or null for an archived Session.
		 */
		function PrimarySessionMenuItem(props) {
			const { sessionId, t, useMenuOpenState, usePrimaryState, primaryActions } = props;
			const [, setMenuOpen] = useMenuOpenState();
			const snapshot = usePrimaryState((state) => state);
			const archived = new Set(Array.isArray(snapshot.archivedSessionIds) ? snapshot.archivedSessionIds : []);
			if (archived.has(sessionId)) return null;
			const plan = primaryPlan(snapshot, sessionId);
			const Icon = plan.pinned ? primitives.IconPinFillRegular : primitives.IconPinOutlineRegular;
			const label = t(plan.pinned ? "menu.clearPrimary" : "menu.setPrimary");
			return React.createElement(primitives.MenuItemButton, {
				icon: React.createElement(Icon),
				onSelect: () => {
					setMenuOpen(false);
					const run = plan.pinned ? primaryActions.clearPrimary : primaryActions.setPrimary;
					Promise.resolve().then(() => run(sessionId)).catch((error) => {
						console.warn("primary-session:", error);
					});
				}
			}, label);
		}
		/** Required client services. */
		const inject = ["slots", "workspaces", "locale"];
		/**
		 * Register the row menu entry once the sidebar declares the list slot.
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			const model = ctx.get("workspaces");
			const source = {
				getSnapshot: () => model.list.getSnapshot(),
				subscribe: (listener) => model.list.subscribe(listener)
			};
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "primary-session: dictionaries");
			ctx.slots.inject("sidebar.workspaces.session.menu.item", () => ctx.slots.register({
				name: "sidebar.workspaces.session.menu.item",
				id: "primary-session",
				order: 90,
				locale: NS,
				inject: () => ({
					hooks: { primaryState: source },
					primaryActions: {
						setPrimary: (sessionId) => setPrimary(model, sessionId),
						clearPrimary: (sessionId) => clearPrimary(model, sessionId)
					}
				})
			}, PrimarySessionMenuItem));
		}
		exports.__test = {
			primaryPlan,
			setPrimary,
			clearPrimary
		};
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
