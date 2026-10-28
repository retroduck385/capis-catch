// One CI request, opened from the Credit Investigator's work tray: the NFIS and TU forms plus the AO's remarks. View only for now.
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { fetchApplication } from '../applicationForm/api';
import { fetchStaffNames } from '../loanFolder/api';
import { fetchCiRequests } from './api';
import CiRequestForms from './ciRequestForms';
import MessagesPanel from '../messages/messagesPanel';

const Remarks = ({ title, text }) => (
    <div className="border p-3 my-3 text-left">
        <h3 className="font-semibold">{title}</h3>
        <p className="whitespace-pre-wrap">{text || '—'}</p>
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

    if (loading) return <p>Loading CI request...</p>;
    if (error) return <p className="text-red-600">{error}</p>;
    if (!app) return null;

    return (
        <div className="max-w-5xl m-auto p-4 text-left">
            <MessagesPanel applicationId={app.id} />
            <p><Link to="/adminHomePage" className="underline">Back to work tray</Link></p>
            <h2>CI request: {app.application_no}</h2>
            {request ? (
                <p>Requested {new Date(request.requested_at).toLocaleString()} by {requesterName ?? 'Account Officer'}</p>
            ) : (
                <p className="italic">No CI request has been sent for this application yet.</p>
            )}
            <CiRequestForms app={app} />
            {request && (
                <>
                    <Remarks title="NFIS remarks (from AO)" text={request.nfis_remarks} />
                    <Remarks title="TU remarks (from AO)" text={request.tu_remarks} />
                </>
            )}
        </div>
    );
};

export default CiRequestPage;
