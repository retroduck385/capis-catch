import unittest

from mrac.embeddings import HashEmbedder, QUERY_PREFIXES, passage_text
from mrac.retrieval import IndexMismatch, check_index, rerank


class FakeReranker:
    name = "fake"

    def scores(self, query, passages):          # longer overlap with the query = higher score
        q = set(query.lower().split())
        return [len(q & set(p.lower().split())) for p in passages]


class FakeQuery:
    def __init__(self, counts, filters=()):
        self.counts, self.filters = counts, filters

    def select(self, *a, **k):
        return self

    def neq(self, col, val):
        return FakeQuery(self.counts, self.filters + ((col, "neq", val),))

    def is_(self, col, val):
        return FakeQuery(self.counts, self.filters + ((col, "is", val),))

    def execute(self):
        return type("R", (), {"count": self.counts.get(self.filters[-1] if len(self.filters) > 1 else "total", 0)})()


class FakeClient:
    def __init__(self, counts):
        self.counts = counts

    def table(self, _):
        return FakeQuery(self.counts)


class RetrievalTests(unittest.TestCase):
    def test_passage_text_puts_the_heading_first(self):
        self.assertEqual(passage_text("RAAC > AGE", "21 to 65"), "RAAC > AGE\n21 to 65")
        self.assertEqual(passage_text(None, "body"), "body")

    def test_bge_queries_get_the_instruction_passages_do_not(self):
        self.assertTrue(QUERY_PREFIXES["BAAI/bge-small-en-v1.5"].startswith("Represent this sentence"))
        h = HashEmbedder(64)
        self.assertEqual(h.embed_query("dbr limit"), h.embed(["dbr limit"])[0])

    def test_rerank_reorders_and_cuts(self):
        hits = [{"chunk_key": "A", "heading_path": "auto", "text": "auto loan terms"},
                {"chunk_key": "B", "heading_path": "housing", "text": "housing loan debt burden ratio limit"},
                {"chunk_key": "C", "heading_path": "x", "text": "debt burden"}]
        out = rerank(FakeReranker(), "housing debt burden ratio", hits, top_k=2)
        self.assertEqual([h["chunk_key"] for h in out], ["B", "C"])
        self.assertIn("rerank_score", out[0])

    def test_no_reranker_keeps_the_fused_order(self):
        hits = [{"chunk_key": k, "text": ""} for k in "XYZ"]
        self.assertEqual([h["chunk_key"] for h in rerank(None, "q", hits, 2)], ["X", "Y"])

    def test_index_check_refuses_a_mixed_index(self):
        emb = HashEmbedder(8)
        ok = FakeClient({"total": 10, ("embedding_model", "neq", emb.name): 0, ("embedding_model", "is", "null"): 0})
        self.assertEqual(check_index(ok, emb), 10)
        stale = FakeClient({"total": 10, ("embedding_model", "neq", emb.name): 0, ("embedding_model", "is", "null"): 4})
        with self.assertRaises(IndexMismatch):
            check_index(stale, emb)


if __name__ == "__main__":
    unittest.main()
