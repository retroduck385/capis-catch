// Changes made to the application after submission (audit_log), newest first.
// The first "from" value of a field is what the applicant originally submitted.
import { partyLabel } from '../applicationForm/options';

const TABLE_LABELS = {
    loan_applications: 'Loan details',
    applicants: 'Borrower',
    addresses: 'Address',
    employment_info: 'Employment',
    dependents: 'Dependent',
    bank_accounts: 'Bank account',
    existing_loans: 'Existing loan',
    credit_cards: 'Credit card',
    character_references: 'Character reference',
    collateral_details: 'Collateral',
    referral_details: 'Referral',
    documents: 'Document',
    application_requirements: 'Document requirement',
};

const ACTION_LABELS = { INSERT: 'Added', UPDATE: 'Changed', DELETE: 'Removed' };

// Keys and bookkeeping columns aren't useful to show
const HIDDEN = new Set(['id', 'application_id', 'applicant_id', 'requirement_id', 'file_path', 'uploaded_by']);

const fieldLabel = (key) => key.replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase());
const show = (value) => (value === null || value === undefined || value === '' ? '—' : String(value));

// Whose record a row belongs to (principal, spouse, co-borrower n, ...), when it still exists
const ownerLabel = (entry, app) => {
    const data = entry.new_data ?? entry.old_data ?? {};
    if (entry.table_name === 'applicants' && data.role) return partyLabel(data);
    const party = app.applicants?.find((a) => a.id === data.applicant_id);
    return party ? partyLabel(party) : null;
};

const ChangeHistory = ({ app, entries, names }) => {
    if (entries.length === 0) return <p>No changes since the applicant submitted.</p>;

    return (
        <ul>
            {entries.map((e) => {
                const data = e.action === 'DELETE' ? e.old_data : e.new_data;
                const fields = Object.keys(data ?? {}).filter((k) => !HIDDEN.has(k)
                    && (e.action === 'UPDATE' || (data[k] !== null && data[k] !== '')));
                return (
                    <li key={e.id} className="border-b py-2">
                        <p>
                            <strong>{ACTION_LABELS[e.action]}</strong>{' '}
                            {[ownerLabel(e, app), TABLE_LABELS[e.table_name] ?? e.table_name].filter(Boolean).join(' · ')}
                            {' '}by {names[e.changed_by] ?? 'unknown'} on {new Date(e.changed_at).toLocaleString()}
                        </p>
                        <ul className="pl-4 text-sm">
                            {fields.map((k) => (
                                <li key={k}>
                                    {fieldLabel(k)}:{' '}
                                    {e.action === 'UPDATE' ? `${show(e.old_data[k])} → ${show(e.new_data[k])}` : show(data[k])}
                                </li>
                            ))}
                        </ul>
                    </li>
                );
            })}
        </ul>
    );
};

export default ChangeHistory;
