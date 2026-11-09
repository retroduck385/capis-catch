import json
import unittest
from pathlib import Path

from mrac.embeddings import HashEmbedder
from mrac.reasoning import build, fmt_requirement, fmt_value
from mrac.retrieval import LocalRetriever, SupabaseRetriever
from mrac.rules_engine import normalize
from mrac.service import _approval_path, check

ROOT = Path(__file__).resolve().parent.parent
CRITERIA = [normalize(r) for r in json.loads((ROOT / "rules" / "housing_raac_draft.json").read_text())]
FACTS = lambda n: json.loads((ROOT / "samples" / f"facts_{n}.json").read_text())
RETR = LocalRetriever.from_jsonl(str(ROOT / "samples" / "policy_chunks_synthetic.jsonl"))


def chunk(key, doc, date, text, products=None, tags=None, heading="H"):
    return {"id": key, "source_doc": doc, "version": date, "heading_path": heading, "text": text,
            "tags": tags or [], "products": products if products is not None else [], "manual_pages": ["1"], "status": "draft"}


class FormattingTests(unittest.TestCase):
    def test_values_and_requirements_read_naturally(self):
        self.assertEqual(fmt_value("dbr", 0.581), "58.1%")
        self.assertEqual(fmt_value("dbr", 0.4), "40%")
        self.assertEqual(fmt_value("total_gross_income", 36000), "PHP 36,000")
        self.assertEqual(fmt_value("age_at_maturity", 78), "78 years old")
        self.assertEqual(fmt_value("has_replevin_or_foreclosure", False), "no")
        self.assertEqual(fmt_value("dbr", None), "not available")
        self.assertEqual(fmt_requirement("dbr", "<= 0.4"), "at most 40%")
        self.assertEqual(fmt_requirement("employment_type", "in [A, B]"), "one of [A, B]")


class ReasoningTests(unittest.TestCase):
    def test_clean_application_meets_the_automatic_criteria(self):
        rs = check(FACTS("clean"), CRITERIA, RETR)["reasoning"]
        self.assertEqual(rs["recommendation"], "MEETS_AUTOMATED_CRITERIA")
        self.assertTrue(any("Verify from the documents" in s for s in rs["next_steps"]))

    def test_failures_need_an_exception_and_each_is_explained_with_numbers(self):
        rs = check(FACTS("deviation"), CRITERIA, RETR)["reasoning"]
        self.assertEqual(rs["recommendation"], "EXCEPTION_REQUIRED")
        dbr = next(p for p in rs["points"] if p["code"] == "RAAC-DBR")
        self.assertEqual(dbr["text"], "Debt burden ratio: 52%. The requirement is at most 40%. Not met.")
        self.assertTrue(any("V. Exception/s" in s for s in rs["next_steps"]))
        self.assertTrue(any("below the acceptable score" in s for s in rs["next_steps"]))   # the score rule failed

    def test_hard_stop_is_called_a_mandatory_criterion(self):
        facts = dict(FACTS("clean"), has_replevin_or_foreclosure=True)
        rs = check(facts, CRITERIA, RETR)["reasoning"]
        self.assertEqual(rs["recommendation"], "MANDATORY_CRITERION_NOT_MET")
        self.assertIn("mandatory", rs["headline"])

    def test_only_unclear_results_cannot_conclude(self):
        rs = check({"dbr": 0.39}, [c for c in CRITERIA if c["code"] == "RAAC-DBR"], RETR)["reasoning"]     # inside the 5% band
        self.assertEqual(rs["recommendation"], "CANNOT_CONCLUDE")
        self.assertIn("close to the requirement", rs["points"][0]["text"])

    def test_no_criteria(self):
        self.assertEqual(build([], [], [])["recommendation"], "NO_AUTOMATIC_CRITERIA")

    def test_the_reasoning_never_approves_or_declines(self):
        for name in ("clean", "deviation"):
            rs = check(FACTS(name), CRITERIA, RETR)["reasoning"]
            self.assertNotIn("APPROVE", rs["recommendation"])
            self.assertNotIn("DECLINE", rs["recommendation"])
            self.assertIn("not a credit decision", rs["disclaimer"])


class ApprovalPathTests(unittest.TestCase):
    def test_best_clause_of_each_document_newest_first_with_a_conflict_note(self):
        retr = LocalRetriever([
            chunk("A1", "ccd.pdf", "2024-08-14", "approving authority housing loans without exception", tags=["approval_authority"], products=["housing_purchase"]),
            chunk("A2", "ccd.pdf", "2024-08-14", "approving authority housing", tags=["approval_authority"], products=["housing_purchase"]),
            chunk("B1", "red.pdf", "2025-02-04", "housing loans without exception with exception", tags=["approval_authority"], products=["housing_purchase"]),
            chunk("C1", "ccd.pdf", "2024-08-14", "approving authority consumer loans", tags=["approval_authority"], products=["consumer"]),
        ])
        path = _approval_path(retr, None)
        self.assertEqual({(p["document"], p["revision_date"]) for p in path}, {("ccd.pdf", "2024-08-14"), ("red.pdf", "2025-02-04")})
        self.assertEqual(len(path), 2)                                   # one clause per document, none of the consumer-only ones
        rs = build([], [], path)
        self.assertEqual(rs["approval_path"]["passages"][0]["document"], "red.pdf")        # newest first
        self.assertIn("different documents", rs["approval_path"]["note"])

    def test_a_single_source_has_no_conflict_note(self):
        retr = LocalRetriever([chunk("A1", "ccd.pdf", "2024-08-14", "approving authority housing", tags=["approval_authority"])])
        self.assertIsNone(build([], [], _approval_path(retr, None))["approval_path"]["note"])


class ProductFilterTests(unittest.TestCase):
    retr = LocalRetriever([
        chunk("H", "d", None, "approval limit table", products=["housing_purchase"]),
        chunk("G", "d", None, "approval limit table"),                         # general: names no product
        chunk("A", "d", None, "approval limit table", products=["auto"]),
        chunk("B", "d", None, "approval limit table", products=["business", "auto"]),
    ])

    def test_keeps_housing_and_general_drops_other_products(self):
        keys = {h["chunk_key"] for h in self.retr.search("approval limit table", top_k=10, products=["housing_purchase"])}
        self.assertEqual(keys, {"H", "G"})
        self.assertEqual(len(self.retr.search("approval limit table", top_k=10)), 4)

    def test_revision_date_comes_from_the_parsers_version_field(self):
        self.assertEqual(LocalRetriever([chunk("X", "d", "2025-02-04", "some text here")]).search("text")[0]["revision_date"], "2025-02-04")

    def test_supabase_retriever_passes_the_product_filter(self):
        class C:
            calls = []
            def rpc(self, name, args):
                self.calls.append(args); return self
            def execute(self): self.data = []; return self
        c = C()
        SupabaseRetriever(c, HashEmbedder(384)).search("q", products=["housing_purchase"], tags=["approval_authority"])
        self.assertEqual((c.calls[0]["p_products"], c.calls[0]["p_tags"]), (["housing_purchase"], ["approval_authority"]))

    def test_exception_clause_needs_most_of_the_rules_key_words(self):
        retr = LocalRetriever([chunk("E1", "d", None, "Exception: income may be accepted when a co-borrower is added", tags=["exception"])])
        crit = [c for c in CRITERIA if c["code"] == "RAAC-INCOME-HIGH"]
        r = check({"loan_amount": 3_000_000, "total_gross_income": 1000}, crit, retr, context_queries=[])
        self.assertEqual(r["suggested_exceptions"][0]["citations"], [])        # shares only "income" with "minimum gross monthly income"


if __name__ == "__main__":
    unittest.main()
