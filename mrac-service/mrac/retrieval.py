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
        chunks = [{**c, "chunk_key": c.get("chunk_key") or c.get("id"), "document": c.get("document") or c.get("source_doc"),
                   "revision_date": c.get("revision_date") or c.get("version")} for c in chunks]
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

    def search(self, query: str, top_k: int = 5, tags: list[str] | None = None, on: str | None = None,
               products: list[str] | None = None) -> list[dict]:
        """products: keep clauses written for these products AND general clauses (no product named); drop clauses that
        name only other products (auto, consumer, business ...)."""
        q = _tok(query)
        scored = []
        for i, c in enumerate(self.chunks):
            if (tags and not set(tags) & set(c.get("tags", []))) or not _in_force(c, on):
                continue
            if products and c.get("products") and not set(products) & set(c["products"]):
                continue
            s = sum(self.idf.get(t, 0) * self.tf[i][t] * (self.k1 + 1)
                    / (self.tf[i][t] + self.k1 * (1 - self.b + self.b * self.len[i] / (self.avg or 1)))
                    for t in q if t in self.tf[i])
            if s > 0:
                scored.append((s, c))
        scored.sort(key=lambda x: x[0], reverse=True)
        return [{**{k: c.get(k) for k in ("chunk_key", "heading_path", "manual_pages", "revision_date", "status", "document")},
                 "text": c.get("text") or c.get("body", ""), "score": round(s, 4)} for s, c in scored[:top_k]]


class CrossEncoderReranker:
    """Re-scores (query, passage) pairs with a cross-encoder. Much better at 'does this clause answer this' than the
    vector + keyword fusion, but too slow to run over the whole manual, so it only re-orders the candidates."""
    def __init__(self, model_name: str):
        from sentence_transformers import CrossEncoder  # lazy: heavy import
        self._model = CrossEncoder(model_name)
        self.name = model_name

    def scores(self, query: str, passages: list[str]) -> list[float]:
        return [float(s) for s in self._model.predict([(query, p) for p in passages])] if passages else []


def get_reranker(settings):
    return CrossEncoderReranker(settings.rerank_model) if settings.rerank_model else None


def rerank(reranker, query: str, hits: list[dict], top_k: int) -> list[dict]:
    """hits sorted by the reranker (best first), cut to top_k. The fused score is kept as `score`."""
    if not reranker or not hits:
        return hits[:top_k]
    from .embeddings import passage_text
    scored = reranker.scores(query, [passage_text(h.get("heading_path"), h.get("text") or "") for h in hits])
    ranked = sorted(zip(scored, hits), key=lambda x: x[0], reverse=True)
    return [{**h, "rerank_score": round(s, 4)} for s, h in ranked[:top_k]]


class IndexMismatch(RuntimeError):
    pass


def check_index(client, embedder) -> int:
    """Refuses to search an index built with another embedding model (vectors from two models are not comparable).
    Returns the number of chunks. Raises IndexMismatch with what to do."""
    count = lambda q: q.execute().count or 0
    base = lambda: client.table("policy_chunks").select("id", count="exact").neq("status", "retired")
    total = count(base())
    other = count(base().neq("embedding_model", embedder.name)) + count(base().is_("embedding_model", "null"))
    if other:
        raise IndexMismatch(f"{other} of {total} policy chunks were not embedded with {embedder.name}. Mixed models make "
                            f"vector search meaningless. Either set EMBEDDING_MODEL to the model the index uses, or "
                            f"re-embed: python -m mrac.ingest.reembed")
    return total


class SupabaseRetriever:
    CANDIDATES = 30     # how many fused results the reranker re-orders

    def __init__(self, client, embedder, include_draft: bool = True, reranker=None):
        self.client, self.embedder, self.include_draft, self.reranker = client, embedder, include_draft, reranker

    def fetch(self, keys: list[str]) -> list[dict]:
        if not keys:
            return []
        rows = (self.client.table("policy_chunks")
                .select("chunk_key,document,heading_path,manual_pages,revision_date,status,body")
                .in_("chunk_key", keys).execute().data or [])
        return [{**{k: r.get(k) for k in ("chunk_key", "heading_path", "manual_pages", "revision_date", "status", "document")},
                 "text": r.get("body", ""), "score": None} for r in rows]

    def search(self, query: str, top_k: int = 5, tags: list[str] | None = None, on: str | None = None,
               products: list[str] | None = None) -> list[dict]:
        limit = max(top_k, self.CANDIDATES) if self.reranker else top_k
        args = {"p_query": query, "p_embedding": self.embedder.embed_query(query), "p_limit": limit,
                "p_tags": tags, "p_include_draft": self.include_draft}
        if on:
            args["p_on"] = on
        if products:
            args["p_products"] = products
        rows = self.client.rpc("search_policy", args).execute().data or []
        hits = [{**{k: r.get(k) for k in ("chunk_key", "heading_path", "manual_pages", "revision_date", "status", "document")},
                 "text": r.get("body", ""), "score": r.get("score")} for r in rows]
        return rerank(self.reranker, query, hits, top_k)
