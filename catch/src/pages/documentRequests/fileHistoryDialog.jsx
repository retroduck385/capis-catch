// "Requests and replies" popup, opened from a file's staff check (fileMark.jsx): every "Ask the applicant" request
// that asked for this file's part (same borrower and checklist category, or the "Other" item this file answered),
// oldest first. Each request is an inset card (left stripe in the request box's tones: blue while waiting, orange when
// the documents are back, green received, slate withdrawn) holding a small timeline (.lf-tl, DESIGN.md "Change
// history"): Sent (the AO's message, what it asked for, in-app / SMS / email delivery) → reminders → the applicant's
// files → Closed (Received / Withdrawn, with the AO's staff-only note), or a dashed "Waiting" step while it is open.
// Read-only, staff only (document_request_context() and document_reminder_status() refuse applicants); nothing new in
// the database. Shell: components/infoModal.jsx. Styles: fileMark.css (.fm-hist-*).
import { useEffect, useState } from 'react';
import { Bell, Clock, FileText, History, Mail, Smartphone } from 'lucide-react';
import { fetchReminderStatus, fetchRequestContext, fileUrl } from './api';
import InfoModal from '../../components/infoModal';
import Byline from '../../components/byline';
import { formatWhen, fullWhen } from '../../components/people';
import { openRequestsOf } from './openRequests';

// delivery status -> [short label, chip tone]
const DELIVERY = {
    QUEUED: ['Queued', 'none'], RUNNING: ['Sending', 'info'], LOGGED: ['Test mode, not sent', 'info'],
    SENT: ['Sent', 'ok'], FAILED: ['Failed', 'err'], SKIPPED: ['Skipped', 'none'],
};
// where a request stands: [label, chip tone, card stripe]
const standing = (r) => {
    if (r.closed_as === 'RECEIVED') return ['Received', 'ok', 'ok'];
    if (r.closed_as === 'WITHDRAWN') return ['Withdrawn', 'none', 'none'];
    if (r.status === 'SENT') return ['Documents back: check them', 'warn', 'back'];
    return ['Waiting for the applicant', 'info', 'wait'];
};
const capitalized = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// the item of a request that asks for this file's part, if any
const itemFor = (req, file) => req.items.find((i) =>
    i.uploads.some((u) => u.document_id === file.documentId)
    || (i.applicant_id === file.applicantId && (file.requirementType
        ? i.requirement_type === file.requirementType
        : i.requirement_type == null && i.label === file.label)));

const When = ({ at }) => (
    <time className="fm-hist-when" dateTime={new Date(at).toISOString()} title={fullWhen(at)}>{formatWhen(at)}</time>
);

// one row per channel: icon, where it went, and a short status chip
const Deliveries = ({ rows, inApp = false }) => (
    <ul className="fm-hist-deliv" aria-label="Delivery">
        {inApp && (
            <li><Bell size={14} aria-hidden="true" /><span className="to">In the app</span><span className="fm-chip ok">Delivered</span></li>
        )}
        {rows.map((d) => {
            const [label, tone] = DELIVERY[d.status] ?? [d.status, 'none'];
            const Icon = d.channel === 'SMS' ? Smartphone : Mail;
            return (
                <li key={d.channel}>
                    <Icon size={14} aria-hidden="true" />
                    <span className="to">{d.channel === 'SMS' ? 'SMS' : 'Email'}{d.to && <span className="addr"> {d.to}</span>}</span>
                    <span className={`fm-chip ${tone}`} title={d.error || undefined}>{label}</span>
                    {d.error && <span className="sr-only"> ({d.error})</span>}
                </li>
            );
        })}
    </ul>
);

// one timeline step: a tag in its tone, then the who / when line, then its body
const Step = ({ tone = '', tag, children, head }) => (
    <li className={`lf-tl-item fm-tl ${tone}`}>
        <span className="lf-tl-dot" aria-hidden="true" />
        <div className="lf-tl-head"><span className="lf-tl-act">{tag}</span>{head}</div>
        {children && <div className="fm-tl-body">{children}</div>}
    </li>
);

const RequestCard = ({ n, req, item, reminders, next, onView }) => {
    const [label, tone, stripe] = standing(req);
    const others = req.items.length - 1;
    const sentBack = Boolean(req.sent_at);
    return (
        <li className={`fm-hist-card ${stripe}`}>
            <div className="fm-hist-card-head">
                <h3>Request {n}</h3>
                <span className={`fm-chip ${tone}`}>{label}</span>
            </div>
            <ol className="lf-tl">
                <Step tag="Sent" head={<><span className="fm-hist-verb">by</span>
                    <Byline layout="inline" name={req.opened_by} role="Account Officer" at={req.opened_at} /></>}>
                    <p className="fm-hist-quote">{req.message}</p>
                    <p className="fm-hist-asked">
                        <span className="k">Asked for</span>
                        <b>{item.label}</b>
                        {item.party && <span className="fm-party">{capitalized(item.party)}</span>}
                        {others > 0 && <span className="fm-chip none">+{others} other document{others === 1 ? '' : 's'}</span>}
                    </p>
                    <Deliveries rows={req.deliveries ?? []} inApp />
                </Step>

                {reminders.map((r) => (
                    <Step key={r.id} tone="rem" tag={`Reminder ${r.reminder_no}`}
                        head={r.status === 'SKIPPED' ? <span className="fm-hist-verb">{r.note ?? 'Skipped'}</span> : <When at={r.created_at} />}>
                        {r.status !== 'SKIPPED' && r.deliveries.length > 0 && <Deliveries rows={r.deliveries} />}
                    </Step>
                ))}

                {item.uploads.length > 0 && (
                    <Step tone="in" tag={sentBack ? 'Sent back' : 'Uploading'}
                        head={sentBack
                            ? <><span className="fm-hist-verb">by</span><Byline layout="inline" name="Applicant" at={req.sent_at} /></>
                            : <span className="fm-hist-verb">Not sent back yet</span>}>
                        <ul className="fm-hist-files">
                            {item.uploads.map((u) => (
                                <li key={u.document_id}>
                                    <button type="button" className="fm-hist-file" onClick={() => onView(u.file_path)}>
                                        <FileText size={15} aria-hidden="true" /><span className="name">{u.file_name}</span>
                                        <span className="sr-only"> (opens in a new tab)</span>
                                    </button>
                                    <When at={u.uploaded_at} />
                                </li>
                            ))}
                        </ul>
                    </Step>
                )}

                {req.closed_at ? (
                    <Step tone={req.closed_as === 'RECEIVED' ? 'ok' : 'del'} tag={req.closed_as === 'RECEIVED' ? 'Received' : 'Withdrawn'}
                        head={<>{req.closed_by ? <><span className="fm-hist-verb">by</span>
                            <Byline layout="inline" name={req.closed_by} at={req.closed_at} /></> : <When at={req.closed_at} />}</>}>
                        {req.close_note && (
                            <p className="fm-hist-quote note"><span className="k">Staff note</span>{req.close_note}</p>
                        )}
                    </Step>
                ) : !sentBack && (
                    <Step tone="wait" tag="Waiting" head={<span className="fm-hist-verb">
                        {item.uploads.length > 0 ? 'for the applicant to send the files back' : 'for the applicant to upload this document'}</span>}>
                        {next && (
                            <p className="fm-hist-next"><Clock size={14} aria-hidden="true" />
                                Reminder {next.reminder_no} of 2 goes out <When at={next.at} /> if nothing comes back</p>
                        )}
                    </Step>
                )}
                {sentBack && !req.closed_at && (
                    <Step tone="wait" tag="Your move" head={<span className="fm-hist-verb">check the files, then close the request in the loan folder</span>} />
                )}
            </ol>
        </li>
    );
};

// file: { documentId, applicantId, requirementType (null = not a checklist document), label }
const FileHistoryDialog = ({ applicationId, file, onClose }) => {
    const [ctx, setCtx] = useState(null);
    const [reminders, setReminders] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        let cancelled = false;
        fetchRequestContext(applicationId)
            .then((c) => { if (!cancelled) setCtx(c); })
            .catch((err) => { if (!cancelled) setError(err.message); });
        // reminders are extra: the requests still show without them
        fetchReminderStatus(applicationId)
            .then((s) => { if (!cancelled) setReminders(s); })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [applicationId]);

    // requests that asked for this part, oldest first
    const requests = ctx ? [...(ctx.history ?? []), ...openRequestsOf(ctx)] : [];
    const entries = requests
        .map((req) => ({ req, item: itemFor(req, file) }))
        .filter((e) => e.item)
        .sort((a, b) => a.req.id - b.req.id);
    const party = entries.find((e) => e.item.party)?.item.party;

    const view = async (path) => {
        try { window.open(await fileUrl(path), '_blank', 'noopener'); } catch (err) { setError(err.message); }
    };

    return (
        <InfoModal Icon={History} tone="hist" className="fm-hist-modal" focusBody onClose={onClose}
            eyebrow="Requests and replies" title={party ? `${file.label} · ${capitalized(party)}` : file.label}
            note={ctx && entries.length > 0 ? `${entries.length} request${entries.length === 1 ? '' : 's'} for this document` : null}>
            {error && <p className="fm-err" role="alert">{error}</p>}
            {!ctx && !error && <p className="fm-note" role="status">Loading the requests...</p>}
            {ctx && entries.length === 0 && (
                <p className="fm-hist-empty">Nothing has been asked of the applicant for this document yet.</p>
            )}
            {entries.length > 0 && (
                <ol className="fm-hist-cards">
                    {entries.map(({ req, item }, i) => (
                        <RequestCard key={req.id} n={i + 1} req={req} item={item} onView={view}
                            next={req.status !== 'OPEN' || !reminders ? null
                                : reminders.next_by_request ? reminders.next_by_request[req.id] ?? null : reminders.next}
                            reminders={(reminders?.reminders ?? []).filter((r) => r.request_id === req.id)} />
                    ))}
                </ol>
            )}
        </InfoModal>
    );
};

export default FileHistoryDialog;
