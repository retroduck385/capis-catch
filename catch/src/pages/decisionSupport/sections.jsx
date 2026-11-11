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
import { ROLE_LABELS } from '../../roles';
import { showFact, showRequirement, STATUS } from '../mrac/labels';
import MracResult, { Citation } from '../mrac/mracResult';
import { ApprovalProgress } from '../review/approvalParts';
import { ReviewProgress } from '../review/reviewParts';
import RoutingSummary from '../review/routingSummary';
import { READY } from './readiness';
import './decisionSupport.css';

const blank = (v) => v === null || v === undefined || String(v).trim() === '';

const Info = ({ label, children, wrap = false }) => (
    <div className="fp-info-row">
        <dt>{label}</dt>
        <dd className={wrap ? 'wrap' : undefined}>{children}</dd>
    </div>
);
const Text = ({ label, value }) => (blank(value) ? null : <Info label={label} wrap>{value}</Info>);

// ---- DSS-10: readiness for decision ----
const READY_CHIP = {
    [READY.DONE]: ['Done', 'ok'],
    [READY.MISSING]: ['Missing', 'warn'],
    [READY.CHECK]: ['Check', 'warn'],
};

export const Readiness = ({ ctx }) => {
    const { readiness, names, aoId, coId } = ctx;
    const ownerOf = (role) => {
        const person = role === 'ACCOUNT_OFFICER' ? names[aoId] : role === 'CREDIT_OFFICER' ? names[coId] : null;
        return `${ROLE_LABELS[role] ?? role}${person ? ` (${person})` : ''}`;
    };
    return (
        <Section id="ds-readiness" title={`Readiness for decision (${readiness.readyCount} of ${readiness.total})`} className="mrac ds">
            <div className={`mrac-banner ${readiness.ready ? 'ok' : 'warn'}`}>
                <div className="top">
                    <b>{readiness.ready ? 'Everything a decision needs is in place' : 'Not everything a decision needs is in place yet'}</b>
                </div>
                <p>
                    {readiness.ready
                        ? 'Each input below is present. The evaluator will not find a missing piece.'
                        : `${readiness.total - readiness.readyCount} of ${readiness.total} items still need attention; each shows what is missing and who owns it.`}
                </p>
            </div>
            <ul className="ds-ready">
                {readiness.items.map((item) => {
                    const [chip, tone] = READY_CHIP[item.state];
                    return (
                        <li key={item.key} className={tone}>
                            <span className={`mrac-chip ${tone}`}>{chip}</span>
                            <div className="body">
                                <b>{item.label}</b>
                                <p>{item.detail}</p>
                                <small>
                                    {item.state === READY.DONE ? 'Owner' : 'Waiting on'}: {ownerOf(item.owner)}
                                    {item.to && item.state !== READY.DONE && (
                                        <> · <Link to={item.to}>{item.action}<ArrowRight size={12} aria-hidden="true" /></Link></>
                                    )}
                                </small>
                            </div>
                        </li>
                    );
                })}
            </ul>
            <p className="fp-note">
                This is a checklist of what is present, not a block: the stage rules still decide what can move forward.
            </p>
        </Section>
    );
};

// ---- DSS-11: exception highlights ----
const TONE_OF = { fail: 'bad', needs_review: 'warn' };

export const ExceptionHighlights = ({ ctx }) => {
    const { mrac, mracChanges, exceptions } = ctx;
    const done = mrac?.status === 'DONE';
    const criteria = done ? mrac.result?.criteria ?? [] : [];
    const flagged = [...criteria.filter((c) => c.status === 'fail'), ...criteria.filter((c) => c.status === 'needs_review')];
    const failCount = criteria.filter((c) => c.status === 'fail').length;
    const reviewCount = criteria.length - failCount - criteria.filter((c) => c.status === 'pass').length;
    const manual = done ? mrac.result?.manual_checks ?? [] : [];

    let tone = 'ok';
    let headline = 'No criteria fail or need review';
    if (!done) {
        tone = 'warn';
        headline = 'No policy check to draw highlights from yet';
    } else if (failCount > 0) {
        tone = 'bad';
        headline = `${failCount} ${failCount === 1 ? 'criterion fails' : 'criteria fail'}${reviewCount ? ` and ${reviewCount} need${reviewCount === 1 ? 's' : ''} review` : ''}`;
    } else if (reviewCount > 0) {
        tone = 'warn';
        headline = `${reviewCount} ${reviewCount === 1 ? 'criterion needs' : 'criteria need'} review`;
    }

    return (
        <Section id="ds-highlights" title={`Exception highlights (${flagged.length + exceptions.length})`} className="mrac ds">
            <div className={`mrac-banner ${tone}`}>
                <div className="top"><b>{headline}</b></div>
                <p>
                    {exceptions.length} {exceptions.length === 1 ? 'exception is' : 'exceptions are'} recorded in the Financial Package
                    {manual.length > 0 ? `; ${manual.length} ${manual.length === 1 ? 'item is' : 'items are'} for the underwriter to verify from the documents` : ''}.
                </p>
            </div>

            {!done && (
                <p className="fp-empty">
                    The highlights come from the policy check. Until the Credit Officer runs one, only the recorded
                    exceptions below are known.
                </p>
            )}
            {done && mracChanges.length > 0 && (
                <p className="lf-note warn">
                    <AlertTriangle size={16} aria-hidden="true" />
                    <span>The figures changed after the check ({mracChanges.join(', ')}); these highlights may be out of date.</span>
                </p>
            )}

            {flagged.length > 0 && (
                <ul className="ds-flags">
                    {flagged.map((c) => {
                        const [label] = STATUS[c.status] ?? [c.status];
                        const flagTone = TONE_OF[c.status] ?? 'plain';
                        return (
                            <li key={c.code} className={flagTone}>
                                <div className="head">
                                    <span className={`mrac-chip ${flagTone}`}>{label}</span>
                                    <b>{c.label}</b>
                                </div>
                                <p className="figs">
                                    Value: <b>{showFact(c.field, c.value)}</b> · Required: <b>{showRequirement(c.field, c.threshold)}</b>
                                </p>
                                {c.reason && <p className="why">{c.reason}</p>}
                                {c.source && (
                                    <details className="mrac-facts">
                                        <summary>Policy clause</summary>
                                        <Citation c={c.source} />
                                    </details>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}

            {exceptions.length > 0 && (
                <div className="mrac-block">
                    <h3>Recorded exceptions</h3>
                    <ul className="mrac-list">
                        {exceptions.map((x) => (
                            <li key={x.id}>
                                <strong>{x.policy ?? 'Policy not stated'}</strong>
                                {x.exception_recommendation && <> — {x.exception_recommendation}</>}
                                {x.mitigant && <div className="ref">Mitigant: {x.mitigant}</div>}
                            </li>
                        ))}
                    </ul>
                    <p className="fp-note"><a href="#ds-exceptions">Full table below (V. Exception/s)</a></p>
                </div>
            )}
        </Section>
    );
};

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

