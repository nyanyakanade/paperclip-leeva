import copy
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from deepseek_usage import parse_usage, session_id
from external_usage import UsageMirror

CID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
ROOT = "session-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
OLD = "session-cccccccc-cccc-4ccc-8ccc-cccccccccccc"


def records(root=ROOT):
    return [dict(type="session", version=4, id=root, isSeeded=False),
            dict(type="request/context", seq=0, time=1792416000000, data=dict(model="deepseek-flash")),
            dict(type="assistant/message", seq=1, time=1792416001000, data=dict(
                usage=dict(inputTokens=20, cacheReadTokens=80, cacheWriteTokens=5, outputTokens=10, totalTokens=115),
                stream=[dict(type="usage", usage=dict(outputTokens=10))])),
            dict(type="compaction/summary", seq=2, time=1792416002000, data=dict(
                model="summary-model", usage=dict(inputTokens=2, outputTokens=3, totalTokens=5))),
            dict(type="assistant/attempt", seq=3, time=1792416003000, data=dict(stream=[]))]


def encode(rows):
    return b"".join(json.dumps(r).encode() + b"\n" for r in rows)


def agent(root=ROOT):
    return dict(id="deepseek", name="DeepSeek Harness", metadata=dict(
        externalKind="deepseek_harness_session", externalId=root))


class DeepSeekUsageTest(unittest.TestCase):
    def test_fresh_cache_compaction_and_stream_duplicate(self):
        events = list(parse_usage(encode(records()), ROOT))
        self.assertEqual(len(events), 2)
        self.assertEqual(events[0], (ROOT + ":1", ROOT, "deepseek-flash", "2026-10-19T13:20:01.000+00:00", 20, 80, 5, 10))
        self.assertEqual(events[1][2], "summary-model")
        self.assertEqual(sum(sum(e[-4:]) for e in events), 120)

    def test_rejects_wrong_session_seeded_history_gaps_and_inconsistent_counters(self):
        cases = []
        bad = records(); bad[0]["id"] = OLD; cases.append(bad)
        bad = records(); bad[0]["isSeeded"] = True; cases.append(bad)
        bad = records(); bad[1]["seq"] = 9; cases.append(bad)
        bad = records(); bad[2]["data"]["usage"]["inputTokens"] = -1; cases.append(bad)
        bad = records(); bad[2]["data"]["usage"]["inputTokens"] = 20.5; cases.append(bad)
        bad = records(); bad[2]["data"]["usage"]["totalTokens"] = 116; cases.append(bad)
        bad = records(); bad[2]["type"] = "new-kind"; cases.append(bad)
        for case in cases:
            with self.subTest(case=cases.index(case)), self.assertRaises(ValueError):
                list(parse_usage(encode(case), ROOT))
        with self.assertRaises(ValueError):
            list(parse_usage(encode(records())[:-1], ROOT))
        for invalid in (ROOT + "/../x", "../../*", "session-*", ROOT.upper()):
            with self.assertRaises(ValueError):
                session_id(invalid)


@unittest.skipUnless(shutil.which("zstd"), "Local Harness mirror requires zstd")
class DeepSeekMirrorTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.mirror = UsageMirror(self.base / "usage", deepseek_sessions=self.base / "dsh")
        self.mirror.start_refresh = lambda *_: None

    def tearDown(self):
        self.temp.cleanup()

    def log(self, root=ROOT, rows=None, workspace="workspace"):
        path = self.base / "dsh" / workspace / root / "session.v4.jsonl.zstd"
        path.parent.mkdir(parents=True, exist_ok=True)
        # Real independent frames, as appended by Harness. A first-frame-only
        # decoder incorrectly returns a valid header and zero usage.
        path.write_bytes(b"".join(subprocess.run([shutil.which("zstd"), "-qc"],
            input=encode([r]), capture_output=True, check=True).stdout for r in (rows or records(root))))
        return path

    def summary(self, root=ROOT, **kwargs):
        return self.mirror.summary(CID, [agent(root)], **kwargs)

    def test_all_frames_refresh_dedup_daily_and_independent_session(self):
        self.log(); self.log(OLD)
        self.mirror.refresh(CID, [agent(), agent(OLD)])
        self.mirror.refresh(CID, [agent()])
        result = self.summary()
        self.assertEqual(result["rows"][0]["status"], "connected")
        self.assertEqual(result["rows"][0]["provider"], "deepseek")
        self.assertEqual(result["totals"], dict(requests=2, fresh=22, cached=80, written=5, output=13, total=120))
        self.assertEqual(result["daily"][0]["total"], 120)
        self.assertEqual(result["daily"][0]["date"], "2026-10-19")
        self.assertEqual(self.summary(OLD)["totals"]["total"], 120)
        self.assertEqual(self.summary(begin="2026-10-20T00:00:00Z")["totals"]["total"], 0)
        with patch("deepseek_usage.subprocess.run", side_effect=AssertionError("unchanged file decoded again")):
            self.mirror.refresh(CID, [agent()])
        self.assertEqual(self.summary()["rows"][0]["status"], "connected")

    def test_torn_frame_keeps_last_good_counts_and_recovers_then_appends(self):
        path = self.log()
        self.mirror.refresh(CID, [agent()])
        good = path.read_bytes()
        path.write_bytes(good[:-2])
        self.mirror.refresh(CID, [agent()])
        self.assertEqual(self.summary()["rows"][0]["status"], "unavailable")
        self.assertEqual(self.summary()["totals"]["total"], 120)
        rows = records(); added = copy.deepcopy(rows[2]); added["seq"] = 4; rows.append(added)
        self.log(rows=rows)
        self.mirror.refresh(CID, [agent()])
        self.assertEqual(self.summary()["rows"][0]["status"], "connected")
        self.assertEqual(self.summary()["totals"]["total"], 235)

    def test_missing_ambiguous_wrong_identity_and_conflicting_usage_are_not_zero(self):
        self.mirror.refresh(CID, [agent()])
        self.assertEqual(self.summary()["rows"][0]["status"], "unavailable")
        self.log(); self.mirror.refresh(CID, [agent()])
        bad = records(); bad[2]["data"]["usage"].update(inputTokens=30, totalTokens=125)
        self.log(rows=bad); self.mirror.refresh(CID, [agent()])
        self.assertEqual(self.summary()["rows"][0]["status"], "unavailable")
        self.assertEqual(self.summary()["totals"]["total"], 120)
        self.log(rows=records(OLD)); self.mirror.refresh(CID, [agent()])
        self.assertEqual(self.summary()["rows"][0]["status"], "unavailable")
        self.log(); self.log(workspace="copy"); self.mirror.refresh(CID, [agent()])
        self.assertEqual(self.summary()["rows"][0]["status"], "unavailable")


if __name__ == "__main__":
    unittest.main()
