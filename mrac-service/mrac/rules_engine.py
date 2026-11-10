"""Deterministic MRAC checks. Pure Python, no I/O. Facts come from the app (the same numbers the Financial
Package already computes), so nothing is recalculated here. Numbers are never produced by an LLM.

A criterion is one of:
  auto    field <op> threshold, optionally only `applies_when` all conditions hold (e.g. income tiers by loan amount)
  manual  a document / credit-investigation judgement: no machine rule, listed for the underwriter to verify
ops: <= >= < >  (numeric)   == != in not_in  (any value).  Status: pass | fail | needs_review | manual | not_applicable.
options: borderline_pct (numeric ops, default 5%), fail_values (op 'in': values that FAIL; other unlisted values
         are 'needs_review' because the policy list does not name them).
"""
from __future__ import annotations

OPS = {
    "<=": lambda a, b: a <= b, ">=": lambda a, b: a >= b, "<": lambda a, b: a < b, ">": lambda a, b: a > b,
    "==": lambda a, b: a == b, "!=": lambda a, b: a != b,
    "in": lambda a, b: a in b, "not_in": lambda a, b: a not in b,
}
NUMERIC_OPS = {"<=", ">=", "<", ">"}
DEFAULT_BORDERLINE_PCT = 0.05     # numeric ops: within 5% of the threshold (either side) -> needs_review


def _num(v):
    if v is None or isinstance(v, bool):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _threshold(op: str, value):
    if op in ("in", "not_in"):
        return list(value)
    return float(value) if op in NUMERIC_OPS else value


def normalize(row: dict) -> dict:
    """A mrac_criteria row (or an entry of rules/*.json) -> the shape evaluate() uses."""
    options = dict(row.get("options") or {})
    if row.get("borderline_pct") is not None:                       # older column name
        options.setdefault("borderline_pct", float(row["borderline_pct"]))
    manual = row.get("check_type") == "manual"
    when = [{"field": c["field"], "op": c["op"], "value": _threshold(c["op"], c["value"])}
            for c in (row.get("applies_when") or [])]
    return {
        "code": row["code"], "label": row.get("label") or row["code"], "section": row.get("section"),
        "check_type": "manual" if manual else "auto",
        "field": row.get("field"), "op": row.get("op"),
        "threshold": None if manual else _threshold(row["op"], row["threshold"]),
        "applies_when": when, "options": options, "prompt": row.get("prompt"),
        "hard_stop": bool(row.get("hard_stop")), "is_example": bool(row.get("is_example")),
        "search_hint": row.get("search_hint"),                      # the policy's own wording, to find exception clauses
        "source_chunk_key": row.get("source_chunk_key"), "source_chunk_id": row.get("source_chunk_id"),
    }


def _compare(op: str, raw, threshold):
    """True / False, or None when a numeric comparison cannot be made (missing or not a number)."""
    if op in NUMERIC_OPS:
        val = _num(raw)
        return None if val is None else OPS[op](val, threshold)
    return OPS[op](raw, threshold)


def _applies(crit: dict, facts: dict):
    """(True, '') | (False, '') | (None, reason) when a condition's fact is missing."""
    for c in crit["applies_when"]:
        raw = facts.get(c["field"])
        if raw is None:
            return None, f"cannot tell whether this applies: missing {c['field']}"
        ok = _compare(c["op"], raw, c["value"])
        if ok is None:
            return None, f"cannot tell whether this applies: {c['field']} is not a number"
        if not ok:
            return False, ""
    return True, ""


def _show(op, th) -> str:
    if isinstance(th, list):
        return f"{op} [{', '.join(str(x) for x in th)}]"
    return f"{op} {th:g}" if isinstance(th, float) else f"{op} {th}"


def evaluate(crit: dict, facts: dict) -> dict:
    base = {"code": crit["code"], "label": crit["label"], "check_type": crit["check_type"], "field": crit["field"],
            "threshold": None if crit["check_type"] == "manual" else _show(crit["op"], crit["threshold"]),
            "hard_stop": crit["hard_stop"], "is_example": crit.get("is_example", False),
            "source_chunk_key": crit.get("source_chunk_key"), "source_chunk_id": crit.get("source_chunk_id")}
    applies, why = _applies(crit, facts)
    if applies is False:
        return {**base, "value": None, "status": "not_applicable", "reason": ""}
    if applies is None:
        return {**base, "value": None, "status": "needs_review", "reason": why}
    if crit["check_type"] == "manual":
        return {**base, "value": None, "status": "manual", "reason": crit.get("prompt") or ""}

    op, th, raw = crit["op"], crit["threshold"], facts.get(crit["field"])
    if raw is None:
        return {**base, "value": None, "status": "needs_review", "reason": f"missing data: {crit['field']}"}
    if op in NUMERIC_OPS:
        val = _num(raw)
        if val is None:
            return {**base, "value": raw, "status": "needs_review", "reason": f"{crit['field']} is not a number"}
        pct = crit["options"].get("borderline_pct", DEFAULT_BORDERLINE_PCT)
        if pct > 0 and th != 0 and abs(val - th) / abs(th) <= pct:
            return {**base, "value": round(val, 4), "status": "needs_review", "reason": f"within {pct:.0%} of the threshold"}
        return {**base, "value": round(val, 4), "status": "pass" if OPS[op](val, th) else "fail", "reason": ""}
    ok = OPS[op](raw, th)
    if not ok and op == "in" and crit["options"].get("fail_values") is not None and raw not in crit["options"]["fail_values"]:
        return {**base, "value": raw, "status": "needs_review",
                "reason": "value is not named in the policy list: confirm with credit policy"}
    return {**base, "value": raw, "status": "pass" if ok else "fail", "reason": ""}


def overall(results: list[dict]) -> str:
    """Only automatic results count: manual checks and not-applicable rules never change the outcome."""
    active = [r for r in results if r["status"] in ("pass", "fail", "needs_review")]
    if not active:
        return "NO_RULES"
    if any(r["status"] == "fail" for r in active):
        return "FAIL"
    if any(r["status"] == "needs_review" for r in active):
        return "REVIEW"
    return "PASS"
