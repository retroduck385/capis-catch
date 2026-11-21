// The hidden / shown state of one page type's side panel (components/sidePanel.jsx), remembered in this browser
// (panelState.js).
import { useCallback, useState } from 'react';
import { readHidden, writeHidden } from './panelState';

// toggled: true once the viewer has pressed Hide / Show on this page: the button that replaces the pressed one then
// takes focus as it appears (autoFocus), but not on the first load
export const useSidePanel = (page) => {
    const [hidden, setHidden] = useState(() => readHidden(page));
    const [toggled, setToggled] = useState(false);
    const toggle = useCallback(() => {
        const next = !hidden;
        writeHidden(page, next);
        setHidden(next);
        setToggled(true);
    }, [page, hidden]);
    return { hidden, toggle, toggled };
};
