"""Re-embed every policy chunk already in Supabase with the configured model (EMBEDDING_MODEL), from the text stored in
policy_chunks. No source files needed. Use it after switching models; stop every MRAC worker first.

    python -m mrac.ingest.reembed --dry-run      # what would change
    python -m mrac.ingest.reembed                # all chunks
    python -m mrac.ingest.reembed --only-stale   # only chunks not embedded with the configured model

Only the embedding and embedding_model columns change: text, status (draft / approved) and tags are left as they are.
"""
from __future__ import annotations

import argparse

BATCH = 32
PAGE = 1000


def fetch_all(client) -> list[dict]:
    rows, start = [], 0
    while True:
        part = (client.table("policy_chunks").select("id,document,chunk_key,heading_path,body,embedding_model")
                .order("id").range(start, start + PAGE - 1).execute().data or [])
        rows += part
        if len(part) < PAGE:
            return rows
        start += PAGE


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--only-stale", action="store_true", help="skip chunks already embedded with the configured model")
    a = ap.parse_args()

    from supabase import create_client
    from mrac.config import get_settings
    from mrac.embeddings import get_embedder, passage_text
    from mrac.retrieval import check_index

    s = get_settings()
    if not s.supabase_url or not s.service_key:
        raise SystemExit("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env")
    if s.embedding_provider == "hash":
        raise SystemExit("EMBEDDING_PROVIDER=hash is not semantic; set EMBEDDING_PROVIDER=local before re-embedding")
    client, embedder = create_client(s.supabase_url, s.service_key), get_embedder(s)
    if embedder.dim != s.embedding_dim:
        raise SystemExit(f"{embedder.name} makes {embedder.dim}-dim vectors; policy_chunks.embedding is {s.embedding_dim}. "
                         "A different size needs a migration first.")

    rows = fetch_all(client)
    todo = [r for r in rows if not (a.only_stale and r.get("embedding_model") == embedder.name)]
    by_model: dict = {}
    for r in rows:
        by_model[r.get("embedding_model")] = by_model.get(r.get("embedding_model"), 0) + 1
    print(f"{len(rows)} chunks; current models: {by_model}")
    print(f"re-embedding {len(todo)} with {embedder.name}" + (" (dry run)" if a.dry_run else ""))
    if a.dry_run:
        return

    for i in range(0, len(todo), BATCH):
        part = todo[i:i + BATCH]
        vectors = embedder.embed([passage_text(r.get("heading_path"), r["body"]) for r in part])
        # upsert on the natural key with body included (NOT NULL); columns left out are not touched
        client.table("policy_chunks").upsert(
            [{"document": r["document"], "chunk_key": r["chunk_key"], "body": r["body"], "embedding": v,
              "embedding_model": embedder.name} for r, v in zip(part, vectors)],
            on_conflict="document,chunk_key").execute()
        print(f"  {min(i + BATCH, len(todo))}/{len(todo)}", flush=True)
    print(f"done; index check: {check_index(client, embedder)} chunks, all {embedder.name}")


if __name__ == "__main__":
    main()
