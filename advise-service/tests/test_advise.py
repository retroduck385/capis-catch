"""advise.py: what is sent (findings + CO reviews), citation and figure checks, and the answer handling, with a fake
Claude client (no API calls). Run from advise-service: python -m unittest discover -s tests"""
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
import claude  # noqa: E402
from claude import RetryLater  # noqa: E402

LONG = "Synthetic policy text. " * 80


def finding(key, group, **extra):
    return {"chunk_key": key, "document": "Synthetic manual", "heading_path": f"Housing > {key}", "manual_pages": [3],
            "revision_date": "2026-01-15", "status": "met" if group == "met" else "not_met", "action": group,
            "finding": f"Finding for {key}.", "requirement": f"Requirement {key}", "quote": "Synthetic policy text.",
            "suggested_action": f"Do {key}", "exception": None, "rule_codes": [], "notes": [], "excerpt": LONG, **extra}


RESULT = {
    "overall": "REVIEW",
    "criteria": [
        {"code": "DBR", "label": "DBR cap", "status": "pass", "field": "dbr", "value": 0.29, "threshold": "<= 0.35",
         "reason": None, "source": {"chunk_key": "dbr-1", "heading_path": "Housing > DBR", "excerpt": "DBR up to 35%."}},
        {"code": "INC", "label": "Minimum income", "status": "pass", "field": "total_gross_income", "value": 90500,
         "threshold": ">= 40000", "reason": None, "source": {"chunk_key": "age-1", "excerpt": "x"}},
        {"code": "OFW", "label": "OFW rule", "status": "not_applicable", "field": "x", "value": None, "threshold": None,
         "source": {"chunk_key": "ofw-1", "excerpt": "OFW text"}},
    ],
    "recommendations": {
        "status": "DONE",
        "groups": {
            "exception": [finding("age-1", "exception", exception={"policy": "Age <= 65", "recommendation": "Allow 66",
                                                                   "mitigant": ""})],
            "obtain": [finding("payslip-1", "obtain"), finding("spa-1", "obtain")],
            "condition": [finding("ins-1", "condition")],
            "met": [finding(f"met-{i}", "met") for i in range(20)],
        },
        "not_applicable": [{"chunk_key": "na-1"}],
        "unverified": [finding("bad-1", "obtain", problems=["quote not in clause"])],
        "approval": {"with_exception": True, "reasons": ["Requirement age-1"]},
    },
}
REVIEWS = {
    "age-1": {"chunk_key": "age-1", "decision": "EDITED",
              "edited": {"policy": "Age at maturity <= 65", "recommendation": "Allow 66", "mitigant": "Co-borrower aged 30"}},
    "spa-1": {"chunk_key": "spa-1", "decision": "DISMISSED", "edited": None},
    "ins-1": {"chunk_key": "ins-1", "decision": "ACCEPTED", "edited": None},
}
INPUT = {
    "schema": 1,
    "loan": {"amount": 4850000, "term_years": 20, "lcr": 0.81},
    "borrowers": [{"role": "Principal", "employment_type": "LOCALLY_EMPLOYED", "gross_income": 90500}],
    "totals": {"dbr": 0.29, "existing_monthly_amortization": 18500},
    "credit_score": {"criteria": [{"criterion": "DBR", "band": "Below 26%", "points": 8}], "condition_subtotal": 19, "total": 89},
    "ci": {"borrowers": [{"role": "Principal", "nfis": "NO_ADVERSE_FINDINGS", "tu": "NO_ADVERSE_FINDINGS"}],
           "findings_flagged": False, "file_checks": {"undisclosed_tu_accounts": 0}},
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


def answer(reasons, draft="Within policy.", result="ENDORSED", missing=()):
    return {"suggested_result": result, "reasons": reasons, "draft_justification": draft, "missing_data": list(missing)}


class BuildRequestTests(unittest.TestCase):
    def test_findings_with_reviews_applied(self):
        sent = advise.build_request(INPUT, RESULT, REVIEWS)
        by_key = {f["chunk_key"]: f for f in sent["findings"]}
        self.assertEqual(by_key["age-1"]["review"], "EDITED")
        self.assertEqual(by_key["age-1"]["exception"]["mitigant"], "Co-borrower aged 30", "the CO's edit wins")
        self.assertEqual(by_key["age-1"]["requirement"], "Age at maturity <= 65")
        self.assertEqual(by_key["ins-1"]["review"], "ACCEPTED")
        self.assertEqual(by_key["payslip-1"]["review"], "NOT_REVIEWED")
        self.assertNotIn("review", by_key["met-0"], "met findings aren't reviewed")
        self.assertNotIn("spa-1", by_key, "dismissed findings are left out")
        self.assertEqual(sent["dismissed"], [{"chunk_key": "spa-1", "requirement": "Requirement spa-1"}])
        self.assertNotIn("bad-1", by_key, "held-back findings are never sent")
        self.assertNotIn("na-1", by_key)
        self.assertEqual(sum(f["group"] == "met" for f in sent["findings"]), advise.MAX_MET)
        self.assertTrue(all(len(f["excerpt"]) <= advise.EXCERPT_CHARS + 4 for f in sent["findings"]))

    def test_condition_edit_replaces_the_next_step(self):
        reviews = {"ins-1": {"decision": "EDITED", "edited": {"text": "Fire insurance, bank as payee"}}}
        sent = advise.build_request(INPUT, RESULT, reviews)
        ins = next(f for f in sent["findings"] if f["chunk_key"] == "ins-1")
        self.assertEqual(ins["suggested_action"], "Fire insurance, bank as payee")

    def test_rule_clauses_added_when_not_a_finding(self):
        sent = advise.build_request(INPUT, RESULT, {})
        rules = [f for f in sent["findings"] if f["group"] == "rule"]
        self.assertEqual([f["chunk_key"] for f in rules], ["dbr-1"], "age-1 is a finding already; ofw-1 is n/a")
        self.assertEqual([r["code"] for r in sent["rules"]], ["DBR", "INC"])
        inc = sent["rules"][1]
        self.assertEqual((inc["value"], inc["requirement"]), ("₱90,500.00", ">= ₱40,000.00"))

    def test_no_reviews_means_all_unreviewed(self):
        sent = advise.build_request(INPUT, RESULT, None)
        self.assertEqual([f["review"] for f in sent["findings"] if f["group"] in advise.TO_REVIEW],
                         ["NOT_REVIEWED"] * 4)
        self.assertEqual(sent["dismissed"], [])

    def test_recommender_missing_is_refused(self):
        for recs in (None, {"status": "UNAVAILABLE", "reason": "no API key"}):
            with self.assertRaisesRegex(ValueError, "Run the policy check again"):
                advise.build_request(INPUT, {**RESULT, "recommendations": recs})

    def test_personal_fields_refused(self):
        for bad in ({"borrowers": [{"role": "Principal", "first_name": "X"}]}, {"loan": {"property_address": "X"}},
                    {"totals": {"gender": "M"}}, {"x": [{"email_address": "a@b"}]}, {"credit_score": {"civil_status": "S"}}):
            with self.assertRaises(ValueError):
                advise.build_request({**INPUT, **bad}, RESULT)
        self.assertEqual(advise.personal_keys(INPUT), [])

    def test_peso_amounts_are_sent_with_cents(self):
        sent = advise.build_request(INPUT, RESULT)
        self.assertEqual(sent["input"]["loan"]["amount"], "₱4,850,000.00")
        self.assertEqual(sent["input"]["totals"]["existing_monthly_amortization"], "₱18,500.00")
        self.assertEqual(sent["input"]["loan"]["lcr"], 0.81, "ratios stay ratios")
        self.assertEqual(INPUT["loan"]["amount"], 4850000, "the stored input keeps numbers")
        self.assertIn("₱2,500,000.00", advise.SYSTEM)

    def test_model_is_told_what_inconclusive_means(self):
        self.assertIn("INCONCLUSIVE", advise.SYSTEM)
        self.assertIn("not as a finding against the borrower", advise.SYSTEM)


class FigureTests(unittest.TestCase):
    def test_figures_in_text(self):
        self.assertEqual([(v, k) for v, k, _ in advise.figures_in("₱4,850,000.00 at 29% and ₱3M, 20 years")],
                         [(4850000.0, "money"), (29.0, "percent"), (3000000.0, "money")])

    def test_stray_figures(self):
        known = advise.known_numbers(advise.build_request(INPUT, RESULT))
        self.assertEqual(advise.stray_figures("DBR 29% and LCR 81%, loan ₱4,850,000.00, cap 35%", known), [])
        self.assertEqual(advise.stray_figures("income ₱120,000.00 and DBR 41%", known), ["₱120,000.00", "41%"])

    def test_cents_in_text(self):
        cases = {"Loan of ₱2,500,000 approved": "Loan of ₱2,500,000.00 approved",
                 "income ₱42300 and fee ₱1,234.5": "income ₱42,300.00 and fee ₱1,234.50",
                 "already ₱2,500,000.00": "already ₱2,500,000.00", "DBR 35% and 20 years": "DBR 35% and 20 years"}
        for given, expected in cases.items():
            self.assertEqual(advise.cents_in_text(given), expected)


class SuggestTests(unittest.TestCase):
    def use(self, client):
        old = claude._get_client
        claude._get_client = lambda key: client
        self.addCleanup(lambda: setattr(claude, "_get_client", old))

    def run_with(self, reply, reviews=REVIEWS):
        client = FakeClient(message(reply))
        self.use(client)
        return advise.suggest(INPUT, RESULT, reviews, "key", "claude-opus-5-5"), client

    def test_keeps_only_cited_reasons_and_marks_review(self):
        out, client = self.run_with(answer([
            {"text": "Age at maturity needs an exception; a co-borrower mitigates it.", "chunk_key": "age-1"},
            {"text": "Made-up rule.", "chunk_key": "not-sent"},
            {"text": "Dismissed one.", "chunk_key": "spa-1"},
            {"text": "Payslips still to get.", "chunk_key": "payslip-1"},
            {"text": "DBR of 29% is within the 35% cap.", "chunk_key": "dbr-1"}], missing=["Latest payslip", " "]))
        o = out["output"]
        self.assertEqual([r["chunk_key"] for r in o["reasons"]], ["age-1", "payslip-1", "dbr-1"])
        self.assertEqual([r.get("review") for r in o["reasons"]], ["EDITED", "NOT_REVIEWED", None])
        self.assertEqual(o["reasons"][2]["group"], "rule")
        self.assertIn("2 reason(s) left out", o["notes"][0])
        self.assertTrue(any("not reviewed by you yet" in n for n in o["notes"]))
        self.assertEqual(o["counts"], {"findings": len(out["sent"]["findings"]), "unreviewed": 1, "dismissed": 1})
        self.assertEqual(o["missing_data"], ["Latest payslip"])
        self.assertEqual((out["input_tokens"], out["output_tokens"]), (5000, 1800))
        req = client.requests[0]
        self.assertEqual(req["output_config"]["format"]["schema"], advise.SCHEMA)
        self.assertEqual(req["fallbacks"], "default")
        self.assertEqual(json.loads(req["messages"][0]["content"]), out["sent"], "what is saved is what was sent")

    def test_all_reviewed_has_no_unreviewed_note(self):
        reviews = {**REVIEWS, "payslip-1": {"decision": "ACCEPTED"}}
        out, _ = self.run_with(answer([{"text": "Ok.", "chunk_key": "ins-1"}]), reviews)
        self.assertFalse(any("not reviewed" in n for n in out["output"]["notes"]))

    def test_unknown_figures_are_flagged_not_dropped(self):
        out, _ = self.run_with(answer([{"text": "Income of ₱120,000 is enough.", "chunk_key": "ins-1"}],
                                      draft="Loan of ₱4,850,000 with DBR 29% and savings of ₱500,000."))
        o = out["output"]
        self.assertEqual(o["reasons"][0]["unverified_figures"], ["₱120,000.00"])
        self.assertEqual(o["draft_justification"], "Loan of ₱4,850,000.00 with DBR 29% and savings of ₱500,000.00.")
        self.assertEqual(o["draft_unverified_figures"], ["₱500,000.00"])
        self.assertTrue(any("₱500,000.00" in n for n in o["notes"]))

    def test_no_cited_reason_is_noted(self):
        out, _ = self.run_with(answer([{"text": "x", "chunk_key": "?"}], result="DEFERRED"))
        self.assertEqual(out["output"]["reasons"], [])
        self.assertTrue(any("extra care" in n for n in out["output"]["notes"]))

    def test_refusal_cutoff_and_bad_answer_fail(self):
        for msg in (message({}, stop="refusal"), message({}, stop="max_tokens"), message(answer([], result="APPROVED"))):
            self.use(FakeClient(msg))
            with self.assertRaises(RuntimeError):
                advise.suggest(INPUT, RESULT, REVIEWS, "key", "claude-opus-5-5")

    def test_busy_api_is_retry_later(self):
        for err in (fake_anthropic.RateLimitError("429"), fake_anthropic.APIConnectionError("down"), _APIStatusError(529)):
            self.use(FakeClient(error=err))
            with self.assertRaises(RetryLater):
                advise.suggest(INPUT, RESULT, REVIEWS, "key", "claude-opus-5-5")
        self.use(FakeClient(error=_APIStatusError(400)))
        with self.assertRaises(_APIStatusError):
            advise.suggest(INPUT, RESULT, REVIEWS, "key", "claude-opus-5-5")


if __name__ == "__main__":
    unittest.main()
