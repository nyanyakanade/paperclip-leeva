"""Read a private, evidence-reviewed task attribution snapshot; never dispatch work.

This is a separate sample ledger, not an addition to the live conversation totals.
One response belongs to one task or to the shared pool, never to both.
"""
import json
from pathlib import Path
import uuid

PARTS = ("fresh", "cached", "written", "output")
PHASES = ("dispatch", "review", "coordination", "mixed", "execution", "rework")


def empty():
    return dict(requests=0, fresh=0, cached=0, written=0, output=0, total=0)


def add(target, event):
    target["requests"] += 1
    for key in PARTS:
        target[key] += event[key]
    target["total"] += sum(event[k] for k in PARTS)


def aggregate(snapshot, cid, lower="", upper="9999"):
    # Do not silently accept corrupt snapshots or duplicated response accounting.
    from external_usage import timestamp
    if snapshot.get("version") != 1 or snapshot.get("companyId") != cid:
        raise ValueError("Task snapshot scope mismatch")
    generated = timestamp(snapshot["generatedAt"])
    definitions = snapshot["tasks"]
    ids = [t["id"] for t in definitions]
    if len(ids) != len(set(ids)):
        raise ValueError("Duplicate task")
    rows = {}
    full_counts = dict.fromkeys(ids, 0)
    for task in definitions:
        rows[task["id"]] = {key: task[key] for key in
                            ("id", "name", "executor", "outcome", "complete", "basis")}
        rows[task["id"]].update(phases={p: empty() for p in PHASES}, totals=empty(),
                                models=set(), shared=empty(), firstEvent=None, lastEvent=None)
    seen, pools = set(), {}
    totals, assigned, shared = empty(), empty(), empty()
    for event in snapshot["events"]:
        identity = (event["provider"], event["identity"])
        if not all(identity) or identity in seen:
            raise ValueError("Duplicate or missing response")
        seen.add(identity)
        task_id = event["taskId"]
        phase = event["phase"]
        if phase not in PHASES or (task_id is not None and task_id not in rows):
            raise ValueError("Invalid attribution")
        related = event.get("relatedTaskIds", [])
        if len(related) != len(set(related)) or any(t not in rows for t in related):
            raise ValueError("Invalid shared attribution")
        if task_id and related:
            raise ValueError("Response counted twice")
        if any(type(event[k]) is not int or event[k] < 0 for k in PARTS):
            raise ValueError("Invalid count")
        occurred = timestamp(event["occurred"])
        if occurred > generated:
            raise ValueError("Event after snapshot")
        if task_id:
            full_counts[task_id] += 1
        if not lower <= occurred <= upper:
            continue
        add(totals, event)
        if task_id:
            row = rows[task_id]
            add(row["phases"][phase], event)
            add(row["totals"], event)
            add(assigned, event)
            row["models"].add(event.get("model") or "unknown")
            row["firstEvent"] = min(row["firstEvent"] or occurred, occurred)
            row["lastEvent"] = max(row["lastEvent"] or occurred, occurred)
        else:
            add(shared, event)
            reason = event["reason"]
            key = (reason, tuple(sorted(related)))
            pool = pools.setdefault(key, {"reason": reason, "relatedTaskIds": list(key[1]), "totals": empty()})
            add(pool["totals"], event)
            for tid in related:
                add(rows[tid]["shared"], event)  # Exposure only; never added to task totals.
    result = []
    for row in rows.values():
        if not row["totals"]["requests"] and not row["shared"]["requests"]:
            continue
        row["models"] = sorted(row["models"])
        row["partialRange"] = row["totals"]["requests"] != full_counts[row["id"]]
        result.append(row)
    return {"status": "ready", "generatedAt": generated, "rows": result,
            "totals": totals, "assigned": assigned, "shared": shared,
            "pools": list(pools.values()), "scope": snapshot["scope"],
            "evidence": snapshot.get("evidence", []), "costCents": None,
            "singleAgentBaselineAvailable": False}


def task_summary(root, cid, lower="", upper="9999"):
    cid = str(uuid.UUID(cid))
    path = Path(root) / (cid + ".tasks.json")
    if not path.exists():
        return {"status": "missing"}
    try:
        return aggregate(json.loads(path.read_text()), cid, lower, upper)
    except (OSError, ValueError, KeyError, TypeError):
        return {"status": "invalid"}  # No private paths or source text in HTTP errors.
