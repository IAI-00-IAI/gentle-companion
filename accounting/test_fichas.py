"""Regression checks for the funding fichas.

Guards the bug found 19-nov-2026: two FUNDING rows shared the slug
"nlnet-restack" (#1 NLnet/Restack and #26 NLnet calendario), so generating the
26 fichas overwrote #1 with #26's body and the map linked #1 to the wrong page.
Run: python3 accounting/test_fichas.py
"""
# OKF-METADATA
# ---
# type: Test
# title: "Guard de fichas de financiación"
# description: "Verifica slugs únicos, que cada fila tiene su fichero y que el h1 de cada ficha declara su propio rank y nombre."
# status: draft
# generated: 2026-11-20T00:51:26+01:00
# source:
# - "accounting/web_dashboard.py (FUNDING)"
# - "accounting/fichas/*.html"
# verified: 2026-11-20
# stale_after: 2027-06-30
# ---
import re
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))


def _funding():
    src = (HERE / "web_dashboard.py").read_text()
    m = re.search(r"FUNDING = \[(.*?)\n    \]", src, re.S)
    return eval("[" + m.group(1) + "]")


def test_slugs_are_unique():
    rows = _funding()
    dup = {s: n for s, n in Counter(r["slug"] for r in rows).items() if n > 1}
    assert not dup, f"duplicate slug(s): {dup}"


def test_every_row_has_a_ficha_file():
    missing = [r["slug"] for r in _funding() if not (HERE / "fichas" / f"{r['rank']}-{r['slug']}.html").is_file()]
    assert not missing, f"no ficha file for: {missing}"


def test_each_ficha_declares_its_own_rank_and_name():
    """The <h1> must match the row's rank and name — catches body-overwrite."""
    bad = []
    for r in _funding():
        p = HERE / "fichas" / f"{r['rank']}-{r['slug']}.html"
        if not p.is_file():
            continue
        h1 = re.search(r"<h1>#(\d+) ([^<]*)</h1>", p.read_text())
        if not h1:
            bad.append((r["slug"], "no <h1>"))
            continue
        if int(h1.group(1)) != r["rank"] or h1.group(2).strip() != r["name"].strip():
            bad.append((r["slug"], f"h1 says #{h1.group(1)} {h1.group(2)[:30]!r}, row is #{r['rank']} {r['name'][:30]!r}"))
    assert not bad, f"ficha/row mismatch: {bad}"


def test_map_row_1_links_to_opcion1():
    src = (HERE / "web_dashboard.py").read_text()
    assert '"/opcion1.html" if h[\'rank\'] == 1' in src, "map row #1 lost its /opcion1.html link"


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"PASS {name}")
            except AssertionError as exc:
                failures += 1
                print(f"FAIL {name}: {exc}")
    sys.exit(1 if failures else 0)
