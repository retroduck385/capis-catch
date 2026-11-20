-- CATCH — a new file from the applicant replaces the one it was asked for, instead of adding to the total (2026-11-21)
-- Run after 20261120_credit_ai_suggestions.sql (needs 20261112_document_requests.sql and
-- 20261116_findings_and_file_marks.sql). Re-runnable, no drops of data.
--
-- Decided 2026-11-21 (Dobbe, from the Account Officer's side): when the AO asks the applicant for a new copy of a
-- required document, the new file must take the old one's place. Before this, every uploaded file became one more
-- row, so "Document check" counted the old file AND the new one (0/4 became 0/5) and the checklist counts were off.
--
-- What it does
--   1. documents.superseded_by / superseded_at / replaced_requirement_id: a replaced file is NOT deleted. It stays in
--      the table and in storage (so staff can still open it) but is taken off its requirement (requirement_id becomes
--      null) and points at the file that replaced it. Because every count (checklist, step 1 of the loan folder,
--      readiness, review flags, notices) reads documents through the requirement, none of them counts it any more,
--      and no other function needed to change. replaced_requirement_id remembers which requirement it belonged to,
--      so the pages can list it as an "earlier version".
--   2. supersede_replaced_documents(request): run when the applicant sends a request (send_requested_documents). For
--      each item that is a checklist document (not "Other"), it works out how many of the new files REPLACE an old
--      one: new files minus the ones still missing (required count minus the current files that are not part of this
--      request, and uploaded before it). It then replaces that many old files, in this order: files the staff marked "Needs a new copy", then
--      files that could not be read (OCR or AI failed), then the oldest. Pairing is by file order. Files for a
--      document that was missing, and "Other" documents, simply add.
--   3. document_request_items_checked() (redefined from 20261112): an item now also asks for at least as many files as
--      are marked "Needs a new copy" (up to 5), so marking both IDs asks for two.
--   4. send_requested_documents() (redefined from 20261112): same as before, then calls the function in 2.
--   5. Requests the applicant already answered (sent, or closed as received) are processed once, oldest first, each one
--      looking only at the files uploaded before it, so an application that went through several rounds ends with only
--      the latest files current (12 files from 3 rounds of 4 become 4, and 8 earlier versions). Withdrawn requests are
--      skipped. Running this file again changes nothing more (the numbers are worked out from what is current).
--
-- No existing table gets rows deleted. The three new columns are plain data; RLS on documents is unchanged (staff and
-- the owner still read every row, including replaced ones). Nothing here lets a client write a document.

-- ============================================================
-- 0. Dependencies
-- ============================================================
do $$
declare
  v_missing text;
begin
  select string_agg(m, ', ') into v_missing
  from (values ('public.documents', '20260928_application_side.sql'),
               ('public.document_requests', '20261112_document_requests.sql'),
               ('public.document_file_marks', '20261116_findings_and_file_marks.sql'),
               ('public.ocr_runs', '20261007_id_ocr.sql'),
               ('public.extraction_runs', '20261109_ai_extraction.sql')) d (t, m)
  where to_regclass(t) is null;
  if v_missing is not null then
    raise exception 'Run these migrations first, then this file again: %', v_missing;
  end if;
end $$;

-- ============================================================
-- 1. Columns
-- ============================================================
alter table public.documents add column if not exists superseded_by bigint references public.documents(id) on delete set null;
alter table public.documents add column if not exists superseded_at timestamptz;
alter table public.documents add column if not exists replaced_requirement_id bigint;   -- the requirement it was taken off
create index if not exists documents_replaced on public.documents (application_id) where superseded_at is not null;

-- ============================================================
-- 2. Which old file goes first: marked "Needs a new copy", then unreadable, then the oldest
-- ============================================================
create or replace function public.document_replace_rank(p_document_id bigint)
returns int language sql stable security definer set search_path = public as $$
  select case
    when (select m.mark from document_file_marks m where m.document_id = p_document_id order by m.id desc limit 1) = 'NEEDS_NEW_COPY' then 0
    when coalesce((select o.status::text from ocr_runs o where o.document_id = p_document_id order by o.id desc limit 1), '') = 'FAILED'
      or coalesce((select e.status::text from extraction_runs e join ocr_runs o on o.id = e.ocr_run_id
                   where o.document_id = p_document_id order by e.id desc limit 1), '') = 'FAILED' then 1
    else 2 end;
$$;
revoke execute on function public.document_replace_rank(bigint) from public, anon, authenticated;

-- ============================================================
-- 3. Replace the old files a request's new files stand in for. Returns how many files were replaced.
-- ============================================================
create or replace function public.supersede_replaced_documents(p_request_id bigint)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_item record;
  v_req_id bigint;
  v_new bigint[];
  v_old bigint[];
  v_missing int;
  v_replace int;
  v_total int := 0;
  n int;
begin
  for v_item in select i.* from document_request_items i
                where i.request_id = p_request_id and i.requirement_type is not null order by i.id
  loop
    select ar.id into v_req_id from application_requirements ar
    where ar.applicant_id = v_item.applicant_id and ar.requirement_type = v_item.requirement_type;
    if v_req_id is null then continue; end if;

    select coalesce(array_agg(u.document_id order by u.document_id), '{}') into v_new
    from document_request_uploads u where u.item_id = v_item.id;
    -- the requirement's other files that still count, the ones to replace first at the front
    select coalesce(array_agg(d.id order by document_replace_rank(d.id), d.id), '{}') into v_old
    from documents d where d.requirement_id = v_req_id and d.id <> all (v_new)
      and (cardinality(v_new) = 0 or d.id < v_new[1]);   -- only what was there before this request's first file

    v_missing := greatest(0, required_document_min(v_item.requirement_type) - coalesce(cardinality(v_old), 0));
    v_replace := least(greatest(0, coalesce(cardinality(v_new), 0) - v_missing), coalesce(cardinality(v_old), 0));

    for n in 1..v_replace loop
      update documents
      set superseded_by = v_new[n], superseded_at = now(), replaced_requirement_id = requirement_id, requirement_id = null
      where id = v_old[n];
      v_total := v_total + 1;
    end loop;
  end loop;
  return v_total;
end $$;
revoke execute on function public.supersede_replaced_documents(bigint) from public, anon, authenticated;

-- ============================================================
-- 4. A request item asks for at least as many files as are marked "Needs a new copy" (redefines 20261112)
-- ============================================================
create or replace function public.document_request_items_checked(p_application_id bigint, p_items jsonb)
returns table (applicant_id bigint, requirement_type requirement_type, label text, min_files smallint)
language plpgsql stable security definer set search_path = public as $$
declare
  i jsonb;
  v_party bigint;
  v_type requirement_type;
  v_have int;
  v_flagged int;
begin
  for i in select * from jsonb_array_elements(p_items) loop
    v_party := (i->>'applicant_id')::bigint;
    if not exists (select 1 from applicants a where a.id = v_party and a.application_id = p_application_id) then
      raise exception 'Each document must be for a person on this application';
    end if;
    v_type := nullif(i->>'requirement_type', '')::requirement_type;
    if v_type is null then
      applicant_id := v_party; requirement_type := null; label := btrim(i->>'label'); min_files := 1;
    else
      select count(*), count(*) filter (where document_replace_rank(d.id) = 0) into v_have, v_flagged
      from documents d
      join application_requirements ar on ar.id = d.requirement_id
      where ar.applicant_id = v_party and ar.requirement_type = v_type;
      applicant_id := v_party; requirement_type := v_type; label := requirement_label(v_type);
      min_files := least(5, greatest(1, required_document_min(v_type) - v_have, v_flagged));
    end if;
    return next;
  end loop;
end $$;
revoke execute on function public.document_request_items_checked(bigint, jsonb) from public, anon, authenticated;

-- ============================================================
-- 5. Sending the request replaces the old files (redefines 20261112; the only change is the last line of the body)
-- ============================================================
create or replace function public.send_requested_documents(p_request_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_req document_requests;
  v_short text;
begin
  select * into v_req from document_requests where id = p_request_id for update;
  if not found or (select user_id from loan_applications where id = v_req.application_id) is distinct from auth.uid() then
    raise exception 'Document request not found';
  end if;
  if v_req.status <> 'OPEN' then raise exception 'This request was already sent'; end if;
  select string_agg(i.label || ' (' || party_label_text(i.applicant_id) || ')', '; ' order by i.id) into v_short
  from document_request_items i
  where i.request_id = p_request_id
    and (select count(*) from document_request_uploads u where u.item_id = i.id) < i.min_files;
  if v_short is not null then raise exception 'Upload every requested document first. Still missing: %', v_short; end if;

  update document_requests set status = 'SENT', sent_at = now() where id = p_request_id;
  perform send_notification('DOCUMENTS_SENT',
    'The applicant sent the requested documents for ' || notification_app_no(v_req.application_id),
    'Check them in the loan folder and the document check, then close the request.', v_req.application_id,
    p_assigned => array['ACCOUNT_OFFICER'], p_link => '/loanFolderPage?id=' || v_req.application_id);
  perform supersede_replaced_documents(p_request_id);
end $$;
revoke execute on function public.send_requested_documents(bigint) from public, anon;
grant execute on function public.send_requested_documents(bigint) to authenticated;

-- ============================================================
-- 6. Requests the applicant already answered: replace their files once, oldest first
-- ============================================================
do $$
declare
  r record;
begin
  for r in select id from document_requests where status = 'SENT' or (status = 'CLOSED' and closed_as = 'RECEIVED') order by id loop
    perform supersede_replaced_documents(r.id);
  end loop;
end $$;
