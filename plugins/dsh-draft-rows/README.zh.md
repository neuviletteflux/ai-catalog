# dsh-draft-rows

[English](https://github.com/neuviletteflux/ai-catalog/blob/main/plugins/dsh-draft-rows/README.md) | **简体中文**

未发送的「新会话」会以草稿行的形式留在 DSH 侧边栏。每个 workspace 只保留一个「新会话」行，写了文字的草稿各自成行；点「新会话」不再每次都新建一个 session id。

![DSH 侧边栏中的草稿行](https://raw.githubusercontent.com/neuviletteflux/ai-catalog/main/plugins/dsh-draft-rows/assets/dsh-draft-rows.png)

| 项目 | 值 |
|---|---|
| 版本 | `0.2.0` |
| DSH Host | `0.2.1-rc.2` 已验证（Web 客户端，0.2.0 E2E） |
| 状态 | experimental |
| Node.js | 22.19+ 或 24+ |
| 网络 | 无 |
| 存储 | `dsh.conversation.*`、`dsh.drafts.v1`、`dsh.drafts.mode` |

社区插件，不是 DeepSeek 官方产品。

## 做什么

- 草稿行实时显示输入框里未发送文字的预览（`草稿｜…`）。
- 每个 workspace 只有一个「新会话」行：多余的空草稿会折叠到当前空草稿；当前行不为空时折叠到最新的空草稿。
- 新会话复用这个空草稿；只有所有草稿都有文字时，才新建 session id（Cursor / Telegram 的行为）。
- 已经写了文字的草稿保持为独立行；点回去，文字原样恢复。
- 草稿行在所属 workspace 内排在普通会话和**置顶会话**之前。
- 切走再切回、刷新页面，草稿都不会丢。
- 通过行菜单的**归档**丢弃草稿，预览会同步清理。

## 安装

本包是一个 DSH Profile Bundle，不需要先 clone。

### 桌面应用（推荐）

**设置 → 插件 → 添加插件**，粘贴：

```text
github:neuviletteflux/ai-catalog#path:/plugins/dsh-draft-rows
```

然后重启 DSH。同一个输入框也接受 npm 包名、Git 地址和本机绝对目录。

### CLI（非 desktop profile）

```bash
dsh plugin --profile web add 'github:neuviletteflux/ai-catalog#path:/plugins/dsh-draft-rows'
```

`desktop` profile 由应用独占：普通 `dsh plugin --profile desktop …` 会被拒绝。桌面端请用上面的应用内入口。

### 固定版本

上面的命令跟随 `main`。需要冻结安装时，把 `<full-commit>` 换成完整 commit hash：

```text
github:neuviletteflux/ai-catalog#<full-commit>&path:/plugins/dsh-draft-rows
```

### 本地开发

```bash
dsh plugin --profile web add link:/path/to/ai-catalog/plugins/dsh-draft-rows
```

不要把 GitHub 安装和本地 link 装进同一个 profile：同一个包会从两个来源解析。

## 升级

GitHub 安装跟随 Git ref。升级时先移除旧包，再重新安装，然后重启：

```bash
dsh plugin --profile web remove dsh-draft-rows
dsh plugin --profile web add 'github:neuviletteflux/ai-catalog#path:/plugins/dsh-draft-rows'
```

桌面应用则在设置页移除插件，重新添加地址，再重启。升级不会删除草稿或会话数据。

## 使用

1. 新建会话，输入文字，不发送，切到别的会话。
2. 草稿会以 `草稿｜…` 留在侧边栏；点回去可以继续。
3. 再点 **新会话** 会回到那个可见的空草稿；只有所有草稿都有文字时才新建 id。
4. 用行菜单的**归档**丢弃草稿。

### 单槽模式

默认是 **multi**（复用空草稿；有文字的草稿各自成行）。如果需要 `0.2.1` 之前的**单槽**行为（即使草稿已有文字，也复用 workspace 的那个 blank），改一个 localStorage 键：

```js
localStorage["dsh.drafts.mode"] = "single"; // 然后刷新
```

删除这个键（或设为 `"multi"`）即可恢复默认。

## 卸载

在设置页移除插件，或执行：

```bash
dsh plugin --profile web remove dsh-draft-rows
```

然后重启 DSH。卸载不会删除草稿、会话或上面的 localStorage 键；重新安装后这些草稿可能再次出现。

## 兼容与限制

0.2.0 已在 DSH `0.2.1-rc.2` 上验证：单元测试，加上隔离 Web Host E2E，覆盖单行折叠、New Session 复用、刷新恢复和置顶行之前的排序。所有补丁都是实例级、带特性检测；服务或形状不匹配时保持 stock 行为不变，只打印一条 warning。client bundle 通过 `window.__ModuleLoader__.load` 加载，与其他 DSH 客户端插件走同一通道。`engines.dsh` 只是目标范围，不是兼容性保证；只有上面这个版本经过验证。

已知限制：

- 被折叠的空草稿仍然存在于 Host，并会被复用，不会删除。单行规则按 workspace 计算，未分组会话算一个 workspace。
- stock conversation 快照不包含草稿附件；只有附件的草稿会显示 `[附件]` 预览并被当作“已占用”，但附件本身在切换后仍会丢失。
- 草稿行通过 `sessions.list.getSnapshot` 投影实现；未来 renderer 变化时需要重新验证。预览文字、标题和新会话规则不依赖 DOM class。
- 置顶排序只是视觉上的：CSS `order` 把草稿行提到置顶行之前，但 DOM 顺序与键盘上下导航仍是 stock 顺序，焦点可能按原顺序移动。
- 排序容器依赖当前的 HoverCard `span` 包裹与 `[role="treeitem"][data-row-key]` 结构；renderer 改动后可能需要重写选择器。
- 草稿行禁用了双击重命名（标题由预览决定）；行菜单里的 Rename 仍可能打开，但显示仍以预览为准。

## 工作原理

- 替换 `uiWorkspace.startSession`，让新会话复用空草稿。
- 影子化 `sessions.list.getSnapshot`，把每个 blank 草稿投影成带预览标题的普通行。
- 每个 workspace 只保留一个可见空草稿：优先当前空草稿，否则用最新的空草稿。
- 用 CSS `order` 把草稿行提到普通行和置顶行之前；唯一的「新会话」行单独标记。
- 订阅 `conversation.input`，把当前输入镜像到 `dsh.drafts.v1`，刷新后仍能恢复预览。
- 不修改任何 DSH 核心文件。

## 数据与安全

- 草稿正文：`dsh.conversation.<sessionId>`（沿用 stock conversation store）。
- 预览镜像：`dsh.drafts.v1`（sessionId → `{ p, at }`），最多 200 条。首次安装时还会扫描 `dsh.conversation.*`，把 stock 0.2.1 遗留的孤儿草稿重新显示出来。
- 插件不发起网络请求，没有遥测，不读取凭据。它不会删除会话；丢弃草稿走 stock Host 的归档。

## 故障排查

- **草稿行不见了。** 确认插件已启用、DSH 已重启，并确认该会话还没有产生 turn。已有 turn 的是普通会话，不是草稿。
- **草稿文字丢了。** 附件不会被 stock 快照持久化（见限制）；localStorage 也按浏览器和 Host 隔离，确认你在同一个 profile 和 origin。
- **新会话仍然每次新建。** 检查安装版本，并确认没有同时激活第二份副本（GitHub bundle + 本地 link）；安装后要重启。
- **`dsh plugin --profile desktop …` 报错。** 这是预期行为：desktop profile 由应用管理，请从设置页安装。
- **DSH 升级之后。** 重新安装并重新验证；当前构建只针对 `0.2.1-rc.2` 测试。

## 开发

```bash
node --test tests/logic.test.mjs tests/apply.test.mjs
```

在 catalog 仓库根目录校验元数据：

```bash
python3 scripts/validate_metadata.py
```

实现与真实 UI 的 E2E 记录见 [VERIFICATION.md](https://github.com/neuviletteflux/ai-catalog/blob/main/plugins/dsh-draft-rows/VERIFICATION.md)。

## 分发状态

目前没有发布 npm 包。GitHub 是受支持的安装渠道；需要可复现安装时请固定完整 commit。变更记录见 [CHANGELOG.md](https://github.com/neuviletteflux/ai-catalog/blob/main/plugins/dsh-draft-rows/CHANGELOG.md)，维护者发布流程见 [RELEASING.md](https://github.com/neuviletteflux/ai-catalog/blob/main/RELEASING.md)。

## License

MIT，见 [LICENSE](https://github.com/neuviletteflux/ai-catalog/blob/main/plugins/dsh-draft-rows/LICENSE)。
