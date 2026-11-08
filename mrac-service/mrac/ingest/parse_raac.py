"""Housing-Loan RAAC spreadsheet (.ods) -> DRAFT policy chunks (JSONL), one chunk per criterion row.

    python -m mrac.ingest.parse_raac Housing-Loan_RAAC.ods --effective-from YYYY-MM-DD --out out/raac

The sheet is a two-column table (criterion | requirement). Rows are already atomic, so each row is one chunk. The
NFIS row carries a long table of acceptable records; it is split in two (the rule, and its exceptions).
Reads the .ods XML directly (standard library only) so line breaks inside a cell are kept: pandas glued them together.
The sheet carries no date or version: pass --effective-from, otherwise chunks have no effective date.
"""
from __future__ import annotations

import argparse
import json
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

NS = {"table": "urn:oasis:names:tc:opendocument:xmlns:table:1.0",
      "text": "urn:oasis:names:tc:opendocument:xmlns:text:1.0"}
T = "{%s}" % NS["table"]
X = "{%s}" % NS["text"]
EXCEPTIONS_MARKER = re.compile(r"^\s*ACCEPTABLE\s+NFIS\s+RECORDS", re.I | re.M)


def slug(label: str) -> str:
    """'NFIS / BMI DATABASE.' -> 'NFIS-BMI-DATABASE'; a trailing '(For Self-Employed)' is dropped."""
    return re.sub(r"[^A-Z0-9]+", "-", label.split("(")[0].upper()).strip("-")


def _paragraph(p) -> str:
    out = []

    def walk(node):
        if node.text:
            out.append(node.text)
        for child in node:
            if child.tag == X + "s":
                out.append(" " * int(child.get(X + "c", "1")))
            elif child.tag in (X + "tab",):
                out.append(" ")
            elif child.tag == X + "line-break":
                out.append("\n")
            else:
                walk(child)
            if child.tail:
                out.append(child.tail)
    walk(p)
    return "".join(out).strip()


def read_rows(path: str) -> list[list[str]]:
    """Every row of the first sheet as a list of cell texts (paragraphs joined by newlines)."""
    with zipfile.ZipFile(path) as z:
        root = ET.fromstring(z.read("content.xml"))
    table = root.find(".//table:table", NS)
    rows = []
    for row in table.findall("table:table-row", NS):
        cells = []
        for cell in row.findall("table:table-cell", NS):
            text = "\n".join(t for t in (_paragraph(p) for p in cell.findall("text:p", NS)) if t)
            cells.extend([text] * int(cell.get(T + "number-columns-repeated", "1")))
        if any(cells):
            rows.extend([cells] * int(row.get(T + "number-rows-repeated", "1")))
    return rows


def build_chunks(rows: list[list[str]], source: str, code: str = "RAAC", effective_from: str | None = None) -> list[dict]:
    title = next((r[0] for r in rows if r and r[0] and not (len(r) > 1 and r[1])), "Housing Loans RAAC")
    data = [r for r in rows if len(r) > 1 and r[0] and r[1]]
    chunks: list[dict] = []

    def add(n: int, key_suffix: str, label: str, body: str, tags: list[str]) -> None:
        heading = f"RAAC > {label}"
        chunks.append({
            "id": f"{code}-HL-{n:02d}-{key_suffix}", "type": "policy", "status": "draft", "rule": None,
            "section": "Housing Loans Risk Asset Acceptance Criteria", "heading_path": heading, "part": None,
            "version": effective_from, "effective_from": effective_from, "effective_to": None,
            "revision_dates": [effective_from] if effective_from else [],
            "products": ["housing_purchase"], "segments": ["all"], "tags": ["housing_loan", "risk_criteria", "raac"] + tags,
            "source_doc": Path(source).name, "pdf_pages": [], "manual_pages": [], "text": f"{heading}\n{body.strip()}",
            "sheet_title": title,
        })

    for n, row in enumerate(data, start=1):
        label, requirement = row[0].strip(), row[1].strip()
        key = slug(label)
        m = EXCEPTIONS_MARKER.search(requirement)
        if m:                                           # the NFIS row: the rule, then its table of acceptable records
            add(n, key, label, requirement[:m.start()], [])
            add(n, key + "-EXCEPTIONS", f"{label} > Acceptable records", requirement[m.start():], ["exception"])
        else:
            add(n, key, label, requirement, [])
    return chunks


def main() -> None:
    ap = argparse.ArgumentParser(description="Housing-Loan RAAC .ods -> draft chunks (JSONL)")
    ap.add_argument("ods")
    ap.add_argument("--out", default="out/raac")
    ap.add_argument("--code", default="RAAC", help="id prefix; the criteria file links to chunks as RAAC-HL-<n>-<LABEL>")
    ap.add_argument("--effective-from", help="YYYY-MM-DD: when this RAAC took effect (the sheet itself has no date)")
    a = ap.parse_args()
    chunks = build_chunks(read_rows(a.ods), a.ods, a.code, a.effective_from)
    Path(a.out).mkdir(parents=True, exist_ok=True)
    with open(Path(a.out) / "draft_chunks.jsonl", "w", encoding="utf-8") as f:
        for c in chunks:
            f.write(json.dumps(c, ensure_ascii=False) + "\n")
    print(f"{len(chunks)} chunks written to {Path(a.out) / 'draft_chunks.jsonl'}")
    for c in chunks:
        print(" ", c["id"])
    if not a.effective_from:
        print("note: no --effective-from given, so these chunks have no effective date")


if __name__ == "__main__":
    main()
