// The KYC-FP "CI Request" tab (NFIS Request Form + TransUnion Request Template), built from the
// application record instead of being typed in. Used by the AO's "Request CI" preview and the CI's view.
// Blank mandatory fields show as "Missing" (the sheet: "request will not be accommodated if with lacking").
import { getAddress, getParties, one } from '../applicationForm/api';
import { joinAddress, presentAddressOf, tenure } from '../applicationForm/derived';
import { BORROWER_ROLES, CIVIL_STATUSES, EMPLOYMENT_TYPES, formatMoney, labelFor, partyLabel } from '../applicationForm/options';

const peso = (value) => (value === null || value === undefined || value === '' ? null : `₱${formatMoney(value)}`);

// Everything both forms need, per borrower (principal, spouse, co-borrowers 1..n)
const buildCiRequest = (app) => {
    const parties = getParties(app, BORROWER_ROLES);
    const principal = parties.find((p) => p.role === 'PRINCIPAL');

    const people = parties.map((p) => {
        const job = one(p.employment_info);
        const employed = job && job.employment_type !== 'UNEMPLOYED';
        const address = presentAddressOf(p, principal);
        return {
            key: `${p.role}-${p.party_no ?? 1}`,
            label: p.role === 'PRINCIPAL' ? 'Subject' : partyLabel(p),
            lastName: p.last_name,
            firstName: p.first_name,
            middleName: p.middle_name,
            maidenName: p.maiden_name,
            birthDate: p.date_of_birth,
            civilStatus: p.civil_status ? labelFor(CIVIL_STATUSES, p.civil_status) : null,
            address: joinAddress(address),
            zip: address?.zip_code ?? null,
            mobile: p.mobile_number,
            incomeSource: job?.employment_type ? labelFor(EMPLOYMENT_TYPES, job.employment_type) : null,
            employer: employed ? job.employer_business_name : null,
            employerAddress: employed ? joinAddress(getAddress(p, 'EMPLOYER')) : null,
            monthlyIncome: employed ? job.gross_monthly_income : null,
            tenure: employed ? tenure(job.employment_date, app.submitted_at) : null,
            employed,
        };
    });

    return {
        loanType: one(app.loan_purposes)?.label ?? app.loan_purpose_other ?? null,
        loanAmount: app.loan_amount,
        people,
    };
};

const Missing = () => <span className="text-red-600">Missing</span>;
const Value = ({ children, optional }) =>
    children === null || children === undefined || children === '' ? (optional ? '—' : <Missing />) : children;

const Cell = ({ children, className = '' }) => <td className={`border px-2 align-top ${className}`}>{children}</td>;
const Head = ({ children }) => <th className="border px-2 text-left align-top">{children}</th>;

const NfisForm = ({ request }) => {
    const businesses = request.people.filter((p) => p.employer);
    return (
        <div className="border p-3 my-3 text-left">
            <h3 className="font-semibold">NFIS Request Form</h3>
            <p className="italic pb-2">For individual name of inquiry. If any borrower is married, include maiden name.</p>
            <div className="overflow-x-auto">
                <table className="border-collapse">
                    <thead>
                        <tr>
                            <Head>Party</Head>
                            <Head>Last Name</Head>
                            <Head>First Name</Head>
                            <Head>Middle Name</Head>
                            <Head>Maiden Name</Head>
                            <Head>Complete Address</Head>
                            <Head>Birth Date</Head>
                        </tr>
                    </thead>
                    <tbody>
                        {request.people.map((p) => (
                            <tr key={p.key}>
                                <Cell>{p.label}</Cell>
                                <Cell><Value>{p.lastName}</Value></Cell>
                                <Cell><Value>{p.firstName}</Value></Cell>
                                <Cell><Value optional>{p.middleName}</Value></Cell>
                                <Cell><Value optional>{p.maidenName}</Value></Cell>
                                <Cell><Value>{p.address}</Value></Cell>
                                <Cell><Value>{p.birthDate}</Value></Cell>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <p className="italic pt-3 pb-2">For corporate / business name of inquiry.</p>
            {businesses.length === 0 ? <p>No employer or business on file.</p> : (
                <div className="overflow-x-auto">
                    <table className="border-collapse">
                        <thead>
                            <tr>
                                <Head>Party</Head>
                                <Head>Corporate / Business Name</Head>
                                <Head>Complete Address</Head>
                            </tr>
                        </thead>
                        <tbody>
                            {businesses.map((p) => (
                                <tr key={p.key}>
                                    <Cell>{p.label}</Cell>
                                    <Cell>{p.employer}</Cell>
                                    <Cell><Value>{p.employerAddress}</Value></Cell>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

// TU rows: [label, value per person, optional?]
const TU_ROWS = [
    ['Last Name', (p) => p.lastName],
    ['First Name', (p) => p.firstName],
    ['Middle Name', (p) => p.middleName, true],
    ['Full Maiden Name (married female)', (p) => p.maidenName, true],
    ['Date of Birth', (p) => p.birthDate],
    ['Civil Status', (p) => p.civilStatus],
    ['Complete Address (Philippines)', (p) => p.address],
    ['Zip Code', (p) => p.zip],
    ['Contact Number (Philippines)', (p) => p.mobile],
    ['Source of Income', (p) => p.incomeSource],
    ['Company / Employer Name', (p) => p.employer, (p) => !p.employed],
    ['Monthly Gross Salary / Income', (p) => peso(p.monthlyIncome), (p) => !p.employed],
    ['Annual Gross Salary / Income', (p) => (p.monthlyIncome == null ? null : peso(p.monthlyIncome * 12)), (p) => !p.employed],
    ['Tenure', (p) => p.tenure, (p) => !p.employed],
];

// ID details come later from the uploaded ID (OCR labeling not built yet)
const ID_ROWS = ['ID Type', 'ID Number', 'Expiry Date'];

const TuForm = ({ request }) => (
    <div className="border p-3 my-3 text-left">
        <h3 className="font-semibold">TransUnion (TU) Request Template</h3>
        <dl className="grid grid-cols-2 gap-x-4 py-2 max-w-xl">
            <dt className="font-semibold">Loan Type</dt>
            <dd><Value>{request.loanType}</Value></dd>
            <dt className="font-semibold">Desired amount to be loaned</dt>
            <dd><Value>{peso(request.loanAmount)}</Value></dd>
        </dl>
        <div className="overflow-x-auto">
            <table className="border-collapse">
                <thead>
                    <tr>
                        <Head>Inquiry Name</Head>
                        {request.people.map((p) => <Head key={p.key}>{p.label}</Head>)}
                    </tr>
                </thead>
                <tbody>
                    {TU_ROWS.slice(0, 6).map(([label, get, optional]) => (
                        <TuRow key={label} label={label} get={get} optional={optional} people={request.people} />
                    ))}
                    {ID_ROWS.map((label) => (
                        <tr key={label}>
                            <Cell className="font-semibold">{label}</Cell>
                            {request.people.map((p) => (
                                <Cell key={p.key} className="italic text-gray-500">To follow (from uploaded ID)</Cell>
                            ))}
                        </tr>
                    ))}
                    {TU_ROWS.slice(6).map(([label, get, optional]) => (
                        <TuRow key={label} label={label} get={get} optional={optional} people={request.people} />
                    ))}
                </tbody>
            </table>
        </div>
    </div>
);

const TuRow = ({ label, get, optional, people }) => (
    <tr>
        <Cell className="font-semibold">{label}</Cell>
        {people.map((p) => (
            <Cell key={p.key}>
                <Value optional={typeof optional === 'function' ? optional(p) : optional}>{get(p)}</Value>
            </Cell>
        ))}
    </tr>
);

const CiRequestForms = ({ app }) => {
    const request = buildCiRequest(app);
    return (
        <>
            <NfisForm request={request} />
            <TuForm request={request} />
        </>
    );
};

export default CiRequestForms;
