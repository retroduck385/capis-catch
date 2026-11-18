"""CATCH notice worker: sends the applicant outcome notices the Account Officer queued
(SMS through Semaphore, email through Brevo). Test mode (the default) prints them instead.

  python worker.py              poll the queue every 10 s (Ctrl+C to stop)
  python worker.py --once       process what's queued now, then exit
  python worker.py --preview    print what is queued, claim and send nothing

NOTICE_MODE=log (default): nothing is sent; each delivery is printed and marked LOGGED.
NOTICE_MODE=live: sends for real, but only to destinations in NOTICE_LIVE_ALLOWLIST (the team's own numbers and
  addresses) until the Data Privacy sessions clear it (Q-04); others are printed and marked LOGGED.
  Brevo keys are required. SMS is optional: with SEMAPHORE_API_KEY empty, SMS deliveries are printed and marked LOGGED
  (as in log mode) while email still sends.
Every text is checked again for links (notice_link_in() in the database) right before it is sent.

Reminders (20261119_document_request_reminders.sql): about once a minute the worker asks the database to queue the
document request reminders that are due (queue_document_reminders(); 8 AM - 8 PM Philippine time only), then sends
their SMS / email from the reminder queue the same way (claim_reminder_deliveries / finish_reminder_delivery).
"""

import argparse
import os
import time
from pathlib import Path

from dotenv import load_dotenv

from providers import BrevoEmail, LogProvider, ProviderError, SemaphoreSms, mask

ALLOWLIST_OFF = "yes-q04-cleared"   # NOTICE_LIVE_ALLOWLIST value that sends to everyone
REMINDER_CHECK_EVERY = 60           # seconds between checks for due document request reminders


def get_client():
    from supabase import create_client

    url, key = os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise SystemExit("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in notice-service/.env")
    return create_client(url, key)


def load_config(env=os.environ):
    mode = (env.get("NOTICE_MODE") or "log").strip().lower()
    if mode not in ("log", "live"):
        raise SystemExit(f"NOTICE_MODE must be log or live, got {mode!r}")
    allow_raw = (env.get("NOTICE_LIVE_ALLOWLIST") or "").strip()
    if mode == "live" and not allow_raw:
        raise SystemExit("NOTICE_MODE=live needs NOTICE_LIVE_ALLOWLIST (the team's own numbers / addresses, comma-separated)")
    allow_all = allow_raw == ALLOWLIST_OFF
    allowlist = set() if allow_all else {normalise(x) for x in allow_raw.split(",") if x.strip()}
    return {"mode": mode, "allow_all": allow_all, "allowlist": allowlist}


def normalise(destination):
    d = destination.strip().lower()
    digits = "".join(ch for ch in d if ch.isdigit())
    if "@" in d:
        return d
    if digits.startswith("09") and len(digits) == 11:
        return "+63" + digits[1:]
    if digits.startswith("639") and len(digits) == 12:
        return "+" + digits
    return d


def make_providers(config, env=os.environ, out=print):
    log = LogProvider(out=out)
    if config["mode"] == "log":
        return {"SMS": log, "EMAIL": log, "log": log}
    email = BrevoEmail(env.get("BREVO_API_KEY"), env.get("BREVO_SENDER_EMAIL"), env.get("BREVO_SENDER_NAME") or "CATCH")
    sms_key = (env.get("SEMAPHORE_API_KEY") or "").strip()
    if sms_key:
        sms = SemaphoreSms(sms_key, env.get("SEMAPHORE_SENDER_NAME") or None)
    else:
        # SMS off: printed and marked LOGGED, the same as log mode; email still sends
        sms = LogProvider(out=out, note=", SMS off")
        out("SMS is off (SEMAPHORE_API_KEY is empty): SMS notices are printed and marked LOGGED; email still sends through Brevo")
    return {"SMS": sms, "EMAIL": email, "log": LogProvider(out=out, note=", not on NOTICE_LIVE_ALLOWLIST")}


def link_in(client, text):
    return client.rpc("notice_link_in", {"p_text": text or ""}).execute().data


def finish(client, delivery_id, status, provider=None, message_id=None, error=None, rpc="finish_notice_delivery"):
    return client.rpc(rpc, {
        "p_id": delivery_id, "p_status": status, "p_provider": provider,
        "p_provider_message_id": message_id, "p_error": error,
    }).execute().data


# kind: "notice" (applicant_notice_deliveries) or "reminder" (document_reminder_deliveries); only the finish call differs
def process(client, delivery, config, providers, out=print, kind="notice"):
    did, channel = delivery["id"], delivery["channel"]
    label = f"{'reminder ' if kind == 'reminder' else ''}delivery {did} ({channel} to {mask(delivery['destination'])})"
    rpc = "finish_reminder_delivery" if kind == "reminder" else "finish_notice_delivery"
    try:
        for text in (delivery.get("subject"), delivery["body"]):
            found = link_in(client, text)
            if found:
                status = finish(client, did, "FAILED", "check", None, f"Text contains something that looks like a link: {found[:60]}", rpc=rpc)
                out(f"{label}: refused, looks like a link: {found[:60]} -> {status}")
                return status

        on_list = config["allow_all"] or normalise(delivery["destination"]) in config["allowlist"]
        provider = providers[channel] if config["mode"] == "live" and on_list else providers["log"]
        message_id = provider.send(delivery)
        status = finish(client, did, "LOGGED" if provider.name == "log" else "SENT", provider.name, message_id, rpc=rpc)
        out(f"{label}: {status}")
        return status
    except ProviderError as e:
        status = finish(client, did, "FAILED", providers[channel].name, None, str(e), rpc=rpc)
        out(f"{label}: failed ({e}) -> {status}")
        return status
    except Exception as e:  # keep the worker alive; the error is saved on the delivery (retried up to 3 attempts)
        status = finish(client, did, "FAILED", None, None, f"{type(e).__name__}: {e}", rpc=rpc)
        out(f"{label}: error ({type(e).__name__}: {e}) -> {status}")
        return status


def process_batch(client, jobs, config, providers, out=print, kind="notice"):
    # Oldest first: claim_notice_deliveries() picks the oldest ids, but UPDATE ... RETURNING doesn't keep that order,
    # and a correction must never go out before the notice it corrects
    for job in sorted(jobs, key=lambda j: j["id"]):
        process(client, job, config, providers, out, kind)


def claim_reminders(client):
    """Up to 5 queued reminder SMS / emails ([] if the reminders migration isn't run yet)."""
    if getattr(queue_reminders, "warned", False):
        return []
    try:
        return client.rpc("claim_reminder_deliveries", {"p_limit": 5}).execute().data or []
    except Exception:
        return []


def queue_reminders(client, out=print):
    """Asks the database to queue the reminders that are due now. Returns how many were made (0 if the reminders
    migration isn't run yet: said once, then the worker carries on with notices)."""
    try:
        made = client.rpc("queue_document_reminders", {}).execute().data or 0
    except Exception as e:
        if not getattr(queue_reminders, "warned", False):
            out(f"Reminders off: queue_document_reminders() failed ({e}); run 20261119_document_request_reminders.sql")
            queue_reminders.warned = True
        return 0
    if made:
        out(f"queued {made} document request reminder(s)")
    return made


def preview(client, out=print):
    rows = []
    for table, note in (("applicant_notice_deliveries", ""), ("document_reminder_deliveries", ", reminder")):
        try:
            found = (client.table(table).select("id, channel, destination, subject, body, status, attempts")
                     .in_("status", ["QUEUED", "RUNNING"]).order("id").execute().data)
        except Exception:  # the reminders migration isn't run yet
            continue
        for d in found:
            LogProvider(out=out, note=f"{note}, {d['status'].lower()}, attempt {d['attempts']}").send(d)
        rows += found
    if not rows:
        out("Nothing queued.")
    return rows


def work(once, interval, out=print):
    config = load_config()
    providers = make_providers(config, out=out)
    client = get_client()
    out(f"Notice worker started in {config['mode']} mode" + ("" if once else f", polling every {interval}s"))
    next_reminder_check = 0.0
    while True:
        if time.monotonic() >= next_reminder_check:
            queue_reminders(client, out)
            next_reminder_check = time.monotonic() + REMINDER_CHECK_EVERY
        jobs = client.rpc("claim_notice_deliveries", {"p_limit": 5}).execute().data or []
        process_batch(client, jobs, config, providers, out)
        reminder_jobs = claim_reminders(client)
        process_batch(client, reminder_jobs, config, providers, out, kind="reminder")
        jobs = jobs + reminder_jobs
        if not jobs:
            if once:
                return
            time.sleep(interval)


def main():
    load_dotenv(Path(__file__).with_name(".env"))
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--once", action="store_true", help="process the current queue, then exit")
    parser.add_argument("--interval", type=float, default=10, help="seconds between polls (default 10)")
    parser.add_argument("--preview", action="store_true", help="print what is queued; claim and send nothing")
    args = parser.parse_args()
    try:
        if args.preview:
            preview(get_client())
        else:
            work(args.once, args.interval)
    except KeyboardInterrupt:
        print("stopped")


if __name__ == "__main__":
    main()
