import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch, Mock
import urllib.error
import urllib.request

spec = importlib.util.spec_from_file_location("rules", Path(__file__).with_name("collaboration_rules.py"))
rules = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rules)

CID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
A, B, C = [str(n) * 8 + "-aaaa-4aaa-8aaa-aaaaaaaaaaaa" for n in (1, 2, 3)]


def agents():
    return [{"id": identifier, "companyId": CID, "name": name, "status": "idle",
             "metadata": {"externalKind": "codex_thread", "externalId": identifier}}
            for identifier, name in ((A, "Worker"), (B, "Reviewer"), (C, "Other reviewer"))]


def payload(target=B, version=0):
    return {"expectedVersion": version, "rules": [{"id": "review", "source": A, "target": target, "kind": "review", "enabled": True}],
            "positions": {A: {"x": 10, "y": 20}}}


class RulesTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = rules.Store(self.temp.name)
    def tearDown(self):
        self.temp.cleanup()

    def test_rewire_changes_real_resolver_target_but_preserves_old_version(self):
        first = self.store.publish(CID, payload(), agents())
        second = self.store.publish(CID, payload(C, 1), agents())
        old = rules.resolve(self.store.version(CID, 1), agents(), A, "review", "completed")
        new = rules.resolve(self.store.version(CID, 2), agents(), A, "review", "completed")
        self.assertEqual(old["targets"][0]["agentId"], B)
        self.assertEqual(new["targets"][0]["agentId"], C)
        self.assertFalse(new["executed"])
        self.assertEqual(first["version"], 1)
        self.assertEqual(second["version"], 2)

    def test_version_conflict_preserves_published_rules(self):
        self.store.publish(CID, payload(), agents())
        with self.assertRaises(rules.RuleError) as caught:
            self.store.publish(CID, payload(C), agents())
        self.assertEqual(caught.exception.status, 409)
        self.assertEqual(self.store.get(CID)["rules"][0]["target"], B)

    def test_layout_and_rule_roundtrip_without_mutating_agents(self):
        records = agents()
        before = copy.deepcopy(records)
        config = self.store.publish(CID, payload(), records)
        self.assertEqual(config["positions"][A], {"x": 10, "y": 20})
        self.assertEqual(records, before)
        self.assertIsNone(config["receipt"])

    def test_read_receipt_is_versioned_not_execution_success(self):
        self.store.publish(CID, payload(), agents())
        read = self.store.read_for_consumer(CID, "grok-bot")
        self.assertEqual(read["receipt"]["version"], 1)
        self.assertNotIn("executed", read["receipt"])
        latest = self.store.publish(CID, payload(C, 1), agents())
        self.assertEqual(latest["receipt"]["version"], 1)
        self.assertEqual(latest["version"], 2)

    def test_tasks_cannot_switch_rule_versions_midflight(self):
        self.store.publish(CID, payload(), agents())
        self.store.publish(CID, payload(C, 1), agents())
        self.store.pin_task(CID, "task-1", 1)
        self.store.pin_task(CID, "task-1", 1)
        with self.assertRaises(rules.RuleError):
            self.store.pin_task(CID, "task-1", 2)
        self.store.pin_task(CID, "task-2", 2)

    def test_invalid_graphs_do_not_publish(self):
        invalid = []
        item = payload(); item["rules"][0]["target"] = A; invalid.append(item)
        item = payload(); item["rules"][0]["target"] = "foreign-agent"; invalid.append(item)
        item = payload(); item["rules"].append({**item["rules"][0], "id": "copy"}); invalid.append(item)
        item = payload(); item["positions"][A]["x"] = float("nan"); invalid.append(item)
        item = payload(); item["expectedVersion"] = True; invalid.append(item)
        item = payload(); item["rules"][0]["source"] = []; invalid.append(item)
        for candidate in invalid:
            with self.subTest(candidate=candidate), self.assertRaises(rules.RuleError):
                self.store.publish(CID, candidate, agents())
        self.assertEqual(self.store.get(CID)["version"], 0)

    def test_dispatch_cycles_rejected_but_review_return_allowed(self):
        item = payload()
        item["rules"].append({"id": "delegate", "source": B, "target": A, "kind": "dispatch", "enabled": True})
        self.store.publish(CID, item, agents())
        item["expectedVersion"] = 1
        item["rules"][0]["kind"] = "dispatch"
        with self.assertRaises(rules.RuleError):
            self.store.publish(CID, item, agents())

    def test_pause_idle_disabled_and_unmapped_targets_do_not_resolve(self):
        config = self.store.publish(CID, payload(), agents())
        paused = agents(); paused[1]["status"] = "paused"
        unmapped = agents(); unmapped[1]["metadata"] = {}
        pending = agents(); pending[1]["status"] = "pending_approval"
        marker = agents(); marker[1]["metadata"]["live"] = {"pausedByUser": True}
        disabled = copy.deepcopy(config); disabled["rules"][0]["enabled"] = False
        cases = [(config, paused, "completed"), (config, unmapped, "completed"), (config, pending, "completed"),
                 (config, marker, "completed"), (disabled, agents(), "completed"), (config, agents(), "idle")]
        for cfg, records, outcome in cases:
            with self.subTest(outcome=outcome), self.assertRaises(rules.RuleError):
                rules.resolve(cfg, records, A, "review", outcome)

    def test_external_thread_mapping_cannot_change_under_pinned_version(self):
        config = self.store.publish(CID, payload(), agents())
        records = agents()
        records[1]["metadata"]["externalId"] = C
        with self.assertRaisesRegex(rules.RuleError, "mapping changed"):
            rules.resolve(config, records, A, "review", "completed")

    def test_ambiguous_routes_require_explicit_target(self):
        item = payload()
        item["rules"].append({**item["rules"][0], "id": "other", "target": C})
        config = self.store.publish(CID, item, agents())
        with self.assertRaises(rules.RuleError):
            rules.resolve(config, agents(), A, "review", "completed")
        self.assertEqual(rules.resolve(config, agents(), A, "review", "completed", C)["targets"][0]["agentId"], C)

    def test_company_paths_cannot_escape_store(self):
        with self.assertRaises(rules.RuleError):
            self.store.get("../../etc")


class HttpTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = rules.Store(self.temp.name)
        self.agent_patch = patch.object(rules, "fetch_agents", return_value=agents())
        self.agent_patch.start()
        self.server = rules.ThreadingHTTPServer(("127.0.0.1", 0), rules.make_handler(self.store, "http://127.0.0.1:3100", 0))
        self.port = self.server.server_address[1]
        self.server.RequestHandlerClass = rules.make_handler(self.store, "http://127.0.0.1:3100", self.port)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join()
        self.agent_patch.stop(); self.temp.cleanup()

    def request(self, method="GET", headers=None, data=None):
        request = urllib.request.Request(f"http://127.0.0.1:{self.port}/api/companies/{CID}/collaboration", method=method,
                                         headers=headers or {}, data=json.dumps(data).encode() if data else None)
        return urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=3)

    def test_browser_can_publish_and_read_only_from_allowed_origin(self):
        headers = {"Origin": "http://127.0.0.1:3100", "X-Leeva-Client": "paperclip-ui", "Content-Type": "application/json"}
        with self.request("PUT", headers, payload()) as response:
            self.assertEqual(json.load(response)["version"], 1)
            self.assertEqual(response.headers["Access-Control-Allow-Origin"], headers["Origin"])
        with self.request() as response:
            self.assertEqual(json.load(response)["rules"][0]["target"], B)

    def test_cross_origin_and_rebinding_writes_rejected(self):
        for headers in ({"Origin": "https://evil.example", "X-Leeva-Client": "paperclip-ui"},
                        {"Origin": "http://127.0.0.1:3100"},
                        {"Host": "evil.example", "X-Leeva-Client": "paperclip-ui"}):
            with self.subTest(headers=headers), self.assertRaises(urllib.error.HTTPError) as caught:
                self.request("PUT", headers, payload())
            self.assertEqual(caught.exception.code, 403)
        self.assertEqual(self.store.get(CID)["version"], 0)

    def test_usage_endpoint_keeps_company_and_date_scope(self):
        usage = Mock()
        usage.summary.return_value = {"rows": [], "costCents": None}
        self.server.RequestHandlerClass = rules.make_handler(self.store, "http://127.0.0.1:3100", self.port, usage)
        url = f"http://127.0.0.1:{self.port}/api/companies/{CID}/external-usage?from=2026-10-19T00%3A00%3A00Z"
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(url) as response:
            self.assertIsNone(json.load(response)["costCents"])
        usage.summary.assert_called_once_with(CID, agents(), "2026-10-19T00:00:00Z", None)
        self.assertEqual(self.store.get(CID)["version"], 0)

    def test_usage_rejects_writes_and_foreign_origins(self):
        usage = Mock()
        self.server.RequestHandlerClass = rules.make_handler(self.store, "http://127.0.0.1:3100", self.port, usage)
        url = f"http://127.0.0.1:{self.port}/api/companies/{CID}/external-usage"
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        for method, headers, status in [("GET", {"Origin": "https://evil.example"}, 403),
                                        ("PUT", {"X-Leeva-Client": "paperclip-ui"}, 405)]:
            with self.assertRaises(urllib.error.HTTPError) as caught:
                opener.open(urllib.request.Request(url, method=method, headers=headers))
            self.assertEqual(caught.exception.code, status)
        usage.summary.assert_not_called()


if __name__ == "__main__":
    unittest.main()
