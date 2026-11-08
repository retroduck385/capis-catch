"""Policy retrieval. Two interchangeable retrievers with the same search() signature:
   SupabaseRetriever: pgvector + Postgres full-text, fused with RRF inside the DB function search_policy().
   LocalRetriever:    BM25 over a JSONL file; for offline dev and tests (no database, no embeddings)."""
from __future__ import annotations

import json
import math
import re
from collections import Counter


STOPWORDS = {"a", "an", "the", "of", "at", "to", "in", "on", "for", "and", "or", "is", "be", "by", "with", "as", "than", "not", "are"}


def _tok(s: str) -> list[str]:
    return [t for t in re.findall(r"[a-z0-9]+", s.lower()) if t not in STOPWORDS]


def _in_force(chunk: dict, on: str | None) -> bool:
    if not on:
        return True
    start, end = chunk.get("effective_from"), chunk.get("effective_to")
    return (start is None or start <= on) and (end is None or end >= on)


class LocalRetriever:
    def __init__(self, chunks: list[dict], k1: float = 1.5, b: float = 0.75):
        # parse_policy / parse_raac write `id` + `source_doc`; the DB calls them chunk_key + document
        chunks = [{**c, "chunk_key": c.get("chunk_key") or c.get("id"), "document": c.get("document") or c.get("source_doc")}
                  for c in chunks]
        self.chunks, self.k1, self.b = chunks, k1, b
        docs = [_tok(f"{c.get('heading_path', '')} {c.get('text') or c.get('body', '')}") for c in chunks]
        self.tf = [Counter(d) for d in docs]
        self.len = [len(d) for d in docs]
        self.avg = (sum(self.len) / len(docs)) if docs else 0
        df = Counter(t for c in self.tf for t in c)
        n = len(docs)
        self.idf = {t: math.log(1 + (n - f + 0.5) / (f + 0.5)) for t, f in df.items()}

    @classmethod
    def from_jsonl(cls, path: str) -> "LocalRetriever":
        with open(path, encoding="utf-8") as f:
            return cls([json.loads(line) for line in f if line.strip()])

    def fetch(self, keys: list[str]) -> list[dict]:
        """Chunks by chunk_key (the link from a criterion to the policy clause it comes from)."""
        return [{**{k: c.get(k) for k in ("chunk_key", "heading_path", "manual_pages", "revision_date", "status", "document")},
                 "text": c.get("text") or c.get("body", ""), "score": None} for c in self.chunks if c["chunk_key"] in set(keys)]

    def search(self, query: str, top_k: int = 5, tags: list[str] | None = None, on: str | None = None) -> list[dict]:
        q = _tok(query)
        scored = []
        for i, c in enumerate(self.chunks):
            if (tags and not set(tags) & set(c.get("tags", []))) or not _in_force(c, on):
                continue
            s = sum(self.idf.get(t, 0) * self.tf[i][t] * (self.k1 + 1)
                    / (self.tf[i][t] + self.k1 * (1 - self.b + self.b * self.len[i] / (self.avg or 1)))
                    for t in q if t in self.tf[i])
            if s > 0:
                scored.append((s, c))
        scored.sort(key=lambda x: x[0], reverse=True)
        return [{**{k: c.get(k) for k in ("chunk_key", "heading_path", "manual_pages", "revision_date", "status", "document")},
                 "text": c.get("text") or c.get("body", ""), "score": round(s, 4)} for s, c in scored[:top_k]]


class SupabaseRetriever:
    def __init__(self, client, embedder, include_draft: bool = True):
        self.client, self.embedder, self.include_draft = client, embedder, include_draft

    def fetch(self, keys: list[str]) -> list[dict]:
        if not keys:
            return []
        rows = (self.client.table("policy_chunks")
                .select("chunk_key,document,heading_path,manual_pages,revision_date,status,body")
                .in_("chunk_key", keys).execute().data or [])
        return [{**{k: r.get(k) for k in ("chunk_key", "heading_path", "manual_pages", "revision_date", "status", "document")},
                 "text": r.get("body", ""), "score": None} for r in rows]

    def search(self, query: str, top_k: int = 5, tags: list[str] | None = None, on: str | None = None) -> list[dict]:
        args = {"p_query": query, "p_embedding": self.embedder.embed([query])[0], "p_limit": top_k,
                "p_tags": tags, "p_include_draft": self.include_draft}
        if on:
            args["p_on"] = on
        rows = self.client.rpc("search_policy", args).execute().data or []
        return [{**{k: r.get(k) for k in ("chunk_key", "heading_path", "manual_pages", "revision_date", "status", "document")},
                 "text": r.get("body", ""), "score": r.get("score")} for r in rows]
