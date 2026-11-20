// How long the AI took on one document, for the Document check: from when the worker started the OCR to when the AI
// extraction finished (the whole process). Queue time before the worker picked it up is not counted, so a worker that
// was switched off does not show as a slow read.

// 850 ms -> "under a second", 42 s -> "42 seconds", 72 s -> "1 min 12 s", 7500 s -> "2 h 5 min"
export const formatDuration = (ms) => {
    const s = Math.round(ms / 1000);
    if (s < 1) return 'under a second';
    if (s < 60) return `${s} second${s === 1 ? '' : 's'}`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} min${s % 60 ? ` ${s % 60} s` : ''}`;
    const h = Math.floor(m / 60);
    return `${h} h${m % 60 ? ` ${m % 60} min` : ''}`;
};

// check = one entry of fetchDocumentChecks(): { ocr, run }. null until the AI reading has finished.
export const readingTime = (check) => {
    if (check?.run?.status !== 'DONE' || !check.run.finished_at) return null;
    const from = check.ocr?.started_at ?? check.ocr?.created_at;
    const ms = from ? new Date(check.run.finished_at).getTime() - new Date(from).getTime() : NaN;
    return Number.isFinite(ms) && ms >= 0 ? formatDuration(ms) : null;
};
