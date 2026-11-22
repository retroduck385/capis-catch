// Read-only view of a whole application (review step, submitted view, staff loan folder).
// Pass onViewDocument to make uploaded file names openable. groups: show only some blocks (SUMMARY_GROUPS, for the
// loan folder's tabs). Layout options (stacked tiles, hide empty fields) come from SummaryContext (summaryContext.js).
import React, { useContext } from 'react';
import { getAddress, getParties, getParty, one } from './api';
import { SUMMARY_GROUPS, SummaryContext } from './summaryContext';
import { partyAnchor } from '../kycClarify/sections';
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

const Rows = ({ config, row, fields = Object.keys(config) }) => {
    const { stacked, hideEmpty } = useContext(SummaryContext);
    const shown = hideEmpty ? fields.filter((f) => display(f, row?.[f], config[f]?.type) !== '—') : fields;
    if (stacked) {
        if (shown.length === 0) return <p className="sum-none">Nothing entered</p>;
        return (
            <dl className="sum-fields">
                {shown.map((f) => (
                    <div key={f} className="sum-f">
                        <dt>{config[f]?.label ?? f}</dt>
                        <dd>{display(f, row?.[f], config[f]?.type)}</dd>
                    </div>
                ))}
            </dl>
        );
    }
    return (
        <dl className="grid grid-cols-2 gap-x-4 text-left">
            {shown.map((f) => (
                <React.Fragment key={f}>
                    <dt className="font-semibold">{config[f]?.label ?? f}</dt>
                    <dd>{display(f, row?.[f], config[f]?.type)}</dd>
                </React.Fragment>
            ))}
        </dl>
    );
};

// sub: a second line in the stacked layout's header band (a borrower's name); the original layout ignores it
// anchor: an id for the block (KYC questions scroll the applicant to the matching part: kycClarify/sections.js)
const Block = ({ title, sub, children, anchor }) => {
    const { stacked } = useContext(SummaryContext);
    if (stacked) {
        return (
            <section className="sum-block" id={anchor}>
                <header className="sum-head">
                    <h3>{title}</h3>
                    {sub && <span className="sum-sub">{sub}</span>}
                </header>
                <div className="sum-body">{children}</div>
            </section>
        );
    }
    return (
        <div className="border p-3 my-3 text-left" id={anchor}>
            <h3 className="font-semibold pb-1">{title}</h3>
            {children}
        </div>
    );
};

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
    const { stacked } = useContext(SummaryContext);
    const job = one(party.employment_info);
    const personal = (
        <>
            <Rows config={PERSON_FIELDS} row={party} fields={PARTY_FIELDS[party.role].map(([f]) => f)} />
            {party.role === 'PRINCIPAL' && (
                <p className="pt-1">
                    Number of Dependents: {(party.dependents ?? []).length}
                    {(party.dependents ?? []).length > 0 && ` (ages ${party.dependents.map((d) => d.age).join(', ')})`}
                </p>
            )}
        </>
    );
    return (
        <Block title={partyLabel(party)} sub={[party.first_name, party.middle_name, party.last_name].filter(Boolean).join(' ')}
            anchor={partyAnchor(party.role, party.party_no)}>
            {/* stacked: the personal fields get a panel of their own, like the addresses below, so every group lines up */}
            {stacked ? <div className="pt-2"><p className="italic">Personal details</p>{personal}</div> : personal}
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

// item: what one row is called ("Reference"); the stacked layout numbers the rows with it
const ListBlock = ({ title, item, config, rows }) => {
    const { stacked } = useContext(SummaryContext);
    return (
        <Block title={title} sub={stacked && rows?.length ? `${rows.length} declared` : null}>
            {rows?.length ? rows.map((r, i) => (
                <div key={r.id} className="border-b py-1">
                    {stacked && <p className="sum-num">{item} {i + 1}</p>}
                    <Rows config={config} row={r} />
                </div>
            )) : <p className={stacked ? 'sum-none' : undefined}>{stacked ? 'None declared' : 'None'}</p>}
        </Block>
    );
};

const ApplicationSummary = ({ app, onViewDocument, groups = SUMMARY_GROUPS }) => {
    const principal = getParty(app, 'PRINCIPAL');
    const spouse = principal?.civil_status === 'MARRIED' ? getParty(app, 'SPOUSE') : null;
    const parties = getParties(app);
    const has = (g) => groups.includes(g);

    return (
        <div>
            {has('loan') && (
                <Block title="Loan Details" anchor="sum-loan">
                    <Rows
                        config={{
                            purpose: { label: 'Purpose' }, property_address: { label: 'Property Address' },
                            loan_amount: { label: 'Loan Amount', type: 'money' }, loan_term_years: { label: 'Loan Term (years)' },
                        }}
                        row={{ ...app, purpose: app.loan_purposes?.label ?? app.loan_purpose_other }} />
                </Block>
            )}

            {has('parties') && parties.map((p) => <PartyBlock key={p.id} party={p} onViewDocument={onViewDocument} />)}

            {has('obligations') && (
                <div id="sum-obligations">
                    <ListBlock title="Existing Bank Accounts" item="Account" config={BANK_ACCOUNT_FIELDS} rows={principal?.bank_accounts} />
                    <ListBlock title="Existing Loans" item="Loan" config={EXISTING_LOAN_FIELDS} rows={principal?.existing_loans} />
                    <ListBlock title="Credit Cards" item="Card" config={CREDIT_CARD_FIELDS} rows={principal?.credit_cards} />
                    {spouse && (
                        <>
                            <ListBlock title="Spouse: Existing Bank Accounts" item="Account" config={BANK_ACCOUNT_FIELDS} rows={spouse.bank_accounts} />
                            <ListBlock title="Spouse: Existing Loans" item="Loan" config={EXISTING_LOAN_FIELDS} rows={spouse.existing_loans} />
                            <ListBlock title="Spouse: Credit Cards" item="Card" config={CREDIT_CARD_FIELDS} rows={spouse.credit_cards} />
                        </>
                    )}
                </div>
            )}
            {has('references') && (
                <div id="sum-references"><ListBlock title="Character References" item="Reference" config={REFERENCE_FIELDS}
                    rows={[...(app.character_references ?? [])].sort((a, b) => a.reference_no - b.reference_no)} /></div>
            )}

            {has('collateral') && (
                <>
                    <Block title="Collateral Details" anchor="sum-collateral"><Rows config={COLLATERAL_FIELDS} row={one(app.collateral_details)} /></Block>
                    <Block title="Referral Details"><Rows config={REFERRAL_FIELDS} row={one(app.referral_details)} /></Block>
                </>
            )}
        </div>
    );
};

export default ApplicationSummary;
