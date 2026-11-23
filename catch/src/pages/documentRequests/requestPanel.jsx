import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
    AlertTriangle, Bell, CheckCircle2, ChevronDown, Clock, FileText, History, Mail, MailQuestion, Plus, RefreshCw, Send, Smartphone, Undo2, User, X,
} from 'lucide-react';
import MessagePreview from '../applicantNotices/messagePreview';
import { closeRequest, fetchReminderStatus, fetchRequestContext, fileUrl, openRequest, previewRequest } from './api';
import Reminders from './reminders';
import { refreshCanAsk } from './askStore';
import { isAskUsed, markAskUsed, withoutAsk } from './askOnce';
import FileMark from './fileMark';
import { useFileMarks } from './useFileMarks';
import { useReadStates } from './useReadStates';
import { openRequestsOf } from './openRequests';
import { UNREADABLE_TEXT } from '../documentCheck/api';
import { Terms } from '../../components/term';
import Byline from '../../components/byline';
import { formatDay, fullWhen } from '../../components/people';
import SelectMenu from '../../components/selectMenu';
import './requestPanel.css';

// "Ask the applicant for documents" (the deferral loop): the assigned Account Officer sends a short message plus the
// specific documents needed, in-app, by SMS and by email (no links). The applicant uploads them and sends them back;
// the AO checks them and closes the request. Several requests can be open at once (each with its own message,
// uploads, reminders and close); a document still owed on one of them can't be asked again. Every file is read on its own: IDs, COE / ITR, payslips and bank
// statements by OCR + the AI document check like any upload; Other, SPA and permits by OCR only (no AI). Each file
// shows whether it could be read (useReadStates.js).
// Everyone who can open the file sees the current request read-only.
// A disclosure card in the staff look (DESIGN.md, "Ask the applicant"), closed by default so it doesn't push the loan
// folder down; the summary row shows where the open requests stand. It opens by itself when the applicant has sent
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
const otherKeyOf = (o) => `${o.applicant_id}:other:${String(o.label).trim().toLowerCase()}`;
// The checklist grouped by person, in the order it comes (principal, spouse, co-borrowers): [{ applicantId, party, rows }]
const byParty = (rows) => rows.reduce((groups, r) => {
    const last = groups[groups.length - 1];
    if (last?.applicantId === r.applicant_id) last.rows.push(r);
    else groups.push({ applicantId: r.applicant_id, party: r.party, rows: [r] });
    return groups;
}, []);
const capitalized = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
// Read state of an uploaded file (useReadStates.js): [label, chip tone, icon]
const READ = { READING: ['Reading...', 'info', Clock], READ: ['Read', 'ok', CheckCircle2], UNREADABLE: ["Couldn't read", 'err', AlertTriangle] };
const uploadIds = (reqs) => reqs.flatMap((r) => r.items.flatMap((i) => i.uploads.map((u) => u.document_id)));

// marks: useFileMarks() of the application (staff check of each uploaded file)
// past: an earlier request, so each file's staff check starts closed
// reads: useReadStates() of the shown uploads; a file that couldn't be read offers "Ask the applicant"
const ReadChip = ({ state }) => {
    if (!READ[state]) return null;
    const [label, tone, Icon] = READ[state];
    return <span className={`dr-chip ${tone}`}><Icon size={13} aria-hidden="true" />{label}</span>;
};
const Uploads = ({ item, onView, applicationId, marks, past, reads = {} }) => (
    item.uploads.length === 0 ? <p className="dr-none">Nothing uploaded yet</p> : (
        <ul className="dr-files">
            {item.uploads.map((u) => (
                <li key={u.document_id}>
                    <div className="dr-file">
                        <button type="button" className="dr-file-btn" onClick={() => onView(u.file_path)}>
                            <FileText size={15} aria-hidden="true" />{u.file_name}
                        </button>
                        <Byline layout="inline" name="Applicant" at={u.uploaded_at} className="dr-file-at" />
                        <ReadChip state={reads[u.document_id]} />
                    </div>
                    {reads[u.document_id] === 'UNREADABLE' && <p className="dr-unreadable" role="status">{UNREADABLE_TEXT}</p>}
                    {marks && (
                        <FileMark applicationId={applicationId} marks={marks} autoOpen={!past}
                            unreadable={reads[u.document_id] === 'UNREADABLE'}
                            file={{ documentId: u.document_id, applicantId: item.applicant_id, requirementType: item.requirement_type, label: item.label }} />
                    )}
                </li>
            ))}
        </ul>
    )
);

const RequestView = ({ req, onView, marks, reads, past = false }) => (
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
                    <Uploads item={i} onView={onView} applicationId={req.application_id} marks={marks} past={past} reads={reads} />
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
    const [closing, setClosing] = useState(null);       // id of the open request being closed / withdrawn
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState(null);
    const [error, setError] = useState(null);
    const [expanded, setExpanded] = useState(null);    // null = not toggled yet: open only if documents came back
    const [applied, setApplied] = useState(null);       // the "Ask the applicant" click already put into the box
    const [composing, setComposing] = useState(false);  // the new-request form, while other requests are open
    const [partyOpen, setPartyOpen] = useState({});      // { applicantId: open } once the AO opens / closes a person
    const marks = useFileMarks(applicationId);
    const [reminders, setReminders] = useState(null);  // document_reminder_status(); null = not loaded / not run yet
    const openReqs = useMemo(() => openRequestsOf(ctx), [ctx]);
    const reads = useReadStates(ctx ? uploadIds([...openReqs, ...(ctx.history ?? [])]) : []);
    const boxRef = useRef(null);
    // Set by an "Ask the applicant" button (ask.jsx): documents to tick and a note to prefill
    const location = useLocation();
    const navigate = useNavigate();
    const ask = location.state?.ask ?? null;

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

    // Reminders: reloaded with the request; only a hint, so a failed load (migration not run yet) just hides them
    useEffect(() => {
        if (!ctx) return undefined;
        let cancelled = false;
        fetchReminderStatus(applicationId)
            .then((s) => { if (!cancelled) setReminders(s); })
            .catch(() => { if (!cancelled) setReminders(null); });
        return () => { cancelled = true; };
    }, [applicationId, ctx]);

    const checklist = useMemo(() => ctx?.suggestions?.checklist ?? [], [ctx]);
    // Documents already on an open request: not asked again (the database refuses it too)
    const asked = useMemo(() => new Set(openReqs.flatMap((r) => r.items.map((i) => (i.requirement_type ? keyOf(i) : otherKeyOf(i))))),
        [openReqs]);
    // Missing documents start ticked
    const selected = useMemo(
        () => picked ?? new Set(checklist.filter((r) => r.uploaded < r.needed).map(keyOf)),
        [picked, checklist]);
    const items = useMemo(() => [
        ...checklist.filter((r) => selected.has(keyOf(r)) && !asked.has(keyOf(r)))
            .map((r) => ({ applicant_id: r.applicant_id, requirement_type: r.requirement_type })),
        ...others.map((o) => ({ applicant_id: o.applicant_id, requirement_type: null, label: o.label })),
    ], [checklist, selected, asked, others]);

    const formVisible = Boolean(ctx?.can_open);

    // An "Ask the applicant" click: open the dropdown, tick its documents and prefill the note, once (state adjusted
    // while rendering). Nothing is sent: the AO reviews the box and clicks Send request.
    // Only once per click (askOnce.js): a remount or a reload never replaces what the AO has typed since.
    if (ask && formVisible && ask.at !== applied?.at && !isAskUsed(ask)) {
        setApplied(ask);
        const onList = (i) => i.requirement_type && checklist.some((r) => keyOf(r) === keyOf(i));
        const wanted = ask.items?.length ? ask.items
            : checklist.filter((r) => r.uploaded < r.needed && (ask.missingFor == null || r.applicant_id === ask.missingFor));
        setPicked(new Set(wanted.filter(onList).map(keyOf)));
        const blankOther = ask.blankOtherFor === undefined ? []
            : [{ applicant_id: ask.blankOtherFor ?? ctx.suggestions?.parties?.[0]?.applicant_id, label: '' }];
        setOthers([...wanted.filter((i) => !onList(i) && i.label).map((i) => ({ applicant_id: i.applicant_id, label: String(i.label).slice(0, 80) })),
            ...blankOther]);
        setMessage((ask.note ?? '').slice(0, ctx.max_length));
        setConfirming(false);
        setDone(null);
        setExpanded(true);
        setComposing(true);
    }
    // ...then mark the click as used and drop it from the history state, and bring the box into view
    const askSeen = applied?.at ?? null;
    const askKind = applied?.kind;
    useEffect(() => {
        if (!applied) return;
        markAskUsed(applied);
        if (location.state?.ask) {
            navigate(`${location.pathname}${location.search}`, { replace: true, state: withoutAsk(location.state) });
        }
    }, [applied, location, navigate]);
    useEffect(() => {
        if (!askSeen) return;
        boxRef.current?.scrollIntoView({ block: 'start' });
        // a file request (KYC "Request a file") starts on the documents; anything else on the note
        const box = boxRef.current;
        const target = askKind === 'file'
            ? box?.querySelector('.dr-picks input:checked') ?? box?.querySelector('.dr-other input[type="text"]') ?? box?.querySelector('.dr-picks input')
            : box?.querySelector('textarea');
        target?.focus({ preventScroll: true });
    }, [askSeen, askKind]);

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

    if (!ctx || (openReqs.length === 0 && ctx.history.length === 0 && !ctx.is_assigned_ao)) return null;

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
            setMessage(''); setPicked(null); setOthers([]); setConfirming(false); setComposing(false); setDone('Request sent to the applicant.');
            await load();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    // Close (documents received) or withdraw. To ask for a file again, use its "Needs a new copy" (newCopyDialog.jsx).
    const close = async (cur) => {
        setBusy(true);
        setError(null);
        try {
            const as = await closeRequest(cur.id, note);
            setNote(''); setClosing(null);
            setDone(as === 'RECEIVED' ? 'Request closed. The applicant was told the documents were received.' : 'Request withdrawn.');
            await load();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    const problem = preview?.problem;
    const parties = ctx.suggestions?.parties ?? [];
    const partyOptions = parties.map((p) => ({ value: String(p.applicant_id), label: p.party }));
    const back = openReqs.filter((r) => r.status === 'SENT').length;
    const waiting = openReqs.length - back;
    const open = expanded ?? back > 0;
    // with requests open, the form waits behind "Ask for other documents" so the open ones stay in view
    const showForm = ctx.can_open && (openReqs.length === 0 || composing);

    return (
        <details ref={boxRef} open={open} onToggle={(e) => setExpanded(e.currentTarget.open)} className="dr">
            <summary className="dr-head">
                <span className="dr-ic" aria-hidden="true"><MailQuestion size={18} /></span>
                <h3>Ask the applicant for documents</h3>
                {back > 0 && (
                    <span className="dr-chip warn"><AlertTriangle size={13} aria-hidden="true" />
                        {back === 1 ? 'Documents back: check them' : `${back} requests back: check them`}</span>
                )}
                {waiting > 0 && (
                    <span className="dr-chip info"><Clock size={13} aria-hidden="true" />
                        {waiting === 1 ? 'Waiting for the applicant' : `${waiting} waiting for the applicant`}</span>
                )}
                {ctx.history.length > 0 && <span className="dr-chip none">{ctx.history.length} earlier</span>}
                <ChevronDown size={20} className="dr-chev" aria-hidden="true" />
            </summary>

            <div className="dr-body">
                {done && <p role="status" className="dr-strip ok"><CheckCircle2 size={16} aria-hidden="true" /><span>{done}</span></p>}
                {error && <p role="alert" className="dr-err">{error}</p>}

                {openReqs.map((cur) => (
                    <section key={cur.id} className={`dr-current${cur.status === 'SENT' ? ' back' : ''}`}
                        aria-label={openReqs.length > 1 ? `Open request: ${cur.items.map((i) => i.label).join(', ')}` : 'Open request'}>
                        <div className="dr-current-head">
                            <p className="dr-current-title">{STATUS_TEXT[cur.status]}</p>
                            <button type="button" className="dr-icon-btn" onClick={load} aria-label="Refresh the requests" title="Refresh">
                                <RefreshCw size={16} aria-hidden="true" />
                            </button>
                        </div>
                        <div className="dr-bylines">
                            <span className="dr-by">Sent by <Byline layout="inline" name={cur.opened_by} fallback="Account Officer" at={cur.opened_at} /></span>
                            {cur.sent_at && <span className="dr-by">Sent back <Byline layout="inline" name="Applicant" at={cur.sent_at} /></span>}
                        </div>
                        <RequestView req={cur} onView={view} marks={marks} reads={reads} />
                        <Reminders status={reminders} requestId={cur.id} current={cur.status === 'OPEN'} />

                        {ctx.is_assigned_ao && (closing !== cur.id ? (
                            <div className="dr-acts">
                                {cur.status === 'SENT'
                                    ? <button type="button" className="dr-primary" onClick={() => { setNote(''); setClosing(cur.id); }}><CheckCircle2 size={16} aria-hidden="true" />Close: documents received</button>
                                    : <button type="button" className="dr-btn" onClick={() => { setNote(''); setClosing(cur.id); }}><X size={16} aria-hidden="true" />Withdraw request</button>}
                            </div>
                        ) : (
                            <div role="alertdialog" aria-labelledby={`doc-close-confirm-${cur.id}`} className="dr-confirm">
                                <p id={`doc-close-confirm-${cur.id}`} className="dr-confirm-title">
                                    {cur.status === 'SENT'
                                        ? 'Close this request? The applicant is told in the app that the documents were received.'
                                        : 'Withdraw this request? The applicant is told in the app that these documents are no longer needed.'}
                                </p>
                                <label htmlFor={`doc-close-note-${cur.id}`} className="dr-label">Note for the file <small>(optional, staff only)</small></label>
                                <input id={`doc-close-note-${cur.id}`} className="dr-input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
                                <div className="dr-acts">
                                    <button type="button" className="dr-primary" disabled={busy} onClick={() => close(cur)}>{busy ? 'Closing...' : 'Yes, close'}</button>
                                    <button type="button" className="dr-btn quiet" disabled={busy} onClick={() => setClosing(null)}>Cancel</button>
                                </div>
                            </div>
                        ))}
                    </section>
                ))}

                {ctx.is_assigned_ao && !ctx.can_open && <p className="dr-note">{ctx.why_not}</p>}

                {ctx.can_open && !showForm && (
                    <div className="dr-acts">
                        <button type="button" className="dr-btn" onClick={() => { setDone(null); setComposing(true); }}>
                            <Plus size={16} aria-hidden="true" />Ask for other documents
                        </button>
                    </div>
                )}

                {showForm && (
                    <section className="dr-form" aria-label="New request">
                        {openReqs.length > 0 && (
                            <div className="dr-form-head">
                                <h4 className="dr-h">New request</h4>
                                <button type="button" className="dr-btn quiet small" onClick={() => { setComposing(false); setConfirming(false); }}>Cancel</button>
                            </div>
                        )}
                        {applied && (
                            <p role="status" className="dr-strip info">
                                <MailQuestion size={16} aria-hidden="true" />
                                <span>Prefilled from {applied.from ?? 'the item you picked'}. Check the documents and rewrite the note for the
                                    applicant, then click Send request. Nothing has been sent yet.</span>
                            </p>
                        )}
                        {applied?.remark?.trim() && (
                            <p className="dr-strip info dr-remark">
                                <span><b>Your KYC note (staff only, not sent):</b> {applied.remark}</span>
                            </p>
                        )}

                        {/* where it goes: three channels, any that can't be used say so */}
                        <div className="dr-channels">
                            <span className="dr-channels-label">Sent by</span>
                            <ul className="dr-chips">
                                <li className="dr-chip ok"><Bell size={13} aria-hidden="true" />In the app</li>
                                <li className={`dr-chip ${ctx.sms_to ? 'ok' : 'warn'}`}>
                                    <Smartphone size={13} aria-hidden="true" />{ctx.sms_to ? `SMS to ${ctx.sms_to}` : 'SMS skipped: no valid mobile number'}
                                </li>
                                <li className={`dr-chip ${ctx.email_to ? 'ok' : 'warn'}`}>
                                    <Mail size={13} aria-hidden="true" />{ctx.email_to ? `Email to ${ctx.email_to}` : 'Email skipped: no valid address'}
                                </li>
                            </ul>
                        </div>

                        {ctx.suggestions.texts.length > 0 && (
                            <div className="dr-group">
                                <h4 className="dr-h">Why the file is deferred</h4>
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
                            {/* one dropdown per person, so it's clear whose documents are whose; a person starts open
                                only when something of theirs is missing or ticked */}
                            <div className="dr-party-groups">
                                {byParty(checklist).map((g) => {
                                    const missing = g.rows.filter((r) => r.uploaded < r.needed && !asked.has(keyOf(r))).length;
                                    const picks = g.rows.filter((r) => selected.has(keyOf(r)) && !asked.has(keyOf(r))).length;
                                    const groupOpen = partyOpen[g.applicantId] ?? (missing > 0 || picks > 0);
                                    return (
                                        <details key={g.applicantId} className="dr-party-group" open={groupOpen}
                                            onToggle={(e) => {
                                                const now = e.currentTarget.open;
                                                if (now !== groupOpen) setPartyOpen((m) => ({ ...m, [g.applicantId]: now }));
                                            }}>
                                            <summary className="dr-party-head">
                                                <User size={15} aria-hidden="true" />
                                                <span>{capitalized(g.party)}</span>
                                                {missing > 0
                                                    ? <span className="dr-chip warn">{missing} missing</span>
                                                    : <span className="dr-chip ok"><CheckCircle2 size={13} aria-hidden="true" />All uploaded</span>}
                                                {picks > 0 && <span className="dr-chip info">{picks} picked</span>}
                                                <ChevronDown size={18} className="dr-chev" aria-hidden="true" />
                                            </summary>
                                            <ul className="dr-picks">
                                                {g.rows.map((r) => {
                                                    const short = r.uploaded < r.needed;
                                                    const isAsked = asked.has(keyOf(r));
                                                    return (
                                                        <li key={keyOf(r)}>
                                                            <label className={`dr-pick${isAsked ? ' asked' : ''}`}>
                                                                <input type="checkbox" checked={!isAsked && selected.has(keyOf(r))} disabled={isAsked}
                                                                    onChange={() => toggle(r)} />
                                                                <span className="dr-pick-txt"><b>{r.label}</b></span>
                                                                {isAsked
                                                                    ? <span className="dr-chip info"><Clock size={13} aria-hidden="true" />Already asked</span>
                                                                    : <span className={`dr-count${short ? ' short' : ' all'}`}>{r.uploaded} / {r.needed}<span className="sr-only"> uploaded</span></span>}
                                                            </label>
                                                        </li>
                                                    );
                                                })}
                                            </ul>
                                        </details>
                                    );
                                })}
                            </div>
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
                            <label htmlFor="doc-request-message" className="dr-h">Message to the applicant</label>
                            <textarea id="doc-request-message" className="dr-input" value={message} maxLength={ctx.max_length} rows={3}
                                onChange={(e) => setMessage(e.target.value)} aria-describedby="doc-request-count"
                                aria-invalid={Boolean(problem && message.trim())} />
                            <p id="doc-request-count" className="dr-counter">{message.length} / {ctx.max_length}</p>
                            {problem && message.trim() && <p role="alert" className="dr-err">{problem}</p>}
                        </div>

                        {preview && !problem && (
                            <div className="dr-group">
                                <MessagePreview preview={preview} />
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
                                                <RequestView req={r} onView={view} marks={marks} reads={reads} past />
                                                <Reminders status={reminders} requestId={r.id} />
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
