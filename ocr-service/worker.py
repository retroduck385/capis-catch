"""CATCH OCR worker: OCRs uploaded documents (IDs, COE / ITR, payslips / remittances, bank statements) and
CI reports (NFIS, TU, BRAS) queued in Supabase, saves the raw lines, then has Claude label the lines into
fields (AI extraction) for the Account Officer (application documents) or a Credit Investigator (NFIS / TU)
to confirm. Claude only gets the OCR text, never the file.

  python worker.py              wait for uploads (Realtime), with a fallback check every 5 min (Ctrl+C to stop)
  python worker.py --poll       old behaviour: check the queue every --interval seconds, no Realtime
  python worker.py --once       process what's queued now, then exit
  python worker.py --file x.jpg OCR a local file and print the lines (no database)
  python worker.py --file x.pdf --type COE_ITR   ...and print the fields Claude extracts (saves nothing)
  python worker.py --file tu.pdf --type CI_TU    same for a CI report (CI_NFIS, CI_TU), with the proposed result
"""

import argparse
import asyncio
import os
import sys
import tempfile
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

from extract import RetryLater, ai_config, extract
from ocr import engine_name, run_ocr

BUCKET = "application-documents"
PAGE_SIZE = 1000          # PostgREST returns at most this many rows per request
RATE_LIMIT_PAUSE = 60     # seconds to leave the AI queue alone after a Claude API rate limit


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
    """Background thread: sets `wake` whenever a row is inserted into ocr_runs or extraction_runs (needs
    20261108_ocr_realtime.sql and 20261109_ai_extraction.sql). Also sets it on every (re)subscribe, so runs
    queued while disconnected are picked up. If Realtime can't connect, the fallback poll still works."""
    from realtime import AsyncRealtimeClient, RealtimeSubscribeStates

    subscribed_once = False

    def on_status(state, err):
        nonlocal subscribed_once
        if state == RealtimeSubscribeStates.SUBSCRIBED:
            if not subscribed_once:  # reconnects after a dropped connection are normal; don't print each one
                print("Realtime: listening for new uploads", flush=True)
                subscribed_once = True
            wake.set()
        elif err or state != RealtimeSubscribeStates.CLOSED:
            print(f"Realtime: {state.value}{f' ({err})' if err else ''}; falling back to the slow poll", flush=True)

    async def run():
        client = AsyncRealtimeClient(f"{url}/realtime/v1", key)
        await client.connect()
        channel = client.channel("ocr-worker")
        channel.on_postgres_changes("INSERT", schema="public", table="ocr_runs", callback=lambda _: wake.set())
        channel.on_postgres_changes("INSERT", schema="public", table="extraction_runs", callback=lambda _: wake.set())
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
            lines, pages = run_ocr(str(path))

        if lines:
            client.table("ocr_lines").insert([{**l, "run_id": run_id} for l in lines]).execute()
        if pages:
            try:  # only used to draw boxes on the document; never fail the OCR over it
                client.table("ocr_pages").upsert([{**p, "run_id": run_id} for p in pages]).execute()
            except Exception as e:
                print(f"run {run_id}: page sizes not saved ({e}); run 20261109_ai_extraction.sql", flush=True)
        # DONE also queues the AI extraction (trigger in 20261109_ai_extraction.sql)
        client.table("ocr_runs").update({
            "status": "DONE", "engine": engine_name(), "finished_at": now(),
        }).eq("id", run_id).execute()
        print(f"run {run_id}: done, {len(lines)} lines", flush=True)
    except Exception as e:  # keep the worker alive; the error is saved on the run
        client.table("ocr_runs").update({
            "status": "FAILED", "engine": engine_name(), "finished_at": now(), "error": str(e)[:2000],
        }).eq("id", run_id).execute()
        print(f"run {run_id}: FAILED — {e}", flush=True)


def fetch_all(query):
    """All rows of a select, past PostgREST's 1000-row page limit (long bank statements)."""
    rows, start = [], 0
    while True:
        page = query.range(start, start + PAGE_SIZE - 1).execute().data
        rows += page
        if len(page) < PAGE_SIZE:
            return rows
        start += PAGE_SIZE


def field_defs(client, document_type):
    return client.table("extraction_field_defs").select("*").eq("document_type", document_type).execute().data


def process_extraction(client, job, api_key, model):
    """Returns False when the Claude API asked us to slow down (the run goes back to PENDING)."""
    run_id = job["run_id"]
    print(f"extraction {run_id}: {job['file_name']} ({job['document_type']}) ...", flush=True)
    try:
        lines = fetch_all(client.table("ocr_lines").select("id,page_no,line_no,text,bbox")
                          .eq("run_id", job["ocr_run_id"]).order("page_no").order("line_no"))
        result = extract(job["document_type"], field_defs(client, job["document_type"]), lines, api_key, model)
        client.rpc("save_extraction", {
            "p_run_id": run_id, "p_model": result["model"], "p_output": result["output"],
            "p_fields": result["fields"], "p_input_tokens": result["input_tokens"],
            "p_output_tokens": result["output_tokens"],
        }).execute()
        print(f"extraction {run_id}: done, {len(result['fields'])} fields "
              f"({result['input_tokens']} in / {result['output_tokens']} out tokens)", flush=True)
        return True
    except RetryLater as e:
        client.table("extraction_runs").update({"status": "PENDING", "started_at": None}).eq("id", run_id).execute()
        print(f"extraction {run_id}: {e}; retrying in {RATE_LIMIT_PAUSE}s", flush=True)
        return False
    except Exception as e:  # keep the worker alive; the error is saved on the run (the AO can re-run it)
        client.table("extraction_runs").update({
            "status": "FAILED", "model": model, "finished_at": now(), "error": str(e)[:2000],
        }).eq("id", run_id).execute()
        print(f"extraction {run_id}: FAILED — {e}", flush=True)
        return True


def work(once, interval, realtime):
    url, key = get_config()
    client = get_client(url, key)
    api_key, model = ai_config()
    paused_until = 0.0  # AI queue paused after a rate limit
    wake = threading.Event()
    if api_key:
        print(f"AI extraction on ({model})", flush=True)
    else:
        print("AI extraction off: set ANTHROPIC_API_KEY in ocr-service/.env (extraction runs stay queued)", flush=True)
    if once:
        print("OCR worker: processing the current queue", flush=True)
    elif realtime:
        threading.Thread(target=listen_for_runs, args=(url, key, wake), daemon=True).start()
        print(f"OCR worker started, waiting for uploads (fallback check every {interval:g}s)", flush=True)
    else:
        print(f"OCR worker started, polling every {interval:g}s", flush=True)

    while True:
        wake.clear()  # cleared before claiming, so an upload during processing triggers another pass
        # OCR first (it feeds the AI queue), then one AI extraction
        jobs = client.rpc("claim_ocr_runs", {"p_limit": 1}).execute().data
        for job in jobs:
            process(client, job)
        if not jobs and api_key and time.monotonic() >= paused_until:
            jobs = client.rpc("claim_extraction_runs", {"p_limit": 1}).execute().data
            for job in jobs:
                if not process_extraction(client, job, api_key, model):
                    paused_until = time.monotonic() + RATE_LIMIT_PAUSE
        if not jobs:
            if once:
                return
            pause = max(paused_until - time.monotonic(), 0)
            wake.wait(min(interval, pause) if pause else interval)  # returns early on a Realtime event


def test_file(path, document_type):
    lines, pages = run_ocr(path)
    for p in pages:
        print(f"page {p['page_no']}: {p['width']}x{p['height']} px, rotated {p['angle']}")
    for l in lines:
        print(f"p{l['page_no']} #{l['line_no']:>3}  {l['confidence']:.3f}  {l['text']}")
    if not document_type:
        return
    url, key = get_config()  # loads .env; field definitions live in Supabase (read only)
    api_key, model = ai_config()
    if not api_key:
        raise SystemExit("Set ANTHROPIC_API_KEY in ocr-service/.env to test the AI extraction")
    defs = field_defs(get_client(url, key), document_type)
    if not defs:
        raise SystemExit(f"No field definitions for {document_type}: run 20261109_ai_extraction.sql "
                         "(and 20261109_ci_extraction.sql for CI_NFIS / CI_TU) first")
    for n, l in enumerate(lines, start=1):
        l["id"] = n
    result = extract(document_type, defs, lines, api_key, model)
    labels = {d["field_key"]: d["label"] for d in defs}
    print(f"\n{result['model']}: {result['output'].get('document_kind')}, "
          f"{result['input_tokens']} in / {result['output_tokens']} out tokens")
    groups = {d["field_key"]: d.get("row_group") or "rows" for d in defs if d["scope"] == "ROW"}
    for f in result["fields"]:
        row = f"{groups.get(f['key'], 'row')} {f['item_no']} " if f["item_no"] else ""
        print(f"  {row}{labels.get(f['key'], f['key'])}: {f['value'] or '—'}  (lines {f['line_ids']})")
    for issue in result["output"].get("issues") or []:
        print(f"  ! {issue}")
    if "proposed_result" in result["output"]:
        print(f"\nProposed CI result: {result['output']['proposed_result']}")
        print(f"Summary: {result['output'].get('findings_summary') or '—'}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--once", action="store_true", help="process the current queue, then exit")
    parser.add_argument("--poll", action="store_true", help="poll only, no Realtime (default interval then 5 s)")
    parser.add_argument("--interval", type=float, help="seconds between queue checks (default 300, or 5 with --poll); "
                        "with Realtime this is only the fallback for missed events and runs stuck in RUNNING")
    parser.add_argument("--file", help="OCR a local file and print the result; nothing is saved")
    parser.add_argument("--type", help="with --file: also run the AI extraction for this document type "
                        "(VALID_ID_PASSPORT, COE_ITR, PAYSLIPS_REMITTANCES, FS_BANK_STATEMENTS, CI_NFIS, CI_TU)")
    args = parser.parse_args()

    if args.file:
        test_file(args.file, args.type)
        return
    try:
        interval = args.interval if args.interval is not None else (5 if args.poll else 300)
        work(args.once, interval, realtime=not args.poll)
    except KeyboardInterrupt:
        import traceback  # show where it was waiting, to diagnose a stuck run
        frames = traceback.extract_tb(sys.exc_info()[2])[-4:]
        print("stopped while in: " + " <- ".join(f"{Path(f.filename).name}:{f.lineno} {f.name}" for f in reversed(frames)))


if __name__ == "__main__":
    main()
