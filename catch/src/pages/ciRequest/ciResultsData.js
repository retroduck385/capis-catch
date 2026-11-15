// CI results data shared by the CI request page (its steps), the results editor and the read-only view:
// the borrowers' ci_checks + ci_documents per "slot" (borrower x check), which reports have a confirmed AI check,
// and what's still missing before Mark CI Done.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getParties } from '../applicationForm/api';
import { BORROWER_ROLES, partyLabel } from '../applicationForm/options';
import { fetchConfirmedIds } from '../documentCheck/api';
import { fetchCiResults } from './api';
import { CI_CHECKS } from './options';

export const keyOf = (applicantId, checkType) => `${applicantId}:${checkType}`;
export const fullName = (p) => [p.first_name, p.middle_name, p.last_name, p.name_extension].filter(Boolean).join(' ') || '—';
export const personLabel = (p) => `${partyLabel(p)}: ${fullName(p)}`;

// NFIS and TU reports have an AI extraction (20261109_ci_extraction.sql); BRAS doesn't yet
export const AI_CHECKED = new Set(['NFIS', 'TU']);
export const aiCheckUrl = (applicationId, doc) => (AI_CHECKED.has(doc.check_type)
    ? `/documentCheckPage?id=${applicationId}&ci=1&doc=${doc.id}` : null);
export const REQUIRED_CHECKS = CI_CHECKS.filter((c) => c.required);

// Same rule as ci_missing() in the DB, on what's saved: every borrower needs an NFIS and a TU result + report
export const missingItems = (borrowers, byKey) => borrowers.flatMap((p) => REQUIRED_CHECKS.flatMap((c) => {
    const saved = byKey[keyOf(p.id, c.value)];
    return [
        !saved?.documents?.length && `${personLabel(p)}: ${c.value} report (upload the file)`,
        !saved?.result && `${personLabel(p)}: ${c.value} result`,
    ].filter(Boolean);
}));

// A slot counts as AI-checked once any of its report files has a confirmed AI extraction
export const isAiChecked = (slot, confirmed) => (slot?.documents ?? []).some((d) => confirmed.has(d.id));

// Loads the borrowers' CI rows and which NFIS / TU files are AI-confirmed; reload() fetches again.
// byKey = { "applicant:check": { result, summary, documents: [...] } }
export const useCiResults = (app) => {
    const borrowers = useMemo(() => getParties(app, BORROWER_ROLES), [app]);
    const idsKey = borrowers.map((b) => b.id).join(',');
    const [version, setVersion] = useState(0);
    // key = the borrower ids the data was loaded for: loading until it matches (not on a reload, so no flicker)
    const [state, setState] = useState({ checks: [], documents: [], confirmed: new Set(), key: null, error: null });

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const ids = idsKey ? idsKey.split(',').map(Number) : [];
                const data = await fetchCiResults(ids);
                const aiIds = data.documents.filter((d) => AI_CHECKED.has(d.check_type)).map((d) => d.id);
                // The AI-checked marks are only a hint: if they fail to load, the results still show
                const confirmed = await fetchConfirmedIds(aiIds, { ci: true }).catch(() => new Set());
                if (!cancelled) setState({ ...data, confirmed, key: idsKey, error: null });
            } catch (err) {
                if (!cancelled) setState((s) => ({ ...s, key: idsKey, error: err.message }));
            }
        };
        load();
        return () => { cancelled = true; };
    }, [idsKey, version]);

    const byKey = useMemo(() => {
        const map = {};
        for (const c of state.checks) map[keyOf(c.applicant_id, c.check_type)] = { ...c, documents: [] };
        for (const d of state.documents) {
            const k = keyOf(d.applicant_id, d.check_type);
            (map[k] ??= { documents: [] }).documents.push(d);
        }
        return map;
    }, [state.checks, state.documents]);

    const reload = useCallback(() => setVersion((v) => v + 1), []);

    return { borrowers, byKey, confirmed: state.confirmed, loading: state.key !== idsKey, error: state.error, reload };
};
