# Agent 说明与运行手册 (AGENT.md)

版本: 0.1.0
作者: neuviletteflux
仓库: neuviletteflux/ai-catalog

概述
---
本文件描述一个用于 ai-catalog 仓库的“Agent”角色（自动化代理）的职责、能力、运行方式与配置。Agent 是开发者/维护者在 CI、开发环境或本地用来自动化常见任务的脚本集合或服务（例如：schema 校验、自动化测试、打包/发布、样例评估、prompt 回归测试、按需安装技能等）。

目的
---
- 自动化 metadata/schema 校验与静态检查，保持仓库一致性
- 在 PR/提交时运行测试、lint 和 secrets 检查，防止敏感信息泄露
- 提供一键安装/初始化工作流，帮助在多台设备上快速重现开发环境
- 提供 CLI/Agent 接口以按需安装/运行 skills 与 prompts
- 收集/记录评估结果（prompt/skill 回归）以便持续质量监控

Agent 能力一览
---
- validate-metadata: 扫描仓库中的 skill.yaml/plugin.yaml/prompt.* 文件并用 JSON Schema 校验
- scan-secrets: 基于正则的简单 token/secret 检测（CI 阶段阻断）
- run-tests: 运行 pytest 并上报结果
- install-environment: 在目标机器上创建虚拟环境并安装依赖（requirements.txt）
- cli-proxy: 提供 CLI（tools/cli）命令：list / install / run / update
- evaluate-prompt: 在指定模型或评估环境上运行 prompt 的示例和回归测试（可选，需外部模型访问）
- pack-release: 当子组件（skill/plugin）版本变更时，创建 release 注记或打包 artifacts

运行模式
---
1. 在 CI 中（recommended）
   - 触发点：push / pull_request
   - 工作流：checkout -> setup python -> pip install -r requirements.txt -> scripts/validate_metadata.py -> secrets scan -> pytest
   - 结果：失败时阻断合并；成功时通过验证

2. 本地交互式（开发者）
   - 命令行：python -m tools.cli <command>
   - 示例：python -m tools.cli list

3. 守护/定时（可选）
   - 周期性运行评估任务（prompt 回归、依赖漏洞扫描等），并将结果输出到 artifacts 或外部存储

配置与环境变量
---
- GITHUB_TOKEN：CI 或 agent 需要时用于与 GitHub API 交互（创建 release、注记 PR）
- PYPI_TOKEN / NPM_TOKEN：发布到包管理平台时使用（如需要）
- AGENT_CONFIG（可选，指向仓库内或外部的 YAML/JSON 配置文件）：定义评估模型、频率、白名单/黑名单

示例 AGENT 配置（.github/agent-config.yaml）
```yaml
evaluate:
  enabled: false
  model: gpt-4o
  schedule: "@weekly"
validate:
  secrets_scan: true
  schema_paths: ["schema/*.json"]
publish:
  enabled: false
```

CLI 与 Agent 命令（tools/cli）
---
- list
  - 说明：列出仓库中注册的 skills / plugins / prompts
  - 示例：python -m tools.cli list --type=skill
- install <id>
  - 说明：从 catalog 中安装指定的 skill/plugin（将实现复制到本地或创建 symlink，并安装其依赖）
  - 示例：python -m tools.cli install example-skill
- run <id> [--input]
  - 说明：运行本地已安装 skill 的主入口（用于快速验证）
  - 示例：python -m tools.cli run example-skill --input "hello"
- validate
  - 说明：执行 metadata/schema 校验与 secrets 扫描（本地）
  - 示例：python -m tools.cli validate

Agent 日志与可观察性
---
- 在 CI 中：将验证日志和 pytest 报告作为 job 日志与 artifacts（可选）
- 本地运行：将 agent 输出到 ./logs/agent.log（可在配置中指定）
- 定期任务：将评估结果保存到 ./artifacts/evaluations/ 下

权限与安全
---
- 禁止在仓库中提交明文 credentials（CI 会阻断常见 token 模式）
- Agent 在运行发布或与外部系统交互时应使用短期 token 并限制作用域
- 对敏感 prompt 或 private plugins 建议使用私有仓库或受限分支保护、CODEOWNERS 审核

示例工作流（PR 验证）
---
1. 用户提交 PR 更改 skills/xxx/skill.yaml
2. CI checkout 并运行 validate.yml
3. scripts/validate_metadata.py 校验 metadata
4. secrets scan 检测敏感信息
5. pytest 运行实现代码测试
6. 若全部通过，PR 可合并；若失败，发送失败日志并阻断合并

示例工作流（在新机器上快速初始化）
---
1. git clone https://github.com/neuviletteflux/ai-catalog.git
2. cd ai-catalog
3. ./install.sh    # 创建 .venv、pip install -r requirements.txt、生成本地配置
4. python -m tools.cli list
5. python -m tools.cli install example-skill
6. python -m tools.cli run example-skill --input "hello"

扩展点（未来功能）
---
- 集成模型执行环境（例如：在受控环境中调用 remote LLM 进行 prompt 回归测试）
- 使用数据库或轻量索引服务改进 catalog 的搜索与过滤（tags/owners/status）
- 提供 web UI / Dashboard 来浏览 catalog、触发评估与查看历史结果
- 支持多语言 runtime（自动识别 skill 的 language 并使用相应包装器执行）

常见问题与故障排查
---
Q: validate_metadata.py 报错 schema 字段缺失
A: 检查对应 skill.yaml/plugin.yaml/prompt 文件是否包含 required 字段（id/name/version/status/description/maintainers），并参考 schema/ 下的 JSON Schema

Q: CI 检测到 token，但本地未包含
A: 检查是否在提交中误加入 .env 文件或某些配置文件；可运行 git-secrets 或 trufflehog 本地检测

Q: 如何添加新的 skill?
A: 在 skills/ 下创建新目录，包含 skill.yaml、implementation/、tests/、README.md；提交 PR，CI 会自动校验

免责声明与限制
---
- Agent 仅执行预定义任务；任何涉及对外发布或敏感系统访问的动作都应由有权限的用户手动授权或由带有限作用域 token 的 CI 执行
- 对真实模型评估（调用付费 LLM）会产生成本，请确保在 AGENT_CONFIG 中控制评估频率与模型选择

变更记录
---
- 0.1.0 初始版本：定义 Agent 能力、运行方式、CLI 指南与安全建议

---
