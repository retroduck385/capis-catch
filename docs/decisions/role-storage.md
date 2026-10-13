# Role storage and assignment

Date: 2026-10-13. Status: decided by implementation. Resolves Q-41 (and Q-01).

## Decided
- Roles are the 8 values of enum `user_role`: APPLICANT, ACCOUNT_OFFICER, CREDIT_INVESTIGATOR, DISPATCH_ADMIN, CREDIT_OFFICER, REVIEWER, APPROVER, DEPT_HEAD.
- The role is stored in `public.users.role` (one row per `auth.users` row), not in JWT `app_metadata`.
- Self sign-up always gives APPLICANT. Only the Dept Head gives staff roles.

## Built (on main)
- `handle_new_user()` trigger inserts the `public.users` row with role APPLICANT (`20260930_signup_role.sql`). Clients cannot insert, delete or re-role user rows; they may update only `phone_number`.
- `/staffAccountsPage` (Dept Head only): creates the login through a second Supabase client that doesn't replace the Dept Head's session, then calls `grant_staff_role(email, role)` (`20261010_staff_accounts.sql`). The grant is refused for accounts that already have a staff role or a loan application.
- Every grant is logged in `staff_role_grants` (who, which role, by whom, when).
- RLS helpers read the role from the table: `current_user_role()`, `is_staff()`, `is_assigning_head()`, `staff_can_access()`.
- Frontend: `authContext` loads `role` from `public.users`; `roles.js` maps each role to its home page.

## Why (inferred)
A table column can be read directly by RLS helper functions without handling JWT claims or refresh. Keeping role changes server-side, behind a Dept Head-only function, stops users from promoting themselves.
