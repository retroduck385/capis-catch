"""Load the draft MRAC criteria (rules/housing_raac_draft.json) into Supabase public.mrac_criteria.

    python -m mrac.ingest.load_criteria rules/housing_raac_draft.json

Run after the RAAC chunks are loaded, so each criterion can be linked to the clause it comes from.
New criteria are ALWAYS loaded disabled; an existing row keeps its `enabled` flag, so re-running never switches a
reviewed rule on or off. Enabling is a deliberate step by credit policy:
    update mrac_criteria set enabled = true where code = 'RAAC-DBR';
"""
from __future__ import annotations

import argparse
import json

COLUMNS = ("code", "label", "section", "check_type", "field", "op", "threshold", "applies_when", "options", "prompt",
           "hard_stop", "is_example", "search_hint", "source_chunk_key", "notes")


def to_row(rule: dict, chunk_ids: dict[str, int], existing_enabled: dict[str, bool]) -> dict:
    row = {k: rule.get(k) for k in COLUMNS}
    row["check_type"] = rule.get("check_type") or "auto"
    row["applies_when"] = rule.get("applies_when") or []
    row["options"] = rule.get("options") or {}
    row["hard_stop"] = bool(rule.get("hard_stop"))
    row["is_example"] = bool(rule.get("is_example"))
    row["enabled"] = existing_enabled.get(rule["code"], False)
    row["source_chunk_id"] = chunk_ids.get(rule.get("source_chunk_key") or "")
    return row


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("path")
    a = ap.parse_args()

    from supabase import create_client
    from mrac.config import get_settings

    s = get_settings()
    if not s.supabase_url or not s.service_key:
        raise SystemExit("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env")
    client = create_client(s.supabase_url, s.service_key)
    with open(a.path, encoding="utf-8") as f:
        rules = json.load(f)

    keys = [r["source_chunk_key"] for r in rules if r.get("source_chunk_key")]
    found = client.table("policy_chunks").select("id,chunk_key").in_("chunk_key", keys).execute().data or []
    chunk_ids = {r["chunk_key"]: r["id"] for r in found}
    missing = sorted(set(keys) - set(chunk_ids))
    if missing:
        print("warning: these policy chunks are not loaded yet, so those criteria have no source link:", ", ".join(missing))
    existing = {r["code"]: r["enabled"] for r in client.table("mrac_criteria").select("code,enabled").execute().data or []}
    client.table("mrac_criteria").upsert([to_row(r, chunk_ids, existing) for r in rules], on_conflict="code").execute()
    print(f"{len(rules)} criteria upserted ({sum(existing.get(r['code'], False) for r in rules)} already enabled, left as they were)")


if __name__ == "__main__":
    main()
