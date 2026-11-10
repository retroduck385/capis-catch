import { useCallback, useEffect, useState } from 'react';
import { fetchMyRequests, fileUrl, removeRequested, sendRequested, uploadRequested } from './api';

// The applicant's "Documents needed" card: the Account Officer's message and the documents asked for, an upload
// area for each (only these can be uploaded after submitting), and "Send to my Account Officer" once every document
// has its files. After sending: "Documents sent". Shown on the applicant home page (every application) and on one
// application's page (applicationId). Renders nothing when there is no open request.
// Same file rules as the form: JPG, PNG or PDF, up to 10 MB each.

const RequestCard = ({ req, onChanged }) => {
    const [busy, setBusy] = useState(null);
    const [error, setError] = useState(null);
    const open = req.status === 'OPEN';
    const missing = req.items.filter((i) => i.uploads.length < i.min_files);

    const run = async (key, fn) => {
        setBusy(key);
        setError(null);
        try {
            await fn();
            await onChanged();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(null);
        }
    };
    const view = async (path) => {
        try { window.open(await fileUrl(path), '_blank', 'noopener'); } catch (err) { setError(err.message); }
    };

    return (
        <section className='ct-card' aria-labelledby={`req-${req.id}`} style={{ marginBottom: '1rem' }}>
            <div className='ct-card-head'>
                <h2 id={`req-${req.id}`}>{open ? 'Documents needed' : 'Documents sent'}</h2>
                <span className='ct-mono ct-muted'>{req.application_no}</span>
            </div>
            <div className='ct-sheet-body'>
                {open ? (
                    <p><strong>What we need:</strong> {req.message}</p>
                ) : (
                    <p role='status'>You sent these on {new Date(req.sent_at).toLocaleString()}. Your Account Officer is checking them.</p>
                )}
                {open && <p className='ct-muted'>Upload a clear scan or photo of each document below. Accepted: JPG, PNG or PDF, up to 10 MB each.</p>}

                <ul style={{ listStyle: 'none', padding: 0 }}>
                    {req.items.map((item) => (
                        <li key={item.id} style={{ borderTop: '1px solid var(--line)', padding: '0.75rem 0' }}>
                            <p>
                                <strong>{item.label}</strong> ({item.party})
                                <span className='ct-muted'> · {item.uploads.length} of {item.min_files} file{item.min_files === 1 ? '' : 's'}</span>
                            </p>
                            {item.uploads.length > 0 && (
                                <ul>
                                    {item.uploads.map((u) => (
                                        <li key={u.document_id} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
                                            <span style={{ overflowWrap: 'anywhere' }}>{u.original_file_name ?? u.file_name}</span>
                                            <button type='button' onClick={() => view(u.file_path)}>View</button>
                                            {open && (
                                                <button type='button' disabled={busy !== null}
                                                    onClick={() => run(`rm-${u.document_id}`, () => removeRequested(u.document_id))}>
                                                    {busy === `rm-${u.document_id}` ? 'Removing...' : 'Remove'}
                                                </button>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            )}
                            {open && (
                                <label style={{ display: 'block', marginTop: '0.5rem' }}>
                                    <span className='ct-label'>Upload {item.label}</span>
                                    <input type='file' multiple accept='image/jpeg,image/png,application/pdf' disabled={busy !== null}
                                        onChange={(e) => {
                                            const files = [...e.target.files];
                                            e.target.value = '';
                                            if (files.length) {
                                                run(`up-${item.id}`, async () => { for (const f of files) await uploadRequested(req, item, f); });
                                            }
                                        }} />
                                    {busy === `up-${item.id}` && <span> Uploading...</span>}
                                </label>
                            )}
                        </li>
                    ))}
                </ul>

                {error && <p className='ct-error' role='alert'>{error}</p>}
                {open && (
                    <>
                        {missing.length > 0 && (
                            <p className='ct-muted'>Still needed: {missing.map((i) => `${i.label} (${i.party})`).join('; ')}.</p>
                        )}
                        <button type='button' className='ct-primary' disabled={busy !== null || missing.length > 0}
                            onClick={() => run('send', () => sendRequested(req.id))}>
                            {busy === 'send' ? 'Sending...' : 'Send to my Account Officer'}
                        </button>
                    </>
                )}
            </div>
        </section>
    );
};

const ApplicantRequestCard = ({ applicationId = null }) => {
    const [requests, setRequests] = useState([]);

    const load = useCallback(async () => {
        try {
            const rows = await fetchMyRequests();
            setRequests(applicationId ? rows.filter((r) => r.application_id === applicationId) : rows);
        } catch {
            setRequests([]);
        }
    }, [applicationId]);

    useEffect(() => {
        let cancelled = false;
        fetchMyRequests()
            .then((rows) => { if (!cancelled) setRequests(applicationId ? rows.filter((r) => r.application_id === applicationId) : rows); })
            .catch(() => { if (!cancelled) setRequests([]); });
        return () => { cancelled = true; };
    }, [applicationId]);

    return requests.map((r) => <RequestCard key={r.id} req={r} onChanged={load} />);
};

export default ApplicantRequestCard;
