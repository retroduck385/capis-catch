// CI results (BPMN Credit Investigator lane: TU, NFIS, BRAS -> upload results -> Done).
// Per borrower and per check: the report file(s), a result and the CI's summarized findings, plus overall remarks.
// Uploaded reports are OCR'd by the PaddleOCR worker; NFIS and TU reports are then read by the AI and checked
// on the CI report check page (/documentCheckPage?ci=1, "AI check" next to each file).
//   CiResultsEditor: the Credit Investigator, while the application is in Credit Investigation.
//   CiResultsView:   read-only, for everyone else (CO's Financial Package, AO's loan folder) and after Done.
import { PanelSkeleton } from '../../components/skeleton';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getParties } from '../applicationForm/api';
import { BORROWER_ROLES, partyLabel } from '../applicationForm/options';
import { fetchStaffNames } from '../loanFolder/api';
import {
    completeCi, fetchCiDone, fetchCiRequests, fetchCiResults, getCiDocumentUrl, removeCiDocument, saveCiFindings,
    uploadCiDocument,
} from './api';
import { CI_CHECKS, CI_RESULTS } from './options';

const resultLabel = (value) => CI_RESULTS.find((r) => r.value === value)?.label ?? null;

const keyOf = (applicantId, checkType) => `${applicantId}:${checkType}`;
const fullName = (p) => [p.first_name, p.middle_name, p.last_name, p.name_extension].filter(Boolean).join(' ') || '—';
const personLabel = (p) => `${partyLabel(p)}: ${fullName(p)}`;

// Loads the borrowers' CI rows; bump `version` to reload
const useCiResults = (app, version) => {
    const borrowers = useMemo(() => getParties(app, BORROWER_ROLES), [app]);
    const idsKey = borrowers.map((b) => b.id).join(',');
    const [state, setState] = useState({ checks: [], documents: [], loading: true, error: null });

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const ids = idsKey ? idsKey.split(',').map(Number) : [];
                const data = await fetchCiResults(ids);
                if (!cancelled) setState({ ...data, loading: false, error: null });
            } catch (err) {
                if (!cancelled) setState((s) => ({ ...s, loading: false, error: err.message }));
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

    return { borrowers, byKey, loading: state.loading, error: state.error };
};

// Same rule as ci_missing() in the DB, on what's saved: every borrower needs an NFIS and a TU result + report
const missingItems = (borrowers, byKey) => borrowers.flatMap((p) => CI_CHECKS.filter((c) => c.required).flatMap((c) => {
    const saved = byKey[keyOf(p.id, c.value)];
    return [
        !saved?.documents?.length && `${personLabel(p)}: ${c.value} report (upload the file)`,
        !saved?.result && `${personLabel(p)}: ${c.value} result`,
    ].filter(Boolean);
}));

const openFile = async (doc, setError) => {
    try {
        window.open(await getCiDocumentUrl(doc), '_blank', 'noopener');
    } catch (err) {
        setError(err.message);
    }
};

// NFIS and TU reports have an AI extraction (20261109_ci_extraction.sql); BRAS doesn't yet
const AI_CHECKED = new Set(['NFIS', 'TU']);
const aiCheckUrl = (applicationId, doc) => (AI_CHECKED.has(doc.check_type)
    ? `/documentCheckPage?id=${applicationId}&ci=1&doc=${doc.id}` : null);

const FileList = ({ docs, onView, onRemove, busy, applicationId, onLeave }) => (
    docs.length ? (
        <ul>
            {docs.map((doc) => (
                <li key={doc.id} className="flex gap-2 items-center flex-wrap">
                    <span title={doc.original_file_name}>{doc.file_name}</span>
                    <button type="button" className="border px-2" onClick={() => onView(doc)}>View</button>
                    {aiCheckUrl(applicationId, doc) && (
                        <Link to={aiCheckUrl(applicationId, doc)} className="border px-2"
                            onClick={(e) => { if (onLeave && !onLeave()) e.preventDefault(); }}>
                            AI check
                        </Link>
                    )}
                    {onRemove && (
                        <button type="button" className="border px-2" disabled={busy === doc.id}
                            onClick={() => onRemove(doc)}>Remove</button>
                    )}
                </li>
            ))}
        </ul>
    ) : <p className="italic text-gray-500">No file uploaded.</p>
);

const ResultText = ({ value }) => (value
    ? <span className={value === 'WITH_FINDINGS' ? 'text-red-700 font-semibold' : 'text-green-700 font-semibold'}>{resultLabel(value)}</span>
    : <span className="italic text-gray-500">No result yet</span>);

// ============================================================
// Editor (Credit Investigator)
// ============================================================
export const CiResultsEditor = ({ app, ciRequest, onChanged }) => {
    const [version, setVersion] = useState(0);
    const { borrowers, byKey, loading, error: loadError } = useCiResults(app, version);
    const reload = () => setVersion((v) => v + 1);

    const [edits, setEdits] = useState({});           // key -> { result, summary } (unsaved)
    const [remarks, setRemarks] = useState(null);     // null = unchanged
    const [busy, setBusy] = useState(null);           // slot key / doc id / 'save' / 'done'
    const [error, setError] = useState(null);
    const [serverMissing, setServerMissing] = useState(null);

    const valueOf = (k) => ({
        result: edits[k]?.result !== undefined ? edits[k].result : byKey[k]?.result ?? null,
        summary: edits[k]?.summary !== undefined ? edits[k].summary : byKey[k]?.summary ?? '',
    });
    const savedRemarks = ciRequest?.ci_remarks ?? '';
    const currentRemarks = remarks ?? savedRemarks;

    const dirty = Object.entries(edits).some(([k, e]) => {
        const saved = byKey[k];
        return (e.result !== undefined && e.result !== (saved?.result ?? null))
            || (e.summary !== undefined && e.summary.trim() !== (saved?.summary ?? ''));
    }) || currentRemarks.trim() !== savedRemarks;

    // Ask before closing the tab with unsaved findings
    useEffect(() => {
        if (!dirty) return undefined;
        const warn = (e) => { e.preventDefault(); };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [dirty]);

    const setField = (k, field, value) => setEdits((prev) => ({ ...prev, [k]: { ...prev[k], [field]: value } }));

    const handleUpload = async (party, checkType, files) => {
        const k = keyOf(party.id, checkType);
        setBusy(k);
        setError(null);
        try {
            for (const file of files) {
                await uploadCiDocument({ applicationId: app.id, applicantId: party.id, checkType, file });
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(null);
            setServerMissing(null);
            reload();
        }
    };

    const handleRemove = async (doc) => {
        if (!window.confirm(`Remove ${doc.file_name}?`)) return;
        setBusy(doc.id);
        setError(null);
        try {
            await removeCiDocument(doc);
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(null);
            reload();
        }
    };

    const handleSave = async () => {
        setBusy('save');
        setError(null);
        try {
            const rows = borrowers.flatMap((p) => CI_CHECKS.map((c) => {
                const v = valueOf(keyOf(p.id, c.value));
                return { applicant_id: p.id, check_type: c.value, result: v.result, summary: v.summary };
            }));
            await saveCiFindings(app.id, rows, currentRemarks);
            await onChanged(); // the page reloads the request (saved remarks)
            setEdits({});
            setRemarks(null);
            setServerMissing(null);
            reload();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(null);
        }
    };

    const handleDone = async () => {
        if (!window.confirm('Mark Credit Investigation as Done? The application moves to Credit Evaluation, '
            + 'the Credit Officer is notified, and these results can no longer be changed.')) return;
        setBusy('done');
        setError(null);
        try {
            const still = await completeCi(app.id);
            if (still.length) {
                setServerMissing(still);
                reload();
            } else {
                await onChanged(); // now read-only: the page shows the view instead
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(null);
        }
    };

    if (loading) return <PanelSkeleton label="Loading CI results" lines={5} />;

    const missing = serverMissing ?? missingItems(borrowers, byKey);

    return (
        <div className="text-left">
            <h3 className="text-lg font-semibold pt-4">CI results</h3>
            <p className="text-sm">
                Upload each report (JPG, PNG or PDF, up to 10 MB) and record the result and your summary of the findings.
                Files are saved right away; results and summaries are saved with "Save findings". The applicant can't see any of this.
            </p>
            <p className="text-sm">
                NFIS and TU reports are read by the AI after upload. Use "AI check" to compare the report with the application
                and confirm the AI's draft result and summary; confirming saves them here.
            </p>
            {loadError && <p className="text-red-600">{loadError}</p>}

            {borrowers.map((p) => (
                <fieldset key={p.id} className="border p-4 my-4">
                    <legend className="font-semibold px-1">{personLabel(p)}</legend>
                    {CI_CHECKS.map((c) => {
                        const k = keyOf(p.id, c.value);
                        const v = valueOf(k);
                        const docs = byKey[k]?.documents ?? [];
                        return (
                            <div key={c.value} className="border-b py-3">
                                <p className="font-semibold">
                                    {c.label}{c.required ? <span className="text-red-600"> *</span> : ' (optional)'}
                                </p>
                                <FileList docs={docs} busy={busy} onView={(doc) => openFile(doc, setError)} onRemove={handleRemove}
                                    applicationId={app.id}
                                    onLeave={() => !dirty || window.confirm('You have unsaved findings on this page. Leave without saving?')} />
                                <input type="file" multiple accept="image/jpeg,image/png,application/pdf"
                                    disabled={busy === k} aria-label={`Upload ${c.label} report for ${fullName(p)}`}
                                    onChange={(e) => {
                                        const files = [...e.target.files];
                                        e.target.value = '';
                                        if (files.length) handleUpload(p, c.value, files);
                                    }} />
                                {busy === k && <span> Uploading...</span>}
                                <div className="flex gap-4 py-2" role="radiogroup" aria-label={`${c.label} result`}>
                                    {CI_RESULTS.map((r) => (
                                        <label key={r.value} className="flex gap-1 items-center">
                                            <input type="radio" name={`result-${k}`} checked={v.result === r.value}
                                                onChange={() => setField(k, 'result', r.value)} />
                                            {r.label}
                                        </label>
                                    ))}
                                    {v.result && (
                                        <button type="button" className="underline text-sm" onClick={() => setField(k, 'result', null)}>
                                            Clear
                                        </button>
                                    )}
                                </div>
                                <label className="block">
                                    <span>Summary of findings</span>
                                    <textarea rows={3} className="border block w-full px-2" value={v.summary}
                                        maxLength={4000} onChange={(e) => setField(k, 'summary', e.target.value)} />
                                </label>
                            </div>
                        );
                    })}
                </fieldset>
            ))}

            <label className="block py-2">
                <span className="font-semibold">Overall CI remarks (optional)</span>
                <textarea rows={3} className="border block w-full px-2" value={currentRemarks} maxLength={4000}
                    onChange={(e) => setRemarks(e.target.value)} />
            </label>

            {error && <p className="text-red-600 py-2">{error}</p>}

            <div className="sticky bottom-0 bg-white border-t py-2 flex gap-3 items-center">
                <button type="button" className="border px-4 py-2" disabled={!dirty || busy === 'save'} onClick={handleSave}>
                    {busy === 'save' ? 'Saving...' : 'Save findings'}
                </button>
                {dirty ? <span className="text-amber-700">Unsaved changes</span> : <span className="text-sm">All changes saved</span>}
            </div>

            <div className="border p-3 my-4">
                <h3 className="font-semibold">Mark CI Done</h3>
                {missing.length > 0 ? (
                    <>
                        <p>Still needed before this can go to the Credit Officer:</p>
                        <ul className="list-disc pl-6 text-red-700">{missing.map((m) => <li key={m}>{m}</li>)}</ul>
                    </>
                ) : (
                    <p>All NFIS and TU results and reports are in. BRAS is optional.</p>
                )}
                {dirty && <p className="text-amber-700">Save your findings first.</p>}
                <button type="button" className="border px-4 py-2 mt-2"
                    disabled={missing.length > 0 || dirty || busy === 'done'} onClick={handleDone}>
                    {busy === 'done' ? 'Sending...' : 'Mark CI Done and send to Credit Evaluation'}
                </button>
            </div>
        </div>
    );
};

// ============================================================
// Read-only view (CO, AO, heads; and the CI after Done)
// ============================================================
export const CiResultsView = ({ app, title = 'CI results' }) => {
    const { borrowers, byKey, loading, error: loadError } = useCiResults(app, 0);
    const [meta, setMeta] = useState({ request: null, done: null, names: {} });
    const [error, setError] = useState(null);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const [requests, done] = await Promise.all([fetchCiRequests(app.id), fetchCiDone(app.id)]);
                const request = requests.at(-1) ?? null;
                const names = done ? await fetchStaffNames([done.changed_by]) : {};
                if (!cancelled) setMeta({ request, done, names });
            } catch (err) {
                if (!cancelled) setError(err.message);
            }
        };
        load();
        return () => { cancelled = true; };
    }, [app.id]);

    if (loading) return <PanelSkeleton label="Loading CI results" lines={5} />;
    if (!meta.request) return <p className="italic text-gray-500">No CI request has been sent yet.</p>;

    return (
        <div className="text-left">
            {title && <h3 className="font-semibold">{title}</h3>}
            <p className="text-sm">
                {meta.done
                    ? `CI done ${new Date(meta.done.changed_at).toLocaleString()} by ${meta.names[meta.done.changed_by] ?? 'Credit Investigator'}.`
                    : 'Credit Investigation is still open; results may change.'}
            </p>
            {(loadError || error) && <p className="text-red-600">{loadError || error}</p>}
            <div className="overflow-x-auto">
                <table className="border-collapse w-full">
                    <thead>
                        <tr>
                            <th className="border px-2 text-left align-top">Name</th>
                            {CI_CHECKS.map((c) => <th key={c.value} className="border px-2 text-left align-top">{c.label}</th>)}
                        </tr>
                    </thead>
                    <tbody>
                        {borrowers.map((p) => (
                            <tr key={p.id}>
                                <td className="border px-2 align-top">{fullName(p)} ({partyLabel(p)})</td>
                                {CI_CHECKS.map((c) => {
                                    const saved = byKey[keyOf(p.id, c.value)];
                                    return (
                                        <td key={c.value} className="border px-2 align-top">
                                            <ResultText value={saved?.result} />
                                            {saved?.summary && <p className="whitespace-pre-wrap">{saved.summary}</p>}
                                            {(saved?.documents ?? []).map((doc) => (
                                                <span key={doc.id} className="block">
                                                    <button type="button" className="underline text-left"
                                                        title={doc.original_file_name} onClick={() => openFile(doc, setError)}>
                                                        {doc.file_name}
                                                    </button>
                                                    {aiCheckUrl(app.id, doc) && (
                                                        <Link to={aiCheckUrl(app.id, doc)} className="underline text-sm ml-2">AI check</Link>
                                                    )}
                                                </span>
                                            ))}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <p className="pt-2"><span className="font-semibold">Overall CI remarks:</span>{' '}
                <span className="whitespace-pre-wrap">{meta.request.ci_remarks || '—'}</span></p>
        </div>
    );
};
