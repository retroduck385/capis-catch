-- CATCH — MRAC / policy RAG: product filter for search_policy().
-- Run after 20261105_mrac_rag.sql. Replaces search_policy() with a version that takes p_products.
--
-- Why: once the Credit Policy Manual and the two operations manuals are loaded, the same words (limits, exception, DBR) appear
-- under auto, consumer and business loans. p_products keeps clauses written for the product AND general clauses (no product
-- named) and drops clauses that name only other products. Chunks get their products at ingestion (parse_policy).
do $$
begin
  if to_regclass('public.policy_chunks') is null then
    raise exception 'Run 20261105_mrac_rag.sql first: public.policy_chunks is missing';
  end if;
end $$;

drop function if exists public.search_policy(text, vector, int, text[], date, boolean, double precision);

create or replace function public.search_policy(
  p_query text,
  p_embedding vector(384),
  p_limit int default 5,
  p_tags text[] default null,
  p_on date default current_date,
  p_include_draft boolean default true,
  p_min_similarity double precision default 0.25,
  p_products text[] default null)
returns table (id bigint, chunk_key text, document text, heading_path text, manual_pages text[],
               revision_date date, status text, tags text[], body text, score double precision)
language sql stable security definer set search_path = public, extensions as $$
  with eligible as (
    select c.* from policy_chunks c
    where c.status <> 'retired'
      and (p_include_draft or c.status = 'approved')
      and (c.effective_from is null or c.effective_from <= p_on)
      and (c.effective_to is null or c.effective_to >= p_on)
      and (p_tags is null or c.tags && p_tags)
      and (p_products is null or cardinality(c.products) = 0 or c.products && p_products)
  ), v as (
    select e.id, row_number() over (order by e.embedding <=> p_embedding) as rn
    from eligible e
    where e.embedding is not null and 1 - (e.embedding <=> p_embedding) >= p_min_similarity
    order by e.embedding <=> p_embedding limit 30
  ), l as (
    select e.id, row_number() over (order by ts_rank_cd(e.fts, q) desc) as rn
    from eligible e,
         websearch_to_tsquery('english', regexp_replace(trim(p_query), '\s+', ' or ', 'g')) q
    where e.fts @@ q
    order by ts_rank_cd(e.fts, q) desc limit 30
  ), fused as (
    select coalesce(v.id, l.id) as id,
           coalesce(1.0 / (60 + v.rn), 0) + coalesce(1.0 / (60 + l.rn), 0) as score
    from v full join l on l.id = v.id
  )
  select c.id, c.chunk_key, c.document, c.heading_path, c.manual_pages, c.revision_date, c.status, c.tags, c.body,
         f.score::double precision
  from fused f join policy_chunks c on c.id = f.id
  order by f.score desc
  limit p_limit;
$$;

revoke execute on function public.search_policy(text, vector, int, text[], date, boolean, double precision, text[]) from public, anon, authenticated;
grant execute on function public.search_policy(text, vector, int, text[], date, boolean, double precision, text[]) to service_role;
