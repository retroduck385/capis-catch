-- CATCH — remove what seed_applications.sql made: the seeded applications (principal e-mail @catch-seed.test),
-- their change history and notifications, and the @catch-seed.test applicant logins. Re-runnable.
-- Run in the Supabase SQL Editor. Staff accounts and every other application are left alone.
--
-- An application that has an applicant notice (sent from the app after seeding) is kept: notices are an append-only
-- record of what the applicant was told, so the database refuses to delete them. The script lists those.
do $$
declare
  v_domain  text := 'catch-seed.test';
  v_apps    bigint[];
  v_kept    bigint[];
  v_users   int := 0;
begin
  select array_agg(distinct p.application_id) into v_apps
  from applicants p where p.role = 'PRINCIPAL' and p.email_address like '%@' || v_domain;

  select array_agg(distinct n.application_id) into v_kept
  from applicant_notices n where n.application_id = any (coalesce(v_apps, '{}'));
  v_apps := array(select a from unnest(coalesce(v_apps, '{}')) a where a <> all (coalesce(v_kept, '{}')));

  -- Messages are append-only too, except when their application is being deleted (this setting, this transaction)
  perform set_config('catch.messages_purge', 'orphans', true);
  delete from loan_applications where id = any (v_apps);   -- everything else goes with it (on delete cascade)
  perform set_config('catch.messages_purge', '', true);
  delete from audit_log where application_id = any (v_apps);   -- after: the delete itself is logged too

  begin
    delete from auth.users au
    where au.email like '%@' || v_domain
      and not exists (select 1 from loan_applications la where la.user_id = au.id);
    get diagnostics v_users = row_count;
  exception when others then
    raise notice 'Applicant logins not removed (%): delete the @% users in Authentication > Users', sqlerrm, v_domain;
  end;

  raise notice 'Removed % seeded application(s) and % applicant login(s).%', cardinality(v_apps), v_users,
    case when v_kept is not null
         then ' Kept (they have applicant notices): ' || array_to_string(v_kept, ', ') else '' end;
end $$;
