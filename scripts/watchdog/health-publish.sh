#!/bin/sh
# Write the session health board and take a daily backup of the roster.
#
# Ricardo, 2026-11-23: "si hay Guardian de compactación hay que monitorearlo y ponerlo
# también en pizarra, arriba del todo, con 2 o 3 actualizaciones diarias si estamos en
# faena... y una copia de respaldo diaria".
#
# Why the board and not only an alert: an alert tells you a session is unwell *now*.
# The board lets you see, before assigning work, which sessions are carrying history.
# The failure it prevents is the one that already happened — a session degraded for
# five days that nobody noticed because nobody asked.
#
# Never invents a verdict: if health-report.py cannot read a session it prints
# UNVERIFIED, and that string is carried through verbatim.
#
# The board is a generated artifact and lives in its own files, ignored by git. The
# hand-written roster is never rewritten by this script: an earlier version spliced the
# board into the roster between anchors, which silently did nothing for the Spanish
# mirror (it had no anchors) and mixed generated content with edited prose. Writing two
# complete files has no splice to get wrong.
#
# The roster pointer in the roster file is static and committed once; this script does
# not touch it.

set -eu
WATCHDOG_DIR=/home/ricardo/.local/share/gentle-watchdog
REPO=/home/ricardo/Trabajo/IAI/gentle-companion
BOARD="$REPO/knowledge/operations/health-board.md"
BOARD_ES="$REPO/knowledge/operations/health-board_es-ES.md"
ROSTER="$REPO/knowledge/operations/team-roster.md"
ROSTER_ES="$REPO/knowledge/operations/team-roster_es-ES.md"
BACKUPS="$WATCHDOG_DIR/health-backups"
STAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
TODAY=$(date +%Y-%m-%d)

mkdir -p "$BACKUPS"

# The report is passed by file, never as an argument: with 184 sessions the JSON
# exceeds the kernel's per-argument limit and the shell fails with
# "Argument list too long" before Python ever starts.
JSON_FILE=$(mktemp)
trap 'rm -f "$JSON_FILE"' EXIT
python3 "$WATCHDOG_DIR/health-report.py" --json >"$JSON_FILE" 2>"$WATCHDOG_DIR/health.err" || {
    echo "health-publish: health-report.py failed (see health.err)"
    exit 2
}

# Daily backup of the hand-edited roster, once per day, never overwriting an earlier one.
for f in "$ROSTER" "$ROSTER_ES"; do
    [ -f "$f" ] || continue
    dest="$BACKUPS/$(basename "$f" .md)-$TODAY.md"
    [ -f "$dest" ] || cp "$f" "$dest"
done

python3 - "$JSON_FILE" "$BOARD" "$BOARD_ES" "$STAMP" "$TODAY" <<'PY'
import json
import re
import sys
from pathlib import Path

payload, board, board_es, stamp, today = sys.argv[1:6]
data = json.loads(Path(payload).read_text())
sessions = data["sessions"]

# Show the sessions that can actually cost someone a task first: those carrying
# history, then the rest. Everything alive is listed, worst first.
#
# Recency outranks severity. An earlier version ranked degraded-first and age-descending,
# so the board filled with eight months-dead sessions from August and hid every live one.
# A second version showed only unhealthy live sessions, so a reader could not tell that
# twelve healthy sessions existed at all — and could not find themselves on the board.
# A board meant to decide who gets the next task shows everyone who is here.
STALE_DAYS = 7
current = [s for s in sessions if (s.get("age_days") or 0) <= STALE_DAYS]
stale_count = len(sessions) - len(current)

ranked = sorted(
    current,
    key=lambda s: (
        {"degraded": 0, "unreliable": 1, "pressure": 2, "healthy": 3}.get(s.get("verdict"), 4),
        -(s.get("age_days") or 0),
    ),
)
shown = ranked[:20]


def label(s):
    return s["session"].split("_")[-1][:13] if "_" in s["session"] else s["session"][:13]


# The reporter writes its reasons as English prose, almost always with numbers inside
# ("only 26,579 tokens before compaction"). A literal dictionary cannot match those, so
# the known shapes are rewritten as patterns. The coupling is deliberate and narrow: if
# health-report.py rewords a reason, its pattern stops matching and the original English
# text is passed through unchanged — a visible miss, never a silent mistranslation.
REASONS_ES = [
    (re.compile(r"^(\d+(?:\.\d+)?)% of window used$"), r"\1% de la ventana usada"),
    (re.compile(r"^only ([\d,]+) tokens before compaction$"), r"solo \1 tokens hasta compactar"),
    (re.compile(r"^(\d+) compactions?, summaries stacked$"), r"\1 compactaciones, resúmenes apilados"),
    (re.compile(r"^([\d.]+)d old, carries its whole history$"), r"\1d de vida, arrastra toda su historia"),
    (
        re.compile(r"^local model with a 139k window: 40% is near the edge$"),
        "modelo local con ventana de 139k: el 40% está al límite",
    ),
    (
        re.compile(r"^estimate exceeds the window: transcript shape not understood.*$"),
        "la estimación excede la ventana: forma del transcript no comprendida, tratar con sospecha",
    ),
    (re.compile(r"^within every threshold$"), "dentro de todos los umbrales"),
]


def translate_reason(text: str) -> str:
    for pattern, replacement in REASONS_ES:
        if pattern.match(text):
            return pattern.sub(replacement, text)
    return text


VERDICT_ES = {
    "healthy": "sana",
    "pressure": "en presión",
    "degraded": "degradada",
    "unreliable": "no fiable",
}


def row(s, spanish=False):
    if s.get("status") != "ok":
        verdict = "SIN VERIFICAR" if spanish else "UNVERIFIED"
        return f"| `{label(s)}` | — | — | — | — | — | **{verdict}** — {s.get('reason', '')} |"
    comp = len(s["compactions"])
    last = (s["compactions"][-1]["at"] or "")[:10] if s["compactions"] else "—"
    age = f"{s['age_days']}d" if s.get("age_days") is not None else "—"
    verdict = VERDICT_ES.get(s["verdict"], s["verdict"]) if spanish else s["verdict"]
    why = "; ".join(translate_reason(r) if spanish else r for r in s["reasons"])
    return (
        f"| `{label(s)}` | {s['model']} | {s['percent']}% | {s['to_compact']:,} "
        f"| {comp} ({last}) | {age} | **{verdict}** — {why} |"
    )


table = "\n".join(row(s) for s in shown)
table_es = "\n".join(row(s, spanish=True) for s in shown)
# No Role column: the reporter reads transcripts and does not know who plays what. The
# roster already carries roles, and a column of em-dashes reads as broken, not as unknown.
header_en = (
    "| Session | Model | ctx % | to compact | compactions (last) | age | healthy? |\n"
    "|---|---|---|---|---|---|---|"
)
header_es = (
    "| Sesión | Modelo | ctx % | hasta compactar | compactaciones (última) | edad | ¿sana? |\n"
    "|---|---|---|---|---|---|---|"
)

documents = {
    board: (
        "---\n"
        "type: Operations Board\n"
        "title: Session health board\n"
        "description: \"Generated per-session context health. Regenerated by watchdog-health; "
        "do not edit by hand.\"\n"
        "tags:\n  - operations\n  - coordination\nstatus: generated\n"
        "generated: {today}\n---\n\n"
        "# Session health board — gentle-companion\n\n"
        "> **Auto-generated** by `watchdog-health` at {stamp}. Rows are read from the\n"
        "> transcripts, never typed. `—` in a column means the watchdog could not determine\n"
        "> it; it does not mean healthy. Last roster backup: `{today}` in\n"
        "> `~/.local/share/gentle-watchdog/health-backups/`.\n>\n"
        "> Generated artifact: ignored by git. The hand-edited board lives in\n"
        "> `team-roster.md`.\n\n"
        "### How to read it\n\n"
        "| Column | Meaning | What to watch |\n|---|---|---|\n"
        "| `ctx %` | Share of the model's window in use | Mind the per-model ceiling: 40 % is routine on 1M and an emergency on 139k |\n"
        "| `to compact` | Tokens left before compaction fires | Below ~50k the next large read can trigger it |\n"
        "| `compactions` | Total, with the date of the last | One is normal. Two means stacked summaries |\n"
        "| `age` | Time since the session started | A session older than ~2 days drags its history everywhere |\n"
        "| `healthy?` | Our verdict, with the reason | «Unverified» is a legitimate answer and must appear as such |\n\n"
        "### Board\n\n{header}\n{table}\n{stale}\n"
    ).format(
        today=today,
        stamp=stamp,
        header=header_en,
        table=table,
        stale=(
            f"> {stale_count} further sessions older than {STALE_DAYS} days stay off the board."
            if stale_count else ""
        ),
    ),
    board_es: (
        "---\n"
        "type: Operations Board\n"
        "title: Tablero de salud de las sesiones\n"
        "description: \"Salud de contexto por sesión, generada. La regenera watchdog-health; "
        "no editar a mano.\"\n"
        "tags:\n  - operations\n  - coordination\nstatus: generated\n"
        "generated: {today}\n---\n\n"
        "# Tablero de salud de las sesiones — gentle-companion\n\n"
        "> **Generado automáticamente** por `watchdog-health` a las {stamp}. Las filas se\n"
        "> leen de los transcripts, nunca se escriben a mano. `—` en una columna significa que\n"
        "> el vigilante no pudo determinarlo; no significa que esté sana. Último respaldo de la\n"
        "> pizarra: `{today}` en `~/.local/share/gentle-watchdog/health-backups/`.\n>\n"
        "> Artefacto generado: ignorado por git. La pizarra editada a mano vive en\n"
        "> `team-roster_es-ES.md`.\n\n"
        "### Cómo se lee\n\n"
        "| Columna | Qué significa | A qué prestar atención |\n|---|---|---|\n"
        "| `ctx %` | Parte de la ventana del modelo en uso | Ojo al techo por modelo: 40 % es normal en 1M y una emergencia en 139k |\n"
        "| `to compact` | Tokens que quedan antes de que dispare la compactación | Por debajo de ~50k, la siguiente lectura grande puede dispararla |\n"
        "| `compactaciones` | Total, con la fecha de la última | Una es normal. Dos significa resúmenes apilados |\n"
        "| `edad` | Tiempo desde que arrancó la sesión | Una sesión de más de ~2 días arrastra su historia a todas partes |\n"
        "| `¿sana?` | Nuestro juicio, con el motivo | «Sin verificar» es una respuesta legítima y debe aparecer como tal |\n\n"
        "### Pizarra\n\n{header}\n{table}\n{stale}\n"
    ).format(
        today=today,
        stamp=stamp,
        header=header_es,
        table=table_es,
        stale=(
            f"> Otras {stale_count} sesiones de más de {STALE_DAYS} días quedan fuera del tablero."
            if stale_count else ""
        ),
    ),
}

for path, text in documents.items():
    Path(path).write_text(text)

print(f"health-publish: {len(sessions)} sessions read, {len(shown)} on the board")
for path in documents:
    print(f"  wrote {path}")
PY
