-- CATCH Demo Application #8 (Evangelista): seeds the applicant wizard as a DRAFT, so the demo doesn't spend time typing.
-- Values = TestApplication_TEST_Evangelista.pdf (build8.py). Synthetic data only.
--
-- Run in the Supabase SQL Editor AFTER the applicant account exists (Sign up as ramon.evangelista042177@gmail.com).
--   * Deletes the account's current DRAFT (if any) and makes a new one. Submitted applications are left alone.
--   * Sets the account's master profile to Ramon (the wizard needs a complete profile). Set v_set_profile := false
--     to keep the current one.
--   * ON PURPOSE: the spouse's date of birth is 1980-03-18 (her ID says 03/08/1980) -> the AO picks Update from the ID
--     in Scenario 3. Co-borrower 2's ID shows his old Muntinlupa address -> Scenario 3's clarification question.
--   * NOT done here: the uploads (Storage can't be seeded from SQL) and the submit.
-- After running: log in as the applicant, open the draft, click Save and continue through each step (the wizard keeps
-- "steps visited" in the browser, not the DB), then upload the files in step 11 (leave out Co-borrower 2's payslips).
do $$
declare
  v_email       text    := 'ramon.evangelista042177@gmail.com';   -- the applicant account to fill in
  v_set_profile boolean := true;

  v_user uuid;
  v_role user_role;
  v_old  bigint;
  v_docs int;
  v_app  bigint;
  v_purpose smallint;
  v_principal bigint;
  v_spouse bigint;
  v_cob1 bigint;
  v_cob2 bigint;
begin
  select id into v_user from auth.users where lower(email) = lower(v_email);
  if v_user is null then raise exception 'No account with email % (sign up first)', v_email; end if;
  select role into v_role from public.users where id = v_user;
  if v_role is distinct from 'APPLICANT' then raise exception '% is not an applicant account (role %)', v_email, v_role; end if;

  select id into v_old from loan_applications where user_id = v_user and status = 'DRAFT';
  if v_old is not null then
    select count(*) into v_docs from documents where application_id = v_old;
    delete from loan_applications where id = v_old;
    raise notice 'Deleted old draft % (% uploaded file rows; their Storage files stay in the bucket)', v_old, v_docs;
  end if;

  select id into v_purpose from loan_purposes where label = 'Purchase of House and Lot';
  if v_purpose is null then raise exception 'Loan purpose "Purchase of House and Lot" not found'; end if;

  -- 1. Loan details
  insert into loan_applications (user_id, loan_purpose_id, property_address, loan_amount, loan_term_years)
  values (v_user, v_purpose,
          'Block 9 Lot 14, Sampaguita Hills Residences, Brgy. Salitran III, Dasmariñas City, Cavite 4114', 2900000, 15)
  returning id into v_app;

  -- 2. Principal borrower (+ 1 dependent: son, 14)
  insert into applicants (application_id, role, party_no, first_name, middle_name, last_name, mobile_number,
                          email_address, gender, date_of_birth, birth_place, civil_status, citizenship, sss_no, tin)
  values (v_app, 'PRINCIPAL', 1, 'Ramon', 'Cruz', 'Evangelista', '09170000881', 'ramon.evangelista042177@gmail.com', 'MALE',
          '1977-04-21', 'Lipa City', 'MARRIED', 'Filipino', '33-6402187-5', '238-561-904-000')
  returning id into v_principal;
  insert into dependents (applicant_id, age) values (v_principal, 14);

  -- 3. Addresses
  insert into addresses (applicant_id, address_type, unit_house_no, building_street, subdivision_barangay,
                         municipality_city, province, zip_code, living_in_ph, home_ownership, monthly_rent, date_move_in)
  values (v_principal, 'PRESENT', 'Blk 4 Lot 22', 'Camia Street', 'Brgy. Salawag', 'Dasmariñas City', 'Cavite',
          '4114', true, 'RENTED', 14000, '2017-06-01'),
         (v_principal, 'PERMANENT', 'Purok 2', null, 'Brgy. Sabang', 'Lipa City', 'Batangas',
          '4217', null, null, null, '1977-04-21');

  -- 4. Principal's employment
  insert into employment_info (applicant_id, employment_type, employer_business_name, occupation, employment_date,
                               contact_number, email_address, employer_tin, ctc_no, ctc_date_issued, ctc_place_issued,
                               gross_monthly_income)
  values (v_principal, 'LOCALLY_EMPLOYED', 'Malaya Cold Chain Logistics, Inc.', 'Plant Operations Manager', '2012-03-05',
          '(046) 000-8100', 'hr@malayacoldchain.com.ph', '007-418-259-00000', '00000881', '2026-01-14',
          'Dasmariñas City', 65000);
  insert into addresses (applicant_id, address_type, unit_house_no, building_street, subdivision_barangay,
                         municipality_city, province, zip_code)
  values (v_principal, 'EMPLOYER', 'Lot 3 Phase 2', 'First Cavite Industrial Estate', 'Brgy. Langkaan II',
          'Dasmariñas City', 'Cavite', '4114');

  -- 5. Spouse (same present address; DATE OF BIRTH TYPED WRONG ON PURPOSE: 03/18 instead of 03/08)
  insert into applicants (application_id, role, party_no, first_name, middle_name, maiden_name, last_name,
                          mobile_number, email_address, date_of_birth, birth_place, citizenship, sss_no, tin)
  values (v_app, 'SPOUSE', 1, 'Liza Mae', 'Ocampo', 'Ocampo', 'Evangelista', '09170000882',
          'lizamae.evangelista80@gmail.com', '1980-03-18', 'Imus City', 'Filipino', '33-8815402-6', '271-094-638-000')
  returning id into v_spouse;
  insert into addresses (applicant_id, address_type, same_as_principal) values (v_spouse, 'PRESENT', true);
  insert into employment_info (applicant_id, employment_type, employer_business_name, occupation, employment_date,
                               contact_number, email_address, employer_tin, ctc_no, ctc_date_issued, ctc_place_issued,
                               gross_monthly_income)
  values (v_spouse, 'LOCALLY_EMPLOYED', 'Hiraya Food Ventures Corp.', 'Senior Payroll Accountant', '2015-08-17',
          '(046) 000-8200', 'hr@hirayafoods.com.ph', '008-905-374-00000', '00000882', '2026-01-14', 'Imus City', 38000);
  insert into addresses (applicant_id, address_type, unit_house_no, building_street, subdivision_barangay,
                         municipality_city, province, zip_code)
  values (v_spouse, 'EMPLOYER', '3/F Kalayaan Business Center', 'Aguinaldo Highway', 'Brgy. Bayan Luma IV',
          'Imus City', 'Cavite', '4103');

  -- 6a. Co-borrower 1 (daughter)
  insert into applicants (application_id, role, party_no, first_name, middle_name, last_name, relationship_to_principal,
                          mobile_number, email_address, gender, date_of_birth, birth_place, citizenship, sss_no, tin)
  values (v_app, 'CO_BORROWER', 1, 'Bea Camille', 'Ocampo', 'Evangelista', 'Daughter', '09170000883',
          'beacamille.evangelista@gmail.com', 'FEMALE', '2001-02-14', 'Imus City', 'Filipino', '34-9930415-2',
          '519-327-406-000')
  returning id into v_cob1;
  insert into addresses (applicant_id, address_type, same_as_principal) values (v_cob1, 'PRESENT', true);
  insert into employment_info (applicant_id, employment_type, employer_business_name, occupation, employment_date,
                               contact_number, email_address, employer_tin, ctc_no, ctc_date_issued, ctc_place_issued,
                               gross_monthly_income)
  values (v_cob1, 'LOCALLY_EMPLOYED', 'Kalinga Medical Center, Inc.', 'Staff Nurse', '2023-06-01',
          '(046) 000-8300', 'hrd@kalingamedical.com.ph', '000-912-447-00000', '00000883', '2026-01-14',
          'Dasmariñas City', 32000);
  insert into addresses (applicant_id, address_type, unit_house_no, building_street, subdivision_barangay,
                         municipality_city, province, zip_code)
  values (v_cob1, 'EMPLOYER', 'Congressional Avenue', null, 'Brgy. Burol Main', 'Dasmariñas City', 'Cavite', '4114');

  -- 6b. Co-borrower 2 (brother, probationary since 2026-07-01)
  insert into applicants (application_id, role, party_no, first_name, middle_name, last_name, relationship_to_principal,
                          mobile_number, email_address, gender, date_of_birth, birth_place, citizenship, sss_no, tin)
  values (v_app, 'CO_BORROWER', 2, 'Paolo', 'Cruz', 'Evangelista', 'Brother', '09170000884',
          'paolo.c.evangelista@gmail.com', 'MALE', '1992-09-03', 'Lipa City', 'Filipino', '34-2268751-9',
          '438-702-195-000')
  returning id into v_cob2;
  insert into addresses (applicant_id, address_type, same_as_principal) values (v_cob2, 'PRESENT', true);
  insert into employment_info (applicant_id, employment_type, employer_business_name, occupation, employment_date,
                               contact_number, email_address, employer_tin, ctc_no, ctc_date_issued, ctc_place_issued,
                               gross_monthly_income)
  values (v_cob2, 'LOCALLY_EMPLOYED', 'Bagwis Data Systems, Inc.', 'IT Support Specialist', '2026-07-01',
          '(02) 0000-8400', 'hr@bagwisdata.com.ph', '010-662-581-00000', '00000884', '2026-01-14',
          'Muntinlupa City', 28000);
  insert into addresses (applicant_id, address_type, unit_house_no, building_street, subdivision_barangay,
                         municipality_city, province, zip_code)
  values (v_cob2, 'EMPLOYER', '12/F Silangan IT Tower', 'Madrigal Business Park', 'Brgy. Alabang',
          'Muntinlupa City', 'Metro Manila', '1780');

  -- 7. Mortgagor / Attorney-in-Fact: No / No (nothing to save)

  -- 8. Financial obligations (the old cancelled card is NOT declared: it only shows up in the spouse's NFIS)
  insert into bank_accounts (applicant_id, bank_name, account_type, account_number)
  values (v_principal, 'Metropolitan Bank & Trust Company (Metrobank)', 'Savings', '0000-8810-0001');
  insert into existing_loans (applicant_id, loan_type, lending_institution, monthly_payment, term_over_6_months)
  values (v_principal, 'Auto Loan', 'Security Bank Corporation', 9800, true),
         (v_spouse, 'SSS Salary Loan', 'Social Security System (SSS)', 1150, true);
  insert into credit_cards (applicant_id, issuing_bank, credit_limit, expiry_date)
  values (v_principal, 'Metropolitan Bank & Trust Company (Metrobank)', 150000, '2029-08-31'),
         (v_spouse, 'Bank of the Philippine Islands (BPI)', 60000, '2027-09-30');

  -- 9. Character references
  insert into character_references (application_id, reference_no, name, address, contact_number, relationship_to_principal)
  values (v_app, 1, 'Edgardo Lim Salonga', 'Blk 4 Lot 20, Camia Street, Brgy. Salawag, Dasmariñas City, Cavite 4114',
          '09170001601', 'Neighbor'),
         (v_app, 2, 'Engr. Josephine Tan Aquino',
          'Lot 3 Phase 2, First Cavite Industrial Estate, Brgy. Langkaan II, Dasmariñas City 4114', '09170001602', 'Co-worker'),
         (v_app, 3, 'Rev. Fr. Manuel Ilustre', 'Brgy. Salawag, Dasmariñas City, Cavite 4114', '09170001603', 'Parish priest');

  -- 10. Collateral & referral
  insert into collateral_details (application_id, project_name, property_type, selling_price, registered_owner,
                                  tct_cct_no, lot_area, floor_area, contact_person, contact_number)
  values (v_app, 'Sampaguita Hills Residences', 'House and Lot', 4000000, 'Tahanang Pinoy Land Development Corp.',
          'TCT No. 057-2025014422', 100, 78, 'Marilou Pascual', '09170001604');
  insert into referral_details (application_id, channel, developer_name, branch, referrer)
  values (v_app, 'DEVELOPER', 'Tahanang Pinoy Land Development Corp.', 'Dasmariñas, Cavite', 'Arnold Vergara (seller)');

  -- 11. Document checklist rows (what sync_requirements() makes; it only runs for the logged-in owner, so done here)
  insert into application_requirements (applicant_id, requirement_type)
  select a.id, t
  from applicants a
  join employment_info e on e.applicant_id = a.id
  cross join lateral unnest(required_documents(e.employment_type, 2900000)) as t
  where a.application_id = v_app and a.role in ('PRINCIPAL', 'SPOUSE', 'CO_BORROWER')
  on conflict (applicant_id, requirement_type) do nothing;

  -- Master profile (pre-fills the principal; the wizard won't open a draft without a complete one)
  if v_set_profile then
    begin
      insert into user_profile (user_id, first_name, middle_name, last_name, gender, date_of_birth, birth_place,
                                civil_status, citizenship, sss_no, tin)
      values (v_user, 'Ramon', 'Cruz', 'Evangelista', 'MALE', '1977-04-21', 'Lipa City', 'MARRIED', 'Filipino',
              '33-6402187-5', '238-561-904-000')
      on conflict (user_id) do update set
        first_name = excluded.first_name, middle_name = excluded.middle_name, last_name = excluded.last_name,
        name_extension = null, gender = excluded.gender, date_of_birth = excluded.date_of_birth,
        birth_place = excluded.birth_place, civil_status = excluded.civil_status, citizenship = excluded.citizenship,
        sss_no = excluded.sss_no, tin = excluded.tin;
      update users set phone_number = '09170000881' where id = v_user;
    exception when unique_violation then
      raise notice 'Profile left as is: another account''s profile already uses Ramon''s SSS / TIN';
    end;
  end if;

  raise notice 'Demo #8 draft seeded: loan_applications.id = %', v_app;
end $$;
