// Read-only detail modal: a native <dialog> over a dimmed page (Escape and a backdrop click close it), the tone as a
// top stripe, a fixed header and footer around a scrolling body. Used where a summary row or tile opens its details
// in place, so the page underneath (and any draft on it) stays put: the review summary's Decision support tiles
// (decisionSupport/briefDialog.jsx) and its credit score categories (review/scoreCategoryDialog.jsx).
// Also the Financial Package's TU report popup (financialPackage/tuReport.jsx), widened through className.
// link: { to, label } opens the full page in a new tab. Tones are the .lf ones (.ok / .warn / .bad / .none).
// Styles: infoModal.css (.info-modal).
import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, X } from 'lucide-react';
import './infoModal.css';

const InfoModal = ({ Icon, tone = 'none', eyebrow, title, note, link, onClose, className = '', children }) => {
    const ref = useRef(null);
    const close = () => ref.current?.close();

    useEffect(() => {
        const d = ref.current;
        if (d && !d.open) d.showModal();
    }, []);

    return (
        <dialog ref={ref} className={`info-modal ${tone}${className ? ` ${className}` : ''}`}aria-label={eyebrow ? `${title} (${eyebrow})` : title}
            onClose={onClose}
            onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
            <header className="info-modal-head">
                {Icon && <span className="ic" aria-hidden="true"><Icon size={18} /></span>}
                <p>{eyebrow && <>{eyebrow} <span aria-hidden="true">·</span> </>}<b>{title}</b></p>
                <button type="button" className="info-modal-x" onClick={close} aria-label="Close">
                    <X size={18} aria-hidden="true" />
                </button>
            </header>

            <div className="info-modal-body">{children}</div>

            <footer className="info-modal-foot">
                {note && <span>{note}</span>}
                <div className="acts">
                    <button type="button" className="info-modal-close" onClick={close}>Close</button>
                    {link && (
                        <Link to={link.to} target="_blank" rel="noopener" className="info-modal-go">
                            {link.Icon && <link.Icon size={14} aria-hidden="true" />}{link.label}<ExternalLink size={13} aria-hidden="true" />
                            <span className="sr-only"> (opens in a new tab)</span>
                        </Link>
                    )}
                </div>
            </footer>
        </dialog>
    );
};

export default InfoModal;
