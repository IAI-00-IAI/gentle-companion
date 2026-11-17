#!/usr/bin/env python3
"""Validate the knowledge bundle: OKF frontmatter, link integrity, EN/ES parity.

Run from the repository root: python3 tools/check-knowledge.py
Exit code 0 means every check passed.
"""
import re
import sys
from pathlib import Path

BUNDLE = Path("knowledge")
RESERVED = {"index.md", "log.md"}
errors = []
warnings = []


def frontmatter(path: Path):
    """Return the parsed frontmatter dict, or None if absent."""
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        return None
    end = text.find("\n---\n", 4)
    if end == -1:
        return None
    block = text[4:end]
    try:
        import yaml
    except ImportError:
        # Minimal fallback: only check that a type: line exists.
        return {"type": "?"} if re.search(r"^type:", block, re.M) else None
    try:
        return yaml.safe_load(block) or {}
    except Exception as exc:  # noqa: BLE001
        errors.append(f"{path}: frontmatter is not valid YAML: {exc}")
        return None


def links(path: Path):
    text = path.read_text(encoding="utf-8")
    # Drop fenced code blocks so a diagram or example never counts as a link.
    text = re.sub(r"```.*?```", "", text, flags=re.S)
    for match in re.finditer(r"\]\(([^)]+)\)", text):
        target = match.group(1).strip()
        if target.startswith(("http://", "https://", "#", "mailto:")):
            continue
        yield target


def main() -> int:
    if not BUNDLE.is_dir():
        print("error: knowledge/ not found; run from the repository root")
        return 1

    concepts = sorted(p for p in BUNDLE.rglob("*.md"))
    if not concepts:
        print("error: the bundle has no concepts")
        return 1

    for path in concepts:
        name = path.name
        relative = path.relative_to(BUNDLE)
        is_reserved = name in RESERVED or name in {n.replace(".md", "_es-ES.md") for n in RESERVED}
        data = frontmatter(path)

        if is_reserved:
            # index.md may carry okf_version; log.md carries nothing.
            if name == "log.md" or name == "log_es-ES.md":
                if data:
                    warnings.append(f"{relative}: log.md should not have frontmatter")
            continue

        if data is None:
            errors.append(f"{relative}: missing frontmatter")
            continue
        if not data.get("type"):
            errors.append(f"{relative}: frontmatter has no 'type' (the only required field)")
        for field in ("title", "description", "generated"):
            if field not in data:
                warnings.append(f"{relative}: recommended field '{field}' is missing")

    # Link integrity: relative links resolved against the linking file's
    # directory; legacy bundle-absolute links against the bundle root.
    def resolve(path: Path, target: str) -> Path:
        if target.startswith("/"):
            return (BUNDLE / target.lstrip("/")).resolve()
        return (path.parent / target).resolve()

    for path in concepts:
        for target in links(path):
            resolved = resolve(path, target)
            if not resolved.exists():
                errors.append(f"{path.relative_to(BUNDLE)}: broken link -> {target}")

    # EN/ES parity: every concept needs its counterpart in the same directory.
    for path in concepts:
        if path.stem.endswith("_es-ES"):
            counterpart = path.with_name(path.name.replace("_es-ES.md", ".md"))
        else:
            counterpart = path.with_name(path.stem + "_es-ES.md")
        if not counterpart.exists():
            errors.append(
                f"{path.relative_to(BUNDLE)}: no counterpart {counterpart.name}"
            )

    # Spanish concepts must link to Spanish siblings, not to English ones.
    for path in concepts:
        if not path.stem.endswith("_es-ES"):
            continue
        for target in links(path):
            resolved = resolve(path, target)
            # Only judge in-bundle file targets; missing targets are already
            # reported by the broken-link check above.
            if not resolved.is_file():
                continue
            if BUNDLE.resolve() not in resolved.parents:
                continue
            if not resolved.name.endswith("_es-ES.md") and resolved.name not in RESERVED:
                errors.append(
                    f"{path.relative_to(BUNDLE)}: Spanish page links to English -> {target}"
                )

    for warning in warnings:
        print(f"warn: {warning}")
    for error in errors:
        print(f"error: {error}")

    # Reserved files are navigation, not knowledge concepts.
    reserved_stems = {"index", "log"}
    concepts_en = [
        p for p in concepts
        if not p.stem.endswith("_es-ES") and p.stem not in reserved_stems
    ]
    print(
        f"\n{len(concepts)} files, {len(concepts_en)} concepts, "
        f"{len(errors)} errors, {len(warnings)} warnings"
    )
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
