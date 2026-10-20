# dsh-session-naming 实施与验证记录

日期：2026-10-20
目标版本：DSH Desktop `0.2.1-rc.2`

## 已实现

- 打包为 DSH Profile Bundle：`package.json` 声明 `dsh.bundle.patch`，包内
  `cordis.patch.yml` 用包名插入一行 `id: session-naming`。
- 工具层完整移植：
  - `set_session_title`：按会话创建日拼 `[Branch｜]MMDD｜类型｜目标`，校验词表、
    `seq` 与字节预算；分叉会话自动加 `Branch｜`；返回服务实际接受的标题与字节数。
  - `rename_session`：调用 Host 的 `sessionController.rename`（Web GUI 同一业务方法）；按投影缓存判断
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
├── lib/audit.js          # 只读标题审计（投影缓存）
├── lib/branch.js         # fork 判定、继承标题识别（只读）
├── lib/title-tools.js    # set_session_title / rename_session
├── lib/index.js          # 配置校验与插件组装
├── tests/                # 69 项 node:test
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

结果：**69 项通过，0 失败**。覆盖：

- `compose.js`：创建日 `MMDD`、非法时间戳、词表、目标校验、`seq`、分支前缀、
  `AUTO` 序号、字节预算与 UTF-8 截断；
- `normalizer.js`：规范标题识别、类型加权打分、纯疑问句/失败疑问句、码点安全截断、任意类型前缀剥离、
  分支拼装、字节预算、首条人类消息提取、`settleMs` 校验、各类跳过条件、追加事件
  形状、稳定窗口重置、dispose 清理定时器；
- `branch.js`：fork 判定、父标题匹配、首条空 `messageSeqs` 标题事件、subagent 排除；
- `title-tools.js`：工具注册/注销、人工标题 guard、`force`、分叉继承放行、
  分支判定（`isSeeded` / `inheritedEventCount` / `origin: subagent` / 投影缓存）、普通/分支/`raw`/`AUTO`
  标题、截断报告、预算报错、网关调用参数、缺失网关与空参数错误；
- `audit.js`：投影缓存扫描、limit、合规/分支/无效前缀/AUTO 缺序号/重复统计；
- `index.js`：配置默认值、未知键、类型错误、单半边启用、挂载与 dispose。

### P0 优化（0.1.1）

- 类型判定从“固定顺序首命中”改为加权打分：标题强信号 3、标题开头动作词 +2、
  标题结尾交付物 +3、首条消息强信号 1；纯疑问句归 `查询`，失败疑问句归 `排障`。
- 前缀剥离改为任意 `MMDD｜短类型｜`，覆盖词表外类型，`1020｜开发｜…` 不再把
  日期/类型带进目标。
- `isBranchSession` / `isInheritedForkTitle` 用 `header.origin === "subagent"` 排除
  子代理，避免给 subagent 加 `Branch｜`。
- 新增回归：8 条误判样例、未知类型前缀、subagent 分支；测试 51 → 54。

### P1a 分叉自动规范化（0.2.0–0.2.2）

- fork 子会话仍带着继承的 `父标题 (n)` 时，自动改写成
  `Branch｜MMDD｜类型｜目标`，并去掉末尾 `(n)`。
- 仅当 `isInheritedForkTitle` 为真时改写；fork 上的人工改名、`origin: subagent`、
  没有人类消息 seq 的 fork 一律跳过。
- 继承标题的 `messageSeqs` 为空，provider 修订改为引用继承日志里的第一条人类消息
  seq，满足 DSH 的不变式。
- fork 的继承标题不等待 `settleMs`，用 0ms 快速路径，避免冷 fork 在定时器触发前
  被回收。
- 抽出 `lib/branch.js` 供工具与规范化器共用；测试 54 → 62。
- 0.2.2 起 `rename_session` 对 fork 先去掉末尾 `(n)` 再加 `Branch｜`。
- 0.3.0 新增只读 `session_title_audit`，并收紧 `AUTO`：必须带 `seq`，标题必须
  以 `-NN` 结尾；测试 62 → 69。
- 0.2.1 修复 `rename_session`：直接调用 Host 的
  `sessionController.rename({ sessionId, title })`；旧的 `typertGateway.invoke`
  请求缺少 Peer 上下文，live 调用会报 `reading 'signal'`。
- live 验证：把旧 fork `session-596df7d1…` 的标题设为
  `1016｜规划｜重构控制台页面方案 (1)` 后，规范化器日志记录
  `03:02:49.356Z … (user) → "Branch｜1016｜规划｜重构控制台页面方案"`；会话日志
  seq 1841 的 provider 修订带 `messageSeqs: [8]`，投影缓存同步为
  `Branch｜1016｜规划｜重构控制台页面方案`。

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

结果：16 个文件、27.3 kB tarball；包含 `lib/`、`cordis.patch.yml`、`locale/`、
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

## desktop profile 安装与清理记录（2026-10-20）

- 提交 `d818e7d`（0.1.0）、`e4b893a`（安装验证）、`507a21c`（0.1.1 P0）、
  `8b1abed`（0.2.0 P1a）、`438f8e6`（0.2.1 rename 修复）、`44adb41`（0.2.2
  序号清理）已推送到 `origin/main`。
- 首次从 GitHub 安装 0.1.0 后，按要求卸载并清理旧插件；0.1.1、0.2.0、0.2.1、
  0.2.2 发布后分别再次 `remove` → `add`；当前锁文件解析到 `44adb41`：

  ```bash
  '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh' \
    plugin --profile desktop remove dsh-session-naming
  '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh' \
    plugin --profile desktop add \
    'github:neuviletteflux/ai-catalog#path:/plugins/dsh-session-naming'
  ```

  结果：`+ dsh-session-naming 0.2.2`；profile `package.json` 的 dependencies 与
  `dsh.profile.bundles` 均包含该包；锁文件指向 `44adb41`。
- `~/.dsh/cordis.patch.yml` 中两段旧 insert 及迁移说明都已删除；YAML 解析通过，
  全文 0 处 `session-naming`。
- 旧插件目录 `~/.dsh/plugins/session-naming/` 已归档到
  `~/.dsh/backups/session-naming-legacy-20261020.tar.gz` 后删除；归档同时包含迁移前
  的 patch 备份。
- 重新安装后运行中的 App 连续热加载：0.1.0 `02:21:05.069Z`、0.1.1
  `02:46:40.015Z`、0.2.0 `03:00:43.615Z`、0.2.1 `03:02:38.479Z`、0.2.2
  `03:04:11.959Z`，均为 `loaded (settleMs=10000)`。不需要等待重启；重启仍然安全。
- 热加载后用 0.1.1 的 `set_session_title` 实测：标题设为
  `1020｜实施｜会话命名 P0 类型与分支优化`（53/80 字节，`force` 覆盖旧的人工标题）。
- 0.2.1 的 `rename_session` 实测成功后，旧 fork `session-596df7d1…` 被自动规范化：
  `03:02:49.356Z` 的日志与 seq 1841 的 provider 修订（`messageSeqs: [8]`）见上。
- 0.2.2 的 `rename_session` 实测：对同一 fork 传入
  `Branch｜1016｜规划｜重构控制台页面方案 (1)`，返回
  `Branch｜1016｜规划｜重构控制台页面方案`，并提示「已去掉末尾的 (n)」。
- `dsh --profile desktop --dump-config` 被应用拒绝
  （`profile "desktop" is managed exclusively by the Electron application`），
  因此组合结果以 profile `package.json` 与安装目录为准。

## 未验证 / 限制

- **desktop 冷启动仍建议观察一次**：热加载已通过 `loaded (settleMs=10000)` 证明；
  重启后的工具注册与标题改写属于同一代码路径，但冷启动本身未单独记录。
- **未验证真实 GUI 的插件卡片**：locale 标题/描述与图标已通过静态校验，但设置页
  的渲染未在桌面端实际查看。
- **类型推断是加权启发式**：标题权重高于首条消息，但仍读不懂真实意图；偏了用
  `set_session_title` 修正。P0 只改判定，不回溯改写已有标题。
- **分叉自动规范化只处理继承标题**：fork 上的人工改名、没有人类消息 seq 的 fork、
  以及定时器触发前已被回收的冷 fork 可能保持原样；这些情况由工具或后续 backfill 处理。
- **未做模型调用/网络验证**：本插件按设计不发起网络请求，也不调用 LLM。
- **旧的无效类型前缀案例已修复**：0.1.1 起前缀剥离覆盖词表外类型，不再残留
  `1020 开发`；历史标题本身不会回溯改写。

## 迁移到 Bundle 时的注意事项（已执行）

桌面端原先使用开发期挂载（`~/.dsh/cordis.patch.yml` 两段 insert，指向
`~/.dsh/plugins/session-naming/`）。安装 Bundle 前必须先删除这两段，否则：

- 同一个包会从两个 Loader 来源解析；
- `set_session_title` 与 `rename_session` 会被注册两次；
- 规范化器可能对同一标题追加两次修订。

本次已按「安装 Bundle → 删除 home patch 两段 → 重新安装并确认热加载」执行；旧文件
归档后删除。若要回滚，解压
`~/.dsh/backups/session-naming-legacy-20261020.tar.gz`，恢复旧插件目录与 patch，
移除 profile 里的 `dsh-session-naming`，然后重启。
