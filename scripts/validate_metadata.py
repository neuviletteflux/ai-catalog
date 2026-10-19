from pathlib import Path
import json
import sys

import yaml
from jsonschema import Draft7Validator


PLUGIN_LOCALES = ("en", "zh")
ICON_SUFFIXES = {".svg", ".png", ".jpg", ".jpeg", ".webp"}
MAX_ICON_BYTES = 256 * 1024


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


def is_packaged(relative: str, files) -> bool:
    """Return whether a package-relative path is covered by the `files` list."""
    if not isinstance(files, list):
        return False
    normalized = relative.replace("\\", "/")
    return any(
        isinstance(entry, str)
        and (normalized == entry or normalized.startswith(f"{entry}/"))
        for entry in files
    )


def validate_plugin_package(plugin_dir: Path, plugin_id: str):
    """Validate the display metadata DSH reads from a plugin package.

    DSH resolves a plugin's title, description, and icon from exported locale
    dictionaries and the package manifest, not from plugin.yaml. Require both
    languages, the exports entry, and packaging of every file involved.
    """
    errors = []
    manifest_path = plugin_dir / "package.json"
    if not manifest_path.is_file():
        return [f"{manifest_path}: missing package.json"]

    try:
        with manifest_path.open("r", encoding="utf-8") as f:
            manifest = json.load(f)
    except (OSError, json.JSONDecodeError) as error:
        return [f"{manifest_path}: {error}"]

    if manifest.get("name") != plugin_id:
        errors.append(f"{manifest_path}: name must match plugin id {plugin_id!r}")

    exports = manifest.get("exports")
    if not isinstance(exports, dict) or "./locale/*.json" not in exports:
        errors.append(f'{manifest_path}: exports must include "./locale/*.json"')

    files = manifest.get("files")
    for language in PLUGIN_LOCALES:
        locale_path = plugin_dir / "locale" / f"{language}.json"
        if not is_packaged(f"locale/{language}.json", files):
            errors.append(f'{manifest_path}: files must include "locale"')
            break
        if not locale_path.is_file():
            errors.append(f"{locale_path}: missing locale file")
            continue

        try:
            with locale_path.open("r", encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, json.JSONDecodeError) as error:
            errors.append(f"{locale_path}: {error}")
            continue

        meta = data.get("meta") if isinstance(data, dict) else None
        if not isinstance(meta, dict):
            errors.append(f"{locale_path}: meta object is required")
            continue

        for field in ("title", "description"):
            value = meta.get(field)
            if not isinstance(value, str) or not value.strip():
                errors.append(f"{locale_path}: meta.{field} must be a non-empty string")

        title = meta.get("title")
        if isinstance(title, str) and title.strip():
            if not title.strip().endswith(f"({plugin_id})"):
                errors.append(f'{locale_path}: meta.title must end with "({plugin_id})"')

    icon = manifest.get("icon")
    if icon is not None:
        if not isinstance(icon, str) or not icon.strip():
            errors.append(f"{manifest_path}: icon must be a non-empty relative path")
        else:
            icon_path = (plugin_dir / icon).resolve()
            try:
                icon_path.relative_to(plugin_dir.resolve())
            except ValueError:
                errors.append(f"{manifest_path}: icon must stay inside the package")
            else:
                if not icon_path.is_file():
                    errors.append(f"{manifest_path}: icon file not found: {icon}")
                elif icon_path.suffix.lower() not in ICON_SUFFIXES:
                    errors.append(f"{manifest_path}: icon must be SVG, PNG, JPEG, or WebP")
                elif icon_path.stat().st_size > MAX_ICON_BYTES:
                    errors.append(f"{manifest_path}: icon exceeds 256 KiB")
                elif not is_packaged(icon, files):
                    errors.append(f'{manifest_path}: files must include "{icon}"')

    return errors


root = Path(__file__).resolve().parents[1]

for path in find_metadata_files(root):
    if path.name in {"skill.yaml", "plugin.yaml", "prompt.yaml"}:
        validate_schema(path)

plugin_errors = []
for plugin_yaml in sorted((root / "plugins").glob("*/plugin.yaml")):
    plugin_dir = plugin_yaml.parent
    plugin_errors.extend(validate_plugin_package(plugin_dir, plugin_dir.name))

if plugin_errors:
    for message in plugin_errors:
        print(f"Plugin package error: {message}")
    raise SystemExit(1)

print("All metadata files validated successfully.")
