// The "Check on the document" notes of an AI extraction: each one is MAJOR (could change whether the document is
// accepted: not genuine, expired, edited, key facts missing) or MINOR (small or cosmetic). Runs saved before
// severities existed hold plain strings: they come back with severity null and are shown without a label.

export const SEVERITIES = {
    MAJOR: { label: 'Major', tone: 'major', hint: 'Needs attention. May affect whether the document is accepted (e.g. expired, wrong document, signs of editing, key detail missing or unreadable).' },
    MINOR: { label: 'Minor', tone: 'minor', hint: 'Low impact. A small or cosmetic issue the officer can judge at a glance (e.g. typo, abbreviation, slightly garbled text where the value is still clear).' },
};

const ORDER = { MAJOR: 0, MINOR: 1 };

// output = run.output; returns [{ text, severity }], Major first, then Minor, then unlabelled (old runs)
export const readIssues = (output) => (output?.issues ?? [])
    .map((i) => (typeof i === 'string' ? { text: i, severity: null } : { text: i?.text ?? '', severity: SEVERITIES[i?.severity] ? i.severity : null }))
    .filter((i) => i.text.trim() !== '')
    .sort((a, b) => (ORDER[a.severity] ?? 2) - (ORDER[b.severity] ?? 2));
