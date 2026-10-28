# Messages

Date: 2026-10-28. Status: decided (user answers, 2026-10-28) and built. Covers F7 (Streamlined Internal Messaging Panel). The bank said messaging is staff only (Q-42, visit 2026-10-26).

## Decided
- **Staff only.** Applicants can't read or post. One thread per loan application; it replaces Messenger, Viber and GChat for the file (pain points H5, I1, I2).
- **Read:** everyone who can read the file (`staff_can_access()`): every AO, CO, Dispatch Admin, Reviewer, Approver and Dept Head; a CI once the file has a CI request.
- **Post** (`post_message()`), at every stage including Decided, because the AO sends the final notice after the decision and staff may still need to coordinate the reason:

| Role | May post |
|---|---|
| Account Officer, Credit Officer | only while assigned to the file |
| Credit Investigator | once the file has a CI request |
| Reviewer, Approver | only while routed on the file (`review_assignments`) |
| Dispatch Admin, Dept Head | always |
| Anyone else with access | read only |
| Applicant | never |

- **Append-only.** Nobody can edit or delete a message: no client UPDATE / DELETE / TRUNCATE, and a trigger blocks them for the table owner and the service role too. Deleting an application that has messages is refused (foreign key `on delete restrict`). The one exception: the migration, run by the table owner, removes messages whose application no longer exists (after a 20260928 reset).
- **Not copied into `audit_log`.** `messages` is its own trail (who, as which role, when, in which stage, what). A message is not a change to the record, so it stays out of the loan folder's Change history.
- **Each message** is tagged with the sender's role and the stage open when it was posted. Plain text, 1 to 2000 characters. Posters need a staff profile name.
- **Notifications:** `MESSAGE_POSTED` to the assigned AO and CO, routed reviewers and approvers, and earlier posters who can still read the file; one unread per person per file; never the sender; application number only (no names, no message text).
- **Unread:** a count on the Messages button and a "New" divider in the panel. The work tray is not changed (a tray dot is a later idea for the UI/UX groupmate).
- **No attachments.** Loan documents already live in `documents` with their own access, naming, OCR and audit. If ever needed: a reference to an existing loan-folder document, not new uploads.
- **Realtime:** `messages` is in the `supabase_realtime` publication (RLS applies to each subscriber); `message_reads` is not.

## Built
- `catch/supabase/migrations/20261028_messages.sql` (run after `20261024_notifications.sql`; re-runnable): `messages`, `message_reads`, `post_message()`, `message_can_post()`, `mark_messages_read()`, `message_unread_counts()`, the append-only triggers, RLS, the publication.
- Front end: `src/pages/messages/{api.js, useMessages.js, messagesPanel.jsx}`. One import and one line each in `loanFolderPage.jsx`, `ciRequestPage.jsx`, `financialPackagePage.jsx`, `reviewSummaryPage.jsx`. The panel renders through a portal (the Financial Package page is a `<form>`). The button sits left of the bell and shrinks to an icon on a phone.
- Tested: 108 PGlite checks; click test in the shared project, all 10 steps pass including the narrow-screen check.

## Watch out
- `message_user_can_access()` is a copy of the rules in `staff_can_access()` (latest in `20261020_financial_package.sql`), used to decide which earlier posters can still be notified. If `staff_can_access()` changes, change the copy in the same migration. It cannot leak messages (RLS reads through the real function); the risk is only a wrong notification.
- Test messages in the shared project can never be deleted.

## Still to come
- A tray dot for unread messages (UI/UX groupmate; needs `workTray.jsx`).
- Attachments (if the bank asks): reference an existing document.
