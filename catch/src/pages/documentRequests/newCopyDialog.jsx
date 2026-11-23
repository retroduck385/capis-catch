// "Needs a new copy" modal, opened from the staff check of a file (fileMark.jsx). In one step the staff member
// saves the mark with what is wrong (staff only), and the assigned Account Officer can also send the applicant a
// request for that file's category, and only that one: the applicant can upload only that document in reply
// (other categories are asked from the loan folder's box). Same database calls as the loan folder's
// "Ask the applicant for documents" box (preview_document_request / open_document_request), so the same rules apply:
// only the assigned AO sends, no links, and a document still owed on an open request isn't asked again. When the AO
// can send, saving always sends (there is no "save without asking"). Anyone else (the CO, or the AO when this document
// is already on an open request) only saves the mark, and the modal says why. Styles: fileMark.css (.fm-dialog).
// If the mark is saved but the request fails, File status is refreshed at once (onMarked) and the modal says the
// mark was saved; trying again only sends the request (newCopySave.js).
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Bell, FileText, Mail, Send, Smartphone } from 'lucide-react';
import { fetchRequestContext, markFile, openRequest, previewRequest } from './api';
import { refreshCanAsk } from './askStore';
import { openRequestsOf } from './openRequests';
import { saveNewCopy } from './newCopySave';

const keyOf = (r) => `${r.applicant_id}:${r.requirement_type}`;

// file: { documentId, applicantId, requirementType (null = not a checklist document), label }
// initialComment: what was already typed in the staff check box
// onMarked(): the mark is saved (called at once, before the request is sent, so File status can refresh)
// onDone(sent): the mark is saved; sent = a request also went to the applicant
const NewCopyDialog = ({ applicationId, file, initialComment = '', onClose, onDone, onMarked }) => {
    const ref = useRef(null);
    const [ctx, setCtx] = useState(null);
    const [loadError, setLoadError] = useState(null);
    const [comment, setComment] = useState(initialComment);
    const [message, setMessage] = useState('Please upload a new, clear and complete copy of the document listed below.');
    const [problem, setProblem] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [commentError, setCommentError] = useState(false);
    const [marked, setMarked] = useState(false);       // the mark is saved; a retry only sends the request

    useEffect(() => {
        const d = ref.current;
        if (d && !d.open) d.showModal();
    }, []);

    useEffect(() => {
        let cancelled = false;
        fetchRequestContext(applicationId)
            .then((c) => { if (!cancelled) setCtx(c); })
            .catch((err) => { if (!cancelled) setLoadError(err.message); });
        return () => { cancelled = true; };
    }, [applicationId]);

    const thisKey = keyOf({ applicant_id: file.applicantId, requirement_type: file.requirementType });
    const row = file.requirementType ? (ctx?.suggestions?.checklist ?? []).find((r) => keyOf(r) === thisKey) : null;
    // this document is already on a request still waiting or sent back (the database refuses asking twice)
    const alreadyAsked = openRequestsOf(ctx).some((req) => req.items.some((i) => (row
        ? keyOf(i) === thisKey
        : !i.requirement_type && i.applicant_id === file.applicantId && i.label.toLowerCase() === file.label.slice(0, 80).toLowerCase())));
    const canSend = Boolean(ctx?.can_open) && !alreadyAsked;
    // exactly one item: this file's checklist category, or (a file outside the checklist) an "Other" with its name
    const items = useMemo(() => [row
        ? { applicant_id: row.applicant_id, requirement_type: row.requirement_type }
        : { applicant_id: file.applicantId, requirement_type: null, label: file.label.slice(0, 80) }], [row, file]);

    // the database's own check of the message and items (empty, too long, a link...), as the AO types
    useEffect(() => {
        if (!canSend) return undefined;
        let cancelled = false;
        const timer = setTimeout(() => {
            previewRequest(applicationId, message, items)
                .then((p) => { if (!cancelled) setProblem(p?.problem ?? null); })
                .catch((err) => { if (!cancelled) setProblem(err.message); });
        }, 300);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [canSend, applicationId, message, items]);

    // the mark is already saved (the request failed): closing finishes like a save without sending
    const close = () => {
        if (busy) return;
        if (marked) onDone(false);
        else onClose();
    };

    const submit = async (send) => {
        if (!marked && !comment.trim()) {
            setCommentError(true);
            return;
        }
        // the mark is already saved: closing without sending is just closing
        if (marked && !send) {
            onDone(false);
            return;
        }
        setBusy(true);
        setError(null);
        const result = await saveNewCopy({
            markFile, openRequest, onMarked, documentId: file.documentId, comment, applicationId, message, items, send,
            alreadyMarked: marked,
        });
        if (result.marked) setMarked(true);
        if (send) refreshCanAsk(applicationId);   // sent, or refused (e.g. already on an open request): the buttons follow
        if (!result.error) {
            onDone(send);
            return;
        }
        setError(result.error);
        setBusy(false);
    };

    const whyNot = ctx && !canSend
        ? (alreadyAsked ? 'This document is already on a request that is still open (see the loan folder).' : ctx.why_not)
        : null;
    const sendDisabled = busy || Boolean(problem) || !message.trim();

    return (
        <dialog ref={ref} className="fm-dialog" aria-labelledby="fm-dialog-title"
            onCancel={(e) => { if (busy) e.preventDefault(); }}
            onClose={() => (marked ? onDone(false) : onClose())}
            onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
            <div className="fm-dialog-body">
                <header className="fm-dialog-head">
                    <span className="fm-dialog-ic" aria-hidden="true"><AlertTriangle size={20} /></span>
                    <div>
                        <h2 id="fm-dialog-title">Needs a new copy</h2>
                        <p className="fm-note">{file.label}</p>
                    </div>
                </header>

                <div className="fm-field">
                    <label htmlFor="fm-dialog-comment" className="fm-label">
                        What&apos;s wrong with this file <small>(staff only)</small>
                    </label>
                    <input id="fm-dialog-comment" className="fm-input" value={comment} maxLength={500} autoFocus readOnly={marked} aria-required="true"
                        onChange={(e) => { setComment(e.target.value); setCommentError(false); }}
                        placeholder="e.g. Blurry, the last page is cut off"
                        aria-invalid={commentError || undefined} aria-describedby={commentError ? 'fm-dialog-comment-err' : undefined} />
                    {commentError && <p id="fm-dialog-comment-err" className="fm-err">Say what is wrong with the file.</p>}
                </div>

                {loadError && <p className="fm-err" role="alert">{loadError}</p>}
                {!ctx && !loadError && <p className="fm-note">Loading the applicant&apos;s checklist...</p>}
                {whyNot && <p className="fm-dialog-strip">{whyNot} The mark is still saved.</p>}

                {canSend && (
                    <>
                        <div className="fm-field">
                            <p className="fm-label">Ask the applicant for</p>
                            <p className="fm-asking">
                                <FileText size={16} aria-hidden="true" />
                                <span className="fm-pick-txt"><b>{row?.label ?? file.label}</b>{row?.party && <span className="fm-party">{row.party}</span>}</span>
                            </p>
                        </div>

                        <div className="fm-field">
                            <label htmlFor="fm-dialog-message" className="fm-label">Message to the applicant</label>
                            <textarea id="fm-dialog-message" className="fm-input" rows={3} value={message} maxLength={ctx.max_length}
                                onChange={(e) => setMessage(e.target.value)} aria-describedby="fm-dialog-count"
                                aria-invalid={Boolean(problem && message.trim()) || undefined} />
                            <p id="fm-dialog-count" className="fm-counter">{message.length} / {ctx.max_length}</p>
                            {problem && message.trim() && <p className="fm-err" role="alert">{problem}</p>}
                            <p className="fm-channels">
                                <span><Bell size={13} aria-hidden="true" />In the app</span>
                                {ctx.sms_to && <span><Smartphone size={13} aria-hidden="true" />SMS</span>}
                                {ctx.email_to && <span><Mail size={13} aria-hidden="true" />Email</span>}
                            </p>
                        </div>
                    </>
                )}

                {error && <p className="fm-err" role="alert">{error}</p>}

                <div className="fm-dialog-actions">
                    <button type="button" className="fm-dbtn quiet" disabled={busy} onClick={close}>Cancel</button>
                    {canSend ? (
                        <button type="button" className="fm-dbtn primary" disabled={sendDisabled} onClick={() => submit(true)}>
                            <Send size={15} aria-hidden="true" />{busy ? 'Sending...' : marked ? 'Try sending again' : 'Save and send request'}
                        </button>
                    ) : (
                        <button type="button" className="fm-dbtn primary" disabled={busy || (!ctx && !loadError)} onClick={() => submit(false)}>
                            {busy ? 'Saving...' : 'Save'}
                        </button>
                    )}
                </div>
            </div>
        </dialog>
    );
};

export default NewCopyDialog;
