// What a reviewer / approver sees first when they open an application routed to them (VII. Approval):
// the Credit Officer's recommendation, the credit score, the key FP figures and exceptions, and the routing,
// with buttons to the full Financial Package and the loan application. View only for now; the review
// sign-off (mark reviewed / request revision) and the approval decision come later.
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { UserAuth } from '../../context/authContext';
import { fetchApplication, getParties, one } from '../applicationForm/api';
import { Section } from '../applicationForm/fields';
import { BORROWER_ROLES, formatMoney, partyLabel } from '../applicationForm/options';
import { fetchStaffNames } from '../loanFolder/api';
import { fetchAssignee, fetchCreditScoreRules, fetchFinancialPackage } from '../financialPackage/api';
import { computeFp, percent } from '../financialPackage/compute';
import { CATEGORIES, totalCreditScore } from '../financialPackage/creditScore';
import { CREDIT_RESULTS } from '../financialPackage/options';
import { STAGE_STATUS_LABELS, stageLabel } from '../workTray/options';
import { fetchCurrentStage, fetchReviewAssignments } from './api';
import { splitRouting } from './approval';
import RoutingSummary from './routingSummary';
import MessagesPanel from '../messages/messagesPanel';

const fullName = (p) => [p.first_name, p.middle_name, p.last_name, p.name_extension].filter(Boolean).join(' ');
const money = (v) => (v === null || v === undefined || v === '' ? '—' : `₱${formatMoney(v)}`);
const blank = (v) => v === null || v === undefined || String(v).trim() === '';

const Row = ({ label, children }) => (
    <tr>
        <td className="border px-2 font-semibold align-top">{label}</td>
        <td className="border px-2 align-top">{children}</td>
    </tr>
);

const Text = ({ label, value }) => (blank(value) ? null : (
    <div className="py-1">
        <p className="font-semibold">{label}</p>
        <p className="whitespace-pre-wrap">{value}</p>
    </div>
));

const ReviewSummaryPage = () => {
    const { session } = UserAuth();
    const myId = session?.user?.id;
    const [searchParams] = useSearchParams();
    const applicationId = Number(searchParams.get('id'));

    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const app = await fetchApplication(applicationId);
                const ids = getParties(app, BORROWER_ROLES).map((p) => p.id);
                const [fp, rules, rows, stage, coId] = await Promise.all([
                    fetchFinancialPackage(app.id, ids), fetchCreditScoreRules(), fetchReviewAssignments(app.id),
                    fetchCurrentStage(app.id), fetchAssignee(app.id, 'CREDIT_OFFICER')]);
                const names = await fetchStaffNames([coId, ...rows.flatMap((r) => [r.user_id, r.assigned_by])]);
                if (!cancelled) setData({ app, fp, rules, rows, stage, coId, names });
            } catch (err) {
                if (!cancelled) setError(err.message);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        load();
        return () => { cancelled = true; };
    }, [applicationId]);

    if (loading) return <p>Loading review summary...</p>;
    if (error) return <p className="text-red-600">{error}</p>;
    if (!data) return null;

    const { app, fp, rules, rows, stage, coId, names } = data;
    const pkg = fp.pkg ?? {};
    const details = Object.fromEntries(fp.parties.map((r) => [r.applicant_id, r]));
    const computed = computeFp(app, details, pkg, { interest_rate: app.interest_rate });
    const score = totalCreditScore(rules, Object.fromEntries(fp.creditScore.map((r) => [r.criterion, r])));

    const { reviewers, approvers } = splitRouting(rows);
    const myReview = reviewers.find((r) => r.user_id === myId);
    const isApprover = approvers.some((r) => r.user_id === myId);
    const sentRow = [...reviewers, ...approvers].sort((a, b) => new Date(a.assigned_at) - new Date(b.assigned_at))[0];
    const borrowers = getParties(app, BORROWER_ROLES).map((p) => `${fullName(p)} (${partyLabel(p)})`).join(', ');
    const resultLabel = CREDIT_RESULTS.find((r) => r.value === pkg.credit_result)?.label;
    const collateral = one(app.collateral_details);

    return (
        <div className="max-w-5xl m-auto p-4 text-left">
            <MessagesPanel applicationId={app.id} />
            <p><Link to="/adminHomePage" className="underline">Back to work tray</Link></p>
            <h2>Review summary: {app.application_no}</h2>
            <p><span className="font-semibold">Name of Borrower/s:</span> {borrowers || '—'}</p>
            <p><span className="font-semibold">Stage:</span>{' '}
                {stage ? `${stageLabel(stage.stage)} · ${STAGE_STATUS_LABELS[stage.status] ?? '—'}` : '—'}</p>
            {sentRow && (
                <p><span className="font-semibold">Sent for review by</span> {names[sentRow.assigned_by] ?? 'unknown'} on{' '}
                    {new Date(sentRow.assigned_at).toLocaleString()}</p>
            )}
            <p className="font-semibold py-1">
                {myReview ? `You are reviewer ${myReview.seq} of ${reviewers.length}.`
                    : isApprover ? 'You are an approver on this application.'
                        : 'This application isn\'t assigned to you (view only).'}
            </p>

            <div className="flex gap-2 py-2">
                <Link to={`/financialPackagePage?id=${app.id}`} className="border px-4 py-2">Open Financial Package</Link>
                <Link to={`/loanFolderPage?id=${app.id}`} className="border px-4 py-2">Open loan application</Link>
            </div>

            <Section title={`Credit Officer's recommendation${coId ? ` (${names[coId] ?? 'Credit Officer'})` : ''}`}>
                <p><span className="font-semibold">Credit Result:</span> {resultLabel ?? <span className="italic">Not set</span>}</p>
                <Text label="Justification and Remarks" value={pkg.justification} />
                <Text label="Amendment" value={pkg.amendment} />
                <Text label="Waiver and Acceptance" value={pkg.waiver_and_acceptance} />
                <Text label="Deferral(s)" value={pkg.deferrals} />
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
                <p className="pt-2">
                    <Link to={`/creditScorePage?id=${app.id}`} className="underline">Open Credit Scoring</Link>
                </p>
            </Section>

            <Section title="Key figures (from the Financial Package)">
                <table className="border-collapse">
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
                {computed.missingBasis.length > 0 && (
                    <p className="text-amber-700">
                        No income basis picked for {computed.missingBasis.map(partyLabel).join(', ')}, so gross income and DBR are incomplete.
                    </p>
                )}
            </Section>

            <Section title="V. Exception/s">
                {fp.exceptions.length === 0 ? <p className="italic">None.</p> : (
                    <table className="border-collapse">
                        <thead>
                            <tr className="text-left">
                                <th className="border px-2">Policy</th>
                                <th className="border px-2">Exception/s / Recommendation</th>
                                <th className="border px-2">Risk Mitigant / Justifications</th>
                            </tr>
                        </thead>
                        <tbody>
                            {fp.exceptions.map((x) => (
                                <tr key={x.id}>
                                    <td className="border px-2 align-top whitespace-pre-wrap">{x.policy ?? '—'}</td>
                                    <td className="border px-2 align-top whitespace-pre-wrap">{x.exception_recommendation ?? '—'}</td>
                                    <td className="border px-2 align-top whitespace-pre-wrap">{x.mitigant ?? '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </Section>

            <Section title="VII. Approval">
                <RoutingSummary tier={pkg.approval_tier} rows={rows} names={names} myId={myId} />
            </Section>
        </div>
    );
};

export default ReviewSummaryPage;
