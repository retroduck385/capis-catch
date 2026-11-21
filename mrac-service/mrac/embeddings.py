"""Embedding providers. Only POLICY text and search queries are embedded, never applicant data.

Passages and queries go through different methods because some models (BGE) expect an instruction in front of the
query only. Every vector in policy_chunks must come from the same model: policy_chunks.embedding_model records it and
check_index() refuses a mismatch (see mrac/ingest/reembed.py to switch models)."""
from __future__ import annotations

import hashlib
import math
import re

# Models that expect an instruction in front of search queries (not passages)
QUERY_PREFIXES = {
    "BAAI/bge-small-en-v1.5": "Represent this sentence for searching relevant passages: ",
    "BAAI/bge-base-en-v1.5": "Represent this sentence for searching relevant passages: ",
}


def passage_text(heading_path: str | None, body: str) -> str:
    """What gets embedded for a chunk: its heading path gives short clauses ('AGE', 'c. Housing Loan') their context."""
    return f"{heading_path}\n{body}" if heading_path else body


class LocalEmbedder:
    def __init__(self, model_name: str, query_prefix: str | None = None):
        from sentence_transformers import SentenceTransformer  # lazy: heavy import
        self._model = SentenceTransformer(model_name)
        self.name = model_name
        self.dim = self._model.get_sentence_embedding_dimension()
        self.query_prefix = QUERY_PREFIXES.get(model_name, "") if query_prefix is None else query_prefix

    def embed(self, texts: list[str]) -> list[list[float]]:
        return self._model.encode(texts, normalize_embeddings=True).tolist()

    def embed_query(self, query: str) -> list[float]:
        return self.embed([self.query_prefix + query])[0]


class HashEmbedder:
    """Deterministic bag-of-words hashing. Lets the pipeline run with no model download. NOT semantic."""
    def __init__(self, dim: int = 384):
        self.dim, self.name = dim, "hash-stub"

    def embed(self, texts: list[str]) -> list[list[float]]:
        out = []
        for t in texts:
            v = [0.0] * self.dim
            for tok in re.findall(r"[a-z0-9]+", t.lower()):
                v[int(hashlib.md5(tok.encode()).hexdigest(), 16) % self.dim] += 1.0
            n = math.sqrt(sum(x * x for x in v)) or 1.0
            out.append([x / n for x in v])
        return out

    def embed_query(self, query: str) -> list[float]:
        return self.embed([query])[0]


def get_embedder(settings):
    if settings.embedding_provider == "hash":
        return HashEmbedder(settings.embedding_dim)
    return LocalEmbedder(settings.embedding_model)
