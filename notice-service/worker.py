"""CATCH notice worker: sends the applicant outcome notices the Account Officer queued
(SMS through Semaphore, email through Brevo). Test mode (the default) prints them instead.

  python worker.py              poll the queue every 10 s (Ctrl+C to stop)
  python worker.py --once       process what's queued now, then exit
  python worker.py --preview    print what is queued, claim and send nothing

NOTICE_MODE=log (default): nothing is sent; each delivery is printed and marked LOGGED.
NOTICE_MODE=live: sends for real, but only to destinations in NOTICE_LIVE_ALLOWLIST (the team's own numbers and
  addresses) until the Data Privacy sessions clear it (Q-04); others are printed and marked LOGGED.
Every text is checked again for links (notice_link_in() in the database) right before it is sent.
"""

import argparse
import os
import time
from pathlib import Path

from dotenv import load_dotenv

from providers import BrevoEmail, LogProvider, ProviderError, SemaphoreSms, mask

ALLOWLIST_OFF = "yes-q04-cleared"   # NOTICE_LIVE_ALLOWLIST value that sends to everyone


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
    return {
        "SMS": SemaphoreSms(env.get("SEMAPHORE_API_KEY"), env.get("SEMAPHORE_SENDER_NAME") or None),
        "EMAIL": BrevoEmail(env.get("BREVO_API_KEY"), env.get("BREVO_SENDER_EMAIL"), env.get("BREVO_SENDER_NAME") or "CATCH"),
        "log": LogProvider(out=out, note=", not on NOTICE_LIVE_ALLOWLIST"),
    }


def link_in(client, text):
    return client.rpc("notice_link_in", {"p_text": text or ""}).execute().data


def finish(client, delivery_id, status, provider=None, message_id=None, error=None):
    return client.rpc("finish_notice_delivery", {
        "p_id": delivery_id, "p_status": status, "p_provider": provider,
        "p_provider_message_id": message_id, "p_error": error,
    }).execute().data


def process(client, delivery, config, providers, out=print):
    did, channel = delivery["id"], delivery["channel"]
    label = f"delivery {did} ({channel} to {mask(delivery['destination'])})"
    try:
        for text in (delivery.get("subject"), delivery["body"]):
            found = link_in(client, text)
            if found:
                status = finish(client, did, "FAILED", "check", None, f"Text contains something that looks like a link: {found[:60]}")
                out(f"{label}: refused, looks like a link: {found[:60]} -> {status}")
                return status

        on_list = config["allow_all"] or normalise(delivery["destination"]) in config["allowlist"]
        provider = providers[channel] if config["mode"] == "live" and on_list else providers["log"]
        message_id = provider.send(delivery)
        status = finish(client, did, "LOGGED" if provider.name == "log" else "SENT", provider.name, message_id)
        out(f"{label}: {status}")
        return status
    except ProviderError as e:
        status = finish(client, did, "FAILED", providers[channel].name, None, str(e))
        out(f"{label}: failed ({e}) -> {status}")
        return status
    except Exception as e:  # keep the worker alive; the error is saved on the delivery (retried up to 3 attempts)
        status = finish(client, did, "FAILED", None, None, f"{type(e).__name__}: {e}")
        out(f"{label}: error ({type(e).__name__}: {e}) -> {status}")
        return status


def preview(client, out=print):
    rows = (client.table("applicant_notice_deliveries").select("id, channel, destination, subject, body, status, attempts")
            .in_("status", ["QUEUED", "RUNNING"]).order("id").execute().data)
    if not rows:
        out("Nothing queued.")
    for d in rows:
        LogProvider(out=out, note=f", {d['status'].lower()}, attempt {d['attempts']}").send(d)
    return rows


def work(once, interval, out=print):
    config = load_config()
    providers = make_providers(config, out=out)
    client = get_client()
    out(f"Notice worker started in {config['mode']} mode" + ("" if once else f", polling every {interval}s"))
    while True:
        jobs = client.rpc("claim_notice_deliveries", {"p_limit": 5}).execute().data or []
        for job in jobs:
            process(client, job, config, providers, out)
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
