"""Policy PDF -> DRAFT chunks (JSONL) for human review.  Tuned for the bank Credit Policy Manual layout (boxed header on every page).

    python -m mrac.ingest.parse_policy policy.pdf     # writes out/draft_chunks.jsonl + out/report.txt
    pip install pdfplumber

Design
  * Every page has a boxed header (section, REVISION DATE, manual page no.). It is cropped off and parsed as
    METADATA, so it never pollutes chunk text, and each chunk keeps its own revision date (35 different ones here).
  * Body text is split on the manual's own numbering (A. / 1. / a. / 1) ) into one chunk per clause, tracking a
    heading path such as "VII > D. Credit Evaluation > 5. Guidelines on Financial Analysis".
  * Small clauses are merged into their parent, over-long clauses are split into parts. Nothing is invented:
    chunks are status="draft" with rule=None until a credit-policy reviewer approves them.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path


HEADER_BOTTOM = 160          # pt; the boxed page header ends ~158pt on letter pages
MIN_CHARS, MAX_CHARS = 350, 1800
ROMAN = r"[IVXL]+"
H1 = re.compile(r"^\s{0,12}([A-Z])\.\s+(\S.*)$")           # A. Title
H2 = re.compile(r"^\s{0,16}(\d{1,2})\.\s+(\S.*)$")         # 1. Title
H3 = re.compile(r"^\s{0,22}([a-z])\.\s+(\S.*)$")           # a. Title
TAGS = {                                                    # cheap keyword tags to help reviewers filter
    "housing_loan": r"\bhousing\b|\bHL\b|\bMRI\b|mortgage redemption",
    "consumer_loan": r"\bconsumer\b|personal loan|auto loan|motorcycle",
    "business_loan": r"\bbusiness loan|\benterprise\b|working capital",
    "exception": r"\bexception|\bwaive|\bdeviation|\bnot meet",
    "approval_authority": r"approving authority|approval limits?|delegated limits",
    "insurance": r"\binsurance\b|\bMRI\b",
    "collateral": r"\bcollateral\b|appraised value|\bREM\b",
    "risk_criteria": r"risk asset|acceptance criteria|\bRAAC\b|eligibility criteria",
    "delinquency": r"delinquen|past due|demand letter",
}


DATE_RX = re.compile(r"(\d{2})\.(\d{2})\.(\d{4})")
FRONT_MATTER = {"SUMMARY OF REVISIONS": "REV", "LIST OF EXHIBITS": "EXH"}      # kept: circular history, exhibit titles
NOISE = re.compile(r"ISSUE DATE|REVISION DATE|PAGE NO\.?|\d{2}\.\d{2}\.\d{4}|Bank of|Makati|"
                   r"CREDIT POLICY MANUAL|CONSUMER CREDIT DEPARTMENT|RED OPERATIONS MANUAL|OPERATIONS MANUAL")


def parse_header(text: str, extra: str = "") -> dict:
    """Parse the boxed page header. Works on the whole header strip (not a column crop: cropping clipped the first
    letters of long titles). `extra` is accepted for the older two-column call style."""
    t = re.sub(r"\s+", " ", f"{text} {extra}").strip()
    dates = DATE_RX.findall(t)                      # issue date first, revision date last
    rev = dates[-1] if dates else None
    page = re.search(r"(\d+|[IVXL]+)\s*$", t)
    sec = re.search(r"SECTION\s+(" + ROMAN + r")\s*[–-]\s*(.*)$", t)
    section_no = section_title = None
    if sec:
        section_no = sec.group(1)
        section_title = re.sub(r"\s+", " ", NOISE.sub(" ", sec.group(2))).strip(" –-")
        section_title = re.sub(r"\s+\d+$", "", section_title)             # the page number that ends the strip
    else:
        cleaned = re.sub(r"\s+", " ", NOISE.sub(" ", t)).strip()
        cleaned = re.sub(r"\s*(\d+|[IVXL]+)$", "", cleaned)
        for name, code in FRONT_MATTER.items():
            if name in cleaned:
                section_no, section_title = code, name
    return {
        "revision_date": f"{rev[2]}-{rev[0]}-{rev[1]}" if rev else None,     # MM.DD.YYYY -> ISO
        "section_no": section_no, "section_title": section_title,
        "manual_page": page.group(1) if page else None,
    }


def read_pages(pdf_path: str) -> list[dict]:
    import pdfplumber  # pip install pdfplumber
    pages = []
    with pdfplumber.open(pdf_path) as pdf:
        for i, p in enumerate(pdf.pages, start=1):
            head = p.crop((0, 0, p.width, HEADER_BOTTOM)).extract_text() or ""
            body = p.crop((0, HEADER_BOTTOM, p.width, p.height)).extract_text(layout=False) or ""
            pages.append({"pdf_page": i, **parse_header(head), "body": body})
    return pages


PRODUCT_RX = {
    "housing_purchase": r"\bhousing\b|\bHL\b",
    "auto": r"\bauto\b|luxury bike",
    "consumer": r"power pay ?day|\bPPL\b|doctor'?s loan|seafarers? salary|personal loan",
    "expanded_motor": r"expanded motor|\bEML\b",
    "business": r"business loan|developer|contract[- ]to[- ]sell|\bCTS\b",
}


def infer_products(section_title: str | None, text: str) -> list[str]:
    """A section title that names a product decides (e.g. 'HOUSING LOANS'); otherwise keywords in the clause."""
    for product, rx in PRODUCT_RX.items():
        if section_title and re.search(rx, section_title, re.I):
            return [product]
    return [product for product, rx in PRODUCT_RX.items() if re.search(rx, text, re.I)]


def tag(text: str) -> list[str]:
    return [k for k, rx in TAGS.items() if re.search(rx, text, re.I)]


def split_long(text: str) -> list[str]:
    """Split an over-long clause at line boundaries, never exceeding MAX_CHARS (prefers bullet starts)."""
    bullet = re.compile(r"^\s*(?:[•●➔✔\-]|\d+\)|[a-z]\)|\d+\.\d+)\s")
    parts, cur = [], []
    size = 0
    for line in text.splitlines():
        if cur and (size + len(line) > MAX_CHARS or (size > MAX_CHARS * 0.7 and bullet.match(line))):
            parts.append("\n".join(cur).strip()); cur, size = [], 0
        cur.append(line); size += len(line) + 1
    if cur:
        parts.append("\n".join(cur).strip())
    return [x for x in parts if x]


def build_chunks(pages: list[dict], source: str, code: str = "CPM") -> list[dict]:
    units: list[dict] = []          # one unit per clause (heading + body), before merge/split
    stack: dict[int, str] = {}
    cur = None
    for pg in pages:
        if not pg["section_no"]:
            continue                                         # cover / TOC pages without a section header
        for line in pg["body"].splitlines():
            m = H1.match(line) or H2.match(line) or H3.match(line)
            lvl = 1 if H1.match(line) else 2 if H2.match(line) else 3 if m else 0
            # a new section always starts a new unit
            # a page with a different revision date starts a new chunk, so a clause is never dated by its neighbours
            new_rev = bool(cur and cur["revs"] and pg["revision_date"] and pg["revision_date"] not in cur["revs"])
            if cur is None or cur["section_no"] != pg["section_no"] or (m and lvl) or new_rev:
                if m and lvl:
                    stack = {k: v for k, v in stack.items() if k < lvl}
                    stack[lvl] = f"{m.group(1)}. {m.group(2).strip()[:70]}"
                elif cur is None or cur["section_no"] != pg["section_no"]:
                    stack = {}
                cur = {"level": lvl if m else 0, "section_no": pg["section_no"], "section_title": pg["section_title"],
                       "heading_path": " > ".join([pg["section_no"]] + [stack[k] for k in sorted(stack)]),
                       "lines": [], "pages": set(), "manual_pages": set(), "revs": set()}
                units.append(cur)
            cur["lines"].append(line.strip())
            cur["pages"].add(pg["pdf_page"]); cur["manual_pages"].add(pg["manual_page"])
            if pg["revision_date"]: cur["revs"].add(pg["revision_date"])

    # merge tiny units into the previous unit of the same section, split huge ones
    merged: list[dict] = []
    for u in units:
        text = "\n".join(l for l in u["lines"] if l).strip()
        u["text"] = text
        if merged and len(text) < MIN_CHARS and merged[-1]["section_no"] == u["section_no"] \
                and u["level"] > merged[-1]["level"] \
                and len(merged[-1]["text"]) + len(text) <= MAX_CHARS:
            m = merged[-1]
            m["text"] += "\n" + text
            m["pages"] |= u["pages"]; m["manual_pages"] |= u["manual_pages"]; m["revs"] |= u["revs"]
        else:
            merged.append(u)

    chunks, seq = [], {}
    for u in merged:
        pieces = split_long(u["text"]) if len(u["text"]) > MAX_CHARS else [u["text"]]
        for part_no, piece in enumerate(pieces, start=1):
            if len(piece) < 30:
                continue                                      # stray fragments / page numbers
            s = u["section_no"]; seq[s] = seq.get(s, 0) + 1
            rev = max(u["revs"]) if u["revs"] else None
            chunks.append({
                "id": f"{code}-{s}-{seq[s]:04d}", "type": "policy", "status": "draft", "rule": None,
                "section": f"{s} {u['section_title']}", "heading_path": u["heading_path"],
                "part": part_no if len(pieces) > 1 else None,
                "version": rev, "effective_from": rev, "effective_to": None,
                "revision_dates": sorted(u["revs"]),
                "products": infer_products(u["section_title"], piece),
                "segments": ["all"], "tags": tag(piece),
                "source_doc": Path(source).name, "pdf_pages": sorted(u["pages"]),
                "manual_pages": sorted(x for x in u["manual_pages"] if x),
                "text": f"{u['heading_path']}\n{piece}",
            })
    return chunks


def main(pdf_path: str, out_dir: str = "out", code: str = "CPM") -> None:
    Path(out_dir).mkdir(parents=True, exist_ok=True)
    pages = read_pages(pdf_path)
    chunks = build_chunks(pages, pdf_path, code)
    with open(Path(out_dir) / "draft_chunks.jsonl", "w", encoding="utf-8") as f:
        for c in chunks:
            f.write(json.dumps(c, ensure_ascii=False) + "\n")
    lens = sorted(len(c["text"]) for c in chunks)
    lines = [f"pages read: {len(pages)}   chunks: {len(chunks)}",
             f"chunk size chars: min {lens[0]}  median {lens[len(lens)//2]}  max {lens[-1]}",
             f"chunks tagged housing_loan: {sum('housing_loan' in c['tags'] for c in chunks)}",
             f"chunks tagged risk_criteria: {sum('risk_criteria' in c['tags'] for c in chunks)}",
             f"pages with no section header (cover / contents): {[p['pdf_page'] for p in pages if not p['section_no']]}",
             f"pages with no parsed revision date: {[p['pdf_page'] for p in pages if not p['revision_date']]}"]
    (Path(out_dir) / "report.txt").write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="Policy PDF -> draft chunks (JSONL)")
    ap.add_argument("pdf")
    ap.add_argument("--out", default="out", help="output folder (use one per document)")
    ap.add_argument("--code", default="CPM", help="short id prefix for this document, e.g. CPM, CCD, RED")
    a = ap.parse_args()
    main(a.pdf, a.out, a.code)
