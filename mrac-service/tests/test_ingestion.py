import unittest

from mrac.ingest.parse_policy import build_chunks, parse_header


def page(no, sec, body, rev="2024-11-12", mp="1"):
    return {"pdf_page": no, "section_no": sec, "section_title": "T", "revision_date": rev,
            "manual_page": mp, "body": body}


class IngestionTests(unittest.TestCase):
    def test_header_parsing(self):
        h = parse_header("CREDIT POLICY MANUAL\nSECTION VII – CREDIT INITIATION AND\nFINANCIAL PACKAGING",
                         "ISSUE DATE\n08.09.2004\nREVISION DATE\n07.12.2017\nPAGE NO.\n59")
        self.assertEqual((h["section_no"], h["revision_date"], h["manual_page"]), ("VII", "2017-07-12", "59"))
        self.assertEqual(h["section_title"], "CREDIT INITIATION AND FINANCIAL PACKAGING")

    def test_header_layouts_seen_in_the_other_manuals(self):
        ccd = parse_header("ISSUE DATE CONSUMER CREDIT DEPARTMENT 03.08.2016 Bank of REVISION DATE OPERATIONS MANUAL 02.19.2020 Makati PAGE NO. SECTION V – AUTO AND LUXURY BIKE LOANS 14")
        self.assertEqual((ccd["section_no"], ccd["section_title"], ccd["revision_date"], ccd["manual_page"]), ("V", "AUTO AND LUXURY BIKE LOANS", "2020-02-19", "14"))
        red = parse_header("ISSUE DATE 05.10.2016 RED OPERATIONS MANUAL Bank of REVISION DATE 01.11.2022 Makati SECTION X – HOME GUARANTY CORPORATION PAGE NO. (HGC) GUARANTY PROGRAM 49")
        self.assertEqual((red["section_no"], red["section_title"], red["manual_page"]), ("X", "HOME GUARANTY CORPORATION (HGC) GUARANTY PROGRAM", "49"))
        rev = parse_header("ISSUE DATE 05.10.2016 RED OPERATIONS MANUAL Bank of REVISION DATE 01.13.2026 Makati PAGE NO. SUMMARY OF REVISIONS 53")
        self.assertEqual((rev["section_no"], rev["revision_date"]), ("REV", "2026-01-13"))

    def test_products_follow_the_section_title_and_ids_the_document_code(self):
        from mrac.ingest.parse_policy import infer_products
        self.assertEqual(infer_products("HOUSING LOANS", "auto loan mentioned too"), ["housing_purchase"])
        self.assertIn("auto", infer_products("CREDIT EVALUATION", "Auto Loan - 40% of the net income; Housing Loan - 40%"))
        ch = build_chunks([page(1, "VII", "A. Limits\n" + "housing loan approving authority " * 20)], "p.pdf", code="CCD")
        self.assertTrue(ch[0]["id"].startswith("CCD-VII-"))

    def test_heading_path_and_no_gluing_of_sibling_sections(self):
        body = ("G. Insurance\n" + "x" * 400 + "\n6. MRI Policy\n" + "y" * 400 +
                "\nc. Housing Loan\n" + "z" * 400 + "\nH. Credit Implementations\n" + "w" * 400)
        ch = build_chunks([page(1, "IX", body)], "p.pdf")
        h = next(c for c in ch if "z" * 50 in c["text"])
        self.assertEqual(h["heading_path"], "IX > G. Insurance > 6. MRI Policy > c. Housing Loan")
        self.assertNotIn("Credit Implementations", h["text"])
        self.assertTrue(any(c["heading_path"].endswith("H. Credit Implementations") for c in ch))

    def test_chunks_are_draft_and_carry_provenance(self):
        ch = build_chunks([page(5, "VIII", "A. Limits\n" + "approval limit for housing loans " * 20, mp="59")], "p.pdf")
        c = ch[0]
        self.assertEqual((c["status"], c["rule"], c["version"], c["manual_pages"]), ("draft", None, "2024-11-12", ["59"]))
        self.assertIn("housing_loan", c["tags"])

    def test_chunks_never_mix_pages_with_different_revision_dates(self):
        body = "A. Limits\n" + "older clause text " * 25
        ch = build_chunks([page(1, "VII", body, rev="2024-09-03"), page(2, "VII", "newer table text " * 25, rev="2025-02-04")], "p.pdf")
        by_text = {("older" in c["text"]): c["version"] for c in ch}
        self.assertEqual(by_text, {True: "2024-09-03", False: "2025-02-04"})
        self.assertTrue(all(len(c["revision_dates"]) == 1 for c in ch))

    def test_long_clause_is_split(self):
        ch = build_chunks([page(1, "X", "A. Big\n" + "\n".join("line %d %s" % (i, "q" * 80) for i in range(60)))], "p.pdf")
        self.assertGreater(len(ch), 1)
        self.assertTrue(all(len(c["text"]) < 2200 for c in ch))


if __name__ == "__main__":
    unittest.main()
