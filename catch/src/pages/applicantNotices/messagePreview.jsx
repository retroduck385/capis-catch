// "What the applicant will receive": one panel with In the app / SMS / Email tabs (group notes, 2026-11-22), used by
// the AO's "Ask the applicant for documents" box and "Send notice to applicant". preview = what preview_* returns:
// { in_app_title, in_app_body, sms_text, email_subject, email_body }. Tabs follow the ARIA pattern (arrows, Home, End).
// Styles: messagePreview.css (on the --lf-* tokens with light fallbacks, so it reads the same in both panels).
import { useId, useRef, useState } from 'react';
import { Bell, Mail, Smartphone } from 'lucide-react';
import { smsSegments } from './sms';
import './messagePreview.css';

const TABS = [
    { key: 'app', label: 'In the app', Icon: Bell },
    { key: 'sms', label: 'SMS', Icon: Smartphone },
    { key: 'email', label: 'Email', Icon: Mail },
];

const MessagePreview = ({ preview, title = 'What the applicant will receive' }) => {
    const id = useId();
    const [tab, setTab] = useState('app');
    const refs = useRef({});
    if (!preview) return null;

    const onKey = (e) => {
        const at = TABS.findIndex((t) => t.key === tab);
        const next = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: TABS.length - 1 }[e.key];
        if (next === undefined) return;
        e.preventDefault();
        const key = TABS[(next + TABS.length) % TABS.length].key;
        setTab(key);
        refs.current[key]?.focus();
    };
    const sms = preview.sms_text ?? '';

    return (
        <div className="mp">
            <p className="mp-title" id={`${id}-t`}>{title}</p>
            <div className="mp-tabs" role="tablist" aria-labelledby={`${id}-t`} onKeyDown={onKey}>
                {TABS.map(({ key, label, Icon }) => (
                    <button key={key} type="button" role="tab" id={`${id}-${key}`} aria-controls={`${id}-panel`}
                        aria-selected={tab === key} tabIndex={tab === key ? 0 : -1}
                        ref={(el) => { refs.current[key] = el; }} onClick={() => setTab(key)}>
                        <Icon size={14} aria-hidden="true" />{label}
                    </button>
                ))}
            </div>
            <div className="mp-panel" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tab}`} tabIndex={0}>
                {tab === 'app' && (
                    <>
                        <p className="mp-head">{preview.in_app_title}</p>
                        <p className="mp-body">{preview.in_app_body}</p>
                    </>
                )}
                {tab === 'sms' && (
                    <>
                        <p className="mp-meta">{sms.length} characters · {smsSegments(sms)} SMS</p>
                        <p className="mp-body">{sms}</p>
                    </>
                )}
                {tab === 'email' && (
                    <>
                        <p className="mp-meta">Subject</p>
                        <p className="mp-head">{preview.email_subject}</p>
                        <p className="mp-body">{preview.email_body}</p>
                    </>
                )}
            </div>
        </div>
    );
};

export default MessagePreview;
