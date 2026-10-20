// Housing Loan Credit Scoring Sheet (KYC-FP "Credit_Score" tab), opened from the Financial Package.
// Suggestions are worked out from the record and the SAVED Financial Package (income basis, rate, appraised
// value, loan / deposit checks); the CO accepts, changes or leaves each one and saves with save_credit_score().
// Same edit rule as the FP: only the assigned CO, any stage before Decided; everyone else with access reads.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { UserAuth } from '../../context/authContext';
import { fetchApplication, getParties, toRow } from '../applicationForm/api';
import { FormError } from '../applicationForm/fields';
import { BORROWER_ROLES, formatMoney } from '../applicationForm/options';
import { fetchAuditLog, fetchStaffNames } from '../loanFolder/api';
import ChangeHistory from '../loanFolder/changeHistory';
import { fetchCoCanEdit, fetchCreditScoreRules, fetchFinancialPackage, saveCreditScore } from './api';
import { computeFp } from './compute';
import { suggestCreditScore, totalCreditScore } from './creditScore';
import { CreditScoreSection } from './creditScoreSection';

const SCORE_KEYS = ['band', 'suggested_band', 'remarks'];
const formOf = (row) => Object.fromEntries(SCORE_KEYS.map((k) => [k, row?.[k] ?? '']));
const fullName = (p) => [p.first_name, p.middle_name, p.last_name, p.name_extension].filter(Boolean).join(' ');

const CreditScorePage = () => {
    const { role } = UserAuth();
    const [searchParams] = useSearchParams();
    const applicationId = Number(searchParams.get('id'));

    const [app, setApp] = useState(null);
    const [rules, setRules] = useState(null);
    const [fp, setFp] = useState(null);
    const [scores, setScores] = useState(null); // { [criterion]: { band, suggested_band, remarks } }
    const [canEdit, setCanEdit] = useState(false);
    const [audit, setAudit] = useState([]);
    const [names, setNames] = useState({});
    const [dirty, setDirty] = useState(false);
    const [saved, setSaved] = useState(false);
    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Saved FP + score + the score's change history (+ the staff names in it)
    const loadScore = useCallback(async (record) => {
        const ids = getParties(record, BORROWER_ROLES).map((p) => p.id);
        const [savedFp, log] = await Promise.all([fetchFinancialPackage(record.id, ids), fetchAuditLog(record.id)]);
        const scoreLog = log.filter((e) => e.table_name === 'credit_score_entries');
        setFp(savedFp);
        setScores(Object.fromEntries(savedFp.creditScore.map((r) => [r.criterion, formOf(r)])));
        setAudit(scoreLog);
        setNames(await fetchStaffNames(scoreLog.map((e) => e.changed_by)));
        setDirty(false);
    }, []);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const [record, editable, scoreRules] = await Promise.all([
                    fetchApplication(applicationId), fetchCoCanEdit(applicationId), fetchCreditScoreRules()]);
                if (cancelled) return;
                setApp(record);
                setCanEdit(editable);
                setRules(scoreRules);
                await loadScore(record);
            } catch (err) {
                if (!cancelled) setError(err.message);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        load();
        return () => { cancelled = true; };
    }, [applicationId, loadScore]);

    // FP figures (DBR, gross income, LCR, ...) from what's saved in the FP
    const suggestions = useMemo(() => {
        if (!app || !fp || !rules) return null;
        const details = Object.fromEntries(fp.parties.map((r) => [r.applicant_id, r]));
        const computed = computeFp(app, details, fp.pkg ?? {}, { interest_rate: app.interest_rate });
        return suggestCreditScore(app, computed, { loan_checks: fp.loanChecks, deposit_checks: fp.depositChecks }, rules.criteria);
    }, [app, fp, rules]);
    const totals = useMemo(() => (rules && scores ? totalCreditScore(rules, scores) : null), [rules, scores]);

    if (loading) return <p>Loading credit scoring...</p>;
    if (error && !scores) return <p className="text-red-600">{error}</p>;
    if (!app || !scores || !suggestions) return null;

    const change = (next) => {
        setScores(next);
        setDirty(true);
        setSaved(false);
    };
    // Picking a band keeps what the page suggested at that moment, so overrides show in the audit trail
    const entry = (criterion, band) => ({ remarks: '', ...scores[criterion], band, suggested_band: suggestions[criterion].band ?? '' });
    const onScore = (criterion, band) => change({ ...scores, [criterion]: entry(criterion, band) });
    const onRemarks = (criterion, remarks) => change({ ...scores, [criterion]: { ...formOf(null), ...scores[criterion], remarks } });
    const acceptAll = () => change({ ...scores, ...Object.fromEntries(rules.criteria
        .filter((c) => !scores[c.code]?.band && suggestions[c.code].band)
        .map((c) => [c.code, entry(c.code, suggestions[c.code].band)])) });

    const handleSave = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            setError(null);
            await saveCreditScore(app.id, Object.entries(scores)
                .filter(([, s]) => s.band)
                .map(([criterion, s]) => ({ criterion, ...toRow(s) })));
            await loadScore(app);
            setSaved(true);
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const leave = (e) => {
        if (dirty && !window.confirm('The credit score has unsaved changes. Leave without saving?')) e.preventDefault();
    };
    const borrowers = getParties(app, BORROWER_ROLES).map(fullName).filter(Boolean).join(', ');

    return (
        <form onSubmit={handleSave} className="max-w-5xl m-auto p-4 text-left">
            <p>
                <Link to={`/financialPackagePage?id=${app.id}`} onClick={leave} className="underline">Back to Financial Package</Link>
                {' · '}
                <Link to={`/loanFolderPage?id=${app.id}`} onClick={leave} className="underline">Open loan folder (KYC & documents)</Link>
                {' · '}
                <Link to="/adminHomePage" onClick={leave} className="underline">Work tray</Link>
            </p>
            <h2>Credit Scoring: {app.application_no}</h2>
            <p><span className="font-semibold">Name of Borrower/s:</span> {borrowers || '—'}</p>
            <p><span className="font-semibold">Loan Amount:</span> {app.loan_amount ? `₱${formatMoney(app.loan_amount)}` : '—'}</p>
            {!canEdit && (
                <p className="italic">
                    Read-only. Only the assigned Credit Officer can edit the credit score.
                    {role === 'CREDIT_OFFICER' && ' Assign yourself in the work tray to edit.'}
                </p>
            )}
            <p className="text-sm italic pt-1">
                Suggestions use the saved Financial Package (income basis, interest rate, appraised value, loan and
                deposit checks). Save the FP first if you changed any of those.
            </p>

            <CreditScoreSection rules={rules} suggestions={suggestions} scores={scores} totals={totals}
                onScore={onScore} onRemarks={onRemarks} onUseAll={acceptAll} disabled={!canEdit || saving} />

            {canEdit && (
                <div className="sticky bottom-0 bg-white border-t py-3 flex gap-4 items-center">
                    <button type="submit" className="border px-4 py-2" disabled={saving || !dirty}>
                        {saving ? 'Saving...' : 'Save Credit Score'}
                    </button>
                    {dirty && <span>Unsaved changes</span>}
                    {saved && !dirty && <span className="text-green-700">Saved.</span>}
                    <FormError error={error} />
                </div>
            )}
            {!canEdit && <FormError error={error} />}

            <div className="border p-3 my-3">
                <h3 className="font-semibold pb-1">Credit score change history</h3>
                {audit.length === 0 ? <p>No changes yet.</p> : <ChangeHistory app={app} entries={audit} names={names} />}
            </div>
        </form>
    );
};

export default CreditScorePage;
