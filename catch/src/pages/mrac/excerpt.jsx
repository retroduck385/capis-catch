// Long policy text: a short preview that expands in place, so nothing is cut off in the middle of a sentence.
import { useState } from 'react';

const Excerpt = ({ text, preview = 220 }) => {
    const [open, setOpen] = useState(false);
    if (!text) return null;
    const long = text.length > preview;
    const shown = open || !long ? text : `${text.slice(0, preview).replace(/\s+\S*$/, '')}…`;
    return (
        <div>
            <span className="whitespace-pre-line">{shown}</span>
            {long && (
                <button type="button" className="underline text-xs ml-1" onClick={() => setOpen(!open)}>
                    {open ? 'show less' : 'show full text'}
                </button>
            )}
        </div>
    );
};

export default Excerpt;
