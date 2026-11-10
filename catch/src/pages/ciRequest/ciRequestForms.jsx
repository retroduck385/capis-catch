// The KYC-FP "CI Request" tab (NFIS Request Form + TransUnion Request Template), built from the
// application record instead of being typed in. Used by the AO's "Request CI" preview and the CI's view.
// Blank mandatory fields show as "Missing" (the sheet: "request will not be accommodated if with lacking").
import { ID_ROWS, TU_ROWS, buildCiRequest, isBlank, peso } from './buildRequest';
import './ciRequest.css';

const Missing = () => <span className="ci-missing">Missing</span>;
const Value = ({ children, optional }) => (isBlank(children) ? (optional ? '—' : <Missing />) : children);

const Cell = ({ children, className = '' }) => <td className={className}>{children}</td>;
const Head = ({ children }) => <th>{children}</th>;

const NfisForm = ({ request }) => {
    const businesses = request.people.filter((p) => p.employer);
    return (
        <section className="lf-card" aria-label="NFIS Request Form">
            <div className="lf-cardhead"><h2>NFIS Request Form</h2></div>
            <p className="ci-note">For individual name of inquiry. If any borrower is married, include maiden name.</p>
            <div className="ci-tablewrap">
                <table>
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
                                <Cell className="ci-party">{p.label}</Cell>
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

            <p className="ci-note ci-gap">For corporate / business name of inquiry.</p>
            {businesses.length === 0 ? <p className="ci-empty">No employer or business on file.</p> : (
                <div className="ci-tablewrap">
                    <table>
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
                                    <Cell className="ci-party">{p.label}</Cell>
                                    <Cell>{p.employer}</Cell>
                                    <Cell><Value>{p.employerAddress}</Value></Cell>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
};

const TuRow = ({ label, get, optional, people }) => (
    <tr>
        <Cell className="ci-party">{label}</Cell>
        {people.map((p) => (
            <Cell key={p.key}>
                <Value optional={typeof optional === 'function' ? optional(p) : optional}>{get(p)}</Value>
            </Cell>
        ))}
    </tr>
);

const TuForm = ({ request }) => (
    <section className="lf-card" aria-label="TransUnion Request Template">
        <div className="lf-cardhead"><h2>TransUnion (TU) Request Template</h2></div>
        <dl className="ci-kv">
            <div><dt>Loan Type</dt><dd><Value>{request.loanType}</Value></dd></div>
            <div><dt>Desired amount to be loaned</dt><dd><Value>{peso(request.loanAmount)}</Value></dd></div>
        </dl>
        <div className="ci-tablewrap">
            <table>
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
                    {ID_ROWS.map(([label, get, optional]) => (
                        <tr key={label}>
                            <Cell className="ci-party">{label}</Cell>
                            {request.people.map((p) => (
                                p.idStatus === 'LOADING' || p.idStatus === 'UNCONFIRMED' ? (
                                    <Cell key={p.key} className="ci-pending">
                                        {p.idStatus === 'LOADING' ? 'Loading…' : 'Awaiting AO confirmation of the uploaded ID'}
                                    </Cell>
                                ) : (
                                    <Cell key={p.key}><Value optional={optional}>{get(p)}</Value></Cell>
                                )
                            ))}
                        </tr>
                    ))}
                    {TU_ROWS.slice(6).map(([label, get, optional]) => (
                        <TuRow key={label} label={label} get={get} optional={optional} people={request.people} />
                    ))}
                </tbody>
            </table>
        </div>
    </section>
);

// idDetails = useIdDetails(app), shared with the parent's missing-values count
const CiRequestForms = ({ app, idDetails }) => {
    const request = buildCiRequest(app, idDetails);
    return (
        <>
            <NfisForm request={request} />
            <TuForm request={request} />
        </>
    );
};

export default CiRequestForms;
