"""CATCH OCR worker: OCRs uploaded documents (IDs, COE / ITR, payslips / remittances)
queued in Supabase and saves the raw lines.

  python worker.py              wait for uploads (Realtime), with a fallback check every 5 min (Ctrl+C to stop)
  python worker.py --poll       old behaviour: check the queue every --interval seconds, no Realtime
  python worker.py --once       process what's queued now, then exit
  python worker.py --file x.jpg OCR a local file and print the lines (no database)
"""

import argparse
import asyncio
import os
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

from ocr import engine_name, run_ocr

BUCKET = "application-documents"


def now():
    return datetime.now(timezone.utc).isoformat()


def get_config():
    load_dotenv(Path(__file__).with_name(".env"))
    url, key = os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise SystemExit("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in ocr-service/.env")
    return url.rstrip("/"), key


def get_client(url, key):
    from supabase import create_client

    return create_client(url, key)


def listen_for_runs(url, key, wake):
    """Background thread: sets `wake` whenever a row is inserted into ocr_runs (needs
    20261108_ocr_realtime.sql). Also sets it on every (re)subscribe, so runs queued while
    disconnected are picked up. If Realtime can't connect, the fallback poll still works."""
    from realtime import AsyncRealtimeClient, RealtimeSubscribeStates

    def on_status(state, err):
        if state == RealtimeSubscribeStates.SUBSCRIBED:
            print("Realtime: listening for new uploads", flush=True)
            wake.set()
        elif err or state != RealtimeSubscribeStates.CLOSED:
            print(f"Realtime: {state.value}{f' ({err})' if err else ''}; falling back to the slow poll", flush=True)

    async def run():
        client = AsyncRealtimeClient(f"{url}/realtime/v1", key)
        await client.connect()
        channel = client.channel("ocr-worker")
        channel.on_postgres_changes("INSERT", schema="public", table="ocr_runs", callback=lambda _: wake.set())
        await channel.subscribe(on_status)
        await asyncio.Event().wait()  # keep the loop (and the socket) alive

    try:
        asyncio.run(run())
    except Exception as e:
        print(f"Realtime unavailable ({e}); falling back to the slow poll", flush=True)


def process(client, job):
    run_id = job["run_id"]
    print(f"run {run_id}: {job['file_name']} ...", flush=True)
    try:
        data = client.storage.from_(BUCKET).download(job["file_path"])
        suffix = Path(job["file_path"]).suffix.lower()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / f"doc{suffix}"
            path.write_bytes(data)
            lines = run_ocr(str(path))

        if lines:
            client.table("ocr_lines").insert([{**l, "run_id": run_id} for l in lines]).execute()
        client.table("ocr_runs").update({
            "status": "DONE", "engine": engine_name(), "finished_at": now(),
        }).eq("id", run_id).execute()
        print(f"run {run_id}: done, {len(lines)} lines", flush=True)
    except Exception as e:  # keep the worker alive; the error is saved on the run
        client.table("ocr_runs").update({
            "status": "FAILED", "engine": engine_name(), "finished_at": now(), "error": str(e)[:2000],
        }).eq("id", run_id).execute()
        print(f"run {run_id}: FAILED — {e}", flush=True)


def work(once, interval, realtime):
    url, key = get_config()
    client = get_client(url, key)
    wake = threading.Event()
    if once:
        print("OCR worker: processing the current queue", flush=True)
    elif realtime:
        threading.Thread(target=listen_for_runs, args=(url, key, wake), daemon=True).start()
        print(f"OCR worker started, waiting for uploads (fallback check every {interval:g}s)", flush=True)
    else:
        print(f"OCR worker started, polling every {interval:g}s", flush=True)

    while True:
        wake.clear()  # cleared before claiming, so an upload during processing triggers another pass
        jobs = client.rpc("claim_ocr_runs", {"p_limit": 1}).execute().data
        for job in jobs:
            process(client, job)
        if not jobs:
            if once:
                return
            wake.wait(interval)  # returns early on a Realtime event


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--once", action="store_true", help="process the current queue, then exit")
    parser.add_argument("--poll", action="store_true", help="poll only, no Realtime (default interval then 5 s)")
    parser.add_argument("--interval", type=float, help="seconds between queue checks (default 300, or 5 with --poll); "
                        "with Realtime this is only the fallback for missed events and runs stuck in RUNNING")
    parser.add_argument("--file", help="OCR a local file and print the result; nothing is saved")
    args = parser.parse_args()

    if args.file:
        for l in run_ocr(args.file):
            print(f"p{l['page_no']} #{l['line_no']:>3}  {l['confidence']:.3f}  {l['text']}")
        return
    try:
        interval = args.interval if args.interval is not None else (5 if args.poll else 300)
        work(args.once, interval, realtime=not args.poll)
    except KeyboardInterrupt:
        print("stopped")


if __name__ == "__main__":
    main()
