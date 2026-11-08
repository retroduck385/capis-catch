// One CI request, opened from the Credit Investigator's work tray: the NFIS and TU forms plus the AO's remarks. View only for now.
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Info } from 'lucide-react';
import { fetchApplication } from '../applicationForm/api';
import { fetchStaffNames } from '../loanFolder/api';
import { whenOf } from '../loanFolder/options';
import { fetchCiRequests } from './api';
import { buildCiRequest, missingFields, peso } from './buildRequest';
import CiRequestForms from './ciRequestForms';
import MessagesPanel from '../messages/messagesPanel';
import '../loanFolder/loanFolder.css';
import '../financialPackage/financialPackage.css';
import './ciRequest.css';

const Remark = ({ title, text }) => (
    <div>
        <div className="ci-remark-label">{title}<small>from the Account Officer</small></div>
        <p className={`ci-remark${text ? '' : ' empty'}`}>{text || 'No remarks.'}</p>
    </div>
);

const CiRequestPage = () => {
    const [searchParams] = useSearchParams();
    const applicationId = Number(searchParams.get('id'));

    const [app, setApp] = useState(null);
    const [request, setRequest] = useState(null);
    const [requesterName, setRequesterName] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const [data, requests] = await Promise.all([fetchApplication(applicationId), fetchCiRequests(applicationId)]);
                const latest = requests.at(-1) ?? null;
                const names = latest ? await fetchStaffNames([latest.requested_by]) : {};
                if (cancelled) return;
                setApp(data);
                setRequest(latest);
                setRequesterName(latest ? names[latest.requested_by] : null);
            } catch (err) {
                if (!cancelled) setError(err.message);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        load();
        return () => { cancelled = true; };
    }, [applicationId]);

    const built = useMemo(() => (app ? buildCiRequest(app) : null), [app]);
    const missing = useMemo(() => (built ? missingFields(built) : []), [built]);

    if (loading) return <p>Loading CI request...</p>;
    if (error) return <p className="ci-err">{error}</p>;
    if (!app) return null;

    const metrics = [
        {
            key: 'status', label: 'Request status', value: request ? 'Requested' : 'Not sent',
            sub: request ? whenOf(request.requested_at) : 'The AO has not sent it yet', tone: request ? 'info' : 'warn',
        },
        { key: 'people', label: 'Borrowers to check', value: built.people.length, sub: 'Subject, spouse, co-borrowers', tone: 'plain' },
        {
            key: 'missing', label: 'Missing values', value: missing.length,
            sub: missing.length ? 'Required for the request' : 'Nothing missing', tone: missing.length ? 'warn' : 'ok',
        },
        { key: 'amount', label: 'Loan amount', value: peso(built.loanAmount) ?? '—', sub: built.loanType ?? 'Loan type not set', tone: 'plain' },
    ];

    return (
        <div className="lf fp">
            <header className="lf-card">
                <Link to="/adminHomePage" className="lf-back"><ArrowLeft size={16} aria-hidden="true" />Work tray</Link>
                <div className="lf-titlerow">
                    <div>
                        <h1>CI request {app.application_no}</h1>
                        <ul className="lf-meta">
                            <li>NFIS and TransUnion inquiry details</li>
                            {request && <li>Requested by {requesterName ?? 'Account Officer'}</li>}
                        </ul>
                    </div>
                    <div className="lf-actions">
                        <MessagesPanel applicationId={app.id} inline />
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

                {!request && (
                    <p className="lf-note">
                        <Info size={16} aria-hidden="true" />
                        <span>No CI request has been sent for this application yet.</span>
                    </p>
                )}
            </header>

            {missing.length > 0 && (
                <p className="ci-warn" role="note">
                    <Info size={16} aria-hidden="true" />
                    <span>
                        <b>{missing.length} required {missing.length === 1 ? 'value is' : 'values are'} missing.</b>{' '}
                        The request can't be accommodated with missing values. The Account Officer corrects them in the loan folder.
                    </span>
                </p>
            )}

            <CiRequestForms app={app} />

            {request && (
                <section className="lf-card" aria-label="Remarks">
                    <div className="lf-cardhead"><h2>Remarks</h2></div>
                    <div className="ci-cols">
                        <Remark title="NFIS remarks" text={request.nfis_remarks} />
                        <Remark title="TU remarks" text={request.tu_remarks} />
                    </div>
                </section>
            )}
        </div>
    );
};

export default CiRequestPage;
