// Reminders of one document request in the request box (20261119_document_request_reminders.sql): each reminder the
// notice worker sent ("Reminder 1 sent on ...", with its SMS / email status) or skipped, and, for the request still
// waiting on the applicant, when the next one is due. Read-only; the database makes them, never the browser.
import { BellRing, Clock, Mail, Smartphone } from 'lucide-react';

const DELIVERY = {
    QUEUED: ['Queued', 'none'], RUNNING: ['Sending', 'info'], LOGGED: ['Logged (test mode, not sent)', 'info'],
    SENT: ['Sent', 'ok'], FAILED: ['Failed', 'err'], SKIPPED: ['Skipped', 'none'],
};
// "Nov 20, 2026, 9:02 AM", in Philippine time like the reminder window
const whenPH = (iso) => new Date(iso).toLocaleString('en-PH', {
    timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
});

// status: document_reminder_status() of the application; requestId: the request shown; current: it is still open
const Reminders = ({ status, requestId, current = false }) => {
    if (!status) return null;
    const rows = status.reminders.filter((r) => r.request_id === requestId);
    const next = current ? status.next : null;
    if (rows.length === 0 && !next) return null;
    return (
        <ul className="dr-reminders" aria-label="Reminders to the applicant">
            {rows.map((r) => (
                <li key={r.id}>
                    <BellRing size={15} aria-hidden="true" />
                    {r.status === 'SKIPPED' ? (
                        <span>Reminder {r.reminder_no}: {r.note ?? 'Skipped'}</span>
                    ) : (
                        <>
                            <span>Reminder {r.reminder_no} sent on {whenPH(r.created_at)}</span>
                            {r.deliveries.map((d) => {
                                const [label, tone] = DELIVERY[d.status] ?? [d.status, 'none'];
                                const Icon = d.channel === 'SMS' ? Smartphone : Mail;
                                return (
                                    <span key={d.channel} className={`dr-chip ${tone}`} title={d.error || undefined}>
                                        <Icon size={13} aria-hidden="true" />{d.channel === 'SMS' ? 'SMS' : 'Email'}: {label}
                                    </span>
                                );
                            })}
                        </>
                    )}
                </li>
            ))}
            {next && (
                <li className="next">
                    <Clock size={15} aria-hidden="true" />
                    <span>Next reminder ({next.reminder_no} of 2) on {whenPH(next.at)}, if the documents haven't been sent by then</span>
                </li>
            )}
        </ul>
    );
};

export default Reminders;
