// Sections of the Financial Package & Credit Recommendation (KYC-FP "FP" tab, pages 1 and 2).
// Values copied from the KYC are shown read-only from the record; the CO's inputs come in through
// `form` / `on*` props and are disabled when the viewer can't edit.
import { Link } from 'react-router-dom';
import { getAddress, getParties, one } from '../applicationForm/api';
import { joinAddress, presentAddressOf, tenure, wholeYears } from '../applicationForm/derived';
import { Field, Section } from '../applicationForm/fields';
import {
    BORROWER_ROLES, CIVIL_STATUSES, HOME_OWNERSHIP, REFERRAL_CHANNELS, formatMoney, labelFor, partyLabel,
} from '../applicationForm/options';
import RoutingSummary from '../review/routingSummary';
import { percent } from './compute';
import { CREDIT_RESULTS, INCOME_BASES, TITLE_FIELDS, TITLE_KINDS } from './options';

const blank = (v) => v === null || v === undefined || v === '';
const show = (v) => (blank(v) ? '—' : v);
const peso = (v) => (blank(v) ? null : `₱${formatMoney(v)}`);
const fullName = (p) => [p.first_name, p.middle_name, p.last_name, p.name_extension].filter(Boolean).join(' ') || null;

// Label / value pairs copied from the KYC (read-only)
const Info = ({ rows }) => (
    <dl className="grid grid-cols-[14rem_1fr] gap-x-4 gap-y-1 py-1">
        {rows.map(([label, value]) => (
            <div key={label} className="contents">
                <dt className="font-semibold">{label}</dt>
                <dd>{show(value)}</dd>
            </div>
        ))}
    </dl>
);

const Cell = ({ children, className = '' }) => <td className={`border px-2 align-top ${className}`}>{children}</td>;
const Head = ({ children }) => <th className="border px-2 text-left align-top">{children}</th>;

const TextArea = ({ name, label, value, onChange, disabled, rows = 3, required }) => (
    <div className="flex flex-col py-2 text-left">
        <label htmlFor={name}>{label}{required && <span className="text-red-600"> *</span>}</label>
        <textarea id={name} className="p-2 mt-1 border" rows={rows} value={value ?? ''} disabled={disabled}
            onChange={(e) => onChange(name, e.target.value)} />
    </div>
);

const KycNote = () => <p className="italic text-sm pb-1">From the KYC (read-only). The AO corrects these in the loan folder.</p>;

// ---------- Header ----------
export const HeaderSection = ({ app, aoName, form, onPkg, disabled, score, scoreLink, approvalLink, onOpenScore }) => {
    const referral = one(app.referral_details);
    return (
        <Section title="Financial Package and Credit Recommendation — Housing Loans">
            <div className="grid grid-cols-2 gap-x-6">
                <div>
                    <Field name="date_prepared" label="Date Prepared" type="date" value={form.date_prepared}
                        onChange={onPkg} disabled={disabled} />
                    <Field name="dosri_rpt" label="DOSRI / RPT" value={form.dosri_rpt} onChange={onPkg} disabled={disabled}
                        options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} />
                    <p className="py-2"><span className="font-semibold">Credit Risk Rating:</span>{' '}
                        {score.riskRating ? `${score.riskRating} (${score.total} / 100)`
                            : <span className="italic">Credit scoring not finished ({score.scored} of {score.count} scored)</span>}</p>
                    <Link to={scoreLink} onClick={onOpenScore} className="inline-block border px-3 py-1">
                        Open Credit Scoring
                    </Link>{' '}
                    <Link to={approvalLink} onClick={onOpenScore} className="inline-block border px-3 py-1">
                        VII. Approval (pick reviewers / approvers)
                    </Link>
                </div>
                <Info rows={[
                    ['Channel', referral?.channel ? labelFor(REFERRAL_CHANNELS, referral.channel) : null],
                    ['Branch / Developer Name', referral?.developer_name || referral?.branch],
                    ['Handling Account Officer', aoName],
                ]} />
            </div>
        </Section>
    );
};

// ---------- I. Borrower/s highlight ----------
export const HighlightsSection = ({ app, computed }) => (
    <Section title="I. Borrower/s Highlight">
        <KycNote />
        <div className="overflow-x-auto">
            <table className="border-collapse">
                <thead>
                    <tr>
                        <Head>Applicant Type</Head><Head>Name</Head><Head>Employer / Business Name</Head>
                        <Head>Position / Rank</Head><Head>Employment Tenure</Head><Head>Monthly Income (Gross)</Head>
                    </tr>
                </thead>
                <tbody>
                    {computed.incomes.map(({ party, gross }) => {
                        const job = one(party.employment_info);
                        const employed = job && job.employment_type !== 'UNEMPLOYED';
                        return (
                            <tr key={party.id}>
                                <Cell>{party.role === 'PRINCIPAL' ? 'Principal Borrower / Mortgagor' : partyLabel(party)}</Cell>
                                <Cell>{show(fullName(party))}</Cell>
                                <Cell>{show(employed ? job.employer_business_name : 'Not employed')}</Cell>
                                <Cell>{show(employed ? job.occupation : null)}</Cell>
                                <Cell>{show(employed ? tenure(job.employment_date, app.submitted_at) : null)}</Cell>
                                <Cell>{gross === null ? <span className="text-red-600">Pick income basis (IX)</span> : peso(gross)}</Cell>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
        <Info rows={[
            ['Combined Gross Income', peso(computed.totalGross)],
            ['Debt Burden Ratio (DBR)', percent(computed.dbr)],
        ]} />
    </Section>
);

// ---------- II. Facility financial package ----------
export const FacilitySection = ({ app, computed, form, pricing, onPkg, onPricing, disabled }) => (
    <Section title="II. Facility Financial Package">
        <div className="grid grid-cols-2 gap-x-6">
            <div>
                <KycNote />
                <Info rows={[
                    ['Loan Purpose', one(app.loan_purposes)?.label ?? app.loan_purpose_other],
                    ['Proposed Loan Amount', peso(app.loan_amount)],
                    ['Term (in Years)', app.loan_term_years],
                    ['TCP / TAV', peso(computed.collateralValue)],
                    ['Loan-to-Collateral Ratio (LCR)', percent(computed.lcr)],
                    ['Monthly Amortization', computed.amortization === null ? 'Needs the interest rate' : peso(computed.amortization)],
                ]} />
                <p className="text-sm italic">
                    Amortization = PMT(rate / 12, 12 × term, −loan amount). LCR = loan amount ÷{' '}
                    {computed.appraised !== null ? 'appraised value' : 'TCP (selling price) until an appraised value is entered'}.
                </p>
            </div>
            <div>
                <Field name="variant" label="Variant" value={form.variant} onChange={onPkg} disabled={disabled} />
                <Field name="interest_rate" label="Interest Rate (% per annum)" type="number" value={pricing.interest_rate}
                    onChange={onPricing} disabled={disabled} />
                <Field name="fixing_period" label="Fixing Period" placeholder="e.g. 3 years" value={pricing.fixing_period}
                    onChange={onPricing} disabled={disabled} />
                <Field name="manner_of_repayment" label="Manner of Repayment" value={form.manner_of_repayment}
                    onChange={onPkg} disabled={disabled} />
                <Field name="hgc_eligibility" label="HGC Eligibility" value={form.hgc_eligibility} onChange={onPkg} disabled={disabled} />
                <Field name="date_of_enrollment" label="Date of Enrollment" type="date" value={form.date_of_enrollment}
                    onChange={onPkg} disabled={disabled} />
            </div>
        </div>
    </Section>
);

// ---------- III. Collateral information ----------
export const CollateralSection = ({ app, form, onPkg, disabled }) => {
    const c = one(app.collateral_details) ?? {};
    return (
        <Section title="III. Collateral Information">
            <div className="grid grid-cols-2 gap-x-6">
                <div>
                    <KycNote />
                    <Info rows={[
                        ['TCT / CCT No.', c.tct_cct_no],
                        ['Collateral Type', c.property_type],
                        ['Location of the Property', app.property_address],
                        ['Registered Owner', c.registered_owner],
                        ['Lot Area (sqm)', c.lot_area],
                        ['Floor Area (sqm)', c.floor_area],
                        ['TCP (Selling Price)', peso(c.selling_price)],
                    ]} />
                </div>
                <div>
                    <Field name="appraised_value" label="Appraised Value (PHP)" type="money" value={form.appraised_value}
                        onChange={onPkg} disabled={disabled} />
                    <Field name="date_of_appraisal" label="Date of Appraisal" type="date" value={form.date_of_appraisal}
                        onChange={onPkg} disabled={disabled} />
                </div>
            </div>
            <TextArea name="other_information" label="Other Information" value={form.other_information}
                onChange={onPkg} disabled={disabled} />
            <TextArea name="statement_of_account" label="Statement of Account" value={form.statement_of_account}
                onChange={onPkg} disabled={disabled} />
        </Section>
    );
};

// ---------- IV. Credit checking (from the CI; not built yet) ----------
export const CreditCheckingSection = ({ app }) => (
    <Section title="IV. Credit Checking">
        <table className="border-collapse">
            <thead><tr><Head>Name</Head><Head>BRAS</Head><Head>NFIS</Head></tr></thead>
            <tbody>
                {getParties(app, BORROWER_ROLES).map((p) => (
                    <tr key={p.id}>
                        <Cell>{show(fullName(p))} ({partyLabel(p)})</Cell>
                        <Cell className="italic text-gray-500">Awaiting CI results</Cell>
                        <Cell className="italic text-gray-500">Awaiting CI results</Cell>
                    </tr>
                ))}
            </tbody>
        </table>
        <p className="italic text-sm pt-1">Filled in from the Credit Investigator's results once that step exists.</p>
    </Section>
);

// ---------- VII. Approval (picked on its own page) ----------
export const ApprovalSection = ({ tier, rows, names, link, onOpen }) => (
    <Section title="VII. Approval">
        <RoutingSummary tier={tier} rows={rows} names={names} />
        <Link to={link} onClick={onOpen} className="inline-block border px-3 py-1 mt-2">Open VII. Approval</Link>
    </Section>
);

// ---------- Row lists (V, X, XI, XII) ----------
export const RowsSection = ({ title, config, rows, onChange, disabled, children }) => {
    const update = (i, field, value) => onChange(rows.map((r, j) => (j === i ? { ...r, [field]: value } : r)));
    return (
        <Section title={title}>
            {children}
            {rows.length === 0 && <p className="italic">None added.</p>}
            {rows.map((row, i) => (
                <div key={row.id ?? row._key} className="border-b pb-2 mb-2">
                    <div className="grid grid-cols-2 gap-x-6">
                        {Object.entries(config).map(([f, c]) => (
                            <Field key={f} name={`${title}-${row.id ?? row._key}-${f}`} {...c} value={row[f]}
                                disabled={disabled} onChange={(_, v) => update(i, f, v)} />
                        ))}
                    </div>
                    {!disabled && (
                        <button type="button" className="border px-3 py-1" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                            Remove
                        </button>
                    )}
                </div>
            ))}
            {!disabled && (
                <button type="button" className="border px-3 py-1"
                    onClick={() => onChange([...rows, { _key: crypto.randomUUID() }])}>
                    + Add
                </button>
            )}
        </Section>
    );
};

// ---------- VI. Terms and conditions ----------
export const TermsSection = ({ form, onPkg, onReset, disabled }) => (
    <Section title="VI. Terms and Conditions">
        <TextArea name="terms_and_conditions" label="Terms and Conditions" rows={16} value={form.terms_and_conditions}
            onChange={onPkg} disabled={disabled} />
        {!disabled && (
            <button type="button" className="border px-3 py-1" onClick={onReset}>
                Reset to template (fills in developer, rate and fixing period)
            </button>
        )}
    </Section>
);

// ---------- VIII. Employment / business verification ----------
export const EmploymentSection = ({ app, details, onParty, disabled }) => (
    <Section title="VIII. Employment / Business Verification">
        <KycNote />
        {getParties(app, BORROWER_ROLES).map((p) => {
            const job = one(p.employment_info);
            const employed = job && job.employment_type !== 'UNEMPLOYED';
            return (
                <div key={p.id} className="border-b pb-2 mb-2">
                    <h4 className="font-semibold">{partyLabel(p)}: {show(fullName(p))}</h4>
                    <Info rows={employed ? [
                        ['Company Name / Address', [job.employer_business_name, joinAddress(getAddress(p, 'EMPLOYER'))].filter(Boolean).join(' / ')],
                        ['Position / Rank / Status', job.occupation],
                        ['Date Hired / Registration', job.employment_date],
                        ['Contact Numbers', job.contact_number],
                    ] : [['Employment', 'Not employed']]} />
                    <TextArea name={`employment_remarks-${p.id}`} label="Remarks" rows={2}
                        value={details[p.id]?.employment_remarks} disabled={disabled}
                        onChange={(_, v) => onParty(p.id, 'employment_remarks', v)} />
                </div>
            );
        })}
    </Section>
);

// ---------- IX. Financial capacity / cash flow ----------
export const CashFlowSection = ({ computed, details, onParty, disabled }) => (
    <Section title="IX. Financial Capacity / Cash Flow">
        {computed.incomes.map(({ party, declared, basic, gross }) => (
            <div key={party.id} className="border-b pb-2 mb-2">
                <h4 className="font-semibold">{partyLabel(party)}: {show(fullName(party))}</h4>
                <div className="grid grid-cols-2 gap-x-6">
                    <div>
                        <Info rows={[
                            ['Declared Gross Monthly Income (KYC)', peso(declared)],
                            ['Basic Income (A)', basic === null ? 'Pick an income basis' : peso(basic)],
                            ['Gross Income (A + B)', peso(gross)],
                        ]} />
                    </div>
                    <div>
                        {declared > 0 && (
                            <Field name={`income_basis-${party.id}`} label="Income Basis" options={INCOME_BASES} required
                                value={details[party.id]?.income_basis} disabled={disabled}
                                onChange={(_, v) => onParty(party.id, 'income_basis', v)} />
                        )}
                        <Field name={`other_income-${party.id}`} label="Other Income (B) (PHP)" type="money"
                            value={details[party.id]?.other_income} disabled={disabled}
                            onChange={(_, v) => onParty(party.id, 'other_income', v)} />
                    </div>
                </div>
                <TextArea name={`cash_flow_remarks-${party.id}`} label="Remarks" rows={2}
                    value={details[party.id]?.cash_flow_remarks} disabled={disabled}
                    onChange={(_, v) => onParty(party.id, 'cash_flow_remarks', v)} />
            </div>
        ))}

        <h4 className="font-semibold pt-2">Existing Monthly Amortization (C) — from the KYC</h4>
        {computed.existingLoans.length === 0 ? <p>No existing loans declared.</p> : (
            <ul className="list-disc pl-6">
                {computed.existingLoans.map((l) => (
                    <li key={l.id}>
                        {partyLabel(l.party)}: {l.loan_type} with {l.lending_institution}, {peso(l.monthly_payment)} / month
                        {l.term_over_6_months ? '' : ' (6 months or less left: not counted in DBR)'}
                    </li>
                ))}
            </ul>
        )}
        <Info rows={[
            ['Existing Monthly Amortization (C, loans with more than 6 months left)', peso(computed.existing)],
            ['Total Gross Income (D)', computed.totalGross === null ? 'Pick every income basis' : peso(computed.totalGross)],
            ['New Monthly Amortization', computed.amortization === null ? 'Needs the interest rate' : peso(computed.amortization)],
            ['DBR = (new amortization + C) ÷ D', percent(computed.dbr)],
        ]} />
        <p className="text-sm italic">Income basis: COE counts 80% of declared income, payslips 90%, as declared 100%. Seafarers (gross × contracts ÷ 12) and self-employed AMD aren't computed yet.</p>
    </Section>
);

// ---------- XIII. Title verification and traceback ----------
export const TitleSection = ({ titles, onTitle, disabled }) => (
    <Section title="XIII. Title Verification and Traceback">
        <div className="grid grid-cols-2 gap-x-6">
            {TITLE_KINDS.map((k) => (
                <div key={k.value}>
                    <h4 className="font-semibold">{k.label}</h4>
                    {Object.entries(TITLE_FIELDS).map(([f, c]) => (
                        <Field key={f} name={`title-${k.value}-${f}`} {...c} value={titles[k.value]?.[f]} disabled={disabled}
                            onChange={(_, v) => onTitle(k.value, f, v)} />
                    ))}
                </div>
            ))}
        </div>
    </Section>
);

// ---------- XIV. Customer information ----------
const yearsOfStay = (address, asOf) => {
    if (!address) return null;
    const years = wholeYears(address.date_move_in, asOf);
    const ownership = address.home_ownership ? labelFor(HOME_OWNERSHIP, address.home_ownership) : null;
    return [years === null ? null : `${years} ${years === 1 ? 'year' : 'years'}`, ownership].filter(Boolean).join(' / ') || null;
};

export const CustomerSection = ({ app, details, onParty, disabled }) => {
    const parties = getParties(app, [...BORROWER_ROLES, 'ATTORNEY_IN_FACT']);
    const principal = parties.find((p) => p.role === 'PRINCIPAL');
    return (
        <Section title="XIV. Customer Information">
            <KycNote />
            {parties.map((p) => {
                const present = presentAddressOf(p, principal);
                const permanent = getAddress(p, 'PERMANENT');
                const age = wholeYears(p.date_of_birth, app.submitted_at);
                const deps = p.dependents ?? [];
                const isBorrower = BORROWER_ROLES.includes(p.role);
                return (
                    <div key={p.id} className="border-b pb-2 mb-2">
                        <h4 className="font-semibold">
                            {p.role === 'PRINCIPAL' ? 'Principal Borrower / Mortgagor'
                                : p.role === 'ATTORNEY_IN_FACT' ? 'AIF' : partyLabel(p)}
                            {p.relationship_to_principal && p.role !== 'PRINCIPAL' ? ` — ${p.relationship_to_principal}` : ''}
                        </h4>
                        <Info rows={[
                            ["Borrower's Name", fullName(p)],
                            ['Birth Date / Age', p.date_of_birth ? `${p.date_of_birth} (${age ?? '?'} y.o.)` : null],
                            ['Civil Status', p.civil_status ? labelFor(CIVIL_STATUSES, p.civil_status) : null],
                            ['Citizenship', p.citizenship],
                            ['Present Address', joinAddress(present)],
                            ['Permanent Address', joinAddress(permanent?.same_as_principal ? getAddress(principal, 'PERMANENT') : permanent)],
                            ['Years of Stay / Ownership', yearsOfStay(present, app.submitted_at)],
                            ['Contact Number/s', p.mobile_number],
                            ['Email Address', p.email_address],
                            ...(isBorrower ? [['No. of Children / Dependents and Age/s',
                                `${deps.length} dependents${deps.length ? `: ${deps.map((d) => d.age).join(', ')}` : ''}`]] : []),
                        ]} />
                        {isBorrower && (
                            <TextArea name={`other_information-${p.id}`} label="Other Information" rows={11}
                                value={details[p.id]?.other_information} disabled={disabled}
                                onChange={(_, v) => onParty(p.id, 'other_information', v)} />
                        )}
                    </div>
                );
            })}
        </Section>
    );
};

// ---------- Credit result ----------
export const CreditResultSection = ({ form, onPkg, disabled }) => (
    <Section title="Credit Result">
        <Field name="credit_result" label="Credit Result" options={CREDIT_RESULTS} value={form.credit_result}
            onChange={onPkg} disabled={disabled} />
        <TextArea name="justification" label={form.credit_result === 'DEFERRED' ? 'Justification and Remarks (reason for deferral)' : 'Justification and Remarks'}
            required={!blank(form.credit_result)} value={form.justification} onChange={onPkg} disabled={disabled} />
        <TextArea name="amendment" label="Amendment" rows={2} value={form.amendment} onChange={onPkg} disabled={disabled} />
        <TextArea name="waiver_and_acceptance" label="Waiver and Acceptance" rows={2} value={form.waiver_and_acceptance}
            onChange={onPkg} disabled={disabled} />
        <TextArea name="deferrals" label="Deferral(s)" rows={2} value={form.deferrals} onChange={onPkg} disabled={disabled} />
        <p className="italic text-sm">Saved on the FP. To send it to the reviewers and approvers, save the FP, then open VII. Approval.</p>
    </Section>
);
