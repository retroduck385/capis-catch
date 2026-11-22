"""CATCH advise worker: answers the Credit Officer's "Ask AI for a suggestion" requests (credit_ai_suggestions,
20261120_credit_ai_suggestions.sql) with the Claude API (advise.py). For each request it reads the policy check the CO
asked with (the claim returns its result) and the CO's reviews of that check's findings (mrac_finding_reviews), then
saves the suggestion. A failure is tried once more after RETRY_PAUSE seconds; a rate limit puts the request back in the
queue. Without ANTHROPIC_API_KEY requests stay QUEUED (the panel says so).

  python worker.py              wait for requests (Realtime), with a fallback check every 5 min (Ctrl+C to stop)
  python worker.py --poll       check the queue every --interval seconds, no Realtime
  python worker.py --once       process what's queued now, then exit
  python worker.py --show ID    print what suggestion ID would send to Claude (calls nothing, saves nothing)
"""

import argparse
import asyncio
import json
import os
import threading
import time
from pathlib import Path

from dotenv import load_dotenv

from advise import build_request, suggest
from claude import RetryLater, ai_config

RATE_LIMIT_PAUSE = 60     # seconds to leave the queue alone after a Claude API rate limit
RETRY_PAUSE = 10          # seconds before the one automatic retry of a failed request


def get_config():
    load_dotenv(Path(__file__).with_name(".env"))
    url, key = os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise SystemExit("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in advise-service/.env")
    return url.rstrip("/"), key


def get_client(url, key):
    from supabase import create_client

    return create_client(url, key)


def listen_for_requests(url, key, wake):
    """Background thread: sets `wake` whenever a suggestion is requested, and on every (re)subscribe so requests queued
    while disconnected are picked up. If Realtime can't connect, the fallback poll still works."""
    from realtime import AsyncRealtimeClient, RealtimeSubscribeStates

    subscribed_once = False

    def on_status(state, err):
        nonlocal subscribed_once
        if state == RealtimeSubscribeStates.SUBSCRIBED:
            if not subscribed_once:
                print("Realtime: listening for suggestion requests", flush=True)
                subscribed_once = True
            wake.set()
        elif err or state != RealtimeSubscribeStates.CLOSED:
            print(f"Realtime: {state.value}{f' ({err})' if err else ''}; falling back to the slow poll", flush=True)

    async def run():
        client = AsyncRealtimeClient(f"{url}/realtime/v1", key)
        await client.connect()
        channel = client.channel("advise-worker")
        channel.on_postgres_changes("INSERT", schema="public", table="credit_ai_suggestions", callback=lambda _: wake.set())
        await channel.subscribe(on_status)
        await asyncio.Event().wait()

    try:
        asyncio.run(run())
    except Exception as e:
        print(f"Realtime unavailable ({e}); falling back to the slow poll", flush=True)


def with_one_retry(label, attempt):
    """Runs attempt(); if it raises, waits RETRY_PAUSE seconds and runs it once more (the second error is raised).
    RetryLater (rate limit) and ValueError (the request must not be sent / can't be grounded) are never retried here."""
    try:
        return attempt()
    except (RetryLater, ValueError):
        raise
    except Exception as e:
        print(f"{label}: failed ({e}); trying once more in {RETRY_PAUSE}s", flush=True)
        time.sleep(RETRY_PAUSE)
        return attempt()


def fetch_reviews(client, suggestion_id):
    """{chunk_key: {decision, edited}} of the policy check this suggestion was asked with ({} before
    20261122_mrac_reviews.sql is run: every finding then counts as not reviewed)."""
    row = client.table("credit_ai_suggestions").select("mrac_run_id").eq("id", suggestion_id).single().execute().data
    try:
        rows = client.table("mrac_finding_reviews").select("chunk_key, decision, edited").eq("run_id", row["mrac_run_id"]).execute().data
    except Exception as e:
        if not getattr(fetch_reviews, "warned", False):
            print(f"CO reviews not read ({e}); run 20261122_mrac_reviews.sql. Findings count as not reviewed.", flush=True)
            fetch_reviews.warned = True
        return {}
    return {r["chunk_key"]: r for r in rows or []}


def process(client, job, api_key, model):
    """One request. Returns False when the Claude API asked us to slow down."""
    sid = job["suggestion_id"]
    print(f"suggestion {sid}: application {job['application_id']} ...", flush=True)
    try:
        reviews = fetch_reviews(client, sid)
        result = with_one_retry(f"suggestion {sid}", lambda: suggest(job["input"], job["policy"], reviews, api_key, model))
        client.rpc("save_credit_suggestion", {
            "p_id": sid, "p_model": result["model"], "p_sent": result["sent"], "p_output": result["output"],
            "p_input_tokens": result["input_tokens"], "p_output_tokens": result["output_tokens"],
        }).execute()
        out = result["output"]
        print(f"suggestion {sid}: {out['suggested_result']}, {len(out['reasons'])} cited reasons, "
              f"{out['counts']['unreviewed']} unreviewed findings "
              f"({result['input_tokens']} in / {result['output_tokens']} out tokens)", flush=True)
        return True
    except RetryLater as e:
        client.rpc("requeue_credit_suggestion", {"p_id": sid}).execute()
        print(f"suggestion {sid}: {e}; retrying in {RATE_LIMIT_PAUSE}s", flush=True)
        return False
    except Exception as e:  # the error is saved on the request; the panel shows it
        client.rpc("fail_credit_suggestion", {"p_id": sid, "p_error": str(e)[:2000], "p_model": model}).execute()
        print(f"suggestion {sid}: FAILED — {e}", flush=True)
        return True


def claim(client):
    """One queued request, or [] (also when 20261120_credit_ai_suggestions.sql isn't run yet)."""
    try:
        return client.rpc("claim_credit_suggestions", {"p_limit": 1}).execute().data or []
    except Exception as e:
        if not getattr(claim, "warned", False):
            print(f"claim_credit_suggestions() failed ({e}); run 20261120_credit_ai_suggestions.sql", flush=True)
            claim.warned = True
        return []


def work(once, interval, realtime):
    url, key = get_config()
    client = get_client(url, key)
    api_key, model = ai_config()
    if not api_key:
        raise SystemExit("Set ANTHROPIC_API_KEY in advise-service/.env (requests stay QUEUED until then)")
    print(f"AI suggestions on ({model})", flush=True)
    paused_until = 0.0
    wake = threading.Event()
    if once:
        print("Advise worker: processing the current queue", flush=True)
    elif realtime:
        threading.Thread(target=listen_for_requests, args=(url, key, wake), daemon=True).start()
        print(f"Advise worker started, waiting for requests (fallback check every {interval:g}s)", flush=True)
    else:
        print(f"Advise worker started, polling every {interval:g}s", flush=True)

    while True:
        wake.clear()  # cleared before claiming, so a request during processing triggers another pass
        jobs = claim(client) if time.monotonic() >= paused_until else []
        for job in jobs:
            if not process(client, job, api_key, model):
                paused_until = time.monotonic() + RATE_LIMIT_PAUSE
        if not jobs:
            if once:
                return
            pause = max(paused_until - time.monotonic(), 0)
            wake.wait(min(interval, pause) if pause else interval)


def show(suggestion_id):
    """What a request would send, built from the database row (read only)."""
    url, key = get_config()
    client = get_client(url, key)
    row = client.table("credit_ai_suggestions").select("id, input, mrac_run_id").eq("id", suggestion_id).single().execute().data
    run = client.table("mrac_runs").select("result").eq("id", row["mrac_run_id"]).single().execute().data
    sent = build_request(row["input"], run["result"], fetch_reviews(client, suggestion_id))
    print(json.dumps(sent, ensure_ascii=False, indent=2))
    print(f"\n{len(sent['findings'])} findings, {len(sent['dismissed'])} dismissed, "
          f"{sum(f.get('review') == 'NOT_REVIEWED' for f in sent['findings'])} not reviewed", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--once", action="store_true", help="process the current queue, then exit")
    parser.add_argument("--poll", action="store_true", help="poll only, no Realtime (default interval then 5 s)")
    parser.add_argument("--interval", type=float, help="seconds between queue checks (default 300, or 5 with --poll)")
    parser.add_argument("--show", type=int, metavar="ID", help="print what suggestion ID would send; calls nothing")
    args = parser.parse_args()
    if args.show:
        show(args.show)
        return
    try:
        interval = args.interval if args.interval is not None else (5 if args.poll else 300)
        work(args.once, interval, realtime=not args.poll)
    except KeyboardInterrupt:
        print("stopped")


if __name__ == "__main__":
    main()
