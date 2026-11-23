#!/usr/bin/env python3
"""Longest run of back-to-back IDENTICAL tool calls in a pi session jsonl.

Prints one integer. Compares each call by a hash of its full name+arguments, so
two commands that merely share a prefix (e.g. both start with
"cd /repo/accounting && ...") are NOT counted as repeats.

History: the first version compared the first 60 characters of the tool call and
flagged ContaMNG with "identical call repeated 15 times" when those 15 were 15
different commands sharing a common `cd` prefix. The second attempt read the
call from the top-level object, but pi nests tool calls inside
`message.content[]`, so it silently found nothing (always 0) — an apparently
clean result produced by a broken reader, which is worse than a false positive.

Note on ordering: calls are read in file order, which is the order pi wrote them.
Parallel calls in one assistant message are ordered as recorded, not as executed.
"""

import hashlib
import json
import sys


def tool_calls_in(obj):
    """Yield (name, arguments) for every toolCall inside one jsonl record."""
    if obj.get("type") == "toolCall":
        yield obj.get("name", ""), obj.get("arguments")
    message = obj.get("message")
    if isinstance(message, dict):
        for block in message.get("content") or []:
            if isinstance(block, dict) and block.get("type") == "toolCall":
                yield block.get("name", ""), block.get("arguments")


def main() -> None:
    if len(sys.argv) < 2:
        print(0)
        return

    best = 0
    run = 0
    prev = None

    try:
        fh = open(sys.argv[1], "r", encoding="utf-8", errors="replace")
    except OSError:
        print(0)
        return

    with fh:
        for line in fh:
            if "toolCall" not in line:
                continue
            try:
                obj = json.loads(line)
            except ValueError:
                continue
            for name, args in tool_calls_in(obj):
                if args is None:
                    continue
                key = hashlib.sha1(
                    (str(name) + json.dumps(args, sort_keys=True)).encode()
                ).hexdigest()
                if key == prev:
                    run += 1
                else:
                    run = 1
                    prev = key
                if run > best:
                    best = run

    print(best)


if __name__ == "__main__":
    main()
