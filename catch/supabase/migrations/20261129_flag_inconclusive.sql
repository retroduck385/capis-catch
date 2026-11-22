-- CATCH — a Credit Investigator can flag an "Inconclusive" CI result too; "no CO assigned" flag alerts go to the
-- CO Managers (2026-11-22)
-- Run after 20261128_ci_mrac_facts.sql (needs 20261116_findings_and_file_marks.sql, 20261120_team_managers_auto_assignment.sql
-- and 20261126_ci_facts.sql). Re-runnable, no drops of data.
--
-- What changes
--   1. flag_ci_findings() accepts a file once a saved NFIS / TU result is "With findings" OR "Inconclusive"
--      (Inconclusive: discrepancies with the application form, or information that can't be verified; the AO and
--      CO need to know as much as for findings). Everything else is as in 20261116_findings_and_file_marks.sql.
--   2. The alert title is "CI results flagged on <application no.>" (kind CI_FINDINGS_FLAGGED, same switch row).
--   3. While no Credit Officer is assigned, the alert goes to the CO Managers instead of every Dispatch Admin:
--      since 20261120 the CO Managers assign Credit Officers, not the Dispatch Admin.
--   4. A notification_switches row for NO_AVAILABLE_OFFICER (on), so it can be switched off like the other kinds.
--      The function that sends it is not changed.
--
-- Only flag_ci_findings() (this module's own function, 20261116) is replaced. No other module's function is changed.
--
-- Re-runs of earlier files:
--   * 20261116_findings_and_file_marks.sql re-run -> flag_ci_findings() goes back to "With findings" only and the
--     Dispatch Admins: run this file again afterwards.

-- ============================================================
-- 0. Dependencies
-- ============================================================
do $$
begin
  if to_regclass('public.ci_finding_flags') is null then
    raise exception 'Run 20261116_findings_and_file_marks.sql first, then this file again';
  end if;
  if to_regprocedure('public.team_managers(public.user_role)') is null then
    raise exception 'Run 20261120_team_managers_auto_assignment.sql first, then this file again';
  end if;
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                 where t.typname = 'ci_check_result' and e.enumlabel = 'INCONCLUSIVE') then
    raise exception 'Run 20261126_ci_facts.sql first, then this file again';
  end if;
end $$;

-- ============================================================
-- 1. Switch rows
-- ============================================================
update public.notification_switches
set note = 'A Credit Investigator flagged CI results (With findings / Inconclusive): the assigned AO and CO (CO Managers while no CO is assigned)'
where kind = 'CI_FINDINGS_FLAGGED';

insert into public.notification_switches (kind, enabled, note) values
  ('NO_AVAILABLE_OFFICER', true, 'Nobody on the AO / CO team is available for a new file: that team''s Managers')
on conflict (kind) do nothing;

-- ============================================================
-- 2. flag_ci_findings()
-- ============================================================
create or replace function public.flag_ci_findings(p_application_id bigint, p_note text)
returns public.ci_finding_flags language plpgsql security definer set search_path = public as $$
declare
  v_note text := btrim(coalesce(p_note, ''), E' \t\r\n');
  v_row ci_finding_flags;
  v_title text;
  v_link text := '/financialPackagePage?id=' || p_application_id || '#fp-iv';
  v_body text := 'The Credit Investigator flagged the CI results. Open IV. Credit Checking to read them.';
begin
  if coalesce(current_user_role()::text, '') <> 'CREDIT_INVESTIGATOR'
     or not exists (select 1 from users u where u.id = auth.uid() and u.is_active)
     or not staff_can_access(p_application_id) then
    raise exception 'Only a Credit Investigator can flag CI findings, on a file with a CI request';
  end if;
  -- Compared as text: the INCONCLUSIVE value was added in another file (20261126_ci_facts.sql)
  if not exists (select 1 from ci_checks c join applicants a on a.id = c.applicant_id
                 where a.application_id = p_application_id and c.result::text in ('WITH_FINDINGS', 'INCONCLUSIVE')) then
    raise exception 'No saved CI result on this file is "With findings" or "Inconclusive". Save the result first.';
  end if;
  if v_note = '' then raise exception 'Write a short note about the findings'; end if;
  if length(v_note) > 500 then raise exception 'The note is longer than 500 characters'; end if;
  if staff_name(auth.uid()) is null then
    raise exception 'Fill in your staff profile (first and last name) first';
  end if;

  insert into ci_finding_flags (application_id, note, flagged_by)
  values (p_application_id, v_note, auth.uid())
  returning * into v_row;

  -- A failed notification never blocks the flag
  begin
    v_title := 'CI results flagged on ' || notification_app_no(p_application_id);
    perform send_notification('CI_FINDINGS_FLAGGED', v_title, v_body, p_application_id,
      p_assigned => array['ACCOUNT_OFFICER'], p_link => v_link, p_source => 'ci');
    if exists (select 1 from application_assignments where application_id = p_application_id
               and assignee_role::text = 'CREDIT_OFFICER' and unassigned_at is null) then
      perform send_notification('CI_FINDINGS_FLAGGED', v_title, v_body, p_application_id,
        p_assigned => array['CREDIT_OFFICER'], p_link => v_link, p_source => 'ci');
    else
      perform send_notification('CI_FINDINGS_FLAGGED', v_title,
        v_body || ' No Credit Officer is assigned yet.', p_application_id,
        p_users => team_managers('CREDIT_OFFICER'), p_link => v_link, p_source => 'ci');
    end if;
  exception when others then
    raise warning 'CI findings notification failed: %', sqlerrm;
  end;

  return v_row;
end $$;

revoke execute on function public.flag_ci_findings(bigint, text) from public, anon;
grant execute on function public.flag_ci_findings(bigint, text) to authenticated;
