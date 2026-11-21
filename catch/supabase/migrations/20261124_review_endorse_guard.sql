-- CATCH — a reviewer who doesn't endorse sends the file back to the Credit Officer (group notes item 34, Part E,
-- 2026-11-22)
-- Run after 20261123_manual_document_values.sql (needs 20261108_reviewer_signoff.sql). Re-runnable, no data dropped.
-- No existing function is changed; this adds one trigger function and one trigger.
--
-- The rule (decided 2026-11-22): a file reaches the approvers only once EVERY reviewer has endorsed it. "Doesn't
-- endorse", from any reviewer, sends the file back to the Credit Officer as a return: severity Major, the remarks start
-- with "Not endorsed: ", and the checklist item Recommendation is marked Needs revision with the justification. The
-- review page sends it that way through the existing submit_review() (action RETURNED), so the existing return / resend
-- path is used: Credit Evaluation reopens as RETURNED, the Credit Officer is told, and after the resend the review
-- continues from that reviewer.
--
-- The guard: a new review decision with action NOT_ENDORSED is refused, whoever sends it. With "Not endorsed" never
-- recorded, every sign-off is an endorsement, so the move to Approval (after the last reviewer's sign-off) only happens
-- once every reviewer has endorsed. Decisions recorded before this file stay as they are.

-- ============================================================
-- 0. Dependencies
-- ============================================================
do $$
begin
  if to_regclass('public.review_decisions') is null then
    raise exception 'Run these migrations first, then this file again: 20261108_reviewer_signoff.sql';
  end if;
end $$;

-- ============================================================
-- 1. Guard: no new "Not endorsed" sign-off
-- ============================================================
create or replace function public.review_not_endorsed_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.action::text = 'NOT_ENDORSED' then
    raise exception 'A reviewer who doesn''t endorse sends the file back to the Credit Officer: return it as a Major revision starting "Not endorsed: " (the file reaches the approvers only once every reviewer has endorsed it)';
  end if;
  return new;
end $$;
revoke execute on function public.review_not_endorsed_guard() from public, anon, authenticated;

drop trigger if exists review_not_endorsed_guard on public.review_decisions;
create trigger review_not_endorsed_guard before insert on public.review_decisions
  for each row execute function public.review_not_endorsed_guard();
