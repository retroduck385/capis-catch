// The pages a staff member has clicked through for one application, kept for the browser session so the breadcrumb
// can show the real path. State is { path, ahead }: `path` runs up to the current page; `ahead` holds the pages that
// were stepped back over, so they can be shown faded and reopened. The work tray clears everything: opening a row
// there starts a fresh trail.
const PREFIX = 'catch-trail:';

export const trailKey = (userId, appId) => `${PREFIX}${userId ?? 'anon'}:${appId}`;

export const readTrail = (key) => {
    try {
        const state = JSON.parse(sessionStorage.getItem(key));
        if (Array.isArray(state)) return { path: state, ahead: [] };
        return { path: state?.path ?? [], ahead: state?.ahead ?? [] };
    } catch { return { path: [], ahead: [] }; }
};

export const writeTrail = (key, state) => {
    try { sessionStorage.setItem(key, JSON.stringify(state)); } catch { /* storage unavailable */ }
};

export const clearTrails = () => {
    try {
        Object.keys(sessionStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => sessionStorage.removeItem(k));
    } catch { /* storage unavailable */ }
};

// Landing on `page`:
//  - a page ahead of you: the route up to it is restored
//  - a page already in the path: you stepped back, so what came after moves to `ahead`
//  - a new page: it's added and anything ahead is dropped (you went a different way)
export const nextTrail = ({ path, ahead }, page) => {
    const forward = ahead.indexOf(page);
    if (forward !== -1) return { path: [...path, ...ahead.slice(0, forward + 1)], ahead: ahead.slice(forward + 1) };
    const at = path.indexOf(page);
    if (at !== -1) return { path: path.slice(0, at + 1), ahead: [...path.slice(at + 1), ...ahead] };
    return { path: [...path, page], ahead: [] };
};
