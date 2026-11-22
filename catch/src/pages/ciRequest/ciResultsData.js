// CI results data shared by the CI request page (its steps), the results editor and the read-only view:
// the borrowers' ci_checks + ci_documents per "slot" (borrower x check), where each NFIS / TU report is in the
// optional AI reading (readStates; confirmed = the locked ones), and what's still missing before Mark CI Done.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getParties } from '../applicationForm/api';
import { BORROWER_ROLES, partyLabel } from '../applicationForm/options';
import { fetchReadStates } from '../documentCheck/api';
import { fetchCiResults } from './api';
import { CI_CHECKS } from './options';

export const keyOf = (applicantId, checkType) => `${applicantId}:${checkType}`;
export const fullName = (p) => [p.first_name, p.middle_name, p.last_name, p.name_extension].filter(Boolean).join(' ') || '—';
export const personLabel = (p) => `${partyLabel(p)}: ${fullName(p)}`;

const POLL_MS = 5000;

// NFIS and TU reports can be read by the AI (20261109_ci_extraction.sql), only when the CI asks
// ("Run AI" on the report page, 20261125_ci_ocr_opt_in.sql)
export const AI_CHECKED = new Set(['NFIS', 'TU']);
// "Open report": the CI report page with this file on screen, next to the boxes for its borrower x check
export const reportUrl = (applicationId, doc) => `/documentCheckPage?id=${applicationId}&ci=1&doc=${doc.id}`;
export const REQUIRED_CHECKS = CI_CHECKS.filter((c) => c.required);

// Same rules as ci_missing() in the DB (20261126_ci_facts.sql), on what's saved: every borrower needs an NFIS and a
// TU report, result and report date; an NFIS "With findings" lists its records, "No adverse findings" lists none
export const missingItems = (borrowers, byKey) => borrowers.flatMap((p) => REQUIRED_CHECKS.flatMap((c) => {
    const saved = byKey[keyOf(p.id, c.value)];
    const nfis = c.value === 'NFIS';
    const rows = saved?.rows?.length ?? 0;
    return [
        !saved?.documents?.length && `${personLabel(p)}: ${c.value} report (upload the file)`,
        !saved?.result && `${personLabel(p)}: ${c.value} result`,
        !saved?.report_date && `${personLabel(p)}: ${c.value} report date`,
        nfis && saved?.result === 'WITH_FINDINGS' && rows === 0 && `${personLabel(p)}: NFIS records (list each finding)`,
        nfis && saved?.result === 'NO_ADVERSE_FINDINGS' && rows > 0
            && `${personLabel(p)}: NFIS says No adverse findings but lists records (remove them or change the result)`,
    ].filter(Boolean);
}));

// A slot counts as AI-checked once any of its report files has a confirmed AI extraction
export const isAiChecked = (slot, confirmed) => (slot?.documents ?? []).some((d) => confirmed.has(d.id));

// Loads the borrowers' CI rows and where each NFIS / TU file is in the AI reading; reload() fetches again.
// While a file is being read, the read states are fetched again every few seconds (only those, not the results).
// byKey = { "applicant:check": { result, summary, report_date, documents: [...], rows: [...] } } (rows: the NFIS records
// or TU accounts); readStates = { [ci_documents.id]: state }
export const useCiResults = (app) => {
    const borrowers = useMemo(() => getParties(app, BORROWER_ROLES), [app]);
    const idsKey = borrowers.map((b) => b.id).join(',');
    const [version, setVersion] = useState(0);
    // key = the borrower ids the data was loaded for: loading until it matches (not on a reload, so no flicker)
    const [state, setState] = useState({
        checks: [], documents: [], nfisRecords: [], tuAccounts: [], readStates: {}, key: null, error: null,
    });

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const ids = idsKey ? idsKey.split(',').map(Number) : [];
                const data = await fetchCiResults(ids);
                const aiIds = data.documents.filter((d) => AI_CHECKED.has(d.check_type)).map((d) => d.id);
                // The AI marks are only a hint: if they fail to load, the results still show
                const readStates = await fetchReadStates(aiIds, { ci: true }).catch(() => ({}));
                if (!cancelled) setState({ ...data, readStates, key: idsKey, error: null });
            } catch (err) {
                if (!cancelled) setState((s) => ({ ...s, key: idsKey, error: err.message }));
            }
        };
        load();
        return () => { cancelled = true; };
    }, [idsKey, version]);

    const byKey = useMemo(() => {
        const map = {};
        const slot = (k) => (map[k] ??= { documents: [], rows: [] });
        for (const c of state.checks) map[keyOf(c.applicant_id, c.check_type)] = { ...c, documents: [], rows: [] };
        for (const d of state.documents) slot(keyOf(d.applicant_id, d.check_type)).documents.push(d);
        for (const r of state.nfisRecords) slot(keyOf(r.applicant_id, 'NFIS')).rows.push(r);
        for (const r of state.tuAccounts) slot(keyOf(r.applicant_id, 'TU')).rows.push(r);
        return map;
    }, [state.checks, state.documents, state.nfisRecords, state.tuAccounts]);

    // Something is being read: fetch the read states again in a few seconds
    const reading = Object.values(state.readStates).includes('READING');
    useEffect(() => {
        if (!reading) return undefined;
        const timer = setTimeout(async () => {
            const ids = Object.keys(state.readStates).map(Number);
            const readStates = await fetchReadStates(ids, { ci: true }).catch(() => null);
            if (readStates) setState((s) => ({ ...s, readStates: { ...s.readStates, ...readStates } }));
        }, POLL_MS);
        return () => clearTimeout(timer);
    }, [reading, state.readStates]);

    const confirmed = useMemo(() => new Set(Object.entries(state.readStates)
        .filter(([, st]) => st === 'CONFIRMED').map(([id]) => Number(id))), [state.readStates]);

    const reload = useCallback(() => setVersion((v) => v + 1), []);

    // raw: the rows as loaded, for ciFacts.js (score bands, RAAC checks, validity)
    const raw = useMemo(() => ({ checks: state.checks, nfisRecords: state.nfisRecords, tuAccounts: state.tuAccounts }),
        [state.checks, state.nfisRecords, state.tuAccounts]);

    return {
        borrowers, byKey, confirmed, readStates: state.readStates, raw,
        loading: state.key !== idsKey, error: state.error, reload,
    };
};
