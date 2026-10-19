# AI Catalog

A public catalog for AI-related assets: skills, plugins, prompts, configs, and reusable workflows.

## Purpose

This repository is designed to keep your AI resources centralized and portable across machines. It allows you to:

- store skills, prompts, and plugin metadata in a version-controlled repository
- install or sync the setup on another device quickly
- validate metadata and config files automatically in CI
- share a clear, maintainable catalog for AI capabilities

## Repository layout

```text
.
├── README.md
├── LICENSE
├── .gitignore
├── .github/
│   ├── workflows/
│   │   └── validate.yml
│   ├── ISSUE_TEMPLATE.md
│   ├── PULL_REQUEST_TEMPLATE.md
│   └── CODEOWNERS
├── schema/
│   ├── skill.schema.json
│   ├── plugin.schema.json
│   └── prompt.schema.json
├── skills/
│   └── example-skill/
│       ├── skill.yaml
│       ├── README.md
│       ├── implementation/
│       │   └── main.py
│       └── tests/
│           └── test_main.py
├── plugins/
│   └── example-plugin/
│       ├── plugin.yaml
│       └── README.md
├── prompts/
│   └── example-prompt.md
├── configs/
│   └── settings.example.yaml
├── docs/
│   └── usage.md
├── tools/
│   └── cli/
│       ├── __init__.py
│       ├── __main__.py
│       └── catalog.py
├── install.sh
├── install.ps1
├── scripts/
│   └── validate_metadata.py
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
└── .devcontainer/
    └── devcontainer.json
```

## Skill metadata (display spec)

Every `skills/<id>/skill.yaml` is validated against [`schema/skill.schema.json`](schema/skill.schema.json). Since `spec_version: "1.1"` a skill must declare its menu face, so a slash menu reads the same as built-in commands: icon + localized title + English alias + one-line description.

| Field | Required | Purpose | Maps to SKILL.md |
| --- | --- | --- | --- |
| `id` | yes | kebab-case identifier; the `/id` invocation token | `name` |
| `name` | yes | canonical full name (may be English) | — |
| `display_name` | yes | menu title, Chinese first, ≤40 chars | `displayName` |
| `description` | yes | one-line routing hint shown in the menu, Chinese first, ≤120 chars | `description` |
| `icon` | no | icon id from the client's built-in set | `icon` |

Display precedence is `display_name → name → id`. When `display_name` differs from `id`, clients render the id as an alias next to it — the same shape as built-in rows such as `压缩 compact`.

```yaml
id: grill-me
name: Grill Me
display_name: 装填访谈
description: 把当前会话切入不留情面的访谈模式，并显示访谈状态。
```

- Keep `id` ASCII kebab-case: it is both the invocation token and the cross-tool identifier, so never localize it.
- `icon` is optional; unknown ids fall back to a generic skill icon.

## Plugin metadata (display spec)

The DSH plugin manager resolves an installed bundle's title, description, and icon from the package itself. `plugin.yaml` is catalog metadata and is not rendered by DSH. A compliant plugin package therefore ships:

| Artifact | Purpose |
| --- | --- |
| `package.json.name` | technical id; never localized |
| `locale/en.json` | required anchor dictionary with `meta.title` / `meta.description` |
| `locale/zh.json` | Chinese dictionary, same shape |
| `exports["./locale/*.json"]` | lets DSH resolve both dictionaries through Node exports |
| `files` entry `locale` | keeps the dictionaries in the packed or git-installed package |
| `package.json.icon` (or exported `./icon`) | optional; SVG, PNG, JPEG, or WebP up to 256 KiB |

`meta.title` follows `Display Name (package-name)` so the technical id stays visible, e.g. `草稿行 (dsh-draft-rows)` and `Draft Rows (dsh-draft-rows)`. `meta.description` is one short sentence; cards clamp it to a single line. DSH falls back from locale `meta` to `package.json.name` / `description`, and finally to the module specifier, so a missing or empty `en.json` exposes the raw id in both languages.

```json
{
  "meta": {
    "title": "草稿行 (dsh-draft-rows)",
    "description": "未发送的新会话留在侧边栏成为草稿行：每个工作区一个空草稿，写了字各自成行。"
  }
}
```

`python scripts/validate_metadata.py` checks the plugin schema plus these package rules. Keep `plugin.yaml.name` aligned with the English display name.

## Quick start

### Clone

```bash
git clone https://github.com/neuviletteflux/ai-catalog.git
cd ai-catalog
```

### Linux / macOS

```bash
chmod +x install.sh
./install.sh
```

### Windows PowerShell

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
./install.ps1
```

## What the installer does

The installer script is designed to make setup easier on a new machine:

- create a virtual environment in `.venv`
- install Python dependencies from `requirements.txt`
- optionally install Node dependencies if a JS tool is needed
- generate local config files based on templates
- expose the CLI via `python -m tools.cli`

## CLI usage

```bash
python -m tools.cli --help
python -m tools.cli list
python -m tools.cli install example-skill
```

## Development

```bash
python -m venv .venv
source .venv/bin/activate   # Linux/macOS
# or .venv\\Scripts\\activate  # Windows
pip install -r requirements.txt
python scripts/validate_metadata.py
```

## Contributing

Before submitting changes, check the contribution guide:

- `CONTRIBUTING.md`

## License

This project is licensed under the MIT License. See `LICENSE` for details.
