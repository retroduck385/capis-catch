// What a reviewer / approver opens for an application routed to them (VII. Approval).
// The reviewer is a second layer of checking on the Credit Officer's work (CATCH Document Ch. 1.3; CO and
// Credit Head interviews): automatic flags, income claim vs. evidence, the CO's recommendation and figures,
// CI results, credit score, exceptions, what changed since it was sent, then (current reviewer only) a
// checklist and a decision: Endorse / Not endorse (a recommendation, not an approval) or Return to the CO
// for revision. Reviewers act in order; after the last one it moves to Approval (submit_review()).
// Approvers and everyone else with access read the same page, including every reviewer's sign-off.
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { UserAuth } from '../../context/authContext';
import { fetchApplication, getParties, one } from '../applicationForm/api';
import { Section } from '../applicationForm/fields';
import { BORROWER_ROLES, formatMoney, partyLabel } from '../applicationForm/options';
import { fetchCiDone } from '../ciRequest/api';
import { CiResultsView } from '../ciRequest/ciResults';
import { fetchAuditLog, fetchStaffNames } from '../loanFolder/api';
import ChangeHistory from '../loanFolder/changeHistory';
import { fetchAssignee, fetchCreditScoreRules, fetchFinancialPackage } from '../financialPackage/api';
import { computeFp, percent } from '../financialPackage/compute';
import { CATEGORIES, totalCreditScore } from '../financialPackage/creditScore';
import { CREDIT_RESULTS } from '../financialPackage/options';
import { STAGE_STATUS_LABELS, stageLabel } from '../workTray/options';
import {
    fetchCurrentStage, fetchReviewAssignments, fetchReviewCheckItems, fetchReviewDecisions, fetchReviewerCanAct,
    submitReview,
} from './api';
import { splitRouting } from './approval';
import { isReviewedChange, reviewFlags, reviewState } from './reviewChecks';
import { FlagList, IncomeEvidence, ReviewForm, ReviewProgress } from './reviewParts';
import RoutingSummary from './routingSummary';
import MessagesPanel from '../messages/messagesPanel';

const fullName = (p) => [p.first_name, p.middle_name, p.last_name, p.name_extension].filter(Boolean).join(' ');
const money = (v) => (v === null || v === undefined || v === '' ? '—' : `₱${formatMoney(v)}`);
const blank = (v) => v === null || v === undefined || String(v).trim() === '';

const Row = ({ label, children }) => (
    <tr>
        <td className="font-semibold align-top">{label}</td>
        <td className="align-top">{children}</td>
    </tr>
);

const Text = ({ label, value }) => (blank(value) ? null : (
    <div className="py-1">
        <p className="font-semibold">{label}</p>
        <p className="whitespace-pre-wrap">{value}</p>
    </div>
));

const days = (from) => {
    const d = (Date.now() - new Date(from).getTime()) / 86400000;
    return d < 1 ? `${Math.max(1, Math.round(d * 24))} h` : `${d.toFixed(1)} days`;
};

const load = async (applicationId) => {
    const app = await fetchApplication(applicationId);
    const ids = getParties(app, BORROWER_ROLES).map((p) => p.id);
    const [fp, rules, rows, stage, coId, checkItems, decisions, canAct, ciDone, log] = await Promise.all([
        fetchFinancialPackage(app.id, ids), fetchCreditScoreRules(), fetchReviewAssignments(app.id),
        fetchCurrentStage(app.id), fetchAssignee(app.id, 'CREDIT_OFFICER'), fetchReviewCheckItems(),
        fetchReviewDecisions(app.id), fetchReviewerCanAct(app.id), fetchCiDone(app.id), fetchAuditLog(app.id)]);
    const names = await fetchStaffNames([coId, ...rows.flatMap((r) => [r.user_id, r.assigned_by]),
        ...decisions.map((d) => d.responded_by), ...log.map((e) => e.changed_by)]);
    return { app, fp, rules, rows, stage, coId, checkItems, decisions, canAct, ciDone, log, names };
};

const ReviewSummaryPage = () => {
    const { session } = UserAuth();
    const myId = session?.user?.id;
    const [searchParams] = useSearchParams();
    const applicationId = Number(searchParams.get('id'));

    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    const [submitError, setSubmitError] = useState(null);
    const [done, setDone] = useState(null);

    const reload = useCallback(async () => setData(await load(applicationId)), [applicationId]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const next = await load(applicationId);
                if (!cancelled) setData(next);
            } catch (err) {
                if (!cancelled) setError(err.message);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [applicationId]);

    if (loading) return <p>Loading review summary...</p>;
    if (error) return <p className="text-red-600">{error}</p>;
    if (!data) return null;

    const { app, fp, rules, rows, stage, coId, checkItems, decisions, canAct, ciDone, log, names } = data;
    const pkg = fp.pkg ?? {};
    const details = Object.fromEntries(fp.parties.map((r) => [r.applicant_id, r]));
    const computed = computeFp(app, details, pkg, { interest_rate: app.interest_rate });
    const score = totalCreditScore(rules, Object.fromEntries(fp.creditScore.map((r) => [r.criterion, r])));

    const { approvers } = splitRouting(rows);
    const state = reviewState(rows, decisions);
    const { reviewers, current } = state;
    const myReview = reviewers.find((r) => r.user_id === myId);
    const mySignoff = myReview && state.signoffs[myReview.id];
    const isApprover = approvers.some((r) => r.user_id === myId);
    const sentRow = [...reviewers, ...approvers].sort((a, b) => new Date(a.assigned_at) - new Date(b.assigned_at))[0];
    const borrowers = getParties(app, BORROWER_ROLES).map((p) => `${fullName(p)} (${partyLabel(p)})`).join(', ');
    const resultLabel = CREDIT_RESULTS.find((r) => r.value === pkg.credit_result)?.label;
    const collateral = one(app.collateral_details);

    // "Changes since": since the latest return (= the CO's revision), else since it was first sent
    const lastReturn = state.returns.at(-1);
    const changesSince = lastReturn ? { at: lastReturn.decided_at, label: 'it was last returned' }
        : sentRow ? { at: sentRow.assigned_at, label: 'it was sent for review' } : null;
    const changes = changesSince ? log.filter((e) => isReviewedChange(e) && new Date(e.changed_at) > new Date(changesSince.at)) : [];
    const flags = reviewFlags({ app, fp, computed, score, rules, ciDone, changes, changesSince });

    const isLast = current && reviewers.at(-1)?.id === current.id;
    const nextLabel = isLast ? 'You are the last reviewer: it moves to Approval and the approvers are notified.'
        : `It passes to reviewer ${(current?.seq ?? 0) + 1}.`;

    const handleSubmit = async (review) => {
        setBusy(true);
        setSubmitError(null);
        try {
            await submitReview(app.id, review);
            await reload();
            setDone(review.action === 'RETURNED' ? 'Returned to the Credit Officer.'
                : isLast ? 'Review complete: sent to the approvers.' : 'Signed off: passed to the next reviewer.');
        } catch (err) {
            setSubmitError(err.message);
        } finally {
            setBusy(false);
        }
    };

    const yourPart = myReview
        ? (mySignoff ? `You are reviewer ${myReview.seq} of ${reviewers.length}. You signed off (${mySignoff.action === 'ENDORSED' ? 'endorsed' : 'not endorsed'}) on ${new Date(mySignoff.decided_at).toLocaleString()}.`
            : canAct ? `You are reviewer ${myReview.seq} of ${reviewers.length}. It's your turn.`
                : state.openReturn ? `You are reviewer ${myReview.seq} of ${reviewers.length}. It's back with the Credit Officer for revision.`
                    : stage?.stage === 'REVIEW' && current ? `You are reviewer ${myReview.seq} of ${reviewers.length}. Waiting for reviewer ${current.seq} (${names[current.user_id] ?? 'Reviewer'}).`
                        : `You are reviewer ${myReview.seq} of ${reviewers.length}.`)
        : isApprover ? 'You are an approver on this application.'
            : 'This application isn\'t assigned to you (view only).';

    return (
        <div className="max-w-5xl m-auto p-4 text-left">
            <MessagesPanel applicationId={app.id} />
            <p><Link to="/adminHomePage" className="underline">Back to work tray</Link></p>
            <h2>Review summary: {app.application_no}</h2>
            <p><span className="font-semibold">Name of Borrower/s:</span> {borrowers || '—'}</p>
            <p><span className="font-semibold">Stage:</span>{' '}
                {stage ? `${stageLabel(stage.stage)} · ${STAGE_STATUS_LABELS[stage.status] ?? '—'}` : '—'}
                {stage?.enteredAt && ['REVIEW', 'APPROVAL'].includes(stage.stage) && ` (for ${days(stage.enteredAt)})`}
                {state.returns.length > 0 && ` · returned ${state.returns.length} time${state.returns.length === 1 ? '' : 's'}`}</p>
            {sentRow && (
                <p><span className="font-semibold">Sent for review by</span> {names[sentRow.assigned_by] ?? 'unknown'} on{' '}
                    {new Date(sentRow.assigned_at).toLocaleString()}</p>
            )}
            <p className="font-semibold py-1">{yourPart}</p>
            {done && <p className="text-green-700">{done}</p>}

            <div className="flex gap-2 py-2 flex-wrap">
                <Link to={`/financialPackagePage?id=${app.id}`} className="border px-4 py-2">Open Financial Package</Link>
                <Link to={`/loanFolderPage?id=${app.id}`} className="border px-4 py-2">Open loan application (KYC & documents)</Link>
                <Link to={`/creditScorePage?id=${app.id}`} className="border px-4 py-2">Open Credit Scoring</Link>
            </div>

            <Section title="Review progress">
                <ReviewProgress rows={rows} state={state} names={names} myId={myId} checkItems={checkItems} stage={stage?.stage} />
            </Section>

            <Section title={`Flags to check (${flags.length})`}>
                {flags.length === 0 ? <p className="italic">Nothing flagged.</p> : <FlagList flags={flags} />}
                <p className="text-xs text-gray-600 pt-1">
                    Computed from the record. Flags point at something to check; you decide. DBR / LCR limits are the
                    credit score's worst bands, not the bank's MRAC (policy checks come later).
                </p>
            </Section>

            <Section title={`Credit Officer's recommendation${coId ? ` (${names[coId] ?? 'Credit Officer'})` : ''}`}>
                <p><span className="font-semibold">Credit Result:</span> {resultLabel ?? <span className="italic">Not set</span>}</p>
                <Text label="Justification and Remarks" value={pkg.justification} />
                <Text label="Amendment" value={pkg.amendment} />
                <Text label="Waiver and Acceptance" value={pkg.waiver_and_acceptance} />
                <Text label="Deferral(s)" value={pkg.deferrals} />
            </Section>

            <Section title="Income: declared vs. what the CO used, with the documents">
                <IncomeEvidence app={app} computed={computed} fp={fp} onError={setSubmitError} />
            </Section>

            <Section title="Key figures (from the Financial Package)">
                <table>
                    <tbody>
                        <Row label="Loan amount">{money(app.loan_amount)}</Row>
                        <Row label="Term / interest rate">
                            {app.loan_term_years ? `${app.loan_term_years} years` : '—'} ·{' '}
                            {app.interest_rate != null ? `${app.interest_rate}% p.a.` : 'rate not set'}
                            {app.fixing_period ? `, fixed ${app.fixing_period}` : ''}
                        </Row>
                        <Row label="Monthly amortization">{money(computed.amortization)}</Row>
                        <Row label="Total gross monthly income (D)">{money(computed.totalGross)}</Row>
                        <Row label="Existing monthly amortizations (C)">{money(computed.existing)}</Row>
                        <Row label="DBR">{percent(computed.dbr) ?? '—'}</Row>
                        <Row label="Collateral">
                            {[collateral?.property_type, collateral?.project_name].filter(Boolean).join(' · ') || '—'}
                        </Row>
                        <Row label={computed.appraised !== null ? 'Appraised value' : 'TCP (no appraised value yet)'}>
                            {money(computed.collateralValue)}
                        </Row>
                        <Row label="LCR">{percent(computed.lcr) ?? '—'}</Row>
                    </tbody>
                </table>
            </Section>

            <Section title="IV. Credit Checking (CI results)">
                <CiResultsView app={app} title={null} />
            </Section>

            <Section title="Credit score">
                {score.scored === 0 ? <p className="italic">Not scored yet.</p> : (
                    <>
                        <table className="border-collapse">
                            <tbody>
                                {CATEGORIES.map((c) => (
                                    <Row key={c.value} label={c.label}>
                                        {score.byCategory[c.value].score} / {score.byCategory[c.value].max}
                                    </Row>
                                ))}
                                <Row label="Total">{score.total} / 100</Row>
                                <Row label="Risk rating">{score.riskRating ?? '—'}</Row>
                                <Row label="Recommendation">{score.recommendation ?? '—'}</Row>
                            </tbody>
                        </table>
                        {!score.complete && (
                            <p className="text-amber-700">Not finished: {score.scored} of {score.count} criteria scored.</p>
                        )}
                    </>
                )}
            </Section>

            <Section title="V. Exception/s">
                {fp.exceptions.length === 0 ? <p className="italic">None.</p> : (
                    <table>
                        <thead>
                            <tr className="text-left">
                                <th>Policy</th>
                                <th>Exception/s / Recommendation</th>
                                <th>Risk Mitigant / Justifications</th>
                            </tr>
                        </thead>
                        <tbody>
                            {fp.exceptions.map((x) => (
                                <tr key={x.id}>
                                    <td className="align-top whitespace-pre-wrap">{x.policy ?? '—'}</td>
                                    <td className="align-top whitespace-pre-wrap">{x.exception_recommendation ?? '—'}</td>
                                    <td className="align-top whitespace-pre-wrap">{x.mitigant ?? '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </Section>

            {changesSince && (
                <Section title={`Changes since ${changesSince.label} (${changes.length})`}>
                    {changes.length === 0 ? <p className="italic">No changes to the FP, credit score or loan details.</p>
                        : <ChangeHistory app={app} entries={changes} names={names} />}
                </Section>
            )}

            <Section title="VII. Approval">
                <RoutingSummary tier={pkg.approval_tier} rows={rows} names={names} myId={myId} />
            </Section>

            {canAct && (
                <Section title={`Your review (reviewer ${current.seq} of ${reviewers.length})`}>
                    <ReviewForm checkItems={checkItems} flags={flags} nextLabel={nextLabel}
                        onSubmit={handleSubmit} busy={busy} error={submitError} />
                </Section>
            )}
            {!canAct && submitError && <p className="text-red-600">{submitError}</p>}
        </div>
    );
};

export default ReviewSummaryPage;
