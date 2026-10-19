import copy
import json
from pathlib import Path
import tempfile
import unittest

from task_usage import aggregate, task_summary

CID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"


def sample():
    return dict(version=1, companyId=CID, generatedAt="2026-10-19T12:00:00Z", scope="reviewed samples",
        tasks=[dict(id=t, name=t, executor="worker", outcome="accepted", complete=True, basis="receipt") for t in ["A", "B"]],
        events=[dict(provider="test", identity=str(i), occurred=f"2026-10-{day}T08:00:00Z",
                     taskId=task, phase=phase, relatedTaskIds=related, reason="shared review + dispatch",
                     model="test", fresh=20, cached=80, written=5, output=10)
                for i, (day, task, phase, related) in enumerate([
                    (18,"A","dispatch",[]),(19,"A","execution",[]),(19,"B","rework",[]),
                    (19,None,"mixed",["A","B"])])])


class TaskUsageTest(unittest.TestCase):
    def test_shared_never_distributed_or_double_counted(self):
        result=aggregate(sample(), CID)
        self.assertEqual(result["totals"]["total"], 460)
        self.assertEqual(result["shared"]["total"], 115)
        self.assertEqual(sum(r["totals"]["total"] for r in result["rows"]), 345)
        self.assertEqual([r["shared"]["total"] for r in result["rows"]], [115,115])
        self.assertEqual(result["rows"][1]["phases"]["rework"]["requests"], 1)

    def test_date_filter_clips_lifecycle_and_preserves_cache(self):
        result=aggregate(sample(), CID, "2026-10-19T00:00:00+00:00")
        self.assertTrue(result["rows"][0]["partialRange"])
        self.assertFalse(result["rows"][1]["partialRange"])
        self.assertEqual(result["totals"]["written"], 15)
        self.assertEqual(result["rows"][0]["phases"]["dispatch"]["requests"], 0)
        self.assertEqual(aggregate(sample(), CID, "2027")["rows"], [])

    def test_invalid_identity_counts_scope_and_attribution_rejected(self):
        bad=[]
        s=sample();s["events"].append(copy.deepcopy(s["events"][0]));bad.append(s)
        s=sample();s["companyId"]="other";bad.append(s)
        s=sample();s["events"][0]["fresh"]=-1;bad.append(s)
        s=sample();s["events"][0]["fresh"]=1.2;bad.append(s)
        s=sample();s["events"][0]["relatedTaskIds"]=["A"];bad.append(s)
        s=sample();s["events"][0]["taskId"]="unknown";bad.append(s)
        s=sample();s["events"][0]["occurred"]="2027-01-01T00:00:00Z";bad.append(s)
        for value in bad:
            with self.subTest(value=value), self.assertRaises(ValueError):aggregate(value,CID)

    def test_company_file_isolation_and_corruption_status(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(task_summary(directory,CID),{"status":"missing"})
            path=Path(directory)/(CID+".tasks.json")
            path.write_text(json.dumps(sample()))
            self.assertEqual(task_summary(directory,CID)["status"],"ready")
            self.assertEqual(task_summary(directory,"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")["status"],"missing")
            path.write_text("{bad")
            self.assertEqual(task_summary(directory,CID),{"status":"invalid"})


if __name__ == "__main__":
    unittest.main()
