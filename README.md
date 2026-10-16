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
