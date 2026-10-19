import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from external_usage import UsageMirror, argon_events, codex_event, timestamp

CID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
ROOT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
CHILD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
TS = "2026-10-19T08:00:00Z"


def agent(root=ROOT, kind="codex_thread", identifier="agent"):
    return dict(id=identifier, name=identifier, metadata=dict(externalKind=kind, externalId=root))


def record(identity="response", owner=ROOT):
    return dict(type="token_usage_record", timestamp=TS, payload=dict(response_id=identity,
        thread_id=owner, usage=dict(input_tokens=100, cached_input_tokens=80, output_tokens=10)))


def meta(root=ROOT, **extra):
    return dict(id=root, timestamp="2026-10-18T00:00:00Z", **extra)


def step(identity="response", status="CORTEX_STEP_STATUS_DONE"):
    usage = dict(responseId=identity, inputTokens=20, cacheReadTokens=80, outputTokens=10,
                 thinkingOutputTokens=7, responseOutputTokens=3, model="provider-reported-model")
    return dict(status=status, metadata=dict(createdAt=TS, modelUsage=usage,
                                            retryInfos=[dict(usage=usage)]))


class FakeGemini:
    def __init__(self):
        self.steps = [step()]
        self.pages = []

    def snapshot(self, root, *_args):
        return {"mainTrajectoryUpdate": {"stepsUpdate": {"totalLength": len(self.steps)}}}

    def _request(self, method, payload, streaming=False):
        assert method == "StreamAgentStateUpdates" and streaming
        bounds = payload["initialStepsPageBounds"]
        start, end = bounds["startIndex"], bounds["endIndexExclusive"]
        self.pages.append(start)
        return {"update": {"conversationId": ROOT, "mainTrajectoryUpdate": {"stepsUpdate": {
            "indices": list(range(start, end)), "steps": self.steps[start:end]}}}}


class UsageTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.sessions = self.base / "sessions"
        self.sessions.mkdir()
        self.fake = FakeGemini()
        self.mirror = UsageMirror(self.base / "usage", self.sessions, lambda: self.fake)
        self.mirror.start_refresh = lambda *_args: None

    def tearDown(self):
        self.temp.cleanup()

    def log(self, name="a", metadata=None, records=None):
        path = self.sessions / (name + ".jsonl")
        entries = [dict(type="session_meta", payload=metadata or meta()),
                   dict(type="turn_context", payload={"model": "test-model"})] + (records or [record()])
        path.write_text("".join(json.dumps(e) + "\n" for e in entries))
        return path

    def summary(self, agents=None, **kwargs):
        return self.mirror.summary(CID, agents or [agent()], **kwargs)

    def test_cache_and_reasoning_are_not_double_counted(self):
        c = codex_event(record(), meta(), "test")
        a = next(argon_events(step(), ROOT))
        self.assertEqual(c[-4:], a[-4:])
        self.assertEqual(sum(c[-4:]), 110)

    def test_duplicate_and_incremental_records_survive_restart_once(self):
        path = self.log()
        self.log("rehydrated")
        self.mirror.refresh(CID, [agent()])
        with path.open("a") as f:
            f.write(json.dumps(record("next")) + "\n")
        self.mirror = UsageMirror(self.base / "usage", self.sessions)
        self.mirror.start_refresh = lambda *_args: None
        self.mirror.refresh(CID, [agent()])
        self.assertEqual(self.summary()["totals"]["total"], 220)
        self.mirror.refresh(CID, [agent()])
        self.assertEqual(self.summary()["totals"]["requests"], 2)

    def test_partial_json_tail_is_retried(self):
        path = self.log()
        encoded = json.dumps(record("next")) + "\n"
        with path.open("a") as f:
            f.write(encoded[:30])
        self.mirror.refresh(CID, [agent()])
        with path.open("a") as f:
            f.write(encoded[30:])
        self.mirror.refresh(CID, [agent()])
        self.assertEqual(self.summary()["totals"]["requests"], 2)

    def test_only_mapped_threads_and_actual_subagents_no_inherited_guardian_or_forks(self):
        self.log(records=[record(), record("inherited", owner=CHILD)])
        self.log("child", meta(CHILD, parent_thread_id=ROOT, thread_source="subagent"), [record("child", CHILD)])
        self.log("guardian", meta("guardian", parent_thread_id=ROOT, thread_source="guardian_review"), [record("guard", "guardian")])
        self.log("fork", meta("fork", forked_from_id=ROOT, thread_source="user"), [record("fork", "fork")])
        self.mirror.refresh(CID, [agent()])
        self.assertEqual(self.summary()["totals"]["requests"], 2)

    def test_explicit_child_mapping_moves_usage_without_double_count(self):
        self.log()
        self.log("child", meta(CHILD, parent_thread_id=ROOT, thread_source="subagent"), [record("child", CHILD)])
        self.mirror.refresh(CID, [agent()])
        agents = [agent(), agent(CHILD, identifier="child-agent")]
        self.mirror.refresh(CID, agents)
        result = self.summary(agents)
        self.assertEqual([r["requests"] for r in result["rows"]], [1, 1])

    def test_date_range_and_company_isolation(self):
        self.log()
        self.mirror.refresh(CID, [agent()])
        self.assertEqual(self.summary(begin=TS, end=TS)["totals"]["requests"], 1)
        self.assertEqual(self.summary(begin="2026-10-20T00:00:00+08:00")["totals"]["requests"], 0)
        other = self.mirror.summary(ROOT, [agent()])
        self.assertEqual(other["totals"]["requests"], 0)
        with self.assertRaises(ValueError):
            self.summary(begin="2026-10-20T00:00:00Z", end=TS)
        with self.assertRaises(ValueError):
            self.mirror.database("../../outside")

    def test_missing_source_is_unavailable_not_connected_zero_and_money_is_unknown(self):
        self.mirror.refresh(CID, [agent()])
        row = self.summary()["rows"][0]
        self.assertEqual(row["status"], "unavailable")
        self.assertIsNone(row["syncedAt"])
        self.assertIsNone(row["costCents"])
        self.assertEqual(self.summary([agent(kind="grok_routine")])["rows"][0]["status"], "unsupported")

    def test_duplicate_mapping_is_explicit_and_not_summed_twice(self):
        self.log()
        agents = [agent(), agent(identifier="duplicate")]
        self.mirror.refresh(CID, agents)
        result = self.summary(agents)
        self.assertEqual(result["rows"][1]["status"], "duplicate_mapping")
        self.assertEqual(result["totals"]["requests"], 1)

    def test_argon_retry_duplicates_and_distinct_retries(self):
        self.fake.steps[0]["metadata"]["retryInfos"].append(dict(usage=step("retry")["metadata"]["modelUsage"]))
        agents = [agent(kind="argon")]
        self.mirror.refresh(CID, agents)
        self.mirror.refresh(CID, agents)
        result = self.summary(agents)
        self.assertEqual(result["totals"]["requests"], 2)
        self.assertEqual(result["totals"]["total"], 220)

    def test_argon_pending_old_step_revisited_beyond_tail(self):
        self.fake.steps = [step(str(i)) for i in range(120)]
        self.fake.steps[0]["status"] = "RUNNING"
        agents = [agent(kind="argon")]
        self.mirror.refresh(CID, agents)
        self.assertEqual(self.summary(agents)["totals"]["requests"], 119)
        self.fake.pages.clear()
        self.fake.steps[0]["status"] = "CORTEX_STEP_STATUS_DONE"
        self.mirror.refresh(CID, agents)
        self.assertIn(0, self.fake.pages)
        self.assertEqual(self.summary(agents)["totals"]["requests"], 120)

    def test_failure_preserves_prior_counts_and_sync_time(self):
        agents = [agent(kind="argon")]
        self.mirror.refresh(CID, agents)
        first = self.summary(agents)["rows"][0]
        with patch.object(self.fake, "snapshot", side_effect=OSError("private error not exposed")):
            self.mirror.refresh(CID, agents)
        row = self.summary(agents)["rows"][0]
        self.assertEqual(row["status"], "unavailable")
        self.assertEqual(row["syncedAt"], first["syncedAt"])
        self.assertEqual(row["total"], 110)

    def test_conflicting_duplicate_rolls_back_and_reports_invalid_source(self):
        self.log()
        self.mirror.refresh(CID, [agent()])
        broken = record()
        broken["payload"]["usage"]["output_tokens"] = 50
        self.log("conflict", records=[broken])
        self.mirror.refresh(CID, [agent()])
        row = self.summary()["rows"][0]
        self.assertEqual(row["status"], "unavailable")
        self.assertEqual(row["total"], 110)

    def test_usage_metadata_contains_no_transcript(self):
        self.log(records=[dict(type="response_item", payload={"content": "private-canary"}), record()])
        self.mirror.refresh(CID, [agent()])
        db = self.mirror.database(CID)
        dump = "\n".join(db.iterdump())
        db.close()
        self.assertNotIn("private-canary", dump)
        self.assertEqual((self.base / "usage" / (CID + ".sqlite3")).stat().st_mode & 0o777, 0o600)


if __name__ == "__main__":
    unittest.main()
