import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
    AlertTriangle, Bell, CheckCircle2, ChevronDown, Clock, FileText, History, Mail, MailQuestion, Plus, RefreshCw, Send, Smartphone, Undo2, X,
} from 'lucide-react';
import { smsSegments } from '../applicantNotices/sms';
import { closeRequest, fetchRequestContext, fileUrl, openRequest, previewRequest } from './api';
import { refreshCanAsk } from './askStore';
import FileMark from './fileMark';
import { useFileMarks } from './useFileMarks';
import { Terms } from '../../components/term';
import Byline from '../../components/byline';
import { formatDay, fullWhen } from '../../components/people';
import SelectMenu from '../../components/selectMenu';
import './requestPanel.css';

// "Ask the applicant for documents" (the deferral loop): the assigned Account Officer sends a short message plus the
// specific documents needed, in-app, by SMS and by email (no links). The applicant uploads them and sends them back;
// the AO checks them (they go through OCR and the AI document check like any upload) and closes the request.
// Everyone who can open the file sees the current request read-only.
// A disclosure card in the staff look (DESIGN.md, "Ask the applicant"), closed by default so it doesn't push the loan
// folder down; the summary row shows where the current request stands. It opens by itself when the applicant has sent
// documents back to check, or when an "Ask the applicant" button prefilled it. Styles: requestPanel.css (--lf-* tokens,
// so it follows dark mode).

const STATUS_TEXT = {
    OPEN: 'Waiting for the applicant',
    SENT: 'The applicant sent the documents back. Check them, then close the request.',
};
// [label, chip tone]
const CLOSED = { RECEIVED: ['Received', 'ok'], WITHDRAWN: ['Withdrawn', 'none'] };
const DELIVERY = {
    QUEUED: ['Queued', 'none'], RUNNING: ['Sending', 'info'], LOGGED: ['Logged (test mode, not sent)', 'info'],
    SENT: ['Sent', 'ok'], FAILED: ['Failed', 'err'], SKIPPED: ['Skipped', 'none'],
};

const keyOf = (r) => `${r.applicant_id}:${r.requirement_type}`;

// marks: useFileMarks() of the application (staff check of each uploaded file)
// past: an earlier request, so each file's staff check starts closed
const Uploads = ({ item, onView, applicationId, marks, past }) => (
    item.uploads.length === 0 ? <p className="dr-none">Nothing uploaded yet</p> : (
        <ul className="dr-files">
            {item.uploads.map((u) => (
                <li key={u.document_id}>
                    <div className="dr-file">
                        <button type="button" className="dr-file-btn" onClick={() => onView(u.file_path)}>
                            <FileText size={15} aria-hidden="true" />{u.file_name}
                        </button>
                        <Byline layout="inline" name="Applicant" at={u.uploaded_at} className="dr-file-at" />
                    </div>
                    {marks && (
                        <FileMark applicationId={applicationId} marks={marks} autoOpen={!past}
                            file={{ documentId: u.document_id, applicantId: item.applicant_id, requirementType: item.requirement_type, label: item.label }} />
                    )}
                </li>
            ))}
        </ul>
    )
);

const RequestView = ({ req, onView, marks, past = false }) => (
    <>
        <p className="dr-quote">{req.message}</p>
        <ul className="dr-items">
            {req.items.map((i) => (
                <li key={i.id} className="dr-item">
                    <div className="dr-item-head">
                        <b>{i.label}</b> <span className="dr-party">{i.party}</span>
                        <span className={`dr-count ${i.uploads.length >= i.min_files ? 'all' : 'short'}`}>
                            {i.uploads.length} / {i.min_files}<span className="sr-only"> files uploaded</span>
                        </span>
                    </div>
                    <Uploads item={i} onView={onView} applicationId={req.application_id} marks={marks} past={past} />
                </li>
            ))}
        </ul>
        {req.deliveries?.length > 0 && (
            <ul className="dr-chips" aria-label="Delivery">
                {req.deliveries.map((d) => {
                    const [label, tone] = DELIVERY[d.status] ?? [d.status, 'none'];
                    const Icon = d.channel === 'SMS' ? Smartphone : Mail;
                    return (
                        <li key={d.channel} className={`dr-chip ${tone}`} title={d.error || undefined}>
                            <Icon size={13} aria-hidden="true" />
                            {d.channel === 'SMS' ? 'SMS' : 'Email'}{d.to ? ` ${d.to}` : ''}: {label}
                            {d.error && <span className="sr-only"> ({d.error})</span>}
                        </li>
                    );
                })}
            </ul>
        )}
    </>
);

// reloadKey: the loan folder passes its KYC checks, so a new check reloads the suggestions
const RequestPanel = ({ applicationId, reloadKey }) => {
    const [ctx, setCtx] = useState(null);
    const [message, setMessage] = useState('');
    const [picked, setPicked] = useState(null);        // Set of "applicant_id:requirement_type"; null = not initialised
    const [others, setOthers] = useState([]);          // [{ applicant_id, label }]
    const [preview, setPreview] = useState(null);
    const [confirming, setConfirming] = useState(false);
    const [closing, setClosing] = useState(false);
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState(null);
    const [error, setError] = useState(null);
    const [expanded, setExpanded] = useState(null);    // null = not toggled yet: open only if documents came back
    const [askSeen, setAskSeen] = useState(null);       // the "Ask the applicant" click already put into the box
    const marks = useFileMarks(applicationId);
    const boxRef = useRef(null);
    // Set by an "Ask the applicant" button (ask.jsx): documents to tick and a note to prefill
    const ask = useLocation().state?.ask ?? null;

    const load = useCallback(() => {
        refreshCanAsk(applicationId);
        return fetchRequestContext(applicationId).then(setCtx, () => setCtx(null));
    }, [applicationId]);
    useEffect(() => {
        let cancelled = false;
        fetchRequestContext(applicationId)
            .then((c) => { if (!cancelled) setCtx(c); })
            .catch(() => { if (!cancelled) setCtx(null); });
        return () => { cancelled = true; };
    }, [applicationId, reloadKey]);

    const checklist = useMemo(() => ctx?.suggestions?.checklist ?? [], [ctx]);
    // Missing documents start ticked
    const selected = useMemo(
        () => picked ?? new Set(checklist.filter((r) => r.uploaded < r.needed).map(keyOf)),
        [picked, checklist]);
    const items = useMemo(() => [
        ...checklist.filter((r) => selected.has(keyOf(r))).map((r) => ({ applicant_id: r.applicant_id, requirement_type: r.requirement_type })),
        ...others.map((o) => ({ applicant_id: o.applicant_id, requirement_type: null, label: o.label })),
    ], [checklist, selected, others]);

    const formVisible = Boolean(ctx?.can_open);

    // An "Ask the applicant" click: open the dropdown, tick its documents and prefill the note, once (state adjusted
    // while rendering). Nothing is sent: the AO reviews the box and clicks Send request.
    if (ask && formVisible && ask.at !== askSeen) {
        setAskSeen(ask.at);
        const onList = (i) => i.requirement_type && checklist.some((r) => keyOf(r) === keyOf(i));
        const wanted = ask.items?.length ? ask.items
            : checklist.filter((r) => r.uploaded < r.needed && (ask.missingFor == null || r.applicant_id === ask.missingFor));
        setPicked(new Set(wanted.filter(onList).map(keyOf)));
        setOthers(wanted.filter((i) => !onList(i) && i.label).map((i) => ({ applicant_id: i.applicant_id, label: String(i.label).slice(0, 80) })));
        setMessage((ask.note ?? '').slice(0, ctx.max_length));
        setConfirming(false);
        setDone(null);
        setExpanded(true);
    }
    // ...then bring the box into view
    useEffect(() => {
        if (!askSeen) return;
        boxRef.current?.scrollIntoView({ block: 'start' });
        boxRef.current?.querySelector('textarea')?.focus({ preventScroll: true });
    }, [askSeen]);

    useEffect(() => {
        if (!formVisible) return;
        let cancelled = false;
        const timer = setTimeout(() => {
            previewRequest(applicationId, message, items)
                .then((p) => { if (!cancelled) setPreview(p); })
                .catch((err) => { if (!cancelled) setError(err.message); });
        }, 300);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [formVisible, applicationId, message, items]);

    if (!ctx || (!ctx.current && ctx.history.length === 0 && !ctx.is_assigned_ao)) return null;

    const view = async (path) => {
        try { window.open(await fileUrl(path), '_blank', 'noopener'); } catch (err) { setError(err.message); }
    };
    const toggle = (r) => {
        const next = new Set(selected);
        if (next.has(keyOf(r))) next.delete(keyOf(r)); else next.add(keyOf(r));
        setPicked(next);
    };

    const send = async () => {
        setBusy(true);
        setError(null);
        try {
            await openRequest(applicationId, message, items);
            setMessage(''); setPicked(null); setOthers([]); setConfirming(false); setDone('Request sent to the applicant.');
            await load();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    // askAgain: keep the same documents ticked for the next request
    const close = async (askAgain) => {
        setBusy(true);
        setError(null);
        try {
            const cur = ctx.current;
            const as = await closeRequest(cur.id, note);
            setNote(''); setClosing(false);
            setDone(as === 'RECEIVED' ? 'Request closed. The applicant was told the documents were received.' : 'Request withdrawn.');
            if (askAgain) {
                setPicked(new Set(cur.items.filter((i) => i.requirement_type).map(keyOf)));
                setOthers(cur.items.filter((i) => !i.requirement_type).map((i) => ({ applicant_id: i.applicant_id, label: i.label })));
            }
            await load();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    const cur = ctx.current;
    const problem = preview?.problem;
    const parties = ctx.suggestions?.parties ?? [];
    const partyOptions = parties.map((p) => ({ value: String(p.applicant_id), label: p.party }));
    const open = expanded ?? cur?.status === 'SENT';

    return (
        <details ref={boxRef} open={open} onToggle={(e) => setExpanded(e.currentTarget.open)} className="dr">
            <summary className="dr-head">
                <span className="dr-ic" aria-hidden="true"><MailQuestion size={18} /></span>
                <h3>Ask the applicant for documents</h3>
                {cur && (cur.status === 'SENT'
                    ? <span className="dr-chip warn"><AlertTriangle size={13} aria-hidden="true" />Documents back: check them</span>
                    : <span className="dr-chip info"><Clock size={13} aria-hidden="true" />Waiting for the applicant</span>)}
                {ctx.history.length > 0 && <span className="dr-chip none">{ctx.history.length} earlier</span>}
                <ChevronDown size={20} className="dr-chev" aria-hidden="true" />
            </summary>

            <div className="dr-body">
                {done && <p role="status" className="dr-strip ok"><CheckCircle2 size={16} aria-hidden="true" /><span>{done}</span></p>}
                {error && <p role="alert" className="dr-err">{error}</p>}

                {cur && (
                    <section className={`dr-current${cur.status === 'SENT' ? ' back' : ''}`} aria-label="Current request">
                        <div className="dr-current-head">
                            <p className="dr-current-title">{STATUS_TEXT[cur.status]}</p>
                            <button type="button" className="dr-icon-btn" onClick={load} aria-label="Refresh the request" title="Refresh">
                                <RefreshCw size={16} aria-hidden="true" />
                            </button>
                        </div>
                        <div className="dr-bylines">
                            <span className="dr-by">Sent by <Byline layout="inline" name={cur.opened_by} fallback="Account Officer" at={cur.opened_at} /></span>
                            {cur.sent_at && <span className="dr-by">Sent back <Byline layout="inline" name="Applicant" at={cur.sent_at} /></span>}
                        </div>
                        <RequestView req={cur} onView={view} marks={marks} />

                        {ctx.is_assigned_ao && (!closing ? (
                            <div className="dr-acts">
                                {cur.status === 'SENT'
                                    ? <button type="button" className="dr-primary" onClick={() => setClosing(true)}><CheckCircle2 size={16} aria-hidden="true" />Close: documents received</button>
                                    : <button type="button" className="dr-btn" onClick={() => setClosing(true)}><X size={16} aria-hidden="true" />Withdraw request</button>}
                            </div>
                        ) : (
                            <div role="alertdialog" aria-labelledby="doc-close-confirm" className="dr-confirm">
                                <p id="doc-close-confirm" className="dr-confirm-title">
                                    {cur.status === 'SENT'
                                        ? 'Close this request? The applicant is told in the app that the documents were received.'
                                        : 'Withdraw this request? The applicant is told in the app that no documents are needed for now.'}
                                </p>
                                <label htmlFor="doc-close-note" className="dr-label">Note for the file <small>(optional, staff only)</small></label>
                                <input id="doc-close-note" className="dr-input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
                                <div className="dr-acts">
                                    <button type="button" className="dr-primary" disabled={busy} onClick={() => close(false)}>{busy ? 'Closing...' : 'Yes, close'}</button>
                                    {cur.status === 'SENT' && (
                                        <button type="button" className="dr-btn" disabled={busy} onClick={() => close(true)}>Close and ask again</button>
                                    )}
                                    <button type="button" className="dr-btn quiet" disabled={busy} onClick={() => setClosing(false)}>Cancel</button>
                                </div>
                            </div>
                        ))}
                    </section>
                )}

                {!cur && ctx.is_assigned_ao && !ctx.can_open && <p className="dr-note">{ctx.why_not}</p>}

                {ctx.can_open && (
                    <section className="dr-form" aria-label="New request">
                        {askSeen && ask?.at === askSeen && (
                            <p role="status" className="dr-strip info">
                                <MailQuestion size={16} aria-hidden="true" />
                                <span>Prefilled from {ask.from ?? 'the item you picked'}. Check the documents and rewrite the note for the
                                    applicant, then click Send request. Nothing has been sent yet.</span>
                            </p>
                        )}

                        {/* where it goes: three channels, any that can't be used say so */}
                        <div className="dr-channels">
                            <span className="dr-channels-label">Goes to the applicant by</span>
                            <ul className="dr-chips">
                                <li className="dr-chip ok"><Bell size={13} aria-hidden="true" />In the app</li>
                                <li className={`dr-chip ${ctx.sms_to ? 'ok' : 'warn'}`}>
                                    <Smartphone size={13} aria-hidden="true" />{ctx.sms_to ? `SMS to ${ctx.sms_to}` : 'SMS skipped: no valid mobile number'}
                                </li>
                                <li className={`dr-chip ${ctx.email_to ? 'ok' : 'warn'}`}>
                                    <Mail size={13} aria-hidden="true" />{ctx.email_to ? `Email to ${ctx.email_to}` : 'Email skipped: no valid address'}
                                </li>
                            </ul>
                            <p className="dr-muted">No links are allowed. The applicant can upload only the documents you pick.</p>
                        </div>

                        {ctx.suggestions.texts.length > 0 && (
                            <div className="dr-group">
                                <h4 className="dr-h">Why the file is deferred <small>internal: rewrite it for the applicant</small></h4>
                                <ul className="dr-suggestions">
                                    {ctx.suggestions.texts.map((s, i) => (
                                        <li key={i} className="dr-suggestion">
                                            <span className="dr-suggestion-txt">
                                                <span className="dr-source"><Terms text={s.source} /></span>
                                                <span>{s.text}</span>
                                            </span>
                                            <button type="button" className="dr-btn small" onClick={() => setMessage(s.text.slice(0, ctx.max_length))}>Use this</button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        <fieldset className="dr-group">
                            <legend className="dr-h">Documents needed</legend>
                            {checklist.length === 0 && <p className="dr-muted">No checklist documents on this file. Add an &quot;Other&quot; document below.</p>}
                            <ul className="dr-picks">
                                {checklist.map((r) => {
                                    const short = r.uploaded < r.needed;
                                    return (
                                        <li key={keyOf(r)}>
                                            <label className="dr-pick">
                                                <input type="checkbox" checked={selected.has(keyOf(r))} onChange={() => toggle(r)} />
                                                <span className="dr-pick-txt"><b>{r.label}</b><span className="dr-party">{r.party}</span></span>
                                                <span className={`dr-count${short ? ' short' : ' all'}`}>{r.uploaded} / {r.needed}<span className="sr-only"> uploaded</span></span>
                                            </label>
                                        </li>
                                    );
                                })}
                            </ul>
                            {others.map((o, i) => (
                                <div key={i} className="dr-other">
                                    <div className="dr-other-who">
                                        <SelectMenu id={`dr-other-${i}`} aria-label="Whose document" value={String(o.applicant_id)} options={partyOptions}
                                            placeholder="Whose document"
                                            onChange={(v) => setOthers(others.map((x, j) => (j === i ? { ...x, applicant_id: Number(v) } : x)))} />
                                    </div>
                                    <input aria-label="Document name" placeholder="e.g. Proof of billing" maxLength={80} value={o.label} className="dr-input"
                                        onChange={(e) => setOthers(others.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                                    <button type="button" className="dr-btn quiet" onClick={() => setOthers(others.filter((_, j) => j !== i))}>Remove</button>
                                </div>
                            ))}
                            {parties.length > 0 && (
                                <button type="button" className="dr-add" onClick={() => setOthers([...others, { applicant_id: parties[0].applicant_id, label: '' }])}>
                                    <Plus size={15} aria-hidden="true" />Add another document
                                </button>
                            )}
                        </fieldset>

                        <div className="dr-group">
                            <label htmlFor="doc-request-message" className="dr-h">What we need</label>
                            <p id="doc-request-hint" className="dr-muted">Plain words for the applicant. The documents are listed after it.</p>
                            <textarea id="doc-request-message" className="dr-input" value={message} maxLength={ctx.max_length} rows={3}
                                onChange={(e) => setMessage(e.target.value)} aria-describedby="doc-request-hint doc-request-count"
                                aria-invalid={Boolean(problem && message.trim())} />
                            <p id="doc-request-count" className="dr-counter">{message.length} / {ctx.max_length}</p>
                            {problem && message.trim() && <p role="alert" className="dr-err">{problem}</p>}
                        </div>

                        {preview && !problem && (
                            <div className="dr-group">
                                <h4 className="dr-h">What the applicant will receive</h4>
                                <div className="dr-preview">
                                    <article className="dr-msg">
                                        <p className="dr-msg-head"><Bell size={14} aria-hidden="true" />In the app</p>
                                        <p className="dr-msg-title">{preview.in_app_title}</p>
                                        <p>{preview.in_app_body}</p>
                                    </article>
                                    <article className="dr-msg">
                                        <p className="dr-msg-head"><Smartphone size={14} aria-hidden="true" />SMS
                                            <span className="dr-msg-meta">{preview.sms_text.length} characters · {smsSegments(preview.sms_text)} SMS</span></p>
                                        <p className="dr-pre">{preview.sms_text}</p>
                                    </article>
                                    <article className="dr-msg">
                                        <p className="dr-msg-head"><Mail size={14} aria-hidden="true" />Email</p>
                                        <p className="dr-msg-title">{preview.email_subject}</p>
                                        <p className="dr-pre">{preview.email_body}</p>
                                    </article>
                                </div>
                            </div>
                        )}

                        {!confirming ? (
                            <div className="dr-acts">
                                <button type="button" className="dr-primary" disabled={busy || !preview || Boolean(problem)} onClick={() => setConfirming(true)}>
                                    <Send size={16} aria-hidden="true" />Send request
                                </button>
                            </div>
                        ) : (
                            <div role="alertdialog" aria-labelledby="doc-send-confirm" className="dr-confirm">
                                <p id="doc-send-confirm" className="dr-confirm-title">Send this request to the applicant now? It can&apos;t be edited; you can withdraw it.</p>
                                <div className="dr-acts">
                                    <button type="button" className="dr-primary" disabled={busy} onClick={send}><Send size={16} aria-hidden="true" />{busy ? 'Sending...' : 'Yes, send'}</button>
                                    <button type="button" className="dr-btn quiet" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
                                </div>
                            </div>
                        )}
                    </section>
                )}

                {ctx.history.length > 0 && (
                    // closed by default: the form above is the main job; open it to look back
                    <details className="dr-history">
                        <summary className="dr-history-head">
                            <span className="dr-ic small" aria-hidden="true"><History size={16} /></span>
                            <h4>Earlier requests</h4>
                            <span className="dr-chip none">{ctx.history.length}<span className="sr-only"> closed</span></span>
                            <ChevronDown size={18} className="dr-chev" aria-hidden="true" />
                            <span className="dr-history-hint">Closed, newest first. Open one to see what was asked and sent.</span>
                        </summary>
                        <ol className="dr-past-list">
                            {ctx.history.map((r) => {
                                const [label, tone] = CLOSED[r.closed_as] ?? [r.closed_as, 'none'];
                                const Icon = r.closed_as === 'RECEIVED' ? CheckCircle2 : Undo2;
                                const files = r.items.reduce((n, i) => n + i.uploads.length, 0);
                                return (
                                    <li key={r.id} className={`dr-past ${tone}`}>
                                        <details>
                                            <summary className="dr-past-head">
                                                <span className="dr-past-ic" aria-hidden="true"><Icon size={17} /></span>
                                                <span className="dr-past-main">
                                                    <b className="dr-past-title">{r.items.map((i) => i.label).join(', ') || 'Documents'}</b>
                                                    <span className="dr-past-facts">
                                                        <span>Sent <time dateTime={r.opened_at} title={fullWhen(r.opened_at)}>{formatDay(r.opened_at)}</time></span>
                                                        {r.closed_at && <span>Closed <time dateTime={r.closed_at} title={fullWhen(r.closed_at)}>{formatDay(r.closed_at)}</time></span>}
                                                        <span>{files === 1 ? '1 file' : `${files} files`}</span>
                                                    </span>
                                                </span>
                                                <span className={`dr-chip ${tone}`}>{label}</span>
                                                <ChevronDown size={18} className="dr-chev" aria-hidden="true" />
                                            </summary>
                                            <div className="dr-past-body">
                                                <div className="dr-bylines">
                                                    <span className="dr-by">Sent by <Byline layout="inline" name={r.opened_by} fallback="Account Officer" at={r.opened_at} /></span>
                                                    <span className="dr-by">{r.closed_as === 'WITHDRAWN' ? 'Withdrawn by' : 'Closed by'} <Byline layout="inline" name={r.closed_by} fallback="Account Officer" at={r.closed_at} /></span>
                                                </div>
                                                {r.close_note && <p className="dr-past-note"><b>Note for the file</b> {r.close_note}</p>}
                                                <RequestView req={r} onView={view} marks={marks} past />
                                            </div>
                                        </details>
                                    </li>
                                );
                            })}
                        </ol>
                    </details>
                )}
            </div>
        </details>
    );
};

export default RequestPanel;
