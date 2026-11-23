// Is the latest policy check out of date? True when Financial Package or credit score data changed after it ran:
// saved changes (the audit log) or unsaved edits on this page. Drives the orange "!" on the Policy check button.
// A check run on unsaved edits covers them, so saving those same edits afterwards (or adding the check's own
// suggestions) doesn't flag it. That "covered up to" time is kept per application in localStorage, so the other page
// (FP <-> credit score) agrees; without it the rule is just "anything saved after the check".
import { useMemo, useRef, useState } from 'react';

const FP_TABLES = new Set(['financial_packages', 'fp_party_details', 'fp_exceptions', 'fp_deposit_checks',
    'fp_loan_checks', 'fp_trade_checks', 'fp_title_verifications', 'credit_score_entries']);
const time = (t) => Date.parse(t) || 0;
const isFpChange = (e) => FP_TABLES.has(e.table_name)
    || (e.table_name === 'loan_applications' && ('interest_rate' in (e.new_data ?? {}) || 'fixing_period' in (e.new_data ?? {})));
const lastFpChange = (log) => Math.max(0, ...log.filter(isFpChange).map((e) => time(e.changed_at)));

const storeKey = (appId) => `mrac-covered-${appId}`;
const readCovered = (appId) => {
    try { return JSON.parse(localStorage.getItem(storeKey(appId))) ?? null; } catch { return null; }
};
const writeCovered = (appId, value) => {
    try { localStorage.setItem(storeKey(appId), JSON.stringify(value)); } catch { /* private mode: in-page only */ }
};

// log: the application's audit log (any rows; only FP / score ones count); dirty + current: this page's unsaved form
export const useMracStale = ({ appId, log, dirty, current }) => {
    const [run, setRun] = useState(null);          // the latest finished check
    const [snap, setSnap] = useState(null);        // { runId, data }: what was on screen when this page ran it
    const [covered, setCovered] = useState(() => readCovered(appId)); // { runId, until }
    const pending = useRef(null);
    const data = useMemo(() => JSON.stringify(current ?? null), [current]);

    const since = run ? Math.max(time(run.created_at), covered?.runId === run.id ? covered.until : 0) : 0;
    const savedStale = Boolean(run) && lastFpChange(log) > since;
    const unsavedStale = Boolean(run) && dirty && !(snap?.runId === run.id && snap.data === data);
    const stale = savedStale || unsavedStale;

    const cover = (runId, until) => {
        const value = { runId, until };
        setCovered(value);
        writeCovered(appId, value);
    };

    return {
        stale,
        // MracPanel: just before a check is queued, and whenever it shows a run (loaded or just finished)
        onRequest: () => { pending.current = data; },
        onRun: (r) => {
            if (r?.status !== 'DONE') return;
            setRun(r);
            if (pending.current !== null) {
                setSnap({ runId: r.id, data: pending.current });
                pending.current = null;
            }
        },
        // After a save, when the check was up to date beforehand (wasFresh): the new entries are what it already saw
        covered: (wasFresh, newLog) => { if (wasFresh && run) cover(run.id, lastFpChange(newLog)); },
        // The check's own suggestion added to the unsaved form: still up to date
        accepted: (nextCurrent) => { if (run && !stale) setSnap({ runId: run.id, data: JSON.stringify(nextCurrent) }); },
    };
};
