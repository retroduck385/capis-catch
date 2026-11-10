// Decision Support: everything the page shows, loaded in one call. The page only reads; nothing here writes.
// Sprint 5: this can become a single RPC (e.g. get_decision_transcript(application_id)) that returns the same shape,
// without changing the page or its sections.
import { fetchApplication, getParties } from '../applicationForm/api';
import { BORROWER_ROLES } from '../applicationForm/options';
import { fetchCiDone } from '../ciRequest/api';
import { fetchStaffNames } from '../loanFolder/api';
import { fetchAssignee, fetchCreditScoreRules, fetchFinancialPackage } from '../financialPackage/api';
import { fetchLatestMracCheck } from '../mrac/api';
import {
    fetchApprovalDecisions, fetchCurrentStage, fetchReviewAssignments, fetchReviewCheckItems, fetchReviewDecisions,
    fetchReviewStaff,
} from '../review/api';

// A part that fails to load (e.g. no MRAC run yet, or the table isn't migrated) shouldn't take the whole page down
const optional = (promise, fallback) => promise.catch(() => fallback);

export const fetchDecisionSupport = async (applicationId) => {
    const app = await fetchApplication(applicationId);
    const ids = getParties(app, BORROWER_ROLES).map((p) => p.id);
    const [fp, rules, ciDone, mrac, stage, coId, rows, checkItems, reviews, approvals, staff] = await Promise.all([
        fetchFinancialPackage(app.id, ids),
        fetchCreditScoreRules(),
        optional(fetchCiDone(app.id), false),
        optional(fetchLatestMracCheck(app.id), null),
        optional(fetchCurrentStage(app.id), null),
        optional(fetchAssignee(app.id, 'CREDIT_OFFICER'), null),
        optional(fetchReviewAssignments(app.id), []),
        optional(fetchReviewCheckItems(), []),
        optional(fetchReviewDecisions(app.id), []),
        optional(fetchApprovalDecisions(app.id), []),
        optional(fetchReviewStaff(), []),
    ]);
    const positions = Object.fromEntries(staff.map((s) => [s.user_id, s.approval_position]));
    const names = await fetchStaffNames([coId, ...rows.flatMap((r) => [r.user_id, r.assigned_by]),
        ...reviews.map((d) => d.responded_by)]);
    return { app, fp, rules, ciDone, mrac, stage, coId, rows, checkItems, reviews, approvals, positions, names };
};
