"""Local, read-only usage mirror. Never submits work or writes the cost ledger.

Only company agent mappings select conversations. Persist numeric usage metadata,
not prompts, tool output, credentials, or inferred dollar amounts.
"""
import importlib.util
import json
import math
import os
from pathlib import Path
import sqlite3
import subprocess
import threading
import time
from datetime import datetime, timezone
import uuid


def timestamp(value):
    date = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if date.tzinfo is None:
        raise ValueError("Timezone required")
    return date.astimezone(timezone.utc).isoformat(timespec="milliseconds")


def now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def number(value):
    result = int(value or 0)
    if result < 0:
        raise ValueError("Negative token count")
    return result


def codex_event(record, meta, model):
    p = record.get("payload", {})
    if record.get("type") != "token_usage_record":
        return None
    # Forked/rehydrated transcripts contain other threads' usage records.
    if p.get("thread_id") and p["thread_id"] != meta["id"]:
        return None
    if not p.get("thread_id") and timestamp(record["timestamp"]) < timestamp(meta["timestamp"]):
        return None
    if not p.get("response_id") or not isinstance(p.get("usage"), dict):
        raise ValueError("Usage identity missing")
    u = p["usage"]
    cached = number(u.get("cached_input_tokens"))
    written = number(u.get("cache_write_input_tokens"))
    fresh = number(u.get("input_tokens")) - cached - written
    if fresh < 0:
        raise ValueError("Inconsistent input usage")
    return (p["response_id"], meta["id"], model or "unknown", timestamp(record["timestamp"]),
            fresh, cached, written, number(u.get("output_tokens")))


def argon_events(step, conversation):
    m = step.get("metadata", {})
    usages = [m.get("modelUsage")] + [r.get("usage") for r in m.get("retryInfos", [])]
    for u in usages:
        if not u:
            continue
        identity = u.get("responseId") or u.get("messageId")
        ts = m.get("finishedGeneratingAt") or m.get("completedAt") or m.get("createdAt")
        if not identity or not ts:
            raise ValueError("Usage identity or timestamp missing")
        yield (identity, conversation, u.get("model") or "unknown", timestamp(ts),
               number(u.get("inputTokens")), number(u.get("cacheReadTokens")),
               number(u.get("cacheWriteTokens")), number(u.get("outputTokens")))


def claude_event(record, root):
    if record.get("type") != "assistant" or record.get("sessionId") != root or record.get("isSidechain"):
        return None
    message = record.get("message") or {}
    usage = message.get("usage")
    if not isinstance(usage, dict):
        return None
    counts = [number(usage.get(k)) for k in
              ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "output_tokens")]
    identity, model = message.get("id"), message.get("model")
    if not identity or identity == "msg_unknown" or not model or model == "<synthetic>":
        if any(counts):
            raise ValueError("Unidentified Claude usage")
        return None  # Local placeholders/errors are not model requests.
    if not message.get("stop_reason"):
        return None  # Wait for a completed response record, not streaming usage.
    # Anthropic input excludes both cache categories. Thinking is already in output.
    return (identity, root, model, timestamp(record["timestamp"]), *counts)


class UsageMirror:
    def __init__(self, root, sessions=None, client_factory=None, grok_reader=None, claude_projects=None):
        self.root = Path(root)
        self.sessions = Path(sessions) if sessions else Path.home() / ".codex" / "sessions"
        self.client_factory = client_factory or self.gemini_client
        self.grok_reader = grok_reader or self.grok_usage
        self.claude_projects = Path(claude_projects) if claude_projects else Path.home() / ".claude" / "projects"
        self.lock = threading.Lock()
        self.running = set()
        self.last_attempt = {}

    @staticmethod
    def grok_usage():
        # Fixed local reader. Credentials stay in Grok Bot, which must already run.
        reader = Path(__file__).with_name("read-grok-usage.mjs")
        result = subprocess.run(["/opt/homebrew/bin/node", str(reader)],
                                capture_output=True, text=True, timeout=30, check=True)
        return json.loads(result.stdout)

    @staticmethod
    def grok_quota(value):
        percent = value["percentUsed"]
        reset = value["nextResetMs"]
        for field in (percent, reset):
            if type(field) not in (float, int) or not math.isfinite(field) or field < 0:
                raise ValueError("Invalid account quota")
        if not reset:
            raise ValueError("Missing quota reset")
        label = value.get("planLabel")
        return {"percentUsed": percent,
                "resetAt": datetime.fromtimestamp(reset / 1000, timezone.utc).isoformat(timespec="milliseconds"),
                "planLabel": label[:80] if isinstance(label, str) else None}

    @staticmethod
    def gemini_client():
        # Existing sibling read-only bridge; never load a path supplied by HTTP.
        path = Path(__file__).resolve().parents[3] / "gemini-api-bridge" / "gemini_api.py"
        spec = importlib.util.spec_from_file_location("leeva_usage_gemini", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.GeminiClient(timeout=12)

    def database(self, cid):
        cid = str(uuid.UUID(cid))
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        path = self.root / (cid + ".sqlite3")
        # Create privately before SQLite opens it.
        fd = os.open(path, os.O_CREAT | os.O_WRONLY, 0o600)
        os.close(fd)
        db = sqlite3.connect(path, timeout=15)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA journal_mode=WAL")
        db.executescript("""
          CREATE TABLE IF NOT EXISTS events (
            provider TEXT, root TEXT, identity TEXT, source TEXT, model TEXT, occurred TEXT,
            fresh INTEGER, cached INTEGER, written INTEGER, output INTEGER,
            PRIMARY KEY (provider, identity));
          CREATE INDEX IF NOT EXISTS events_scope ON events(provider, root, occurred);
          CREATE TABLE IF NOT EXISTS cursors (key TEXT PRIMARY KEY, value TEXT);
          CREATE TABLE IF NOT EXISTS status (
            key TEXT PRIMARY KEY, success TEXT, error TEXT);
        """)
        return db

    @staticmethod
    def cursor(db, key, default):
        row = db.execute("SELECT value FROM cursors WHERE key=?", (key,)).fetchone()
        return json.loads(row[0]) if row else default

    @staticmethod
    def checkpoint(db, key, value):
        db.execute("INSERT OR REPLACE INTO cursors VALUES (?,?)", (key, json.dumps(value)))

    @staticmethod
    def insert(db, provider, root, event):
        identity, source, model, ts, *counts = event
        prior = db.execute("SELECT fresh,cached,written,output FROM events WHERE provider=? AND identity=?",
                           (provider, identity)).fetchone()
        if prior and list(prior) != counts:
            raise ValueError("Conflicting duplicate usage")
        db.execute("INSERT OR IGNORE INTO events VALUES (?,?,?,?,?,?,?,?,?,?)",
                   (provider, root, identity, source, model, ts, *counts))
        if prior:
            db.execute("UPDATE events SET root=? WHERE provider=? AND identity=? AND source=?",
                       (root, provider, identity, source))

    def inventory(self):
        found = []
        for path in self.sessions.rglob("*.jsonl"):
            try:
                with path.open("rb") as stream:
                    record = json.loads(stream.readline())
                meta = record.get("payload", {})
                if record.get("type") == "session_meta" and meta.get("id"):
                    found.append((path, meta))
            except (OSError, ValueError):
                continue
        return found

    def codex(self, db, root, inventory, mapped_roots):
        members = {root}
        while True:
            children = {m["id"] for _, m in inventory if m.get("parent_thread_id") in members
                        and m.get("thread_source") == "subagent" and m["id"] not in mapped_roots}
            if children <= members:
                break
            members |= children
        paths = [(p, m) for p, m in inventory if m["id"] in members]
        if not any(m["id"] == root for _, m in paths):
            raise FileNotFoundError("Mapped conversation not found")
        for path, meta in paths:
            key = "codex:" + root + ":" + str(path)
            old = self.cursor(db, key, {"offset": 0, "model": None})
            stat = path.stat()
            offset = old["offset"] if stat.st_size >= old["offset"] and old.get("inode", stat.st_ino) == stat.st_ino else 0
            model = old["model"] if offset else None
            with path.open("rb") as stream:
                stream.seek(offset)
                while True:
                    start = stream.tell()
                    line = stream.readline()
                    if not line or not line.endswith(b"\n"):
                        offset = start  # Retry an incomplete final record next refresh.
                        break
                    if b'"token_usage_record"' not in line and b'"turn_context"' not in line:
                        continue
                    record = json.loads(line)
                    if record.get("type") == "turn_context":
                        model = record["payload"].get("model")
                    event = codex_event(record, meta, model)
                    if event:
                        self.insert(db, "codex", root, event)
            self.checkpoint(db, key, {"offset": offset, "model": model, "inode": stat.st_ino})

    def argon(self, db, root):
        client = self.client_factory()
        initial = client.snapshot(root, 0, 1)
        total = initial["mainTrajectoryUpdate"]["stepsUpdate"]["totalLength"]
        key = "argon:" + root
        old = self.cursor(db, key, {"next": 0, "pending": []})
        start = max(0, min(old["next"], total) - 50)
        pages = {i // 50 * 50 for i in range(start, total)}
        pages |= {i // 50 * 50 for i in old["pending"] if i < total}
        pending = set(old["pending"])
        for begin in sorted(pages):
            end = min(begin + 50, total)
            payload = {"conversationId": root, "subscriberId": str(uuid.uuid4()),
                       "initialStepsPageBounds": {"startIndex": begin, "endIndexExclusive": end},
                       "initialGeneratorMetadatasPageBounds": {"startIndex": 0, "endIndexExclusive": 0},
                       "initialExecutorMetadatasPageBounds": {"startIndex": 0, "endIndexExclusive": 0},
                       "trajectoryVerbosity": 3, "disableRehydration": True}
            update = client._request("StreamAgentStateUpdates", payload, streaming=True)["update"]
            if update.get("conversationId") != root:
                raise ValueError("Conversation mismatch")
            page = update["mainTrajectoryUpdate"]["stepsUpdate"]
            indices, steps = page.get("indices", []), page.get("steps", [])
            if set(indices) != set(range(begin, end)) or len(indices) != len(steps):
                raise ValueError("Incomplete usage page")
            for index, step in zip(indices, steps):
                terminal = step.get("status") in {"CORTEX_STEP_STATUS_DONE", "CORTEX_STEP_STATUS_ERROR", "CORTEX_STEP_STATUS_CLEARED"}
                if not terminal:
                    pending.add(index)
                    continue  # Don't freeze streaming partial counters.
                pending.discard(index)
                for event in argon_events(step, root):
                    self.insert(db, "argon", root, event)
        self.checkpoint(db, key, {"next": total, "pending": sorted(pending)})

    def claude(self, db, root):
        # Exact mapped session only, never history.jsonl, credentials or subagent logs.
        paths = list(self.claude_projects.glob("*/" + root + ".jsonl"))
        if len(paths) != 1:
            raise ValueError("Claude session missing or ambiguous")
        path = paths[0]
        key = "claude:" + root + ":" + str(path)
        old = self.cursor(db, key, {"offset": 0})
        stat = path.stat()
        offset = old["offset"] if stat.st_size >= old["offset"] and old.get("inode", stat.st_ino) == stat.st_ino else 0
        with path.open("rb") as stream:
            stream.seek(offset)
            while True:
                start = stream.tell()
                line = stream.readline()
                if not line or not line.endswith(b"\n"):
                    offset = start
                    break
                if b'"assistant"' not in line:
                    continue
                event = claude_event(json.loads(line), root)
                if event:
                    self.insert(db, "claude", root, event)
        self.checkpoint(db, key, {"offset": offset, "inode": stat.st_ino})

    def refresh(self, cid, agents):
        db = self.database(cid)
        inventory = None
        roots = {(a.get("metadata") or {}).get("externalId") for a in agents
                 if (a.get("metadata") or {}).get("externalKind") == "codex_thread"}
        seen = set()
        try:
            for agent in agents:
                meta = agent.get("metadata") or {}
                kind, root = meta.get("externalKind"), meta.get("externalId")
                if kind not in {"codex_thread", "argon", "claude_session"} or not root or (kind, root) in seen:
                    continue
                seen.add((kind, root))
                key = kind + ":" + root
                try:
                    uuid.UUID(root)
                    if kind == "codex_thread":
                        if inventory is None:
                            inventory = self.inventory()
                        self.codex(db, root, inventory, roots)
                    elif kind == "argon":
                        self.argon(db, root)
                    else:
                        self.claude(db, root)
                    db.execute("INSERT OR REPLACE INTO status VALUES (?,?,NULL)", (key, now()))
                    db.commit()
                except Exception as error:
                    db.rollback()
                    # Do not expose exceptions containing paths, RPC data or credentials.
                    db.execute("INSERT INTO status VALUES (?,NULL,?) ON CONFLICT(key) DO UPDATE SET error=excluded.error",
                               (key, type(error).__name__))
                    db.commit()
            if any((a.get("metadata") or {}).get("externalKind") == "grok_routine" for a in agents):
                try:
                    quota = self.grok_quota(self.grok_reader())
                    self.checkpoint(db, "grok:account", quota)
                    db.execute("INSERT OR REPLACE INTO status VALUES ('grok:account',?,NULL)", (now(),))
                    db.commit()
                except Exception as error:
                    db.rollback()
                    db.execute("INSERT INTO status VALUES ('grok:account',NULL,?) ON CONFLICT(key) DO UPDATE SET error=excluded.error",
                               (type(error).__name__,))
                    db.commit()
        finally:
            db.close()

    def start_refresh(self, cid, agents):
        with self.lock:
            if cid in self.running or time.monotonic() - self.last_attempt.get(cid, -60) < 60:
                return
            self.running.add(cid)
            self.last_attempt[cid] = time.monotonic()
        def work():
            try:
                self.refresh(cid, agents)
            finally:
                with self.lock:
                    self.running.discard(cid)
        threading.Thread(target=work, daemon=True).start()

    def summary(self, cid, agents, begin=None, end=None):
        lower = timestamp(begin) if begin else ""
        upper = timestamp(end) if end else "9999"
        if lower > upper:
            raise ValueError("Invalid date range")
        db = self.database(cid)
        rows, daily, seen = [], [], set()
        grok_account = None
        try:
            db.execute("BEGIN")  # Tables and charts use one snapshot during background sync.
            if any((a.get("metadata") or {}).get("externalKind") == "grok_routine" for a in agents):
                state = db.execute("SELECT success,error FROM status WHERE key='grok:account'").fetchone()
                grok_account = {**self.cursor(db, "grok:account", {}), "scope": "account",
                                "tokenUsageAvailable": False, "syncedAt": state["success"] if state else None,
                                "status": "unavailable" if state and state["error"] else
                                "connected" if state and state["success"] else "pending"}
            for agent in agents:
                meta = agent.get("metadata") or {}
                kind, root = meta.get("externalKind"), meta.get("externalId")
                supported = kind in {"codex_thread", "argon", "claude_session"} and bool(root)
                duplicate = supported and (kind, root) in seen
                seen.add((kind, root))
                provider = {"codex_thread": "codex", "claude_session": "claude"}.get(kind, "argon")
                result = db.execute("""SELECT count(*) AS requests, coalesce(sum(fresh),0) AS fresh,
                  coalesce(sum(cached),0) AS cached, coalesce(sum(written),0) AS written,
                  coalesce(sum(output),0) AS output, min(occurred) AS firstEvent, max(occurred) AS lastEvent
                  FROM events WHERE provider=? AND root=? AND occurred>=? AND occurred<=?""",
                                    (provider, root, lower, upper)).fetchone() if supported and not duplicate else None
                state = db.execute("SELECT success,error FROM status WHERE key=?", (str(kind) + ":" + str(root),)).fetchone() if supported else None
                row = dict(result) if result else dict(requests=0, fresh=0, cached=0, written=0, output=0, firstEvent=None, lastEvent=None)
                row.update(agentId=agent["id"], name=agent["name"], provider=provider if supported else kind,
                           status="duplicate_mapping" if duplicate else "unsupported" if not supported else
                           "unavailable" if state and state["error"] else "connected" if state and state["success"] else "pending",
                           syncedAt=state["success"] if state else None, costCents=None)
                row["total"] = sum(row[k] for k in ("fresh", "cached", "written", "output"))
                if kind == "grok_routine":
                    row.update(status="quota_only" if grok_account["status"] == "connected" else grok_account["status"],
                               syncedAt=grok_account["syncedAt"])
                rows.append(row)
                if supported and not duplicate:
                    days = db.execute("""SELECT strftime('%Y-%m-%d',occurred,'+8 hours') AS date,
                      count(*) AS requests, sum(fresh) AS fresh, sum(cached) AS cached,
                      sum(written) AS written, sum(output) AS output,
                      sum(fresh+cached+written+output) AS total
                      FROM events WHERE provider=? AND root=? AND occurred>=? AND occurred<=?
                      GROUP BY date ORDER BY date""", (provider, root, lower, upper))
                    daily.extend({**dict(day), "agentId": agent["id"]} for day in days)
        finally:
            db.close()
        self.start_refresh(cid, agents)
        return {"rows": rows, "refreshing": cid in self.running, "costCents": None, "grokAccount": grok_account,
                "daily": daily, "dayTimezone": "Asia/Shanghai",
                "totals": {k: sum(r[k] for r in rows) for k in ("requests", "fresh", "cached", "written", "output", "total")}}
