// Labels and tones for an MRAC check result (used by mracResult.jsx and the Decision Support page)
export const STATUS = { pass: ['Pass', 'ok'], fail: ['Fails', 'bad'], needs_review: ['Needs review', 'warn'] };
export const OVERALL = {
    PASS: ['All enabled criteria pass', 'ok'],
    REVIEW: ['Needs review', 'warn'],
    FAIL: ['One or more criteria fail', 'bad'],
    NO_RULES: ['No automatic MRAC criteria apply yet', 'plain'],
};

export const show = (v) => (v === null || v === undefined || v === '' ? '—' : String(v));
