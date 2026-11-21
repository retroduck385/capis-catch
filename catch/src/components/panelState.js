// Whether a staff page's side panel is hidden (group notes item 38): remembered per page type in this browser only
// ("fp" for every file's Financial Package, "folder-nav" for the loan folder's section list, ...). A per-viewer
// convenience: storage can be blocked or empty (private window, cleared data), and then the panel simply shows.
// Pure (storage is passed in), so the node tests can run it.

export const panelKey = (page) => `catch-panel-hidden:${page}`;

const store = (storage) => {
    try {
        return storage ?? globalThis.localStorage ?? null;
    } catch {
        return null;   // reading localStorage itself can throw when site data is blocked
    }
};

export const readHidden = (page, storage) => {
    try {
        return store(storage)?.getItem(panelKey(page)) === '1';
    } catch {
        return false;
    }
};

// true when it was written
export const writeHidden = (page, hidden, storage) => {
    try {
        const s = store(storage);
        if (!s) return false;
        if (hidden) s.setItem(panelKey(page), '1'); else s.removeItem(panelKey(page));
        return true;
    } catch {
        return false;
    }
};
