// One KYC clarification thread, read only: the AO's question, the applicant's replies (with any file) and the AO's
// answers, oldest first. viewer: 'STAFF' (names of the AO who wrote) or 'APPLICANT' (roles only: "Your Account Officer").
// Styles: kycClarify.css (.kq-*), on the page's tokens with light fallbacks, so it reads the same on staff and applicant pages.
import { Paperclip } from 'lucide-react';
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
                            <b>{i === 0 ? 'Question' : (viewer === 'STAFF' && m.by ? m.by : fromLabel(m.from, viewer))}</b>
                            {i === 0 && viewer === 'STAFF' && m.by && <span> from {m.by}</span>}
                            <time dateTime={m.created_at} title={fullWhen(m.created_at)}>{formatWhen(m.created_at)}</time>
                        </p>
                        <p className="kq-body">{m.body}</p>
                        {m.files.map((f) => (
                            <button key={f.id} type="button" className="kq-file" onClick={() => view(f.file_path)}>
                                <Paperclip size={14} aria-hidden="true" />{f.file_name}
                            </button>
                        ))}
                    </li>
                ))}
            </ol>
            {error && <p className="kq-err" role="alert">{error}</p>}
        </>
    );
};

export default ThreadView;
