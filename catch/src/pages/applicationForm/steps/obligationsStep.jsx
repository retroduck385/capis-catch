// Financial Obligations: the principal's existing bank accounts, loans and credit cards, and (when the principal is
// married) the same three lists for the spouse. The rows are stored per borrower (bank_accounts / existing_loans /
// credit_cards by applicant_id), so the spouse's need no new table.
// The spouse's part is required: at least one row, or "My spouse has none of these" ticked. The tick isn't stored;
// a married applicant who saved this step with no spouse rows answered "none" (applicationFormPage.jsx makes them
// save this step again if the spouse step is saved later with no spouse rows). Co-borrowers have no obligations here.
import { useState } from 'react';
import { getParty, replaceApplicantRows, toForm } from '../api';
import { FormError, RowList, Section, StepButtons } from '../fields';
import { BANK_ACCOUNT_FIELDS, CREDIT_CARD_FIELDS, EXISTING_LOAN_FIELDS } from '../options';
import { hasErrors, validateBankAccount, validateCreditCard, validateExistingLoan } from '../validators';

const LISTS = [
    { key: 'bank_accounts', title: 'Existing Bank Accounts', config: BANK_ACCOUNT_FIELDS, validate: validateBankAccount },
    { key: 'existing_loans', title: 'Existing Loans', config: EXISTING_LOAN_FIELDS, validate: validateExistingLoan },
    { key: 'credit_cards', title: 'Credit Card Ownership', config: CREDIT_CARD_FIELDS, validate: validateCreditCard },
];

const emptyRow = (config) => Object.fromEntries(
    Object.keys(config).map((f) => [f, config[f].type === 'checkbox' ? false : '']));

const rowsOf = (party) => Object.fromEntries(LISTS.map(({ key, config }) =>
    [key, (party?.[key] ?? []).map((r) => toForm(r, Object.keys(config)))]));
const count = (rows) => LISTS.reduce((n, { key }) => n + rows[key].length, 0);
const validateAll = (rows) => Object.fromEntries(LISTS.map(({ key, validate }) => [key, rows[key].map(validate)]));
const anyError = (found) => Object.values(found).flat().some(hasErrors);
const forSave = (key, list) => (key === 'existing_loans'
    ? list.map((r) => ({ ...r, term_over_6_months: !!r.term_over_6_months }))
    : list);

// saved: this step was saved before (so a married applicant with no spouse rows had ticked "none")
const ObligationsStep = ({ app, onSaved, onBack, saved = false }) => {
    const principal = getParty(app, 'PRINCIPAL');
    const spouse = principal?.civil_status === 'MARRIED' ? getParty(app, 'SPOUSE') : null;
    const [rows, setRows] = useState(() => rowsOf(principal));
    const [spouseRows, setSpouseRows] = useState(() => rowsOf(spouse));
    const [spouseNone, setSpouseNone] = useState(() => saved && !!spouse && count(rowsOf(spouse)) === 0);
    const [errors, setErrors] = useState({});
    const [spouseErrors, setSpouseErrors] = useState({});
    const [spouseMissing, setSpouseMissing] = useState(false);
    const [error, setError] = useState(null);
    const [saving, setSaving] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        const found = validateAll(rows);
        const foundSpouse = spouse ? validateAll(spouseRows) : {};
        const missing = !!spouse && !spouseNone && count(spouseRows) === 0;
        setErrors(found);
        setSpouseErrors(foundSpouse);
        setSpouseMissing(missing);
        if (anyError(found) || anyError(foundSpouse) || missing) return;

        setSaving(true);
        setError(null);
        try {
            for (const { key } of LISTS) await replaceApplicantRows(key, principal.id, forSave(key, rows[key]));
            if (spouse) {
                for (const { key } of LISTS) await replaceApplicantRows(key, spouse.id, spouseNone ? [] : forSave(key, spouseRows[key]));
            }
            await onSaved();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} noValidate>
            <p className="ct-intro">List any existing accounts, loans and credit cards. Leave a section empty if you have none.</p>
            {LISTS.map(({ key, title, config }) => (
                <RowList key={key} title={title} config={config} rows={rows[key]} errors={errors[key]}
                    emptyRow={emptyRow(config)} onChange={(list) => setRows((r) => ({ ...r, [key]: list }))} />
            ))}

            {spouse && (
                <>
                    <Section title="Your Spouse's Obligations (required)">
                        <p>Add your spouse&apos;s accounts, loans and credit cards below, or tick that they have none.</p>
                        <label className="ct-check">
                            <input type="checkbox" checked={spouseNone}
                                onChange={(e) => { setSpouseNone(e.target.checked); setSpouseMissing(false); }} />
                            My spouse has no bank accounts, loans or credit cards
                        </label>
                        {spouseMissing && (
                            <p className="ct-fielderr" role="alert">
                                Add at least one of your spouse&apos;s accounts, loans or credit cards, or tick that they have none.
                            </p>
                        )}
                    </Section>
                    {!spouseNone && LISTS.map(({ key, title, config }) => (
                        <RowList key={`spouse-${key}`} title={`Spouse: ${title}`} config={config} rows={spouseRows[key]}
                            errors={spouseErrors[key]} emptyRow={emptyRow(config)}
                            onChange={(list) => { setSpouseRows((r) => ({ ...r, [key]: list })); setSpouseMissing(false); }} />
                    ))}
                </>
            )}
            <FormError error={error} />
            <StepButtons onBack={onBack} saving={saving} />
        </form>
    );
};

export default ObligationsStep;
