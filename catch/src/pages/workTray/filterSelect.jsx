// Animated filter dropdown for the work tray toolbar (a native <select>'s menu can't be animated).
// A button shows the current choice; it opens a listbox that drops in, with a moving highlight and a tick on the
// selected option. Keyboard: Enter / Space / arrows open it; arrows, Home / End move; Enter / Space choose;
// Esc closes; Tab closes and moves on. A click outside closes it. ARIA: button + listbox with
// aria-activedescendant, so screen readers announce the highlighted option.
import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

// title: optional tooltip on the button; an option's own `title` shows on that option
const FilterSelect = ({ label, value, options, onChange, active = false, title }) => {
    const id = useId();
    const [open, setOpen] = useState(false);
    const [hi, setHi] = useState(0);
    const wrapRef = useRef(null);
    const buttonRef = useRef(null);
    const listRef = useRef(null);
    const current = options.find((o) => o.value === value) ?? options[0];

    const openList = () => {
        setHi(Math.max(0, options.findIndex((o) => o.value === value)));
        setOpen(true);
    };
    const close = (refocus = true) => {
        setOpen(false);
        if (refocus) buttonRef.current?.focus();
    };
    const choose = (v) => {
        onChange(v);
        close();
    };

    // Focus the list when it opens; close on a click outside
    useEffect(() => {
        if (!open) return undefined;
        listRef.current?.focus();
        const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [open]);

    const onListKey = (e) => {
        const last = options.length - 1;
        const moves = {
            ArrowDown: () => setHi((i) => Math.min(last, i + 1)),
            ArrowUp: () => setHi((i) => Math.max(0, i - 1)),
            Home: () => setHi(0),
            End: () => setHi(last),
            Enter: () => choose(options[hi].value),
            ' ': () => choose(options[hi].value),
            Escape: () => close(),
        };
        if (e.key === 'Tab') { close(false); return; }
        if (moves[e.key]) { e.preventDefault(); moves[e.key](); }
    };

    return (
        <div ref={wrapRef} className={['wt-fsel', active ? 'on' : '', open ? 'open' : ''].join(' ')}>
            <button
                ref={buttonRef}
                type='button'
                aria-haspopup='listbox'
                aria-expanded={open}
                aria-label={`${label}: ${current.label}`}
                title={title}
                onClick={() => (open ? close() : openList())}
                onKeyDown={(e) => {
                    if (['ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); openList(); }
                }}>
                <span className='lbl'>{current.label}</span>
                <ChevronDown className='chev' size={16} aria-hidden='true' />
            </button>
            {open && (
                <ul
                    ref={listRef}
                    role='listbox'
                    tabIndex={-1}
                    aria-label={label}
                    aria-activedescendant={`${id}-${hi}`}
                    onKeyDown={onListKey}>
                    {options.map((o, i) => (
                        <li
                            key={o.value}
                            id={`${id}-${i}`}
                            role='option'
                            aria-selected={o.value === value}
                            className={i === hi ? 'hi' : undefined}
                            style={{ '--i': i }}
                            title={o.title}
                            onMouseEnter={() => setHi(i)}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => choose(o.value)}>
                            <span>{o.label}</span>
                            {o.value === value && <Check size={15} strokeWidth={2.6} aria-hidden='true' />}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

export default FilterSelect;
