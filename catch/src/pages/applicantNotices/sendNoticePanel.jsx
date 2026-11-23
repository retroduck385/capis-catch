import { useCallback, useEffect, useState } from 'react';
import { Bell, CheckCircle2, ChevronDown, Mail, Megaphone, RefreshCw, Send, Smartphone } from 'lucide-react';
import { fetchNoticeContext, previewNotice, sendNotice } from './api';
import MessagePreview from './messagePreview';
import { Terms } from '../../components/term';
import Byline from '../../components/byline';
import '../documentRequests/requestPanel.css';
import './sendNoticePanel.css';

// "Send notice to applicant" (the bank's answer to Q-42): the assigned Account Officer tells the applicant the outcome
// and a reason, in-app, by SMS and by email. Shown only to the assigned AO, once the status is Approved / Rejected /
// Deferred (applicant_notice_context() decides).
// In the staff look like "Ask the applicant for documents" (DESIGN.md, "Send notice"): a disclosure card on the
// requestPanel.css (dr-*) styles, so it follows dark mode on the loan folder. Open by default until the notice is sent.
// Extra layout: sendNoticePanel.css.

const OUTCOME = { APPROVED: ['Approved', 'ok'], REJECTED: ['Rejected', 'none'], DEFERRED: ['Deferred', 'warn'] };
const REASON_HINTS = {
    APPROVED: 'Optional. Leave empty to say "Your Account Officer will contact you about the next steps."',
    REJECTED: 'Required: the policy the applicant most likely did not pass.',
    DEFERRED: 'Required: what is missing.',
};
// [label, chip tone], as in the document request panel
const DELIVERY = {
    QUEUED: ['Queued', 'none'], RUNNING: ['Sending', 'info'], LOGGED: ['Logged (test mode, not sent)', 'info'],
    SENT: ['Sent', 'ok'], FAILED: ['Failed', 'err'], SKIPPED: ['Skipped', 'none'],
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
    const [expanded, setExpanded] = useState(null);    // null = not toggled yet: open until the notice is sent

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
    // document requests and KYC questions are notices too (20261112), but they have their own panels
    const notices = ctx.notices.filter((n) => !['DOCUMENTS_NEEDED', 'CLARIFICATION'].includes(n.outcome));
    const [outcome, outcomeTone] = OUTCOME[ctx.outcome] ?? [ctx.outcome, 'none'];
    const problem = preview?.problem;
    const canSubmit = !sending && preview && !problem && (isCorrection ? correction : true);
    const open = expanded ?? !isCorrection;

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
        <details open={open} onToggle={(e) => setExpanded(e.currentTarget.open)} className="dr sn">
            <summary className="dr-head">
                <span className="dr-ic" aria-hidden="true"><Megaphone size={18} /></span>
                <h3>Send notice to applicant</h3>
                <span className={`dr-chip ${outcomeTone}`}>Outcome: {outcome}</span>
                {isCorrection
                    ? <span className="dr-chip ok"><CheckCircle2 size={13} aria-hidden="true" />Notice sent</span>
                    : <span className="dr-chip warn">Not sent yet</span>}
                <ChevronDown size={20} className="dr-chev" aria-hidden="true" />
            </summary>

            <div className="dr-body">
                {sent && <p role="status" className="dr-strip ok"><CheckCircle2 size={16} aria-hidden="true" /><span>Notice sent. Delivery status is below.</span></p>}
                {error && <p role="alert" className="dr-err">{error}</p>}

                {isCorrection && (
                    <div className="dr-group">
                        <p className="dr-strip info">
                            <Megaphone size={16} aria-hidden="true" />
                            <span>The notice for this outcome was already sent. You can send a correction; the first notice is kept.</span>
                        </p>
                        <label className="dr-pick sn-pick">
                            <input type="checkbox" checked={correction} onChange={(e) => setCorrection(e.target.checked)} />
                            <span className="dr-pick-txt"><b>Send a correction</b></span>
                        </label>
                    </div>
                )}

                {(!isCorrection || correction) && (
                    <section className="dr-form" aria-label={isCorrection ? 'Correction' : 'New notice'}>
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
                            <p className="dr-muted">No links are allowed.</p>
                        </div>

                        {ctx.suggestions.length > 0 && (
                            <div className="dr-group">
                                <h4 className="dr-h">Suggestions from the file <small>internal: rewrite it for the applicant</small></h4>
                                <ul className="dr-suggestions">
                                    {ctx.suggestions.map((s, i) => (
                                        <li key={i} className="dr-suggestion">
                                            <span className="dr-suggestion-txt">
                                                <span className="dr-source"><Terms text={s.source} /></span>
                                                <span>{s.text}</span>
                                            </span>
                                            <button type="button" className="dr-btn small" onClick={() => setReason(s.text.slice(0, ctx.max_length))}>Use this</button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        <div className="dr-group">
                            <label htmlFor="notice-reason" className="dr-h">
                                {ctx.outcome === 'DEFERRED' ? 'What is missing' : ctx.outcome === 'REJECTED' ? 'Reason' : 'Note'}
                                {ctx.outcome === 'APPROVED' && <small>optional</small>}
                            </label>
                            <p id="notice-reason-hint" className="dr-muted">{REASON_HINTS[ctx.outcome]}</p>
                            <textarea id="notice-reason" className="dr-input" value={reason} maxLength={ctx.max_length} rows={3}
                                onChange={(e) => setReason(e.target.value)} aria-describedby="notice-reason-hint notice-reason-count"
                                aria-invalid={Boolean(problem && reason.trim())} />
                            <p id="notice-reason-count" className="dr-counter">{reason.length} / {ctx.max_length}</p>
                            {problem && reason.trim() && <p role="alert" className="dr-err">{problem}</p>}
                        </div>

                        {preview && (
                            <div className="dr-group">
                                <MessagePreview preview={preview} />
                            </div>
                        )}

                        {!confirming ? (
                            <div className="dr-acts">
                                <button type="button" className="dr-primary" disabled={!canSubmit} onClick={() => setConfirming(true)}>
                                    <Send size={16} aria-hidden="true" />{isCorrection ? 'Send correction' : 'Send notice'}
                                </button>
                            </div>
                        ) : (
                            <div role="alertdialog" aria-labelledby="notice-confirm" className="dr-confirm">
                                <p id="notice-confirm" className="dr-confirm-title">
                                    Send this {isCorrection ? 'correction' : 'notice'} to the applicant now? It can&apos;t be edited or taken back.
                                </p>
                                <div className="dr-acts">
                                    <button type="button" className="dr-primary" disabled={sending} onClick={submit}>
                                        <Send size={16} aria-hidden="true" />{sending ? 'Sending...' : 'Yes, send'}
                                    </button>
                                    <button type="button" className="dr-btn quiet" disabled={sending} onClick={() => setConfirming(false)}>Cancel</button>
                                </div>
                            </div>
                        )}
                    </section>
                )}

                {notices.length > 0 && (
                    <section className="sn-sent" aria-labelledby="notice-sent-heading">
                        <div className="sn-sent-head">
                            <h4 id="notice-sent-heading">Notices sent</h4>
                            <button type="button" className="dr-icon-btn" onClick={load} aria-label="Refresh delivery status" title="Refresh">
                                <RefreshCw size={16} aria-hidden="true" />
                            </button>
                        </div>
                        <ul className="dr-items">
                            {notices.map((n) => {
                                const [label, tone] = OUTCOME[n.outcome] ?? [n.outcome, 'none'];
                                return (
                                    <li key={n.id} className="dr-item sn-notice">
                                        <div className="sn-notice-head">
                                            <span className={`dr-chip ${tone}`}>{label}</span>
                                            {n.correction_of && <span className="dr-chip info">Correction</span>}
                                            <span className="dr-by">Sent by <Byline layout="inline" name={n.sent_by} fallback="Account Officer" at={n.sent_at} /></span>
                                        </div>
                                        <p className="dr-quote">{n.in_app_body}</p>
                                        {n.deliveries?.length > 0 && (
                                            <ul className="dr-chips" aria-label="Delivery">
                                                {n.deliveries.map((d) => {
                                                    const [dLabel, dTone] = DELIVERY[d.status] ?? [d.status, 'none'];
                                                    const Icon = d.channel === 'SMS' ? Smartphone : Mail;
                                                    return (
                                                        <li key={d.channel} className={`dr-chip ${dTone}`} title={d.error || undefined}>
                                                            <Icon size={13} aria-hidden="true" />
                                                            {d.channel === 'SMS' ? 'SMS' : 'Email'}{d.to ? ` ${d.to}` : ''}: {dLabel}
                                                            {d.error && <span className="sr-only"> ({d.error})</span>}
                                                        </li>
                                                    );
                                                })}
                                            </ul>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    </section>
                )}
            </div>
        </details>
    );
};

export default SendNoticePanel;
