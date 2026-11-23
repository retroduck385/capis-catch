import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Eye, FileText, Paperclip, Send, Trash2, Upload } from 'lucide-react';
import { fileUrl, removeRequested, sendRequested, uploadRequested } from './api';
import { formatDay } from '../../components/people';
import { Terms } from '../../components/term';

// The applicant's document requests on one submitted application, shown in its "Documents" tab
// (applicationFormPage.jsx). An open request: the Account Officer's message, one card per document asked for (the
// wizard's .ap-doc look) with its files and a drop area, then "Send to my Account Officer". A sent request: the files,
// read only, while the Account Officer checks them. Styles: "Documents tab" in applicantPages.css.
// Same file rules as the form: JPG, PNG or PDF, up to 10 MB each.

const ACCEPT = 'image/jpeg,image/png,application/pdf';
const fileCount = (n) => `${n} file${n === 1 ? '' : 's'}`;
const when = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

// One document asked for: its files, and (while open) a drop area that is also a file picker
const RequestItem = ({ item, open, busy, onUpload, onRemove, onView }) => {
    const [over, setOver] = useState(false);
    const inputId = `dq-file-${item.id}`;
    const done = item.uploads.length >= item.min_files;
    const uploading = busy === `up-${item.id}`;

    const take = (list) => {
        const files = [...(list ?? [])];
        if (files.length) onUpload(item, files);
    };

    return (
        <li id={`dq-item-${item.id}`} className={`ap-doc ${done ? 'ok' : 'warn'}`}>
            <div className="ap-doc-head">
                <span className="ap-doc-icon" aria-hidden="true">{done ? <CheckCircle2 size={18} /> : <Paperclip size={18} />}</span>
                <div className="ap-doc-title">
                    <strong><Terms text={item.label} /></strong>
                    <p className="ap-doc-hint">For the {item.party}</p>
                </div>
                <span className={`ap-chip ${done ? 'ok' : 'warn'}`}>
                    {item.uploads.length} of {fileCount(item.min_files)}{done ? ' added' : ''}
                </span>
            </div>

            {item.uploads.length > 0 && (
                <ul className="ap-files" aria-label={`Files for ${item.label}`}>
                    {item.uploads.map((u) => (
                        <li key={u.document_id}>
                            <FileText size={16} aria-hidden="true" />
                            <span className="ap-file-name">
                                {u.original_file_name ?? u.file_name}
                                {u.uploaded_at && <span className="ap-earlier-note">Added {when(u.uploaded_at)}</span>}
                            </span>
                            <button type="button" className="ap-filebtn" onClick={() => onView(u.file_path)}>
                                <Eye size={15} aria-hidden="true" />View
                            </button>
                            {open && (
                                <button type="button" className="ap-filebtn quiet" disabled={busy !== null}
                                    aria-label={`Remove ${u.original_file_name ?? u.file_name}`} onClick={() => onRemove(u.document_id)}>
                                    <Trash2 size={15} aria-hidden="true" />{busy === `rm-${u.document_id}` ? 'Removing...' : 'Remove'}
                                </button>
                            )}
                        </li>
                    ))}
                </ul>
            )}

            {open && (
                <label htmlFor={inputId} className={`dq-drop${over ? ' over' : ''}${uploading ? ' busy' : ''}`}
                    onDragOver={(e) => { e.preventDefault(); if (busy === null) setOver(true); }}
                    onDragLeave={() => setOver(false)}
                    onDrop={(e) => { e.preventDefault(); setOver(false); if (busy === null) take(e.dataTransfer.files); }}>
                    <input id={inputId} className="dq-input" type="file" multiple accept={ACCEPT} disabled={busy !== null}
                        onChange={(e) => { const files = e.target.files; take(files); e.target.value = ''; }} />
                    <span className="dq-drop-icon" aria-hidden="true"><Upload size={18} /></span>
                    <span className="dq-drop-text">
                        {uploading ? <b role="status">Uploading...</b> : (
                            <>
                                <b>{item.uploads.length ? 'Add another file' : 'Choose files'}</b>
                                <span> or drag them here</span>
                                <span className="sr-only"> for {item.label}, {item.party}</span>
                            </>
                        )}
                    </span>
                </label>
            )}
        </li>
    );
};

const RequestCard = ({ req, onChanged }) => {
    const [busy, setBusy] = useState(null);
    const [error, setError] = useState(null);
    const [tried, setTried] = useState(false);   // "Send" was pressed while something was missing
    const errorRef = useRef(null);
    const open = req.status === 'OPEN';
    const total = req.items.length;
    const missing = req.items.filter((i) => i.uploads.length < i.min_files);
    const ready = total - missing.length;

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
    // Send stays pressable: with something missing it says what, and moves to the first missing document
    const send = () => {
        if (missing.length) {
            setTried(true);
            const first = document.getElementById(`dq-item-${missing[0].id}`);
            first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            document.getElementById(`dq-file-${missing[0].id}`)?.focus({ preventScroll: true });
            return;
        }
        run('send', () => sendRequested(req.id));
    };
    useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

    return (
        <section className={`ct-card dq-card ${open ? 'open' : 'sent'}`} aria-labelledby={`req-${req.id}`}>
            <header className="dq-head">
                <span className="dq-head-icon" aria-hidden="true">{open ? <Upload size={20} /> : <CheckCircle2 size={20} />}</span>
                <div className="dq-head-text">
                    <h2 id={`req-${req.id}`}>{open ? 'Documents needed' : 'Documents sent'}</h2>
                    <p>
                        {open
                            ? <>Asked by your Account Officer{req.opened_at && <> on <b>{formatDay(req.opened_at)}</b></>}</>
                            : <>Sent {req.sent_at && <>on <b>{when(req.sent_at)}</b></>}. Your Account Officer is checking them.</>}
                    </p>
                </div>
                <span className={`ap-chip ${open && missing.length ? 'warn' : 'ok'}`}>
                    {open ? `${ready} of ${total} ready` : 'Being checked'}
                </span>
            </header>

            <div className="dq-body">
                {open && (
                    <>
                        {req.message && (
                            <figure className="dq-msg">
                                <figcaption>Message from your Account Officer</figcaption>
                                <blockquote><p>{req.message}</p></blockquote>
                            </figure>
                        )}
                        <div className="dq-progress">
                            <div className="dq-meter" role="progressbar" aria-label="Documents ready"
                                aria-valuemin={0} aria-valuemax={total} aria-valuenow={ready}>
                                <span style={{ width: `${total ? (ready / total) * 100 : 0}%` }} />
                            </div>
                            <p className="dq-rules">Upload a clear scan or photo of each document, every page readable and nothing cut off.
                                JPG, PNG or PDF, up to 10 MB each.</p>
                        </div>
                    </>
                )}

                <ul className="ap-docs">
                    {req.items.map((item) => (
                        <RequestItem key={item.id} item={item} open={open} busy={busy} onView={view}
                            onUpload={(it, files) => run(`up-${it.id}`, async () => { for (const f of files) await uploadRequested(req, it, f); })}
                            onRemove={(docId) => run(`rm-${docId}`, () => removeRequested(docId))} />
                    ))}
                </ul>

                {error && <p className="ct-error dq-error" role="alert" tabIndex={-1} ref={errorRef}>{error}</p>}

                {open && (
                    <div className="dq-foot">
                        <p className={`dq-foot-note${tried && missing.length ? ' warn' : ''}`} aria-live="polite">
                            {missing.length
                                ? <>Still needed: {missing.map((i) => `${i.label} (${i.party})`).join('; ')}.</>
                                : <>Everything is ready. Send it to your Account Officer to check.</>}
                        </p>
                        <button type="button" className="ct-primary dq-send" disabled={busy !== null} onClick={send}>
                            <Send size={17} aria-hidden="true" />{busy === 'send' ? 'Sending...' : 'Send to my Account Officer'}
                        </button>
                    </div>
                )}
            </div>
        </section>
    );
};

// Every request on the application, open ones first
const ApplicantRequests = ({ requests, onChanged }) => (
    <div className="dq-list">
        {requests.map((r) => <RequestCard key={r.id} req={r} onChanged={onChanged} />)}
    </div>
);

export default ApplicantRequests;
