"""Retrieval snapshot: run a fixed set of housing questions against the live policy_chunks and save the top results,
so a change to embeddings / reranking can be compared before and after. Not a scored test set: you read the two lists
side by side and judge which is better.

    python tools/retrieval_snapshot.py save before            # out/snapshots/before.json
    python tools/retrieval_snapshot.py save after-bge
    python tools/retrieval_snapshot.py compare before after-bge

Snapshots hold chunk keys and headings of the bank's policy, so they live in out/ (gitignored).
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

OUT = ROOT / "out" / "snapshots"
TOP_K = 5
HOUSING = ["housing_purchase"]

QUESTIONS = [
    "maximum debt burden ratio for housing loans",
    "maximum age of the borrower at loan maturity",
    "minimum gross monthly income of the borrower",
    "who must be covered by the mortgage redemption insurance",
    "approving authority for a housing loan with exception",
    "income tax return required for loans above 3 million",
    "special power of attorney for OFW or seafarer borrowers",
    "when is a co-borrower required",
    "how old can the credit investigation report be",
    "acceptable negative NFIS records",
    "minimum years in business for self-employed borrowers",
    "loanable amount as a percentage of the appraised value",
]


def save(label: str) -> None:
    from supabase import create_client
    from mrac.config import get_settings
    from mrac.embeddings import get_embedder
    from mrac.retrieval import SupabaseRetriever, get_reranker

    s = get_settings()
    retriever = SupabaseRetriever(create_client(s.supabase_url, s.service_key), get_embedder(s), s.include_draft,
                                  reranker=get_reranker(s))
    results = {}
    for q in QUESTIONS:
        hits = retriever.search(q, top_k=TOP_K, products=HOUSING)
        results[q] = [{"chunk_key": h["chunk_key"], "document": h["document"], "heading_path": h["heading_path"],
                       "score": h.get("score")} for h in hits]
        print(f"- {q}: {', '.join(h['chunk_key'] for h in hits) or '(nothing)'}", flush=True)
    OUT.mkdir(parents=True, exist_ok=True)
    data = {"label": label, "saved_at": datetime.now(timezone.utc).isoformat(), "embedder": retriever.embedder.name,
            "reranker": retriever.reranker.name if retriever.reranker else None, "results": results}
    (OUT / f"{label}.json").write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"saved out/snapshots/{label}.json")


def compare(a: str, b: str) -> None:
    A, B = (json.loads((OUT / f"{x}.json").read_text(encoding="utf-8")) for x in (a, b))
    print(f"{a}: {A['embedder']} / reranker {A['reranker']}\n{b}: {B['embedder']} / reranker {B['reranker']}\n")
    for q in QUESTIONS:
        ra, rb = A["results"].get(q, []), B["results"].get(q, [])
        print(f"## {q}")
        for i in range(TOP_K):
            x = ra[i] if i < len(ra) else None
            y = rb[i] if i < len(rb) else None
            show = lambda h: f"{h['chunk_key']:<18} {(h['heading_path'] or '')[:44]:<44}" if h else " " * 63
            print(f"  {i + 1}. {show(x)} | {show(y)}")
        print()


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("save").add_argument("label")
    c = sub.add_parser("compare")
    c.add_argument("a")
    c.add_argument("b")
    args = p.parse_args()
    save(args.label) if args.cmd == "save" else compare(args.a, args.b)


if __name__ == "__main__":
    main()
