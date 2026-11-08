"""Plain-text summary of a check result. Deterministic template (no LLM): the bank's policy text and
applicant figures never leave your environment. An LLM can be added later behind this same function."""
from __future__ import annotations


def explain(result: dict) -> str:
    lines = [f"MRAC check: {result['overall']} ({result['criteria_evaluated']} criteria evaluated, "
             f"{len(result.get('manual_checks', []))} to verify from documents)"]
    for r in result["criteria"]:
        if r["status"] != "pass":
            extra = f" ({r['reason']})" if r["reason"] else ""
            lines.append(f"- {r['label']}: {r['status'].upper()}, value {r['value']} vs {r['threshold']}{extra}")
    for s in result.get("suggested_exceptions", []):
        for c in s["citations"][:1]:
            lines.append(f"  possible exception clause for '{s['policy']}': {c['heading_path']} (manual p. {', '.join(c['manual_pages'] or []) or '?'})")
    for m in result.get("manual_checks", []):
        lines.append(f"  verify: {m['label']}: {m['prompt']}")
    for n in result.get("notes", []):
        lines.append(f"note: {n}")
    return "\n".join(lines)
