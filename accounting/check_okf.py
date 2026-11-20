"""Pipeline guard: every generated document must carry a VALID OKF header.

Presence is not enough (lesson of 19-nov): a header that parses to the wrong
thing is worse than a missing one, because it looks like provenance and is not.
Multiple `source:` keys, for example, are accepted by YAML without error and
silently keep only the last one.

Checks
  1. header present
  2. no duplicate top-level keys inside the header block
  3. required fields present: type, title, status, generated (+ source for HTML)
  4. `generated` is an ISO-8601 timestamp; `verified` / `stale_after` are ISO dates
  5. reports how many documents were VALIDATED, not merely found

Format map
  .md   -> YAML frontmatter between --- lines
  .html -> <!-- OKF-METADATA ... --> block before <!DOCTYPE>
  .json -> sibling <name>.meta.json
  .py   -> KNOWN EXCEPTION: Python modules carry no OKF header yet (decision by
           ORQ, 19-nov). Recorded here so it is a decision, not an oversight.

Run: python3 accounting/check_okf.py   (exit 1 on any failure)
"""
# OKF-METADATA
# ---
# type: Test
# title: "Guard OKF — valida cabeceras"
# description: "Falla (exit 1) si un documento carece de cabecera OKF, tiene claves duplicadas, le faltan campos o trae fechas mal formadas; valida también XML de los SVG."
# status: draft
# generated: 2026-11-20T00:51:26+01:00
# source:
# - "OKF v0.2 (Google Cloud)"
# - "accounting/REGLA-1-formato-numerico.md"
# verified: 2026-11-20
# stale_after: 2027-06-30
# ---
import glob
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SKIP_DIRS = {"__pycache__", ".git"}
REQUIRED = {"type", "title", "status", "generated"}
REQUIRED_HTML = REQUIRED | {"source"}
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TS_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:?\d{2}|Z)?$")


def _block(text: str):
    """Return the YAML text of the OKF header, or None."""
    t = text.lstrip()
    if t.startswith("<!-- OKF-METADATA"):
        end = t.find("-->")
        if end == -1:
            return None
        inner = t[len("<!-- OKF-METADATA"):end]
        # HTML/MD style: YAML fenced with --- lines
        m = re.search(r"---\n(.*?)\n---", inner, re.S)
        if m:
            return m.group(1)
        # XML/SVG style: no fences allowed (a comment cannot contain "--"),
        # so the payload is bare key: value lines
        bare = inner.strip()
        return bare if bare else None
    if t.startswith("---"):
        m = re.match(r"---\n(.*?)\n---", t, re.S)
        return m.group(1) if m else None
    return None


def _xml_wellformed(path: Path):
    """SVG is XML: an HTML-style comment containing '--' breaks the parser."""
    import xml.etree.ElementTree as ET
    try:
        ET.parse(str(path))
        return []
    except ET.ParseError as exc:
        return [f"not well-formed XML: {exc}"]


def validate(path: Path, kind: str):
    """Return list of problem strings (empty = valid)."""
    problems = []
    if kind == "py":
        head = path.read_text()[:1200]
        if "OKF-METADATA" not in head:
            return ["no OKF-METADATA comment block in the first 1200 chars"]
        return []
    if kind == "svg":
        xml_problems = _xml_wellformed(path)
        if xml_problems:
            return xml_problems          # a broken SVG is reported as such, first
    if kind == "json":
        meta = path.with_suffix(".meta.json")
        if not meta.is_file():
            return ["missing sibling .meta.json"]
        body = meta.read_text()
    else:
        block = _block(path.read_text())
        if block is None:
            return ["no OKF header block"]
        body = block

    # 2. duplicate top-level keys
    keys = re.findall(r"^([A-Za-z_][\w-]*):", body, re.M)
    seen, dups = set(), []
    for k in keys:
        if k in seen and k not in dups:
            dups.append(k)
        seen.add(k)
    if dups:
        problems.append(f"duplicate top-level key(s): {', '.join(dups)} (YAML keeps only the last)")

    # 3. required fields
    required = REQUIRED_HTML if kind in ("html", "md", "svg") else REQUIRED
    present = set(seen)
    try:
        import yaml as _y
        _p = _y.safe_load(body) if kind != "json" else __import__("json").loads(body)
        if isinstance(_p, dict):
            present = set(_p.keys()) | {"source"} if "sources" in _p else set(_p.keys())
    except Exception:
        pass
    missing = required - present
    if missing:
        problems.append(f"missing required field(s): {', '.join(sorted(missing))}")

    # 4. date shapes — parse with YAML so both flat and OKF v0.2 nested shapes work
    import json as _json
    try:
        import yaml as _yaml
        parsed = _json.loads(body) if kind == "json" else _yaml.safe_load(body)
    except Exception as exc:
        return problems + [f"header does not parse: {type(exc).__name__}"]
    if not isinstance(parsed, dict):
        return problems + ["header is not a mapping"]

    def _iso(v):
        """YAML turns ISO strings into datetime/date objects — render them back."""
        if v is None:
            return None
        if hasattr(v, "isoformat"):
            return v.isoformat()
        return str(v)

    gen = parsed.get("generated")
    if isinstance(gen, dict):                      # OKF v0.2: generated.by / generated.at
        gen = gen.get("at")
    gen = _iso(gen)
    if gen and not TS_RE.match(str(gen)):
        problems.append(f"generated is not an ISO-8601 timestamp: {gen!r}")

    ver = parsed.get("verified")
    if isinstance(ver, list) and ver:              # OKF v0.2: list of {by, at}
        first = ver[0]
        ver = first.get("at") if isinstance(first, dict) else first
    ver = _iso(ver)
    if ver and not DATE_RE.match(str(ver).split("T")[0]):
        problems.append(f"verified is not an ISO date: {ver!r}")

    sa = _iso(parsed.get("stale_after"))
    if sa and not DATE_RE.match(str(sa).split("T")[0]):
        problems.append(f"stale_after is not an ISO date: {sa!r}")
    return problems


def collect():
    """Every document, deduplicated by resolved path (no double counting)."""
    found = {}
    for pat in ("*.md", "**/*.md", "*.html", "**/*.html", "*.json", "**/*.svg", "**/*.py"):
        for f in glob.glob(str(HERE / pat), recursive=True):
            p = Path(f).resolve()
            if any(part in SKIP_DIRS for part in p.parts):
                continue
            if p.name.endswith(".meta.json"):
                continue
            ext = p.suffix.lstrip(".")
            kind = {"md": "md", "html": "html", "json": "json", "svg": "svg", "py": "py"}.get(ext)
            if kind:
                found[p] = kind
    return found


def main():
    docs = collect()
    failures = {}
    for p, kind in sorted(docs.items()):
        probs = validate(p, kind)
        if probs:
            failures[p.relative_to(HERE)] = probs

    print(f"validated {len(docs)} documents · invalid: {len(failures)}")
    for rel, probs in failures.items():
        print(f"  INVALID {rel}")
        for pr in probs:
            print(f"          - {pr}")
    print("coverage: .md .html .json .svg .py — every generated file must carry OKF")
    if failures:
        print(f"FAIL: {len(failures)} document(s) with invalid OKF header", file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
