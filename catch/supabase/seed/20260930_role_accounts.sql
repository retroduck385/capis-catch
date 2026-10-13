-- CATCH — synthetic test accounts, one per role (FAKE people, fake IDs — no real data)
-- Run after all migrations (needs 20260930_signup_role.sql). Re-runnable.
--
-- BEFORE running: create the 8 logins in the dashboard (the SQL Editor can't write to auth tables):
--   Authentication > Users > Add user > Create new user, tick "Auto Confirm User", password Catch2524!
--   Each one starts as APPLICANT (sign-up trigger); this script sets the real role + profile.
--   applicant@catch.test        APPLICANT
--   ao@catch.test               ACCOUNT_OFFICER
--   ci@catch.test               CREDIT_INVESTIGATOR
--   dispatch@catch.test         DISPATCH_ADMIN
--   co@catch.test               CREDIT_OFFICER
--   reviewer@catch.test         REVIEWER
--   approver@catch.test         APPROVER
--   depthead@catch.test         DEPT_HEAD

create temp table seed_accounts (
  email text primary key, role user_role, phone text,
  first_name text, middle_name text, last_name text, gender gender_type,
  date_of_birth date, birth_place text, civil_status civil_status_type, sss_no text, tin text
) on commit drop;

insert into seed_accounts values
  ('applicant@catch.test', 'APPLICANT',           '09170000001', 'Juan',     'Santos',   'Dela Cruz', 'MALE',   '1990-04-12', 'Quezon City',  'MARRIED', '34-0000001-1', '900-000-001-000'),
  ('ao@catch.test',        'ACCOUNT_OFFICER',     '09170000002', 'Maria',    'Reyes',    'Bautista',  'FEMALE', '1992-07-03', 'Makati City',  'SINGLE',  '34-0000002-2', '900-000-002-000'),
  ('ci@catch.test',        'CREDIT_INVESTIGATOR', '09170000003', 'Paolo',    'Garcia',   'Mendoza',   'MALE',   '1988-11-21', 'Pasig City',   'MARRIED', '34-0000003-3', '900-000-003-000'),
  ('dispatch@catch.test',  'DISPATCH_ADMIN',      '09170000004', 'Andrea',   'Cruz',     'Villanueva','FEMALE', '1995-02-14', 'Manila',       'SINGLE',  '34-0000004-4', '900-000-004-000'),
  ('co@catch.test',        'CREDIT_OFFICER',      '09170000005', 'Miguel',   'Torres',   'Ramos',     'MALE',   '1991-09-08', 'Taguig City',  'SINGLE',  '34-0000005-5', '900-000-005-000'),
  ('reviewer@catch.test',  'REVIEWER',            '09170000006', 'Katrina',  'Lopez',    'Aquino',    'FEMALE', '1985-05-30', 'Cebu City',    'MARRIED', '34-0000006-6', '900-000-006-000'),
  ('approver@catch.test',  'APPROVER',            '09170000007', 'Roberto',  'Navarro',  'Castillo',  'MALE',   '1975-01-17', 'Davao City',   'MARRIED', '34-0000007-7', '900-000-007-000'),
  ('depthead@catch.test',  'DEPT_HEAD',           '09170000008', 'Elena',    'Fernandez','Santiago',  'FEMALE', '1978-12-02', 'Iloilo City',  'WIDOWED', '34-0000008-8', '900-000-008-000');

-- Steps 1-2 only look accounts up by email; nothing is written to the auth schema
-- (Supabase doesn't let the SQL Editor insert into auth.identities).

-- 1. Set each account's role and phone
update public.users pu
set role = s.role, phone_number = s.phone, is_active = true
from auth.users au join seed_accounts s on s.email = au.email
where pu.id = au.id;

-- 2. Master profile (complete, so the applicant can apply right away)
insert into public.user_profile (user_id, first_name, middle_name, last_name, gender, date_of_birth,
  birth_place, civil_status, citizenship, sss_no, tin)
select au.id, s.first_name, s.middle_name, s.last_name, s.gender, s.date_of_birth,
  s.birth_place, s.civil_status, 'Filipino', s.sss_no, s.tin
from auth.users au join seed_accounts s on s.email = au.email
on conflict (user_id) do update set
  first_name = excluded.first_name, middle_name = excluded.middle_name, last_name = excluded.last_name,
  gender = excluded.gender, date_of_birth = excluded.date_of_birth, birth_place = excluded.birth_place,
  civil_status = excluded.civil_status, citizenship = excluded.citizenship,
  sss_no = excluded.sss_no, tin = excluded.tin;

-- Check
select au.email, pu.role, up.first_name || ' ' || up.last_name as name
from auth.users au
join public.users pu on pu.id = au.id
left join public.user_profile up on up.user_id = au.id
where au.email like '%@catch.test'
order by pu.role;
