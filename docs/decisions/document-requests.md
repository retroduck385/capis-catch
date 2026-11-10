# Document requests ("What we need", the deferral loop)

Date: 2026-11-11. Status: decided (user answers 2026-11-11) and built on branch `feature/deferral-loop` (not merged yet). Covers the deferral loop at the AO, CO and reviewer steps (status-flow.md "Recurring pattern"), F5 in part (deficiency notice without links) and the bank's Q-42 answers.

## Decided
- **Deferral happens at the AO, CO and reviewer steps**, never at the approver: approvers only approve or disapprove (`approval-rules.md`). The applicant is told what is needed with a document request, not with a "Deferred" outcome.
- **The assigned AO sends the request**, while the file is in Intake, Credit Investigation, Credit Evaluation or Review (not Approval or Decided). One request at a time. A short message (1-300 characters, no links) plus the specific documents, per borrower: checklist documents or "Other" with a name.
- **Suggestions** for the AO (internal text, rewritten for the applicant): KYC sections marked Needs clarification, the CO's Credit Result Deferred (justification, deferrals), reviewer returns not yet answered. Missing checklist documents start ticked.
- **Channels:** in-app at once (`APPLICANT_DOCUMENTS_NEEDED`), SMS and email through the existing notice queue. SMS and email say what is needed and which documents and end with "Your Account Officer will contact you." They never point to the portal (the bank: no links, "more on open portal"). Only the in-app notice and the "Documents needed" card say how to upload.
- **The applicant uploads only the requested documents**, even though the application is submitted. Nothing else becomes editable. Same file rules as the form: JPG, PNG or PDF, up to 10 MB each.
- **"Send to my Account Officer"** needs every requested document. The assigned AO gets `DOCUMENTS_SENT` (in-app), checks the files (they go through OCR and the AI document check like any upload) and closes the request. The applicant then gets an in-app "We received your documents" (`APPLICANT_REQUEST_CLOSED`, no SMS or email). Closing an unanswered request withdraws it ("no documents are needed for now").
- **What the applicant sees:** "Documents needed" while open, "Documents sent" after sending, then back to the normal status (usually "Under review"). An outcome the AO has already sent still wins. The automatic "Under review" notice is not sent while a request is open.
- **Reviewer returns:** the assigned AO also gets an in-app alert (`REVIEW_RETURNED`), so they can decide whether the applicant needs to be asked for something.
- **Left dormant and documented:** the DEFERRED outcome notice and FOR_CLARIFICATION ("Incomplete submission"). Nothing sets either status. Their SQL stays (the notice tables are append-only), but deferral is told with a document request.
- **Messages stay staff only:** the applicant can upload and send, but can't write back.

## Built (branch `feature/deferral-loop`)
- `catch/supabase/migrations/20261112_document_requests.sql` (after `20261110_approver_decision.sql`; any order with the two 20261111 files):
  - Tables `document_requests` (OPEN → SENT → CLOSED as RECEIVED or WITHDRAWN), `document_request_items`, `document_request_uploads`. Clients only read (applicant: their own; staff: files they can open). Changes are logged in `audit_log`.
  - The message is an `applicant_notices` row (outcome `DOCUMENTS_NEEDED`, `request_id`), so it is append-only and its SMS / email go through `applicant_notice_deliveries`. `notice-service` needs no change.
  - AO: `document_request_context()`, `preview_document_request()`, `open_document_request()`, `close_document_request()`.
  - Applicant: `my_document_requests()`, `add_requested_document()`, `remove_requested_document()` (only while open), `send_requested_documents()`.
  - Storage: the applicant uploads only into `{user id}/{application id}/requests/{request id}/` of an open request. `documents` RLS is unchanged; uploads become normal `documents` rows through `add_requested_document()`.
  - Replaces `applicant_notification_kinds()`, `applicant_visible_status()` and `notify_on_applicant_status()`. Adds a trigger on `review_decisions` for `REVIEW_RETURNED`.
- Front end: `src/pages/documentRequests/` (AO panel in the loan folder, applicant "Documents needed" card on the home and application pages), `applicantStatus.js` / `applicantStatusLabel.jsx` (the two new labels). The application page's badge now shows the applicant label instead of the internal status.
- Tested: PGlite (section 14 of the notifications-v2 suite, 64 checks), the notice worker test with a request delivery, build and eslint. Click test pending.

## Watch out
- Re-running `20261024_notifications.sql` or `20261029_applicant_notices.sql` puts back their versions of the three functions: run `20261112_document_requests.sql` again afterwards.
- The bucket's type and size limits are enforced by Storage and the page; the PGlite tests can't check them (click test).
- Removing an upload deletes the `documents` row first, then the file; if the file delete fails, the file stays in the request folder (not linked to anything).

## Still to come
- Item-level deficiency notices for the whole checklist at intake (F5) beyond this request.
- Live SMS / email (log mode until Q-04).
