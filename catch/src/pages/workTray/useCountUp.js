// Counts a number up (or down) to its new value with an ease-out, for the work tray's tiles and donut.
// Starts from 0 on first render; later changes animate from the last shown value. With reduced motion it
// just returns the value.
import { useEffect, useMemo, useRef, useState } from 'react';

export const useCountUp = (target, duration = 700) => {
    const reduce = useMemo(
        () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
        [],
    );
    const [shown, setShown] = useState(0);
    const current = useRef(0);

    useEffect(() => {
        if (reduce) return undefined;
        const from = current.current;
        const start = performance.now();
        let raf;
        const tick = (now) => {
            const p = Math.min(1, (now - start) / duration);
            const eased = 1 - (1 - p) ** 3;
            const value = Math.round(from + (target - from) * eased);
            current.current = value;
            setShown(value);
            if (p < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [target, duration, reduce]);

    return reduce ? target : shown;
};
