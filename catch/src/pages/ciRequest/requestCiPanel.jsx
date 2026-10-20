// AO side of the CI request, inside the loan folder: preview of the NFIS / TU forms as the CI
// will see them, optional remarks, and the button that sends the application to Credit Investigation.
// Once sent, it shows the request; the forms stay live, so the AO's later KYC edits reach the CI too.
import { useState } from 'react';
import { requestCi } from './api';
import CiRequestForms from './ciRequestForms';

const RequestCiPanel = ({ app, ciRequest, requesterName, verifiedCount, sectionCount, onRequested }) => {
    const [nfisRemarks, setNfisRemarks] = useState('');
    const [tuRemarks, setTuRemarks] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!window.confirm('Send this application to the Credit Investigator? It moves to Credit Investigation. '
            + 'You can still edit the KYC sections afterwards.')) return;
        setSaving(true);
        try {
            setError(null);
            await requestCi(app.id, nfisRemarks, tuRemarks);
            await onRequested();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    if (ciRequest) {
        return (
            <div>
                <h2>Request CI (NFIS & TransUnion)</h2>
                <p>
                    Sent {new Date(ciRequest.requested_at).toLocaleString()} by {requesterName ?? 'Account Officer'}.
                    You can still edit the KYC sections; the Credit Investigator sees the current values below.
                </p>
                <CiRequestForms app={app} />
                <div className="border p-3 my-3 text-left">
                    <h3 className="font-semibold">NFIS remarks</h3>
                    <p className="whitespace-pre-wrap">{ciRequest.nfis_remarks || '—'}</p>
                    <h3 className="font-semibold pt-2">TU remarks</h3>
                    <p className="whitespace-pre-wrap">{ciRequest.tu_remarks || '—'}</p>
                </div>
            </div>
        );
    }

    return (
        <div>
            <h2>Request CI (NFIS & TransUnion)</h2>
            <p>
                Filled in from the application. Fix any "Missing" value in its section before sending.
                ID type, number and expiry follow once ID reading is set up.
            </p>
            {verifiedCount < sectionCount && (
                <p className="text-amber-700">
                    Note: {verifiedCount} of {sectionCount} KYC sections are verified. You can still send the request.
                </p>
            )}

            <CiRequestForms app={app} />

            <form onSubmit={handleSubmit} className="text-left">
                <label className="block py-1">
                    <span className="font-semibold">NFIS remarks (optional)</span>
                    <textarea value={nfisRemarks} onChange={(e) => setNfisRemarks(e.target.value)}
                        rows={3} className="border block w-full px-2" />
                </label>
                <label className="block py-1">
                    <span className="font-semibold">TU remarks (optional)</span>
                    <textarea value={tuRemarks} onChange={(e) => setTuRemarks(e.target.value)}
                        rows={3} className="border block w-full px-2" />
                </label>
                {error && <p className="text-red-600">{error}</p>}
                <button type="submit" disabled={saving} className="border px-4 py-2 mt-2">
                    {saving ? 'Sending...' : 'Send CI request'}
                </button>
            </form>
        </div>
    );
};

export default RequestCiPanel;
