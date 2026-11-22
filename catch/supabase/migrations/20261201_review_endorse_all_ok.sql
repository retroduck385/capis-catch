-- CATCH — a reviewer endorses only when every checklist item is OK (Josh, 2026-11-23)
-- Run after 20261124_review_endorse_guard.sql (needs 20261108_reviewer_signoff.sql). Re-runnable, no data dropped.
-- No existing function is changed; this adds one trigger function and one trigger.
--
-- The rule: the file is endorsed to the approvers only once every reviewer accepts everything. With
-- 20261124_review_endorse_guard.sql every sign-off is already an endorsement, and Approval opens after the last one;
-- but an endorsement could still carry checklist items marked Needs revision. Now it can't: an item marked Needs
-- revision on an ENDORSED decision is refused, so the reviewer returns it to the Credit Officer instead (the existing
-- return / resend path). submit_review() inserts the decision, then its items, in one transaction, so the refusal
-- rolls back the whole sign-off. Decisions recorded before this file stay as they are.

-- ============================================================
-- 0. Dependencies
-- ============================================================
do $$
begin
  if to_regclass('public.review_decision_items') is null then
    raise exception 'Run these migrations first, then this file again: 20261108_reviewer_signoff.sql';
  end if;
end $$;

-- ============================================================
-- 1. Guard: no flagged item on an endorsement
-- ============================================================
create or replace function public.review_endorse_all_ok_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.result::text = 'NEEDS_REVISION' and exists (
       select 1 from review_decisions d where d.id = new.decision_id and d.action::text = 'ENDORSED') then
    raise exception 'To endorse, every checklist item must be OK. Return it to the Credit Officer to fix the items marked Needs revision';
  end if;
  return new;
end $$;
revoke execute on function public.review_endorse_all_ok_guard() from public, anon, authenticated;

drop trigger if exists review_endorse_all_ok_guard on public.review_decision_items;
create trigger review_endorse_all_ok_guard before insert or update on public.review_decision_items
  for each row execute function public.review_endorse_all_ok_guard();
