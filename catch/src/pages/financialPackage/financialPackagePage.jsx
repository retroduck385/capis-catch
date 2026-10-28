// Financial Package & Credit Recommendation (KYC-FP "FP" tab), opened from the Credit Officer's work tray.
// Fields copied from the KYC are read live from the AO's record; the CO's own inputs are saved with
// save_financial_package(). Only the assigned CO edits (any stage before Decided); everyone else with access reads.
// Credit checking (BRAS / NFIS / TU) waits for the Credit Investigator's results, which aren't built yet.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { UserAuth } from '../../context/authContext';
import { fetchApplication, getParties, one, toRow } from '../applicationForm/api';
import { FormError } from '../applicationForm/fields';
import { BORROWER_ROLES, formatMoney, partyLabel } from '../applicationForm/options';
import { fetchAuditLog, fetchStaffNames } from '../loanFolder/api';
import ChangeHistory from '../loanFolder/changeHistory';
import { fetchReviewAssignments } from '../review/api';
import { fetchAssignedAo, fetchCoCanEdit, fetchCreditScoreRules, fetchFinancialPackage, saveFinancialPackage } from './api';
import MessagesPanel from '../messages/messagesPanel';
import { computeFp } from './compute';
import { totalCreditScore } from './creditScore';
import {
    ApprovalSection, CashFlowSection, CollateralSection, CreditCheckingSection, CreditResultSection, CustomerSection, EmploymentSection,
    FacilitySection, HeaderSection, HighlightsSection, RowsSection, TermsSection, TitleSection,
} from './fpSections';
import {
    DEPOSIT_CHECK_FIELDS, EXCEPTION_FIELDS, FP_TABLES, LOAN_CHECK_FIELDS, OTHER_INFO_TEMPLATE, PACKAGE_DEFAULTS,
    TITLE_FIELDS, TITLE_KINDS, TRADE_CHECK_FIELDS, termsTemplate,
} from './options';

const PACKAGE_KEYS = ['date_prepared', 'dosri_rpt', 'variant', 'manner_of_repayment', 'hgc_eligibility',
    'date_of_enrollment', 'appraised_value', 'date_of_appraisal', 'other_information', 'statement_of_account',
    'terms_and_conditions', 'credit_result', 'justification', 'amendment', 'waiver_and_acceptance', 'deferrals'];
const PARTY_KEYS = ['income_basis', 'other_income', 'employment_remarks', 'cash_flow_remarks', 'other_information'];
const LISTS = {
    exceptions: EXCEPTION_FIELDS,
    deposit_checks: DEPOSIT_CHECK_FIELDS,
    loan_checks: LOAN_CHECK_FIELDS,
    trade_checks: TRADE_CHECK_FIELDS,
};

const formOf = (row, keys) => Object.fromEntries(keys.map((k) => [k, row?.[k] == null ? '' : String(row[k])]));
const isBlank = (row, keys) => keys.every((k) => row[k] === '' || row[k] == null);
const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local time

const templateFor = (app, pricing) => termsTemplate({
    developer: one(app.referral_details)?.developer_name, rate: pricing.interest_rate, fixing: pricing.fixing_period,
});

// DB rows -> form state (strings, '' for nulls). A new FP starts from the sheet's defaults.
const buildForm = (app, saved) => {
    const pricing = formOf(app, ['interest_rate', 'fixing_period']);
    const pkg = saved.pkg ? formOf(saved.pkg, PACKAGE_KEYS)
        : { ...formOf({}, PACKAGE_KEYS), ...PACKAGE_DEFAULTS, date_prepared: today(), terms_and_conditions: templateFor(app, pricing) };
    const parties = Object.fromEntries(getParties(app, BORROWER_ROLES).map((p) => {
        const row = saved.parties.find((r) => r.applicant_id === p.id);
        return [p.id, row ? formOf(row, PARTY_KEYS) : { ...formOf({}, PARTY_KEYS), other_information: OTHER_INFO_TEMPLATE }];
    }));
    const listOf = (rows, config) => rows.map((r) => ({ id: r.id, ...formOf(r, Object.keys(config)) }));
    return {
        pkg,
        pricing,
        parties,
        exceptions: listOf(saved.exceptions, EXCEPTION_FIELDS),
        deposit_checks: listOf(saved.depositChecks, DEPOSIT_CHECK_FIELDS),
        loan_checks: listOf(saved.loanChecks, LOAN_CHECK_FIELDS),
        trade_checks: listOf(saved.tradeChecks, TRADE_CHECK_FIELDS),
        titles: Object.fromEntries(TITLE_KINDS.map((k) => {
            const row = saved.titles.find((t) => t.title_kind === k.value);
            return [k.value, { id: row?.id, ...formOf(row, Object.keys(TITLE_FIELDS)) }];
        })),
    };
};

// Form state -> save_financial_package() payload ('' -> null, blank list rows dropped)
const buildPayload = (form) => {
    const pkg = toRow(form.pkg);
    pkg.dosri_rpt = pkg.dosri_rpt === null ? null : pkg.dosri_rpt === 'true';
    const list = (key) => form[key]
        .filter((r) => !isBlank(r, Object.keys(LISTS[key])))
        .map(({ _key, ...r }) => toRow(r)); // eslint-disable-line no-unused-vars
    return {
        package: pkg,
        pricing: toRow(form.pricing),
        parties: Object.entries(form.parties).map(([id, p]) => ({ applicant_id: Number(id), ...toRow(p) })),
        exceptions: list('exceptions'),
        deposit_checks: list('deposit_checks'),
        loan_checks: list('loan_checks'),
        trade_checks: list('trade_checks'),
        titles: Object.entries(form.titles)
            .filter(([, t]) => t.id || !isBlank(t, Object.keys(TITLE_FIELDS)))
            .map(([kind, { id, ...t }]) => ({ title_kind: kind, ...toRow(t) })), // eslint-disable-line no-unused-vars
    };
};

const FinancialPackagePage = () => {
    const { role } = UserAuth();
    const [searchParams] = useSearchParams();
    const applicationId = Number(searchParams.get('id'));

    const [app, setApp] = useState(null);
    const [rules, setRules] = useState(null);
    const [savedScore, setSavedScore] = useState({}); // { [criterion]: { band } }, for the header's risk rating
    const [routing, setRouting] = useState({ tier: null, rows: [], names: {} }); // VII. Approval
    const [form, setForm] = useState(null);
    const [canEdit, setCanEdit] = useState(false);
    const [aoName, setAoName] = useState(null);
    const [audit, setAudit] = useState([]);
    const [names, setNames] = useState({});
    const [dirty, setDirty] = useState(false);
    const [saved, setSaved] = useState(false);
    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Saved FP + its change history (+ the staff names in it)
    const loadFp = useCallback(async (record) => {
        const ids = getParties(record, BORROWER_ROLES).map((p) => p.id);
        const [savedFp, log, aoId, reviewRows] = await Promise.all([
            fetchFinancialPackage(record.id, ids), fetchAuditLog(record.id), fetchAssignedAo(record.id),
            fetchReviewAssignments(record.id)]);
        const fpLog = log.filter((e) => FP_TABLES.includes(e.table_name)
            || (e.table_name === 'loan_applications' && ('interest_rate' in (e.new_data ?? {}) || 'fixing_period' in (e.new_data ?? {}))));
        const staff = await fetchStaffNames([aoId, ...fpLog.map((e) => e.changed_by),
            ...reviewRows.filter((r) => !r.unassigned_at).map((r) => r.user_id)]);
        setForm(buildForm(record, savedFp));
        setSavedScore(Object.fromEntries(savedFp.creditScore.map((r) => [r.criterion, r])));
        setRouting({ tier: savedFp.pkg?.approval_tier ?? null, rows: reviewRows, names: staff });
        setAudit(fpLog);
        setNames(staff);
        setAoName(aoId ? staff[aoId] ?? 'Account Officer' : null);
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
                setRules(scoreRules);
                setCanEdit(editable);
                await loadFp(record);
            } catch (err) {
                if (!cancelled) setError(err.message);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        load();
        return () => { cancelled = true; };
    }, [applicationId, loadFp]);

    const computed = useMemo(() => (app && form ? computeFp(app, form.parties, form.pkg, form.pricing) : null),
        [app, form]);
    // Saved credit score (scored on its own page)
    const score = useMemo(() => (rules ? totalCreditScore(rules, savedScore) : null), [rules, savedScore]);

    if (loading) return <p>Loading financial package...</p>;
    if (error && !form) return <p className="text-red-600">{error}</p>;
    if (!app || !form || !rules) return null;

    const disabled = !canEdit || saving;
    const change = (next) => {
        setForm(next);
        setDirty(true);
        setSaved(false);
    };
    const onPkg = (field, value) => change({ ...form, pkg: { ...form.pkg, [field]: value } });
    const onPricing = (field, value) => change({ ...form, pricing: { ...form.pricing, [field]: value } });
    const onParty = (id, field, value) =>
        change({ ...form, parties: { ...form.parties, [id]: { ...form.parties[id], [field]: value } } });
    const onList = (key) => (rows) => change({ ...form, [key]: rows });
    const onTitle = (kind, field, value) =>
        change({ ...form, titles: { ...form.titles, [kind]: { ...form.titles[kind], [field]: value } } });
    const resetTerms = () => onPkg('terms_and_conditions', templateFor(app, form.pricing));
    // The score and VII. Approval pages read the saved FP (income basis, rate, appraised value, credit result),
    // so unsaved edits would be lost
    const confirmLeave = (e) => {
        if (dirty && !window.confirm('The Financial Package has unsaved changes. Leave without saving?')) e.preventDefault();
    };

    const handleSave = async (e) => {
        e.preventDefault();
        if (form.pkg.credit_result && !form.pkg.justification.trim()) {
            setError('Add a justification for the credit result.');
            return;
        }
        setSaving(true);
        try {
            setError(null);
            await saveFinancialPackage(app.id, buildPayload(form));
            await loadFp(app);
            setSaved(true);
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const kycBankAccounts = getParties(app, BORROWER_ROLES).flatMap((p) => (p.bank_accounts ?? []).map((b) => ({ party: p, ...b })));
    const kycLoans = computed.existingLoans;

    return (
        <form onSubmit={handleSave} className="max-w-5xl m-auto p-4 text-left">
            <MessagesPanel applicationId={app.id} />
            <p>
                <Link to="/adminHomePage" className="underline">Back to work tray</Link>
                {' · '}
                <Link to={`/loanFolderPage?id=${app.id}`} className="underline">Open loan folder (KYC & documents)</Link>
            </p>
            <h2>Financial Package: {app.application_no}</h2>
            {!canEdit && (
                <p className="italic">
                    Read-only. Only the assigned Credit Officer can edit the Financial Package.
                    {role === 'CREDIT_OFFICER' && ' Assign yourself in the work tray to edit.'}
                </p>
            )}

            <HeaderSection app={app} aoName={aoName} form={form.pkg} onPkg={onPkg} disabled={disabled} score={score}
                scoreLink={`/creditScorePage?id=${app.id}`} approvalLink={`/approvalRoutingPage?id=${app.id}`}
                onOpenScore={confirmLeave} />
            <HighlightsSection app={app} computed={computed} />
            <FacilitySection app={app} computed={computed} form={form.pkg} pricing={form.pricing}
                onPkg={onPkg} onPricing={onPricing} disabled={disabled} />
            <CollateralSection app={app} form={form.pkg} onPkg={onPkg} disabled={disabled} />
            <CreditCheckingSection app={app} />
            <RowsSection title="V. Exception/s" config={EXCEPTION_FIELDS} rows={form.exceptions}
                onChange={onList('exceptions')} disabled={disabled} />
            <TermsSection form={form.pkg} onPkg={onPkg} onReset={resetTerms} disabled={disabled} />
            <ApprovalSection tier={routing.tier} rows={routing.rows} names={routing.names}
                link={`/approvalRoutingPage?id=${app.id}`} onOpen={confirmLeave} />

            <h3 className="font-semibold pt-4">Page 2: Credit Application Information</h3>
            <EmploymentSection app={app} details={form.parties} onParty={onParty} disabled={disabled} />
            <CashFlowSection computed={computed} details={form.parties} onParty={onParty} disabled={disabled} />
            <RowsSection title="X. Deposit Checking" config={DEPOSIT_CHECK_FIELDS} rows={form.deposit_checks}
                onChange={onList('deposit_checks')} disabled={disabled}>
                <p className="text-sm">Bank accounts declared in the KYC:{' '}
                    {kycBankAccounts.length === 0 ? 'none.' : kycBankAccounts.map((b) =>
                        `${partyLabel(b.party)}: ${b.bank_name} ${b.account_type} ${b.account_number}`).join('; ')}
                </p>
            </RowsSection>
            <RowsSection title="XI. Loan Verification (Based on Loandex and Disclosure)" config={LOAN_CHECK_FIELDS}
                rows={form.loan_checks} onChange={onList('loan_checks')} disabled={disabled}>
                <p className="text-sm">Existing loans declared in the KYC:{' '}
                    {kycLoans.length === 0 ? 'none.' : kycLoans.map((l) =>
                        `${partyLabel(l.party)}: ${l.loan_type} with ${l.lending_institution}, ₱${formatMoney(l.monthly_payment)} / month`).join('; ')}
                </p>
            </RowsSection>
            <RowsSection title="XII. Trade Checking (if applicable)" config={TRADE_CHECK_FIELDS} rows={form.trade_checks}
                onChange={onList('trade_checks')} disabled={disabled} />
            <TitleSection titles={form.titles} onTitle={onTitle} disabled={disabled} />
            <CustomerSection app={app} details={form.parties} onParty={onParty} disabled={disabled} />
            <CreditResultSection form={form.pkg} onPkg={onPkg} disabled={disabled} />

            {canEdit && (
                <div className="sticky bottom-0 bg-white border-t py-3 flex gap-4 items-center">
                    <button type="submit" className="border px-4 py-2" disabled={saving || !dirty}>
                        {saving ? 'Saving...' : 'Save Financial Package'}
                    </button>
                    {dirty && <span>Unsaved changes</span>}
                    {saved && !dirty && <span className="text-green-700">Saved.</span>}
                    <FormError error={error} />
                </div>
            )}
            {!canEdit && <FormError error={error} />}

            <div className="border p-3 my-3">
                <h3 className="font-semibold pb-1">FP change history</h3>
                {audit.length === 0 ? <p>No changes yet.</p> : <ChangeHistory app={app} entries={audit} names={names} />}
            </div>
        </form>
    );
};

export default FinancialPackagePage;
