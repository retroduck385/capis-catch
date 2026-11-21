// Credit result (FP page 3): which boxes show for the chosen result (group notes item 31, 2026-11-22).
//   Endorsed / Not endorsed  Justification and Remarks; Amendment and Waiver and acceptance as optional sections
//   Deferred                 the same, plus Deferral(s)
//   no result yet            nothing but the result (typed text is kept, not emptied)
// A box that a CHOSEN result hides is emptied when the FP is saved (the page says so first and offers Undo), so a
// deferral text never stays behind on an endorsed file: the AO's notice suggestions and the final report read it.

export const RESULT_TEXT_FIELDS = ['justification', 'amendment', 'waiver_and_acceptance', 'deferrals'];
export const OPTIONAL_FIELDS = ['amendment', 'waiver_and_acceptance'];

const BASE = ['justification', 'amendment', 'waiver_and_acceptance'];
const SHOWN = { ENDORSED: BASE, NOT_ENDORSED: BASE, DEFERRED: [...BASE, 'deferrals'] };

export const shownFields = (result) => SHOWN[result] ?? [];

const hasText = (v) => typeof v === 'string' && v.trim() !== '';

// Boxes the chosen result hides that still hold text: they are emptied on save. None while no result is chosen.
export const fieldsToRemove = (pkg) => {
    if (!SHOWN[pkg.credit_result]) return [];
    return RESULT_TEXT_FIELDS.filter((k) => !SHOWN[pkg.credit_result].includes(k) && hasText(pkg[k]));
};

// The package as it is saved: those boxes emptied
export const withHiddenCleared = (pkg) => {
    const out = { ...pkg };
    for (const k of fieldsToRemove(pkg)) out[k] = '';
    return out;
};

// The result that shows the boxes about to be removed again (the "Undo" link): only Deferred hides nothing
export const undoResultFor = (pkg) => (fieldsToRemove(pkg).length ? 'DEFERRED' : null);

export const FIELD_LABELS = {
    justification: 'Justification and Remarks',
    amendment: 'Amendment',
    waiver_and_acceptance: 'Waiver and Acceptance',
    deferrals: 'Deferral(s)',
};
