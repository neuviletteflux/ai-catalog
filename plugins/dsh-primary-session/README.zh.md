# dsh-primary-session

[English](https://github.com/neuviletteflux/ai-catalog/blob/main/plugins/dsh-primary-session/README.md) | **简体中文**

在 DSH 侧栏给每个工作区标记一个**唯一主会话**。

![行首「主」徽标与会话行菜单](https://raw.githubusercontent.com/neuviletteflux/ai-catalog/main/plugins/dsh-primary-session/assets/primary-badge.png)

![会话行菜单里的「设为主会话」](https://raw.githubusercontent.com/neuviletteflux/ai-catalog/main/plugins/dsh-primary-session/assets/dsh-primary-session.png)

| 项目 | 值 |
|---|---|
| 版本 | `0.1.0` |
| DSH Host | `0.2.1-rc.2` 已验证（Web 客户端） |
| 状态 | experimental |
| Node.js | 22.19+ 或 24+ |
| 网络 | 无 |
| 存储 | 复用 Host 置顶集合；`dsh.primary.badge.style` |

社区插件，不是 DeepSeek 官方产品。

## 做什么

DSH 已经内置**置顶**：置顶的会话会排到所属工作区分组最前，行尾常驻图钉。但每个工作区可以置顶多个，多开并行会话后置顶区又会变得和普通列表一样难分辨。

本插件在置顶之上加一个会话行菜单项：

| 菜单项 | 行为 |
|---|---|
| **设为主会话** | 先取消**同一工作区**（未分组会话算一个桶）里其它置顶会话，再置顶当前会话 |
| **取消主会话** | 只取消当前会话的置顶，不动其它工作区 |

列表里每个工作区最多一个主会话：取 Host 置顶列表（最近置顶在前）中属于该工作区的第一条。该行在行首显示一个强调色的**「主」徽标**（行尾仍保留内置图钉），并排在普通行之前。不新增 schema 或会话事件；可选的徽标样式是唯一新增的 localStorage 键。已归档会话不提供该项（Host 上置顶与归档互斥）。

### 徽标样式

徽标样式可通过 localStorage 选择，刷新后生效：

```js
localStorage["dsh.primary.badge.style"] = "soft"; // solid | soft | outline | circle | star | bar
```

`bar` 是默认值；`star` 和 `bar` 不显示文字（无障碍名称仍为 “Primary session”），`bar` 是行首 3px 强调色条。删除该键恢复 `bar`；颜色取主题强调色。

![徽标样式选项](https://raw.githubusercontent.com/neuviletteflux/ai-catalog/main/plugins/dsh-primary-session/assets/badge-styles.png)

## 安装

本包是一个 DSH Profile Bundle，不需要先 clone。

### 桌面应用（推荐）

**设置 → 插件 → 添加插件**，粘贴：

```text
github:neuviletteflux/ai-catalog#path:/plugins/dsh-primary-session
```

然后重启 DSH。同一个输入框也接受 npm 包名、Git 地址和本机绝对目录。

### CLI（非 desktop profile）

```bash
dsh plugin --profile web add 'github:neuviletteflux/ai-catalog#path:/plugins/dsh-primary-session'
```

`desktop` profile 由应用独占：普通 `dsh plugin --profile desktop …` 会被拒绝。桌面端请用上面的应用内入口。

### 固定版本

上面的命令跟随 `main`。需要冻结安装时，把 `<full-commit>` 换成完整 commit hash：

```text
github:neuviletteflux/ai-catalog#<full-commit>&path:/plugins/dsh-primary-session
```

### 本地开发

```bash
dsh plugin --profile web add link:/path/to/ai-catalog/plugins/dsh-primary-session
```

不要把 GitHub 安装和本地 link 装进同一个 profile：同一个包会从两个来源解析。

#### 开发期挂载（与 Bundle 安装互斥）

调试时可以用 home 层 patch 直接挂载包：

```yaml
- insert:
    - id: dsh-primary-session
      name: /path/to/ai-catalog/plugins/dsh-primary-session/lib/index.js
```

**不要和 Profile Bundle 安装同时使用**：同一个包会从两个激活的 Loader 来源解析，客户端模块组合会报错。

## 升级

GitHub 安装跟随 Git ref。升级时先移除旧包，再重新安装，然后重启：

```bash
dsh plugin --profile web remove dsh-primary-session
dsh plugin --profile web add 'github:neuviletteflux/ai-catalog#path:/plugins/dsh-primary-session'
```

桌面应用则在设置页移除插件，重新添加地址，再重启。升级不会改变 Host 置顶集合。

## 使用

1. 打开会话行菜单。
2. 选 **设为主会话**：同一工作区里其它置顶会话会被取消置顶；当前行排到最前并显示「主」徽标。
3. 选 **取消主会话**：只取消当前行的置顶。

## 卸载

在设置页移除插件，或执行：

```bash
dsh plugin --profile web remove dsh-primary-session
```

然后重启 DSH。使用开发期挂载的，改为删除对应的 home patch 条目。无需先取消置顶；Host 置顶集合会保持原样。

## 兼容性与失败行为

在 DSH `0.2.1-rc.2`（桌面版）验证。依赖
`sidebar.workspaces.session.menu.item` slot 与客户端 `workspaces` 服务
（`list` + `pinSession` / `unpinSession`）。缺任一面时菜单项不会注册；Host 调用失败只打一条 console warning，置顶状态以 Host 返回为准（workspace 插件的通知通道未对外暴露）。`engines.dsh` 只是目标范围，不是兼容性保证；只有上面这个版本经过验证。

## 存储

主会话选择复用 Host 已有的置顶集合
（`<DSH_HOME>/storages/workspace.json` → `global.pinnedSessionIds`），刷新、换浏览器都保留。可选的徽标样式按浏览器存在 localStorage 的 `dsh.primary.badge.style`。

## 边界

- 唯一性是**每个工作区**（未分组会话算一个桶），不是全局唯一。
- 手动再置顶第二个会话会打破唯一；此时“最近置顶”的那条成为主会话（徽标跟着移动），再点一次「设为主会话」即可收敛回一个。
- 「主」徽标位于行首 seat，该 seat 只在会话 idle 时渲染；运行中的行显示状态点，此时仍以行尾图钉标记。
- 直接调用 `workspaces` 服务只更新 Host 置顶集与置顶分区，不会像内置置顶按钮那样顺带改写本地保存的手动拖拽顺序。

## 工作原理

- 注册一个 `sidebar.workspaces.session.menu.item` 菜单项。
- 读取 Host 置顶列表，为每个工作区第一条置顶行渲染行首「主」徽标。
- 设为主会话调用现有的 `pinSession` / `unpinSession` 服务；不新增 schema 或会话事件。
- 不修改任何 DSH 核心文件。

## 数据与安全

插件不发起网络请求，没有遥测，不读取凭据。它修改 Host 已有的置顶集合；只有选择非默认样式时才写一个 localStorage 键。卸载后这些置顶仍保留。

## 故障排查

- **菜单项不见了。** 确认插件已启用、DSH 是 `0.2.1-rc.2` 或兼容构建，并在安装后重启。已归档的行按设计不提供该项。
- **徽标没有移动。** 手动置顶其它会话也会改变主会话；再点一次「设为主会话」即可收敛。
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

实现与真实 UI 的 E2E 记录见 [VERIFICATION.md](https://github.com/neuviletteflux/ai-catalog/blob/main/plugins/dsh-primary-session/VERIFICATION.md)。

## 分发状态

目前没有发布 npm 包。GitHub 是受支持的安装渠道；需要可复现安装时请固定完整 commit。变更记录见 [CHANGELOG.md](https://github.com/neuviletteflux/ai-catalog/blob/main/plugins/dsh-primary-session/CHANGELOG.md)，维护者发布流程见 [RELEASING.md](https://github.com/neuviletteflux/ai-catalog/blob/main/RELEASING.md)。

## License

MIT，见 [LICENSE](https://github.com/neuviletteflux/ai-catalog/blob/main/plugins/dsh-primary-session/LICENSE)。
