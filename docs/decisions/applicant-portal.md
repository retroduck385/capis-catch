# Applicant portal

Date: 2026-10-13. Status: decided by implementation. Resolves Q-02 (and Q-27 for intake).

## Decided
The Loan Applicant is a system user. Applicants sign up themselves, fill in the application form online and upload their own documents. AO-entered intake is planned but only a placeholder page exists.

## Built (on main)
- Sign-up trigger makes every new login an `APPLICANT` (`20260930_signup_role.sql`).
- `/applicantHomePage`, `/profilePage` (master profile), `/applicationFormPage` (multi-step form covering every party and all 10 employment types, with uploads).
- `submit_application()` blocks submission until required inputs and documents are present, then sets `SUBMITTED` and opens the Intake stage.
- RLS: applicants read their own applications and edit them only while `DRAFT`.
- `/accountOfficerApplicationInputPage`: placeholder only.

## Why (inferred)
It follows the paper's own design (F1 Applicant Profile Page, Sprint 1 customer portal, Sec. 1.4.2.1), rather than the interview evidence (App. G, I, J) that pointed toward AO-entered intake.
