"""Load draft chunks (JSONL from parse_policy) into Supabase public.policy_chunks, with embeddings.

    python -m mrac.ingest.load_chunks out/draft_chunks.jsonl                    # everything, status='draft'
    python -m mrac.ingest.load_chunks out/draft_chunks.jsonl --tag housing_loan  # only housing-tagged chunks
    python -m mrac.ingest.load_chunks out/draft_chunks.jsonl --limit 20          # quick smoke test

Re-running is safe: rows are upserted on (document, chunk_key). A chunk's status is NOT overwritten once a
reviewer has set it to 'approved' / 'retired' (the loader only inserts or refreshes 'draft' rows).
"""
from __future__ import annotations

import argparse
import json

BATCH = 40


def to_row(chunk: dict, embedding: list[float]) -> dict:
    return {
        "document": chunk["source_doc"], "chunk_key": chunk["id"], "section": chunk.get("section"),
        "heading_path": chunk.get("heading_path"), "revision_date": chunk.get("version"),
        "effective_from": chunk.get("effective_from"), "effective_to": chunk.get("effective_to"),
        "manual_pages": chunk.get("manual_pages") or [], "pdf_pages": chunk.get("pdf_pages") or [],
        "tags": chunk.get("tags") or [], "products": chunk.get("products") or [],
        "status": "draft", "body": chunk["text"], "embedding": embedding,
    }


def select(chunks: list[dict], tag: str | None = None, limit: int | None = None) -> list[dict]:
    out = [c for c in chunks if not tag or tag in c.get("tags", [])]
    return out[:limit] if limit else out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("path")
    ap.add_argument("--tag")
    ap.add_argument("--limit", type=int)
    a = ap.parse_args()

    from supabase import create_client            # imported here so the helpers above work without it
    from mrac.config import get_settings
    from mrac.embeddings import get_embedder

    s = get_settings()
    if not s.supabase_url or not s.service_key:
        raise SystemExit("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env")
    client, embedder = create_client(s.supabase_url, s.service_key), get_embedder(s)

    with open(a.path, encoding="utf-8") as f:
        chunks = select([json.loads(l) for l in f if l.strip()], a.tag, a.limit)
    print(f"{len(chunks)} chunks selected; embedding with {embedder.name} ...")

    existing = {r["chunk_key"]: r["status"] for r in
                client.table("policy_chunks").select("chunk_key,status").limit(20000).execute().data or []}
    todo = [c for c in chunks if existing.get(c["id"], "draft") == "draft"]
    print(f"{len(chunks) - len(todo)} already reviewed (left untouched), loading {len(todo)}")
    for i in range(0, len(todo), BATCH):
        part = todo[i:i + BATCH]
        rows = [to_row(c, e) for c, e in zip(part, embedder.embed([c["text"] for c in part]))]
        client.table("policy_chunks").upsert(rows, on_conflict="document,chunk_key").execute()
        print(f"  {min(i + BATCH, len(todo))}/{len(todo)}", flush=True)
    print("done")


if __name__ == "__main__":
    main()
