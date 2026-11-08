"""Orchestration for the two kinds of run the worker handles. No database or network here: the retriever
and criteria are passed in, so this is the same code offline, in tests and in production."""
from __future__ import annotations

from .explain import explain
from .rules_engine import evaluate, overall

ENGINE_VERSION = "0.1.0"
# Always shown with a check, even before any MRAC criteria are enabled: proves retrieval over the manual.
DEFAULT_CONTEXT_QUERIES = [
    "housing loan approving authority limits",
    "mortgage redemption insurance requirement housing loan",
]


def cite(hit: dict, max_chars: int = 2500) -> dict:
    """Chunks are built to stay under ~2,000 characters, so the whole clause is kept; the cap is only a safety net."""
    return {"chunk_key": hit.get("chunk_key"), "heading_path": hit.get("heading_path"),
            "manual_pages": hit.get("manual_pages") or [], "revision_date": hit.get("revision_date"),
            "status": hit.get("status"), "excerpt": (hit.get("text") or "")[:max_chars]}


def check(facts: dict, criteria: list[dict], retriever, *, on: str | None = None,
          context_queries: list[str] | None = None) -> dict:
    pairs = [(c, evaluate(c, facts)) for c in criteria]
    not_applicable = [r["code"] for _, r in pairs if r["status"] == "not_applicable"]
    live = [(c, r) for c, r in pairs if r["status"] != "not_applicable"]

    # the policy clause each criterion comes from (shown next to anything that is not a clean pass)
    wanted = [c["source_chunk_key"] for c, r in live if c.get("source_chunk_key") and r["status"] != "pass"]
    sources = {h["chunk_key"]: cite(h) for h in (retriever.fetch(wanted) if wanted else [])}
    for c, r in live:
        r["source"] = sources.get(c.get("source_chunk_key")) if r["status"] != "pass" else None

    results = [r for _, r in live if r["status"] != "manual"]
    manual = [{"code": r["code"], "label": r["label"], "prompt": r["reason"], "source": r["source"]}
              for _, r in live if r["status"] == "manual"]

    suggested = []
    for c, r in live:
        if r["status"] == "fail":       # a failed criterion = a possible deviation: surface exception clauses
            term = c.get("search_hint") or r["label"]
            hits = retriever.search(term, top_k=2, tags=["exception"], on=on)     # the tag filter already limits it to exception clauses
            suggested.append({"policy": f"{r['label']} ({r['threshold']})", "exception_recommendation": "",
                              "mitigant": "", "criterion": r["code"], "citations": [cite(h) for h in hits]})

    # General policy passages only when no automatic criterion was evaluated (otherwise each result already shows its own
    # clause and exception suggestions, and fixed generic searches would just add loosely related text)
    if context_queries is None:
        context_queries = DEFAULT_CONTEXT_QUERIES if not results else []
    context, seen = [], set()
    for q in context_queries:
        for h in retriever.search(q, top_k=2, on=on):
            if h.get("chunk_key") not in seen:
                seen.add(h.get("chunk_key"))
                context.append(cite(h))

    notes = []
    if not any(r["status"] in ("pass", "fail", "needs_review") for r in results):
        notes.append("No automatic MRAC criteria are enabled or applicable (table mrac_criteria). Showing policy passages only.")
    if any(r.get("is_example") for r in results):
        notes.append("Some criteria are EXAMPLES, not approved policy. Enable real criteria after credit policy review.")
    if any((x or {}).get("status") == "draft" for x in context + list(sources.values())):
        notes.append("Policy passages are unreviewed drafts extracted from the bank's documents.")

    out = {"schema": 1, "kind": "CHECK", "overall": overall(results), "criteria_evaluated": len(results),
           "criteria": results, "manual_checks": manual, "not_applicable": not_applicable,
           "has_deviation_suggested": bool(suggested), "suggested_exceptions": suggested,
           "policy_context": context, "notes": notes, "engine": ENGINE_VERSION}
    out["explanation"] = explain(out)
    return out


def ask(question: str, retriever, *, on: str | None = None, top_k: int = 5) -> dict:
    hits = retriever.search(question, top_k=top_k, on=on)
    return {"schema": 1, "kind": "ASK", "question": question, "passages": [cite(h) for h in hits],
            "notes": ["Extractive answer: the most relevant policy passages, no generated text."], "engine": ENGINE_VERSION}
