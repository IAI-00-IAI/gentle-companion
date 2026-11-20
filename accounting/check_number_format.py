"""Guard for REGLA #1 — Spanish number format (decimal comma, thousands dot).

Fails when a document contains a decimal number written with an English dot
separator. Exemptions are explicit and narrow: legal article numbers, IP
addresses, named standards, ISO dates, and literal command output quotes.

Run at session start and before reporting any figure:
    python3 accounting/check_number_format.py
"""
# OKF-METADATA
# ---
# type: Test
# title: "Guard REGLA #1 — formato numérico español"
# description: "Falla (exit 1) si encuentra decimales con punto en los documentos, con exenciones explícitas (ley, IP, estándar, fecha, CSS, secciones)."
# status: draft
# generated: 2026-11-20T00:51:26+01:00
# source:
# - "REGLA #1 de Ricardo (19-nov-2026)"
# verified: 2026-11-20
# stale_after: 2027-06-30
# ---
import glob
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SKIP_DIRS = {"__pycache__", ".git"}

# Numbers that legitimately contain dots and are NOT decimals.
EXEMPT_PATTERNS = [
    re.compile(r"\b(?:3[59]|125)\.\d+\b"),          # art. 35.4 / 39.2 / 125.3 LIS
    re.compile(r"§\s*\d+(?:\.\d+)*"),               # bases/call section refs: §7.1, §10.1
    re.compile(r"(?i)\b(?:bases|section|sección|art\.)\s*§?\s*\d+(?:\.\d+)+"),
    re.compile(r"\b\d{1,3}(?:\.\d{1,3}){3}\b"),      # IPv4 192.168.2.11, 127.0.0.1
    re.compile(r"\b802\.11[a-z]*"),                  # Wi-Fi standard
    re.compile(r"\bv\d+\.\d+(?:\.\d+)*"),            # v1.0.7
    re.compile(r"\b\d{4}-\d{2}-\d{2}\b"),            # ISO dates
    re.compile(r"`[^`]*`"),                          # inline code / literal command output
    # CSS values must keep the dot (font-size:1.05rem) — syntax, not a figure
    re.compile(r'(?:font-size|line-height|margin|padding|width|height|max-width|min-width|border|top|left|right|bottom|gap|opacity|z-index)\s*:\s*[\d.]+[a-z%]*'),
    re.compile(r'style="[^"]*"'),                    # entire inline style attributes
    re.compile(r"style='[^']*'"),
]

DECIMAL_RE = re.compile(r"(?<![\d.])(\d{1,3}\.\d{1,3})(?![\d.])")


def strip_exempt(line: str) -> str:
    out = line
    for pat in EXEMPT_PATTERNS:
        out = pat.sub(" ", out)
    return out


def is_thousands_group(tok: str) -> bool:
    """6.000 / 47.500 → right side is exactly 3 digits and left has no leading zero."""
    left, right = tok.split(".")
    return len(right) == 3 and not left.startswith("0") and len(left) <= 3


def scan(text: str):
    problems = []
    for n, line in enumerate(text.splitlines(), 1):
        for m in DECIMAL_RE.finditer(strip_exempt(line)):
            tok = m.group(1)
            if is_thousands_group(tok):
                continue
            problems.append((n, tok, line.strip()[:110]))
    return problems


def collect():
    docs = {}
    for pat in ("*.md", "**/*.md", "*.html", "**/*.html"):
        for f in glob.glob(str(HERE / pat), recursive=True):
            p = Path(f).resolve()
            if any(part in SKIP_DIRS for part in p.parts):
                continue
            docs[p] = None
    return sorted(docs)


def main():
    bad = 0
    for p in collect():
        probs = scan(p.read_text())
        if probs:
            bad += 1
            print(f"\n{p.relative_to(HERE)}")
            for n, tok, line in probs[:6]:
                print(f"  L{n}: '{tok}'  ← {line}")
            if len(probs) > 6:
                print(f"  … y {len(probs) - 6} más")
    files = len(collect())
    print(f"\nchecked {files} documents · with English decimal separators: {bad}")
    if bad:
        # Loud on stderr too: `cmd | tail` swallows the exit code, the banner does not.
        print(f"FAIL: {bad} document(s) violate REGLA #1 (decimal comma required)",
              file=sys.stderr)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
