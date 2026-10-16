from pathlib import Path
import json
import sys

import yaml
from jsonschema import Draft7Validator


def find_metadata_files(root: Path):
    for path in root.rglob("*.yaml"):
        if ".git" in path.parts:
            continue
        yield path
    for path in root.rglob("*.yml"):
        if ".git" in path.parts:
            continue
        yield path


def validate_schema(path: Path):
    if path.name == "skill.yaml":
        schema_path = root / "schema" / "skill.schema.json"
    elif path.name == "plugin.yaml":
        schema_path = root / "schema" / "plugin.schema.json"
    elif path.name == "prompt.yaml":
        schema_path = root / "schema" / "prompt.schema.json"
    else:
        return

    with schema_path.open("r", encoding="utf-8") as f:
        schema = json.load(f)
    with path.open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f)

    validator = Draft7Validator(schema)
    errors = sorted(validator.iter_errors(data), key=lambda e: e.path)
    if errors:
        for err in errors:
            print(f"Schema error in {path}: {err.message}")
        raise SystemExit(1)


root = Path(__file__).resolve().parents[1]

for path in find_metadata_files(root):
    if path.name in {"skill.yaml", "plugin.yaml", "prompt.yaml"}:
        validate_schema(path)

print("All metadata files validated successfully.")
