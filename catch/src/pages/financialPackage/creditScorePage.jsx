// Housing Loan Credit Scoring Sheet (KYC-FP "Credit_Score" tab), opened from the Financial Package.
// Suggestions are worked out from the record and the SAVED Financial Package (income basis, rate, appraised
// value, loan / deposit checks); the CO accepts, changes or leaves each one and saves with save_credit_score().
// Same edit rule as the FP: only the assigned CO, any stage before Decided; everyone else with access reads.
import { CreditScoreSkeleton } from '../../components/skeleton';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, Lock } from 'lucide-react';
import Breadcrumbs from '../../components/breadcrumbs';
import { UserAuth } from '../../context/authContext';
import { fetchApplication, getParties, toRow } from '../applicationForm/api';
import { FormError, Section } from '../applicationForm/fields';
import { BORROWER_ROLES, formatMoney } from '../applicationForm/options';
import { fetchAuditLog, fetchStaffNames } from '../loanFolder/api';
import ChangeHistory from '../loanFolder/changeHistory';
import { fetchCoCanEdit, fetchCreditScoreRules, fetchFinancialPackage, saveCreditScore } from './api';
import { computeFp } from './compute';
import { suggestCreditScore, totalCreditScore } from './creditScore';
import { CreditScoreSection } from './creditScoreSection';
import { scrollToSection, useActiveSection } from '../review/useActiveSection';
import '../loanFolder/loanFolder.css';
import './financialPackage.css';
import '../review/review.css';
import './creditScore.css';

const SCORE_KEYS = ['band', 'suggested_band', 'remarks'];
const formOf = (row) => Object.fromEntries(SCORE_KEYS.map((k) => [k, row?.[k] ?? '']));
const money = (v) => (v ? `₱${formatMoney(v)}` : '—');

// Section navigator: [element id, label]; the category ids match creditScoreSection.jsx
const TOC = [
    ['cs-CAPACITY', '1. Capacity'], ['cs-CHARACTER', '2. Character'], ['cs-COLLATERAL', '3. Collateral'],
    ['cs-CONDITION', '4. Condition'], ['cs-total', 'Total score'], ['cs-history', 'Change history'],
];
const TOC_IDS = TOC.map(([id]) => id);
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
    const [activeId, pickSection] = useActiveSection(TOC_IDS, Boolean(app && scores && rules));

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

    if (loading) return <CreditScoreSkeleton />;
    if (error && !scores) return <p className="ct-error">{error}</p>;
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

    const unconfirmed = rules.criteria.filter((c) => !scores[c.code]?.band && suggestions[c.code].band).length;
    const metrics = [
        {
            key: 'total', label: 'Total score', value: `${totals.total} / 100`,
            sub: totals.complete ? (totals.description ?? 'Scored') : `${totals.scored} of ${totals.count} criteria scored`,
            tone: totals.complete ? 'info' : 'warn',
        },
        {
            key: 'risk', label: 'Credit risk rating', value: totals.riskRating ?? 'Not scored',
            sub: totals.riskRating ? 'From the score' : 'When every criterion is scored', tone: totals.riskRating ? 'info' : 'warn',
        },
        { key: 'rec', label: 'Recommendation', value: totals.recommendation ?? '—', sub: 'A guide, not the decision', tone: 'plain' },
        { key: 'loan', label: 'Loan amount', value: money(app.loan_amount), sub: 'Requested', tone: 'plain' },
        {
            key: 'sugg', label: 'Suggestions to confirm', value: String(unconfirmed),
            sub: unconfirmed === 0 ? 'Nothing waiting' : 'Not counted until picked', tone: unconfirmed === 0 ? 'plain' : 'warn',
        },
    ];

    const goTo = (id) => (e) => {
        e.preventDefault();
        pickSection(id);
        scrollToSection(id);
    };

    return (
        <form onSubmit={handleSave} className="lf fp rv">
            <Breadcrumbs current="score" appId={app.id} appNo={app.application_no} onNavigate={leave} />
            <header className="lf-card">
                <div className="lf-titlerow">
                    <div>
                        <h1>Credit Scoring {app.application_no}</h1>
                        <ul className="lf-meta">
                            <li>Borrower/s: {borrowers || '—'}</li>
                            <li>Housing Loan Credit Scoring Sheet</li>
                        </ul>
                    </div>
                    <div className="lf-actions">
                        <Link to="/adminHomePage" onClick={leave} className="lf-btn">Work tray</Link>
                        <Link to={`/loanFolderPage?id=${app.id}`} onClick={leave} className="lf-btn">
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

                {!canEdit && (
                    <p className="lf-note">
                        <Lock size={16} aria-hidden="true" />
                        <span>
                            Read-only. Only the assigned Credit Officer can edit the credit score.
                            {role === 'CREDIT_OFFICER' && ' Assign yourself in the work tray to edit.'}
                        </span>
                    </p>
                )}
                <p className="fp-note cs-hint">
                    Suggestions use the saved Financial Package (income basis, interest rate, appraised value, loan and
                    deposit checks). Save the FP first if you changed any of those.
                </p>
            </header>

            <div className="lf-body edit">
                <nav className="lf-card lf-nav fp-nav" aria-label="Credit score sections">
                    <ul>
                        {TOC.map(([id, label]) => (
                            <li key={id}>
                                <a href={`#${id}`} onClick={goTo(id)} aria-current={activeId === id ? 'true' : undefined}>{label}</a>
                            </li>
                        ))}
                    </ul>
                </nav>

                <div className="lf-main fp-main">
                    <CreditScoreSection rules={rules} suggestions={suggestions} scores={scores} totals={totals}
                        onScore={onScore} onRemarks={onRemarks} onUseAll={acceptAll} disabled={!canEdit || saving} />

                    <Section id="cs-history" title="Credit score change history">
                        {audit.length === 0 ? <p className="fp-empty">No changes yet.</p>
                            : <ChangeHistory app={app} entries={audit} names={names} />}
                    </Section>

                    {canEdit && (
                        <div className="fp-savebar">
                            <div className="state">
                                {dirty && <span className="fp-chip warn">Unsaved changes</span>}
                                {saved && !dirty && <span className="fp-chip ok" role="status">Saved</span>}
                                <FormError error={error} />
                            </div>
                            <button type="submit" disabled={saving || !dirty}>
                                {saving ? 'Saving...' : 'Save Credit Score'}
                            </button>
                        </div>
                    )}
                    {!canEdit && <FormError error={error} />}
                </div>
            </div>
        </form>
    );
};

export default CreditScorePage;
