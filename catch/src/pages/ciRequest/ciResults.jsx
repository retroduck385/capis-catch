// CI results (BPMN Credit Investigator lane: TU, NFIS, BRAS -> upload results -> Done).
// Per borrower and per check: the report file(s), a result and the CI's summarized findings, plus overall remarks.
// Uploaded reports are OCR'd by the PaddleOCR worker; NFIS and TU reports are then read by the AI and checked
// on the CI report check page (/documentCheckPage?ci=1, "AI check" next to each file).
//   CiResultsEditor: the Credit Investigator, while the application is in Credit Investigation. Draws one of the
//     page's step subpages (show): 'upload' (a borrower x check grid), 'ai' (each NFIS / TU report and a link to its
//     AI check on the document check page; confirming there fills in the result + summary) or 'results' (results,
//     remarks, Save, Mark CI Done). It stays mounted across steps, so unsaved findings survive a step change.
//     The AI check is optional: a NFIS / TU result entered by hand is tagged "Not AI-checked".
//   CiResultsView:   read-only, for everyone else (CO's Financial Package, AO's loan folder) and after Done.
import { PanelSkeleton } from '../../components/skeleton';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, ScanText, Upload } from 'lucide-react';
import { partyLabel } from '../applicationForm/options';
import { fetchStaffNames } from '../loanFolder/api';
import { completeCi, fetchCiDone, fetchCiRequests, getCiDocumentUrl, removeCiDocument, saveCiFindings, uploadCiDocument } from './api';
import { AI_CHECKED, aiCheckUrl, fullName, isAiChecked, keyOf, missingItems, personLabel, useCiResults } from './ciResultsData';
import { CI_CHECKS, CI_RESULTS } from './options';
import CiFindingFlags from './findingFlags';
import { Term, Terms } from '../../components/term';
import { useTermTitle } from '../../components/useTermTitle';

const AI_CHECKS = CI_CHECKS.filter((c) => AI_CHECKED.has(c.value));
const resultLabel = (value) => CI_RESULTS.find((r) => r.value === value)?.label ?? null;

const openFile = async (doc, setError) => {
    try {
        window.open(await getCiDocumentUrl(doc), '_blank', 'noopener');
    } catch (err) {
        setError(err.message);
    }
};

// Status of one borrower x check in the upload grid
const slotStatus = (check, slot, confirmed) => {
    if (!slot?.documents?.length) return check.required ? { label: 'Missing', tone: 'warn' } : { label: 'Optional', tone: 'none' };
    if (AI_CHECKED.has(check.value) && isAiChecked(slot, confirmed)) return { label: 'OCR-extracted', tone: 'ok' };
    return { label: 'Uploaded', tone: 'ok' };
};

const AiTag = ({ checkType, slot, confirmed, hasResult }) => {
    if (!AI_CHECKED.has(checkType)) return null;
    if (isAiChecked(slot, confirmed)) return <span className="lf-chip ok">OCR-extracted</span>;
    return hasResult ? <span className="lf-chip warn">Not OCR-extracted</span> : null;
};

const ResultText = ({ value }) => (value
    ? <span className={value === 'WITH_FINDINGS' ? 'text-red-700 font-semibold' : 'text-green-700 font-semibold'}>{resultLabel(value)}</span>
    : <span className="italic text-gray-500">No result yet</span>);

// ============================================================
// Editor (Credit Investigator)
// ============================================================
// data: useCiResults(app) from the page (the steps read it too). show: 'upload' | 'ai' | 'results'.
// onGoTo(step): open another step. onDirtyChange(bool): unsaved findings or not.
export const CiResultsEditor = ({ app, ciRequest, data, show, onGoTo, onChanged, onDirtyChange }) => {
    const { borrowers, byKey, confirmed, loading, error: loadError, reload } = data;
    const tt = useTermTitle();

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

    // Ask before closing the tab with unsaved findings; tell the page so its step links can ask too
    useEffect(() => {
        onDirtyChange?.(dirty);
        if (!dirty) return undefined;
        const warn = (e) => { e.preventDefault(); };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [dirty, onDirtyChange]);

    const leaveOk = () => !dirty || window.confirm('You have unsaved findings on this page. Leave without saving?');
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

    const fileActions = (doc, { remove = true } = {}) => (
        <span className="ci-file-actions">
            {aiCheckUrl(app.id, doc) && (
                <Link to={aiCheckUrl(app.id, doc)} className="ci-mini"
                    onClick={(e) => { if (!leaveOk()) e.preventDefault(); }}>
                    {confirmed.has(doc.id)
                        ? <><CheckCircle2 size={14} aria-hidden="true" />OCR extracted: review</>
                        : <><ScanText size={14} aria-hidden="true" />Open OCR extraction</>}
                </Link>
            )}
            {remove && (
                <button type="button" className="ci-mini" disabled={busy === doc.id} onClick={() => handleRemove(doc)}>
                    Remove<span className="sr-only"> {doc.file_name}</span>
                </button>
            )}
        </span>
    );
    const fileName = (doc) => (
        <button type="button" className="ci-file" title={doc.original_file_name} onClick={() => openFile(doc, setError)}>
            {doc.file_name}
        </button>
    );

    // Step 2: one card per borrower, one cell per check
    const uploadStep = (
        <>
            <p className="ci-note">
                <Term k="NFIS" /> and <Term k="TU" /> are required for every borrower; <Term k="BRAS" /> is optional. JPG, PNG or PDF, up to 10 MB each; files are
                saved right away. The applicant can't see any of this.
            </p>
            <div className="ci-borrowers">
                {borrowers.map((p) => (
                    <div key={p.id} className="ci-borrower">
                        <h3>{fullName(p)} <span>{partyLabel(p)}</span></h3>
                        <ul className="ci-slots">
                            {CI_CHECKS.map((c) => {
                                const k = keyOf(p.id, c.value);
                                const slot = byKey[k];
                                const docs = slot?.documents ?? [];
                                const status = slotStatus(c, slot, confirmed);
                                return (
                                    <li key={c.value} className={`ci-slot ${status.tone}`}>
                                        <div className="ci-slot-top">
                                            <b><Terms text={c.label} /></b>
                                            <span className={`lf-chip ${status.tone}`}>{status.label}</span>
                                        </div>
                                        {docs.length > 0 && (
                                            <ul className="ci-files">
                                                {docs.map((doc) => <li key={doc.id}>{fileName(doc)}{fileActions(doc)}</li>)}
                                            </ul>
                                        )}
                                        <label className={`lf-btn quiet ci-upload${busy === k ? ' busy' : ''}`}>
                                            <Upload size={16} aria-hidden="true" />
                                            {busy === k ? 'Uploading...' : docs.length ? 'Add another file' : 'Upload report'}
                                            <input type="file" multiple accept="image/jpeg,image/png,application/pdf" className="sr-only"
                                                disabled={busy === k} aria-label={`Upload ${c.label} report for ${fullName(p)}`}
                                                onChange={(e) => {
                                                    const files = [...e.target.files];
                                                    e.target.value = '';
                                                    if (files.length) handleUpload(p, c.value, files);
                                                }} />
                                        </label>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                ))}
            </div>
        </>
    );

    // Step 3: every NFIS / TU report and its AI check (the check itself is on the document check page)
    const anyAiReport = borrowers.some((p) => AI_CHECKS.some((c) => byKey[keyOf(p.id, c.value)]?.documents?.length));
    const aiStep = (
        <>
            <p className="ci-note">
                Optional. Each <Term k="NFIS" /> and <Term k="TU" /> report is read by <Term k="OCR" /> extraction. Open its OCR extraction, compare every value with the report, edit
                what's wrong and confirm: the result and summary are then filled in for step 4. You can also skip this and
                enter the results by hand; they're tagged "Not OCR-extracted".
            </p>
            {!anyAiReport ? (
                <p className="ci-empty-step">
                    <Terms>No NFIS or TU report has been uploaded yet.</Terms>{' '}
                    <button type="button" className="ci-link" onClick={() => onGoTo('upload')}>Go to step 2: Upload the reports</button>
                </p>
            ) : (
                <div className="ci-borrowers">
                    {borrowers.map((p) => (
                        <div key={p.id} className="ci-borrower">
                            <h3>{fullName(p)} <span>{partyLabel(p)}</span></h3>
                            <ul className="ci-slots two">
                                {AI_CHECKS.map((c) => {
                                    const slot = byKey[keyOf(p.id, c.value)];
                                    const docs = slot?.documents ?? [];
                                    const done = isAiChecked(slot, confirmed);
                                    const tone = done ? 'ok' : docs.length ? 'warn' : 'none';
                                    return (
                                        <li key={c.value} className={`ci-slot ${tone}`}>
                                            <div className="ci-slot-top">
                                                <b><Terms text={c.label} /></b>
                                                <span className={`lf-chip ${tone}`}>
                                                    {done ? 'OCR-extracted' : docs.length ? 'To check' : 'Not uploaded'}
                                                </span>
                                            </div>
                                            {docs.length > 0 ? (
                                                <ul className="ci-files">
                                                    {docs.map((doc) => <li key={doc.id}>{fileName(doc)}{fileActions(doc, { remove: false })}</li>)}
                                                </ul>
                                            ) : (
                                                <button type="button" className="ci-link" onClick={() => onGoTo('upload')}>Upload it in step 2</button>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    ))}
                </div>
            )}
        </>
    );

    // Step 4: results + summaries (AI-confirmed ones are already filled in), remarks, save, Done
    const resultsStep = (
        <>
            <p className="ci-note">
                Results you confirmed in the OCR extraction are already filled in; you can still change them. Enter <Term k="BRAS" />, and any
                report you didn't confirm in the OCR extraction, by hand. Saved with "Save findings".
            </p>

            {borrowers.map((p) => (
                <fieldset key={p.id} className="ci-results">
                    <legend>{personLabel(p)}</legend>
                    {CI_CHECKS.map((c) => {
                        const k = keyOf(p.id, c.value);
                        const v = valueOf(k);
                        return (
                            <div key={c.value} className="ci-result">
                                <div className="ci-result-side">
                                    <div className="ci-slot-top">
                                        <b><Terms text={c.label} />{c.required ? <span className="ci-req" aria-label="required"> *</span> : ' (optional)'}</b>
                                        <AiTag checkType={c.value} slot={byKey[k]} confirmed={confirmed} hasResult={!!v.result} />
                                    </div>
                                    <div className="lf-choices" role="radiogroup" aria-label={`${c.label} result for ${fullName(p)}`}>
                                        {CI_RESULTS.map((r) => (
                                            <label key={r.value} className="lf-choice">
                                                <input type="radio" name={`result-${k}`} checked={v.result === r.value}
                                                    onChange={() => setField(k, 'result', r.value)} />
                                                {r.label}
                                            </label>
                                        ))}
                                    </div>
                                    {v.result && (
                                        <button type="button" className="ci-link" onClick={() => setField(k, 'result', null)}>
                                            Clear result
                                        </button>
                                    )}
                                </div>
                                <label className="ci-summary">
                                    <span>Summary of findings</span>
                                    <textarea rows={3} value={v.summary} maxLength={4000}
                                        onChange={(e) => setField(k, 'summary', e.target.value)} />
                                </label>
                            </div>
                        );
                    })}
                </fieldset>
            ))}

            <label className="ci-summary ci-remarks" title={tt('Overall CI remarks')}>
                <span>Overall CI remarks (optional)</span>
                <textarea rows={3} value={currentRemarks} maxLength={4000} onChange={(e) => setRemarks(e.target.value)} />
            </label>

            <div className="ci-savebar">
                <button type="button" className="lf-btn" disabled={!dirty || busy === 'save'} onClick={handleSave}>
                    {busy === 'save' ? 'Saving...' : 'Save findings'}
                </button>
                {dirty
                    ? <span className="ci-unsaved" role="status">Unsaved changes</span>
                    : <span className="ci-saved" role="status">All changes saved</span>}
            </div>

            <CiFindingFlags applicationId={app.id}
                hasFindings={Object.values(byKey).some((c) => c.result === 'WITH_FINDINGS')}
                unsaved={Object.values(edits).some((e) => e?.result === 'WITH_FINDINGS')} />

            <div className={`ci-done ${missing.length ? 'warn' : 'ok'}`}>
                <h3>Mark <Term k="CI" /> Done</h3>
                {missing.length > 0 ? (
                    <>
                        <p>Still needed before this can go to the Credit Officer:</p>
                        <ul>{missing.map((m) => <li key={m}><Terms text={m} /></li>)}</ul>
                    </>
                ) : (
                    <p><Terms>All NFIS and TU results and reports are in. BRAS is optional.</Terms></p>
                )}
                {dirty && <p className="ci-unsaved">Save your findings first.</p>}
                <button type="button" title={tt('Mark CI Done')} disabled={missing.length > 0 || dirty || busy === 'done'} onClick={handleDone}>
                    {busy === 'done' ? 'Sending...' : 'Mark CI Done and send to Credit Evaluation'}
                </button>
            </div>
        </>
    );

    return (
        <>
            {(loadError || error) && <p className="ci-err" role="alert">{loadError || error}</p>}
            {{ upload: uploadStep, ai: aiStep, results: resultsStep }[show] ?? null}
        </>
    );
};

// ============================================================
// Read-only view (CO, AO, heads; and the CI after Done)
// ============================================================
export const CiResultsView = ({ app, title = 'CI results' }) => {
    const { borrowers, byKey, loading, error: loadError } = useCiResults(app);
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
    if (!meta.request) return <p className="italic text-gray-500"><Terms>No CI request has been sent yet.</Terms></p>;

    return (
        <div className="text-left">
            {title && <h3 className="font-semibold"><Terms text={title} /></h3>}
            <p className="text-sm">
                <Terms text={meta.done
                    ? `CI done ${new Date(meta.done.changed_at).toLocaleString()} by ${meta.names[meta.done.changed_by] ?? 'Credit Investigator'}.`
                    : 'Credit Investigation is still open; results may change.'} />
            </p>
            {(loadError || error) && <p className="text-red-600">{loadError || error}</p>}
            <div className="overflow-x-auto">
                <table className="border-collapse w-full">
                    <thead>
                        <tr>
                            <th className="border px-2 text-left align-top">Name</th>
                            {CI_CHECKS.map((c) => <th key={c.value} className="border px-2 text-left align-top"><Terms text={c.label} /></th>)}
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
                                                        <Link to={aiCheckUrl(app.id, doc)} className="underline text-sm ml-2">OCR extraction</Link>
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
            <CiFindingFlags applicationId={app.id}
                hasFindings={Object.values(byKey).some((c) => c.result === 'WITH_FINDINGS')} />
            <p className="pt-2"><span className="font-semibold">Overall <Term k="CI" /> remarks:</span>{' '}
                <span className="whitespace-pre-wrap">{meta.request.ci_remarks || '—'}</span></p>
        </div>
    );
};
