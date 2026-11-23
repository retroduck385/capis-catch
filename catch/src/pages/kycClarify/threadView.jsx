// One KYC clarification thread, read only: the AO's question, the applicant's replies (with any file) and the AO's
// answers, oldest first. viewer: 'STAFF' (names of the AO who wrote) or 'APPLICANT' (roles only: "Your Account Officer").
// Styles: kycClarify.css (.kq-*), on the page's tokens with light fallbacks, so it reads the same on staff and applicant pages.
import { ExternalLink, FileText, Image } from 'lucide-react';
import { useState } from 'react';
import { fullWhen, formatWhen } from '../../components/people';
import { clarificationFileUrl } from './api';
import { fromLabel } from './sections';
import './kycClarify.css';

const ThreadView = ({ thread, viewer = 'STAFF' }) => {
    const [error, setError] = useState(null);
    const view = async (path) => {
        try { window.open(await clarificationFileUrl(path), '_blank', 'noopener'); } catch (err) { setError(err.message); }
    };
    return (
        <>
            <ol className="kq-thread">
                {thread.messages.map((m, i) => (
                    <li key={m.id} className={`kq-msg ${m.from === 'APPLICANT' ? 'from-applicant' : 'from-ao'}`}>
                        <p className="kq-meta">
                            <span className="kq-who">
                                <b>{i === 0 ? 'Question' : (viewer === 'STAFF' && m.by ? m.by : fromLabel(m.from, viewer))}</b>
                                {i === 0 && viewer === 'STAFF' && m.by && <span>from {m.by}</span>}
                            </span>
                            <time dateTime={m.created_at} title={fullWhen(m.created_at)}>{formatWhen(m.created_at)}</time>
                        </p>
                        <p className="kq-body">{m.body}</p>
                        {m.files.map((f) => {
                            const Icon = /\.pdf$/i.test(f.file_name) ? FileText : Image;
                            return (
                                <button key={f.id} type="button" className="kq-attachment" onClick={() => view(f.file_path)}
                                    title={f.file_name} aria-label={`Open ${f.file_name} (new tab)`}>
                                    <span className="kq-attachment-ic" aria-hidden="true"><Icon size={16} /></span>
                                    <span className="kq-attachment-name">{f.file_name}</span>
                                    <ExternalLink size={14} className="kq-attachment-go" aria-hidden="true" />
                                </button>
                            );
                        })}
                    </li>
                ))}
            </ol>
            {error && <p className="kq-err" role="alert">{error}</p>}
        </>
    );
};

export default ThreadView;
