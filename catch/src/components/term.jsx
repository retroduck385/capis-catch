// Acronym hovers for staff pages. Hovering, focusing with the keyboard (Tab) or tapping a term shows a one-line
// explanation from src/glossary.js; Esc, moving away, tapping elsewhere or scrolling hides it.
//   <Term k="DBR" />            one term
//   <Terms text="DBR / LCR" />  a text: the first time each known term appears gets the hover, the rest stays plain
// Staff only: for an applicant (or signed out) both render the plain text.
// Never put one inside a button, a link or a form input: the term is focusable itself.
import { useEffect, useId, useRef, useState } from 'react';
import { UserAuth } from '../context/authContext';
import { explain, splitTerms } from '../glossary';
import { STAFF_ROLES } from '../roles';

const WIDTH = 288; // the tip's widest (px), to keep it on screen

const Tip = ({ k }) => {
    const id = useId();
    const ref = useRef(null);
    const [at, setAt] = useState(null);   // { left, top } on screen, or null = hidden

    const show = () => {
        const box = ref.current?.getBoundingClientRect();
        if (!box) return;
        setAt({
            left: Math.max(8, Math.min(box.left, window.innerWidth - WIDTH - 8)),
            top: box.bottom + 6,
        });
    };
    const hide = () => setAt(null);

    // While it shows: Esc, a tap elsewhere or scrolling hides it
    useEffect(() => {
        if (!at) return undefined;
        const onKey = (e) => { if (e.key === 'Escape') setAt(null); };
        const onDown = (e) => { if (!ref.current?.contains(e.target)) setAt(null); };
        const onScroll = () => setAt(null);
        document.addEventListener('keydown', onKey);
        document.addEventListener('pointerdown', onDown);
        window.addEventListener('scroll', onScroll, true);
        return () => {
            document.removeEventListener('keydown', onKey);
            document.removeEventListener('pointerdown', onDown);
            window.removeEventListener('scroll', onScroll, true);
        };
    }, [at]);

    return (
        <span ref={ref} tabIndex={0} aria-describedby={at ? id : undefined}
            onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}
            onClick={() => (at ? hide() : show())}
            className='cursor-help rounded-sm underline decoration-dotted decoration-1 underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600'>
            {k}
            {at && (
                <span id={id} role='tooltip' style={{ left: at.left, top: at.top, maxWidth: WIDTH }}
                    className='pointer-events-none fixed z-[60] block rounded border border-gray-700 bg-gray-900 px-2.5 py-1.5 text-left text-sm font-normal normal-case leading-snug tracking-normal text-white shadow-lg'>
                    {explain(k)}
                </span>
            )}
        </span>
    );
};

const isStaff = (role) => STAFF_ROLES.includes(role);

export const Term = ({ k }) => {
    const role = UserAuth()?.role;
    return isStaff(role) && explain(k) ? <Tip k={k} /> : k;
};

// Anything that isn't a text (a number, a date already formatted, JSX) is passed through unchanged
export const Terms = ({ text }) => {
    const role = UserAuth()?.role;
    if (typeof text !== 'string' || !isStaff(role)) return text ?? null;
    // the index is a fine key here: the parts of one fixed text never reorder
    return splitTerms(text).map((p, i) => (p.term ? <Tip key={i} k={p.term} /> : p.text));
};
