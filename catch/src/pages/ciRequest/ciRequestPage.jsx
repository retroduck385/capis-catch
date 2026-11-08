// One CI request, opened from the Credit Investigator's work tray: the NFIS and TU request forms and the AO's
// remarks (view only), then the CI results: upload the reports, record results + summaries, Mark CI Done.
// Any active CI can work it while the application is in Credit Investigation; afterwards it's read-only.
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { fetchApplication } from '../applicationForm/api';
import { fetchStaffNames } from '../loanFolder/api';
import { fetchCiCanEdit, fetchCiRequests } from './api';
import CiRequestForms from './ciRequestForms';
import { CiResultsEditor, CiResultsView } from './ciResults';
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
    const [canEdit, setCanEdit] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Request + edit right change after Save / Mark CI Done; the application record doesn't
    const loadRequest = useCallback(async () => {
        const [requests, editable] = await Promise.all([fetchCiRequests(applicationId), fetchCiCanEdit(applicationId)]);
        const latest = requests.at(-1) ?? null;
        const names = latest ? await fetchStaffNames([latest.requested_by]) : {};
        return { latest, editable, requester: latest ? names[latest.requested_by] : null };
    }, [applicationId]);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const [data, r] = await Promise.all([fetchApplication(applicationId), loadRequest()]);
                if (cancelled) return;
                setApp(data);
                setRequest(r.latest);
                setRequesterName(r.requester);
                setCanEdit(r.editable);
            } catch (err) {
                if (!cancelled) setError(err.message);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        load();
        return () => { cancelled = true; };
    }, [applicationId, loadRequest]);

    const handleChanged = async () => {
        try {
            const r = await loadRequest();
            setRequest(r.latest);
            setCanEdit(r.editable);
        } catch (err) {
            setError(err.message);
        }
    };

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

            <details className="border p-3 my-3" open={canEdit}>
                <summary className="font-semibold cursor-pointer">NFIS & TU request forms (from the AO)</summary>
                <CiRequestForms app={app} />
                {request && (
                    <>
                        <Remarks title="NFIS remarks (from AO)" text={request.nfis_remarks} />
                        <Remarks title="TU remarks (from AO)" text={request.tu_remarks} />
                    </>
                )}
            </details>

            {request && (canEdit
                ? <CiResultsEditor app={app} ciRequest={request} onChanged={handleChanged} />
                : <CiResultsView app={app} />)}
        </div>
    );
};

export default CiRequestPage;
