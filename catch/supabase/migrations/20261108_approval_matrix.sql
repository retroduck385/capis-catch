-- CATCH — VII. Approval: the bank's authority-limit matrix (Josh, 2026-11-08)
-- Run after 20261021_review_routing.sql. Re-runnable, no data changes.
--
-- The matrix has 8 authorities (lowest to highest); with a policy deviation the next one up approves.
-- PRESIDENT, SENIOR_CREDIT_COMMITTEE, EXECUTIVE_COMMITTEE and BOARD already exist and keep their meaning.
-- Labels + amount bands live in src/pages/review/approval.js. Positions only, no names.

alter type public.approval_tier add value if not exists 'DEPT_HEADS' before 'PRESIDENT';
alter type public.approval_tier add value if not exists 'CREDIT_DIVISION_AND_LENDING_DEPT' before 'PRESIDENT';
alter type public.approval_tier add value if not exists 'CREDIT_AND_LENDING_DIVISIONS' before 'PRESIDENT';
alter type public.approval_tier add value if not exists 'PRESIDENT_AND_SCC_MEMBER' after 'PRESIDENT';
