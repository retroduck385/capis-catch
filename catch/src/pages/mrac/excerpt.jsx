// Long policy text: a short preview that expands in place, so nothing is cut off in the middle of a sentence.
import { useState } from 'react';

const Excerpt = ({ text, preview = 220 }) => {
    const [open, setOpen] = useState(false);
    if (!text) return null;
    const long = text.length > preview;
    const shown = open || !long ? text : `${text.slice(0, preview).replace(/\s+\S*$/, '')}…`;
    return (
        <div className="body">
            <span className="whitespace-pre-line">{shown}</span>
            {long && (
                <button type="button" className="mrac-more" aria-expanded={open} onClick={() => setOpen(!open)}>
                    {open ? 'Show less' : 'Show full text'}
                </button>
            )}
        </div>
    );
};

export default Excerpt;
