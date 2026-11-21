"""Policy recommender, offline: synthetic clauses (not bank policy), a fake judge, the real verification and grouping."""
import unittest

from mrac.recommender import gather, judge_payload, numbers_in, quote_in, recommend, resolve, traits, verify
from mrac.retrieval import LocalRetriever
from mrac.rules_engine import evaluate, normalize

CHUNKS = [
    {"id": "RAAC-HL-01-AGE", "source_doc": "raac.ods", "heading_path": "RAAC > AGE",
     "text": "The borrower must be at least 21 years old and not more than 65 years old at loan maturity.", "tags": ["raac"]},
    {"id": "RAAC-HL-11-DBR", "source_doc": "raac.ods", "heading_path": "RAAC > DEBT BURDEN RATIO",
     "text": "The debt burden ratio shall not exceed 40% of the gross monthly income.", "tags": ["raac"]},
    {"id": "CCD-VII-0004", "source_doc": "ccd.pdf", "heading_path": "VII > B. Pre-approval documents",
     "text": "For married borrowers, a PSA marriage certificate is required. Loans above P3.0M require the latest ITR.",
     "products": ["housing_purchase"]},
    {"id": "CPM-IX-0094", "source_doc": "cpm.pdf", "heading_path": "IX > G. Insurance > MRI",
     "text": "The MRI shall be primarily on the principal borrower or mortgagor.", "products": ["housing_purchase"],
     "manual_pages": ["119"]},
    {"id": "CPM-IX-0200", "source_doc": "cpm.pdf", "heading_path": "IX > OFW",
     "text": "OFW borrowers shall submit proof of remittance for the last three months.", "products": ["housing_purchase"]},
    {"id": "AUTO-0001", "source_doc": "auto.pdf", "heading_path": "Auto loans",
     "text": "Auto loan borrowers need a driver's license.", "products": ["auto"]},
]
RETR = LocalRetriever(CHUNKS)
TRIGGERS = {
    "pin": {"label": "always", "prefixes": ["RAAC-HL-"], "keys": ["CCD-VII-0004"]},
    "max_candidates": 10, "top_k": 2,
    "triggers": [
        {"id": "mri", "when": "always", "label": "MRI", "queries": ["MRI principal borrower insurance"]},
        {"id": "ofw", "when": "employment:OFW", "label": "OFW", "queries": ["OFW remittance proof"]},
    ],
}
PROFILE = {
    "schema": 1,
    "loan": {"amount": 4_850_000, "term_years": 20, "from_developer": True, "referral_channel": "DEVELOPER",
             "property_type": "House and Lot", "lcr": 0.81},
    "borrowers": [
        {"role": "Principal", "civil_status": "MARRIED", "filipino_citizen": True, "lives_abroad": False,
         "employment_type": "LOCALLY_EMPLOYED", "tenure_years": 10, "gross_income": 86000, "existing_loans": []},
        {"role": "Co-borrower 2", "civil_status": "SINGLE", "filipino_citizen": True, "lives_abroad": True,
         "employment_type": "OFW", "tenure_years": 3, "gross_income": 44000, "existing_loans": []},
    ],
    "other_parties": {"mortgagor": False, "attorney_in_fact": True},
    "totals": {"dbr": 0.46, "total_gross_income": 130000},
    "ci": {"borrowers": [{"role": "Principal", "nfis": "NO_ADVERSE_FINDINGS", "tu": "WITH_FINDINGS", "bras": None}],
           "findings_flagged": False},
    "documents": {"borrowers": [{"role": "Principal", "required": [
        {"requirement": "COE_ITR", "files": 0, "cleared": 0, "needs_new_copy": 0}]}], "open_request_to_applicant": False},
    "exceptions": [],
}
FACTS = {"schema": 1, "loan_amount": 4_850_000, "dbr": 0.46, "age_at_maturity": 58}
DBR = normalize({"code": "RAAC-DBR", "label": "Debt burden ratio", "field": "dbr", "op": "<=", "threshold": 0.40,
                 "source_chunk_key": "RAAC-HL-11-DBR"})
PAIRS = [(DBR, evaluate(DBR, FACTS))]
RESULTS = [r for _, r in PAIRS]


def finding(key, status, action, quote, finding_text="", facts_used=(), exc=None, suggested=""):
    return {"chunk_key": key, "status": status, "action": action, "requirement": "r", "finding": finding_text,
            "quote": quote, "facts_used": list(facts_used), "suggested_action": suggested,
            "exception": exc or {"policy": "", "recommendation": "", "mitigant": ""}}


class FakeJudge:
    def __init__(self, findings, summary=""):
        self.findings, self.summary, self.payload = findings, summary, None

    def __call__(self, payload):
        self.payload = payload
        return {"model": "fake", "summary": self.summary, "findings": self.findings, "input_tokens": 1, "output_tokens": 1}


class TraitTests(unittest.TestCase):
    def test_traits_from_the_profile(self):
        t = traits(PROFILE, FACTS, RESULTS)
        for k in ("always", "loan_over_3m", "employment:OFW", "employment:LOCALLY_EMPLOYED", "lives_abroad", "married",
                  "attorney_in_fact", "from_developer", "ci_findings", "documents_incomplete", "rule_failed"):
            self.assertIn(k, t, k)
        self.assertNotIn("loan_over_10m", t)
        self.assertNotIn("non_filipino", t)
        self.assertIn("Co-borrower 2 is an OFW", t["employment:OFW"])
        self.assertIn("RAAC-DBR", t["rule_failed"])

    def test_no_profile_still_has_loan_traits_from_facts(self):
        self.assertIn("loan_over_3m", traits(None, FACTS, []))


class GatherTests(unittest.TestCase):
    def test_pinned_rule_clauses_and_trait_searches_never_other_products(self):
        cands = gather(RETR, TRIGGERS, traits(PROFILE, FACTS, RESULTS), PAIRS)
        keys = [c["chunk_key"] for c in cands]
        self.assertEqual(keys[:3], ["RAAC-HL-01-AGE", "RAAC-HL-11-DBR", "CCD-VII-0004"])     # pinned first
        self.assertIn("CPM-IX-0094", keys)                                                      # always: MRI
        self.assertIn("CPM-IX-0200", keys)                                                      # OFW trait
        self.assertNotIn("AUTO-0001", keys)                                                     # housing filter
        dbr = next(c for c in cands if c["chunk_key"] == "RAAC-HL-11-DBR")
        self.assertIn("Rule RAAC-DBR", dbr["brought_in_by"])
        ofw = next(c for c in cands if c["chunk_key"] == "CPM-IX-0200")
        self.assertTrue(any("Co-borrower 2 is an OFW" in w for w in ofw["brought_in_by"]))

    def test_payload_has_no_personal_keys_beyond_the_profile(self):
        cands = gather(RETR, TRIGGERS, traits(PROFILE, FACTS, RESULTS), PAIRS)
        p = judge_payload(PROFILE, FACTS, RESULTS, cands, traits(PROFILE, FACTS, RESULTS))
        self.assertEqual(set(p), {"application", "facts", "rule_results", "application_traits", "passages"})
        self.assertEqual(p["rule_results"][0]["clause"], "RAAC-HL-11-DBR")
        self.assertNotIn("schema", p["facts"])


class VerifyTests(unittest.TestCase):
    def setUp(self):
        self.cands = gather(RETR, TRIGGERS, traits(PROFILE, FACTS, RESULTS), PAIRS)

    def test_helpers(self):
        self.assertTrue(quote_in("shall not exceed 40% of the gross", "The debt burden ratio shall not exceed 40% of the gross monthly income."))
        self.assertTrue(quote_in("The debt burden ratio ... 40% of the gross", "The debt burden ratio shall not exceed 40% of the gross monthly income."))
        self.assertFalse(quote_in("shall not exceed 45%", "The debt burden ratio shall not exceed 40% of the gross monthly income."))
        self.assertEqual(resolve("borrowers[1].employment_type", PROFILE, FACTS), (True, "OFW"))
        self.assertEqual(resolve("facts.dbr", PROFILE, FACTS), (True, 0.46))
        self.assertEqual(resolve("dbr", PROFILE, FACTS), (True, 0.46))
        self.assertFalse(resolve("borrowers[5].role", PROFILE, FACTS)[0])
        self.assertTrue(resolve("rule_results", PROFILE, FACTS)[0])
        self.assertEqual(numbers_in("conflicts with CPM-VII-0035 and RAAC-HL-11-DEBT-BURDEN-RATIO"), [])
        self.assertEqual(numbers_in("P3.0M and ₱4,850,000 at 46% on 02.04.2025, age 65, 3 months, year 2026"),
                         [(3_000_000, "money"), (4_850_000, "money"), (46.0, "percent"), (65.0, "plain")])

    def test_good_findings_are_kept_and_grouped(self):
        raw = [
            finding("RAAC-HL-11-DBR", "not_met", "exception", "shall not exceed 40% of the gross monthly income",
                    "DBR is 46%, above the 40% limit.", ["facts.dbr"],
                    {"policy": "DBR at most 40%", "recommendation": "Allow DBR 46%", "mitigant": "Co-borrower income ₱44,000"}),
            finding("CCD-VII-0004", "needs_info", "obtain", "Loans above P3.0M require the latest ITR",
                    "The loan is ₱4,850,000, above P3.0M; no ITR file is on record.", ["loan.amount", "documents.borrowers[0].required"],
                    suggested="Ask the AO for the principal's latest ITR."),
            finding("CPM-IX-0094", "condition", "condition", "The MRI shall be primarily on the principal borrower",
                    "Set the MRI on the principal.", ["borrowers[0].role"]),
            finding("RAAC-HL-01-AGE", "met", "note", "not more than 65 years old at loan maturity",
                    "The principal is 58 at maturity.", ["facts.age_at_maturity"]),
            finding("CPM-IX-0200", "not_applicable", "none", "", ""),
        ]
        kept, unverified = verify(raw, self.cands, PROFILE, FACTS, RESULTS)
        self.assertEqual(unverified, [], unverified)
        self.assertEqual({f["chunk_key"]: (f["status"], f["action"]) for f in kept}["RAAC-HL-11-DBR"], ("not_met", "exception"))
        self.assertEqual(kept[0]["rule_codes"], ["RAAC-DBR"])

    def test_bad_findings_are_caught(self):
        raw = [
            finding("NOT-GIVEN", "met", "note", "x" * 10),
            finding("CPM-IX-0094", "condition", "condition", "The MRI shall cover every borrower equally", "MRI.", []),
            finding("CCD-VII-0004", "needs_info", "obtain", "Loans above P3.0M require the latest ITR",
                    "The loan is ₱5,900,000.", ["loan.amount"]),                       # a number that is nowhere
            finding("RAAC-HL-01-AGE", "met", "note", "not more than 65 years old at loan maturity",
                    "OK.", ["borrowers[0].date_of_birth"]),                             # a field that is not there
        ]
        kept, unverified = verify(raw, self.cands, PROFILE, FACTS, RESULTS)
        self.assertEqual(kept, [])
        problems = {u["chunk_key"]: " ".join(u["problems"]) for u in unverified}
        self.assertIn("not given", problems["NOT-GIVEN"])
        self.assertIn("quoted sentence", problems["CPM-IX-0094"])
        self.assertIn("₱5,900,000.00", problems["CCD-VII-0004"])
        self.assertIn("date_of_birth", problems["RAAC-HL-01-AGE"])

    def test_the_rules_win_over_the_judge(self):
        raw = [finding("RAAC-HL-11-DBR", "met", "note", "shall not exceed 40% of the gross monthly income",
                       "DBR is 46%.", ["facts.dbr"])]
        kept, _ = verify(raw, self.cands, PROFILE, FACTS, RESULTS)
        self.assertEqual((kept[0]["status"], kept[0]["action"]), ("not_met", "exception"))
        self.assertIn("Status set from rule RAAC-DBR", kept[0]["notes"][0])

    def test_duplicates_are_not_kept_twice(self):
        f = finding("CPM-IX-0094", "condition", "condition", "The MRI shall be primarily on the principal borrower", "MRI.")
        kept, unverified = verify([f, f], self.cands, PROFILE, FACTS, RESULTS)
        self.assertEqual(len(kept), 1)
        self.assertIn("twice", unverified[0]["problems"][0])


class RecommendTests(unittest.TestCase):
    def test_end_to_end_with_a_fake_judge(self):
        judge = FakeJudge([
            finding("RAAC-HL-11-DBR", "not_met", "exception", "shall not exceed 40% of the gross monthly income",
                    "DBR is 46%, above 40%.", ["facts.dbr"],
                    {"policy": "DBR at most 40%", "recommendation": "Allow 46%", "mitigant": ""}),
            finding("CCD-VII-0004", "needs_info", "obtain", "Loans above P3.0M require the latest ITR",
                    "No ITR on file.", ["documents.borrowers[0].required"]),
            finding("CPM-IX-0094", "condition", "condition", "The MRI shall be primarily on the principal borrower", "MRI."),
            finding("RAAC-HL-01-AGE", "met", "note", "not more than 65 years old at loan maturity", "58 at maturity.",
                    ["facts.age_at_maturity"]),
        ], summary="One exception (DBR 46%) and one document to obtain.")
        out = recommend(PROFILE, FACTS, PAIRS, RESULTS, RETR, judge, approval_clauses=[], triggers=TRIGGERS)
        self.assertEqual(out["status"], "DONE")
        self.assertEqual(out["counts"]["exception"], 1)
        self.assertEqual(out["counts"]["obtain"], 1)
        self.assertEqual(out["counts"]["condition"], 1)
        self.assertEqual(out["counts"]["met"], 1)
        self.assertTrue(out["approval"]["with_exception"])
        self.assertEqual(out["summary"], "One exception (DBR 46%) and one document to obtain.")
        self.assertEqual(out["groups"]["exception"][0]["exception"]["policy"], "DBR at most 40%")
        self.assertIn("passages", judge.payload)

    def test_a_summary_with_an_untraceable_figure_is_dropped(self):
        judge = FakeJudge([], summary="DBR is 52%.")
        out = recommend(PROFILE, FACTS, PAIRS, RESULTS, RETR, judge, approval_clauses=[], triggers=TRIGGERS)
        self.assertEqual(out["summary"], "")
        self.assertIn("52", out["summary_dropped"]["problem"])

    def test_no_judge_or_a_failing_judge_never_breaks_the_check(self):
        off = recommend(PROFILE, FACTS, PAIRS, RESULTS, RETR, None, approval_clauses=[], triggers=TRIGGERS)
        self.assertEqual(off["status"], "UNAVAILABLE")
        self.assertIn("ANTHROPIC_API_KEY", off["reason"])

        def boom(_):
            raise RuntimeError("Claude API busy")
        failed = recommend(PROFILE, FACTS, PAIRS, RESULTS, RETR, boom, approval_clauses=[], triggers=TRIGGERS)
        self.assertEqual(failed["status"], "UNAVAILABLE")
        self.assertIn("busy", failed["reason"])
        self.assertGreater(failed["checked"], 0)


if __name__ == "__main__":
    unittest.main()
