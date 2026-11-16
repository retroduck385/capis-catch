// Acronym hovers for staff pages. Hovering, focusing with the keyboard (Tab) or tapping a term shows a one-line
// explanation from src/glossary.js; Esc, moving the mouse away, tabbing away or tapping elsewhere hides it.
//   <Term k="DBR" />                 one term
//   <Terms text="DBR / LCR" />       a text: every known term in it gets the hover
//   <Terms>NFIS and TU ...</Terms>   the same for the plain-text children (nested elements are left as they are)
// Inside a button, a link or a form label use a title attribute instead (useTermTitle.js): the term is focusable
// itself, so it must not be nested in another control.
// Staff only: for an applicant (or signed out) everything renders as plain text.
//
// The tip is rendered into document.body (a portal), so a card, a table, an overflow box or the Messages drawer
// can't clip or shift it. It sits under the word (above it when there is no room below), as wide as its text up to
// 288px, kept 8px inside the screen edges, and follows the word while the page scrolls.
import { Children, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { UserAuth } from '../context/authContext';
import { explain, splitTerms } from '../glossary';
import { STAFF_ROLES } from '../roles';

const WIDTH = 288;  // widest the tip gets (px)
const EDGE = 8;     // kept this far inside the screen
const GAP = 6;      // between the word and the tip

// Puts the tip under (or above) the word; hides it while the word is scrolled out of view
const place = (word, tip) => {
    const b = word.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    if (b.bottom < 0 || b.top > vh || (b.width === 0 && b.height === 0)) {
        tip.style.visibility = 'hidden';
        return;
    }
    tip.style.maxWidth = `${Math.min(WIDTH, vw - 2 * EDGE)}px`;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const left = Math.max(EDGE, Math.min(b.left + b.width / 2 - w / 2, vw - w - EDGE));
    const below = b.bottom + GAP;
    const above = b.top - GAP - h;
    const top = below + h > vh - EDGE && above >= EDGE ? above : below;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
    tip.style.visibility = 'visible';
};

const Tip = ({ k, children }) => {
    const id = useId();
    const wordRef = useRef(null);
    const tipRef = useRef(null);
    const [open, setOpen] = useState(false);

    // While it shows: place it, follow scrolling / resizing, and hide on Esc or a tap elsewhere
    useLayoutEffect(() => {
        if (!open) return undefined;
        const update = () => { if (wordRef.current && tipRef.current) place(wordRef.current, tipRef.current); };
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        const onDown = (e) => { if (!wordRef.current?.contains(e.target)) setOpen(false); };
        update();
        window.addEventListener('scroll', update, true);
        window.addEventListener('resize', update);
        document.addEventListener('keydown', onKey);
        document.addEventListener('pointerdown', onDown);
        return () => {
            window.removeEventListener('scroll', update, true);
            window.removeEventListener('resize', update);
            document.removeEventListener('keydown', onKey);
            document.removeEventListener('pointerdown', onDown);
        };
    }, [open]);

    const show = () => setOpen(true);
    const hide = () => setOpen(false);

    return (
        <span ref={wordRef} tabIndex={0} aria-describedby={open ? id : undefined}
            onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide} onClick={show}
            className='cursor-help rounded-sm underline decoration-dotted decoration-1 underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600'>
            {children ?? k}
            {open && createPortal(
                <span ref={tipRef} id={id} role='tooltip'
                    style={{ position: 'fixed', left: 0, top: 0, width: 'max-content', maxWidth: WIDTH, visibility: 'hidden', zIndex: 1000 }}
                    className='pointer-events-none block whitespace-normal break-words rounded border border-gray-700 bg-gray-900 px-2.5 py-1.5 text-left text-sm font-normal normal-case not-italic leading-snug tracking-normal text-white shadow-lg'>
                    <b className='font-semibold text-white'>{k}</b>: {explain(k)}
                </span>,
                document.body,
            )}
        </span>
    );
};

const isStaff = (role) => STAFF_ROLES.includes(role);

const split = (text) => splitTerms(text).map((p, i) => (
    // the index is a fine key here: the parts of one fixed text never reorder
    p.term ? <Tip key={i} k={p.term} /> : p.text));

export const Term = ({ k, children }) => {
    const role = UserAuth()?.role;
    return isStaff(role) && explain(k) ? <Tip k={k}>{children}</Tip> : (children ?? k);
};

// text: a string (anything else - a number, JSX - passes through unchanged); or children, whose plain-text parts
// get the hovers
export const Terms = ({ text, children }) => {
    const role = UserAuth()?.role;
    const content = text !== undefined ? text : children;
    if (!isStaff(role)) return content ?? null;
    if (typeof content === 'string') return split(content);
    if (text !== undefined) return content ?? null;
    return Children.map(children, (c) => (typeof c === 'string' ? split(c) : c));
};
