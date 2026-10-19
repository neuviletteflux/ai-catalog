/**
 * dsh-primary-session — browser half.
 *
 * Adds two slot entries:
 * - `sidebar.workspaces.session.menu.item`: “设为主会话 / 取消主会话”. Promoting
 *   first unpins every other pinned Session in the *same* workspace (or in the
 *   ungrouped bucket), then pins the target — at most one pin per workspace.
 * - `sidebar.session.row.leading`: a compact “主” badge on the workspace's latest
 *   pin (the first id of `pinnedSessionIds` that belongs to that workspace), so
 *   the primary row is distinguishable from an ordinary pin at a glance.
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
			"menu.clearPrimary": "取消主会话",
			"badge.label": "主",
			"badge.aria": "主会话"
		};
		const en = {
			"menu.setPrimary": "Set as primary",
			"menu.clearPrimary": "Clear primary",
			"badge.label": "P",
			"badge.aria": "Primary session"
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
		/**
		 * Whether a Session is the primary of its bucket: the most recently pinned
		 * Session of that workspace (the first matching id in the Host-ordered pin
		 * list). A manual second pin therefore becomes primary until the original
		 * is pinned again; “设为主会话” converges the bucket back to one.
		 * @param snapshot - `workspaces.list` snapshot.
		 * @param sessionId - target Session id.
		 * @returns true when the row should carry the primary badge.
		 */
		function isPrimaryOf(snapshot, sessionId) {
			const pinnedIds = Array.isArray(snapshot.pinnedSessionIds) ? snapshot.pinnedSessionIds : [];
			if (!pinnedIds.includes(sessionId)) return false;
			const items = Array.isArray(snapshot.items) ? snapshot.items : [];
			const owner = workspaceOf(snapshot, sessionId);
			if (owner !== undefined) {
				const first = pinnedIds.find((id) => owner.sessionIds.includes(id));
				return first === sessionId;
			}
			const accounted = new Set(items.flatMap((workspace) => Array.isArray(workspace.sessionIds) ? workspace.sessionIds : []));
			const first = pinnedIds.find((id) => !accounted.has(id));
			return first === sessionId;
		}
		/** localStorage key selecting the badge visual; unknown values fall back to `bar`. */
		const BADGE_STYLE_KEY = "dsh.primary.badge.style";
		/** Supported badge styles, also used by the README preview sheet. */
		const BADGE_STYLES = ["solid", "soft", "outline", "circle", "star", "bar"];
		/**
		 * Read the selected badge style. A storage failure (private mode, disabled
		 * storage) must not break the row, so it falls back to the default.
		 * @returns one of {@link BADGE_STYLES}.
		 */
		function badgeStyle() {
			try {
				const value = globalThis.localStorage?.getItem(BADGE_STYLE_KEY);
				return BADGE_STYLES.includes(value) ? value : "bar";
			} catch {
				return "bar";
			}
		}
		/** Accent color shared by every badge style (the sidebar's business accent). */
		const ACCENT = "var(--dsw-alias-state-business-primary)";
		/** Style fragments per badge variant; `star` and `bar` render no text. */
		const BADGE_VARIANTS = {
			solid: {
				box: { width: "15px", height: "15px", borderRadius: "4px", background: ACCENT, color: "#fff" }
			},
			soft: {
				box: { width: "15px", height: "15px", borderRadius: "4px", background: "color-mix(in srgb, " + ACCENT + " 16%, transparent)", color: ACCENT }
			},
			outline: {
				box: { width: "15px", height: "15px", borderRadius: "4px", background: "transparent", color: ACCENT, border: "1px solid " + ACCENT }
			},
			circle: {
				box: { width: "14px", height: "14px", borderRadius: "999px", background: ACCENT, color: "#fff" }
			},
			star: {
				box: { width: "14px", height: "14px", background: "transparent", color: ACCENT }
			},
			bar: {
				box: { width: "3px", height: "16px", borderRadius: "2px", background: ACCENT }
			}
		};
		/**
		 * Row-leading badge: a compact chip that marks the primary row. The visual
		 * is selectable through `localStorage["dsh.primary.badge.style"]`
		 * (`solid`, `soft`, `outline`, `circle`, `star`, `bar`).
		 * The seat is only rendered while the row is idle (a running row shows its
		 * status dot there instead); the trailing pin icon still marks it.
		 * @param props - composed slot props (`t`, `usePrimaryState`).
		 * @returns the badge, or null for any non-primary row.
		 */
		function PrimaryBadge(props) {
			const { sessionId, t, usePrimaryState } = props;
			const snapshot = usePrimaryState((state) => state);
			if (!isPrimaryOf(snapshot, sessionId)) return null;
			const style = BADGE_VARIANTS[badgeStyle()] ?? BADGE_VARIANTS.solid;
			const children = style === BADGE_VARIANTS.star
				? React.createElement("svg", {
					width: 14,
					height: 14,
					viewBox: "0 0 16 16",
					"aria-hidden": true,
					fill: "currentColor"
				}, React.createElement("path", { d: "M8 1.6l1.92 4.03 4.42.55-3.25 3.05.84 4.37L8 11.5l-3.93 2.1.84-4.37L1.66 6.18l4.42-.55z" }))
				: style === BADGE_VARIANTS.bar
					? null
					: t("badge.label");
			return React.createElement("span", {
				role: "img",
				"aria-label": t("badge.aria"),
				title: t("badge.aria"),
				style: {
					display: "inline-flex",
					alignItems: "center",
					justifyContent: "center",
					fontSize: "10px",
					fontWeight: 600,
					lineHeight: "15px",
					flex: "none",
					...style.box
				}
			}, children);
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
			ctx.slots.inject("sidebar.session.row.leading", () => ctx.slots.register({
				name: "sidebar.session.row.leading",
				id: "primary-badge",
				order: 50,
				locale: NS,
				inject: () => ({ hooks: { primaryState: source } })
			}, PrimaryBadge));
		}
		exports.__test = {
			primaryPlan,
			isPrimaryOf,
			setPrimary,
			clearPrimary
		};
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
