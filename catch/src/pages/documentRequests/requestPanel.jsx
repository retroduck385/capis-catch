import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { smsSegments } from '../applicantNotices/sms';
import { closeRequest, fetchRequestContext, fileUrl, openRequest, previewRequest } from './api';
import { refreshCanAsk } from './askStore';
import FileMark from './fileMark';
import { useFileMarks } from './useFileMarks';
import { Terms } from '../../components/term';

// "Ask the applicant for documents" (the deferral loop): the assigned Account Officer sends a short message plus the
// specific documents needed, in-app, by SMS and by email (no links). The applicant uploads them and sends them back;
// the AO checks them (they go through OCR and the AI document check like any upload) and closes the request.
// Everyone who can open the file sees the current request read-only. Light colours with an explicit text colour on
// every element: index.css turns headings and body text light in OS dark mode.
// A dropdown (native <details>), closed by default so it doesn't push the loan folder down; the header line shows
// where the current request stands. It opens by itself when the applicant has sent documents back to check.

const STATUS_TEXT = {
    OPEN: 'Waiting for the applicant',
    SENT: 'The applicant sent the documents: check them, then close the request',
};
const CLOSED_TEXT = { RECEIVED: 'Received', WITHDRAWN: 'Withdrawn' };
const DELIVERY_LABELS = {
    QUEUED: 'Queued', RUNNING: 'Sending', LOGGED: 'Logged (test mode, not sent)', SENT: 'Sent', FAILED: 'Failed', SKIPPED: 'Skipped',
};
const BTN = 'rounded bg-blue-800 px-4 py-2 text-white hover:bg-blue-900 disabled:bg-gray-300 disabled:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2';
const BTN_LIGHT = 'rounded border border-gray-400 bg-white px-3 py-1 text-gray-900 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600';
const INPUT = 'rounded border border-gray-400 bg-white p-2 text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600';

const keyOf = (r) => `${r.applicant_id}:${r.requirement_type}`;
const when = (t) => (t ? new Date(t).toLocaleString() : '');

// marks: useFileMarks() of the application (staff check of each uploaded file)
const Uploads = ({ item, onView, applicationId, marks }) => (
    item.uploads.length === 0 ? <span className='text-gray-700'> · nothing uploaded yet</span> : (
        <ul className='ml-4 list-disc'>
            {item.uploads.map((u) => (
                <li key={u.document_id} className='text-gray-900'>
                    <button type='button' onClick={() => onView(u.file_path)}
                        className='text-blue-800 underline hover:text-blue-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600'>
                        {u.file_name}
                    </button>
                    <span className='text-sm text-gray-700'> · {when(u.uploaded_at)}</span>
                    {marks && (
                        <FileMark applicationId={applicationId} marks={marks} className='my-1'
                            file={{ documentId: u.document_id, applicantId: item.applicant_id, requirementType: item.requirement_type, label: item.label }} />
                    )}
                </li>
            ))}
        </ul>
    )
);

const RequestView = ({ req, onView, marks }) => (
    <>
        <p className='whitespace-pre-wrap break-words text-gray-900'><span className='font-semibold'>Message:</span> {req.message}</p>
        <ul className='mt-1'>
            {req.items.map((i) => (
                <li key={i.id} className='py-1 text-gray-900'>
                    <span className='font-semibold'>{i.label}</span> ({i.party})
                    <span className='text-sm text-gray-700'> · {i.uploads.length} of {i.min_files} file{i.min_files === 1 ? '' : 's'}</span>
                    <Uploads item={i} onView={onView} applicationId={req.application_id} marks={marks} />
                </li>
            ))}
        </ul>
        {req.deliveries?.length > 0 && (
            <ul className='mt-1 flex flex-wrap gap-2'>
                {req.deliveries.map((d) => (
                    <li key={d.channel} className={`rounded border px-2 text-sm ${d.status === 'FAILED' ? 'border-red-400 bg-red-50 text-red-900' : 'border-gray-400 bg-white text-gray-900'}`}>
                        {d.channel === 'SMS' ? 'SMS' : 'Email'}{d.to ? ` ${d.to}` : ''}: {DELIVERY_LABELS[d.status] ?? d.status}
                        {d.error ? ` (${d.error})` : ''}
                    </li>
                ))}
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

    return (
        <details ref={boxRef} open={expanded ?? cur?.status === 'SENT'} onToggle={(e) => setExpanded(e.currentTarget.open)}
            className='group my-3 scroll-mt-20 rounded-lg border border-gray-300 bg-white text-left text-gray-900'>
            <summary className='flex min-h-12 cursor-pointer list-none items-center gap-3 rounded-lg px-4 py-3 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 [&::-webkit-details-marker]:hidden'>
                <h3 className='text-lg font-semibold text-gray-900'>Ask the applicant for documents</h3>
                {cur && ' '}
                {cur && (
                    <span className={`whitespace-nowrap rounded-full border px-2.5 py-0.5 text-sm font-semibold ${cur.status === 'SENT'
                        ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-gray-300 bg-gray-50 text-gray-800'}`}>
                        {cur.status === 'SENT' ? 'Documents sent back: check them' : 'Waiting for the applicant'}
                    </span>
                )}
                {ctx.history.length > 0 && (
                    <>{' '}<span className='hidden text-sm text-gray-700 sm:inline'><span aria-hidden='true'>· </span>{ctx.history.length} earlier</span></>
                )}
                <ChevronDown size={20} aria-hidden='true' className='ml-auto shrink-0 text-gray-700 transition-transform group-open:rotate-180 motion-reduce:transition-none' />
            </summary>
            <div className='px-4 pb-4'>
            {done && <p role='status' className='mt-1 font-semibold text-green-800'>{done}</p>}
            {error && <p role='alert' className='mt-1 text-red-800'>{error}</p>}

            {cur && (
                <div className={`mt-2 rounded border p-3 ${cur.status === 'SENT' ? 'border-amber-300 bg-amber-50' : 'border-gray-300 bg-gray-50'}`}>
                    <div className='flex flex-wrap items-center justify-between gap-2'>
                        <p className='font-semibold text-gray-900'>{STATUS_TEXT[cur.status]}</p>
                        <button type='button' onClick={load} className='text-blue-800 underline hover:text-blue-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600'>Refresh</button>
                    </div>
                    <p className='text-sm text-gray-700'>
                        Sent {when(cur.opened_at)} by {cur.opened_by ?? 'Account Officer'}{cur.sent_at ? ` · applicant sent the documents ${when(cur.sent_at)}` : ''}
                    </p>
                    <RequestView req={cur} onView={view} marks={marks} />

                    {ctx.is_assigned_ao && (!closing ? (
                        <div className='mt-3 flex flex-wrap gap-2'>
                            <button type='button' className={BTN} onClick={() => setClosing(true)}>
                                {cur.status === 'SENT' ? 'Close: documents received' : 'Withdraw request'}
                            </button>
                        </div>
                    ) : (
                        <div role='alertdialog' aria-labelledby='doc-close-confirm' className='mt-3 rounded border border-gray-300 bg-white p-3 text-gray-900'>
                            <p id='doc-close-confirm' className='font-semibold text-gray-900'>
                                {cur.status === 'SENT'
                                    ? 'Close this request? The applicant is told in the app that the documents were received.'
                                    : 'Withdraw this request? The applicant is told in the app that no documents are needed for now.'}
                            </p>
                            <label htmlFor='doc-close-note' className='mt-2 block text-sm font-semibold text-gray-900'>Note for the file (optional, staff only)</label>
                            <input id='doc-close-note' value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} className={`${INPUT} w-full`} />
                            <div className='mt-2 flex flex-wrap gap-2'>
                                <button type='button' className={BTN} disabled={busy} onClick={() => close(false)}>{busy ? 'Closing...' : 'Yes, close'}</button>
                                {cur.status === 'SENT' && (
                                    <button type='button' className={BTN_LIGHT} disabled={busy} onClick={() => close(true)}>Close and ask again</button>
                                )}
                                <button type='button' className={BTN_LIGHT} disabled={busy} onClick={() => setClosing(false)}>Cancel</button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {!cur && ctx.is_assigned_ao && !ctx.can_open && <p className='mt-1 text-gray-800'>{ctx.why_not}</p>}

            {ctx.can_open && (
                <div className='mt-2'>
                    {askSeen && ask?.at === askSeen && (
                        <p role='status' className='mb-2 rounded border border-blue-300 bg-blue-50 p-2 text-gray-900'>
                            Prefilled from {ask.from ?? 'the item you picked'}. Check the documents and rewrite the note for the
                            applicant, then click Send request. Nothing has been sent yet.
                        </p>
                    )}
                    <p className='text-gray-800'>
                        Sent in-app, by SMS {ctx.sms_to ? `(to ${ctx.sms_to})` : '(no valid mobile number: SMS will be skipped)'} and by email
                        {ctx.email_to ? ` (to ${ctx.email_to})` : ' (no valid email address: email will be skipped)'}. No links are allowed.
                        The applicant can upload only the documents you pick.
                    </p>

                    {ctx.suggestions.texts.length > 0 && (
                        <div className='mt-3'>
                            <h4 className='font-semibold text-gray-900'>Why the file is deferred (internal: rewrite for the applicant)</h4>
                            <ul className='mt-1'>
                                {ctx.suggestions.texts.map((s, i) => (
                                    <li key={i} className='flex items-start justify-between gap-3 border-b border-gray-200 py-2 text-gray-900'>
                                        <span className='min-w-0'>
                                            <span className='block text-sm text-gray-700'><Terms text={s.source} /></span>
                                            <span className='block whitespace-pre-wrap break-words text-gray-900'>{s.text}</span>
                                        </span>
                                        <button type='button' className={`shrink-0 ${BTN_LIGHT}`} onClick={() => setMessage(s.text.slice(0, ctx.max_length))}>Use this</button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    <fieldset className='mt-3'>
                        <legend className='font-semibold text-gray-900'>Documents needed</legend>
                        {checklist.length === 0 && <p className='text-gray-700'>No checklist documents on this file. Add an "Other" document below.</p>}
                        <ul>
                            {checklist.map((r) => (
                                <li key={keyOf(r)}>
                                    <label className='flex items-center gap-2 py-1 text-gray-900'>
                                        <input type='checkbox' checked={selected.has(keyOf(r))} onChange={() => toggle(r)} />
                                        {r.label} ({r.party})
                                        <span className={`text-sm ${r.uploaded < r.needed ? 'text-red-800' : 'text-gray-700'}`}>· {r.uploaded} of {r.needed} uploaded</span>
                                    </label>
                                </li>
                            ))}
                        </ul>
                        {others.map((o, i) => (
                            <div key={i} className='mt-2 flex flex-wrap items-center gap-2'>
                                <select aria-label='Whose document' value={o.applicant_id} className={INPUT}
                                    onChange={(e) => setOthers(others.map((x, j) => (j === i ? { ...x, applicant_id: Number(e.target.value) } : x)))}>
                                    {parties.map((p) => <option key={p.applicant_id} value={p.applicant_id}>{p.party}</option>)}
                                </select>
                                <input aria-label='Document name' placeholder='e.g. Proof of billing' maxLength={80} value={o.label} className={`${INPUT} min-w-0 flex-1`}
                                    onChange={(e) => setOthers(others.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                                <button type='button' className={BTN_LIGHT} onClick={() => setOthers(others.filter((_, j) => j !== i))}>Remove</button>
                            </div>
                        ))}
                        {parties.length > 0 && (
                            <button type='button' className={`mt-2 ${BTN_LIGHT}`}
                                onClick={() => setOthers([...others, { applicant_id: parties[0].applicant_id, label: '' }])}>
                                Add another document
                            </button>
                        )}
                    </fieldset>

                    <label htmlFor='doc-request-message' className='mt-3 block font-semibold text-gray-900'>What we need</label>
                    <p id='doc-request-hint' className='text-sm text-gray-700'>Plain words for the applicant, at most {ctx.max_length} characters. The documents are listed after it.</p>
                    <textarea id='doc-request-message' value={message} maxLength={ctx.max_length} rows={3}
                        onChange={(e) => setMessage(e.target.value)} aria-describedby='doc-request-hint doc-request-count'
                        aria-invalid={Boolean(problem && message.trim())} className={`${INPUT} mt-1 w-full`} />
                    <p id='doc-request-count' className='text-sm text-gray-700'>{message.length} / {ctx.max_length}</p>
                    {problem && message.trim() && <p role='alert' className='font-semibold text-red-800'>{problem}</p>}

                    {preview && !problem && (
                        <div className='mt-3 rounded border border-gray-300 bg-gray-50 p-3 text-gray-900'>
                            <h4 className='font-semibold text-gray-900'>What the applicant will receive</h4>
                            <p className='mt-1 text-sm font-semibold text-gray-800'>In the app</p>
                            <p className='text-gray-900'>{preview.in_app_title}</p>
                            <p className='text-gray-900'>{preview.in_app_body}</p>
                            <p className='mt-2 text-sm font-semibold text-gray-800'>SMS ({preview.sms_text.length} characters, {smsSegments(preview.sms_text)} SMS)</p>
                            <p className='whitespace-pre-wrap break-words text-gray-900'>{preview.sms_text}</p>
                            <p className='mt-2 text-sm font-semibold text-gray-800'>Email: {preview.email_subject}</p>
                            <p className='whitespace-pre-wrap break-words text-gray-900'>{preview.email_body}</p>
                        </div>
                    )}

                    {!confirming ? (
                        <button type='button' className={`mt-3 ${BTN}`} disabled={busy || !preview || Boolean(problem)} onClick={() => setConfirming(true)}>
                            Send request
                        </button>
                    ) : (
                        <div role='alertdialog' aria-labelledby='doc-send-confirm' className='mt-3 rounded border border-red-300 bg-red-50 p-3 text-gray-900'>
                            <p id='doc-send-confirm' className='font-semibold text-gray-900'>Send this request to the applicant now? It can't be edited; you can withdraw it.</p>
                            <div className='mt-2 flex gap-3'>
                                <button type='button' className={BTN} disabled={busy} onClick={send}>{busy ? 'Sending...' : 'Yes, send'}</button>
                                <button type='button' className={BTN_LIGHT} disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {ctx.history.length > 0 && (
                <details className='mt-4'>
                    <summary className='cursor-pointer font-semibold text-gray-900'>Earlier requests ({ctx.history.length})</summary>
                    <ul>
                        {ctx.history.map((r) => (
                            <li key={r.id} className='border-b border-gray-200 py-2 text-gray-900'>
                                <p className='text-gray-900'>
                                    <span className='font-semibold'>{CLOSED_TEXT[r.closed_as]}</span>
                                    <span className='text-sm text-gray-700'> · sent {when(r.opened_at)} by {r.opened_by ?? 'Account Officer'}, closed {when(r.closed_at)} by {r.closed_by ?? 'Account Officer'}</span>
                                </p>
                                {r.close_note && <p className='text-sm text-gray-800'>Note: {r.close_note}</p>}
                                <RequestView req={r} onView={view} marks={marks} />
                            </li>
                        ))}
                    </ul>
                </details>
            )}
            </div>
        </details>
    );
};

export default RequestPanel;
