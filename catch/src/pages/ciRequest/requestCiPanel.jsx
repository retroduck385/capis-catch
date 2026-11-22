// AO side of the CI request, inside the loan folder: preview of the NFIS / TU forms as the CI
// will see them, optional remarks, and the button that sends the application to Credit Investigation.
// Once sent, it shows the request; the forms stay live, so the AO's later KYC edits reach the CI too.
import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import Byline from '../../components/byline';
import { requestCi } from './api';
import { buildCiRequest, missingFields } from './buildRequest';
import CiRequestForms from './ciRequestForms';
import useIdDetails from './useIdDetails';
import { CiResultsView } from './ciResults';
import './ciRequest.css';
import { Term, Terms } from '../../components/term';
import { useTermTitle } from '../../components/useTermTitle';

// blockedNote: "Resolve the open clarification on Employment first." while a KYC question is open (sending waits;
// the database refuses the move too: 20261204_kyc_clarification_guard.sql)
const RequestCiPanel = ({ app, ciRequest, requesterName, verifiedCount, sectionCount, onRequested, blockedNote = null }) => {
    const tt = useTermTitle();
    const [nfisRemarks, setNfisRemarks] = useState('');
    const [tuRemarks, setTuRemarks] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const idDetails = useIdDetails(app);
    const missing = useMemo(() => missingFields(buildCiRequest(app, idDetails)), [app, idDetails]);

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
            <>
                <section className="lf-card">
                    <div className="lf-cardhead">
                        <h2>Request <Term k="CI" /> (<Term k="NFIS" /> & TransUnion)</h2>
                        <span className="lf-chip ok">Sent</span>
                    </div>
                    <p className="ci-note">
                        <span className="ci-sent">Sent by <Byline layout="inline" name={requesterName} fallback="Account Officer" at={ciRequest.requested_at} /></span>
                        You can still edit the <Term k="KYC" /> sections; the Credit Investigator sees the current values below.
                    </p>
                </section>
                {missing.length > 0 && (
                    <p className="ci-warn" role="note">
                        <AlertTriangle size={16} aria-hidden="true" />
                        <span><b>{missing.length} required {missing.length === 1 ? 'value is' : 'values are'} still missing.</b>{' '}
                            Fix {missing.length === 1 ? 'it' : 'them'} in the <Term k="KYC" /> sections so the request can be accommodated.</span>
                    </p>
                )}
                <CiRequestForms app={app} idDetails={idDetails} />
                <section className="lf-card" aria-label="Remarks">
                    <div className="lf-cardhead"><h2>Your remarks</h2></div>
                    <div className="ci-cols">
                        <div>
                            <div className="ci-remark-label"><Term k="NFIS" /> remarks</div>
                            <p className={`ci-remark${ciRequest.nfis_remarks ? '' : ' empty'}`}>{ciRequest.nfis_remarks || 'No remarks.'}</p>
                        </div>
                        <div>
                            <div className="ci-remark-label"><Term k="TU" /> remarks</div>
                            <p className={`ci-remark${ciRequest.tu_remarks ? '' : ' empty'}`}>{ciRequest.tu_remarks || 'No remarks.'}</p>
                        </div>
                    </div>
                </section>
                <section className="lf-card lf-ciresults" aria-labelledby="lf-ciresults-title">
                    <div className="lf-cardhead">
                        <h2 id="lf-ciresults-title"><Term k="CI" /> results</h2>
                        <span>From the Credit Investigator</span>
                    </div>
                    <CiResultsView app={app} title={null} />
                </section>
            </>
        );
    }

    return (
        <>
            <section className="lf-card">
                <div className="lf-cardhead">
                    <h2>Request <Term k="CI" /> (<Term k="NFIS" /> & TransUnion)</h2>
                    <span className="lf-chip warn">Not sent</span>
                </div>
                <p className="ci-note">
                    Filled in from the application. Fix any "Missing" value in its section before sending.
                    ID type, number and expiry come from the Valid IDs you confirm on the document check page.
                </p>
            </section>

            {(missing.length > 0 || verifiedCount < sectionCount) && (
                <p className="ci-warn" role="note">
                    <AlertTriangle size={16} aria-hidden="true" />
                    <span>
                        {missing.length > 0 && <><b>{missing.length} required {missing.length === 1 ? 'value is' : 'values are'} missing.</b>{' '}</>}
                        {verifiedCount < sectionCount && <Terms text={`${verifiedCount} of ${sectionCount} KYC sections are verified. `} />}
                        You can still send the request.
                    </span>
                </p>
            )}
            {missing.length === 0 && verifiedCount === sectionCount && (
                <p className="lf-note"><CheckCircle2 size={16} aria-hidden="true" /><span>Everything the forms need is filled in.</span></p>
            )}

            <CiRequestForms app={app} idDetails={idDetails} />

            <form onSubmit={handleSubmit} className="lf-card ci-send" aria-label="Send the CI request">
                <div className="lf-cardhead"><h2>Send to the Credit Investigator</h2></div>
                <label title={tt('NFIS')}>
                    <span>NFIS remarks <small>optional</small></span>
                    <textarea value={nfisRemarks} onChange={(e) => setNfisRemarks(e.target.value)} rows={3} />
                </label>
                <label title={tt('TU')}>
                    <span>TU remarks <small>optional</small></span>
                    <textarea value={tuRemarks} onChange={(e) => setTuRemarks(e.target.value)} rows={3} />
                </label>
                {blockedNote && <p className="ci-warn" role="note"><AlertTriangle size={16} aria-hidden="true" /><span>{blockedNote}</span></p>}
                <div className="ci-send-foot">
                    {error ? <p className="ci-err" role="alert">{error}</p> : <span />}
                    <button type="submit" title={tt('CI')} disabled={saving || Boolean(blockedNote)}>{saving ? 'Sending...' : 'Send CI request'}</button>
                </div>
            </form>
        </>
    );
};

export default RequestCiPanel;
