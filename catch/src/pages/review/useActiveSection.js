// Highlight for a section navigator (review summary, VII. Approval). While scrolling by hand it follows the last
// section whose top has passed ~30% of the viewport (or the last section once the page is scrolled to the end).
// The last sections are short, so clicking one can't always scroll it up to that line: a click (`pick`) therefore
// sets the highlight itself and keeps it until the user scrolls, drags or presses a key.
// ids: element ids in page order (pass a stable array); ready: true once the sections are rendered.
import { useEffect, useRef, useState } from 'react';

export const useActiveSection = (ids, ready) => {
    const [active, setActive] = useState(ids[0]);
    const locked = useRef(false);

    useEffect(() => {
        if (!ready) return undefined;
        const sections = () => ids.map((id) => document.getElementById(id)).filter(Boolean);
        const update = (event) => {
            if (locked.current) return;
            const list = sections();
            if (list.length === 0) return;
            const scroller = event?.target && event.target !== document ? event.target : document.scrollingElement;
            const atEnd = scroller && scroller.scrollHeight > scroller.clientHeight
                && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
            const line = window.innerHeight * 0.3;
            const passed = list.filter((el) => el.getBoundingClientRect().top <= line);
            setActive((atEnd ? list.at(-1) : passed.at(-1) ?? list[0]).id);
        };
        const unlock = () => { locked.current = false; };
        const unlockEvents = ['wheel', 'touchstart', 'keydown', 'pointerdown'];
        let frame = 0;
        const onScroll = (e) => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => update(e));
        };
        update();
        // capture: also catches scrolling inside a layout container, not only the window
        window.addEventListener('scroll', onScroll, true);
        unlockEvents.forEach((t) => window.addEventListener(t, unlock, { passive: true }));
        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener('scroll', onScroll, true);
            unlockEvents.forEach((t) => window.removeEventListener(t, unlock));
        };
    }, [ids, ready]);

    const pick = (id) => {
        locked.current = true;
        setActive(id);
    };
    return [active, pick];
};

// Smooth scroll to a section, honouring reduced motion
export const scrollToSection = (id) => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    document.getElementById(id)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
};
