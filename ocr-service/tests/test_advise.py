"""advise.py: what is sent, citation checks and the answer handling, with a fake Claude client (no API calls).
Run from ocr-service: python -m unittest discover -s tests"""
import json
import sys
import types
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# A stand-in for the anthropic package, so the tests run without it (and never call the API)
fake_anthropic = types.ModuleType("anthropic")


class _APIStatusError(Exception):
    def __init__(self, status_code):
        super().__init__(f"status {status_code}")
        self.status_code = status_code


fake_anthropic.RateLimitError = type("RateLimitError", (Exception,), {})
fake_anthropic.APIConnectionError = type("APIConnectionError", (Exception,), {})
fake_anthropic.APIStatusError = _APIStatusError
sys.modules.setdefault("anthropic", fake_anthropic)

import advise  # noqa: E402
from extract import RetryLater  # noqa: E402

PASSAGE = lambda key, text="Synthetic policy text. " * 80: {  # noqa: E731
    "chunk_key": key, "document": "Synthetic manual", "heading_path": f"Housing > {key}", "manual_pages": [3],
    "revision_date": "2026-01-15", "status": "approved", "excerpt": text}
RESULT = {
    "overall": "REVIEW",
    "criteria": [
        {"code": "DBR", "label": "DBR cap", "status": "pass", "field": "dbr", "value": 0.3, "threshold": "<= 0.35", "reason": None, "source": None},
        {"code": "AGE", "label": "Age at maturity", "status": "needs_review", "field": "age_at_maturity", "value": 66,
         "threshold": "<= 65", "reason": "Turns 66", "source": PASSAGE("age-1")},
    ],
    "manual_checks": [{"label": "Title", "prompt": "Verify the title", "source": PASSAGE("title-1")}],
    "suggested_exceptions": [{"policy": "Age (<= 65)", "citations": [PASSAGE("exc-1"), PASSAGE("age-1")]}],
    "reasoning": {"approval_path": {"passages": [PASSAGE("auth-1")]}},
    "policy_context": [PASSAGE("ctx-1"), {"chunk_key": "empty"}],
}
INPUT = {
    "schema": 1,
    "loan": {"amount": 4850000, "term_years": 20, "lcr": 0.81},
    "borrowers": [{"role": "Principal", "employment_type": "LOCALLY_EMPLOYED", "gross_income": 90500}],
    "totals": {"dbr": 0.29, "existing_monthly_amortization": 18500},
    "credit_score": {"criteria": [{"criterion": "DBR", "band": "Below 26%", "points": 8}], "condition_subtotal": 19, "total": 89},
    "ci": {"borrowers": [{"role": "Principal", "nfis": "NO_ADVERSE_FINDINGS", "tu": "NO_ADVERSE_FINDINGS"}], "findings_flagged": False},
    "exceptions": [],
}


class FakeStream:
    def __init__(self, message):
        self.message = message

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def get_final_message(self):
        return self.message


def message(answer, stop="end_turn"):
    return types.SimpleNamespace(
        content=[types.SimpleNamespace(type="text", text=json.dumps(answer))], stop_reason=stop, stop_details=None,
        model="claude-opus-5-5", usage=types.SimpleNamespace(input_tokens=5000, cache_creation_input_tokens=0,
                                                              cache_read_input_tokens=0, output_tokens=1800))


class FakeClient:
    def __init__(self, reply=None, error=None):
        self.requests, self.reply, self.error = [], reply, error
        self.beta = types.SimpleNamespace(messages=types.SimpleNamespace(stream=self.stream))

    def stream(self, **request):
        self.requests.append(request)
        if self.error:
            raise self.error
        return FakeStream(self.reply)


class AdviseTests(unittest.TestCase):
    def use(self, client):
        old = advise._get_client
        advise._get_client = lambda key: client
        self.addCleanup(lambda: setattr(advise, "_get_client", old))

    def test_passages_deduplicated_short_and_capped(self):
        p = advise.policy_passages(RESULT)
        self.assertEqual([x["chunk_key"] for x in p], ["age-1", "title-1", "exc-1", "auth-1", "ctx-1"])
        self.assertTrue(all(len(x["excerpt"]) <= advise.EXCERPT_CHARS + 4 for x in p), "short excerpts only")
        many = {"policy_context": [PASSAGE(f"k{i}") for i in range(20)]}
        self.assertEqual(len(advise.policy_passages(many)), advise.MAX_PASSAGES)

    def test_personal_fields_refused(self):
        for bad in ({"borrowers": [{"role": "Principal", "first_name": "X"}]}, {"loan": {"property_address": "X"}},
                    {"totals": {"gender": "M"}}, {"x": [{"email_address": "a@b"}]}, {"credit_score": {"civil_status": "S"}}):
            with self.assertRaises(ValueError):
                advise.build_request({**INPUT, **bad}, RESULT)
        self.assertEqual(advise.personal_keys(INPUT), [], "existing_monthly_amortization, risk_rating etc. are fine")

    def test_no_passages_refused(self):
        with self.assertRaises(ValueError):
            advise.build_request(INPUT, {"overall": "PASS", "criteria": []})

    def test_sent_is_input_plus_policy_summary_and_excerpts(self):
        sent, passages = advise.build_request(INPUT, RESULT)
        self.assertEqual(sent["input"], advise.with_pesos(INPUT))
        self.assertEqual(sent["policy_check"]["overall"], "REVIEW")
        self.assertEqual(sent["policy_check"]["criteria"][1]["chunk_key"], "age-1")
        self.assertNotIn("excerpt", json.dumps(sent["policy_check"]), "passage texts only under passages")
        self.assertEqual(len(sent["passages"]), len(passages))

    def test_peso_amounts_are_sent_with_cents(self):
        result = {**RESULT, "criteria": RESULT["criteria"] + [
            {"code": "INC", "label": "Minimum income", "status": "pass", "field": "total_gross_income", "value": 42300,
             "threshold": ">= 40000", "reason": None, "source": None}]}
        sent, _ = advise.build_request(INPUT, result)
        self.assertEqual(sent["input"]["loan"]["amount"], "₱4,850,000.00")
        self.assertEqual(sent["input"]["borrowers"][0]["gross_income"], "₱90,500.00")
        self.assertEqual(sent["input"]["totals"]["existing_monthly_amortization"], "₱18,500.00")
        self.assertEqual(sent["input"]["loan"]["lcr"], 0.81, "ratios stay ratios")
        self.assertEqual(sent["input"]["loan"]["term_years"], 20, "years stay numbers")
        self.assertEqual(sent["input"]["credit_score"]["total"], 89, "scores aren't money")
        self.assertEqual(INPUT["loan"]["amount"], 4850000, "the stored input keeps numbers")
        inc = sent["policy_check"]["criteria"][-1]
        self.assertEqual((inc["value"], inc["threshold"]), ("₱42,300.00", ">= ₱40,000.00"))
        dbr = sent["policy_check"]["criteria"][0]
        self.assertEqual((dbr["value"], dbr["threshold"]), (0.3, "<= 0.35"), "non-money facts as stored")
        self.assertRegex(json.dumps(sent, ensure_ascii=False), r"₱\d{1,3}(,\d{3})*\.\d\d")
        self.assertNotRegex(json.dumps(sent["input"], ensure_ascii=False), r"₱[\d,]+(?!\.\d\d)[^\d.,]")

    def test_model_is_told_to_write_cents(self):
        self.assertIn("₱2,500,000.00", advise.SYSTEM)
        self.assertIn("exactly two decimals", advise.SYSTEM)

    def test_model_is_told_what_inconclusive_means(self):
        self.assertIn("INCONCLUSIVE", advise.SYSTEM)
        self.assertIn("not as a finding against the borrower", advise.SYSTEM)

    def test_peso_amounts_in_the_answer_get_cents(self):
        cases = {
            "Loan of ₱2,500,000 approved": "Loan of ₱2,500,000.00 approved",
            "income ₱42300 and fee ₱1,234.5": "income ₱42,300.00 and fee ₱1,234.50",
            "₱ 900": "₱900.00",
            "already ₱2,500,000.00": "already ₱2,500,000.00",
            "list ₱1,000, ₱2,000.": "list ₱1,000.00, ₱2,000.00.",
            "DBR 35% and 20 years": "DBR 35% and 20 years",
        }
        for given, expected in cases.items():
            self.assertEqual(advise.cents_in_text(given), expected)
        self.use(FakeClient(message({
            "suggested_result": "ENDORSED", "reasons": [{"text": "Income of ₱42,300 meets the ₱40,000 minimum.", "chunk_key": "age-1"}],
            "draft_justification": "Loan of ₱4,850,000 with amortization ₱38,333.2.", "missing_data": ["Payslip showing ₱90,500"]})))
        out = advise.suggest(INPUT, RESULT, "key", "claude-opus-5-5")["output"]
        self.assertEqual(out["reasons"][0]["text"], "Income of ₱42,300.00 meets the ₱40,000.00 minimum.")
        self.assertEqual(out["draft_justification"], "Loan of ₱4,850,000.00 with amortization ₱38,333.20.")
        self.assertEqual(out["missing_data"], ["Payslip showing ₱90,500.00"])

    def test_suggest_keeps_only_cited_reasons(self):
        client = FakeClient(message({
            "suggested_result": "ENDORSED",
            "reasons": [{"text": "Age needs a mitigant.", "chunk_key": "age-1"},
                        {"text": "Made-up rule.", "chunk_key": "not-sent"},
                        {"text": "Authority is the President.", "chunk_key": "auth-1"}],
            "draft_justification": "  Within policy.  ", "missing_data": ["Latest payslip", " "]}))
        self.use(client)
        out = advise.suggest(INPUT, RESULT, "key", "claude-opus-5-5")
        self.assertEqual(out["output"]["suggested_result"], "ENDORSED")
        self.assertEqual([r["chunk_key"] for r in out["output"]["reasons"]], ["age-1", "auth-1"])
        self.assertEqual(out["output"]["reasons"][0]["heading"], "Housing > age-1")
        self.assertIn("1 reason(s) left out", out["output"]["notes"][0])
        self.assertEqual(out["output"]["draft_justification"], "Within policy.")
        self.assertEqual(out["output"]["missing_data"], ["Latest payslip"])
        self.assertEqual((out["input_tokens"], out["output_tokens"]), (5000, 1800))
        req = client.requests[0]
        self.assertEqual(req["output_config"]["format"]["schema"], advise.SCHEMA)
        self.assertEqual(req["output_config"]["effort"], "medium")
        self.assertEqual(req["fallbacks"], "default")
        self.assertEqual(json.loads(req["messages"][0]["content"]), out["sent"], "what is saved is what was sent")

    def test_no_cited_reason_is_noted(self):
        self.use(FakeClient(message({"suggested_result": "DEFERRED", "reasons": [{"text": "x", "chunk_key": "?"}],
                                     "draft_justification": "", "missing_data": []})))
        out = advise.suggest(INPUT, RESULT, "key", "claude-opus-5-5")
        self.assertEqual(out["output"]["reasons"], [])
        self.assertTrue(any("extra care" in n for n in out["output"]["notes"]))

    def test_refusal_cutoff_and_bad_answer_fail(self):
        for msg in (message({}, stop="refusal"), message({}, stop="max_tokens"),
                    message({"suggested_result": "APPROVED", "reasons": [], "draft_justification": "", "missing_data": []})):
            self.use(FakeClient(msg))
            with self.assertRaises(RuntimeError):
                advise.suggest(INPUT, RESULT, "key", "claude-opus-5-5")

    def test_busy_api_is_retry_later(self):
        for err in (fake_anthropic.RateLimitError("429"), fake_anthropic.APIConnectionError("down"), _APIStatusError(529)):
            self.use(FakeClient(error=err))
            with self.assertRaises(RetryLater):
                advise.suggest(INPUT, RESULT, "key", "claude-opus-5-5")
        self.use(FakeClient(error=_APIStatusError(400)))
        with self.assertRaises(_APIStatusError):
            advise.suggest(INPUT, RESULT, "key", "claude-opus-5-5")


if __name__ == "__main__":
    unittest.main()
