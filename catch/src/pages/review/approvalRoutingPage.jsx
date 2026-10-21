// VII. Approval (KYC-FP "FP" tab), opened from the Financial Package. The assigned CO picks the approval
// authority (suggested from the loan amount + V. Exception/s), the reviewer/s in review order and the
// approver/s, then sends the application for review (send_for_review(): moves it to Review).
// After sending, the Dept Head or the Dispatch Admin can still change it (update_review_routing()).
// Everyone else with access reads.
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
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
import { APPROVAL_TIERS, splitRouting, suggestApprovalTier, tierLabel } from './approval';
import RoutingSummary from './routingSummary';

const SEND_STAGES = ['CREDIT_INVESTIGATION', 'CREDIT_EVALUATION'];
const UPDATE_STAGES = ['REVIEW', 'APPROVAL'];
const ROLE_NOUN = { REVIEWER: 'reviewer', APPROVER: 'approver' };
const fullName = (p) => [p.first_name, p.middle_name, p.last_name, p.name_extension].filter(Boolean).join(' ');

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

// Current routing, or the suggested tier + one empty reviewer / approver slot
const formOf = (record, { fp, rows }) => {
    const { reviewers, approvers } = splitRouting(rows);
    return {
        tier: fp.pkg?.approval_tier ?? suggestApprovalTier(record.loan_amount, fp.exceptions.length > 0) ?? '',
        reviewers: reviewers.length ? reviewers.map((r) => r.user_id) : [''],
        approvers: approvers.length ? approvers.map((r) => r.user_id) : [''],
    };
};

// Ordered list of people of one role; '' = slot not picked yet
const PeoplePicker = ({ title, role, ordered, staff, value, onChange, disabled }) => {
    const options = staff.filter((s) => s.role === role);
    const set = (i, userId) => onChange(value.map((v, j) => (j === i ? userId : v)));
    const moveUp = (i) => onChange(value.map((v, j) => (j === i - 1 ? value[i] : j === i ? value[i - 1] : v)));

    return (
        <div className="py-2">
            <p className="font-semibold">{title}</p>
            {options.length === 0 && (
                <p className="text-red-600">No active {ROLE_NOUN[role]} accounts with a staff profile yet.</p>
            )}
            {value.map((userId, i) => (
                <div key={i} className="flex gap-2 items-center py-1">
                    {ordered && <span>{i + 1}.</span>}
                    <select value={userId} onChange={(e) => set(i, e.target.value)} disabled={disabled} className="border">
                        <option value="">Pick a {ROLE_NOUN[role]}...</option>
                        {options.filter((s) => s.user_id === userId || !value.includes(s.user_id)).map((s) => (
                            <option key={s.user_id} value={s.user_id}>{s.name}</option>
                        ))}
                    </select>
                    {!disabled && ordered && i > 0 && (
                        <button type="button" className="border px-2" onClick={() => moveUp(i)}>Move up</button>
                    )}
                    {!disabled && value.length > 1 && (
                        <button type="button" className="border px-2" onClick={() => onChange(value.filter((_, j) => j !== i))}>
                            Remove
                        </button>
                    )}
                </div>
            ))}
            {!disabled && value.length < options.length && (
                <button type="button" className="border px-2" onClick={() => onChange([...value, ''])}>
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
    const [form, setForm] = useState(null); // { tier, reviewers: [user_id | ''], approvers: [...] }
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

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

    if (loading) return <p>Loading VII. Approval...</p>;
    if (error && !form) return <p className="text-red-600">{error}</p>;
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
    const score = totalCreditScore(rules, Object.fromEntries(fp.creditScore.map((r) => [r.criterion, r])));
    const resultOk = pkg.credit_result && pkg.credit_result !== 'DEFERRED';
    const resultLabel = CREDIT_RESULTS.find((r) => r.value === pkg.credit_result)?.label;
    const picked = (list) => list.filter(Boolean);
    // Why "Send for review" is disabled (assigned CO, before sending)
    const blockers = canPick ? [
        !stageOk && `Sending works from Credit Investigation or Credit Evaluation; this application is in ${stage ? stageLabel(stage.stage) : 'no stage'}${stage?.stage === 'INTAKE' ? ' (the AO requests CI first)' : ''}.`,
        !resultOk && 'Save a Credit Result (Endorsed / Not endorsed) in the Financial Package.',
        !form.tier && 'Pick the approval authority.',
        picked(form.reviewers).length === 0 && 'Pick at least one reviewer.',
        picked(form.approvers).length === 0 && 'Pick at least one approver.',
    ].filter(Boolean) : [];
    const ready = canPick ? blockers.length === 0
        : form.tier && picked(form.reviewers).length > 0 && picked(form.approvers).length > 0;

    const change = (next) => {
        setForm(next);
        setSaved(null);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (canPick && !window.confirm(`Send ${app.application_no} for review? It moves to Review, and the reviewers and `
            + 'approvers you picked will see it in their work tray. Only the Dept Head or the Dispatch Admin can change them afterwards.')) return;
        setSaving(true);
        try {
            setError(null);
            const args = [app.id, form.tier, picked(form.reviewers), picked(form.approvers)];
            await (canPick ? sendForReview(...args) : updateReviewRouting(...args));
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

    return (
        <form onSubmit={handleSubmit} className="max-w-5xl m-auto p-4 text-left">
            <p>
                <Link to={`/financialPackagePage?id=${app.id}`} className="underline">Back to Financial Package</Link>
                {' · '}
                <Link to={`/loanFolderPage?id=${app.id}`} className="underline">Open loan folder (KYC & documents)</Link>
                {' · '}
                <Link to="/adminHomePage" className="underline">Work tray</Link>
            </p>
            <h2>VII. Approval: {app.application_no}</h2>
            <p><span className="font-semibold">Name of Borrower/s:</span> {borrowers || '—'}</p>
            <p><span className="font-semibold">Stage:</span>{' '}
                {stage ? `${stageLabel(stage.stage)} · ${STAGE_STATUS_LABELS[stage.status] ?? '—'}` : '—'}</p>
            {!editable && (
                <p className="italic">
                    Read-only. {sent
                        ? 'Only the Dept Head or the Dispatch Admin can change the reviewers and approvers, while the application is in Review or Approval.'
                        : 'Only the assigned Credit Officer picks the reviewers and approvers and sends it for review.'}
                    {!sent && role === 'CREDIT_OFFICER' && !isAssignedCo && ' Assign yourself in the work tray first.'}
                </p>
            )}

            <Section title="Prepared by">
                <p><span className="font-semibold">Account Officer:</span> {officers.ao ?? 'Unassigned'}</p>
                <p><span className="font-semibold">Credit Officer:</span> {officers.co ?? 'Unassigned'}</p>
                <p><span className="font-semibold">Credit Result:</span>{' '}
                    {resultLabel ?? <span className="text-red-600">Not set in the Financial Package</span>}</p>
                <p><span className="font-semibold">Credit Risk Rating:</span>{' '}
                    {score.riskRating ? `${score.riskRating} (${score.total} / 100)` : `Not finished (${score.scored} of ${score.count} scored)`}</p>
                {canPick && !resultOk && (
                    <p className="text-red-600">
                        {pkg.credit_result === 'DEFERRED'
                            ? 'A deferred application isn\'t sent for review. Change the Credit Result in the Financial Package if it\'s ready.'
                            : 'Save a Credit Result (Endorsed / Not endorsed) with its justification in the Financial Package first.'}
                    </p>
                )}
                {canPick && resultOk && !score.complete && (
                    <p className="text-amber-700">The credit score isn't finished. Reviewers will see it as incomplete.</p>
                )}
            </Section>

            <Section title="Approval authority">
                <p>
                    Loan amount: {app.loan_amount ? `₱${formatMoney(app.loan_amount)}` : '—'} ·{' '}
                    {deviations > 0 ? `with deviation (${deviations} in V. Exception/s)` : 'no deviation (V. Exception/s is empty)'}
                </p>
                <p>Suggested: <span className="font-semibold">{tierLabel(suggestion) ?? 'no loan amount'}</span></p>
                {editable ? (
                    <label className="block py-1">
                        Approval authority{' '}
                        <select value={form.tier} onChange={(e) => change({ ...form, tier: e.target.value })}
                            disabled={saving} className="border">
                            <option value="">Pick...</option>
                            {APPROVAL_TIERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                        {form.tier && suggestion && form.tier !== suggestion && (
                            <span className="text-amber-700"> Differs from the suggestion.</span>
                        )}
                    </label>
                ) : (
                    <p><span className="font-semibold">Approval authority:</span> {tierLabel(pkg.approval_tier) ?? '—'}</p>
                )}
                <table className="border-collapse text-sm mt-2">
                    <tbody>
                        {APPROVAL_TIERS.map((t) => (
                            <tr key={t.value}>
                                <td className="border px-2 font-semibold">{t.label}</td>
                                <td className="border px-2">{t.rule}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <p className="italic text-sm pt-1">From the sheet's VII. Approval labels. The President's range isn't on the sheet (to confirm with the bank).</p>
            </Section>

            <Section title="Reviewers and approvers">
                {editable ? (
                    <>
                        <PeoplePicker title="Reviewed by (in review order)" role="REVIEWER" ordered staff={staff}
                            value={form.reviewers} onChange={(v) => change({ ...form, reviewers: v })} disabled={saving} />
                        <PeoplePicker title="Approved by" role="APPROVER" staff={staff}
                            value={form.approvers} onChange={(v) => change({ ...form, approvers: v })} disabled={saving} />
                    </>
                ) : (
                    <RoutingSummary tier={pkg.approval_tier} rows={rows} names={names} myId={myId} />
                )}
            </Section>

            {editable && (
                <div className="sticky bottom-0 bg-white border-t py-3 flex gap-4 items-center">
                    <button type="submit" className="border px-4 py-2" disabled={saving || !ready}>
                        {saving ? 'Saving...' : canPick ? 'Send for review' : 'Save changes'}
                    </button>
                    {saved && <span className="text-green-700">{saved}</span>}
                    <FormError error={error} />
                    {blockers.length > 0 && (
                        <ul className="text-sm text-amber-700 list-disc pl-4">
                            {blockers.map((b) => <li key={b}>{b}</li>)}
                        </ul>
                    )}
                </div>
            )}
            {!editable && saved && <p className="text-green-700">{saved}</p>}
            {!editable && <FormError error={error} />}

            <div className="border p-3 my-3">
                <h3 className="font-semibold pb-1">Routing history</h3>
                {history.length === 0 ? <p>Not sent yet.</p> : (
                    <ul>
                        {history.map((r) => (
                            <li key={r.id} className="border-b py-1">
                                {r.assignee_role === 'REVIEWER' ? `Reviewer ${r.seq}` : 'Approver'}: {names[r.user_id] ?? 'Unknown'}
                                {' '}· added by {names[r.assigned_by] ?? 'unknown'} on {new Date(r.assigned_at).toLocaleString()}
                                {r.unassigned_at && ` · removed by ${names[r.unassigned_by] ?? 'unknown'} on ${new Date(r.unassigned_at).toLocaleString()}`}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </form>
    );
};

export default ApprovalRoutingPage;
