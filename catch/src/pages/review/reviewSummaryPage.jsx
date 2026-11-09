// What a reviewer / approver opens for an application routed to them (VII. Approval).
// The reviewer is a second layer of checking on the Credit Officer's work (CATCH Document Ch. 1.3; CO and
// Credit Head interviews): automatic flags, income claim vs. evidence, the CO's recommendation and figures,
// CI results, credit score, exceptions, what changed since it was sent, then (current reviewer only) a
// checklist and a decision: Endorse / Not endorse (a recommendation, not an approval) or Return to the CO
// for revision. Reviewers act in order; after the last one it moves to Approval (submit_review()).
// Approvers and everyone else with access read the same page, including every reviewer's sign-off.
// Laid out like the Financial Package / loan folder pages: header card + metrics, section navigator, section cards.
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, UserCheck } from 'lucide-react';
import Breadcrumbs from '../../components/breadcrumbs';
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
import '../loanFolder/loanFolder.css';
import '../financialPackage/financialPackage.css';
import './review.css';
import { scrollToSection, useActiveSection } from './useActiveSection';

const fullName = (p) => [p.first_name, p.middle_name, p.last_name, p.name_extension].filter(Boolean).join(' ');
const money = (v) => (v === null || v === undefined || v === '' ? '—' : `₱${formatMoney(v)}`);
const blank = (v) => v === null || v === undefined || String(v).trim() === '';

// One label / value line in a card (same look as the Financial Package's read-only rows)
const Info = ({ label, children, wrap = false }) => (
    <div className="fp-info-row">
        <dt>{label}</dt>
        <dd className={wrap ? 'wrap' : undefined}>{children}</dd>
    </div>
);

const Text = ({ label, value }) => (blank(value) ? null : <Info label={label} wrap>{value}</Info>);

// Section navigator: [element id, label]; the ids are set on the <Section>s below
const TOC = [
    ['rv-progress', 'Review progress'], ['rv-flags', 'Flags to check'], ['rv-recommendation', "Credit Officer's recommendation"],
    ['rv-income', 'Income evidence'], ['rv-figures', 'Key figures'], ['rv-ci', 'IV. Credit checking'],
    ['rv-score', 'Credit score'], ['rv-exceptions', 'V. Exceptions'], ['rv-changes', 'Changes since'],
    ['rv-approval', 'VII. Approval'], ['rv-review', 'Your review'],
];

const TOC_IDS = TOC.map(([id]) => id);

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
    const [activeId, pickSection] = useActiveSection(TOC_IDS, Boolean(data));

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

    if (loading) return <p className="fp-empty">Loading review summary...</p>;
    if (error) return <p className="ct-error">{error}</p>;
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

    const stageText = stage ? `${stageLabel(stage.stage)} · ${STAGE_STATUS_LABELS[stage.status] ?? '—'}` : '—';
    const stageFor = stage?.enteredAt && ['REVIEW', 'APPROVAL'].includes(stage.stage) ? ` (for ${days(stage.enteredAt)})` : '';
    const returned = state.returns.length > 0
        ? ` · returned ${state.returns.length} time${state.returns.length === 1 ? '' : 's'}` : '';

    const metrics = [
        { key: 'result', label: 'Credit result', value: resultLabel ?? 'Not set', sub: 'CO recommendation', tone: resultLabel ? 'info' : 'warn' },
        {
            key: 'risk', label: 'Credit risk rating', value: score.riskRating ?? 'Not scored',
            sub: score.riskRating ? `${score.total} / 100` : `${score.scored} of ${score.count} scored`,
            tone: score.riskRating ? 'info' : 'warn',
        },
        {
            key: 'loan', label: 'Loan amount', value: money(app.loan_amount),
            sub: app.loan_term_years ? `${app.loan_term_years} years` : 'Term not set', tone: 'plain',
        },
        { key: 'dbr', label: 'Debt burden ratio', value: percent(computed.dbr) ?? '—', sub: 'DBR', tone: 'plain' },
        { key: 'lcr', label: 'Loan-to-collateral', value: percent(computed.lcr) ?? '—', sub: 'LCR', tone: 'plain' },
        { key: 'amort', label: 'Monthly amortization', value: money(computed.amortization), sub: 'New loan', tone: 'plain' },
    ];

    const nav = TOC.filter(([id]) => (id === 'rv-changes' ? Boolean(changesSince) : id === 'rv-review' ? canAct : true))
        .map(([id, label]) => [id, id === 'rv-flags' ? `${label} (${flags.length})` : label]);

    const goTo = (id) => (e) => {
        e.preventDefault();
        pickSection(id);
        scrollToSection(id);
    };

    return (
        <div className="lf fp rv">
            <Breadcrumbs current="review" appId={app.id} appNo={app.application_no} />
            <header className="lf-card">
                <div className="lf-titlerow">
                    <div>
                        <h1>Review summary {app.application_no}</h1>
                        <ul className="lf-meta">
                            <li>Borrower/s: {borrowers || '—'}</li>
                            <li>Stage: {stageText}{stageFor}{returned}</li>
                            {sentRow && (
                                <li>Sent for review by {names[sentRow.assigned_by] ?? 'unknown'} on {new Date(sentRow.assigned_at).toLocaleString()}</li>
                            )}
                        </ul>
                    </div>
                    <div className="lf-actions">
                        <MessagesPanel applicationId={app.id} inline />
                        <Link to={`/financialPackagePage?id=${app.id}`} className="lf-btn">Financial Package</Link>
                        <Link to={`/creditScorePage?id=${app.id}`} className="lf-btn">Credit scoring</Link>
                        <Link to={`/loanFolderPage?id=${app.id}`} className="lf-btn">
                            Loan folder<ArrowRight size={16} aria-hidden="true" />
                        </Link>
                    </div>
                </div>

                <div className="fp-metrics">
                    {metrics.map((m) => (
                        <div key={m.key} className={`fp-metric ${m.tone}`}>
                            <span className="lbl">{m.label}</span>
                            <span className="val">{m.value}</span>
                            <span className="sub">{m.sub}</span>
                        </div>
                    ))}
                </div>

                <p className="lf-note">
                    <UserCheck size={16} aria-hidden="true" />
                    <span>{yourPart}</span>
                </p>
                {done && <p className="lf-ok-note rv-done" role="status">{done}</p>}
            </header>

            <div className="lf-body edit">
                <nav className="lf-card lf-nav fp-nav" aria-label="Review summary sections">
                    <ul>
                        {nav.map(([id, label]) => (
                            <li key={id}>
                                <a href={`#${id}`} onClick={goTo(id)} aria-current={activeId === id ? 'true' : undefined}>{label}</a>
                            </li>
                        ))}
                    </ul>
                </nav>

                <div className="lf-main fp-main">
                    <Section id="rv-progress" title="Review progress">
                        <ReviewProgress rows={rows} state={state} names={names} myId={myId} checkItems={checkItems} stage={stage?.stage} />
                    </Section>

                    <Section id="rv-flags" title={`Flags to check (${flags.length})`}>
                        {flags.length === 0 ? <p className="fp-empty">Nothing flagged.</p> : <FlagList flags={flags} />}
                        <p className="fp-note">
                            Computed from the record. Flags point at something to check; you decide. DBR / LCR limits are the
                            credit score's worst bands, not the bank's MRAC (policy checks come later).
                        </p>
                    </Section>

                    <Section id="rv-recommendation" title={`Credit Officer's recommendation${coId ? ` (${names[coId] ?? 'Credit Officer'})` : ''}`}>
                        <dl className="fp-info">
                            <Info label="Credit result">
                                {resultLabel ?? <span className="fp-pending">Not set</span>}
                            </Info>
                            <Text label="Justification and remarks" value={pkg.justification} />
                            <Text label="Amendment" value={pkg.amendment} />
                            <Text label="Waiver and Acceptance" value={pkg.waiver_and_acceptance} />
                            <Text label="Deferral(s)" value={pkg.deferrals} />
                        </dl>
                    </Section>

                    <Section id="rv-income" title="Income: declared vs. what the CO used, with the documents">
                        <IncomeEvidence app={app} computed={computed} fp={fp} onError={setSubmitError} />
                    </Section>

                    <Section id="rv-figures" title="Key figures (from the Financial Package)">
                        <dl className="fp-info">
                            <Info label="Loan amount">{money(app.loan_amount)}</Info>
                            <Info label="Term / interest rate">
                                {app.loan_term_years ? `${app.loan_term_years} years` : '—'} ·{' '}
                                {app.interest_rate != null ? `${app.interest_rate}% p.a.` : 'rate not set'}
                                {app.fixing_period ? `, fixed ${app.fixing_period}` : ''}
                            </Info>
                            <Info label="Monthly amortization">{money(computed.amortization)}</Info>
                            <Info label="Total gross monthly income (D)">{money(computed.totalGross)}</Info>
                            <Info label="Existing monthly amortizations (C)">{money(computed.existing)}</Info>
                            <Info label="DBR">{percent(computed.dbr) ?? '—'}</Info>
                            <Info label="Collateral">
                                {[collateral?.property_type, collateral?.project_name].filter(Boolean).join(' · ') || '—'}
                            </Info>
                            <Info label={computed.appraised !== null ? 'Appraised value' : 'TCP (no appraised value yet)'}>
                                {money(computed.collateralValue)}
                            </Info>
                            <Info label="LCR">{percent(computed.lcr) ?? '—'}</Info>
                        </dl>
                    </Section>

                    <Section id="rv-ci" title="IV. Credit Checking (CI results)">
                        <CiResultsView app={app} title={null} />
                    </Section>

                    <Section id="rv-score" title="Credit score">
                        {score.scored === 0 ? <p className="fp-empty">Not scored yet.</p> : (
                            <>
                                <dl className="fp-info">
                                    {CATEGORIES.map((c) => (
                                        <Info key={c.value} label={c.label}>
                                            {score.byCategory[c.value].score} / {score.byCategory[c.value].max}
                                        </Info>
                                    ))}
                                    <Info label="Total">{score.total} / 100</Info>
                                    <Info label="Risk rating">{score.riskRating ?? '—'}</Info>
                                    <Info label="Recommendation">{score.recommendation ?? '—'}</Info>
                                </dl>
                                {!score.complete && (
                                    <p className="lf-note warn">Not finished: {score.scored} of {score.count} criteria scored.</p>
                                )}
                            </>
                        )}
                    </Section>

                    <Section id="rv-exceptions" title="V. Exception/s">
                        {fp.exceptions.length === 0 ? <p className="fp-empty">None.</p> : (
                            <div className="fp-tablewrap">
                                <table>
                                    <thead>
                                        <tr>
                                            <th>Policy</th>
                                            <th>Exception/s / Recommendation</th>
                                            <th>Risk Mitigant / Justifications</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {fp.exceptions.map((x) => (
                                            <tr key={x.id}>
                                                <td className="whitespace-pre-wrap">{x.policy ?? '—'}</td>
                                                <td className="whitespace-pre-wrap">{x.exception_recommendation ?? '—'}</td>
                                                <td className="whitespace-pre-wrap">{x.mitigant ?? '—'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </Section>

                    {changesSince && (
                        <Section id="rv-changes" title={`Changes since ${changesSince.label} (${changes.length})`}>
                            {changes.length === 0 ? <p className="fp-empty">No changes to the FP, credit score or loan details.</p>
                                : <ChangeHistory app={app} entries={changes} names={names} />}
                        </Section>
                    )}

                    <Section id="rv-approval" title="VII. Approval">
                        <RoutingSummary tier={pkg.approval_tier} rows={rows} names={names} myId={myId} />
                    </Section>

                    {canAct && (
                        <Section id="rv-review" title={`Your review (reviewer ${current.seq} of ${reviewers.length})`}>
                            <ReviewForm checkItems={checkItems} flags={flags} nextLabel={nextLabel}
                                onSubmit={handleSubmit} busy={busy} error={submitError} />
                        </Section>
                    )}
                    {!canAct && submitError && <p className="ct-error">{submitError}</p>}
                </div>
            </div>
        </div>
    );
};

export default ReviewSummaryPage;
