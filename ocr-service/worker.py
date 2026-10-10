"""CATCH OCR worker: OCRs uploaded documents (IDs, COE / ITR, payslips / remittances)
queued in Supabase and saves the raw lines.

  python worker.py              poll the queue every 5 s (Ctrl+C to stop)
  python worker.py --once       process what's queued now, then exit
  python worker.py --file x.jpg OCR a local file and print the lines (no database)
"""

import argparse
import os
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

from ocr import engine_name, run_ocr

BUCKET = "application-documents"


def now():
    return datetime.now(timezone.utc).isoformat()


def get_client():
    from supabase import create_client

    load_dotenv(Path(__file__).with_name(".env"))
    url, key = os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise SystemExit("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in ocr-service/.env")
    return create_client(url, key)


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


def work(once, interval):
    client = get_client()
    print("OCR worker started" + ("" if once else f", polling every {interval}s"), flush=True)
    while True:
        jobs = client.rpc("claim_ocr_runs", {"p_limit": 1}).execute().data
        for job in jobs:
            process(client, job)
        if not jobs:
            if once:
                return
            time.sleep(interval)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--once", action="store_true", help="process the current queue, then exit")
    parser.add_argument("--interval", type=float, default=5, help="seconds between polls (default 5)")
    parser.add_argument("--file", help="OCR a local file and print the result; nothing is saved")
    args = parser.parse_args()

    if args.file:
        for l in run_ocr(args.file):
            print(f"p{l['page_no']} #{l['line_no']:>3}  {l['confidence']:.3f}  {l['text']}")
        return
    try:
        work(args.once, args.interval)
    except KeyboardInterrupt:
        print("stopped")


if __name__ == "__main__":
    main()
