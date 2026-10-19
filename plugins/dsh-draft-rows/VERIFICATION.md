# dsh-draft-rows 实施与验证记录

日期：2026-10-19
目标版本：DSH Desktop `0.2.1-rc.2`

## 已实现

- A：New Session 不再无条件新建 session；按规则复用当前 workspace 的 blank。
- B：未发送的 blank 会话在侧边栏显示为草稿行，带 `草稿｜<预览>` 标题、铅笔图标和灰色标题。
- 多草稿：默认 `multi`，已有文字的草稿保持为独立行；New Session 只复用空草稿，所有草稿都有文字时才新建。
- 单槽兼容：`localStorage["dsh.drafts.mode"] = "single"` 后，New Session 优先回到当前草稿（`A` 的旧行为）。
- 草稿持久化：沿用 `dsh.conversation.<sessionId>`；预览镜像到 `dsh.drafts.v1`，刷新后仍在。
- 安装时扫描已有 `dsh.conversation.*`，能把 stock 0.2.1 遗留的孤儿草稿重新显示为行。
- 丢弃：stock 行菜单的 Archive；归档后预览会被清理。
- 失败降级：服务/形状不匹配时保持 stock 行为，只打一条 warning。

## 代码位置

```text
/Users/lives/Github/ai-catalog/plugins/dsh-draft-rows/
├── plugin.yaml           # ai-catalog 元数据（schema/plugin.schema.json）
├── package.json          # dsh.bundle.patch + dsh.client
├── cordis.patch.yml      # insert: draft-rows
├── lib/index.js          # host no-op
├── lib/client.js         # 浏览器端全部逻辑
├── tests/logic.test.mjs  # 纯逻辑测试
├── tests/apply.test.mjs  # patch 行为测试（fake ctx）
├── assets/               # README 截图
├── README.md             # English
├── README.zh.md          # 简体中文
└── VERIFICATION.md
```

## 自动化验证

### 单元测试

```bash
cd /Users/lives/Github/ai-catalog/plugins/dsh-draft-rows
node --test tests/logic.test.mjs tests/apply.test.mjs
```

结果：12 个测试全部通过（预览截断、draft 判定、折叠计划、投影、复用规则、单槽优先、patch 行为）。

### 0.2.0 单新会话与置顶排序

`node --test tests/logic.test.mjs tests/apply.test.mjs` 结果：12 个测试全部通过。新增覆盖：

- `planDraftRows`：每个 workspace（含 ungrouped 桶）只保留一个空草稿；typed 草稿全部保留；当前空草稿优先成为唯一「新会话」行。
- `projectDraftList` 的 `hidden` 参数：被折叠的空草稿同时离开 `ids` 与 `byId`，不会渲染。
- multi 模式下 New Session 优先复用当前可见的空草稿，即使另一个隐藏 blank 的 `updatedAt` 更新。

隔离 Web Host E2E（同 `0.2.1-rc.2`，临时 `DSH_HOME`，`dsh plugin --profile web add link:...`）：

1. 输入 `hello draft`：侧边栏行标题变为 `草稿｜hello draft`。
2. 点 New Session：新增一个 `新会话` 行，typed 草稿保留；再次点击复用该空草稿，不新增行。
3. 切回 typed 草稿并清空输入：两个空草稿折叠为一行 `新会话`；刷新后仍只有一行。
4. 行菜单置顶 typed 草稿：截图确认 `新会话` 仍显示在置顶行之前（`order` 是纯视觉排序，stock 的 pinned 状态与行菜单不变）。
5. workspace 标题始终位于其草稿行之前。

实现细节：草稿行由 HoverCard 包在 `span` 中，因此排序规则同时命中 wrapper `span` 与未包裹的 `[data-row-key]`；flex 容器只在存在直接 session 行的 `[role="tree"]` 或 workspace 分组上启用，并给 wrapper 加 `flex: 0 0 auto` 防止滚动列表压缩行高。


### 0.1.0 隔离 Web Host E2E

用同一个 `0.2.1-rc.2` CLI 在临时 `DSH_HOME` 启动真实 web host，安装本插件，用 Chrome 驱动真实 UI：

- 启动日志出现 `[draft-rows] installed; New Session mode = multi`。
- 输入 `hello draft` 后侧边栏行变为 `草稿｜hello draft`，`data-dsh-draft="true"`，编辑器文本一致。
- 再点 New Session：新增 `新会话` 行，原 `草稿｜hello draft` 行保留（多草稿）。
- 点击旧草稿行：编辑器恢复 `hello draft`。
- 刷新页面：两行仍在，当前草稿文本恢复。
- 切到 `single` 并刷新：再点 New Session 不再新增行，编辑器仍是 `single test`（单槽 A 行为）。

截图：[assets/dsh-draft-rows.png](assets/dsh-draft-rows.png)

## 桌面端安装（需要你在 App 内完成）

`desktop` profile 被 Electron 独占，CLI 的 `dsh plugin --profile desktop ...` 会被拒绝，因此用应用内插件管理器：

1. DSH Desktop → 设置 → 插件 → 添加插件。
2. 输入本地目录：`/Users/lives/Github/ai-catalog/plugins/dsh-draft-rows`
3. 确认安装；如果提示需要重启，完全退出并重新打开 DSH Desktop。
4. 打开一个新会话，输入一段文字，不发送；再点「新会话」：
   - 旧行应显示为 `草稿｜…`；
   - 新会话为空；
   - 点旧行能回到原文；
   - 刷新后仍在。

回滚：

- 优先在 设置 → 插件 中卸载 `dsh-draft-rows`，重启。
- 极端情况下恢复安装前的 profile 清单：
  `~/.dsh/profiles/desktop/package.json.bak-20261019-pre-draft-rows`
  然后移除 `~/.dsh/profiles/desktop/node_modules/dsh-draft-rows`（如果是 link）并重启。

## 已知限制

- 草稿附件仍不在 stock conversation 快照里；附件-only 草稿显示 `[附件]` 并视为占用，但附件本身切换后会丢。
- 草稿行通过 `sessions.list.getSnapshot` 投影实现；未来 renderer/状态形状变化时需要重新验证。
- 置顶排序是 CSS `order` 的纯视觉排序：DOM 顺序与键盘上下导航仍是 stock 顺序，草稿可能视觉上在置顶行之前、但焦点仍按源顺序移动。
- 排序容器依赖 HoverCard 的 `span` 包裹与 `[role="treeitem"][data-row-key]` 结构；未来 renderer 改用别的包裹层时需要重新验证 `:has(> span > …)` 选择器。
- 草稿行禁用了双击重命名（预览标题优先）；行菜单里的 Rename 仍可能存在，但显示仍以预览为准。
- 桌面端升级后如果 `startSession`/`list` 形状变化，插件会降级为 stock；需要按版本重新验证。
- App 更新可能重置 profile 配置；升级后检查插件是否仍在。
