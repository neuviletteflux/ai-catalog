# dsh-session-naming

[English](README.md) | **简体中文**

把本机的 DSH **会话命名规范**变成默认行为，而不只是写在提示词里。插件分两半：

| 半边 | 作用 |
|---|---|
| Agent 工具 | 新增 `set_session_title`（当前会话）、`rename_session`（按 id 改任意会话），以及只读的 `session_title_audit`。 |
| 客户端 UI | 可选的 Session 行前分叉图标（client bundle 需要重启后加载）。 |
| 自动规范化 | 监听 `session/title`，等自带摘要稳定后追加 `[Branch｜]MMDD｜类型｜目标`。 |

社区插件，不是 DeepSeek 官方产品。

| 项目 | 值 |
|---|---|
| 版本 | `0.4.2` |
| DSH Host | `0.2.1-rc.2` 已验证 |
| 状态 | experimental |
| Node.js | 22.19+ 或 24+ |
| 网络 | 无 |
| 存储 | 只写标题事件；运行日志在 `$DSH_HOME/logs` |

## 命名规范

```text
普通会话       MMDD｜类型｜目标
分支（fork）   Branch｜MMDD｜类型｜目标
自动化运行     MMDD｜AUTO｜任务名称        （同日多次运行追加 -01、-02）
```

- `MMDD` 取**会话创建日**，不是写标题的日期。
- `类型` 取 `分析｜规划｜实施｜排障｜审计｜查询｜整理｜复盘｜AUTO`。
- `AUTO` 专供自动化运行；规范化器不会推断出 `AUTO`。工具要求 `AUTO` 带 `seq`
  （生成 `-01`、`-02`），没有 `-NN` 的标题不算合规。
- 预算取标题服务的 `maxTitleBytes`（桌面 bundle 当前为 80 字节）。`Branch｜`
  前缀占 9 字节。

## 为什么不替换标题 provider

DSH 不同版本发布的 `@deepseek-ai/dsh-session-title-llm` 接口互不兼容：一代导出
`registerSessionTitleLlmProvider` / `generateSessionTitleWithLlm` 且 system prompt
写死，另一代只导出 `executeSessionTitleLlm`，提示词由 provider 提供。替换 provider
必然在其中一个部署上退化。

因此本插件保留自带摘要，改为**追加**一条修订：

1. 自带 fallback 与 LLM provider 先生成可读摘要；
2. 标题 `settleMs` 内没有更新后，规范化器改写它；
3. 修订用 `source.kind = "provider"`（provider id 为
   `session-naming-convention`），标题**不会被钉死**，agent 之后仍可用
   `set_session_title` 修正。

不增加模型调用；目标文本直接复用自带摘要。

## 安装

本包是 DSH Profile Bundle，无构建步骤、无运行时依赖。

### 桌面应用

**设置 → 插件 → 添加插件**，粘贴：

```text
github:neuviletteflux/ai-catalog#path:/plugins/dsh-session-naming
```

装完重启 DSH。同一个输入框也接受 npm 包名、Git 地址和本机绝对目录。

### CLI（非 desktop profile）

```bash
dsh plugin --profile web add 'github:neuviletteflux/ai-catalog#path:/plugins/dsh-session-naming'
```

`desktop` profile 由应用管理：请从设置页安装，不要执行
`dsh plugin --profile desktop …`。

### 固定版本

```text
github:neuviletteflux/ai-catalog#<full-commit>&path:/plugins/dsh-session-naming
```

### 本地开发

```bash
dsh plugin --profile web add link:/path/to/ai-catalog/plugins/dsh-session-naming
```

#### 开发期挂载（与 Bundle 安装互斥）

调试时可以用 home 层 patch 直接挂载模块：

```yaml
- insert:
    - id: session-naming
      name: /path/to/ai-catalog/plugins/dsh-session-naming/lib/index.js
      config:
        settleMs: 10000
```

**不要和 Bundle 安装同时使用**：两个来源会各注册一遍 `set_session_title` 与
`rename_session`，工具注册表会看到重复项。二选一。

## 配置

本包的 patch 插入一行，默认配置如下：

```yaml
- insert:
    - id: session-naming
      name: 'dsh-session-naming'
      config:
        settleMs: 10000
        tools: true
        normalizer: true
```

| 键 | 类型 | 默认 | 含义 |
|---|---|---|---|
| `settleMs` | 整数 `0-600000` | `10000` | 最后一个标题事件之后等多久再规范化；每来一个新标题就重置。 |
| `tools` | 布尔 | `true` | 注册 `set_session_title` / `rename_session`。 |
| `normalizer` | 布尔 | `true` | 启用自动标题改写。设为 `false` 只保留工具，自带摘要行为不变。 |

未知键和错误类型在激活时报错，不会被静默忽略。`tools: false` 加
`normalizer: false` 合法，但插件等于空转。

## 行为细节

### 工具

`set_session_title` 按会话创建日拼标题，返回实际生效的标题、字节数、预算，以及
服务是否发生截断。来源为 `user` 的标题默认拒绝覆盖，只有 `force: true` 才放行；
分叉继承的「父标题 (1)」用两条独立证据判定为非人工命名：

1. 去掉 `(n)` 后等于父会话当前标题；
2. 它是本分支日志里的第一条标题事件，且没有人工 `messageSeqs`。

`rename_session` 调用 Host 的 `sessionController.rename`（Web GUI 的
`session.rename` remote 背后同一业务方法），因此可以改非活跃会话（由 Host 恢复后
改名）。它读取投影缓存判断目标是否分支；缓存不可读时**不猜**，并在结果里说明未加
前缀。

`session_title_audit` 是只读工具：扫描投影缓存，报告合规率、类型分布、分叉缺
`Branch｜`、仍带 `(n)` 的分叉、无效类型前缀、缺 `-NN` 的 `AUTO`，以及同日同目标
重复（父子/分叉同目标单独计数，不算重复）。它不写标题、会话日志或投影缓存。

### 分叉徽标（客户端半侧）

`lib/client.js` 在 `sidebar.session.row.leading` 注册一个紧凑、带 aria 标签的分叉
图标：仅当行的 `SessionSummary` 带 `parentSessionId` 且不是子代理时显示。它只是
视觉辅助，持久标记仍是标题里的 `Branch｜` 前缀。客户端入口单独打包，替换已安装
的包需要重启 App 才会加载新 bundle；客户端加载失败不会影响 Host 工具与规范化器。


### 类型判定

类型不是按固定顺序取第一个关键词，而是分别给标题与首条人类消息打分：

- 标题强信号 +3；标题开头的动作词 +2；标题结尾的交付物（方案/报告/清单/
  复盘/分析）+3；
- 首条人类消息只在强信号时 +1，因此提示词里的“如何”不会压过标题里的动作词；
- 纯疑问句且没有失败信号时归 `查询`；带失败信号的疑问句仍归 `排障`；
- 同分时按 `排障 > 实施 > 审计 > 规划 > 整理 > 复盘 > 分析 > 查询` 取。

仍然是确定性启发式；类型偏了用 `set_session_title` 修正，不增加模型调用。
规范化前会剥掉任意 `MMDD｜短类型｜` 前缀，包括词表外的类型。

### 规范化器的跳过条件

以下情况一律不碰：

- 人工标题（非分叉的 `source.kind = "user"`，或已不再等于继承的 `父标题 (n)`
  的分叉标题）；
- 子代理会话（`header.origin = "subagent"`）；
- 已符合规范的标题（分叉要求带 `Branch｜` 且没有末尾 `(n)`）；
- 没有可引用人类消息 seq 的分叉；
- 自己写的修订（防自触发）。

分叉行为：继承标题会改写成 `Branch｜MMDD｜类型｜目标`，并去掉末尾 `(n)`。
分叉的继承标题本身已经稳定，因此不等待常规 `settleMs` 窗口，而是快速规范化。
修订优先沿用被替换事件的 `messageSeqs`；继承标题的 `messageSeqs` 为空时，引用
继承日志里的第一条人类消息。DSH 的不变式仍然成立：
`messageSeqs` 为空**当且仅当** `source.kind === "user"`。

### 运行日志

`$DSH_HOME/logs/session-naming.log` 记录插件加载与每次改写：

```text
2026-10-20T01:59:28.358Z session session-a0208d93-…: "Session naming skills 实现" (provider) → "1020｜查询｜Session naming skills 实现"
```

日志超过 256 KiB 自动轮转。落盘失败（只读盘等）时日志自行停用，命名功能不受影响。

## 存储与安全

- 不发起网络请求，没有遥测，不读取凭据。
- 不直接写 DSH 数据文件：工具调用标题服务，规范化器追加一条 `session/title` 事件。
- 分支判定只读 `session_projcache`；读不到按「未知」处理，不猜。
- 卸载不会删除已经写入的标题，它们是正常会话事件。

## 兼容性与失败行为

在 DSH Desktop `0.2.1-rc.2` 的标题服务上验证。依赖：

- `ctx.sessionTitle`（`get`、`rename`、`config.maxTitleBytes`）；
- `ctx.tools.register`；
- `session.append('session/title', …)` 与 `session.header.createdAt`；
- `rename_session` 另需 `sessionController`（`rename`）。

缺少 `sessionController` 时只有 `rename_session` 失败，并明确报告服务未挂载；缺少标题
服务时插件不会激活。`engines.dsh` 只是目标范围，不是兼容性承诺；只有上面的版本
经过实际验证。

## 故障排查

- **工具不见了。** 确认 bundle 已启用、DSH 已重启，并检查没有同时用 home patch
  直接挂载 `lib/index.js`。
- **新标题没有被规范化。** 等过 `settleMs`；人工标题、分叉/子代理、已合规标题、
  没有人类消息引用的标题都会按设计跳过。
- **类型推断不准。** 类型是确定性的加权启发式：标题权重高于首条消息，但读不懂
  真实意图。用 `set_session_title` 修正即可，不需要改配置。
- **重复工具报错。** 删掉 Bundle 或 home patch 其中一个挂载。
- **`dsh plugin --profile desktop …` 报错。** 预期行为：桌面端请用设置页安装。
- **DSH 升级之后。** 重新安装并重跑测试；如果标题服务契约变了，检查
  `session/title` 事件。

## 卸载

在设置页移除插件，或执行：

```bash
dsh plugin --profile web remove dsh-session-naming
```

然后重启 DSH。使用开发期挂载的，改为删除对应 home patch 条目。已经写入的标题会
作为普通会话历史保留。

## 开发

```bash
cd plugins/dsh-session-naming
npm test                      # 72 项 node:test
npm pack --dry-run            # 查看实际打包文件
cd ../..
python3 scripts/validate_metadata.py
```

目录：

```text
lib/compose.js         标题拼装、词表、字节预算（纯函数）
lib/audit.js           投影缓存上的只读标题审计
lib/client.js          浏览器半侧：Session 行分叉图标
lib/branch.js          fork 判定与继承标题识别（只读）
lib/normalizer.js      标题改写、类型推断、稳定窗口监听
lib/title-tools.js     set_session_title / rename_session 定义
lib/index.js           配置校验与插件组装
tests/*.test.mjs       使用假 ctx/session 的单测
```

验证记录与限制见 [VERIFICATION.md](VERIFICATION.md)。
