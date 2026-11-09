"""A plain-language justification of a check result, built deterministically from the rule outcomes and the policy
clauses they cite. No LLM: every sentence is a template filled with numbers from the facts and text from the policy.

It is a reading of the written policy for the Credit Officer, NOT a credit decision. It never says "approve" or "decline":
exceptions and below-score cases are decided by the delegated approving body (Operations Manual s.VII.D)."""
from __future__ import annotations

RATIO_FIELDS = {"dbr", "lcr", "dbr_standalone"}
MONEY_FIELDS = {"total_gross_income", "loan_amount", "amortization", "collateral_value", "net_income_after_tax", "existing_monthly_debt"}
UNITS = {"borrower_count": " borrower(s)", "tenure_years": " year(s)", "business_years": " year(s)", "age": " years old",
         "age_at_maturity": " years old", "scorecard_total": " points"}
WORDS = {"<=": "at most", ">=": "at least", "<": "below", ">": "above", "==": "exactly", "!=": "anything but",
         "in": "one of", "not_in": "none of"}
DISCLAIMER = ("This is a rules-based reading of the bank's written policy to help the Credit Officer. It is not a credit "
              "decision: only the delegated approving body approves or declines, and exceptions need its approval.")


def fmt_value(field: str, v) -> str:
    if v is None:
        return "not available"
    if isinstance(v, bool):
        return "yes" if v else "no"
    if isinstance(v, (int, float)):
        if field in RATIO_FIELDS:
            return f"{v * 100:.1f}%".replace(".0%", "%")
        if field in MONEY_FIELDS:
            return f"PHP {v:,.0f}"
        return (f"{v:,.0f}" if abs(v) >= 1000 else f"{v:g}") + UNITS.get(field, "")
    return str(v)


def fmt_requirement(field: str, threshold: str | None) -> str:
    """'<= 0.4' -> 'at most 40%';  'in [A, B]' -> 'one of [A, B]'."""
    if not threshold:
        return ""
    op, _, rest = threshold.partition(" ")
    if rest.startswith("["):
        return f"{WORDS.get(op, op)} {rest}"
    try:
        return f"{WORDS.get(op, op)} {fmt_value(field, float(rest))}"
    except ValueError:
        return f"{WORDS.get(op, op)} {rest}"


def _where(source: dict | None) -> str | None:
    if not source:
        return None
    pages = source.get("manual_pages") or []
    return f"{source.get('heading_path')}" + (f", p. {', '.join(pages)}" if pages else "")


def _point(r: dict) -> dict:
    label, req, val = r["label"], fmt_requirement(r["field"], r["threshold"]), fmt_value(r["field"], r["value"])
    if r["status"] == "pass":
        text = f"{label}: {val}. Meets the requirement" + ("." if r["threshold"].startswith(("in ", "not_in ")) else f" ({req}).")
    elif r["status"] == "fail":
        text = f"{label}: {val}. The requirement is {req}. Not met" + (" (a mandatory criterion)." if r["hard_stop"] else ".")
    elif r["value"] is not None:
        text = f"{label}: {val} is close to the requirement ({req}), so it cannot be called either way ({r['reason']})."
    else:
        text = f"{label}: cannot be confirmed ({r['reason']})."
    return {"code": r["code"], "label": label, "status": r["status"], "text": text,
            "citation": _where(r.get("source")) or r.get("source_ref")}


def build(results: list[dict], manual: list[dict], approval: list[dict]) -> dict:
    fails = [r for r in results if r["status"] == "fail"]
    unclear = [r for r in results if r["status"] == "needs_review"]
    hard = [r for r in fails if r["hard_stop"]]
    if hard:
        rec, head = "MANDATORY_CRITERION_NOT_MET", (f"Does not meet {len(hard)} mandatory criterion"
                                                    f"{'s' if len(hard) > 1 else ''}: " + "; ".join(r["label"] for r in hard) + ".")
    elif fails:
        rec, head = "EXCEPTION_REQUIRED", (f"Does not meet {len(fails)} of {len(results)} criteria checked. "
                                           "To proceed it needs an exception approved by the delegated approving body.")
    elif unclear:
        rec, head = "CANNOT_CONCLUDE", (f"Cannot conclude yet: {len(unclear)} criteri{'on needs' if len(unclear) == 1 else 'a need'} "
                                        "data or review. Nothing checked so far fails.")
    elif results:
        rec, head = "MEETS_AUTOMATED_CRITERIA", f"Meets all {len(results)} automatic criteria checked."
    else:
        rec, head = "NO_AUTOMATIC_CRITERIA", "No automatic criteria apply to this application yet."

    steps = []
    if fails:
        steps.append("Record each unmet criterion in V. Exception/s with a mitigant. A deviation from policy is routed to a higher approval level.")
    if any(r["code"] == "POLICY-SCORE-ACCEPTABLE" and r["status"] == "fail" for r in results):
        steps.append("A credit score below the acceptable score is itself an exception, subject to the delegated approving body (Operations Manual, Credit Risk Rating).")
    if unclear:
        steps.append("Provide or confirm: " + "; ".join(f"{r['label']} ({r['reason']})" for r in unclear) + ".")
    if manual:
        steps.append("Verify from the documents: " + "; ".join(m["label"] for m in manual) + ".")
    if rec == "MEETS_AUTOMATED_CRITERIA":
        steps.append("No deviation is needed under the automatic criteria. Complete the document verifications.")

    newest_first = sorted(approval, key=lambda c: c.get("revision_date") or "", reverse=True)
    note = None
    if len({c.get("document") for c in newest_first}) > 1:
        note = ("These passages come from different documents (dates shown). When they differ, the most recently revised one "
                "normally governs: confirm with credit policy.")
    return {"recommendation": rec, "headline": head, "points": [_point(r) for r in results], "next_steps": steps,
            "approval_path": {"passages": newest_first, "note": note}, "disclaimer": DISCLAIMER}
