"""Policy recommender: which bank policies does this application trigger, and what should the Credit Officer do?

    traits()     what about the application turns policies on (OFW, loan above 3M, CI findings ...), from the profile
    gather()     the clauses to judge: pinned (RAAC + housing section), the rules' own clauses, trait searches
    judge(...)   passed in (mrac/judge.py calls Claude): reads every clause against the application
    verify()     code checks every finding: the clause was given, the quote is in it word for word, the facts it names
                 exist, every number is in the application or the clause, and it agrees with the deterministic rules
    assemble()   groups for the CO: exceptions needed, documents / information to obtain, conditions for the T&Cs, met

Nothing here decides: the result is a set of proposals the CO accepts, edits or dismisses. No database or network here
(the retriever and judge are passed in), so tests run offline."""
from __future__ import annotations

import json
import re
from pathlib import Path

from .reasoning import fmt_requirement, fmt_value

ROOT = Path(__file__).resolve().parent.parent
TRIGGERS_FILE = ROOT / "rules" / "triggers.json"
HOUSING = ["housing_purchase"]
SCHEMA_VERSION = 1

STATUSES = ("met", "not_met", "needs_info", "condition", "not_applicable")
ACTIONS = ("exception", "obtain", "condition", "note", "none")
GROUPS = ("exception", "obtain", "condition", "met")

EMPLOYMENT_LABELS = {
    "LOCALLY_EMPLOYED": "locally employed", "LICENSED_PROFESSIONAL": "a licensed professional", "SEAFARER": "a seafarer",
    "VIRTUAL_ASSISTANT": "a virtual assistant", "COMMISSION_BASED": "commission-based", "OFW": "an OFW",
    "SELF_EMPLOYED": "self-employed", "RENTAL_BUSINESS": "earning from rentals", "PUV_OPERATOR": "a PUV operator",
    "PENSIONER": "a pensioner", "UNEMPLOYED": "without employment",
}


def load_triggers(path: Path | str | None = None) -> dict:
    return json.loads(Path(path or TRIGGERS_FILE).read_text(encoding="utf-8"))


# ---------------------------------------------------------------- traits
def _add(out: dict, trait: str, why: str) -> None:
    out[trait] = f"{out[trait]}; {why}" if trait in out and why not in out[trait] else out.get(trait, why)


def traits(profile: dict | None, facts: dict, results: list[dict]) -> dict[str, str]:
    """trait -> why it holds, in plain words (shown with every clause the trait brought in)."""
    profile = profile or {}
    loan = profile.get("loan") or {}
    out = {"always": "every housing loan file"}
    amount = loan.get("amount") if loan.get("amount") is not None else facts.get("loan_amount")
    if isinstance(amount, (int, float)):
        if amount > 3_000_000:
            _add(out, "loan_over_3m", f"loan amount {fmt_value('loan_amount', amount)}")
        if amount > 10_000_000:
            _add(out, "loan_over_10m", f"loan amount {fmt_value('loan_amount', amount)}")
    for b in profile.get("borrowers") or []:
        role = b.get("role") or "A borrower"
        et = b.get("employment_type")
        if et:
            _add(out, f"employment:{et}", f"{role} is {EMPLOYMENT_LABELS.get(et, et)}")
        if b.get("lives_abroad") is True:
            _add(out, "lives_abroad", f"{role} lives abroad")
        if b.get("filipino_citizen") is False:
            _add(out, "non_filipino", f"{role} is not a Filipino citizen")
        if b.get("civil_status") == "MARRIED" or role == "Spouse":
            _add(out, "married", "the principal is married" if role in ("Principal", "Spouse") else f"{role} is married")
    others = profile.get("other_parties") or {}
    if others.get("attorney_in_fact"):
        _add(out, "attorney_in_fact", "an attorney-in-fact is on the file")
    if others.get("mortgagor"):
        _add(out, "mortgagor", "a third-party mortgagor is on the file")
    if loan.get("from_developer") or str(loan.get("referral_channel") or "").upper() == "DEVELOPER":
        _add(out, "from_developer", "referred by a developer")
    if "condo" in str(loan.get("property_type") or "").lower():
        _add(out, "property:condominium", "the collateral is a condominium unit")
    ci = profile.get("ci") or {}
    for c in ci.get("borrowers") or []:
        bad = [k.upper() for k in ("nfis", "tu", "bras") if c.get(k) == "WITH_FINDINGS"]
        if bad:
            _add(out, "ci_findings", f"{c.get('role')}: {', '.join(bad)} with findings")
    if ci.get("findings_flagged"):
        _add(out, "ci_findings", "the CI flagged findings")
    for d in (profile.get("documents") or {}).get("borrowers") or []:
        missing = [r["requirement"] for r in d.get("required") or [] if not r.get("files")]
        redo = [r["requirement"] for r in d.get("required") or [] if r.get("needs_new_copy")]
        if missing:
            _add(out, "documents_incomplete", f"{d.get('role')}: no file for {', '.join(missing)}")
        if redo:
            _add(out, "documents_incomplete", f"{d.get('role')}: new copy needed for {', '.join(redo)}")
    failed = [r["code"] for r in results if r.get("status") == "fail"]
    if failed:
        _add(out, "rule_failed", f"not met: {', '.join(failed)}")
    return out


# ---------------------------------------------------------------- candidates
def _candidate(hit: dict, why: str) -> dict:
    return {"chunk_key": hit.get("chunk_key"), "document": hit.get("document"), "heading_path": hit.get("heading_path"),
            "manual_pages": hit.get("manual_pages") or [], "revision_date": hit.get("revision_date"),
            "status": hit.get("status"), "text": hit.get("text") or "", "brought_in_by": [why]}


def gather(retriever, triggers: dict, trait_map: dict[str, str], pairs: list[tuple[dict, dict]],
           on: str | None = None) -> list[dict]:
    """Pinned clauses first, then the clauses the evaluated rules come from, then trait searches until the cap."""
    found: dict[str, dict] = {}

    def add(hit: dict, why: str) -> bool:
        key = hit.get("chunk_key")
        if not key:
            return False
        if key in found:
            if why not in found[key]["brought_in_by"]:
                found[key]["brought_in_by"].append(why)
            return False
        found[key] = _candidate(hit, why)
        return True

    pin = triggers.get("pin") or {}
    pinned = (retriever.fetch_prefixed(pin.get("prefixes") or []) if pin.get("prefixes") else []) \
        + (retriever.fetch(pin.get("keys") or []) if pin.get("keys") else [])
    for h in pinned:
        add(h, pin.get("label") or "always checked")

    wanted = {c.get("source_chunk_key"): f"Rule {c['code']}" for c, r in pairs
              if c.get("source_chunk_key") and r.get("status") != "not_applicable"}
    for h in retriever.fetch(list(wanted)) if wanted else []:
        add(h, wanted[h["chunk_key"]])

    cap = int(triggers.get("max_candidates") or 34)
    top_k = int(triggers.get("top_k") or 3)
    for t in triggers.get("triggers") or []:
        if t.get("when") not in trait_map:
            continue
        why = f"{t['label']} ({trait_map[t['when']]})"
        for q in t.get("queries") or []:
            for h in retriever.search(q, top_k=top_k, on=on, products=HOUSING):
                if len(found) >= cap and h.get("chunk_key") not in found:
                    break
                add(h, why)
    return list(found.values())


# ---------------------------------------------------------------- the judge's input
def _rule_view(r: dict) -> dict:
    return {"code": r["code"], "label": r["label"], "status": r["status"], "value": fmt_value(r.get("field"), r.get("value")),
            "requirement": fmt_requirement(r.get("field"), r.get("threshold")), "clause": r.get("source_chunk_key")}


def judge_payload(profile: dict | None, facts: dict, results: list[dict], candidates: list[dict],
                  trait_map: dict[str, str]) -> dict:
    """Exactly what the judge is given (saved with the result for the audit trail, minus the clause texts)."""
    return {
        "application": profile or {},
        "facts": {k: v for k, v in facts.items() if k != "schema"},
        "rule_results": [_rule_view(r) for r in results if r.get("status") in ("pass", "fail", "needs_review")],
        "application_traits": trait_map,
        "passages": [{"chunk_key": c["chunk_key"], "document": c["document"], "heading": c["heading_path"],
                      "pages": c["manual_pages"], "revision_date": c["revision_date"], "brought_in_by": c["brought_in_by"],
                      "text": c["text"]} for c in candidates],
    }


# ---------------------------------------------------------------- verification
_QUOTES = str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", " ": " "})


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").translate(_QUOTES).lower()).strip(" .,;:\"'")


def quote_in(quote: str, text: str) -> bool:
    """The quote, or each part of it around an ellipsis (8+ characters), appears in the clause in order."""
    body = _norm(text)
    parts = [p for p in (_norm(x) for x in re.split(r"\.\.\.|…", quote or "")) if len(p) >= 8]
    if not parts:
        return False
    at = 0
    for p in parts:
        i = body.find(p, at)
        if i < 0:
            return False
        at = i + len(p)
    return True


def resolve(path: str, profile: dict, facts: dict):
    """'borrowers[1].employment_type', 'loan.amount', 'facts.dbr' or 'dbr' -> (True, value) / (False, None)."""
    path = (path or "").strip()
    if not path:
        return False, None
    if re.match(r"^(rule_results|application_traits)(\b|\[|\.)", path):
        return True, None                              # other parts of what the judge was given
    if path.startswith("facts."):
        key = path[6:]
        return (key in facts), facts.get(key)
    if path.startswith("application."):
        path = path[12:]
    cur = profile
    for part in re.findall(r"[^.\[\]]+|\[\d+\]", path):
        if part.startswith("["):
            i = int(part[1:-1])
            if not isinstance(cur, list) or i >= len(cur):
                break
            cur = cur[i]
        elif isinstance(cur, dict) and part in cur:
            cur = cur[part]
        else:
            break
    else:
        return True, cur
    return (path in facts), facts.get(path)


_DATE = re.compile(r"\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b")
_KEY = re.compile(r"\b[A-Z]{2,}(?:-[A-Z0-9]+)+\b")          # chunk keys like CPM-VII-0035, RAAC-HL-11-DEBT-BURDEN-RATIO
_NUM = re.compile(r"(₱|PHP\s?|P(?=\d))?\s?(\d[\d,]*(?:\.\d+)?)\s?(%|M\b|million\b)?", re.I)


def numbers_in(text: str) -> list[tuple[float, str]]:
    """(value, kind) for the numbers worth checking: money, percentages, and plain numbers of 10 or more that are not
    years. kind: money / percent / plain. '3.0M' and '3 million' are read as 3,000,000."""
    out = []
    text = _KEY.sub(" ", _DATE.sub(" ", text or ""))
    for m in _NUM.finditer(text):
        cur, raw, unit = m.group(1), m.group(2).rstrip(".,"), (m.group(3) or "").lower()
        try:
            v = float(raw.replace(",", ""))
        except ValueError:
            continue
        if unit in ("m", "million"):
            out.append((v * 1_000_000, "money"))
        elif unit == "%":
            out.append((v, "percent"))
        elif cur:
            out.append((v, "money"))
        elif v >= 10 and not (1900 <= v <= 2100 and "." not in raw and "," not in raw):
            out.append((v, "plain"))
    return out


def _known_numbers(profile: dict, facts: dict, results: list[dict], text: str, pages: list) -> list[float]:
    vals: list[float] = []

    def walk(key, v):
        if isinstance(v, bool) or v is None:
            return
        if isinstance(v, (int, float)):
            vals.append(float(v))
            if any(k in str(key) for k in ("dbr", "lcr")) or (0 < abs(v) < 1.5 and isinstance(v, float)):
                vals.append(float(v) * 100)                         # ratios are written as percentages
        elif isinstance(v, dict):
            for k, x in v.items():
                walk(k, x)
        elif isinstance(v, list):
            for x in v:
                walk(key, x)
    walk("", profile)
    walk("", facts)
    for r in results:
        for k in ("value", "threshold"):
            walk(r.get("field") or "", r.get(k))
            for n, _ in numbers_in(str(r.get(k) or "")):
                vals.append(n)
    vals += [n for n, _ in numbers_in(text)]
    vals += [float(p) for p in pages if str(p).isdigit()]
    return vals


def _matches(v: float, kind: str, known: list[float]) -> bool:
    tol = (lambda k: 0.15) if kind == "percent" else (lambda k: max(1.0, abs(k) * 0.01))
    return any(abs(v - k) <= tol(k) for k in known)


def _expected_from_rules(key: str, results: list[dict]) -> tuple[str | None, list[dict]]:
    linked = [r for r in results if r.get("source_chunk_key") == key and r.get("status") in ("pass", "fail")]
    if not linked:
        return None, []
    return ("not_met" if any(r["status"] == "fail" for r in linked) else "met"), linked


def verify(raw: list[dict], candidates: list[dict], profile: dict | None, facts: dict,
           results: list[dict]) -> tuple[list[dict], list[dict]]:
    """(kept, unverified). Every kept finding passed the code checks; unverified ones carry why they failed."""
    profile = profile or {}
    by_key = {c["chunk_key"]: c for c in candidates}
    kept, unverified, seen = [], [], set()
    for f in raw or []:
        key = f.get("chunk_key")
        c = by_key.get(key)
        if c is None or key in seen:
            unverified.append({**f, "problems": ["the judge cited a clause it was not given" if c is None
                                                 else "the same clause was judged twice"]})
            continue
        seen.add(key)
        status = f.get("status") if f.get("status") in STATUSES else "needs_info"
        action = f.get("action") if f.get("action") in ACTIONS else "note"
        problems, notes = [], []

        expected, linked = _expected_from_rules(key, results)
        if expected and status != expected:
            notes.append(f"Status set from rule {', '.join(r['code'] for r in linked)} (the judge said {status}).")
            status = expected
        if status == "not_applicable":
            kept.append(_finding(c, f, status, "none", notes))
            continue
        if status == "met" and action in ("exception", "obtain"):
            action = "note"
        if status == "not_met" and action in ("note", "none"):
            action = "exception"
        if status == "condition":
            action = "condition"

        if not quote_in(f.get("quote") or "", c["text"]):
            problems.append("the quoted sentence is not in the clause")
        used = [p for p in f.get("facts_used") or [] if p]
        bad_paths = [p for p in used if not resolve(p, profile, facts)[0]]
        if bad_paths:
            problems.append(f"facts not in the application: {', '.join(bad_paths)}")
        known = _known_numbers(profile, facts, results, c["text"], c["manual_pages"])
        exc = f.get("exception") or {}
        prose = " ".join(str(x or "") for x in (f.get("finding"), f.get("suggested_action"), exc.get("policy"),
                                                 exc.get("recommendation"), exc.get("mitigant")))
        show = lambda v, kind: f"₱{v:,.2f}" if kind == "money" else f"{v:g}%" if kind == "percent" else f"{v:g}"
        stray = [show(v, kind) for v, kind in numbers_in(prose) if not _matches(v, kind, known)]
        if stray:
            problems.append(f"numbers not in the application or the clause: {', '.join(stray)}")
        if problems:
            unverified.append({**_finding(c, f, status, action, notes), "problems": problems})
        else:
            kept.append(_finding(c, f, status, action, notes, [r["code"] for r in linked]))
    return kept, unverified


def _finding(c: dict, f: dict, status: str, action: str, notes: list[str], rule_codes: list[str] | None = None) -> dict:
    exc = f.get("exception") or {}
    return {
        "chunk_key": c["chunk_key"], "document": c["document"], "heading_path": c["heading_path"],
        "manual_pages": c["manual_pages"], "revision_date": c["revision_date"], "chunk_status": c["status"],
        "brought_in_by": c["brought_in_by"], "status": status, "action": action,
        "finding": (f.get("finding") or "").strip(), "requirement": (f.get("requirement") or "").strip(),
        "quote": (f.get("quote") or "").strip(), "facts_used": [p for p in f.get("facts_used") or [] if p],
        "suggested_action": (f.get("suggested_action") or "").strip(),
        "exception": {"policy": (exc.get("policy") or "").strip(), "recommendation": (exc.get("recommendation") or "").strip(),
                      "mitigant": (exc.get("mitigant") or "").strip()} if action == "exception" else None,
        "rule_codes": rule_codes or [], "notes": notes, "excerpt": c["text"],
    }


# ---------------------------------------------------------------- grouping
def assemble(kept: list[dict], unverified: list[dict], candidates: list[dict], trait_map: dict[str, str],
             profile: dict | None, approval_clauses: list[dict], meta: dict) -> dict:
    groups = {g: [] for g in GROUPS}
    not_applicable = []
    order = {c["chunk_key"]: i for i, c in enumerate(candidates)}
    for f in sorted(kept, key=lambda x: (not x["rule_codes"], order.get(x["chunk_key"], 999))):
        if f["status"] == "not_applicable":
            not_applicable.append({"chunk_key": f["chunk_key"], "heading_path": f["heading_path"], "document": f["document"]})
        elif f["action"] == "exception":
            groups["exception"].append(f)
        elif f["action"] == "obtain" or f["status"] == "needs_info":
            groups["obtain"].append(f)
        elif f["action"] == "condition":
            groups["condition"].append(f)
        else:
            groups["met"].append(f)
    recorded = [e for e in (profile or {}).get("exceptions") or [] if any(e.values())]
    reasons = [f["requirement"] or f["heading_path"] for f in groups["exception"]]
    if recorded:
        reasons.append(f"{len(recorded)} exception(s) already recorded in V. Exception/s")
    return {
        "schema": SCHEMA_VERSION, "status": "DONE", **meta,
        "traits": [{"trait": k, "why": v} for k, v in trait_map.items() if k != "always"],
        "checked": len(candidates), "groups": groups, "not_applicable": not_applicable, "unverified": unverified,
        "approval": {"with_exception": bool(groups["exception"] or recorded), "reasons": reasons,
                     "clauses": approval_clauses},
        "counts": {**{g: len(v) for g, v in groups.items()}, "not_applicable": len(not_applicable),
                   "unverified": len(unverified)},
    }


def unavailable(reason: str, trait_map: dict[str, str] | None = None, checked: int = 0) -> dict:
    """The check still saves its rule results; the recommendations part says why it is missing."""
    return {"schema": SCHEMA_VERSION, "status": "UNAVAILABLE", "reason": reason,
            "traits": [{"trait": k, "why": v} for k, v in (trait_map or {}).items() if k != "always"],
            "checked": checked}


def recommend(profile: dict | None, facts: dict, pairs: list[tuple[dict, dict]], results: list[dict], retriever,
              judge, approval_clauses: list[dict], on: str | None = None, triggers: dict | None = None) -> dict:
    trait_map = traits(profile, facts, results)
    if judge is None:
        return unavailable("Recommendations are off: set ANTHROPIC_API_KEY in mrac-service/.env.", trait_map)
    candidates = gather(retriever, triggers or load_triggers(), trait_map, pairs, on=on)
    if not candidates:
        return unavailable("No policy clauses were found to check.", trait_map)
    payload = judge_payload(profile, facts, results, candidates, trait_map)
    try:
        answer = judge(payload)
    except Exception as e:  # noqa: BLE001  the rule results are still saved; this part says why it is missing
        return unavailable(f"The policy recommender could not run: {str(e)[:300]}", trait_map, len(candidates))
    kept, unverified = verify(answer.get("findings") or [], candidates, profile, facts, results)
    meta = {"model": answer.get("model"), "input_tokens": answer.get("input_tokens"),
            "output_tokens": answer.get("output_tokens"), "summary": ""}
    out = assemble(kept, unverified, candidates, trait_map, profile, approval_clauses, meta)
    summary = (answer.get("summary") or "").strip()
    known = _known_numbers(profile or {}, facts, results, " ".join(c["text"] for c in candidates), [])
    known += [float(n) for n in (*out["counts"].values(), out["checked"], len(kept))]
    stray = [f"{v:g}" for v, kind in numbers_in(summary) if not _matches(v, kind, known)]
    if stray:                                         # a figure the code cannot trace: the UI shows the counts instead
        out["summary_dropped"] = {"text": summary, "problem": f"numbers not traced: {', '.join(stray)}"}
    else:
        out["summary"] = summary
    return out
