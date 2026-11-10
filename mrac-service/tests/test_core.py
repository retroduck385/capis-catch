"""Run:  python -m unittest discover -s tests -v    (no database, no network, no extra packages)"""
import json
import unittest
from pathlib import Path

from mrac.embeddings import HashEmbedder
from mrac.ingest.load_chunks import select, to_row
from mrac.retrieval import LocalRetriever, SupabaseRetriever
from mrac.rules_engine import evaluate, normalize, overall
from mrac.service import ask, check
from worker import process

ROOT = Path(__file__).resolve().parent.parent
CRITERIA = [normalize(r) for r in json.loads((ROOT / "rules" / "housing_raac_draft.json").read_text())]
FACTS = lambda n: json.loads((ROOT / "samples" / f"facts_{n}.json").read_text())
RETR = LocalRetriever.from_jsonl(str(ROOT / "samples" / "policy_chunks_synthetic.jsonl"))
crit = lambda code: next(c for c in CRITERIA if c["code"] == code)
mk = lambda **kw: normalize({"code": "X", "field": "f", **kw})


class RulesTests(unittest.TestCase):
    def test_numeric_pass_fail_borderline_missing(self):
        c = mk(op="<=", threshold=0.40)
        self.assertEqual(evaluate(c, {"f": 0.30})["status"], "pass")
        self.assertEqual(evaluate(c, {"f": 0.46})["status"], "fail")
        self.assertEqual(evaluate(c, {"f": 0.41})["status"], "needs_review")        # within 5%
        self.assertEqual(evaluate(c, {"f": None})["status"], "needs_review")
        self.assertEqual(evaluate(c, {"f": "abc"})["status"], "needs_review")
        self.assertEqual(evaluate(c, {"f": True})["status"], "needs_review")        # a bool is not a number

    def test_borderline_switched_off(self):
        c = mk(op=">=", threshold=2, options={"borderline_pct": 0})
        self.assertEqual(evaluate(c, {"f": 2})["status"], "pass")
        self.assertEqual(evaluate(c, {"f": 1})["status"], "fail")

    def test_in_and_equality_ops(self):
        c = mk(op="in", threshold=["A", "B"])
        self.assertEqual(evaluate(c, {"f": "A"})["status"], "pass")
        self.assertEqual(evaluate(c, {"f": "Z"})["status"], "fail")
        self.assertEqual(evaluate(mk(op="==", threshold=False), {"f": False})["status"], "pass")
        self.assertEqual(evaluate(mk(op="==", threshold=False), {"f": True})["status"], "fail")
        self.assertEqual(evaluate(mk(op="not_in", threshold=["X"]), {"f": "Y"})["status"], "pass")

    def test_unlisted_value_needs_review_unless_it_is_a_known_fail_value(self):
        c = mk(op="in", threshold=["A"], options={"fail_values": ["NONE"]})
        self.assertEqual(evaluate(c, {"f": "NONE"})["status"], "fail")
        self.assertEqual(evaluate(c, {"f": "OTHER"})["status"], "needs_review")

    def test_income_tiers_depend_on_loan_amount(self):
        hi, lo = crit("RAAC-INCOME-HIGH"), crit("RAAC-INCOME-LOW")
        big = {"loan_amount": 3_000_000, "total_gross_income": 36000}
        self.assertEqual((evaluate(hi, big)["status"], evaluate(lo, big)["status"]), ("fail", "not_applicable"))
        small = {"loan_amount": 800_000, "total_gross_income": 36000}
        self.assertEqual((evaluate(hi, small)["status"], evaluate(lo, small)["status"]), ("not_applicable", "pass"))
        self.assertEqual(evaluate(hi, {"total_gross_income": 99999})["status"], "needs_review")   # loan amount unknown

    def test_co_borrower_rule(self):
        c = crit("RAAC-CO-BORROWER")
        self.assertEqual(evaluate(c, {"dbr_standalone": 0.3, "employment_type": "LOCALLY_EMPLOYED", "borrower_count": 1})["status"], "not_applicable")
        self.assertEqual(evaluate(c, {"dbr_standalone": 0.5, "employment_type": "LOCALLY_EMPLOYED", "borrower_count": 1})["status"], "fail")
        self.assertEqual(evaluate(c, {"dbr_standalone": 0.5, "employment_type": "LOCALLY_EMPLOYED", "borrower_count": 2})["status"], "pass")
        self.assertEqual(evaluate(c, {"dbr_standalone": 0.5, "employment_type": "OFW", "borrower_count": 1})["status"], "not_applicable")
        r = evaluate(c, {"employment_type": "LOCALLY_EMPLOYED", "borrower_count": 1})            # standalone DBR unknown
        self.assertEqual(r["status"], "needs_review")
        self.assertIn("cannot tell whether this applies", r["reason"])

    def test_source_of_income_unlisted_types_go_to_review_and_unemployed_fails(self):
        c = crit("RAAC-INCOME-SOURCE")
        self.assertEqual(evaluate(c, {"employment_type": "SEAFARER"})["status"], "pass")
        self.assertEqual(evaluate(c, {"employment_type": "VIRTUAL_ASSISTANT"})["status"], "needs_review")
        self.assertEqual(evaluate(c, {"employment_type": "UNEMPLOYED"})["status"], "fail")

    def test_manual_checks_never_change_the_outcome(self):
        m = evaluate(crit("RAAC-CITIZENSHIP"), {})
        self.assertEqual(m["status"], "manual")
        self.assertEqual(overall([m]), "NO_RULES")
        self.assertEqual(overall([m, {"status": "pass"}]), "PASS")
        self.assertEqual(overall([{"status": "not_applicable"}, {"status": "needs_review"}]), "REVIEW")
        self.assertEqual(overall([{"status": "needs_review"}, {"status": "fail"}]), "FAIL")
        self.assertEqual(overall([]), "NO_RULES")


class ServiceTests(unittest.TestCase):
    def test_clean_facts_pass(self):
        r = check(FACTS("clean"), CRITERIA, RETR)
        self.assertEqual((r["overall"], r["has_deviation_suggested"]), ("PASS", False))
        self.assertIn("RAAC-INCOME-LOW", r["not_applicable"])
        self.assertEqual({m["code"] for m in r["manual_checks"]}, {"RAAC-CITIZENSHIP", "RAAC-NFIS", "RAAC-EMP-STATUS"})

    def test_deviation_facts_fail_with_exception_clauses_only_where_one_exists(self):
        r = check(FACTS("deviation"), CRITERIA, RETR)
        self.assertEqual(r["overall"], "FAIL")
        failed = {c["code"] for c in r["criteria"] if c["status"] == "fail"}
        self.assertEqual(failed, {"RAAC-AGE-MAX", "RAAC-INCOME-HIGH", "RAAC-DBR", "RAAC-CO-BORROWER", "POLICY-SCORE-ACCEPTABLE"})
        by = {s["criterion"]: s for s in r["suggested_exceptions"]}
        self.assertEqual(by["RAAC-DBR"]["citations"][0]["chunk_key"], "SYN-0003")
        self.assertEqual(by["POLICY-SCORE-ACCEPTABLE"]["citations"][0]["chunk_key"], "SYN-0006")
        self.assertEqual(by["RAAC-AGE-MAX"]["citations"], [])                                   # no relevant clause: say so
        # income shares the word "income" with the co-borrower clause, which is a sensible suggestion; nothing unrelated appears
        self.assertLessEqual({c["chunk_key"] for c in by["RAAC-INCOME-HIGH"]["citations"]}, {"SYN-0003"})
        self.assertEqual((by["RAAC-DBR"]["exception_recommendation"], by["RAAC-DBR"]["mitigant"]), ("", ""))   # the CO writes these

    def test_source_clause_is_attached_to_a_failed_criterion(self):
        retr = LocalRetriever([{"id": "RAAC-HL-01-AGE", "source_doc": "r.ods", "heading_path": "RAAC > AGE",
                                "text": "RAAC > AGE\nat least 18, not more than 65 at maturity", "tags": [], "status": "draft"}])
        r = check(FACTS("deviation"), CRITERIA, retr, context_queries=[])
        age = next(c for c in r["criteria"] if c["code"] == "RAAC-AGE-MAX")
        self.assertEqual(age["source"]["heading_path"], "RAAC > AGE")
        self.assertIn("65", age["source"]["excerpt"])
        passing = next(c for c in r["criteria"] if c["code"] == "RAAC-AGE-MIN")
        self.assertIsNone(passing["source"])

    def test_whole_clause_is_kept_not_cut_at_350_characters(self):
        long_text = "RAAC > DBR\n" + ("monthly amortization is the sum of all monthly debts. " * 25)
        retr = LocalRetriever([{"id": "RAAC-HL-11-DEBT-BURDEN-RATIO", "source_doc": "r.ods", "heading_path": "RAAC > DBR", "text": long_text, "tags": []}])
        r = check({"dbr": 0.9}, [crit("RAAC-DBR")], retr)
        self.assertEqual(r["criteria"][0]["source"]["excerpt"], long_text)
        self.assertGreater(len(long_text), 1000)

    def test_generic_context_only_appears_when_no_automatic_criterion_ran(self):
        self.assertEqual(check(FACTS("clean"), CRITERIA, RETR)["policy_context"], [])
        self.assertTrue(check(FACTS("clean"), [], RETR)["policy_context"])

    def test_no_criteria_still_returns_policy_context(self):
        r = check(FACTS("clean"), [], RETR)
        self.assertEqual(r["overall"], "NO_RULES")
        keys = [c["chunk_key"] for c in r["policy_context"]]
        self.assertIn("SYN-0001", keys)
        self.assertIn("SYN-0002", keys)
        self.assertIn("No automatic MRAC criteria", " ".join(r["notes"]))

    def test_missing_facts_go_to_review_not_pass(self):
        r = check({}, [crit("RAAC-DBR"), crit("RAAC-AGE-MIN")], RETR)
        self.assertEqual(r["overall"], "REVIEW")

    def test_hard_stop_flag_is_reported(self):
        r = check(dict(FACTS("clean"), has_replevin_or_foreclosure=True), CRITERIA, RETR)
        stop = next(c for c in r["criteria"] if c["code"] == "RAAC-NO-REPLEVIN")
        self.assertEqual((stop["status"], stop["hard_stop"]), ("fail", True))

    def test_ask_returns_ranked_passages(self):
        r = ask("who must the mortgage redemption insurance cover", RETR)
        self.assertEqual(r["passages"][0]["chunk_key"], "SYN-0002")

    def test_effective_dates_are_respected(self):
        keys = lambda on: [h["chunk_key"] for h in RETR.search("housing loan approving authority limit table", top_k=8, on=on)]
        self.assertNotIn("SYN-0008", keys("2024-01-01"))      # expired 2022-12-31
        self.assertIn("SYN-0008", keys("2021-01-01"))

    def test_retriever_accepts_parse_output_keys(self):
        r = LocalRetriever([{"id": "CCD-VII-0001", "source_doc": "m.pdf", "heading_path": "VII", "text": "housing loan limits", "tags": []}])
        self.assertEqual(r.search("housing limits")[0]["chunk_key"], "CCD-VII-0001")
        self.assertEqual(r.fetch(["CCD-VII-0001"])[0]["document"], "m.pdf")


class FakeResp:
    def __init__(self, data): self.data = data
    def execute(self): return self


class FakeTable:
    def __init__(self, db, name): self.db, self.name, self.op = db, name, None
    def select(self, *_): self.op = "select"; return self
    def update(self, payload): self.op, self.payload = "update", payload; return self
    def eq(self, col, val): self.col, self.val = col, val; return self
    def in_(self, col, vals): self.col, self.val = col, vals; return self
    def execute(self):
        if self.op == "update":
            self.db.updates.append((self.name, self.payload, self.col, self.val)); return FakeResp(None)
        if self.name == "policy_chunks":
            return FakeResp([r for r in self.db.chunk_rows if r["chunk_key"] in self.val])
        return FakeResp(self.db.criteria_rows if self.name == "mrac_criteria" else [])


class FakeClient:
    def __init__(self, criteria_rows=None, rpc_rows=None, chunk_rows=None):
        self.criteria_rows, self.rpc_rows, self.chunk_rows = criteria_rows or [], rpc_rows or [], chunk_rows or []
        self.updates, self.rpc_calls = [], []
    def table(self, name): return FakeTable(self, name)
    def rpc(self, name, args): self.rpc_calls.append((name, args)); return FakeResp(self.rpc_rows)


class WorkerTests(unittest.TestCase):
    def test_check_run_is_saved_as_done(self):
        rows = [{"code": "DBR", "label": "DBR", "field": "dbr", "op": "<=", "threshold": 0.4, "enabled": True}]
        client = FakeClient(rows)
        process(client, {"run_id": 7, "run_kind": "CHECK", "run_facts": {"dbr": 0.5}, "run_question": None}, RETR, "test")
        table, payload, col, val = client.updates[0]
        self.assertEqual((table, payload["status"], col, val), ("mrac_runs", "DONE", "id", 7))
        self.assertEqual(payload["result"]["overall"], "FAIL")

    def test_database_style_rows_with_json_columns_work(self):
        rows = [{"code": "I", "label": "Income", "check_type": "auto", "field": "total_gross_income", "op": ">=", "threshold": 40000,
                 "applies_when": [{"field": "loan_amount", "op": ">=", "value": 1000000}], "options": {}, "enabled": True}]
        client = FakeClient(rows)
        process(client, {"run_id": 3, "run_kind": "CHECK", "run_facts": {"loan_amount": 2000000, "total_gross_income": 10000}, "run_question": None}, RETR, "test")
        self.assertEqual(client.updates[0][1]["result"]["overall"], "FAIL")

    def test_ask_run_is_saved_as_done(self):
        client = FakeClient()
        process(client, {"run_id": 8, "run_kind": "ASK", "run_facts": None, "run_question": "mortgage redemption insurance"}, RETR, "test")
        self.assertEqual(client.updates[0][1]["result"]["kind"], "ASK")

    def test_errors_are_saved_on_the_run_not_raised(self):
        class Boom:
            def search(self, *a, **k): raise RuntimeError("index missing")
        client = FakeClient()
        process(client, {"run_id": 9, "run_kind": "ASK", "run_facts": None, "run_question": "x"}, Boom(), "test")
        self.assertEqual(client.updates[0][1]["status"], "FAILED")
        self.assertIn("index missing", client.updates[0][1]["error"])


class SupabaseRetrieverTests(unittest.TestCase):
    def test_calls_search_policy_and_maps_body_to_text(self):
        client = FakeClient(rpc_rows=[{"chunk_key": "K", "heading_path": "H", "manual_pages": ["1"], "revision_date": "2025-01-01",
                                       "status": "draft", "document": "d.pdf", "body": "hello", "score": 0.1}])
        hits = SupabaseRetriever(client, HashEmbedder(384), include_draft=False).search("q", top_k=3, tags=["exception"], on="2026-11-05")
        name, args = client.rpc_calls[0]
        self.assertEqual((name, args["p_limit"], args["p_tags"], args["p_on"], args["p_include_draft"]), ("search_policy", 3, ["exception"], "2026-11-05", False))
        self.assertEqual(len(args["p_embedding"]), 384)
        self.assertEqual(hits[0]["text"], "hello")

    def test_fetch_by_chunk_key(self):
        client = FakeClient(chunk_rows=[{"chunk_key": "A", "heading_path": "H", "manual_pages": [], "revision_date": None,
                                         "status": "draft", "document": "d", "body": "text A"}, {"chunk_key": "B", "body": "x"}])
        hits = SupabaseRetriever(client, HashEmbedder(384)).fetch(["A"])
        self.assertEqual([(h["chunk_key"], h["text"]) for h in hits], [("A", "text A")])


class LoaderTests(unittest.TestCase):
    def test_row_mapping_and_selection(self):
        chunk = {"id": "CPM-IX-0001", "source_doc": "p.pdf", "section": "IX X", "heading_path": "IX > A", "version": "2024-11-12",
                 "effective_from": "2024-11-12", "effective_to": None, "manual_pages": ["119"], "pdf_pages": [128],
                 "tags": ["housing_loan"], "products": [], "text": "body"}
        row = to_row(chunk, [0.1, 0.2])
        self.assertEqual((row["document"], row["chunk_key"], row["body"], row["status"]), ("p.pdf", "CPM-IX-0001", "body", "draft"))
        self.assertEqual(len(select([chunk, {**chunk, "tags": []}], tag="housing_loan")), 1)


if __name__ == "__main__":
    unittest.main()
