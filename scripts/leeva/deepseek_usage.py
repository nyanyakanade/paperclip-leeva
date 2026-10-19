"""Read only the mapped Harness v4 log; retain numeric usage, never content.

Harness appends concatenated Zstandard frames. A one-shot Node decompressor
only reads the first frame (the header); the zstd CLI decodes every frame.
Incomplete/corrupt snapshots fail closed and the mirror keeps its last counts.
"""
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
import subprocess
import uuid


def session_id(value):
    if not isinstance(value, str) or not value.startswith("session-"):
        raise ValueError("Invalid Harness session")
    if value != "session-" + str(uuid.UUID(value[8:])):
        raise ValueError("Invalid Harness session")
    return value


def count(value):
    if type(value) is not int or value < 0:
        raise ValueError("Invalid Harness usage")
    return value


def parse_usage(raw, root):
    session_id(root)
    if not raw.endswith(b"\n"):
        raise ValueError("Incomplete Harness log")
    lines = iter(raw.splitlines())
    header = json.loads(next(lines))
    if header.get("type") != "session" or header.get("version") != 4 or header.get("id") != root:
        raise ValueError("Harness log identity or version mismatch")
    if header.get("isSeeded") is not False:
        raise ValueError("Inherited Harness history requires separate attribution")
    model = "unknown"
    for seq, line in enumerate(lines):
        record = json.loads(line)
        if type(record.get("seq")) is not int or record["seq"] != seq:
            raise ValueError("Noncontiguous Harness log")
        kind, data = record.get("type"), record.get("data", {})
        if kind == "request/context":
            model = data.get("model") or "unknown"
        usage = data.get("usage")
        if usage is None:
            continue  # No estimate for requests that did not report usage.
        if kind not in {"assistant/message", "compaction/summary"} or not isinstance(usage, dict):
            raise ValueError("Unrecognized Harness usage event")
        # Shipped Messages adapter's input is fresh; cache and output are disjoint.
        counts = [count(usage.get(k, 0)) for k in
                  ("inputTokens", "cacheReadTokens", "cacheWriteTokens", "outputTokens")]
        if "inputTokens" not in usage or "outputTokens" not in usage:
            raise ValueError("Missing Harness usage counters")
        if "totalTokens" in usage and count(usage["totalTokens"]) != sum(counts):
            raise ValueError("Inconsistent Harness total")
        milliseconds = count(record.get("time"))
        ts = datetime.fromtimestamp(milliseconds / 1000, timezone.utc).isoformat(timespec="milliseconds")
        yield (root + ":" + str(seq), root, data.get("model") or model, ts, *counts)


def read_usage(sessions, root, previous):
    session_id(root)  # Validate before any filesystem glob.
    paths = list(Path(sessions).glob("*/" + root + "/session.v4.jsonl.zstd"))
    if len(paths) != 1:
        raise ValueError("Harness log missing or ambiguous")
    path = paths[0]
    stat = path.stat()
    stamp = {"path": str(path), "inode": stat.st_ino, "size": stat.st_size, "mtime": stat.st_mtime_ns}
    if stamp == previous:
        return [], stamp
    compressed = path.read_bytes()
    after = path.stat()
    if (after.st_ino, after.st_size, after.st_mtime_ns) != (stat.st_ino, stat.st_size, stat.st_mtime_ns):
        raise ValueError("Harness snapshot changed during read")
    decoder = shutil.which("zstd") or "/opt/homebrew/bin/zstd"
    result = subprocess.run([decoder, "-dc"], input=compressed, capture_output=True, timeout=30, check=True)
    return list(parse_usage(result.stdout, root)), stamp
