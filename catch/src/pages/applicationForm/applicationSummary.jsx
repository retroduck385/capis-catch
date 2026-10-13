// Read-only view of a whole application (review step, submitted view, staff loan folder).
// Pass onViewDocument to make uploaded file names openable.
import React from 'react';
import { getAddress, getParties, getParty, one } from './api';
import {
    ADDRESS_FIELDS, BANK_ACCOUNT_FIELDS, CIVIL_STATUSES, COLLATERAL_FIELDS, CREDIT_CARD_FIELDS, EMPLOYMENT_FIELDS,
    EMPLOYMENT_TYPES, EXISTING_LOAN_FIELDS, formatMoney, GENDERS, HOME_OWNERSHIP, labelFor, PARTY_FIELDS,
    partyLabel, PERSON_FIELDS, REFERENCE_FIELDS, REFERRAL_CHANNELS, REFERRAL_FIELDS, REQUIREMENT_LABELS,
} from './options';

const ENUM_OPTIONS = {
    gender: GENDERS, civil_status: CIVIL_STATUSES, employment_type: EMPLOYMENT_TYPES,
    home_ownership: HOME_OWNERSHIP, channel: REFERRAL_CHANNELS,
};

const display = (field, value, type) => {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (ENUM_OPTIONS[field]) return labelFor(ENUM_OPTIONS[field], value);
    if (type === 'money') return `₱${formatMoney(value)}`;
    return String(value);
};

const Rows = ({ config, row, fields = Object.keys(config) }) => (
    <dl className="grid grid-cols-2 gap-x-4 text-left">
        {fields.map((f) => (
            <React.Fragment key={f}>
                <dt className="font-semibold">{config[f]?.label ?? f}</dt>
                <dd>{display(f, row?.[f], config[f]?.type)}</dd>
            </React.Fragment>
        ))}
    </dl>
);

const Block = ({ title, children }) => (
    <div className="border p-3 my-3 text-left">
        <h3 className="font-semibold pb-1">{title}</h3>
        {children}
    </div>
);

const ADDRESS_CONFIG = {
    ...ADDRESS_FIELDS,
    living_in_ph: { label: 'Living in the Philippines?' },
    home_ownership: { label: 'Home Ownership' },
    monthly_rent: { label: 'Monthly Rent', type: 'money' },
    date_move_in: { label: 'Date of Move-In' },
};

const AddressRows = ({ address }) => {
    if (!address) return <p>—</p>;
    if (address.same_as_principal) return <p>Same as Principal Borrower's present address</p>;
    const fields = Object.keys(ADDRESS_CONFIG).filter((f) => address[f] !== null && address[f] !== undefined);
    return <Rows config={ADDRESS_CONFIG} row={address} fields={fields} />;
};

const PartyBlock = ({ party, onViewDocument }) => {
    const job = one(party.employment_info);
    return (
        <Block title={partyLabel(party)}>
            <Rows config={PERSON_FIELDS} row={party} fields={PARTY_FIELDS[party.role].map(([f]) => f)} />
            {party.role === 'PRINCIPAL' && (
                <p className="pt-1">
                    Number of Dependents: {(party.dependents ?? []).length}
                    {(party.dependents ?? []).length > 0 && ` (ages ${party.dependents.map((d) => d.age).join(', ')})`}
                </p>
            )}
            {['PRESENT', 'PERMANENT'].map((type) => getAddress(party, type) && (
                <div key={type} className="pt-2">
                    <p className="italic">{type === 'PRESENT' ? 'Present' : 'Permanent'} Address</p>
                    <AddressRows address={getAddress(party, type)} />
                </div>
            ))}
            {job && (
                <div className="pt-2">
                    <p className="italic">Employment</p>
                    <Rows config={EMPLOYMENT_FIELDS} row={job}
                        fields={job.employment_type === 'UNEMPLOYED' ? ['employment_type'] : Object.keys(EMPLOYMENT_FIELDS)} />
                    {getAddress(party, 'EMPLOYER') && <AddressRows address={getAddress(party, 'EMPLOYER')} />}
                </div>
            )}
            {(party.application_requirements ?? []).length > 0 && (
                <div className="pt-2">
                    <p className="italic">Documents</p>
                    <ul className="list-disc pl-6">
                        {party.application_requirements.map((r) => (
                            <li key={r.id}>
                                {REQUIREMENT_LABELS[r.requirement_type]}:{' '}
                                {(r.documents ?? []).length === 0 && 'none'}
                                {!onViewDocument && (r.documents ?? []).map((d) => d.file_name).join(', ')}
                                {onViewDocument && (r.documents ?? []).map((d) => (
                                    <button key={d.id} type="button" className="underline pr-2" onClick={() => onViewDocument(d)}>
                                        {d.file_name}
                                    </button>
                                ))}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </Block>
    );
};

const ListBlock = ({ title, config, rows }) => (
    <Block title={title}>
        {rows?.length ? rows.map((r) => <div key={r.id} className="border-b py-1"><Rows config={config} row={r} /></div>)
            : <p>None</p>}
    </Block>
);

const ApplicationSummary = ({ app, onViewDocument }) => {
    const principal = getParty(app, 'PRINCIPAL');
    const parties = getParties(app);

    return (
        <div>
            <Block title="Loan Details">
                <Rows
                    config={{
                        purpose: { label: 'Purpose' }, property_address: { label: 'Property Address' },
                        loan_amount: { label: 'Loan Amount', type: 'money' }, loan_term_years: { label: 'Loan Term (years)' },
                    }}
                    row={{ ...app, purpose: app.loan_purposes?.label ?? app.loan_purpose_other }} />
            </Block>

            {parties.map((p) => <PartyBlock key={p.id} party={p} onViewDocument={onViewDocument} />)}

            <ListBlock title="Existing Bank Accounts" config={BANK_ACCOUNT_FIELDS} rows={principal?.bank_accounts} />
            <ListBlock title="Existing Loans" config={EXISTING_LOAN_FIELDS} rows={principal?.existing_loans} />
            <ListBlock title="Credit Cards" config={CREDIT_CARD_FIELDS} rows={principal?.credit_cards} />
            <ListBlock title="Character References" config={REFERENCE_FIELDS}
                rows={[...(app.character_references ?? [])].sort((a, b) => a.reference_no - b.reference_no)} />

            <Block title="Collateral Details"><Rows config={COLLATERAL_FIELDS} row={one(app.collateral_details)} /></Block>
            <Block title="Referral Details"><Rows config={REFERRAL_FIELDS} row={one(app.referral_details)} /></Block>
        </div>
    );
};

export default ApplicationSummary;
