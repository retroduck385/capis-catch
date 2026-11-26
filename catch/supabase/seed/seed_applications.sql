-- CATCH — synthetic loan applications across every stage and decision (FAKE people, FAKE companies, FAKE banks)
-- Run in the Supabase SQL Editor AFTER every migration in catch/supabase/migrations (up to 20261206).
-- To remove everything this makes: seed_applications_cleanup.sql (same folder).
--
-- What it makes (v_count = 50; set a higher number for more, the mix below repeats):
--   6  Drafts (incomplete): loan details only / up to employment / everything but the documents
--   6  Intake: 1 unassigned, 2 KYC half verified, 2 with an open "Needs clarification" question (one answered by
--      the applicant), 1 fully verified and ready for the CI request
--   7  Credit Investigation: 2 requested, 3 partly done, 2 done with adverse findings (cancelled card, past-due card)
--   9  Credit Evaluation: 2 new, 2 with a draft Financial Package + partial score, 3 Deferred (with deferrals),
--      2 returned by the reviewer (one minor revision, one "Not endorsed")
--   6  Review: 3 waiting for reviewer 1, 3 endorsed by reviewer 1 and waiting for reviewer 2
--   5  Approval: 3 waiting for the approvers, 2 approved by one approver and waiting for the other/s
--   7  Approved (2 with conditions; one of them went through a reviewer return first)
--   4  Rejected (2 endorsed by the CO but disapproved; 2 not endorsed by the CO and disapproved)
-- Submission dates are spread over the last ~2 months, so the work tray shows on-track / near / beyond TAT files.
--
-- Accounts
--   * Each application gets its own applicant login: firstname.lastnameNN@catch-seed.test, password CatchSeed2524!
--     (.test addresses can't receive mail; mobile numbers start with 0900, which isn't a real network prefix).
--   * If this project doesn't let the SQL Editor create auth users, the script says so and spreads the applications
--     over the APPLICANT accounts that already exist instead (drafts are skipped for accounts that have one).
--   * Staff are looked up by role: active Account Officers / Credit Officers (non-managers first), Credit
--     Investigators, Reviewers, and Approvers by position. Every one of them needs a completed staff profile.
--     Approvers are routed the way send_for_review() does it; if the authority a file needs can't be met by the
--     approver accounts you have, the next authority up (or down) that can be met is used.
--
-- What it can't do from SQL
--   * Files: document rows are made (so the checklists count as complete) but there is nothing in Storage, so
--     opening a seeded file fails. Set v_with_documents := false to leave documents out.
--   * The OCR / AI reads, CI report uploads, MRAC runs and AI suggestions are not made (run them from the app).
--   * Notifications and the change history (audit_log) that the inserts trigger are removed at the end: they would
--     all be dated "now" and by nobody. The work tray, loan folders, FP, credit score, review and approval pages read
--     the seeded rows directly.
--   * No applicant notices are sent (those are append-only, and an application with one can't be deleted later).

-- ============================================================
-- 0. Helpers (pg_temp: gone when the SQL Editor session ends)
-- ============================================================
-- Repeatable "random" number in [0, 1) for application i (same input = same data on every run)
create or replace function pg_temp.r(p_i int, p_salt text) returns double precision
language sql immutable as $$
  select ('x' || lpad(substr(md5(p_i::text || ':' || p_salt), 1, 12), 16, '0'))::bit(64)::bigint / 281474976710656.0
$$;
create or replace function pg_temp.pick(p_arr text[], p_i int, p_salt text) returns text
language sql immutable as $$
  select p_arr[1 + floor(pg_temp.r(p_i, p_salt) * cardinality(p_arr))::int]
$$;
create or replace function pg_temp.rng(p_lo numeric, p_hi numeric, p_i int, p_salt text) returns numeric
language sql immutable as $$
  select p_lo + (p_hi - p_lo) * pg_temp.r(p_i, p_salt)::numeric
$$;
create or replace function pg_temp.days(p numeric) returns interval
language sql immutable as $$ select make_interval(secs => (p * 86400)::double precision) $$;
-- Excel PMT(rate/12, 12*years, -amount), rate in percent
create or replace function pg_temp.pmt(p_amount numeric, p_rate numeric, p_years int) returns numeric
language sql immutable as $$
  select case when p_rate = 0 then p_amount / (p_years * 12)
              else p_amount * (p_rate / 1200) / (1 - power(1 + p_rate / 1200, -(p_years * 12))) end
$$;
create or replace function pg_temp.years_between(p_from date, p_to date) returns int
language sql immutable as $$ select extract(year from age(p_to, p_from))::int $$;
create or replace function pg_temp.peso(p numeric) returns text
language sql immutable as $$ select 'PHP ' || to_char(p, 'FM999,999,999,990.00') $$;

create or replace function pg_temp.open_stage(p_app bigint, p_stage public.workflow_stage, p_at timestamptz)
returns bigint language sql as $$
  insert into public.application_stages (application_id, stage, entered_at) values (p_app, p_stage, p_at) returning id
$$;
create or replace function pg_temp.set_status(p_visit bigint, p_status public.stage_status, p_at timestamptz,
                                              p_by uuid, p_note text)
returns void language sql as $$
  insert into public.stage_status_changes (stage_visit_id, status, changed_at, changed_by, note)
  values (p_visit, p_status, p_at, p_by, p_note)
$$;
create or replace function pg_temp.close_stage(p_visit bigint, p_at timestamptz) returns void
language sql as $$ update public.application_stages set left_at = p_at where id = p_visit $$;

-- Can the Approver accounts that exist meet this authority?
create or replace function pg_temp.covered(p_tier public.approval_tier) returns boolean
language plpgsql as $$
begin
  perform public.check_approvers_cover(p_tier);
  return true;
exception when others then
  return false;
end $$;

-- One borrower: person + employment + employer address (employment skipped when p_emp is null)
create or replace function pg_temp.add_party(
  p_app bigint, p_role public.party_role, p_no int, p_rel text,
  p_first text, p_middle text, p_last text, p_maiden text, p_gender public.gender_type, p_dob date, p_birthplace text,
  p_civil public.civil_status_type, p_mobile text, p_email text, p_sss text, p_tin text,
  p_emp public.employment_type, p_employer text, p_occupation text, p_hired date, p_income numeric,
  p_emp_phone text, p_emp_email text, p_emp_tin text, p_ctc text, p_ctc_place text,
  p_emp_street text, p_emp_brgy text, p_emp_city text, p_emp_prov text)
returns bigint language plpgsql as $$
declare
  v_id bigint;
begin
  insert into public.applicants (application_id, role, party_no, relationship_to_principal, first_name, middle_name,
                                 last_name, maiden_name, mobile_number, email_address, gender, date_of_birth,
                                 birth_place, civil_status, citizenship, sss_no, tin)
  values (p_app, p_role, p_no, p_rel, p_first, p_middle, p_last, p_maiden, p_mobile, p_email, p_gender, p_dob,
          p_birthplace, p_civil, 'Filipino', p_sss, p_tin)
  returning id into v_id;
  if p_emp = 'UNEMPLOYED' then
    insert into public.employment_info (applicant_id, employment_type) values (v_id, 'UNEMPLOYED');
  elsif p_emp is not null then
    insert into public.employment_info (applicant_id, employment_type, employer_business_name, occupation,
                                        employment_date, contact_number, email_address, employer_tin, ctc_no,
                                        ctc_date_issued, ctc_place_issued, gross_monthly_income)
    values (v_id, p_emp, p_employer, p_occupation, p_hired, p_emp_phone, p_emp_email, p_emp_tin, p_ctc,
            make_date(2026, 1, 15), p_ctc_place, p_income);
    insert into public.addresses (applicant_id, address_type, building_street, subdivision_barangay,
                                  municipality_city, province)
    values (v_id, 'EMPLOYER', p_emp_street, p_emp_brgy, p_emp_city, p_emp_prov);
  end if;
  return v_id;
end $$;

do $$
declare
  -- ===== settings =====
  v_count          int     := 50;
  v_domain         text    := 'catch-seed.test';
  v_password       text    := 'CatchSeed2524!';
  v_with_documents boolean := true;

  -- One scenario per application, oldest first (see the header). Repeats when v_count > 50.
  v_pattern text[] := array[
    'X1','X1','X1','X1','X1','X2','X2','X3','X3','X4','X4',
    'A1','A1','A1','A2','A2',
    'R1','R1','R1','R2','R2','R2',
    'E1','E1','E2','E2','E3','E3','E3','E4','E4',
    'C1','C1','C2','C2','C2','C3','C3',
    'I1','I2','I2','I3','I3','I4',
    'D1','D1','D2','D2','D3','D3'];

  -- ===== name / place pools (all fictional) =====
  v_male text[] := array['Juan','Jose','Mark','Christian','Rafael','Miguel','Carlo','Paolo','Angelo','Ramon',
    'Eduardo','Antonio','Gabriel','Daniel','Joshua','Francis','Leonardo','Vincent','Marvin','Rodel','Arnel','Jerome',
    'Noel','Dennis','Adrian'];
  v_female text[] := array['Maria','Ana','Kristine','Angelica','Patricia','Camille','Nicole','Jasmine','Liza',
    'Rowena','Maricel','Grace','Joanna','Bea','Katrina','Carmela','Diana','Sheila','Rachelle','Andrea','Hazel',
    'Lorraine','Michelle','Teresa','Janine'];
  v_lasts text[] := array['Santos','Reyes','Cruz','Bautista','Ocampo','Garcia','Mendoza','Torres','Tomas','Andrada',
    'Castillo','Flores','Villanueva','Ramos','Castro','Rivera','Aquino','Navarro','Salazar','Mercado','Aguilar',
    'Pascual','Soriano','Gonzales','Lopez','Manalo','Dizon','Valdez','Panganiban','Samonte','Domingo','Ilagan',
    'Cabrera','Marquez','Fernandez','Javier','Lim','Tan','Del Rosario','De Guzman'];
  v_cities text[] := array['Quezon City|Metro Manila|1100','Pasig City|Metro Manila|1600',
    'Makati City|Metro Manila|1200','Taguig City|Metro Manila|1630','Parañaque City|Metro Manila|1700',
    'Las Piñas City|Metro Manila|1740','Muntinlupa City|Metro Manila|1770','Marikina City|Metro Manila|1800',
    'Caloocan City|Metro Manila|1400','Antipolo City|Rizal|1870','Cainta|Rizal|1900','Bacoor City|Cavite|4102',
    'Imus City|Cavite|4103','Dasmariñas City|Cavite|4114','General Trias City|Cavite|4107',
    'Santa Rosa City|Laguna|4026','Biñan City|Laguna|4024','Calamba City|Laguna|4027',
    'San Fernando City|Pampanga|2000','Malolos City|Bulacan|3000','Meycauayan City|Bulacan|3020',
    'Lipa City|Batangas|4217','Batangas City|Batangas|4200','Cebu City|Cebu|6000','Mandaue City|Cebu|6014',
    'Davao City|Davao del Sur|8000','Iloilo City|Iloilo|5000'];
  v_brgys text[] := array['Brgy. San Isidro','Brgy. San Roque','Brgy. Poblacion','Brgy. Santo Niño',
    'Brgy. Bagong Silang','Brgy. Malanday','Brgy. San Antonio','Brgy. Mabini','Brgy. Maligaya','Brgy. Sta. Cruz'];
  v_streets text[] := array['Mabini Street','Rizal Avenue','Sampaguita Street','Acacia Lane','Narra Street',
    'Molave Street','Kamagong Street','Ilang-Ilang Street','Dahlia Street','Banaba Street'];
  v_employers text[] := array['Malaya Cold Chain Logistics, Inc.','Hiraya Food Ventures Corp.',
    'Kalinga Medical Center, Inc.','Bagwis Data Systems, Inc.','Silangan Shared Services Corp.',
    'Tanglaw Learning Academy, Inc.','Bituin Retail Holdings, Inc.','Dalisay Pharma Distribution Corp.',
    'Agos Water Solutions, Inc.','Banyuhay BPO Solutions, Inc.','Sinag Energy Services Corp.',
    'Habi Garments Manufacturing, Inc.','Lakan Construction & Development Corp.','Tala Contact Center, Inc.'];
  v_jobs text[] := array['Senior Accountant','HR Supervisor','Software Engineer','Operations Manager',
    'Registered Nurse','Sales Supervisor','Quality Assurance Analyst','Branch Supervisor','Payroll Specialist',
    'Logistics Coordinator','Customer Service Team Lead','Civil Engineer','Marketing Officer','IT Project Manager'];
  -- employer | job | street | city | country
  v_ofw text[] := array['Al Noor Facilities Management LLC|Facilities Engineer|Business Bay Tower 2|Dubai|United Arab Emirates',
    'Gulf Horizon Hospital|Staff Nurse|King Fahd Road|Riyadh|Saudi Arabia',
    'Pacific Rim Care Homes Ltd.|Senior Caregiver|Queen Street|Auckland|New Zealand',
    'Marina Bay Hospitality Pte. Ltd.|Front Office Supervisor|Raffles Boulevard|Singapore|Singapore'];
  v_sea text[] := array['Tala Maritime Crewing, Inc.','Bagwis Ship Management Phils., Inc.','Habagat Manning Agency Corp.'];
  v_sea_jobs text[] := array['Second Officer','Third Engineer','Chief Cook','Able Seaman','Electrician'];
  v_biz text[] := array['Dalisay Grocery & General Merchandise','JRC Auto Repair Shop','Likha Print & Signage',
    'Hiraya Bake Shop','Agos Water Refilling Station','Sinag Hardware & Construction Supply','Bituin Laundry Hub'];
  v_pro text[] := array['Dental Clinic|Dentist','Medical Clinic|Physician','Law Office|Lawyer',
    'Architecture Studio|Architect','Optical Clinic|Optometrist'];
  v_va text[] := array['Remote Assist Global LLC','Brightdesk Virtual Services','Northbridge Remote Staffing Inc.'];
  v_va_jobs text[] := array['Executive Virtual Assistant','Bookkeeping Virtual Assistant','Customer Support Virtual Assistant'];
  v_comm text[] := array['Luntian Homes Realty, Inc.','Tala Insurance Agency, Inc.','Bituin Auto Sales Corp.'];
  v_comm_jobs text[] := array['Real Estate Sales Agent','Insurance Financial Advisor','Car Sales Consultant'];
  v_banks text[] := array['Utopia Savings Bank','Northstar Commercial Bank','Harborview Thrift Bank',
    'Evergreen Rural Bank','Summit Peak Bank'];
  -- developer | project | property type
  v_devs text[] := array['Tahanang Pinoy Land Development Corp.|Sampaguita Hills Residences|House and Lot',
    'Luntian Homes Realty, Inc.|Luntian Grove Subdivision|House and Lot',
    'Alon Residences Development Corp.|Alon Bay Residences|Residential Condominium',
    'Tanaw Vertical Homes, Inc.|Tanaw Heights Condominium|Residential Condominium',
    'Mabuhay Townhomes Development Corp.|Mabuhay Townhomes|Townhouse',
    'Acacia Park Land, Inc.|Acacia Park Estates|House and Lot',
    'Hiyas Land Ventures Corp.|Hiyas Lot Estates|Residential Vacant Lot'];
  v_ref_rel text[] := array['Neighbor','Co-worker','Friend','Former supervisor','Relative','Business partner'];
  v_ladder text[] := array['DEPT_HEADS','CREDIT_DIVISION_AND_LENDING_DEPT','CREDIT_AND_LENDING_DIVISIONS',
    'PRESIDENT','PRESIDENT_AND_SCC_MEMBER','SENIOR_CREDIT_COMMITTEE','EXECUTIVE_COMMITTEE','BOARD'];

  -- ===== looked up once =====
  v_aos uuid[]; v_cis uuid[]; v_cos uuid[]; v_revs uuid[];
  v_items text[];
  v_p_hl smallint; v_p_condo smallint; v_p_lot smallint; v_p_reno smallint;
  v_make_accounts boolean := true;
  v_pool uuid[];
  v_no_login int := 0;
  v_skipped int := 0;
  v_apps bigint[] := '{}';
  v_occ jsonb := '{}';
  v_row record;
  v_j int;

  -- ===== per application =====
  i int; v_sc text; v_k int; v_level int; v_upto int;
  v_user uuid; v_email text; v_app bigint; v_status text;
  v_gender public.gender_type; v_first text; v_middle text; v_last text; v_full text;
  v_age int; v_dob date; v_married boolean; v_civil public.civil_status_type;
  v_city text; v_prov text; v_zip text; v_brgy text; v_street text; v_parts text[];
  v_hcity text; v_hprov text; v_hzip text;
  v_own public.home_ownership_type; v_rent numeric; v_move date; v_unit text;
  v_emp public.employment_type; v_employer text; v_job text; v_basis public.income_basis; v_factor numeric;
  v_ecity text; v_eprov text; v_estreet text;
  v_ten numeric; v_hired date; v_ten_y int; v_stay_y int; v_age_y int;
  v_reno boolean; v_ptype text; v_project text; v_dev text; v_owner text; v_channel public.referral_channel;
  v_purpose smallint; v_purpose_other text; v_prop_addr text; v_pcity text; v_pprov text; v_pzip text;
  v_tcp numeric; v_loan numeric; v_term int; v_rate numeric; v_fixing text; v_amort numeric;
  v_appraised numeric; v_lcr numeric; v_title text;
  v_has_auto boolean; v_auto numeric; v_has_sal boolean; v_sal numeric; v_has_short boolean;
  v_sp_sal boolean; v_sp_sal_amt numeric; v_exist numeric;
  v_has_card boolean; v_has_checking boolean; v_sp_card boolean;
  v_sp_emp boolean; v_n_cob int; v_target numeric; v_need numeric; v_sh_c numeric; v_sh_s numeric;
  v_inc_p numeric; v_inc_s numeric; v_inc_c numeric; v_total numeric; v_dbr numeric;
  v_ndep int; v_principal bigint; v_spouse bigint; v_cob bigint; v_cob_ids bigint[];
  v_sp_first text; v_sp_middle text; v_sp_maiden text; v_sp_gender public.gender_type; v_sp_dob date;
  v_sp_employer text; v_sp_job text; v_sp_hired date;
  v_cb_first text; v_cb_gender public.gender_type; v_cb_dob date; v_cb_hired date;
  v_d1 numeric; v_d2 numeric; v_d3 numeric; v_d4 numeric; v_d5 numeric; v_dret numeric; v_ago numeric;
  v_before numeric; v_nrev int; v_t0 timestamptz; v_sub date; v_t timestamptz; v_span numeric;
  v_t_ci timestamptz; v_t_ce timestamptz; v_t_rev timestamptz; v_t_ap timestamptz;
  v_ao uuid; v_co uuid; v_ci uuid; v_ao_name text; v_co_name text; v_ci_name text;
  v_visit bigint; v_req bigint; v_check bigint; v_check2 bigint; v_thread bigint;
  v_sections text[]; v_n int; v_s int; v_tk timestamptz; v_kyc_to timestamptz; v_q_section text; v_q text;
  v_find text; v_find_party bigint; v_party record; v_type text; v_result text; v_summary text;
  v_tu_count int; v_report date;
  v_result_fp public.credit_result; v_just text; v_deferrals text; v_terms text; v_exc_count int;
  v_bands jsonb; v_tier text; v_idx int;
  v_rev_ids uuid[]; v_asg bigint; v_dec bigint; v_note text; v_rev_name text;
  v_sev public.revision_severity; v_rmk text; v_item text;
  v_appr record; v_m int; v_action public.approval_action; v_cond text; v_outcome text;
begin
  -- ============================================================
  -- 1. Checks and look-ups
  -- ============================================================
  if to_regclass('public.kyc_clarifications') is null or to_regclass('public.ci_tu_accounts') is null
     or to_regclass('public.approval_decisions') is null or to_regclass('public.document_requests') is null then
    raise exception 'Run every migration in catch/supabase/migrations first (up to 20261206), then this file';
  end if;
  if exists (select 1 from applicants where role = 'PRINCIPAL' and email_address like '%@' || v_domain) then
    raise exception 'Seeded applications are already in the database: run seed_applications_cleanup.sql first';
  end if;

  select array_agg(id order by created_at, id) into v_aos from users
  where role = 'ACCOUNT_OFFICER' and is_active and not is_manager and staff_name(id) is not null;
  if v_aos is null then
    select array_agg(id order by created_at, id) into v_aos from users
    where role = 'ACCOUNT_OFFICER' and is_active and staff_name(id) is not null;
  end if;
  select array_agg(id order by created_at, id) into v_cos from users
  where role = 'CREDIT_OFFICER' and is_active and not is_manager and staff_name(id) is not null;
  if v_cos is null then
    select array_agg(id order by created_at, id) into v_cos from users
    where role = 'CREDIT_OFFICER' and is_active and staff_name(id) is not null;
  end if;
  select array_agg(id order by created_at, id) into v_cis from users
  where role = 'CREDIT_INVESTIGATOR' and is_active and staff_name(id) is not null;
  select array_agg(id order by created_at, id) into v_revs from users
  where role = 'REVIEWER' and is_active and staff_name(id) is not null;

  if v_aos is null or v_cos is null or v_cis is null or v_revs is null then
    raise exception 'Missing staff (with a completed staff profile): % % % %',
      case when v_aos is null then 'Account Officer' end, case when v_cos is null then 'Credit Officer' end,
      case when v_cis is null then 'Credit Investigator' end, case when v_revs is null then 'Reviewer' end;
  end if;
  if not exists (select 1 from unnest(v_ladder) t where pg_temp.covered(t::approval_tier)) then
    raise exception 'No approval authority can be met by the Approver accounts. In Staff Accounts, add Approvers with '
                    'positions (e.g. Credit Dept Head + Lending Dept Head, or Credit Division Head + Lending Dept Head)';
  end if;

  select array_agg(code order by sort_order) into v_items from review_check_items;
  select id into v_p_hl from loan_purposes where label = 'Purchase of House and Lot';
  select id into v_p_condo from loan_purposes where label = 'Purchase of Residential Condominium';
  select id into v_p_lot from loan_purposes where label = 'Purchase of Residential Vacant Lot';
  select id into v_p_reno from loan_purposes where label = 'House Renovation';

  -- ============================================================
  -- 2. One application per loop
  -- ============================================================
  for i in 1..v_count loop
    v_sc := v_pattern[1 + (i - 1) % cardinality(v_pattern)];
    v_occ := jsonb_set(v_occ, array[v_sc], to_jsonb(coalesce((v_occ ->> v_sc)::int, 0) + 1));
    v_k := (v_occ ->> v_sc)::int;
    v_level := case left(v_sc, 1) when 'D' then 0 when 'I' then 1 when 'C' then 2 when 'E' then 3
                                  when 'R' then 4 when 'A' then 5 else 6 end;
    v_upto := case v_sc when 'D1' then 1 when 'D2' then 2 when 'D3' then 3 else 9 end;

    -- ---------- timeline (days) ----------
    v_d1 := pg_temp.rng(0.3, 1.7, i, 'd1');
    v_d2 := pg_temp.rng(0.8, 3.2, i, 'd2');
    v_d3 := pg_temp.rng(1.0, 3.8, i, 'd3');
    v_d4 := pg_temp.rng(0.3, 1.7, i, 'd4');
    v_d5 := pg_temp.rng(0.5, 2.3, i, 'd5');
    v_dret := pg_temp.rng(0.6, 1.8, i, 'dret');
    v_nrev := case when cardinality(v_revs) >= 2 and (v_sc = 'R2' or pg_temp.r(i, 'nrev') < 0.6) then 2 else 1 end;
    v_ago := case when v_level = 6 then pg_temp.rng(1, 42, i, 'ago')
                  else 0.08 + power(pg_temp.r(i, 'ago'), 2)::numeric * 4.4 end;   -- days in the current stage
    v_before := case
      when v_level <= 1 then 0
      when v_level = 2 then v_d1
      when v_sc = 'E4' then v_d1 + v_d2 + v_d3 + v_d4
      when v_level = 3 then v_d1 + v_d2
      when v_level = 4 then v_d1 + v_d2 + v_d3
      when v_level = 5 then v_d1 + v_d2 + v_d3 + v_nrev * v_d4
      else v_d1 + v_d2 + v_d3 + v_nrev * v_d4 + v_d5 + case when v_sc = 'X2' then v_d4 + v_dret else 0 end end;
    v_t0 := now() - pg_temp.days(v_before + v_ago);                 -- submitted_at
    if v_level = 0 then v_t0 := now() - pg_temp.days(pg_temp.rng(0.2, 12, i, 'draft')); end if;   -- draft started
    v_sub := (v_t0 at time zone 'Asia/Manila')::date;

    -- ---------- principal ----------
    v_gender := (case when pg_temp.r(i, 'gender') < 0.5 then 'MALE' else 'FEMALE' end)::gender_type;
    v_first := pg_temp.pick(case when v_gender = 'MALE' then v_male else v_female end, i, 'first');
    v_last := pg_temp.pick(v_lasts, i, 'last');
    v_middle := pg_temp.pick(v_lasts, i, 'middle');
    if v_middle = v_last then v_middle := pg_temp.pick(v_lasts, i, 'middle2'); end if;
    v_full := concat_ws(' ', v_first, v_middle, v_last);
    v_age := 24 + floor(pg_temp.r(i, 'age') * 38)::int;
    v_dob := (v_sub - make_interval(years => v_age) - make_interval(days => floor(pg_temp.r(i, 'dob') * 300)::int))::date;
    v_married := pg_temp.r(i, 'married') < 0.55 and v_age >= 26;
    v_civil := (case when v_married then 'MARRIED' when pg_temp.r(i, 'civil') < 0.9 then 'SINGLE' else 'WIDOWED' end)::civil_status_type;
    v_email := translate(lower(v_first || '.' || replace(v_last, ' ', '')), 'ñ', 'n') || lpad(i::text, 2, '0') || '@' || v_domain;

    v_parts := string_to_array(pg_temp.pick(v_cities, i, 'city'), '|');
    v_city := v_parts[1]; v_prov := v_parts[2]; v_zip := v_parts[3];
    v_parts := string_to_array(pg_temp.pick(v_cities, i, 'home'), '|');
    v_hcity := v_parts[1]; v_hprov := v_parts[2]; v_hzip := v_parts[3];
    v_brgy := pg_temp.pick(v_brgys, i, 'brgy');
    v_street := pg_temp.pick(v_streets, i, 'street');
    v_unit := 'Blk ' || (1 + floor(pg_temp.r(i, 'blk') * 20))::int || ' Lot ' || (1 + floor(pg_temp.r(i, 'lot') * 40))::int;
    v_move := v_sub - (pg_temp.rng(0.6, 14, i, 'stay') * 365)::int;
    if v_move < v_dob + 6570 then v_move := v_dob + 6570; end if;   -- not before they turned 18

    -- employment
    v_emp := (case when pg_temp.r(i, 'emp') < 0.55 then 'LOCALLY_EMPLOYED' when pg_temp.r(i, 'emp') < 0.65 then 'OFW'
                   when pg_temp.r(i, 'emp') < 0.70 then 'SEAFARER' when pg_temp.r(i, 'emp') < 0.80 then 'SELF_EMPLOYED'
                   when pg_temp.r(i, 'emp') < 0.87 then 'LICENSED_PROFESSIONAL'
                   when pg_temp.r(i, 'emp') < 0.93 then 'VIRTUAL_ASSISTANT' else 'COMMISSION_BASED' end)::employment_type;
    v_ecity := v_city; v_eprov := v_prov; v_estreet := pg_temp.pick(v_streets, i, 'estreet');
    case v_emp
      when 'LOCALLY_EMPLOYED' then
        v_employer := pg_temp.pick(v_employers, i, 'employer'); v_job := pg_temp.pick(v_jobs, i, 'job'); v_basis := 'PAYSLIP';
      when 'OFW' then
        v_parts := string_to_array(pg_temp.pick(v_ofw, i, 'ofw'), '|');
        v_employer := v_parts[1]; v_job := v_parts[2]; v_estreet := v_parts[3]; v_ecity := v_parts[4]; v_eprov := v_parts[5];
        v_basis := 'COE';
      when 'SEAFARER' then
        v_employer := pg_temp.pick(v_sea, i, 'sea'); v_job := pg_temp.pick(v_sea_jobs, i, 'seajob'); v_basis := 'COE';
        v_ecity := 'Manila'; v_eprov := 'Metro Manila'; v_estreet := 'T.M. Kalaw Avenue';
      when 'SELF_EMPLOYED' then
        v_employer := pg_temp.pick(v_biz, i, 'biz'); v_job := 'Owner / Proprietor'; v_basis := 'DECLARED';
      when 'LICENSED_PROFESSIONAL' then
        v_parts := string_to_array(pg_temp.pick(v_pro, i, 'pro'), '|');
        v_employer := v_last || ' ' || v_parts[1]; v_job := v_parts[2]; v_basis := 'DECLARED';
      when 'VIRTUAL_ASSISTANT' then
        v_employer := pg_temp.pick(v_va, i, 'va'); v_job := pg_temp.pick(v_va_jobs, i, 'vajob'); v_basis := 'PAYSLIP';
      else
        v_employer := pg_temp.pick(v_comm, i, 'comm'); v_job := pg_temp.pick(v_comm_jobs, i, 'commjob'); v_basis := 'PAYSLIP';
    end case;
    v_factor := case v_basis when 'COE' then 0.8 when 'PAYSLIP' then 0.9 else 1 end;
    v_ten := case when pg_temp.r(i, 'short') < 0.12 then pg_temp.rng(1.1, 1.9, i, 'ten2')
                  else 2.2 + power(pg_temp.r(i, 'ten'), 1.4)::numeric * 17 end;
    v_ten := greatest(0.8, least(v_ten, v_age - 21));
    v_hired := v_sub - (v_ten * 365.25)::int;

    -- property and loan
    v_reno := pg_temp.r(i, 'prop') < 0.08;
    v_parts := string_to_array(pg_temp.pick(v_cities, i, 'pcity'), '|');
    v_pcity := v_parts[1]; v_pprov := v_parts[2]; v_pzip := v_parts[3];
    if v_reno then
      v_ptype := 'House and Lot'; v_purpose := v_p_reno; v_channel := 'BRANCH'; v_dev := null; v_project := null;
      v_owner := v_full; v_tcp := round(pg_temp.rng(2500000, 5500000, i, 'tcp'), -4);
      v_loan := round(pg_temp.rng(500000, 1500000, i, 'loan'), -4);
      v_pcity := v_city; v_pprov := v_prov; v_pzip := v_zip;
      v_prop_addr := concat_ws(', ', v_unit, v_street, v_brgy, v_city, v_prov || ' ' || v_zip);
    elsif pg_temp.r(i, 'prop') < 0.18 then
      v_ptype := 'House and Lot'; v_purpose := v_p_hl; v_channel := 'BROKER'; v_dev := null; v_project := null;
      v_owner := 'Spouses ' || pg_temp.pick(v_male, i, 'sellerm') || ' and ' || pg_temp.pick(v_female, i, 'sellerf')
                 || ' ' || pg_temp.pick(v_lasts, i, 'sellerl');
      v_tcp := round(pg_temp.rng(2200000, 6500000, i, 'tcp'), -4);
      v_prop_addr := concat_ws(', ', 'Lot ' || (1 + floor(pg_temp.r(i, 'plot') * 30))::int || ' ' || pg_temp.pick(v_streets, i, 'pst'),
                               pg_temp.pick(v_brgys, i, 'pbr'), v_pcity, v_pprov || ' ' || v_pzip);
    else
      v_parts := string_to_array(pg_temp.pick(v_devs, i, 'dev'), '|');
      v_dev := v_parts[1]; v_project := v_parts[2]; v_ptype := v_parts[3]; v_owner := v_dev;
      v_channel := (case when pg_temp.r(i, 'chan') < 0.85 then 'DEVELOPER' else 'AO' end)::referral_channel;
      v_purpose := case v_ptype when 'Residential Condominium' then v_p_condo when 'Residential Vacant Lot' then v_p_lot else v_p_hl end;
      v_tcp := round(case v_ptype when 'Residential Condominium' then pg_temp.rng(2800000, 7500000, i, 'tcp')
                                  when 'Townhouse' then pg_temp.rng(1800000, 3600000, i, 'tcp')
                                  when 'Residential Vacant Lot' then pg_temp.rng(900000, 2500000, i, 'tcp')
                                  else pg_temp.rng(2200000, 8000000, i, 'tcp') end, -4);
      v_prop_addr := case when v_ptype = 'Residential Condominium'
        then concat_ws(', ', 'Unit ' || (3 + floor(pg_temp.r(i, 'flr') * 25))::int || '-' || lpad((1 + floor(pg_temp.r(i, 'unit') * 20))::int::text, 2, '0')
                       || ' Tower ' || pg_temp.pick(array['A','B','C'], i, 'tower'), v_project, pg_temp.pick(v_brgys, i, 'pbr'), v_pcity, v_pprov || ' ' || v_pzip)
        else concat_ws(', ', 'Block ' || (1 + floor(pg_temp.r(i, 'pblk') * 15))::int || ' Lot ' || (1 + floor(pg_temp.r(i, 'plot') * 30))::int,
                       v_project, pg_temp.pick(v_brgys, i, 'pbr'), v_pcity, v_pprov || ' ' || v_pzip) end;
    end if;
    v_purpose_other := case when v_purpose is null then case when v_reno then 'House Renovation' else 'Purchase of ' || v_ptype end end;
    if not v_reno then v_loan := round(v_tcp * pg_temp.rng(0.6, 0.9, i, 'ltv'), -4); end if;
    v_term := (array[10, 15, 20, 25])[1 + floor(pg_temp.r(i, 'term') * 4)::int];
    while v_age + v_term > 70 and v_term > 5 loop v_term := v_term - 5; end loop;
    v_rate := (array[6.5, 7.0, 7.25, 7.5, 8.0])[1 + floor(pg_temp.r(i, 'rate') * 5)::int];
    v_fixing := pg_temp.pick(array['1 year', '3 years', '5 years'], i, 'fix');
    v_amort := round(pg_temp.pmt(v_loan, v_rate, v_term), 2);
    v_appraised := round(v_tcp * pg_temp.rng(0.94, 1.02, i, 'appr'), -3);
    v_lcr := v_loan / v_appraised;
    v_title := case when v_ptype = 'Residential Condominium' then 'CCT No. ' else 'TCT No. ' end
               || lpad((10 + i % 90)::text, 3, '0') || '-2025' || lpad((i * 7919 % 1000000)::text, 6, '0');

    -- obligations and income (the incomes are set so the DBR lands where the scenario needs it)
    v_has_auto := pg_temp.r(i, 'auto') < 0.3;   v_auto := round(pg_temp.rng(8000, 16000, i, 'autoamt'), -2);
    v_has_sal := pg_temp.r(i, 'sal') < 0.25;    v_sal := round(pg_temp.rng(900, 2500, i, 'salamt'), -1);
    v_has_short := pg_temp.r(i, 'shortloan') < 0.1;
    v_has_card := pg_temp.r(i, 'card') < 0.55;
    v_has_checking := v_emp in ('SELF_EMPLOYED', 'LICENSED_PROFESSIONAL') or pg_temp.r(i, 'chk') < 0.15;
    v_sp_emp := v_married and pg_temp.r(i, 'spemp') < 0.7;
    v_sp_sal := v_sp_emp and pg_temp.r(i, 'spsal') < 0.3; v_sp_sal_amt := round(pg_temp.rng(800, 2000, i, 'spsalamt'), -1);
    v_sp_card := v_married and pg_temp.r(i, 'spcard') < 0.3;
    v_n_cob := case when pg_temp.r(i, 'cob') < 0.72 then 0 when pg_temp.r(i, 'cob') < 0.93 then 1 else 2 end;
    v_exist := case when v_has_auto then v_auto else 0 end + case when v_has_sal then v_sal else 0 end
               + case when v_sp_sal then v_sp_sal_amt else 0 end;
    v_target := case
      when v_sc = 'X3' then pg_temp.rng(0.43, 0.52, i, 'dbr')
      when v_sc = 'X4' then pg_temp.rng(0.45, 0.58, i, 'dbr')
      when v_sc = 'E3' then pg_temp.rng(0.28, 0.38, i, 'dbr')
      when v_level >= 4 or v_sc = 'E4' then pg_temp.rng(0.18, 0.35, i, 'dbr')
      else pg_temp.rng(0.18, 0.45, i, 'dbr') end;
    v_need := (v_amort + v_exist) / v_target;                         -- total gross income after the basis factor
    v_sh_c := case when v_n_cob = 0 then 0 else pg_temp.rng(0.15, 0.25, i, 'shc') * v_n_cob end;
    v_sh_s := case when v_sp_emp then (1 - v_sh_c) * pg_temp.rng(0.25, 0.45, i, 'shs') else 0 end;
    v_inc_p := greatest(15000, round(v_need * (1 - v_sh_c - v_sh_s) / v_factor / 500) * 500);
    v_inc_s := case when v_sp_emp then greatest(12000, round(v_need * v_sh_s / 0.9 / 500) * 500) end;
    v_inc_c := case when v_n_cob > 0 then greatest(12000, round(v_need * v_sh_c / v_n_cob / 0.9 / 500) * 500) end;
    v_total := v_inc_p * v_factor + coalesce(v_inc_s, 0) * 0.9 + coalesce(v_inc_c, 0) * 0.9 * v_n_cob;
    v_dbr := (v_amort + v_exist) / v_total;

    -- home ownership (a renovation is on the house they own and live in)
    v_own := (case when v_reno then 'OWNED' when pg_temp.r(i, 'own') < 0.4 then 'RENTED'
                   when pg_temp.r(i, 'own') < 0.72 then 'LIVING_WITH_RELATIVES' when pg_temp.r(i, 'own') < 0.95 then 'OWNED'
                   else 'OTHER' end)::home_ownership_type;
    v_rent := case when v_own = 'RENTED' then round(pg_temp.rng(7000, 25000, i, 'rent'), -2) end;
    v_ndep := case when v_married then floor(pg_temp.r(i, 'dep') * 4)::int when pg_temp.r(i, 'dep') < 0.2 then 1 else 0 end;

    -- ---------- applicant account ----------
    v_user := null;
    if v_make_accounts then
      begin
        v_user := gen_random_uuid();
        insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                                raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                                confirmation_token, recovery_token, email_change_token_new, email_change)
        values ('00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated', v_email,
                extensions.crypt(v_password, extensions.gen_salt('bf')), v_t0 - interval '3 days',
                '{"provider": "email", "providers": ["email"]}', '{}', v_t0 - interval '3 days', v_t0 - interval '3 days',
                '', '', '', '');
        begin
          insert into auth.identities (user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
          values (v_user, v_user::text, jsonb_build_object('sub', v_user::text, 'email', v_email, 'email_verified', true),
                  'email', v_t0, v_t0 - interval '3 days', v_t0 - interval '3 days');
        exception when others then
          v_no_login := v_no_login + 1;
        end;
        insert into users (id) values (v_user) on conflict (id) do nothing;   -- in case the sign-up trigger is missing
        update users set phone_number = '0900' || lpad((i * 100 + 1)::text, 7, '0') where id = v_user;
        begin
          insert into user_profile (user_id, first_name, middle_name, last_name, gender, date_of_birth, birth_place,
                                    civil_status, citizenship, sss_no, tin)
          values (v_user, v_first, v_middle, v_last, v_gender, v_dob, v_hcity, v_civil, 'Filipino',
                  '39-' || lpad((i * 10 + 1)::text, 7, '0') || '-' || (i % 10),
                  '901-' || lpad(i::text, 3, '0') || '-' || lpad(((i * 37 + 1) % 1000)::text, 3, '0') || '-000');
        exception when unique_violation then null;
        end;
      exception when others then
        raise notice 'Could not create applicant logins here (%). Using the existing applicant accounts instead.', sqlerrm;
        v_make_accounts := false;
        v_user := null;
      end;
    end if;
    if v_user is null then
      if v_pool is null then
        select array_agg(id order by created_at, id) into v_pool from users where role = 'APPLICANT' and is_active;
        if v_pool is null then raise exception 'No applicant accounts to attach the applications to: sign one up first'; end if;
      end if;
      v_user := v_pool[1 + (i - 1) % cardinality(v_pool)];
      if v_level = 0 and exists (select 1 from loan_applications where user_id = v_user and status = 'DRAFT') then
        v_skipped := v_skipped + 1;
        continue;
      end if;
    end if;

    -- ---------- 1. Loan details ----------
    v_status := case v_level when 0 then 'DRAFT' when 1 then 'SUBMITTED' when 2 then 'UNDER_CI'
                  when 3 then 'UNDER_CREDIT_EVALUATION' when 4 then 'UNDER_REVIEW' when 5 then 'FOR_APPROVAL'
                  else case when v_sc in ('X1', 'X2') then 'APPROVED' else 'REJECTED' end end;
    insert into loan_applications (user_id, submitted_at, loan_purpose_id, loan_purpose_other, property_address,
                                   loan_amount, loan_term_years, interest_rate, fixing_period, status, created_at)
    values (v_user, case when v_level > 0 then v_t0 end, v_purpose, v_purpose_other, v_prop_addr, v_loan, v_term,
            case when v_level >= 4 or v_sc in ('E2', 'E3', 'E4') then v_rate end,
            case when v_level >= 4 or v_sc in ('E2', 'E3', 'E4') then v_fixing end,
            v_status::application_status,
            case when v_level > 0 then v_t0 - pg_temp.days(pg_temp.rng(0.3, 3, i, 'created')) else v_t0 end)
    returning id into v_app;
    v_apps := v_apps || v_app;

    -- ---------- 2. Principal borrower (+ dependents) ----------
    v_principal := pg_temp.add_party(v_app, 'PRINCIPAL', 1, null, v_first, v_middle, v_last, null, v_gender, v_dob,
      v_hcity, v_civil, '0900' || lpad((i * 100 + 1)::text, 7, '0'), v_email,
      '39-' || lpad((i * 10 + 1)::text, 7, '0') || '-' || (i % 10),
      '901-' || lpad(i::text, 3, '0') || '-' || lpad(((i * 37 + 1) % 1000)::text, 3, '0') || '-000',
      case when v_upto >= 2 then v_emp end, v_employer, v_job, v_hired, v_inc_p,
      '(02) 0000-' || lpad((i * 10 + 1)::text, 4, '0'),
      'hr@' || lower(regexp_replace(split_part(v_employer, ',', 1), '[^A-Za-z]', '', 'g')) || '.example',
      '0' || lpad((i * 13 + 100)::text, 2, '0') || '-' || lpad((i * 71 % 1000)::text, 3, '0') || '-' || lpad((i * 29 % 1000)::text, 3, '0') || '-00000',
      lpad((900000 + i * 10 + 1)::text, 8, '0'), v_city, v_estreet, pg_temp.pick(v_brgys, i, 'ebrgy'), v_ecity, v_eprov);
    insert into dependents (applicant_id, age)
    select v_principal, least(v_age - 18, 1 + floor(pg_temp.r(i, 'depage' || d) * 20)::int) from generate_series(1, v_ndep) d;

    -- ---------- 3. Addresses ----------
    if v_upto >= 2 then
      insert into addresses (applicant_id, address_type, unit_house_no, building_street, subdivision_barangay,
                             municipality_city, province, zip_code, living_in_ph, home_ownership, monthly_rent, date_move_in)
      values (v_principal, 'PRESENT', v_unit, v_street, v_brgy, v_city, v_prov, v_zip, true, v_own, v_rent, v_move),
             (v_principal, 'PERMANENT', 'Purok ' || (1 + i % 7), pg_temp.pick(v_streets, i, 'hst'),
              pg_temp.pick(v_brgys, i, 'hbr'), v_hcity, v_hprov, v_hzip, null, null, null, v_dob);
    end if;

    -- ---------- 5. Spouse ----------
    v_spouse := null;
    if v_married and v_upto >= 3 then
      v_sp_gender := (case when v_gender = 'MALE' then 'FEMALE' else 'MALE' end)::gender_type;
      v_sp_first := pg_temp.pick(case when v_sp_gender = 'MALE' then v_male else v_female end, i, 'spfirst');
      v_sp_maiden := case when v_sp_gender = 'FEMALE' then pg_temp.pick(v_lasts, i, 'spmaiden') end;
      v_sp_middle := coalesce(v_sp_maiden, pg_temp.pick(v_lasts, i, 'spmiddle'));
      v_sp_dob := v_dob + (floor(pg_temp.r(i, 'spage') * 9)::int - 4) * 365;
      if v_sp_dob > v_sub - 7300 then v_sp_dob := v_sub - 7300; end if;   -- at least 20
      v_sp_employer := pg_temp.pick(v_employers, i, 'spemployer');
      v_sp_job := pg_temp.pick(v_jobs, i, 'spjob');
      v_sp_hired := v_sub - (pg_temp.rng(1.5, 12, i, 'spten') * 365)::int;
      if v_sp_hired < v_sp_dob + 7300 then v_sp_hired := v_sp_dob + 7300; end if;
      v_spouse := pg_temp.add_party(v_app, 'SPOUSE', 1, null, v_sp_first, v_sp_middle, v_last, v_sp_maiden, v_sp_gender,
        v_sp_dob, split_part(pg_temp.pick(v_cities, i, 'spbirth'), '|', 1), 'MARRIED', '0900' || lpad((i * 100 + 2)::text, 7, '0'),
        translate(lower(v_sp_first || '.' || replace(v_last, ' ', '')), 'ñ', 'n') || lpad(i::text, 2, '0') || '.spouse@' || v_domain,
        '39-' || lpad((i * 10 + 2)::text, 7, '0') || '-' || ((i + 1) % 10),
        '902-' || lpad(i::text, 3, '0') || '-' || lpad(((i * 37 + 2) % 1000)::text, 3, '0') || '-000',
        case when v_sp_emp then 'LOCALLY_EMPLOYED' else 'UNEMPLOYED' end::employment_type,
        v_sp_employer, v_sp_job, v_sp_hired, v_inc_s, '(02) 0000-' || lpad((i * 10 + 2)::text, 4, '0'),
        'hr@' || lower(regexp_replace(split_part(v_sp_employer, ',', 1), '[^A-Za-z]', '', 'g')) || '.example',
        '0' || lpad((i * 17 + 100)::text, 2, '0') || '-' || lpad((i * 53 % 1000)::text, 3, '0') || '-' || lpad((i * 31 % 1000)::text, 3, '0') || '-00000',
        lpad((900000 + i * 10 + 2)::text, 8, '0'), v_city, pg_temp.pick(v_streets, i, 'spst'),
        pg_temp.pick(v_brgys, i, 'spbr'), v_city, v_prov);
      insert into addresses (applicant_id, address_type, same_as_principal) values (v_spouse, 'PRESENT', true);
    end if;

    -- ---------- 6. Co-borrowers (siblings) ----------
    v_cob_ids := '{}';
    if v_upto >= 3 then
      for v_j in 1..v_n_cob loop
        v_cb_gender := (case when pg_temp.r(i, 'cbg' || v_j) < 0.5 then 'MALE' else 'FEMALE' end)::gender_type;
        v_cb_first := pg_temp.pick(case when v_cb_gender = 'MALE' then v_male else v_female end, i, 'cbfirst' || v_j);
        v_cb_dob := v_dob + (floor(pg_temp.r(i, 'cbage' || v_j) * 13)::int - 6) * 365;
        if v_cb_dob > v_sub - 8030 then v_cb_dob := v_sub - 8030; end if;   -- at least 22
        v_cb_hired := v_sub - (pg_temp.rng(1.2, 10, i, 'cbten' || v_j) * 365)::int;
        if v_cb_hired < v_cb_dob + 7300 then v_cb_hired := v_cb_dob + 7300; end if;
        v_cob := pg_temp.add_party(v_app, 'CO_BORROWER', v_j, case when v_cb_gender = 'MALE' then 'Brother' else 'Sister' end,
          v_cb_first, v_middle, v_last, null, v_cb_gender, v_cb_dob, v_hcity, 'SINGLE',
          '0900' || lpad((i * 100 + 2 + v_j)::text, 7, '0'),
          translate(lower(v_cb_first || '.' || replace(v_last, ' ', '')), 'ñ', 'n') || lpad(i::text, 2, '0') || '.cob' || v_j || '@' || v_domain,
          '39-' || lpad((i * 10 + 2 + v_j)::text, 7, '0') || '-' || ((i + v_j + 1) % 10),
          (902 + v_j) || '-' || lpad(i::text, 3, '0') || '-' || lpad(((i * 37 + 2 + v_j) % 1000)::text, 3, '0') || '-000',
          'LOCALLY_EMPLOYED', pg_temp.pick(v_employers, i, 'cbemp' || v_j), pg_temp.pick(v_jobs, i, 'cbjob' || v_j),
          v_cb_hired, v_inc_c, '(02) 0000-' || lpad((i * 10 + 2 + v_j)::text, 4, '0'),
          'hr@' || lower(regexp_replace(split_part(pg_temp.pick(v_employers, i, 'cbemp' || v_j), ',', 1), '[^A-Za-z]', '', 'g')) || '.example',
          '0' || lpad((i * 19 + 100 + v_j)::text, 2, '0') || '-' || lpad((i * 43 % 1000)::text, 3, '0') || '-' || lpad((i * 61 % 1000)::text, 3, '0') || '-00000',
          lpad((900000 + i * 10 + 2 + v_j)::text, 8, '0'), v_city, pg_temp.pick(v_streets, i, 'cbst' || v_j),
          pg_temp.pick(v_brgys, i, 'cbbr' || v_j), v_city, v_prov);
        v_cob_ids := v_cob_ids || v_cob;
        if pg_temp.r(i, 'cbsame' || v_j) < 0.7 then
          insert into addresses (applicant_id, address_type, same_as_principal) values (v_cob, 'PRESENT', true);
        else
          v_parts := string_to_array(pg_temp.pick(v_cities, i, 'cbcity' || v_j), '|');
          insert into addresses (applicant_id, address_type, unit_house_no, building_street, subdivision_barangay,
                                 municipality_city, province, zip_code, living_in_ph, home_ownership, monthly_rent, date_move_in)
          values (v_cob, 'PRESENT', 'Unit ' || (1 + i % 9) || 'C', pg_temp.pick(v_streets, i, 'cbps' || v_j),
                  pg_temp.pick(v_brgys, i, 'cbpb' || v_j), v_parts[1], v_parts[2], v_parts[3], true, 'RENTED',
                  round(pg_temp.rng(6000, 15000, i, 'cbrent' || v_j), -2), v_sub - (pg_temp.rng(1, 6, i, 'cbmove' || v_j) * 365)::int);
        end if;
      end loop;
    end if;

    -- ---------- 7.-10. Obligations, references, collateral, referral ----------
    if v_upto >= 3 then
      insert into bank_accounts (applicant_id, bank_name, account_type, account_number)
      values (v_principal, pg_temp.pick(v_banks, i, 'bank'), 'Savings', '0000-' || lpad((i * 4111 % 10000)::text, 4, '0') || '-' || lpad(i::text, 4, '0'));
      if v_has_checking then
        insert into bank_accounts (applicant_id, bank_name, account_type, account_number)
        values (v_principal, pg_temp.pick(v_banks, i, 'bank2'), 'Checking', '1000-' || lpad((i * 2333 % 10000)::text, 4, '0') || '-' || lpad(i::text, 4, '0'));
      end if;
      if v_spouse is not null and v_sp_emp then
        insert into bank_accounts (applicant_id, bank_name, account_type, account_number)
        values (v_spouse, pg_temp.pick(v_banks, i, 'spbank'), 'Savings', '2000-' || lpad((i * 3571 % 10000)::text, 4, '0') || '-' || lpad(i::text, 4, '0'));
      end if;
      if v_has_auto then
        insert into existing_loans (applicant_id, loan_type, lending_institution, monthly_payment, term_over_6_months)
        values (v_principal, 'Auto Loan', pg_temp.pick(v_banks, i, 'autobank'), v_auto, true);
      end if;
      if v_has_sal then
        insert into existing_loans (applicant_id, loan_type, lending_institution, monthly_payment, term_over_6_months)
        values (v_principal, 'Salary Loan', 'Social Security System (SSS)', v_sal, true);
      end if;
      if v_has_short then
        insert into existing_loans (applicant_id, loan_type, lending_institution, monthly_payment, term_over_6_months)
        values (v_principal, 'Personal Loan', pg_temp.pick(v_banks, i, 'shortbank'), round(pg_temp.rng(2000, 5000, i, 'shortamt'), -2), false);
      end if;
      if v_sp_sal and v_spouse is not null then
        insert into existing_loans (applicant_id, loan_type, lending_institution, monthly_payment, term_over_6_months)
        values (v_spouse, 'Multi-Purpose Loan', 'Pag-IBIG Fund', v_sp_sal_amt, true);
      end if;
      if v_has_card then
        insert into credit_cards (applicant_id, issuing_bank, credit_limit, expiry_date)
        values (v_principal, pg_temp.pick(v_banks, i, 'cardbank'), round(pg_temp.rng(50000, 300000, i, 'limit'), -4),
                make_date(2027 + i % 4, 1 + i % 12, 1) + interval '1 month' - interval '1 day');
      end if;
      if v_sp_card and v_spouse is not null then
        insert into credit_cards (applicant_id, issuing_bank, credit_limit, expiry_date)
        values (v_spouse, pg_temp.pick(v_banks, i, 'spcardbank'), round(pg_temp.rng(30000, 120000, i, 'splimit'), -4),
                make_date(2027 + (i + 1) % 4, 1 + (i + 5) % 12, 1) + interval '1 month' - interval '1 day');
      end if;

      insert into character_references (application_id, reference_no, name, address, contact_number, relationship_to_principal)
      select v_app, n,
             pg_temp.pick(case when pg_temp.r(i, 'refg' || n) < 0.5 then v_male else v_female end, i, 'reff' || n) || ' '
               || pg_temp.pick(v_lasts, i, 'refm' || n) || ' ' || pg_temp.pick(v_lasts, i, 'refl' || n),
             concat_ws(', ', pg_temp.pick(v_streets, i, 'refs' || n), pg_temp.pick(v_brgys, i, 'refb' || n), v_city, v_prov),
             '0900' || lpad((i * 100 + 50 + n)::text, 7, '0'), pg_temp.pick(v_ref_rel, i, 'refr' || n)
      from generate_series(1, 3) n;

      insert into collateral_details (application_id, project_name, property_type, selling_price, registered_owner,
                                      tct_cct_no, lot_area, floor_area, contact_person, contact_number)
      values (v_app, v_project, v_ptype, v_tcp, v_owner, v_title,
              case when v_ptype = 'Residential Condominium' then null else round(pg_temp.rng(60, 220, i, 'lotarea')) end,
              case when v_ptype = 'Residential Vacant Lot' then null else round(pg_temp.rng(28, 160, i, 'floorarea')) end,
              case when v_reno then v_full else pg_temp.pick(v_female, i, 'cpf') || ' ' || pg_temp.pick(v_lasts, i, 'cpl') end,
              '0900' || lpad((i * 100 + 60)::text, 7, '0'));
      insert into referral_details (application_id, channel, developer_name, branch, referrer)
      values (v_app, v_channel, v_dev, split_part(v_pcity, ' City', 1) || ' Branch',
              case v_channel when 'DEVELOPER' then pg_temp.pick(v_male, i, 'refm') || ' ' || pg_temp.pick(v_lasts, i, 'refln') || ' (seller)'
                             when 'BROKER' then pg_temp.pick(v_female, i, 'brk') || ' ' || pg_temp.pick(v_lasts, i, 'brkl') || ' (licensed broker)'
                             when 'AO' then 'Walk-in, referred by the Account Officer'
                             else 'Walk-in client' end);

      -- 11. Checklist rows (what sync_requirements() makes) and the files
      insert into application_requirements (applicant_id, requirement_type)
      select a.id, t
      from applicants a
      join employment_info e on e.applicant_id = a.id
      cross join lateral unnest(required_documents(e.employment_type, v_loan)) as t
      where a.application_id = v_app and a.role in ('PRINCIPAL', 'SPOUSE', 'CO_BORROWER')
      on conflict (applicant_id, requirement_type) do nothing;

      if v_with_documents then
        insert into documents (application_id, applicant_id, requirement_id, document_type, file_name, file_path,
                               uploaded_by, uploaded_at)
        select v_app, a.id, ar.id, ar.requirement_type::text,
               case ar.requirement_type
                 when 'VALID_ID_PASSPORT' then case when f = 1 then 'valid_id_front.jpg' else 'second_valid_id.jpg' end
                 when 'COE_ITR' then case when e.employment_type = 'SELF_EMPLOYED' then 'itr_2025.pdf' else 'certificate_of_employment.pdf' end
                 when 'PAYSLIPS_REMITTANCES' then case when e.employment_type = 'OFW' then 'remittance_' else 'payslip_' end
                                                   || to_char(v_sub - 30 * f, 'FMmonth') || '.pdf'
                 when 'FS_BANK_STATEMENTS' then 'bank_statements_6_months.pdf'
                 when 'SEC_DTI_MAYORS_PERMIT' then 'dti_and_mayors_permit.pdf'
                 else 'special_power_of_attorney.pdf' end,
               v_user || '/' || v_app || '/seed-' || ar.id || '-' || f
                 || case when ar.requirement_type = 'VALID_ID_PASSPORT' then '.jpg' else '.pdf' end,
               v_user, v_t0 - pg_temp.days(pg_temp.rng(0.05, 1.5, i, 'up' || ar.id || f))
        from applicants a
        join application_requirements ar on ar.applicant_id = a.id
        join employment_info e on e.applicant_id = a.id
        cross join lateral generate_series(1, case ar.requirement_type when 'VALID_ID_PASSPORT' then 2
                                                    when 'PAYSLIPS_REMITTANCES' then 3 else 1 end) f
        where a.application_id = v_app
          -- D3 = blocked at submission: the principal uploaded one ID only
          and (v_level > 0 or (a.role = 'PRINCIPAL' and ar.requirement_type = 'VALID_ID_PASSPORT' and f = 1))
        order by a.id, ar.id, f;
        if v_level = 0 then update documents set uploaded_at = v_t0 + interval '20 minutes' where application_id = v_app; end if;
      end if;
    end if;

    if v_level = 0 then continue; end if;   -- drafts end here

    -- ============================================================
    -- Intake (submission auto-assigns the AO and the CO, like open_intake_on_submit)
    -- ============================================================
    v_ao := null; v_co := null;
    v_ci := v_cis[1 + (i - 1) % cardinality(v_cis)];
    v_ci_name := staff_name(v_ci);
    v_visit := pg_temp.open_stage(v_app, 'INTAKE', v_t0);
    perform pg_temp.set_status(v_visit, 'PENDING', v_t0, v_user, null);
    if v_sc <> 'I1' then   -- I1 = nobody was available: the Manager still has to assign it
      v_ao := v_aos[1 + (i - 1) % cardinality(v_aos)];
      v_co := v_cos[1 + (i - 1) % cardinality(v_cos)];
      v_ao_name := staff_name(v_ao); v_co_name := staff_name(v_co);
      insert into application_assignments (application_id, assignee_role, user_id, assigned_by, assigned_at)
      values (v_app, 'ACCOUNT_OFFICER', v_ao, null, v_t0 + interval '1 minute'),
             (v_app, 'CREDIT_OFFICER', v_co, null, v_t0 + interval '1 minute');
      perform pg_temp.set_status(v_visit, 'IN_PROGRESS', v_t0 + interval '1 minute', null,
                                 'Auto-assigned to ' || v_ao_name || ' (balanced workload)');
    else
      continue;
    end if;

    -- KYC checks, section by section (the loan folder's step keys)
    v_sections := array['loan', 'principalInfo', 'principalAddress', 'principalEmployment', 'spouse', 'coBorrowers']
                  || array(select 'coBorrower-' || n from generate_series(1, v_n_cob) n)
                  || array['mortgagor', 'obligations', 'references', 'collateral', 'documents'];
    v_n := cardinality(v_sections);
    v_kyc_to := v_t0 + pg_temp.days(case when v_level = 1 then v_ago * 0.85 else v_d1 * 0.8 end);
    v_q_section := case when v_sc = 'I3' then case when v_k % 2 = 1 then 'principalEmployment' else 'principalAddress' end
                        when i % 5 = 0 then 'principalAddress' end;   -- i % 5 = 0: a question that was closed
    for v_s in 1..v_n loop
      exit when v_sc = 'I2' and v_s > v_n / 2;
      v_tk := v_t0 + interval '30 minutes' + (v_kyc_to - v_t0 - interval '30 minutes') * (v_s::float8 / (v_n + 1));
      if v_sections[v_s] is distinct from v_q_section then
        insert into kyc_checks (application_id, section, result, remarks, checked_by, checked_at)
        values (v_app, v_sections[v_s], 'VERIFIED',
                case v_sections[v_s] when 'principalInfo' then 'Name, birth date and SSS / TIN match the two valid IDs.'
                                     when 'documents' then 'Every required document is complete and readable.' end,
                v_ao, v_tk);
        continue;
      end if;
      v_q := case v_q_section
        when 'principalEmployment' then format('Your form says you were hired on %s, but your Certificate of Employment says %s. Which date is correct? If the form is wrong, please reply with the correct date.',
                                               to_char(v_hired, 'MM/DD/YYYY'), to_char(v_hired + 61, 'MM/DD/YYYY'))
        else 'Your valid ID shows a different address from the present address on your form. Please confirm where you live now. If you moved recently, please upload a barangay certificate of residency.' end;
      insert into kyc_checks (application_id, section, result, remarks, checked_by, checked_at)
      values (v_app, v_q_section, 'NEEDS_CLARIFICATION', v_q, v_ao, v_tk) returning id into v_check;
      if v_sc = 'I3' then
        insert into kyc_clarifications (application_id, section, opened_check_id, status, opened_by, opened_at)
        values (v_app, v_q_section, v_check, 'OPEN', v_ao, v_tk) returning id into v_thread;
        insert into kyc_clarification_messages (clarification_id, application_id, author_id, author_role, body, created_at)
        values (v_thread, v_app, v_ao, 'ACCOUNT_OFFICER', v_q, v_tk);
        if v_k % 2 = 0 then   -- the applicant answered; now it's the AO's turn
          insert into kyc_clarification_messages (clarification_id, application_id, author_id, author_role, body, created_at)
          values (v_thread, v_app, v_user, 'APPLICANT',
                  format('I moved to %s in %s. My ID still shows my old address. I will upload my barangay certificate of residency today.',
                         v_city, to_char(v_move, 'FMMonth YYYY')),
                  v_tk + (now() - v_tk) * 0.5);
        end if;
      else   -- answered and closed before the CI request
        insert into kyc_checks (application_id, section, result, remarks, checked_by, checked_at)
        values (v_app, v_q_section, 'VERIFIED', 'Question closed after the applicant''s reply. Barangay certificate of residency received.',
                v_ao, v_tk + (v_kyc_to - v_tk) * 0.6) returning id into v_check2;
        insert into kyc_clarifications (application_id, section, opened_check_id, status, opened_by, opened_at,
                                        closed_check_id, closed_by, closed_at)
        values (v_app, v_q_section, v_check, 'CLOSED', v_ao, v_tk, v_check2, v_ao, v_tk + (v_kyc_to - v_tk) * 0.6)
        returning id into v_thread;
        insert into kyc_clarification_messages (clarification_id, application_id, author_id, author_role, body, created_at)
        values (v_thread, v_app, v_ao, 'ACCOUNT_OFFICER', v_q, v_tk),
               (v_thread, v_app, v_user, 'APPLICANT',
                format('I moved to %s in %s. My ID still shows my old address. I uploaded my barangay certificate of residency.',
                       v_city, to_char(v_move, 'FMMonth YYYY')), v_tk + (v_kyc_to - v_tk) * 0.3);
      end if;
    end loop;

    if v_level = 1 then continue; end if;

    -- ============================================================
    -- Credit Investigation (request_ci)
    -- ============================================================
    v_t_ci := v_t0 + pg_temp.days(v_d1);
    perform pg_temp.set_status(v_visit, 'DONE', v_t_ci, v_ao, 'CI requested by ' || v_ao_name);
    perform pg_temp.close_stage(v_visit, v_t_ci);
    v_visit := pg_temp.open_stage(v_app, 'CREDIT_INVESTIGATION', v_t_ci);
    perform pg_temp.set_status(v_visit, 'REQUESTED', v_t_ci, v_ao, 'CI requested by ' || v_ao_name);
    insert into ci_requests (application_id, stage_visit_id, requested_by, requested_at, nfis_remarks, tu_remarks)
    values (v_app, v_visit, v_ao, v_t_ci,
            case when v_spouse is not null then 'Please include the spouse.' end,
            case when v_n_cob > 0 then 'Co-borrower IDs are in the Documents folder.' end)
    returning id into v_req;

    if v_sc = 'C1' then continue; end if;

    v_span := case when v_level = 2 then v_ago else v_d2 end;
    perform pg_temp.set_status(v_visit, 'IN_PROGRESS', v_t_ci + pg_temp.days(v_span * 0.15), v_ci, 'Started by ' || v_ci_name);
    v_report := (v_t_ci + pg_temp.days(v_span * 0.5))::date;

    -- Adverse findings, by scenario
    v_find := case
      when v_sc = 'E3' then case when v_k % 3 = 0 then 'TU_LATE' else 'CARD_UNPAID' end
      when v_sc = 'C3' then case when v_k % 2 = 1 then 'CARD_UNPAID' else 'TU_LATE' end
      when v_sc = 'X4' then 'CARD_UNPAID'
      when v_sc = 'X3' then 'TU_LATE'
      when (v_sc = 'X1' and v_k in (2, 4)) or (v_sc = 'A1' and v_k = 2) or (v_sc = 'R2' and v_k = 1) then 'CARD_SETTLED'
      else 'NONE' end;
    v_find_party := case when v_find like 'CARD%' then coalesce(v_spouse, v_principal) else v_principal end;
    v_tu_count := 0;

    for v_party in
      select a.id, a.role, a.party_no from applicants a
      where a.application_id = v_app and a.role in ('PRINCIPAL', 'SPOUSE', 'CO_BORROWER')
      order by case a.role when 'PRINCIPAL' then 0 when 'SPOUSE' then 1 else 2 end, a.party_no
    loop
      exit when v_sc = 'C2' and v_party.role <> 'PRINCIPAL';   -- partly done: only the principal's results are in
      foreach v_type in array case when v_party.role = 'PRINCIPAL' then array['NFIS', 'TU', 'BRAS'] else array['NFIS', 'TU'] end loop
        exit when v_sc = 'C2' and v_type = 'BRAS';
        v_result := 'NO_ADVERSE_FINDINGS';
        v_summary := case v_type when 'NFIS' then 'No adverse record found.' when 'BRAS' then 'No negative record in BRAS.' end;
        if v_type = 'NFIS' and v_party.id = v_find_party and v_find in ('CARD_UNPAID', 'CARD_SETTLED') then
          v_result := 'WITH_FINDINGS';
          v_summary := format('Cancelled credit card reported by %s on 03/15/2021; %s.', pg_temp.pick(v_banks, i, 'nfisbank'),
                              case when v_find = 'CARD_UNPAID' then 'PHP 38,450.20 unpaid as reported'
                                   else 'fully paid on 06/22/2021 per the certificate of full payment' end);
          insert into ci_nfis_records (applicant_id, record_type, institution, date_reported, date_closed,
                                       outstanding_balance, settlement, remarks)
          values (v_party.id, 'CANCELLED_CARD', pg_temp.pick(v_banks, i, 'nfisbank'), '2021-03-15',
                  case when v_find = 'CARD_SETTLED' then date '2021-06-22' end,
                  case when v_find = 'CARD_UNPAID' then 38450.20 else 0 end,
                  case when v_find = 'CARD_UNPAID' then 'UNPAID' else 'FULLY_PAID' end::ci_settlement,
                  case when v_find = 'CARD_UNPAID' then 'Not declared in the KYC.' else 'Certificate of full payment on file.' end);
        end if;
        if v_type = 'TU' then
          insert into ci_tu_accounts (applicant_id, is_open, lender_type, lender_name, account_type, ownership, status,
                                      opened_on, maturity_on, original_amount, balance, past_due, installment, max_dpd, legal_action)
          select v_party.id, true, case when l.lending_institution ~ 'SSS|Pag-IBIG' then 'GOVERNMENT' else 'BANK' end,
                 l.lending_institution, upper(l.loan_type), 'INDIVIDUAL', 'CURRENT', v_sub - 540, v_sub + 900,
                 round(l.monthly_payment * 48, -3), round(l.monthly_payment * 30, -3), 0, l.monthly_payment, 0, false
          from existing_loans l where l.applicant_id = v_party.id;
          insert into ci_tu_accounts (applicant_id, is_open, lender_type, lender_name, account_type, ownership, status,
                                      opened_on, credit_limit, balance, past_due, installment, max_dpd, legal_action)
          select v_party.id, true, 'BANK', c.issuing_bank, 'CREDIT CARD', 'INDIVIDUAL',
                 case when v_find = 'TU_LATE' and v_party.id = v_find_party then 'PAST_DUE' else 'CURRENT' end::ci_tu_account_status,
                 v_sub - 1400, c.credit_limit, round(c.credit_limit * 0.18, -2),
                 case when v_find = 'TU_LATE' and v_party.id = v_find_party then 4200 else 0 end,
                 round(c.credit_limit * 0.18 * 0.05, -1),
                 case when v_find = 'TU_LATE' and v_party.id = v_find_party then 25 else 0 end, false
          from credit_cards c where c.applicant_id = v_party.id;
          if v_find = 'TU_LATE' and v_party.id = v_find_party
             and not exists (select 1 from credit_cards where applicant_id = v_party.id) then
            insert into ci_tu_accounts (applicant_id, is_open, lender_type, lender_name, account_type, ownership, status,
                                        opened_on, credit_limit, balance, past_due, installment, max_dpd, legal_action)
            values (v_party.id, true, 'BANK', pg_temp.pick(v_banks, i, 'tucard'), 'CREDIT CARD', 'INDIVIDUAL', 'PAST_DUE',
                    v_sub - 1400, 60000, 21300, 4200, 1070, 25, false);
          end if;
          select count(*) into v_n from ci_tu_accounts where applicant_id = v_party.id;
          v_tu_count := v_tu_count + v_n;
          v_result := case when exists (select 1 from ci_tu_accounts where applicant_id = v_party.id and status = 'PAST_DUE')
                           then 'WITH_FINDINGS' else 'NO_ADVERSE_FINDINGS' end;
          v_summary := case when v_result = 'WITH_FINDINGS' then 'Credit card 25 days past due (PHP 4,200.00); other accounts current.'
                            when v_n = 0 then 'No credit accounts on file.'
                            else v_n || ' open account/s, all current.' end;
        end if;
        insert into ci_checks (applicant_id, check_type, result, summary, report_date)
        values (v_party.id, v_type::ci_check_type, v_result::ci_check_result, v_summary, v_report);
      end loop;
    end loop;

    if v_level = 2 then continue; end if;   -- C2 / C3 stay in Credit Investigation

    update ci_requests set ci_remarks = case
        when v_find = 'NONE' then 'NFIS, TU and BRAS done for every borrower. No adverse findings.'
        when v_find = 'CARD_SETTLED' then 'NFIS shows a cancelled credit card, fully paid (certificate of full payment on file). TU and BRAS clear.'
        when v_find = 'CARD_UNPAID' then 'NFIS shows a cancelled credit card with an unpaid balance that was not declared in the KYC. Please check with the applicant.'
        else 'TU shows a credit card 25 days past due. NFIS and BRAS clear.' end
    where id = v_req;
    v_t_ce := v_t_ci + pg_temp.days(v_d2);
    perform pg_temp.set_status(v_visit, 'DONE', v_t_ce, v_ci, 'CI done by ' || v_ci_name);
    perform pg_temp.close_stage(v_visit, v_t_ce);

    -- ============================================================
    -- Credit Evaluation (complete_ci opens it In Progress; the CO is already assigned)
    -- ============================================================
    v_visit := pg_temp.open_stage(v_app, 'CREDIT_EVALUATION', v_t_ce);
    perform pg_temp.set_status(v_visit, 'IN_PROGRESS', v_t_ce, v_ci, 'CI done by ' || v_ci_name);

    if v_sc = 'E1' then continue; end if;

    v_span := case when v_level = 3 and v_sc <> 'E4' then v_ago else v_d3 end;
    v_ten_y := pg_temp.years_between(v_hired, v_sub);
    v_stay_y := pg_temp.years_between(v_move, v_sub);
    v_age_y := pg_temp.years_between(v_dob, v_sub);

    -- IX. income basis per borrower; VIII. employment verification
    insert into fp_party_details (applicant_id, income_basis, other_income, employment_remarks, cash_flow_remarks)
    select a.id,
           case when a.role = 'PRINCIPAL' then v_basis
                when e.employment_type = 'UNEMPLOYED' then null else 'PAYSLIP' end,
           0,
           case when e.employment_type = 'UNEMPLOYED' then 'No employment (spouse is a homemaker).'
                when e.employment_type in ('SELF_EMPLOYED', 'LICENSED_PROFESSIONAL')
                  then 'Business / practice verified: registration and Mayor''s permit valid; seen during the field CI.'
                else format('Verified with %s HR by phone on %s: %s since %s.', e.employer_business_name,
                            to_char(v_t_ce + interval '1 day', 'MM/DD/YYYY'), e.occupation, to_char(e.employment_date, 'MM/DD/YYYY')) end,
           case when e.employment_type = 'UNEMPLOYED' then null
                else format('Gross monthly income %s on a %s basis.', pg_temp.peso(e.gross_monthly_income),
                            case when a.role = 'PRINCIPAL' then lower(v_basis::text) else 'payslip' end) end
    from applicants a join employment_info e on e.applicant_id = a.id
    where a.application_id = v_app and a.role in ('PRINCIPAL', 'SPOUSE', 'CO_BORROWER');

    -- V. Exceptions (any row = a deviation: the approval authority goes one step up)
    insert into fp_exceptions (application_id, policy, exception_recommendation, mitigant)
    select v_app, x.policy, x.rec, x.mit
    from (values
      (v_dbr > 0.40, 'DBR shall not exceed 40% of the total gross monthly income.',
       'DBR of ' || to_char(v_dbr * 100, 'FM990.00') || '%.',
       'Stable income with the same employer; no other loans with past dues.'),
      (v_ten_y < 2, 'Minimum of 2 years continuous employment / business operation.',
       'Principal has been with the present employer for less than 2 years.',
       'Regular employee per the COE; same line of work with the previous employer.'),
      (v_lcr > 0.80, 'Loan-to-collateral ratio shall not exceed 80% of the appraised value.',
       'LCR of ' || to_char(v_lcr * 100, 'FM990.00') || '%.',
       'Developer buy-back guarantee until the title is transferred.'),
      (v_age_y + v_term > 65, 'Age at loan maturity shall not exceed 65 years.',
       'Principal will be ' || (v_age_y + v_term) || ' at maturity.',
       'Mortgage redemption insurance for the full term; co-borrower / spouse income supports the amortization.')
    ) x (applies, policy, rec, mit)
    where x.applies;
    get diagnostics v_exc_count = row_count;

    v_result_fp := case when v_sc = 'E2' then null when v_sc = 'E3' then 'DEFERRED'
                        when v_sc = 'X4' then 'NOT_ENDORSED' else 'ENDORSED' end;
    v_deferrals := case when v_sc = 'E3' then case when v_find = 'CARD_UNPAID'
        then 'Certificate of full payment (or proof of settlement) for the cancelled credit card in the NFIS. Asked the AO to get it from the applicant on '
             || to_char(v_t_ce + pg_temp.days(v_span * 0.7), 'MM/DD/YYYY') || '.'
        else 'Explanation letter and proof of updated payment for the past-due credit card in the TU report.' end end;
    v_just := case v_result_fp
      when 'ENDORSED' then format('Endorsed. DBR of %s%% and LCR of %s%%; %s year/s with the present employer; CI %s.%s',
                                  to_char(v_dbr * 100, 'FM990.00'), to_char(v_lcr * 100, 'FM990.00'), v_ten_y,
                                  case when v_find = 'NONE' then 'shows no adverse findings'
                                       when v_find = 'CARD_SETTLED' then 'shows a cancelled card, fully settled'
                                       else 'shows a past-due card, since updated' end,
                                  case when v_exc_count > 0 then ' Exception/s in V. with mitigants.' else '' end)
      when 'NOT_ENDORSED' then format('Not endorsed. DBR of %s%% is above the 40%% ceiling, and the NFIS shows an unsettled cancelled credit card that was not declared.',
                                      to_char(v_dbr * 100, 'FM990.00'))
      when 'DEFERRED' then 'Deferred until the CI finding is cleared (see Deferrals).' end;
    v_terms := concat_ws(E'\n',
      format('1. Loan amount of %s payable in %s years at %s%% p.a., fixed for %s; repriced yearly after.',
             pg_temp.peso(v_loan), v_term, to_char(v_rate, 'FM990.00'), v_fixing),
      format('2. Monthly amortization of %s through auto-debit.', pg_temp.peso(v_amort)),
      format('3. Real estate mortgage over %s.', v_title),
      '4. Fire insurance and mortgage redemption insurance assigned to the Bank.',
      '5. Original owner''s duplicate of the title to be submitted before release.');

    insert into financial_packages (application_id, date_prepared, dosri_rpt, variant, manner_of_repayment,
                                    appraised_value, date_of_appraisal, terms_and_conditions, credit_result,
                                    justification, deferrals)
    values (v_app, (v_t_ce + pg_temp.days(v_span * 0.6))::date, false, 'Regular Housing Loan',
            pg_temp.pick(array['Auto-debit arrangement (ADA)', 'Post-dated checks (PDCs)'], i, 'repay'),
            v_appraised, (v_t_ce + pg_temp.days(v_span * 0.4))::date,
            case when v_sc <> 'E2' then v_terms end, v_result_fp, v_just, v_deferrals);

    insert into fp_deposit_checks (application_id, bank_name, account_name, account_type, account_number, amd, adb, remarks)
    select v_app, b.bank_name, concat_ws(' ', a.first_name, a.last_name), b.account_type, b.account_number,
           round(coalesce(e.gross_monthly_income, 0) * pg_temp.rng(0.85, 1.3, i, 'amd' || b.id), -2),
           round(coalesce(e.gross_monthly_income, 0) * pg_temp.rng(0.4, 2.5, i, 'adb' || b.id), -2),
           case when b.account_type = 'Checking' then 'No returned checks in the last 12 months.' else 'Salary / operating account.' end
    from bank_accounts b join applicants a on a.id = b.applicant_id left join employment_info e on e.applicant_id = a.id
    where a.application_id = v_app;
    insert into fp_loan_checks (application_id, bank_name, facility, original_loan, outstanding_balance, amortization,
                                contract_date, maturity_date, remarks)
    select v_app, l.lending_institution, l.loan_type, round(l.monthly_payment * 48, -3), round(l.monthly_payment * 30, -3),
           l.monthly_payment, v_sub - 540, v_sub + 900,
           case when l.term_over_6_months then 'Declared in the KYC; current per TU.' else 'Declared; 6 months or less left (not in DBR).' end
    from existing_loans l join applicants a on a.id = l.applicant_id where a.application_id = v_app;
    if v_level >= 4 or v_sc = 'E4' then
      insert into fp_title_verifications (application_id, title_kind, title_no, registered_owner, date_of_verification,
                                          place_of_verification, mode_of_conveyance, date_of_inscription, remarks)
      values (v_app, 'PRESENT', v_title, v_owner, (v_t_ce + pg_temp.days(v_span * 0.3))::date,
              'Registry of Deeds, ' || v_pcity, 'Deed of Absolute Sale', v_sub - 700, 'Clean title; no adverse annotation.');
    end if;

    -- Credit score (bands as the credit score page suggests them; E2 has only Capacity scored so far)
    v_bands := jsonb_build_object(
      'DBR', case when v_dbr < 0.26 then 'BELOW_26' when v_dbr < 0.34 then 'FROM_26_TO_33' when v_dbr <= 0.40 then 'FROM_34_TO_40' else 'ABOVE_40' end,
      'NDI', case when v_total < 40000 then 'BELOW_40K' when v_total < 60000 then 'FROM_40K' when v_total < 80000 then 'FROM_60K'
                  when v_total < 100000 then 'FROM_80K' else 'FROM_100K' end,
      'TENURE', case when v_ten_y < 2 then 'BELOW_2' when v_ten_y <= 3 then 'FROM_2_TO_3' when v_ten_y <= 5 then 'FROM_3_TO_5' else 'ABOVE_5' end,
      'INCOME_SOURCE', case v_emp when 'OFW' then 'OFW' when 'SEAFARER' then 'SEAFARER'
                                  when 'SELF_EMPLOYED' then 'SELF_EMPLOYED' when 'LICENSED_PROFESSIONAL' then 'SELF_EMPLOYED'
                                  else 'LOCALLY_EMPLOYED' end,
      'LOAN_HISTORY', case when v_find = 'TU_LATE' then 'FAIR' when v_tu_count > 0 then 'GOOD' else 'NONE' end,
      'DEPOSIT_HANDLING', case when v_has_checking then 'GOOD' else 'SAVINGS_ONLY' end,
      'NFIS', case v_find when 'CARD_UNPAID' then 'CANCELLED_CARD_UNSETTLED' when 'CARD_SETTLED' then 'CANCELLED_CARD_SETTLED' else 'NO_ADVERSE' end,
      'COLLATERAL_VALUE', case when v_appraised < 1000000 then 'BELOW_1M' when v_appraised <= 3000000 then 'FROM_1M_TO_3M' else 'ABOVE_3M' end,
      'COLLATERAL_TYPE', case v_ptype when 'Residential Condominium' then 'CONDOMINIUM' when 'Townhouse' then 'TOWNHOUSE'
                                      when 'Residential Vacant Lot' then 'VACANT_LOT' else 'HOUSE_AND_LOT' end,
      'PROPERTY_USAGE', case when v_reno then 'EXISTING_PRIMARY' else 'FOR_PRIMARY' end,
      'LCR', case when v_lcr < 0.6 then 'BELOW_60' when v_lcr <= 0.8 then 'FROM_60_TO_80' else 'ABOVE_80' end,
      'DEPENDENTS', case when v_ndep < 2 then 'ONE_OR_NONE' when v_ndep <= 3 then 'TWO_TO_THREE' else 'MORE_THAN_THREE' end,
      'LENGTH_OF_STAY', case when v_stay_y < 2 then 'ONE_DOWN' when v_stay_y < 4 then 'TWO_TO_THREE' when v_stay_y < 6 then 'FOUR_TO_FIVE' else 'SIX_UP' end,
      'AGE', case when v_age_y < 25 or v_age_y > 65 then 'OUTSIDE_25_65' when v_age_y < 36 then 'FROM_25_TO_35'
                  when v_age_y < 46 then 'FROM_36_TO_45' else 'FROM_46_TO_65' end,
      'CIVIL_STATUS', case when v_civil = 'MARRIED' then 'MARRIED' else 'NOT_MARRIED' end,
      'GENDER', v_gender::text,
      'RESIDENCE_TYPE', case v_own when 'LIVING_WITH_RELATIVES' then 'WITH_PARENTS' when 'OWNED' then 'OWNED'
                                   when 'RENTED' then 'RENTED' else 'OTHERS' end);
    insert into credit_score_entries (application_id, criterion, band, suggested_band, remarks)
    select v_app, c.code, v_bands ->> c.code,
           case when c.code = 'INCOME_SOURCE' and v_emp in ('LICENSED_PROFESSIONAL', 'VIRTUAL_ASSISTANT') then null
                when c.code = 'PROPERTY_USAGE' and v_reno then null
                else v_bands ->> c.code end,
           case when c.code = 'INCOME_SOURCE' and v_emp = 'LICENSED_PROFESSIONAL' then 'Own practice, so scored as self-employed.'
                when c.code = 'INCOME_SOURCE' and v_emp = 'VIRTUAL_ASSISTANT' then 'Paid through payroll with payslips, so scored as locally employed.'
                when c.code = 'PROPERTY_USAGE' and v_reno then 'They live in the house being renovated.' end
    from credit_score_criteria c
    where v_sc <> 'E2' or c.category = 'CAPACITY';

    if v_sc in ('E2', 'E3') then continue; end if;

    -- ============================================================
    -- Review (send_for_review: authority from the matrix, approvers routed from it)
    -- ============================================================
    v_t_rev := v_t_ce + pg_temp.days(v_d3);
    v_idx := array_position(v_ladder, approval_tier_for(v_app)::text);
    v_tier := null;
    for v_j in v_idx..cardinality(v_ladder) loop
      if pg_temp.covered(v_ladder[v_j]::approval_tier) then v_tier := v_ladder[v_j]; exit; end if;
    end loop;
    if v_tier is null then
      for v_j in reverse v_idx - 1..1 loop
        if pg_temp.covered(v_ladder[v_j]::approval_tier) then v_tier := v_ladder[v_j]; exit; end if;
      end loop;
    end if;
    update financial_packages set approval_tier = v_tier::approval_tier where application_id = v_app;

    v_rev_ids := array[v_revs[1 + (i - 1) % cardinality(v_revs)]];
    if v_nrev = 2 then v_rev_ids := v_rev_ids || v_revs[1 + i % cardinality(v_revs)]; end if;
    insert into review_assignments (application_id, assignee_role, user_id, seq, assigned_by, assigned_at)
    select v_app, 'REVIEWER', u, n, v_co, v_t_rev from unnest(v_rev_ids) with ordinality as x (u, n);
    insert into review_assignments (application_id, assignee_role, user_id, seq, assigned_by, assigned_at)
    select v_app, 'APPROVER', u, n, v_co, v_t_rev from unnest(approvers_for_tier(v_tier::approval_tier)) with ordinality as x (u, n);

    v_note := 'Sent for review by ' || v_co_name;
    perform pg_temp.set_status(v_visit, 'DONE', v_t_rev, v_co, v_note);
    perform pg_temp.close_stage(v_visit, v_t_rev);
    v_visit := pg_temp.open_stage(v_app, 'REVIEW', v_t_rev);
    perform pg_temp.set_status(v_visit, 'PENDING', v_t_rev, v_co, v_note);

    -- A return to the CO: E4 (still open) and X2 (answered, then reviewed again)
    if v_sc in ('E4', 'X2') then
      select id into v_asg from review_assignments where application_id = v_app and assignee_role = 'REVIEWER' and seq = 1;
      v_rev_name := staff_name(v_rev_ids[1]);
      v_t := v_t_rev + pg_temp.days(v_d4);
      if v_sc = 'E4' and v_k % 2 = 0 then
        v_sev := 'MAJOR'; v_item := 'RECOMMENDATION';
        v_rmk := 'Not endorsed: the justification doesn''t address the LCR and the age at maturity; add both to V. Exception/s with mitigants or revise the recommendation.';
      else
        v_sev := 'MINOR'; v_item := 'INCOME';
        v_rmk := 'IX. Cash Flow: use the payslip basis (90%) for the spouse / co-borrower as well and recompute the DBR.';
      end if;
      insert into review_decisions (application_id, assignment_id, action, severity, remarks, decided_at,
                                    response, responded_by, responded_at)
      values (v_app, v_asg, 'RETURNED', v_sev, v_rmk, v_t,
              case when v_sc = 'X2' then 'Changed the income basis to payslips (90%) for every borrower and recomputed the DBR; justification updated.' end,
              case when v_sc = 'X2' then v_co end,
              case when v_sc = 'X2' then v_t + pg_temp.days(v_dret) end)
      returning id into v_dec;
      insert into review_decision_items (decision_id, item_code, result, remark)
      select v_dec, c, case when c = v_item then 'NEEDS_REVISION' else 'OK' end::review_check_result,
             case when c = v_item then v_rmk end
      from unnest(v_items) c;
      v_note := 'Returned to the Credit Officer by reviewer 1 (' || v_rev_name || '), ' || lower(v_sev::text) || ' revision: ' || v_rmk;
      perform pg_temp.set_status(v_visit, 'DONE', v_t, v_rev_ids[1], left(v_note, 1000));
      perform pg_temp.close_stage(v_visit, v_t);
      v_visit := pg_temp.open_stage(v_app, 'CREDIT_EVALUATION', v_t);
      perform pg_temp.set_status(v_visit, 'RETURNED', v_t, v_rev_ids[1], left(v_note, 1000));
      if v_sc = 'E4' then continue; end if;
      -- X2: resend_for_review
      v_t_rev := v_t + pg_temp.days(v_dret);
      v_note := 'Revised and sent back to review by ' || v_co_name;
      perform pg_temp.set_status(v_visit, 'DONE', v_t_rev, v_co, v_note);
      perform pg_temp.close_stage(v_visit, v_t_rev);
      v_visit := pg_temp.open_stage(v_app, 'REVIEW', v_t_rev);
      perform pg_temp.set_status(v_visit, 'PENDING', v_t_rev, v_co, v_note);
    end if;

    if v_sc = 'R1' or (v_sc = 'R2' and v_nrev < 2) then continue; end if;

    -- Reviewer sign-offs (every one endorses with every item OK, as the guards require)
    for v_j in 1..v_nrev loop
      exit when v_sc = 'R2' and v_j = 2;
      v_t := case when v_sc = 'R2' then v_t_rev + pg_temp.days(v_ago * 0.55) else v_t_rev + pg_temp.days(v_d4 * v_j) end;
      select id into v_asg from review_assignments where application_id = v_app and assignee_role = 'REVIEWER' and seq = v_j;
      v_rev_name := staff_name(v_rev_ids[v_j]);
      insert into review_decisions (application_id, assignment_id, action, remarks, decided_at)
      values (v_app, v_asg, 'ENDORSED',
              case when v_sc = 'X4' then 'Figures and CI findings check out; I concur with the CO''s recommendation not to endorse. Forwarded to the approvers for the decision.'
                   when v_exc_count > 0 then 'Endorsed. FP figures match the documents; every exception has a mitigant.'
                   else 'Endorsed. FP figures match the documents and the CI results.' end,
              v_t)
      returning id into v_dec;
      insert into review_decision_items (decision_id, item_code, result) select v_dec, c, 'OK' from unnest(v_items) c;
      v_note := 'Reviewer ' || v_j || ' of ' || v_nrev || ' (' || v_rev_name || ') endorsed';
      if v_j < v_nrev then
        perform pg_temp.set_status(v_visit, 'IN_PROGRESS', v_t, v_rev_ids[v_j], v_note || '; now with reviewer ' || (v_j + 1));
      else
        perform pg_temp.set_status(v_visit, 'DONE', v_t, v_rev_ids[v_j], v_note || '; review complete');
        perform pg_temp.close_stage(v_visit, v_t);
        v_t_ap := v_t;
        v_visit := pg_temp.open_stage(v_app, 'APPROVAL', v_t_ap);
        perform pg_temp.set_status(v_visit, 'PENDING', v_t_ap, v_rev_ids[v_j], 'Review complete; sent to the approvers');
      end if;
    end loop;

    if v_level = 4 or v_sc = 'A1' then continue; end if;

    -- ============================================================
    -- Approval (submit_approval: decided once the authority is met, or can no longer be met)
    -- ============================================================
    select count(*) into v_m from review_assignments where application_id = v_app and assignee_role = 'APPROVER' and unassigned_at is null;
    v_outcome := null;
    for v_appr in
      select ra.id, ra.user_id, ra.seq, u.approval_position, staff_name(ra.user_id) as name
      from review_assignments ra join users u on u.id = ra.user_id
      where ra.application_id = v_app and ra.assignee_role = 'APPROVER' and ra.unassigned_at is null
      order by ra.seq
    loop
      v_t := case when v_sc = 'A2' then v_t_ap + pg_temp.days(v_ago * 0.5)
                  else v_t_ap + pg_temp.days(v_d5 * v_appr.seq / greatest(v_m, 1)) end;
      v_action := case when v_sc in ('X3', 'X4') then 'DISAPPROVED' else 'APPROVED' end;
      v_cond := case when v_sc = 'X2' and v_appr.seq = 1
                     then 'Submission of the original owner''s duplicate of the title and the signed deed of sale before release.' end;
      v_rmk := case when v_sc = 'X3' then 'DBR of ' || to_char(v_dbr * 100, 'FM990.00') || '% is above the 40% ceiling; the mitigant doesn''t cover it.'
                    when v_sc = 'X4' then 'Unsettled cancelled credit card in the NFIS and DBR above policy.'
                    when v_appr.seq = 1 then 'Approved per the CO and reviewer recommendation.' end;
      insert into approval_decisions (application_id, assignment_id, action, approval_position, remarks, conditions, decided_at)
      values (v_app, v_appr.id, v_action, v_appr.approval_position, v_rmk, v_cond, v_t)
      returning id into v_dec;
      v_note := v_appr.name || coalesce(' (' || initcap(replace(v_appr.approval_position::text, '_', ' ')) || ')', '')
                || case when v_action = 'DISAPPROVED' then ' disapproved'
                        when v_cond is not null then ' approved with conditions (' || v_cond || ')' else ' approved' end
                || coalesce(': ' || v_rmk, '');
      v_outcome := case when approval_requirements_met(v_app) then 'APPROVED'
                        when not approval_requirements_met(v_app, true) then 'DISAPPROVED' end;
      if v_sc = 'A2' then
        if v_outcome is not null then
          delete from approval_decisions where id = v_dec;   -- one approval already meets this authority: stay Pending
        else
          perform pg_temp.set_status(v_visit, 'IN_PROGRESS', v_t, v_appr.user_id, left(v_note || '; waiting for the other approver/s', 1000));
        end if;
        exit;
      end if;
      if v_outcome is null then
        perform pg_temp.set_status(v_visit, 'IN_PROGRESS', v_t, v_appr.user_id, left(v_note || '; waiting for the other approver/s', 1000));
      else
        perform pg_temp.set_status(v_visit, 'DONE', v_t, v_appr.user_id, left(v_note, 1000));
        perform pg_temp.close_stage(v_visit, v_t);
        v_visit := pg_temp.open_stage(v_app, 'DECIDED', v_t);
        perform pg_temp.set_status(v_visit, 'DONE', v_t, v_appr.user_id,
          left(case v_outcome when 'APPROVED' then 'Approved. ' else 'Disapproved. ' end || v_note, 1000));
        update loan_applications set status = case v_outcome when 'APPROVED' then 'APPROVED' else 'REJECTED' end::application_status
        where id = v_app and status::text is distinct from case v_outcome when 'APPROVED' then 'APPROVED' else 'REJECTED' end;
        exit;
      end if;
    end loop;
    if v_level = 6 and v_outcome is null then
      raise notice 'Application % (%): the approvers'' decisions did not settle the authority; left in Approval', v_app, v_sc;
      update loan_applications set status = 'FOR_APPROVAL' where id = v_app;
    end if;
  end loop;

  -- ============================================================
  -- 3. Application numbers in submission order, then clear what the triggers made "now"
  -- ============================================================
  for v_row in
    select id, submitted_at from loan_applications where id = any (v_apps) and submitted_at is not null order by submitted_at, id
  loop
    update loan_applications
    set application_no = 'HL-' || to_char(v_row.submitted_at at time zone 'Asia/Manila', 'YYYY') || '-'
                         || lpad(nextval('application_no_seq')::text, 6, '0')
    where id = v_row.id;
  end loop;

  -- notify_review_routing is a deferred constraint trigger: fire it now, so its notifications are cleared too
  set constraints all immediate;
  delete from ocr_runs where document_id in (select id from documents where application_id = any (v_apps));
  delete from notifications where application_id = any (v_apps);
  delete from audit_log where application_id = any (v_apps);

  raise notice 'Seeded % applications (% skipped).%', cardinality(v_apps), v_skipped,
    case when not v_make_accounts then ' Attached to the existing applicant accounts (no new logins).'
         when v_no_login > 0 then format(' %s new applicant accounts can''t log in (auth.identities not writable here).', v_no_login)
         else format(' Applicant logins: <first>.<last>NN@%s / %s', v_domain, v_password) end;
end $$;

-- What was made (the work tray shows the same thing)
select la.application_no, concat_ws(' ', p.first_name, p.last_name) as principal, la.status,
       s.stage, public.current_stage_status(s.id) as stage_status, fp.credit_result, fp.approval_tier,
       la.loan_amount, (la.submitted_at at time zone 'Asia/Manila')::date as submitted
from public.loan_applications la
join public.applicants p on p.application_id = la.id and p.role = 'PRINCIPAL'
left join public.application_stages s on s.application_id = la.id and s.left_at is null
left join public.financial_packages fp on fp.application_id = la.id
where p.email_address like '%@catch-seed.test'
order by la.submitted_at nulls last, la.id;
