#!/usr/bin/env python3
"""Local Paperclip rule storage and Grok route reader. Never dispatches work."""
from __future__ import annotations

import argparse
import copy
from datetime import datetime, timezone
import fcntl
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import os
from pathlib import Path
import re
import tempfile
import urllib.error
import urllib.request
from urllib.parse import urlparse
import uuid

KINDS = {"dispatch", "review", "escalate", "notify"}
OUTCOMES = {"dispatch": "requested", "review": "completed", "escalate": "needs_judgment", "notify": "milestone"}
ORIGINS = {"http://127.0.0.1:3100", "http://localhost:3100", "http://127.0.0.1:3101", "http://localhost:3101"}
DEFAULT_STORE = Path.home() / ".paperclip" / "leeva" / "collaboration"
DEFAULT_PAPERCLIP = "http://127.0.0.1:3100"
ROUTE = re.compile(r"^/api/companies/([0-9a-fA-F-]{36})/collaboration$")


class RuleError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def now():
    return datetime.now(timezone.utc).isoformat()


def company_id(value):
    try:
        return str(uuid.UUID(value))
    except (ValueError, TypeError, AttributeError):
        raise RuleError("Invalid company ID")


def read_json(path, default=None):
    if not path.exists():
        return copy.deepcopy(default)
    with path.open() as stream:
        return json.load(stream)


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(prefix=".rules-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def fetch_agents(base, cid):
    parsed = urlparse(base)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost"} or parsed.username or parsed.password:
        raise RuleError("Only the local Paperclip instance is supported", 503)
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(base.rstrip("/") + "/api/companies/" + company_id(cid) + "/agents", timeout=8) as response:
            agents = json.load(response)
    except (OSError, ValueError, urllib.error.URLError):
        raise RuleError("Cannot verify agents with local Paperclip", 503)
    if not isinstance(agents, list) or any(not isinstance(a, dict) or a.get("companyId") != cid for a in agents):
        raise RuleError("Paperclip returned an invalid company agent list", 503)
    return agents


def validate_payload(payload, agents):
    if not isinstance(payload, dict) or set(payload) != {"expectedVersion", "rules", "positions"}:
        raise RuleError("Expected expectedVersion, rules and positions")
    version = payload["expectedVersion"]
    if type(version) is not int or version < 0:
        raise RuleError("Invalid expected version")
    ids = {a["id"] for a in agents if a.get("status") != "terminated"}
    rules, positions = payload["rules"], payload["positions"]
    if not isinstance(rules, list) or len(rules) > 500:
        raise RuleError("At most 500 rules are supported")
    rule_ids, edges = set(), set()
    for rule in rules:
        if not isinstance(rule, dict) or set(rule) != {"id", "source", "target", "kind", "enabled"}:
            raise RuleError("Invalid rule fields")
        if not isinstance(rule["id"], str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", rule["id"]) or rule["id"] in rule_ids:
            raise RuleError("Rule IDs must be unique")
        if not isinstance(rule["source"], str) or not isinstance(rule["target"], str) or rule["source"] not in ids or rule["target"] not in ids:
            raise RuleError("Rule endpoints must be active records in this company")
        if rule["source"] == rule["target"]:
            raise RuleError("An agent cannot route work to itself")
        if not isinstance(rule["kind"], str) or rule["kind"] not in KINDS or type(rule["enabled"]) is not bool:
            raise RuleError("Invalid rule type or enabled flag")
        edge = (rule["source"], rule["target"], rule["kind"])
        if edge in edges:
            raise RuleError("Duplicate collaboration rule")
        edges.add(edge)
        rule_ids.add(rule["id"])
    # Feedback between execution and review is valid; a dispatch-only loop is not.
    adjacency = {}
    for rule in rules:
        if rule["enabled"] and rule["kind"] == "dispatch":
            adjacency.setdefault(rule["source"], []).append(rule["target"])
    visiting, visited = set(), set()
    def visit(node):
        if node in visiting:
            raise RuleError("Dispatch rules cannot form a cycle")
        if node in visited:
            return
        visiting.add(node)
        for target in adjacency.get(node, []):
            visit(target)
        visiting.remove(node)
        visited.add(node)
    for node in adjacency:
        visit(node)
    if not isinstance(positions, dict) or len(positions) > 1000:
        raise RuleError("Invalid positions")
    for key, point in positions.items():
        if key not in ids or not isinstance(point, dict) or set(point) != {"x", "y"}:
            raise RuleError("Positions must belong to agents in this company")
        if any(type(point[axis]) not in (int, float) or not math.isfinite(point[axis]) or abs(point[axis]) > 100000 for axis in ("x", "y")):
            raise RuleError("Invalid position coordinate")
    return copy.deepcopy(payload)


def endpoint(agent):
    metadata = agent.get("metadata") or {}
    return {"externalKind": metadata.get("externalKind"), "externalId": metadata.get("externalId")}


def available(agent):
    metadata = agent.get("metadata") or {}
    live = metadata.get("live") or {}
    return agent.get("status") in {"active", "idle", "running"} and live.get("pausedByUser") is not True


class Store:
    def __init__(self, root=DEFAULT_STORE):
        self.root = Path(root)

    def directory(self, cid):
        return self.root / company_id(cid)

    def get(self, cid):
        directory = self.directory(cid)
        current = read_json(directory / "current.json", {"version": 0, "rules": [], "positions": {}, "updatedAt": None})
        current["receipt"] = read_json(directory / "receipt.json")
        current["scheduler"] = {"state": "unknown", "managedExternally": True}
        return current

    def publish(self, cid, payload, agents):
        payload = validate_payload(payload, agents)
        directory = self.directory(cid)
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        with (directory / ".lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            current = self.get(cid)
            if current["version"] != payload["expectedVersion"]:
                raise RuleError("Rules changed elsewhere. Reload before saving.", 409)
            used_ids = {r[key] for r in payload["rules"] for key in ("source", "target")}
            published = {"version": current["version"] + 1, "rules": payload["rules"], "positions": payload["positions"], "updatedAt": now(),
                         "endpoints": {a["id"]: endpoint(a) for a in agents if a["id"] in used_ids}}
            atomic_json(directory / "versions" / (str(published["version"]) + ".json"), published)
            atomic_json(directory / "current.json", published)
            return self.get(cid)

    def read_for_consumer(self, cid, consumer):
        if consumer != "grok-bot":
            raise RuleError("The configured consumer is grok-bot")
        current = self.get(cid)
        if current["version"] == 0:
            raise RuleError("No rules have been published", 409)
        receipt = {"version": current["version"], "readAt": now(), "consumer": consumer}
        atomic_json(self.directory(cid) / "receipt.json", receipt)
        current["receipt"] = receipt
        return current

    def version(self, cid, version):
        if type(version) is not int or version < 1:
            raise RuleError("A published rule version is required")
        config = read_json(self.directory(cid) / "versions" / (str(version) + ".json"))
        if not config:
            raise RuleError("Rule version not found", 404)
        return config

    def pin_task(self, cid, task_id, version):
        directory = self.directory(cid)
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        with (directory / ".lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            pins = read_json(directory / "task-versions.json", {})
            existing = pins.get(task_id)
            if existing is not None and existing != version:
                raise RuleError("Task is pinned to rule version " + str(existing) + "; do not reroute work already in progress", 409)
            if existing is None:
                pins[task_id] = version
                atomic_json(directory / "task-versions.json", pins)


def resolve(config, agents, source, kind, outcome, target=None):
    """Return a route decision, never an execution. Ambiguous requests fail closed."""
    if kind not in KINDS or outcome != OUTCOMES[kind]:
        raise RuleError("A matching explicit event is required; idle is not completion")
    by_id = {agent["id"]: agent for agent in agents}
    if source not in by_id:
        raise RuleError("Source agent is not in this company")
    if not available(by_id[source]):
        raise RuleError("Source agent is paused or unavailable", 409)
    if config.get("endpoints", {}).get(source) != endpoint(by_id[source]):
        raise RuleError("Source external mapping changed since publication; stop and review the rules", 409)
    rules = [rule for rule in config["rules"] if rule["enabled"] and rule["source"] == source and rule["kind"] == kind
             and (target is None or rule["target"] == target)]
    if not rules:
        raise RuleError("No enabled route matches this event", 409)
    if kind != "notify" and len(rules) != 1:
        raise RuleError("Multiple routes match. Select an explicit target; do not guess.", 409)
    destinations = []
    for rule in rules:
        agent = by_id.get(rule["target"])
        if not agent or not available(agent):
            raise RuleError("A target agent is paused or unavailable", 409)
        if config.get("endpoints", {}).get(agent["id"]) != endpoint(agent):
            raise RuleError("Target external mapping changed since publication; stop and review the rules", 409)
        metadata = agent.get("metadata") or {}
        external_kind, external_id = metadata.get("externalKind"), metadata.get("externalId")
        if external_kind not in {"codex_thread", "argon"} or not isinstance(external_id, str) or not external_id:
            raise RuleError("Target has no verified external bridge mapping; do not substitute another agent", 409)
        destinations.append({"ruleId": rule["id"], "agentId": agent["id"], "name": agent["name"],
                             "externalKind": external_kind, "externalId": external_id})
    return {"version": config["version"], "source": source, "kind": kind, "targets": destinations,
            "executed": False, "instruction": "Use the existing authorized Grok workflow. This decision does not send, resume or approve work."}


def make_handler(store, paperclip, port, usage=None):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def guard(self, mutation=False):
            if self.headers.get("Host") not in {"127.0.0.1:" + str(port), "localhost:" + str(port)}:
                raise RuleError("Invalid host", 403)
            origin = self.headers.get("Origin")
            if origin is not None and origin not in ORIGINS:
                raise RuleError("Origin is not allowed", 403)
            if mutation and self.headers.get("X-Leeva-Client") != "paperclip-ui":
                raise RuleError("Missing client header", 403)

        def respond(self, code, data):
            self.send_response(code)
            origin = self.headers.get("Origin")
            if origin in ORIGINS:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(json.dumps(data, ensure_ascii=False).encode())

        def do_OPTIONS(self):
            try:
                self.guard()
                self.send_response(204)
                self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin", "http://127.0.0.1:3100"))
                self.send_header("Access-Control-Allow-Methods", "GET, PUT, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Leeva-Client")
                self.end_headers()
            except RuleError as error:
                self.respond(error.status, {"error": str(error)})

        def handle_request(self, mutation=False):
            try:
                self.guard(mutation)
                from urllib.parse import urlsplit, parse_qs
                parsed = urlsplit(self.path)
                usage_match = re.fullmatch(r"/api/companies/([0-9a-fA-F-]{36})/external-usage", parsed.path)
                if usage_match and usage is not None:
                    if mutation:
                        raise RuleError("Usage is read-only", 405)
                    cid = company_id(usage_match[1])
                    agents = fetch_agents(paperclip, cid)
                    query = parse_qs(parsed.query)
                    self.respond(200, usage.summary(cid, agents, query.get("from", [None])[0], query.get("to", [None])[0]))
                    return
                match = ROUTE.fullmatch(self.path)
                if not match:
                    raise RuleError("Not found", 404)
                cid = company_id(match[1])
                agents = fetch_agents(paperclip, cid)
                if mutation:
                    length = int(self.headers.get("Content-Length", "0"))
                    if not 0 < length <= 262144:
                        raise RuleError("Invalid request size", 413)
                    body = json.loads(self.rfile.read(length))
                    data = store.publish(cid, body, agents)
                else:
                    data = store.get(cid)
                self.respond(200, data)
            except RuleError as error:
                self.respond(error.status, {"error": str(error)})
            except (ValueError, TypeError, KeyError):
                self.respond(400, {"error": "Invalid request or stored rule data"})
            except OSError:
                self.respond(503, {"error": "Rule storage is unavailable"})

        def do_GET(self):
            self.handle_request()

        def do_PUT(self):
            self.handle_request(True)
    return Handler


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--store", type=Path, default=DEFAULT_STORE)
    parser.add_argument("--paperclip", default=DEFAULT_PAPERCLIP)
    sub = parser.add_subparsers(dest="command", required=True)
    serve = sub.add_parser("serve")
    serve.add_argument("--port", type=int, default=3103)
    read = sub.add_parser("read", help="Read published rules and record a read receipt; never run work")
    read.add_argument("--company", required=True)
    read.add_argument("--consumer", choices=["grok-bot"], required=True)
    decision = sub.add_parser("resolve", help="Resolve a pinned rule version; never run or send work")
    decision.add_argument("--company", required=True)
    decision.add_argument("--version", type=int, required=True)
    decision.add_argument("--source", required=True)
    decision.add_argument("--kind", choices=sorted(KINDS), required=True)
    decision.add_argument("--outcome", choices=sorted(OUTCOMES.values()), required=True)
    decision.add_argument("--target")
    decision.add_argument("--task-id", required=True)
    decision.add_argument("--event-id", required=True)
    args = parser.parse_args(argv)
    store = Store(args.store)
    try:
        if args.command == "serve":
            from external_usage import UsageMirror
            usage = UsageMirror(args.store.parent / "usage")
            server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(store, args.paperclip, args.port, usage))
            print("Leeva collaboration rules listening on loopback port " + str(args.port), flush=True)
            server.serve_forever()
        elif args.command == "read":
            fetch_agents(args.paperclip, args.company)
            print(json.dumps(store.read_for_consumer(args.company, args.consumer), ensure_ascii=False))
        else:
            if not args.task_id.strip() or not args.event_id.strip() or len(args.task_id) > 200 or len(args.event_id) > 200:
                raise RuleError("Task and event IDs are required and must be at most 200 characters")
            result = resolve(store.version(args.company, args.version), fetch_agents(args.paperclip, args.company),
                             args.source, args.kind, args.outcome, args.target)
            store.pin_task(args.company, args.task_id, args.version)
            result.update(taskId=args.task_id, eventId=args.event_id)
            print(json.dumps(result, ensure_ascii=False))
        return 0
    except RuleError as error:
        print(json.dumps({"error": str(error), "executed": False}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
