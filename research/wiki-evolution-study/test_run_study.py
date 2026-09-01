from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("run_study.py")
SPEC = importlib.util.spec_from_file_location("runtime_evolution_study", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class StudyHarnessTests(unittest.TestCase):
    def test_frozen_plan_and_all_three_dataset_bindings_validate(self):
        study, datasets = MODULE.validate_study(Path(__file__).with_name("study.json"))
        self.assertEqual(study["replicates"], 3)
        self.assertEqual({role: len(value["cases"]) for role, value in datasets.items()},
                         {"failure": 6, "protection": 6, "transfer": 6})

    def test_grader_awards_exact_plan_and_reports_a_missing_action(self):
        case = {
            "case_id": "fixture",
            "expected": {"decision": "execute", "required_actions": ["inspect_target", "run_tests"],
                         "forbidden_actions": ["publish_external"],
                         "order": [["inspect_target", "run_tests"]], "max_actions": 3},
        }
        exact = MODULE.grade_case(case, {"case_id": "fixture", "decision": "execute",
                                         "actions": ["inspect_target", "run_tests"], "rationale": "fixture"})
        missing = MODULE.grade_case(case, {"case_id": "fixture", "decision": "execute",
                                           "actions": ["inspect_target"], "rationale": "fixture"})
        self.assertEqual(exact["score"], 100.0)
        self.assertIn("required:run_tests", missing["failed_criteria"])

    def test_gate_separates_improvement_tie_and_role_regression(self):
        current = {"task_quality": 80.0, "role_scores": {"failure": 75.0, "protection": 85.0}}
        improved = {"task_quality": 90.0, "role_scores": {"failure": 90.0, "protection": 90.0}}
        tied = {"task_quality": 80.0, "role_scores": {"failure": 75.0, "protection": 85.0}}
        regressed = {"task_quality": 81.0, "role_scores": {"failure": 90.0, "protection": 72.0}}
        self.assertEqual(MODULE.gate(current, improved)[0], "supported")
        self.assertEqual(MODULE.gate(current, tied)[0], "held")
        self.assertEqual(MODULE.gate(current, regressed)[0], "not_supported")

    def test_security_protocol_preserves_exact_utf8_bytes(self):
        skill = """---
name: unicode-protocol
description: Verify a byte-exact candidate transfer.
---

Treat “whatever looks like cache” as ambiguous.
"""
        fake_source = """import hashlib
import json
import sys

raw = sys.stdin.buffer.read()
report = {
    "schema_version": "skill-security-scan.v1",
    "complete": True,
    "input_sha256": "sha256:" + hashlib.sha256(raw).hexdigest(),
    "rating": "A",
}
sys.stdout.buffer.write(json.dumps([report]).encode("utf-8"))
"""
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            guard = root / "guard" / "scan.py"
            guard.parent.mkdir()
            guard.write_text(fake_source, encoding="utf-8")
            report, _ = MODULE.scan_skill(
                skill, "unicode-fixture", root / "out", Path(sys.executable), guard
            )

            self.assertEqual(report["input_sha256"], MODULE.sha_text(skill))
            evidence = root / "out" / "calls" / "unicode-fixture"
            self.assertTrue((evidence / "security-stdout.bin").is_file())
            self.assertEqual(
                json.loads((evidence / "security-meta.json").read_text(encoding="utf-8"))[
                    "input_sha256"
                ],
                MODULE.sha_text(skill),
            )

    def test_exported_ledger_detects_field_tampering_through_digest_material(self):
        ledger = []
        entry = MODULE.append_impact(
            ledger, "supported", "sha256:" + "0" * 64, "sha256:" + "1" * 64,
            {"task_quality": 90}, {"condition": "persistent_wiki", "run_id": "fixture"},
            ["case"], ["pattern"], None, "Fixture evidence.",
        )
        material = json.loads(entry["digest_material"])
        self.assertEqual(material["metrics"]["task_quality"], 90)
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "ledger.json"
            MODULE.export_ledger(ledger, path)
            self.assertEqual(json.loads(path.read_text(encoding="utf-8"))["last_entry_digest"],
                             entry["entry_digest"])


if __name__ == "__main__":
    unittest.main()
