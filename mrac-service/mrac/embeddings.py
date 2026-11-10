"""Embedding providers. Only POLICY text and search queries are embedded, never applicant data."""
from __future__ import annotations

import hashlib
import math
import re


class LocalEmbedder:
    def __init__(self, model_name: str):
        from sentence_transformers import SentenceTransformer  # lazy: heavy import
        self._model = SentenceTransformer(model_name)
        self.name = model_name
        self.dim = self._model.get_sentence_embedding_dimension()

    def embed(self, texts: list[str]) -> list[list[float]]:
        return self._model.encode(texts, normalize_embeddings=True).tolist()


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


def get_embedder(settings):
    if settings.embedding_provider == "hash":
        return HashEmbedder(settings.embedding_dim)
    return LocalEmbedder(settings.embedding_model)
