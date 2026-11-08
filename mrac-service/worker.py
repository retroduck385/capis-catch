"""CATCH MRAC / policy-RAG worker. Claims queued runs from Supabase (same pattern as ocr-service), runs the
deterministic MRAC checks + policy retrieval, and saves the result on the run.

  python worker.py                      poll the queue every 5 s (Ctrl+C to stop)
  python worker.py --once               process what's queued now, then exit

Offline (no database, no keys): BM25 over a chunks file, criteria from a JSON file; prints the result.
  python worker.py --offline --facts samples/facts_deviation.json --include-disabled
  python worker.py --offline --ask "who must the mortgage redemption insurance cover"
"""
from __future__ import annotations

import argparse
import json
import time
from datetime import datetime, timezone
from pathlib import Path

from mrac.rules_engine import normalize
from mrac.service import ENGINE_VERSION, ask, check

ROOT = Path(__file__).resolve().parent


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_criteria(client) -> list[dict]:
    rows = client.table("mrac_criteria").select("*").eq("enabled", True).execute().data or []
    return [normalize(r) for r in rows]


def process(client, job: dict, retriever, engine: str) -> None:
    run_id = job["run_id"]
    print(f"run {run_id}: {job['run_kind']} ...", flush=True)
    try:
        if job["run_kind"] == "CHECK":
            result = check(job["run_facts"] or {}, load_criteria(client), retriever, on=now()[:10])
        else:
            result = ask(job["run_question"] or "", retriever, on=now()[:10])
        client.table("mrac_runs").update({"status": "DONE", "result": result, "engine": engine,
                                          "finished_at": now()}).eq("id", run_id).execute()
        print(f"run {run_id}: done", flush=True)
    except Exception as e:  # keep the worker alive; the error is saved on the run
        client.table("mrac_runs").update({"status": "FAILED", "engine": engine, "finished_at": now(),
                                          "error": str(e)[:2000]}).eq("id", run_id).execute()
        print(f"run {run_id}: FAILED: {e}", flush=True)


def work(once: bool, interval: float) -> None:
    from supabase import create_client
    from mrac.config import get_settings
    from mrac.embeddings import get_embedder
    from mrac.retrieval import SupabaseRetriever

    s = get_settings()
    if not s.supabase_url or not s.service_key:
        raise SystemExit("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in mrac-service/.env")
    client, embedder = create_client(s.supabase_url, s.service_key), get_embedder(s)
    retriever = SupabaseRetriever(client, embedder, s.include_draft)
    engine = f"mrac-rag/{ENGINE_VERSION}; embeddings={embedder.name}"
    print("MRAC worker started" + ("" if once else f", polling every {interval}s"), flush=True)
    while True:
        jobs = client.rpc("claim_mrac_runs", {"p_limit": 1}).execute().data or []
        for job in jobs:
            process(client, job, retriever, engine)
        if not jobs:
            if once:
                return
            time.sleep(interval)


def offline(args) -> None:
    from mrac.retrieval import LocalRetriever
    retriever = LocalRetriever.from_jsonl(args.chunks)
    if args.ask:
        print(json.dumps(ask(args.ask, retriever), indent=2, ensure_ascii=False))
        return
    facts = json.loads(Path(args.facts).read_text(encoding="utf-8"))
    criteria = [normalize(r) for r in json.loads(Path(args.rules).read_text(encoding="utf-8"))
                if args.include_disabled or r.get("enabled")]
    result = check(facts, criteria, retriever)
    print(result["explanation"] + "\n")
    print(json.dumps({k: v for k, v in result.items() if k != "explanation"}, indent=2, ensure_ascii=False))


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--once", action="store_true", help="process the current queue, then exit")
    p.add_argument("--interval", type=float, default=5, help="seconds between polls (default 5)")
    p.add_argument("--offline", action="store_true", help="no database: use --chunks / --rules files")
    p.add_argument("--facts", default=str(ROOT / "samples" / "facts_deviation.json"))
    p.add_argument("--ask", help="offline: ask the policy a question")
    p.add_argument("--chunks", default=str(ROOT / "samples" / "policy_chunks_synthetic.jsonl"))
    p.add_argument("--rules", default=str(ROOT / "rules" / "housing_raac_draft.json"))
    p.add_argument("--include-disabled", action="store_true", help="offline: also evaluate enabled=false example rules")
    args = p.parse_args()
    try:
        offline(args) if args.offline else work(args.once, args.interval)
    except KeyboardInterrupt:
        print("stopped")


if __name__ == "__main__":
    main()
