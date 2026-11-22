"""Run:  python -m unittest discover -s tests -v    (from ocr-service; no database, no network, no API key)

The notes under "Check on the document": every note the model returns is {text, severity}, severity MAJOR or
MINOR (prompt and JSON schema), and older plain-text notes still load.
"""

import json
import os
import sys
import unittest
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import extract  # noqa: E402

PAYSLIP_DEFS = [
    {"field_key": "employee_name", "label": "Employee name", "scope": "HEADER", "data_type": "TEXT", "sort_order": 1},
    {"field_key": "period_end", "label": "Period end", "scope": "ROW", "data_type": "DATE", "sort_order": 2},
    {"field_key": "gross_pay", "label": "Gross pay", "scope": "ROW", "data_type": "AMOUNT", "sort_order": 3},
]
TU_DEFS = [{"field_key": "score", "label": "Score", "scope": "HEADER", "data_type": "NUMBER", "sort_order": 1}]
LINES = [{"id": 501, "page_no": 1, "line_no": 1, "text": "JUAN DELA CRUZ", "bbox": [[10, 20], [90, 20], [90, 30], [10, 30]]}]


class SchemaTests(unittest.TestCase):
    def test_every_issue_is_text_and_severity(self):
        for doc_type, defs in [("PAYSLIPS_REMITTANCES", PAYSLIP_DEFS), ("VALID_ID_PASSPORT", PAYSLIP_DEFS[:1]), ("CI_TU", TU_DEFS)]:
            item = extract.build_schema(doc_type, defs)["properties"]["issues"]["items"]
            self.assertEqual(item["type"], "object", doc_type)
            self.assertEqual(item["required"], ["text", "severity"], doc_type)
            self.assertEqual(item["properties"]["severity"]["enum"], ["MAJOR", "MINOR"], doc_type)
            self.assertFalse(item["additionalProperties"], doc_type)

    def test_issues_still_required(self):
        self.assertIn("issues", extract.build_schema("COE_ITR", PAYSLIP_DEFS[:1])["required"])

    def test_prompt_explains_both_severities(self):
        self.assertIn("MAJOR:", extract.SYSTEM)
        self.assertIn("MINOR:", extract.SYSTEM)
        self.assertIn("When unsure, use MAJOR", extract.SYSTEM)


class NormalizeTests(unittest.TestCase):
    def test_objects_kept(self):
        got = extract.normalize_issues([{"text": " Expired ID ", "severity": "MAJOR"}, {"text": "Typo in employer", "severity": "MINOR"}])
        self.assertEqual(got, [{"text": "Expired ID", "severity": "MAJOR"}, {"text": "Typo in employer", "severity": "MINOR"}])

    def test_lowercase_severity(self):
        self.assertEqual(extract.normalize_issues([{"text": "x", "severity": "minor"}]), [{"text": "x", "severity": "MINOR"}])

    def test_plain_strings_still_work(self):
        # runs saved before severities existed hold plain strings: kept, no severity (the page shows no tag)
        self.assertEqual(extract.normalize_issues(["Payslip for October is missing"]),
                         [{"text": "Payslip for October is missing", "severity": None}])

    def test_unknown_severity_and_blanks(self):
        got = extract.normalize_issues([{"text": "x", "severity": "HIGH"}, {"text": "  ", "severity": "MAJOR"}, "", None, 5])
        self.assertEqual(got, [{"text": "x", "severity": None}])

    def test_none(self):
        self.assertEqual(extract.normalize_issues(None), [])


class FakeStream:
    def __init__(self, message):
        self.message = message

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def get_final_message(self):
        return self.message


class FakeClient:
    def __init__(self, answer):
        self.requests = []
        message = SimpleNamespace(
            content=[SimpleNamespace(type="text", text=json.dumps(answer))], stop_reason="end_turn", stop_details=None,
            model="claude-opus-5-5",
            usage=SimpleNamespace(input_tokens=10, output_tokens=5, cache_creation_input_tokens=0, cache_read_input_tokens=0))

        def stream(**request):
            self.requests.append(request)
            return FakeStream(message)
        self.beta = SimpleNamespace(messages=SimpleNamespace(stream=stream))


class ExtractTests(unittest.TestCase):
    def tearDown(self):
        extract._client = None

    def run_with(self, answer):
        fake = FakeClient(answer)
        extract._client = fake
        return extract.extract("PAYSLIPS_REMITTANCES", PAYSLIP_DEFS, LINES, "test-key"), fake

    def test_saved_output_has_severities(self):
        answer = {"document_kind": "PAYSLIP", "fields": [{"key": "employee_name", "value": "Juan Dela Cruz", "lines": ["L1"]}],
                  "rows": [], "issues": [{"text": "Payslip for October is missing", "severity": "MAJOR"},
                                         {"text": "Employer name abbreviated", "severity": "MINOR"}]}
        result, fake = self.run_with(answer)
        self.assertEqual(result["output"]["issues"], [{"text": "Payslip for October is missing", "severity": "MAJOR"},
                                                      {"text": "Employer name abbreviated", "severity": "MINOR"}])
        schema = fake.requests[0]["output_config"]["format"]["schema"]
        self.assertEqual(schema["properties"]["issues"]["items"]["required"], ["text", "severity"])
        self.assertEqual(result["fields"][0]["line_ids"], [501])

    def test_same_for_every_borrower(self):
        # the prompt holds the document and its OCR text only: nothing about whose document it is
        _, fake = self.run_with({"document_kind": "PAYSLIP", "fields": [], "rows": [], "issues": []})
        prompt = fake.requests[0]["messages"][0]["content"]
        for word in ("PRINCIPAL", "SPOUSE", "CO_BORROWER", "Co-borrower"):
            self.assertNotIn(word, prompt)


if __name__ == "__main__":
    unittest.main()
