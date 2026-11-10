// Decision Support sections. Each one is a component that gets the same `ctx` (the loaded data plus what the page
// derived from it). SECTIONS decides the order, the navigator labels and when a section is shown, so Sprint 5 adds
// a section by writing a component here and adding one entry in registry.js.
// All of it is read only: the supporting information for a decision, not the decision itself.
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { Section } from '../applicationForm/fields';
import { money } from './format';
import { one } from '../applicationForm/api';
import { CiResultsView } from '../ciRequest/ciResults';
import { percent } from '../financialPackage/compute';
import { CATEGORIES } from '../financialPackage/creditScore';
import MracResult from '../mrac/mracResult';
import { ApprovalProgress } from '../review/approvalParts';
import { ReviewProgress } from '../review/reviewParts';
import RoutingSummary from '../review/routingSummary';

const blank = (v) => v === null || v === undefined || String(v).trim() === '';

const Info = ({ label, children, wrap = false }) => (
    <div className="fp-info-row">
        <dt>{label}</dt>
        <dd className={wrap ? 'wrap' : undefined}>{children}</dd>
    </div>
);
const Text = ({ label, value }) => (blank(value) ? null : <Info label={label} wrap>{value}</Info>);

// ---- Policy check (RAG) ----
export const PolicyCheck = ({ ctx }) => {
    const { mrac, mracChanges } = ctx;
    return (
        <Section id="ds-policy" title="Policy check (MRAC / policy RAG)" className="mrac">
            <p className="fp-note">
                The latest check the Credit Officer ran against the bank's credit policy. These are suggestions with the
                policy clause each one comes from; read the clause before relying on it. Only the assigned Credit Officer
                can run a new check (in the Financial Package).
            </p>
            {!mrac && <p className="fp-empty">No policy check has been run for this application yet.</p>}
            {mrac && ['PENDING', 'RUNNING'].includes(mrac.status) && (
                <p className="fp-empty">A check is in progress. Reload the page in a moment.</p>
            )}
            {mrac?.status === 'FAILED' && <p className="mrac-err">The last check failed: {mrac.error}</p>}
            {mrac?.status === 'DONE' && mracChanges.length > 0 && (
                <p className="lf-note warn">
                    <AlertTriangle size={16} aria-hidden="true" />
                    <span>
                        The figures changed after this check ({mracChanges.join(', ')}). The result may be out of date;
                        ask the Credit Officer to check again.
                    </span>
                </p>
            )}
            {mrac?.status === 'DONE' && <MracResult key={mrac.id} run={mrac} />}
        </Section>
    );
};

// ---- Credit Officer's recommendation ----
export const Recommendation = ({ ctx }) => {
    const { pkg, resultLabel, coId, names } = ctx;
    return (
        <Section id="ds-recommendation" title={`Credit Officer's recommendation${coId ? ` (${names[coId] ?? 'Credit Officer'})` : ''}`}>
            <dl className="fp-info">
                <Info label="Credit result">{resultLabel ?? <span className="fp-pending">Not set</span>}</Info>
                <Text label="Justification and remarks" value={pkg.justification} />
                <Text label="Amendment" value={pkg.amendment} />
                <Text label="Waiver and Acceptance" value={pkg.waiver_and_acceptance} />
                <Text label="Deferral(s)" value={pkg.deferrals} />
            </dl>
        </Section>
    );
};

// ---- Key figures ----
export const Figures = ({ ctx }) => {
    const { app, computed } = ctx;
    const collateral = one(app.collateral_details);
    return (
        <Section id="ds-figures" title="Key figures (from the Financial Package)">
            <dl className="fp-info">
                <Info label="Loan amount">{money(app.loan_amount)}</Info>
                <Info label="Loan purpose">{app.loan_purposes?.label ?? app.loan_purpose_other ?? '—'}</Info>
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
    );
};

// ---- Credit score ----
export const Score = ({ ctx }) => {
    const { score } = ctx;
    return (
        <Section id="ds-score" title="Credit score">
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
    );
};

// ---- CI results ----
export const CreditChecking = ({ ctx }) => (
    <Section id="ds-ci" title="IV. Credit Checking (CI results)">
        {!ctx.ciDone && <p className="lf-note warn">Credit investigation is not finished yet.</p>}
        <CiResultsView app={ctx.app} title={null} />
    </Section>
);

// ---- Exceptions ----
export const Exceptions = ({ ctx }) => {
    const { exceptions } = ctx;
    return (
        <Section id="ds-exceptions" title={`V. Exception/s (${exceptions.length})`}>
            {exceptions.length === 0 ? <p className="fp-empty">None recorded in the Financial Package.</p> : (
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
                            {exceptions.map((x) => (
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
    );
};

// ---- Sign-offs and decisions so far ----
export const Decisions = ({ ctx }) => {
    const { rows, reviewState, reviewers, approvers, approvals, names, positions, myId, checkItems, stage, pkg } = ctx;
    const showApprovals = approvals.length > 0 || ['APPROVAL', 'DECIDED'].includes(stage?.stage);
    return (
        <Section id="ds-decisions" title="Sign-offs and decisions so far">
            {reviewers.length === 0 && approvers.length === 0
                ? <p className="fp-empty">Not sent for review yet.</p>
                : (
                    <>
                        {reviewers.length > 0 && (
                            <ReviewProgress rows={rows} state={reviewState} names={names} myId={myId}
                                checkItems={checkItems} stage={stage?.stage} />
                        )}
                        {showApprovals ? (
                            <ApprovalProgress tier={pkg.approval_tier} approvers={approvers} decisions={approvals}
                                names={names} positions={positions} myId={myId} stage={stage?.stage} />
                        ) : <RoutingSummary tier={pkg.approval_tier} rows={rows} names={names} myId={myId} />}
                    </>
                )}
        </Section>
    );
};

// ---- Where to act (Sprint 5: the committee actions go here) ----
export const NextStep = ({ ctx }) => (
    <Section id="ds-next" title="Where to act">
        <p className="fp-note">
            This page only gathers the supporting information. Reviewers sign off and approvers decide on the review summary.
        </p>
        <Link to={`/reviewSummaryPage?id=${ctx.app.id}`} className="lf-btn">
            Open review summary<ArrowRight size={16} aria-hidden="true" />
        </Link>
    </Section>
);

