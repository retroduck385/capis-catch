// An "Ask the applicant" click (ask.jsx) prefills the loan folder's request box ONCE. The click travels in the
// browser history state, which survives the box being unmounted and mounted again (the loan folder renders it in
// two places) and a page reload. Without this guard each remount ran the prefill again and replaced what the
// Account Officer had typed in "What we need" with the click's note.
// A click is identified by ask.at (the time of the click). isAskUsed() is a plain read, safe while rendering;
// markAskUsed() is called from an effect once the box has been prefilled.
const used = new Set();

export const isAskUsed = (ask) => !ask || ask.at == null || used.has(ask.at);
export const markAskUsed = (ask) => { if (ask?.at != null) used.add(ask.at); };

// The history state without the click, so a reload doesn't bring the prefill back either
export const withoutAsk = (state) => {
    if (!state || typeof state !== 'object') return null;
    const rest = { ...state };
    delete rest.ask;
    return Object.keys(rest).length ? rest : null;
};
