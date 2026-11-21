"""Run the policy recommender once on a profile file against the live policy index, print what it found, save nothing.
Calls the Claude API (billed). Uses the enabled criteria from mrac_criteria.

    python tools/recommend_dryrun.py                         # samples/profile_sample.json (fictional)
    python tools/recommend_dryrun.py path/to/profile.json --json out/dryrun.json
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("profile", nargs="?", default=str(ROOT / "samples" / "profile_sample.json"))
    p.add_argument("--json", help="also write the full recommendations here (keep it in out/: it holds policy text)")
    a = p.parse_args()

    from supabase import create_client
    from mrac.config import get_settings
    from mrac.embeddings import get_embedder
    from mrac.judge import get_judge
    from mrac.retrieval import SupabaseRetriever, check_index, get_reranker
    from mrac.service import check
    import worker

    data = json.loads(Path(a.profile).read_text(encoding="utf-8"))
    s = get_settings()
    client, embedder = create_client(s.supabase_url, s.service_key), get_embedder(s)
    check_index(client, embedder)
    judge = get_judge()
    if judge is None:
        raise SystemExit("Set ANTHROPIC_API_KEY in mrac-service/.env")
    retriever = SupabaseRetriever(client, embedder, s.include_draft, reranker=get_reranker(s))
    t = time.time()
    out = check(data["facts"], worker.load_criteria(client), retriever, on=time.strftime("%Y-%m-%d"),
                profile=data["profile"], judge=judge)
    rec = out["recommendations"]
    print(f"\n{time.time() - t:.0f}s | rules: {out['overall']} | recommender: {rec['status']} | {rec.get('model')} | "
          f"tokens in {rec.get('input_tokens')} out {rec.get('output_tokens')} | clauses checked {rec.get('checked')}")
    if rec["status"] != "DONE":
        print(rec.get("reason"))
        return
    print(f"summary: {rec['summary']}\ncounts: {rec['counts']}\nexception needed for approval: {rec['approval']['with_exception']}\n")
    for g in ("exception", "obtain", "condition", "met"):
        print(f"== {g.upper()} ({len(rec['groups'][g])})")
        for f in rec["groups"][g]:
            print(f"  - [{f['chunk_key']}] {f['requirement']}\n      {f['finding']}"
                  + (f"\n      → {f['suggested_action']}" if f["suggested_action"] else "")
                  + (f"\n      notes: {f['notes']}" if f["notes"] else ""))
    print(f"\n== NOT APPLICABLE ({len(rec['not_applicable'])}): {', '.join(x['chunk_key'] for x in rec['not_applicable'])}")
    print(f"== UNVERIFIED ({len(rec['unverified'])})")
    for u in rec["unverified"]:
        print(f"  - [{u.get('chunk_key')}] {u.get('status')}: {'; '.join(u['problems'])}\n      {u.get('finding')}")
    if a.json:
        Path(a.json).parent.mkdir(parents=True, exist_ok=True)
        Path(a.json).write_text(json.dumps(rec, indent=2, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
