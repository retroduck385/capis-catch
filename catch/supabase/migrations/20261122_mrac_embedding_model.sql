-- CATCH — MRAC / policy RAG: record which embedding model produced each policy chunk's vector.
-- Run after 20261109_mrac_search_products.sql. Re-runnable, no data dropped.
--
-- Why: vectors from two models are not comparable, so a search over a mixed index silently fails (the RAAC chunks were
-- embedded with the hash stub while the manuals used MiniLM). The worker now refuses to start unless every chunk was
-- embedded with its configured model (mrac/retrieval.py check_index). Existing rows stay null until
-- `python -m mrac.ingest.reembed` fills them.
do $$
begin
  if to_regclass('public.policy_chunks') is null then
    raise exception 'Run 20261105_mrac_rag.sql first: public.policy_chunks is missing';
  end if;
end $$;

alter table public.policy_chunks add column if not exists embedding_model text;

comment on column public.policy_chunks.embedding_model is
  'Embedding model that produced this row''s vector (e.g. BAAI/bge-small-en-v1.5). Set by the mrac-service loader / re-embed.';
