// VII. Approval (KYC-FP "FP" tab), opened from the Financial Package. The approval authority comes from the
// bank's matrix (loan amount + V. Exception/s) and the approvers from the authority (Approver accounts with
// a matching position): both automatic. The assigned CO only picks the reviewer/s in review order, then
// sends the application for review (send_for_review(): moves it to Review).
// After sending, the Dept Head or the Dispatch Admin can change the reviewers or override the authority
// (update_review_routing()); the approvers follow the authority.
// Everyone else with access reads.
// Laid out like the Financial Package / loan folder pages: header card + metrics, section navigator, section cards.
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Lock } from 'lucide-react';
import { UserAuth } from '../../context/authContext';
import { ROUTING_HEADS } from '../../roles';
import { fetchApplication, getParties } from '../applicationForm/api';
import { FormError, Section } from '../applicationForm/fields';
import { BORROWER_ROLES, formatMoney } from '../applicationForm/options';
import { fetchStaffNames } from '../loanFolder/api';
import { fetchAssignee, fetchCoCanEdit, fetchCreditScoreRules, fetchFinancialPackage } from '../financialPackage/api';
import { totalCreditScore } from '../financialPackage/creditScore';
import { CREDIT_RESULTS } from '../financialPackage/options';
import { STAGE_STATUS_LABELS, stageLabel } from '../workTray/options';
import { fetchCurrentStage, fetchReviewAssignments, fetchReviewStaff, sendForReview, updateReviewRouting } from './api';
import {
    AMOUNT_BANDS, APPROVAL_TIERS, amountBand, approversFor, missingApprovers, positionLabel, splitRouting,
    suggestApprovalTier, tierFor, tierLabel,
} from './approval';
import { ResendPanel } from './returnNotice';
import RoutingSummary from './routingSummary';
import MessagesPanel from '../messages/messagesPanel';
import '../loanFolder/loanFolder.css';
import '../financialPackage/financialPackage.css';
import './review.css';
import { scrollToSection, useActiveSection } from './useActiveSection';

const SEND_STAGES = ['CREDIT_INVESTIGATION', 'CREDIT_EVALUATION'];
const UPDATE_STAGES = ['REVIEW', 'APPROVAL'];
const ROLE_NOUN = { REVIEWER: 'reviewer', APPROVER: 'approver' };
const fullName = (p) => [p.first_name, p.middle_name, p.last_name, p.name_extension].filter(Boolean).join(' ');
const money = (v) => (v ? `₱${formatMoney(v)}` : '—');

// Section navigator: [element id, label]; the ids are set on the <Section>s below
const TOC = [
    ['ar-prepared', 'Prepared by'], ['ar-authority', 'Approval authority'],
    ['ar-people', 'Reviewers and approvers'], ['ar-history', 'Routing history'],
];
const TOC_IDS = TOC.map(([id]) => id);

// One label / value line in a card (same look as the Financial Package's read-only rows)
const Info = ({ label, children }) => (
    <div className="fp-info-row">
        <dt>{label}</dt>
        <dd>{children}</dd>
    </div>
);

// Saved FP, routing, stage, AO / CO (+ the staff names in them)
const loadRouting = async (record) => {
    const ids = getParties(record, BORROWER_ROLES).map((p) => p.id);
    const [fp, rows, stage, aoId, coId] = await Promise.all([
        fetchFinancialPackage(record.id, ids), fetchReviewAssignments(record.id), fetchCurrentStage(record.id),
        fetchAssignee(record.id, 'ACCOUNT_OFFICER'), fetchAssignee(record.id, 'CREDIT_OFFICER')]);
    const names = await fetchStaffNames([aoId, coId, ...rows.flatMap((r) => [r.user_id, r.assigned_by, r.unassigned_by])]);
    return {
        fp, rows, stage, names,
        officers: { ao: aoId && (names[aoId] ?? 'Account Officer'), co: coId && (names[coId] ?? 'Credit Officer') },
    };
};

// Current routing, or the matrix's authority + one empty reviewer slot
const formOf = (record, { fp, rows }) => {
    const { reviewers } = splitRouting(rows);
    return {
        tier: fp.pkg?.approval_tier ?? suggestApprovalTier(record.loan_amount, fp.exceptions.length > 0) ?? '',
        reviewers: reviewers.length ? reviewers.map((r) => r.user_id) : [''],
    };
};

// Who the authority routes to, and what's missing (read-only; set by the DB on send / update)
const AutoApprovers = ({ staff, tier }) => {
    if (!tier) return <p className="fp-empty">No approval authority yet (no loan amount).</p>;
    const list = approversFor(staff, tier);
    const missing = missingApprovers(staff, tier);
    return (
        <div className="rv-block">
            <h3 className="fp-subhead">Approved by (automatic, from the approval authority)</h3>
            <p className="fp-note">{APPROVAL_TIERS.find((t) => t.value === tier)?.rule}</p>
            {list.length > 0 && (
                <ul className="rv-people">
                    {list.map((s) => (
                        <li key={s.user_id}><b>{s.name}</b><span className="lf-chip none">{positionLabel(s.approval_position)}</span></li>
                    ))}
                </ul>
            )}
            {missing.map((m) => (
                <p key={m} className="ct-error">No approver account for: {m}. The Department Head adds one in Staff Accounts.</p>
            ))}
        </div>
    );
};

// Ordered list of people of one role; '' = slot not picked yet
const PeoplePicker = ({ title, role, ordered, staff, value, onChange, disabled }) => {
    const options = staff.filter((s) => s.role === role);
    const set = (i, userId) => onChange(value.map((v, j) => (j === i ? userId : v)));
    const moveUp = (i) => onChange(value.map((v, j) => (j === i - 1 ? value[i] : j === i ? value[i - 1] : v)));

    return (
        <div className="rv-block">
            <h3 className="fp-subhead">{title}</h3>
            {options.length === 0 && (
                <p className="ct-error">No active {ROLE_NOUN[role]} accounts with a staff profile yet.</p>
            )}
            {value.map((userId, i) => (
                <div key={i} className="rv-slot">
                    {ordered && <span className="rv-seq" aria-hidden="true">{i + 1}</span>}
                    <select value={userId} onChange={(e) => set(i, e.target.value)} disabled={disabled}
                        aria-label={`${ROLE_NOUN[role]} ${i + 1}`}>
                        <option value="">Pick {role === 'APPROVER' ? 'an' : 'a'} {ROLE_NOUN[role]}...</option>
                        {options.filter((s) => s.user_id === userId || !value.includes(s.user_id)).map((s) => (
                            <option key={s.user_id} value={s.user_id}>{s.name}</option>
                        ))}
                    </select>
                    {!disabled && ordered && i > 0 && (
                        <button type="button" className="rv-link" onClick={() => moveUp(i)}>Move up</button>
                    )}
                    {!disabled && value.length > 1 && (
                        <button type="button" className="rv-link danger" onClick={() => onChange(value.filter((_, j) => j !== i))}>
                            Remove
                        </button>
                    )}
                </div>
            ))}
            {!disabled && value.length < options.length && (
                <button type="button" className="fp-add" onClick={() => onChange([...value, ''])}>
                    Add {ROLE_NOUN[role]}
                </button>
            )}
        </div>
    );
};

const ApprovalRoutingPage = () => {
    const { session, role } = UserAuth();
    const myId = session?.user?.id;
    const [searchParams] = useSearchParams();
    const applicationId = Number(searchParams.get('id'));

    const [app, setApp] = useState(null);
    const [rules, setRules] = useState(null);
    const [data, setData] = useState(null); // loadRouting()
    const [staff, setStaff] = useState([]);
    const [isAssignedCo, setIsAssignedCo] = useState(false);
    const [form, setForm] = useState(null); // { tier, reviewers: [user_id | ''] }
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [activeId, pickSection] = useActiveSection(TOC_IDS, Boolean(app && data && form && rules));

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const [record, coCanEdit, scoreRules, reviewStaff] = await Promise.all([
                    fetchApplication(applicationId), fetchCoCanEdit(applicationId), fetchCreditScoreRules(),
                    fetchReviewStaff()]);
                const routingData = await loadRouting(record);
                if (cancelled) return;
                setApp(record);
                setIsAssignedCo(coCanEdit);
                setRules(scoreRules);
                setStaff(reviewStaff);
                setData(routingData);
                setForm(formOf(record, routingData));
            } catch (err) {
                if (!cancelled) setError(err.message);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        load();
        return () => { cancelled = true; };
    }, [applicationId]);

    if (loading) return <p className="fp-empty">Loading VII. Approval...</p>;
    if (error && !form) return <p className="ct-error">{error}</p>;
    if (!app || !data || !form || !rules) return null;

    const { fp, rows, stage, names, officers } = data;

    const sent = splitRouting(rows).reviewers.length > 0;
    // The assigned CO can pick people any time before sending; sending itself needs CI / Credit Evaluation
    const canPick = isAssignedCo && !sent;
    const stageOk = SEND_STAGES.includes(stage?.stage);
    const canUpdate = ROUTING_HEADS.includes(role) && sent && UPDATE_STAGES.includes(stage?.stage);
    const editable = canPick || canUpdate;

    const pkg = fp.pkg ?? {};
    const deviations = fp.exceptions.length;
    const suggestion = suggestApprovalTier(app.loan_amount, deviations > 0);
    const band = amountBand(app.loan_amount);
    // The CO can't change the authority; heads can override it after sending
    const tier = canUpdate ? form.tier : canPick ? suggestion : pkg.approval_tier;
    const missing = tier ? missingApprovers(staff, tier) : [];
    const score = totalCreditScore(rules, Object.fromEntries(fp.creditScore.map((r) => [r.criterion, r])));
    const resultOk = pkg.credit_result && pkg.credit_result !== 'DEFERRED';
    const resultLabel = CREDIT_RESULTS.find((r) => r.value === pkg.credit_result)?.label;
    const picked = (list) => list.filter(Boolean);
    // Why "Send for review" is disabled (assigned CO, before sending)
    const blockers = canPick ? [
        !stageOk && `Sending works from Credit Investigation or Credit Evaluation; this application is in ${stage ? stageLabel(stage.stage) : 'no stage'}${stage?.stage === 'INTAKE' ? ' (the AO requests CI first)' : ''}.`,
        !resultOk && 'Save a Credit Result (Endorsed / Not endorsed) in the Financial Package.',
        !tier && 'The application needs a loan amount for the approval authority.',
        missing.length > 0 && 'Some approver positions this authority needs have no account (see Reviewers and approvers).',
        picked(form.reviewers).length === 0 && 'Pick at least one reviewer.',
    ].filter(Boolean) : [];
    const ready = canPick ? blockers.length === 0
        : tier && missing.length === 0 && picked(form.reviewers).length > 0;

    const change = (next) => {
        setForm(next);
        setSaved(null);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (canPick && !window.confirm(`Send ${app.application_no} for review? It moves to Review, and the reviewers and `
            + `approvers for ${tierLabel(tier)} will see it in their work tray. Only the Dept Head or the Dispatch Admin can change it afterwards.`)) return;
        setSaving(true);
        try {
            setError(null);
            await (canPick ? sendForReview(app.id, picked(form.reviewers))
                : updateReviewRouting(app.id, form.tier, picked(form.reviewers)));
            const routingData = await loadRouting(app);
            setData(routingData);
            setForm(formOf(app, routingData));
            setSaved(canPick ? 'Sent for review.' : 'Saved.');
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const history = [...rows].sort((a, b) => new Date(b.assigned_at) - new Date(a.assigned_at));
    const borrowers = getParties(app, BORROWER_ROLES).map(fullName).filter(Boolean).join(', ');

    const metrics = [
        { key: 'result', label: 'Credit result', value: resultLabel ?? 'Not set', sub: 'CO recommendation', tone: resultLabel ? 'info' : 'warn' },
        {
            key: 'risk', label: 'Credit risk rating', value: score.riskRating ?? 'Not scored',
            sub: score.riskRating ? `${score.total} / 100` : `${score.scored} of ${score.count} scored`,
            tone: score.riskRating ? 'info' : 'warn',
        },
        { key: 'loan', label: 'Loan amount', value: money(app.loan_amount), sub: 'Requested', tone: 'plain' },
        {
            key: 'tier', label: 'Approval authority', value: tierLabel(tier) ?? '—',
            sub: tier ? (deviations > 0 ? `With deviation (${deviations})` : 'No deviation') : 'Needs a loan amount',
            tone: tier ? 'info' : 'warn',
        },
    ];

    const readOnlyNote = sent
        ? 'Only the Dept Head or the Dispatch Admin can change the reviewers and approvers, while the application is in Review or Approval.'
        : 'Only the assigned Credit Officer picks the reviewers and approvers and sends it for review.';

    const goTo = (id) => (e) => {
        e.preventDefault();
        pickSection(id);
        scrollToSection(id);
    };

    return (
        <form onSubmit={handleSubmit} className="lf fp rv">
            <header className="lf-card">
                <Link to={`/financialPackagePage?id=${app.id}`} className="lf-back">
                    <ArrowLeft size={16} aria-hidden="true" />Financial Package
                </Link>
                <div className="lf-titlerow">
                    <div>
                        <h1>VII. Approval {app.application_no}</h1>
                        <ul className="lf-meta">
                            <li>Borrower/s: {borrowers || '—'}</li>
                            <li>Stage: {stage ? `${stageLabel(stage.stage)} · ${STAGE_STATUS_LABELS[stage.status] ?? '—'}` : '—'}</li>
                        </ul>
                    </div>
                    <div className="lf-actions">
                        <MessagesPanel applicationId={app.id} inline />
                        <Link to="/adminHomePage" className="lf-btn">Work tray</Link>
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

                {!editable && (
                    <p className="lf-note">
                        <Lock size={16} aria-hidden="true" />
                        <span>
                            Read-only. {readOnlyNote}
                            {!sent && role === 'CREDIT_OFFICER' && !isAssignedCo && ' Assign yourself in the work tray first.'}
                        </span>
                    </p>
                )}
            </header>

            <div className="lf-body edit">
                <nav className="lf-card lf-nav fp-nav" aria-label="VII. Approval sections">
                    <ul>
                        {TOC.map(([id, label]) => (
                            <li key={id}>
                                <a href={`#${id}`} onClick={goTo(id)} aria-current={activeId === id ? 'true' : undefined}>{label}</a>
                            </li>
                        ))}
                    </ul>
                </nav>

                <div className="lf-main fp-main">
                    <Section id="ar-prepared" title="Prepared by">
                        <dl className="fp-info">
                            <Info label="Account Officer">{officers.ao ?? <span className="fp-pending">Unassigned</span>}</Info>
                            <Info label="Credit Officer">{officers.co ?? <span className="fp-pending">Unassigned</span>}</Info>
                            <Info label="Credit result">
                                {resultLabel ?? <span className="lf-err">Not set in the Financial Package</span>}
                            </Info>
                            <Info label="Credit risk rating">
                                {score.riskRating ? `${score.riskRating} (${score.total} / 100)` : `Not finished (${score.scored} of ${score.count} scored)`}
                            </Info>
                        </dl>
                        {canPick && !resultOk && (
                            <p className="lf-note warn">
                                {pkg.credit_result === 'DEFERRED'
                                    ? 'A deferred application isn\'t sent for review. Change the Credit Result in the Financial Package if it\'s ready.'
                                    : 'Save a Credit Result (Endorsed / Not endorsed) with its justification in the Financial Package first.'}
                            </p>
                        )}
                        {canPick && resultOk && !score.complete && (
                            <p className="lf-note warn">The credit score isn't finished. Reviewers will see it as incomplete.</p>
                        )}
                    </Section>

                    <Section id="ar-authority" title="Approval authority">
                        <dl className="fp-info">
                            <Info label="Loan amount">{money(app.loan_amount)}</Info>
                            <Info label="Deviation">
                                {deviations > 0 ? `With deviation (${deviations} in V. Exception/s)` : 'None (V. Exception/s is empty)'}
                            </Info>
                            <Info label="From the matrix">{tierLabel(suggestion) ?? 'No loan amount'}</Info>
                            {!canUpdate && (
                                <Info label="Approval authority">
                                    {tierLabel(tier) ?? '—'}
                                    {canPick && <span className="fp-pending"> (set automatically when you send)</span>}
                                </Info>
                            )}
                        </dl>
                        {canUpdate && (
                            <label className="ct-field rv-override">
                                Approval authority (override)
                                <select value={form.tier} onChange={(e) => change({ ...form, tier: e.target.value })} disabled={saving}>
                                    <option value="">Pick...</option>
                                    {APPROVAL_TIERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                                </select>
                                {form.tier && suggestion && form.tier !== suggestion && (
                                    <span className="rv-differs">Differs from the suggestion.</span>
                                )}
                            </label>
                        )}
                        <div className="fp-tablewrap rv-matrix">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Loan amount</th>
                                        <th>Without deviation</th>
                                        <th>With deviation</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {AMOUNT_BANDS.map((b, i) => (
                                        <tr key={b.label}>
                                            <td className={i === band ? 'rv-here' : undefined}><b>{b.label}</b></td>
                                            {[false, true].map((dev) => {
                                                const t = APPROVAL_TIERS.find((x) => x.value === tierFor(i, dev));
                                                const here = i === band && dev === deviations > 0;
                                                return <td key={String(dev)} className={here ? 'rv-here strong' : undefined}>{t.rule}</td>;
                                            })}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <p className="fp-note">From the bank's authority-limit matrix. The highlighted cell applies to this application.</p>
                    </Section>

                    <Section id="ar-people" title="Reviewers and approvers">
                        {editable ? (
                            <>
                                <PeoplePicker title="Reviewed by (in review order)" role="REVIEWER" ordered staff={staff}
                                    value={form.reviewers} onChange={(v) => change({ ...form, reviewers: v })} disabled={saving} />
                                <AutoApprovers staff={staff} tier={tier} />
                            </>
                        ) : (
                            <RoutingSummary tier={pkg.approval_tier} rows={rows} names={names} myId={myId} />
                        )}
                    </Section>

                    {sent && (
                        <ResendPanel applicationId={app.id} canResend={isAssignedCo && stage?.stage === 'CREDIT_EVALUATION'}
                            onSent={async () => setData(await loadRouting(app))} />
                    )}

                    <Section id="ar-history" title="Routing history">
                        {history.length === 0 ? <p className="fp-empty">Not sent yet.</p> : (
                            <ul className="rv-timeline">
                                {history.map((r) => (
                                    <li key={r.id} className={`rv-step ${r.unassigned_at ? 'none' : 'ok'}`}>
                                        <div className="rv-step-top">
                                            <b>{r.assignee_role === 'REVIEWER' ? `Reviewer ${r.seq}` : 'Approver'}: {names[r.user_id] ?? 'Unknown'}</b>
                                            <span className="lf-chip">{r.unassigned_at ? 'Removed' : 'Active'}</span>
                                        </div>
                                        <p className="lf-kyc-meta">
                                            Added by {names[r.assigned_by] ?? 'unknown'} on {new Date(r.assigned_at).toLocaleString()}
                                            {r.unassigned_at && ` · removed by ${names[r.unassigned_by] ?? 'unknown'} on ${new Date(r.unassigned_at).toLocaleString()}`}
                                        </p>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </Section>

                    {editable && (
                        <div className="fp-savebar">
                            <div className="state">
                                {saved && <span className="fp-chip ok" role="status">{saved}</span>}
                                <FormError error={error} />
                                {blockers.length > 0 && (
                                    <ul className="rv-blockers">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
                                )}
                            </div>
                            <button type="submit" disabled={saving || !ready}>
                                {saving ? 'Saving...' : canPick ? 'Send for review' : 'Save changes'}
                            </button>
                        </div>
                    )}
                    {!editable && saved && <p className="lf-ok-note" role="status">{saved}</p>}
                    {!editable && <FormError error={error} />}
                </div>
            </div>
        </form>
    );
};

export default ApprovalRoutingPage;
