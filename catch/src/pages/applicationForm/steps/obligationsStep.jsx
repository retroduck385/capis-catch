import { useState } from 'react';
import { getParty, replaceApplicantRows, toForm } from '../api';
import { FormError, RowList, StepButtons } from '../fields';
import { BANK_ACCOUNT_FIELDS, CREDIT_CARD_FIELDS, EXISTING_LOAN_FIELDS } from '../options';
import { hasErrors, validateBankAccount, validateCreditCard, validateExistingLoan } from '../validators';

const LISTS = [
    { key: 'bank_accounts', title: 'Existing Bank Accounts', config: BANK_ACCOUNT_FIELDS, validate: validateBankAccount },
    { key: 'existing_loans', title: 'Existing Loans', config: EXISTING_LOAN_FIELDS, validate: validateExistingLoan },
    { key: 'credit_cards', title: 'Credit Card Ownership', config: CREDIT_CARD_FIELDS, validate: validateCreditCard },
];

const emptyRow = (config) => Object.fromEntries(
    Object.keys(config).map((f) => [f, config[f].type === 'checkbox' ? false : '']));

const ObligationsStep = ({ app, onSaved, onBack }) => {
    const principal = getParty(app, 'PRINCIPAL');
    const [rows, setRows] = useState(() => Object.fromEntries(LISTS.map(({ key, config }) =>
        [key, (principal?.[key] ?? []).map((r) => toForm(r, Object.keys(config)))])));
    const [errors, setErrors] = useState({});
    const [error, setError] = useState(null);
    const [saving, setSaving] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        const found = Object.fromEntries(LISTS.map(({ key, validate }) => [key, rows[key].map(validate)]));
        setErrors(found);
        if (Object.values(found).flat().some(hasErrors)) return;

        setSaving(true);
        setError(null);
        try {
            for (const { key } of LISTS) {
                const list = key === 'existing_loans'
                    ? rows[key].map((r) => ({ ...r, term_over_6_months: !!r.term_over_6_months }))
                    : rows[key];
                await replaceApplicantRows(key, principal.id, list);
            }
            await onSaved();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <form onSubmit={handleSubmit}>
            <p className="text-left py-2">List any existing accounts, loans and credit cards. Leave a section empty if you have none.</p>
            {LISTS.map(({ key, title, config }) => (
                <RowList key={key} title={title} config={config} rows={rows[key]} errors={errors[key]}
                    emptyRow={emptyRow(config)} onChange={(list) => setRows((r) => ({ ...r, [key]: list }))} />
            ))}
            <FormError error={error} />
            <StepButtons onBack={onBack} saving={saving} />
        </form>
    );
};

export default ObligationsStep;
