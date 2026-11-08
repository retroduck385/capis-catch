import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from mrac.ingest.load_criteria import to_row
from mrac.ingest.parse_raac import build_chunks, read_rows, slug

ROOT = Path(__file__).resolve().parent.parent
CONTENT = """<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
<office:body><office:spreadsheet><table:table table:name="Sheet1">
<table:table-row><table:table-cell><text:p>HOUSING LOANS RAAC</text:p></table:table-cell><table:table-cell/></table:table-row>
<table:table-row><table:table-cell><text:p>AGE</text:p></table:table-cell><table:table-cell><text:p>At least 18</text:p><text:p>Not more than <text:span>65</text:span> at maturity</text:p></table:table-cell></table:table-row>
<table:table-row><table:table-cell><text:p>NFIS / BMI DATABASE.</text:p></table:table-cell><table:table-cell><text:p>No derogatory record.</text:p><text:p>ACCEPTABLE NFIS RECORDS</text:p><text:p>Cancelled cards</text:p></table:table-cell></table:table-row>
<table:table-row table:number-rows-repeated="3"><table:table-cell/><table:table-cell/></table:table-row>
</table:table></office:spreadsheet></office:body></office:document-content>"""

# the criterion names in the bank's RAAC sheet (names only, no policy text)
SHEET_LABELS = ["AGE", "CITIZENSHIP", "NFIS / BMI DATABASE.", "MARITAL STATUS", "RESIDENCE OWNERSHIP", "SOURCE OF INCOME",
                "EMPLOYMENT STATUS/TENURE", "LENGTH OF BUSINESS OPERATION (For Self-Employed)", "BUSINESS REGISTRATION",
                "INCOME", "DEBT BURDEN RATIO", "CO-BORROWER REQUIREMENT", "ACCEPTABLE ATTY-IN-FACT"]


def mini_ods() -> str:
    path = Path(tempfile.mkdtemp()) / "t.ods"
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("content.xml", CONTENT)
    return str(path)


class RaacParserTests(unittest.TestCase):
    def test_slugs(self):
        self.assertEqual(slug("NFIS / BMI DATABASE."), "NFIS-BMI-DATABASE")
        self.assertEqual(slug("LENGTH OF BUSINESS OPERATION (For Self-Employed)"), "LENGTH-OF-BUSINESS-OPERATION")
        self.assertEqual(slug("EMPLOYMENT STATUS/TENURE"), "EMPLOYMENT-STATUS-TENURE")

    def test_cells_keep_their_paragraphs_and_empty_rows_are_ignored(self):
        rows = read_rows(mini_ods())
        self.assertEqual(rows[1], ["AGE", "At least 18\nNot more than 65 at maturity"])
        self.assertEqual(len(rows), 3)

    def test_one_chunk_per_row_and_the_nfis_row_is_split(self):
        chunks = build_chunks(read_rows(mini_ods()), "t.ods", effective_from="2021-06-01")
        self.assertEqual([c["id"] for c in chunks], ["RAAC-HL-01-AGE", "RAAC-HL-02-NFIS-BMI-DATABASE", "RAAC-HL-02-NFIS-BMI-DATABASE-EXCEPTIONS"])
        self.assertEqual(chunks[2]["tags"][-1], "exception")
        self.assertNotIn("Cancelled", chunks[1]["text"])
        self.assertEqual((chunks[0]["status"], chunks[0]["effective_from"], chunks[0]["products"]), ("draft", "2021-06-01", ["housing_purchase"]))

    def test_no_effective_date_is_left_empty_not_invented(self):
        self.assertIsNone(build_chunks(read_rows(mini_ods()), "t.ods")[0]["effective_from"])


class CriteriaTests(unittest.TestCase):
    rules = json.loads((ROOT / "rules" / "housing_raac_draft.json").read_text())

    def test_every_source_link_points_at_a_row_of_the_sheet(self):
        keys = {f"RAAC-HL-{n:02d}-{slug(label)}" for n, label in enumerate(SHEET_LABELS, start=1)}
        for r in self.rules:
            if r.get("source_chunk_key"):
                self.assertIn(r["source_chunk_key"], keys, r["code"])

    def test_all_draft_rules_start_disabled_and_codes_are_unique(self):
        self.assertTrue(all(r["enabled"] is False for r in self.rules))
        self.assertEqual(len({r["code"] for r in self.rules}), len(self.rules))

    def test_every_auto_rule_is_complete_and_every_manual_rule_has_a_prompt(self):
        for r in self.rules:
            if r["check_type"] == "auto":
                self.assertTrue(r["field"] and r["op"] and "threshold" in r, r["code"])
            else:
                self.assertTrue(r["prompt"], r["code"])

    def test_loader_row_keeps_an_existing_enabled_flag_and_links_the_source(self):
        rule = self.rules[0]
        row = to_row(rule, {rule["source_chunk_key"]: 42}, {rule["code"]: True})
        self.assertEqual((row["enabled"], row["source_chunk_id"]), (True, 42))
        self.assertFalse(to_row(rule, {}, {})["enabled"])                      # new rows are always disabled


if __name__ == "__main__":
    unittest.main()
