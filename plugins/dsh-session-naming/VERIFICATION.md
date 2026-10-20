# dsh-session-naming 实施与验证记录

日期：2026-10-20
目标版本：DSH Desktop `0.2.1-rc.2`

## 已实现

- 打包为 DSH Profile Bundle：`package.json` 声明 `dsh.bundle.patch`，包内
  `cordis.patch.yml` 用包名插入一行 `id: session-naming`。
- 工具层完整移植：
  - `set_session_title`：按会话创建日拼 `[Branch｜]MMDD｜类型｜目标`，校验词表、
    `seq` 与字节预算；分叉会话自动加 `Branch｜`；返回服务实际接受的标题与字节数。
  - `rename_session`：走与 Web GUI 相同的 `session.rename` 网关；按投影缓存判断
    分支，缓存不可读时不猜。
  - 人工标题保护：`source.kind = "user"` 默认拒绝覆盖；分叉继承的
    「父标题 (1)」用父标题匹配或“首条空 `messageSeqs` 标题事件”两条独立证据放行。
- 自动规范化完整移植：监听 `session/title`，`settleMs` 稳定窗口后追加一条
  `source.kind = "provider"`（provider id `session-naming-convention`）的修订；
  人工标题、已合规标题、子代理/分叉、无人类 `messageSeqs`、自身修订全部跳过。
- 配置：`settleMs`（0-600000，默认 10000）、`tools`、`normalizer`；未知键和错误
  类型在激活时报错。`tools: false` 可只保留自动规范化，`normalizer: false` 可只保留
  工具。
- 显示元数据：`locale/en.json`、`locale/zh.json`、`assets/icon.svg`，均列入
  `exports` 与 `files`。
- 不新增网络请求、模型调用或 DSH 数据文件写入；分支判定只读投影缓存。

## 代码位置

```text
plugins/dsh-session-naming/
├── plugin.yaml           # ai-catalog 元数据（schema/plugin.schema.json）
├── package.json          # dsh.bundle.patch、exports、files、engines
├── cordis.patch.yml      # insert: session-naming（含默认 config）
├── lib/compose.js        # 标题拼装、词表、字节预算（纯函数）
├── lib/normalizer.js     # 自动规范化、类型推断、稳定窗口监听
├── lib/title-tools.js    # set_session_title / rename_session
├── lib/index.js          # 配置校验与插件组装
├── tests/                # 51 项 node:test
├── locale/               # en / zh 显示元数据
├── assets/icon.svg       # 原创图标
├── README.md / README.zh.md
└── CHANGELOG.md
```

## 自动化验证

### 单元测试

```bash
cd /Users/lives/Github/ai-catalog/plugins/dsh-session-naming
npm test
```

结果：**51 项通过，0 失败**。覆盖：

- `compose.js`：创建日 `MMDD`、非法时间戳、词表、目标校验、`seq`、分支前缀、
  `AUTO` 序号、字节预算与 UTF-8 截断；
- `normalizer.js`：规范标题识别、类型关键词顺序与兜底、码点安全截断、前缀剥离、
  分支拼装、字节预算、首条人类消息提取、`settleMs` 校验、各类跳过条件、追加事件
  形状、稳定窗口重置、dispose 清理定时器；
- `title-tools.js`：工具注册/注销、人工标题 guard、`force`、分叉继承放行、
  分支判定（`isSeeded` / `inheritedEventCount` / 投影缓存）、普通/分支/`raw`/`AUTO`
  标题、截断报告、预算报错、网关调用参数、缺失网关与空参数错误；
- `index.js`：配置默认值、未知键、类型错误、单半边启用、挂载与 dispose。

### 元数据校验

```bash
cd /Users/lives/Github/ai-catalog
uv run --with pyyaml --with jsonschema python scripts/validate_metadata.py
```

结果：`All metadata files validated successfully.`。覆盖 `plugin.yaml` schema、
`package.json.name` 与目录 id 一致、`./locale/*.json` 导出、`files` 白名单、中英文
`meta.title`/`meta.description`、图标路径/格式/大小。

### 打包内容

```bash
cd plugins/dsh-session-naming
npm pack --dry-run
```

结果：14 个文件、19.6 kB tarball；包含 `lib/`、`cordis.patch.yml`、`locale/`、
`assets/icon.svg`、两份 README、`CHANGELOG.md`、`LICENSE`、`plugin.yaml`、
`package.json`；不包含 `tests/`。

## 隔离环境集成验证

在实验 home `~/.dsh-alpha`（同一 DSH `0.2.1-rc.2`）中以 `link:` 安装到 `web`
profile：

```bash
~/.local/bin/dsh plugin --profile web add 'link:/Users/lives/Github/ai-catalog/plugins/dsh-session-naming'
~/.local/bin/dsh --profile web --dump-config | grep -A6 'dsh-session-naming'
```

`--dump-config` 输出确认 bundle 行被解析：

```yaml
# == dsh-session-naming
- id: session-naming
  name: dsh-session-naming
  config:
    settleMs: 10000
    tools: true
    normalizer: true
```

启动真实 host：

```bash
~/.local/bin/dsh --profile web --port 19557 --no-open
```

`~/.dsh-alpha/logs/session-naming.log` 新增：

```text
2026-10-20T02:10:11.554Z loaded (settleMs=10000)
```

该行由 `applyNormalizer` 写入；`apply` 先注册两个工具、再安装规范化器，因此这一行
同时证明工具注册路径没有抛错。Web host 正常监听 `127.0.0.1:19557`，无插件加载
错误。

验证后已清理：停止测试 host、`dsh plugin remove dsh-session-naming`、删除残留
`node_modules` 符号链接、从备份恢复 `~/.dsh-alpha/cordis.patch.yml`。未改动 desktop
profile。

## desktop profile 安装记录（2026-10-20）

- 提交 `d818e7d` 已推送到 `origin/main`。
- 使用应用自带 CLI 从 GitHub 安装到 desktop：

  ```bash
  '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh' \
    plugin --profile desktop add \
    'github:neuviletteflux/ai-catalog#path:/plugins/dsh-session-naming'
  ```

  结果：`+ dsh-session-naming 0.1.0`；profile `package.json` 的 dependencies 与
  `dsh.profile.bundles` 均已包含该包，安装目录版本为 `0.1.0`。
- `~/.dsh/cordis.patch.yml` 中两段旧 insert（`session-naming`、
  `session-naming-normalizer`）已替换为迁移说明。YAML 解析通过，全文不再有
  `session-naming` 的挂载值。
- 运行中的 App 尚未重启：旧插件仍处于已加载状态，因此当前会话工具仍可用；已用
  `set_session_title` 设置 `1020｜实施｜会话命名打包为 DSH 插件`（48/80 字节）。
  重启后旧插件不再加载，由 profile bundle 接管。
- `dsh --profile desktop --dump-config` 被应用拒绝
  （`profile "desktop" is managed exclusively by the Electron application`），
  因此组合结果以 profile `package.json` 与安装目录为准。

## 未验证 / 限制

- **重启后的 desktop 行为待观察**：bundle 的运行时加载已在隔离 `web` profile
  验证（`loaded (settleMs=10000)`），desktop 重启后的工具注册与标题改写需要在
  下次启动时确认。
- **未验证真实 GUI 的插件卡片**：locale 标题/描述与图标已通过静态校验，但设置页
  的渲染未在桌面端实际查看。
- **类型推断是关键词启发式**：与人工判断约七成一致，偏了用 `set_session_title`
  修正。
- **自动规范化不处理分叉会话**：`header.parentSession` 存在即跳过；分叉前缀由工具
  在改名时补。
- **未做模型调用/网络验证**：本插件按设计不发起网络请求，也不调用 LLM。
- **观察到一次边缘案例**：自带标题 provider 曾输出形如
  `1020｜开发｜…` 的标题；`开发` 不在类型词表内，规范化器不认为它已合规，改写后
  目标文本仍残留 `1020 开发`。本次已用 `set_session_title` 人工修正；后续如需彻底
  处理，可把前缀剥离规则放宽为任意 `MMDD｜短类型｜`。

## 迁移到 Bundle 时的注意事项（已执行）

桌面端原先使用开发期挂载（`~/.dsh/cordis.patch.yml` 两段 insert，指向
`~/.dsh/plugins/session-naming/`）。安装 Bundle 前必须先删除这两段，否则：

- 同一个包会从两个 Loader 来源解析；
- `set_session_title` 与 `rename_session` 会被注册两次；
- 规范化器可能对同一标题追加两次修订。

本次已按「安装 Bundle → 删除 home patch 两段 → 重启应用」执行，当前处于等待重启
的状态。旧文件 `~/.dsh/plugins/session-naming/` 未删除，可作为回滚备份。
