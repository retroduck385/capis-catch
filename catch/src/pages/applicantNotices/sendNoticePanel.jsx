import { useCallback, useEffect, useState } from 'react';
import { fetchNoticeContext, previewNotice, sendNotice } from './api';

// "Send notice to applicant" (the bank's answer to Q-42): the assigned Account Officer tells the applicant the outcome
// and a reason, in-app, by SMS and by email. Shown only to the assigned AO, once the status is Approved / Rejected /
// Deferred (applicant_notice_context() decides). Light colours with an explicit text colour on every element:
// index.css turns headings and body text light in OS dark mode.

const OUTCOME_LABELS = { APPROVED: 'Approved', REJECTED: 'Rejected', DEFERRED: 'Deferred' };
const REASON_HINTS = {
    APPROVED: 'Optional. Leave empty to say "Your Account Officer will contact you about the next steps."',
    REJECTED: 'Required: the policy the applicant most likely did not pass.',
    DEFERRED: 'Required: what is missing.',
};
const DELIVERY_LABELS = {
    QUEUED: 'Queued', RUNNING: 'Sending', LOGGED: 'Logged (test mode, not sent)', SENT: 'Sent',
    FAILED: 'Failed', SKIPPED: 'Skipped',
};

// SMS segments: GSM-7 (160 per SMS, 153 per part; ^{}[]~\|€ count twice), anything else UCS-2 (70 / 67)
const GSM = /^[@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà^{}\\[~\]|€]*$/;
const smsSegments = (text) => {
    if (GSM.test(text)) {
        const units = [...text].reduce((n, ch) => n + ('^{}\\[~]|€'.includes(ch) ? 2 : 1), 0);
        return units <= 160 ? 1 : Math.ceil(units / 153);
    }
    const units = [...text].length;
    return units <= 70 ? 1 : Math.ceil(units / 67);
};

const SendNoticePanel = ({ applicationId }) => {
    const [ctx, setCtx] = useState(null);
    const [reason, setReason] = useState('');
    const [correction, setCorrection] = useState(false);
    const [preview, setPreview] = useState(null);
    const [confirming, setConfirming] = useState(false);
    const [sending, setSending] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState(null);

    // Errors (e.g. no access) leave the panel hidden
    const load = useCallback(() => fetchNoticeContext(applicationId).then(setCtx, () => setCtx(null)), [applicationId]);

    useEffect(() => {
        let cancelled = false;
        fetchNoticeContext(applicationId)
            .then((c) => { if (!cancelled) setCtx(c); })
            .catch(() => { if (!cancelled) setCtx(null); });
        return () => { cancelled = true; };
    }, [applicationId]);

    // Live preview of the exact texts (debounced)
    const visible = Boolean(ctx?.can_send && ctx.outcome);
    useEffect(() => {
        if (!visible) return;
        let cancelled = false;
        const timer = setTimeout(() => {
            previewNotice(applicationId, reason, correction || ctx.already_sent)
                .then((p) => { if (!cancelled) setPreview(p); })
                .catch((err) => { if (!cancelled) setError(err.message); });
        }, 300);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [visible, applicationId, reason, correction, ctx?.already_sent]);

    if (!visible) return null;

    const isCorrection = ctx.already_sent;
    const outcome = OUTCOME_LABELS[ctx.outcome];
    const problem = preview?.problem;
    const canSubmit = !sending && preview && !problem && (isCorrection ? correction : true);

    const submit = async () => {
        setSending(true);
        setError(null);
        try {
            await sendNotice(applicationId, reason, isCorrection);
            setReason('');
            setCorrection(false);
            setConfirming(false);
            setSent(true);
            await load();
        } catch (err) {
            setError(err.message);
        } finally {
            setSending(false);
        }
    };

    return (
        <section aria-labelledby='send-notice-heading' className='my-3 rounded-lg border border-gray-300 bg-white p-4 text-left text-gray-900'>
            <h3 id='send-notice-heading' className='text-lg font-semibold text-gray-900'>Send notice to applicant</h3>
            <p className='text-gray-900'>
                Outcome: <span className='font-semibold text-gray-900'>{outcome}</span>
            </p>
            <p className='text-gray-800'>
                Sent in-app, by SMS {ctx.sms_to ? `(to ${ctx.sms_to})` : '(no valid mobile number: SMS will be skipped)'} and by email
                {ctx.email_to ? ` (to ${ctx.email_to})` : ' (no valid email address: email will be skipped)'}. No links are allowed.
            </p>

            {sent && <p role='status' className='mt-2 font-semibold text-green-800'>Notice sent. Delivery status is below.</p>}

            {isCorrection && (
                <div className='mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-gray-900'>
                    <p className='text-gray-900'>The notice for this outcome was already sent. You can send a correction; the first notice is kept.</p>
                    <label className='mt-1 flex items-center gap-2 text-gray-900'>
                        <input type='checkbox' checked={correction} onChange={(e) => setCorrection(e.target.checked)} />
                        Send a correction
                    </label>
                </div>
            )}

            {(!isCorrection || correction) && (
                <>
                    {ctx.suggestions.length > 0 && (
                        <div className='mt-3'>
                            <h4 className='font-semibold text-gray-900'>Suggestions from the file (internal: rewrite for the applicant)</h4>
                            <ul className='mt-1'>
                                {ctx.suggestions.map((s, i) => (
                                    <li key={i} className='flex items-start justify-between gap-3 border-b border-gray-200 py-2 text-gray-900'>
                                        <span className='min-w-0 text-gray-900'>
                                            <span className='block text-sm text-gray-700'>{s.source}</span>
                                            <span className='block whitespace-pre-wrap break-words text-gray-900'>{s.text}</span>
                                        </span>
                                        <button type='button' onClick={() => setReason(s.text.slice(0, ctx.max_length))}
                                            className='shrink-0 rounded border border-gray-400 bg-white px-3 py-1 text-blue-800 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600'>
                                            Use this
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    <label htmlFor='notice-reason' className='mt-3 block font-semibold text-gray-900'>
                        {ctx.outcome === 'DEFERRED' ? 'What is missing' : ctx.outcome === 'REJECTED' ? 'Reason' : 'Note (optional)'}
                    </label>
                    <p id='notice-reason-hint' className='text-sm text-gray-700'>{REASON_HINTS[ctx.outcome]}</p>
                    <textarea
                        id='notice-reason'
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        maxLength={ctx.max_length}
                        rows={3}
                        aria-describedby='notice-reason-hint notice-reason-count'
                        aria-invalid={Boolean(problem)}
                        className='mt-1 w-full rounded border border-gray-400 bg-white p-2 text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600' />
                    <p id='notice-reason-count' className='text-sm text-gray-700'>{reason.length} / {ctx.max_length}</p>
                    {problem && reason.trim() && <p role='alert' className='font-semibold text-red-800'>{problem}</p>}

                    {preview && (
                        <div className='mt-3 rounded border border-gray-300 bg-gray-50 p-3 text-gray-900'>
                            <h4 className='font-semibold text-gray-900'>What the applicant will receive</h4>
                            <p className='mt-1 text-sm font-semibold text-gray-800'>In the app</p>
                            <p className='text-gray-900'>{preview.in_app_title}</p>
                            <p className='text-gray-900'>{preview.in_app_body}</p>
                            <p className='mt-2 text-sm font-semibold text-gray-800'>
                                SMS ({preview.sms_text.length} characters, {smsSegments(preview.sms_text)} SMS)
                            </p>
                            <p className='whitespace-pre-wrap break-words text-gray-900'>{preview.sms_text}</p>
                            <p className='mt-2 text-sm font-semibold text-gray-800'>Email: {preview.email_subject}</p>
                            <p className='whitespace-pre-wrap break-words text-gray-900'>{preview.email_body}</p>
                        </div>
                    )}

                    {error && <p role='alert' className='mt-2 text-red-800'>{error}</p>}

                    {!confirming ? (
                        <button type='button' disabled={!canSubmit} onClick={() => setConfirming(true)}
                            className='mt-3 rounded bg-blue-800 px-4 py-2 text-white hover:bg-blue-900 disabled:bg-gray-300 disabled:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2'>
                            {isCorrection ? 'Send correction' : 'Send notice'}
                        </button>
                    ) : (
                        <div role='alertdialog' aria-labelledby='notice-confirm' className='mt-3 rounded border border-red-300 bg-red-50 p-3 text-gray-900'>
                            <p id='notice-confirm' className='font-semibold text-gray-900'>
                                Send this {isCorrection ? 'correction' : 'notice'} to the applicant now? It can't be edited or taken back.
                            </p>
                            <div className='mt-2 flex gap-3'>
                                <button type='button' onClick={submit} disabled={sending}
                                    className='rounded bg-blue-800 px-4 py-2 text-white hover:bg-blue-900 disabled:bg-gray-300 disabled:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2'>
                                    {sending ? 'Sending...' : 'Yes, send'}
                                </button>
                                <button type='button' onClick={() => setConfirming(false)} disabled={sending}
                                    className='rounded border border-gray-400 bg-white px-4 py-2 text-gray-900 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600'>
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}
                </>
            )}

            {ctx.notices.length > 0 && (
                <div className='mt-4'>
                    <div className='flex items-center justify-between'>
                        <h4 className='font-semibold text-gray-900'>Notices sent</h4>
                        <button type='button' onClick={load}
                            className='text-blue-800 underline hover:text-blue-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600'>
                            Refresh status
                        </button>
                    </div>
                    <ul>
                        {ctx.notices.map((n) => (
                            <li key={n.id} className='border-b border-gray-200 py-2 text-gray-900'>
                                <p className='text-gray-900'>
                                    <span className='font-semibold text-gray-900'>{OUTCOME_LABELS[n.outcome]}</span>
                                    {n.correction_of && <span className='text-gray-800'> (correction)</span>}
                                    <span className='text-sm text-gray-700'> · {new Date(n.sent_at).toLocaleString()} by {n.sent_by ?? 'Account Officer'}</span>
                                </p>
                                <p className='whitespace-pre-wrap break-words text-gray-900'>{n.in_app_body}</p>
                                <ul className='mt-1 flex flex-wrap gap-2'>
                                    {n.deliveries.map((d) => (
                                        <li key={d.channel} className={`rounded border px-2 text-sm ${d.status === 'FAILED' ? 'border-red-400 bg-red-50 text-red-900' : 'border-gray-400 bg-white text-gray-900'}`}>
                                            {d.channel === 'SMS' ? 'SMS' : 'Email'}{d.to ? ` ${d.to}` : ''}: {DELIVERY_LABELS[d.status] ?? d.status}
                                            {d.error ? ` (${d.error})` : ''}
                                        </li>
                                    ))}
                                </ul>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </section>
    );
};

export default SendNoticePanel;
