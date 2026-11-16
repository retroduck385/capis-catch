// Animated dropdown for forms (applicationForm/fields.jsx's Field), in place of a native <select>, whose menu can't be
// styled or animated. Same behaviour as the work tray's FilterSelect, plus what a form field needs: a label, the
// "Select one" empty choice, error / hint wiring, disabled, type-ahead, and a menu that opens upward near the
// bottom of the screen. Styles: selectMenu.css (sized like the form's text inputs).
// Keyboard (as a native select): Enter / Space / arrows open; arrows, Home / End, PageUp / PageDown move; typing jumps
// to the first option starting with those letters; Enter / Space choose; Esc closes; Tab closes and moves on.
// ARIA: a button (named by the field's label plus the current value) and a listbox with aria-activedescendant.
// onChange gets the option's value as a string ('' for "Select one"), the same as a native select's e.target.value.
import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import './selectMenu.css';

const MENU_ROOM = 300; // px the menu needs below the button before it opens upward instead

// Name: labelId (a visible label) + the value; or, with no visible label, aria-label + the value ("Sex: Male")
const SelectMenu = ({ id, labelId, value, options, onChange, placeholder = 'Select one', disabled = false, 'aria-label': ariaLabel, ...aria }) => {
    const [open, setOpen] = useState(false);
    const [up, setUp] = useState(false);
    const [hi, setHi] = useState(0);
    const wrapRef = useRef(null);
    const buttonRef = useRef(null);
    const listRef = useRef(null);
    const typed = useRef({ text: '', timer: null });

    const all = [{ value: '', label: placeholder, empty: true }, ...options];
    const current = String(value ?? '');
    const at = Math.max(0, all.findIndex((o) => String(o.value) === current));
    const shown = all[at];

    const openList = (start = at) => {
        const box = buttonRef.current?.getBoundingClientRect();
        setUp(!!box && window.innerHeight - box.bottom < MENU_ROOM && box.top > window.innerHeight - box.bottom);
        setHi(start);
        setOpen(true);
    };
    const close = (refocus = true) => {
        setOpen(false);
        if (refocus) buttonRef.current?.focus();
    };
    const choose = (i) => {
        onChange(String(all[i].value));
        close();
    };

    // Type-ahead: letters typed within 0.7s add up ("ma" -> "Married"); one letter again cycles through matches
    const findTyped = (key, from) => {
        const t = typed.current;
        clearTimeout(t.timer);
        t.text = t.text === key ? key : t.text + key;
        t.timer = setTimeout(() => { t.text = ''; }, 700);
        const order = [...all.keys()].slice(1).map((n) => (from + n) % all.length);
        if (t.text.length > 1) order.unshift(from);
        return order.find((i) => !all[i].empty && all[i].label.toLowerCase().startsWith(t.text)) ?? null;
    };

    // Focus the list when it opens; close on a click outside
    useEffect(() => {
        if (!open) return undefined;
        listRef.current?.focus();
        const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [open]);
    // Keep the highlighted option in view in a long list
    useEffect(() => {
        if (open) listRef.current?.querySelector(`[data-i="${hi}"]`)?.scrollIntoView({ block: 'nearest' });
    }, [open, hi]);
    useEffect(() => () => clearTimeout(typed.current.timer), []);

    const onButtonKey = (e) => {
        if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
            e.preventDefault();
            openList();
        } else if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const i = findTyped(e.key.toLowerCase(), at);
            if (i !== null) openList(i);
        }
    };
    const onListKey = (e) => {
        const last = all.length - 1;
        const moves = {
            ArrowDown: () => setHi((i) => Math.min(last, i + 1)),
            ArrowUp: () => setHi((i) => Math.max(0, i - 1)),
            Home: () => setHi(0),
            End: () => setHi(last),
            PageDown: () => setHi((i) => Math.min(last, i + 8)),
            PageUp: () => setHi((i) => Math.max(0, i - 8)),
            Enter: () => choose(hi),
            ' ': () => choose(hi),
            Escape: () => close(),
        };
        if (e.key === 'Tab') { close(false); return; }
        if (moves[e.key]) { e.preventDefault(); moves[e.key](); return; }
        if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const i = findTyped(e.key.toLowerCase(), hi);
            if (i !== null) setHi(i);
        }
    };

    return (
        <div ref={wrapRef} className={['ct-select', open ? 'open' : '', up ? 'up' : ''].filter(Boolean).join(' ')}>
            <button ref={buttonRef} id={id} type="button" className="ct-select-btn" disabled={disabled}
                aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${id}-list` : undefined}
                aria-labelledby={labelId ? `${labelId} ${id}-value` : undefined}
                aria-label={!labelId && ariaLabel ? `${ariaLabel}: ${shown.label}` : undefined} {...aria}
                onClick={() => (open ? close() : openList())} onKeyDown={onButtonKey}>
                {/* keyed by the value, so a new choice fades in */}
                <span key={current} id={`${id}-value`} className={`val${shown.empty ? ' ph' : ''}`}>{shown.label}</span>
                <ChevronDown className="chev" size={18} aria-hidden="true" />
            </button>
            {open && (
                <ul ref={listRef} id={`${id}-list`} role="listbox" tabIndex={-1} aria-labelledby={labelId}
                    aria-activedescendant={`${id}-opt-${hi}`} onKeyDown={onListKey}>
                    {all.map((o, i) => (
                        <li key={`${o.value}`} id={`${id}-opt-${i}`} data-i={i} role="option" aria-selected={i === at}
                            className={[i === hi ? 'hi' : '', o.empty ? 'ph' : ''].filter(Boolean).join(' ') || undefined}
                            style={{ '--i': Math.min(i, 10) }}
                            onMouseEnter={() => setHi(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(i)}>
                            <span>{o.label}</span>
                            {i === at && !o.empty && <Check size={16} strokeWidth={2.6} aria-hidden="true" />}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

export default SelectMenu;
