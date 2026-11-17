// CI results (BPMN Credit Investigator lane: TU, NFIS -> upload results -> Done). BRAS was dropped (meeting 2026-11-18).
// Per borrower and per check: the report file(s), a result and the CI's summarized findings, plus overall remarks.
// Uploaded reports are OCR'd by the PaddleOCR worker; NFIS and TU reports are then read by the AI and checked
// on the CI report check page (/documentCheckPage?ci=1, "OCR extraction" next to each file). Confirming there writes
// that report's result + summary (the same ci_checks row this page saves).
//   CiResultsEditor: the Credit Investigator, while the application is in Credit Investigation. Draws one of the
//     page's step subpages (show):
//       'reports': one card per borrower x check, worked top to bottom: upload the file, open its OCR extraction
//         (optional), choose the result and write the summary, Save. Each card saves on its own (save_ci_findings
//         with the other rows' saved values, so nothing else is written).
//       'send': a recap of every saved result, the overall remarks (their own Save), flag the findings, Mark CI Done.
//     It stays mounted across steps, so unsaved edits survive a step change. The OCR extraction is optional: a NFIS /
//     TU result chosen by hand is tagged "Not OCR-extracted".
//     Look: .lf-ci in ciRequest.css (a block per borrower, report cards with a status stripe, choice cards, the recap
//     table, the Mark CI Done panel).
//   CiResultsView:   read-only, for everyone else (CO's Financial Package, AO's loan folder) and after Done.
import { PanelSkeleton } from '../../components/skeleton';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ChevronDown, Clock, FileText, PenLine, Save, ScanText, Send, Trash2, Upload, UserRound } from 'lucide-react';
import { partyLabel } from '../applicationForm/options';
import { fetchStaffNames } from '../loanFolder/api';
import { completeCi, fetchCiDone, fetchCiRequests, getCiDocumentUrl, removeCiDocument, saveCiFindings, uploadCiDocument } from './api';
import { AI_CHECKED, REQUIRED_CHECKS, aiCheckUrl, fullName, isAiChecked, keyOf, missingItems, useCiResults } from './ciResultsData';
import { CI_CHECKS, CI_RESULTS } from './options';
import CiFindingFlags from './findingFlags';
import { Term, Terms } from '../../components/term';
import { useTermTitle } from '../../components/useTermTitle';

const MAX_TEXT = 4000;
const resultLabel = (value) => CI_RESULTS.find((r) => r.value === value)?.label ?? null;
const cardId = (p, c) => `ci-card-${p.id}-${c.value}`;

const openFile = async (doc, onError) => {
    try {
        window.open(await getCiDocumentUrl(doc), '_blank', 'noopener');
    } catch (err) {
        onError(err.message);
    }
};

// Status of one borrower x check, from what is saved: a missing required report or result waits on the CI (amber)
const cardStatus = (check, slot) => {
    const hasDoc = Boolean(slot?.documents?.length);
    if (hasDoc && slot?.result) return { label: 'Done', tone: 'ok', Icon: CheckCircle2 };
    if (!check.required) {
        if (!hasDoc && !slot?.result) return { label: 'Optional', tone: 'none' };
        return { label: hasDoc ? 'No result yet' : 'No report yet', tone: 'none' };
    }
    if (!hasDoc) return { label: 'Report missing', tone: 'warn', Icon: AlertTriangle };
    return { label: 'Result needed', tone: 'warn', Icon: Clock };
};

const Chip = ({ tone, Icon, children }) => (
    <span className={`lf-chip ci-chip ${tone}`}>{Icon && <Icon size={13} aria-hidden="true" />}{children}</span>
);

const AiTag = ({ checkType, slot, confirmed, hasResult }) => {
    if (!AI_CHECKED.has(checkType)) return null;
    if (isAiChecked(slot, confirmed)) return <Chip tone="ok" Icon={ScanText}>OCR-extracted</Chip>;
    return hasResult ? <Chip tone="none">Not OCR-extracted</Chip> : null;
};

// A borrower in step 2's dropdown row: person disc, name, role
const Person = ({ p, id }) => (
    <>
        <span className="ci-person" aria-hidden="true"><UserRound size={16} /></span>
        <h3 id={id}><span className="who">{fullName(p)}</span> <span className="role">{partyLabel(p)}</span></h3>
    </>
);

const ResultText = ({ value }) => (value
    ? <span className={value === 'WITH_FINDINGS' ? 'text-red-700 font-semibold' : 'text-green-700 font-semibold'}>{resultLabel(value)}</span>
    : <span className="italic text-gray-500">No result yet</span>);

// ============================================================
// Editor (Credit Investigator)
// ============================================================
// data: useCiResults(app) from the page (the steps read it too). show: 'reports' | 'send'.
// onGoTo(step, targetId?): open another step (and scroll to a card). onDirtyChange(bool): unsaved edits or not.
export const CiResultsEditor = ({ app, ciRequest, data, show, onGoTo, onChanged, onDirtyChange }) => {
    const { borrowers, byKey, confirmed, loading, error: loadError, reload } = data;
    const tt = useTermTitle();

    const [edits, setEdits] = useState({});           // key -> { result, summary } (unsaved)
    const [remarks, setRemarks] = useState(null);     // null = unchanged
    const [busy, setBusy] = useState(null);           // slot key (upload) / doc id / 'save:<key>' / 'remarks' / 'done'
    const [error, setError] = useState(null);         // { message, at: card key | 'remarks' | null }
    const [justSaved, setJustSaved] = useState(null); // card key or 'remarks', until the next edit
    const [openIds, setOpenIds] = useState(null);     // borrowers expanded in step 2 (null until the data loads)
    const [serverMissing, setServerMissing] = useState(null);

    const fail = (message, at = null) => setError({ message, at });
    const saved = (k) => ({ result: byKey[k]?.result ?? null, summary: byKey[k]?.summary ?? '' });
    const valueOf = (k) => ({
        result: edits[k]?.result !== undefined ? edits[k].result : saved(k).result,
        summary: edits[k]?.summary !== undefined ? edits[k].summary : saved(k).summary,
    });
    const savedRemarks = ciRequest?.ci_remarks ?? '';
    const currentRemarks = remarks ?? savedRemarks;

    const cardDirty = (k) => {
        const e = edits[k];
        if (!e) return false;
        return (e.result !== undefined && e.result !== saved(k).result)
            || (e.summary !== undefined && e.summary.trim() !== saved(k).summary);
    };
    // a card just saved counts as clean while its data reloads (its edits then match what is saved)
    const dirtyCards = Object.keys(edits).filter((k) => k !== justSaved && cardDirty(k));
    const remarksDirty = currentRemarks.trim() !== savedRemarks;
    const dirty = dirtyCards.length > 0 || remarksDirty;

    // Ask before closing the tab with unsaved edits; tell the page so its steps can show it
    useEffect(() => {
        onDirtyChange?.(dirty);
        if (!dirty) return undefined;
        const warn = (e) => { e.preventDefault(); };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [dirty, onDirtyChange]);

    const leaveOk = () => !dirty || window.confirm('You have unsaved changes on this page. Leave without saving?');
    const setField = (k, field, value) => {
        setEdits((prev) => ({ ...prev, [k]: { ...prev[k], [field]: value } }));
        setJustSaved(null);
    };
    const discard = (k) => setEdits((prev) => {
        const next = { ...prev };
        delete next[k];
        return next;
    });

    // Every row with its saved value, except the card being saved (save_ci_findings leaves unchanged rows alone)
    const rowsWith = (k) => borrowers.flatMap((p) => CI_CHECKS.map((c) => {
        const key = keyOf(p.id, c.value);
        const v = key === k ? valueOf(key) : saved(key);
        return { applicant_id: p.id, check_type: c.value, result: v.result, summary: v.summary };
    }));

    const handleUpload = async (party, checkType, files) => {
        const k = keyOf(party.id, checkType);
        setBusy(k);
        setError(null);
        try {
            for (const file of files) {
                await uploadCiDocument({ applicationId: app.id, applicantId: party.id, checkType, file });
            }
        } catch (err) {
            fail(err.message, k);
        } finally {
            setBusy(null);
            setServerMissing(null);
            reload();
        }
    };

    const handleRemove = async (doc, k) => {
        if (!window.confirm(`Remove ${doc.file_name}?`)) return;
        setBusy(doc.id);
        setError(null);
        try {
            await removeCiDocument(doc);
        } catch (err) {
            fail(err.message, k);
        } finally {
            setBusy(null);
            reload();
        }
    };

    const handleSaveCard = async (k) => {
        setBusy(`save:${k}`);
        setError(null);
        try {
            await saveCiFindings(app.id, rowsWith(k), savedRemarks);
            setJustSaved(k);
            setServerMissing(null);
            reload();
        } catch (err) {
            fail(err.message, k);
        } finally {
            setBusy(null);
        }
    };

    const handleSaveRemarks = async () => {
        setBusy('remarks');
        setError(null);
        try {
            await saveCiFindings(app.id, rowsWith(null), currentRemarks);
            await onChanged(); // the page reloads the request (saved remarks)
            setRemarks(null);
            setJustSaved('remarks');
        } catch (err) {
            fail(err.message, 'remarks');
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
            fail(err.message, 'done');
        } finally {
            setBusy(null);
        }
    };

    if (loading) return <PanelSkeleton label="Loading CI results" lines={5} />;

    const missing = serverMissing ?? missingItems(borrowers, byKey);
    const docsOf = (p, c) => byKey[keyOf(p.id, c.value)]?.documents ?? [];
    const borrowerDone = (p) => REQUIRED_CHECKS.every((c) => docsOf(p, c).length && saved(keyOf(p.id, c.value)).result);
    // Step 2 starts with one borrower expanded (the first with work left, else the first); after that it's the CI's choice
    if (openIds === null) setOpenIds(new Set([(borrowers.find((p) => !borrowerDone(p)) ?? borrowers[0])?.id]));
    const open = openIds ?? new Set();
    const setPersonOpen = (id, on) => setOpenIds((prev) => {
        const next = new Set(prev);
        if (on) next.add(id); else next.delete(id);
        return next;
    });
    // Open step 2 at one card: expand its borrower first, so the page can scroll to it
    const goToCard = (applicantId, checkType) => {
        setPersonOpen(applicantId, true);
        onGoTo('reports', `ci-card-${applicantId}-${checkType}`);
    };
    const errorAt = (at) => error?.at === at && <p className="lf-err" role="alert">{error.message}</p>;

    // Save state under a card or the remarks: unsaved (Discard / Save), or "Saved" until the next edit
    const saveFoot = (key, dirtyNow, onDiscard, onSave, label) => {
        const isDirty = dirtyNow && justSaved !== key;   // just saved: "Saved" while the data reloads
        return (isDirty || justSaved === key || error?.at === key) && (
        <div className="ci-card-foot">
            {errorAt(key)}
            {isDirty ? (
                <>
                    <Chip tone="warn" Icon={Clock}>Unsaved changes</Chip>
                    <span className="ci-card-acts">
                        <button type="button" className="lf-btn quiet" onClick={onDiscard}>Discard</button>
                        <button type="button" className="lf-primary" disabled={busy === `save:${key}` || busy === key} onClick={onSave}>
                            <Save size={16} aria-hidden="true" />{busy === `save:${key}` || busy === key ? 'Saving...' : 'Save'}
                            <span className="sr-only"> {label}</span>
                        </button>
                    </span>
                </>
            ) : justSaved === key && <span role="status"><Chip tone="ok" Icon={CheckCircle2}>Saved</Chip></span>}
        </div>
        );
    };

    // A report file: a pill that opens it, then its OCR extraction link and Remove
    const fileRow = (doc, k) => {
        const ocr = aiCheckUrl(app.id, doc);
        const done = confirmed.has(doc.id);
        return (
            <li key={doc.id} className="ci-file-row">
                <button type="button" className="ci-file" title={doc.original_file_name} onClick={() => openFile(doc, (m) => fail(m, k))}>
                    <FileText size={15} aria-hidden="true" /><span>{doc.file_name}</span>
                </button>
                <span className="ci-file-actions">
                    {ocr && (
                        <Link to={ocr} className={`ci-mini${done ? '' : ' go'}`} onClick={(e) => { if (!leaveOk()) e.preventDefault(); }}>
                            {done
                                ? <><CheckCircle2 size={14} aria-hidden="true" />Review OCR extraction</>
                                : <><ScanText size={14} aria-hidden="true" />Open OCR extraction</>}
                        </Link>
                    )}
                    <button type="button" className="ci-mini quiet" disabled={busy === doc.id} onClick={() => handleRemove(doc, k)}>
                        <Trash2 size={14} aria-hidden="true" />Remove<span className="sr-only"> {doc.file_name}</span>
                    </button>
                </span>
            </li>
        );
    };

    // Step 2: per borrower, one card per check: report | result + summary, then Save
    const reportCard = (p, c) => {
        const k = keyOf(p.id, c.value);
        const slot = byKey[k];
        const docs = docsOf(p, c);
        const v = valueOf(k);
        const status = cardStatus(c, slot);
        const id = cardId(p, c);
        const ocrHint = AI_CHECKED.has(c.value) && docs.length > 0 && !isAiChecked(slot, confirmed) && !v.result;
        const label = `${c.label} for ${fullName(p)}`;
        return (
            <li key={c.value} id={id} tabIndex={-1} className={`ci-card ${status.tone}`} aria-labelledby={`${id}-h`}>
                <div className="ci-card-head">
                    <h4 id={`${id}-h`}>
                        <Terms text={c.label} />
                        {c.required ? <span className="ci-req" aria-label="required">&nbsp;*</span> : <small> optional</small>}
                    </h4>
                    <span className="ci-card-chips">
                        <AiTag checkType={c.value} slot={slot} confirmed={confirmed} hasResult={!!saved(k).result} />
                        <Chip tone={status.tone} Icon={status.Icon}>{status.label}</Chip>
                    </span>
                </div>
                <div className="ci-card-body">
                    <div className="ci-card-files">
                        <p className="ci-card-label">Report</p>
                        {docs.length > 0
                            ? <ul className="ci-files">{docs.map((doc) => fileRow(doc, k))}</ul>
                            : <p className="ci-nofile">No file yet</p>}
                        <label className={`ci-upload${busy === k ? ' busy' : ''}`}>
                            <Upload size={16} aria-hidden="true" />
                            {busy === k ? 'Uploading...' : docs.length ? 'Add another file' : 'Upload report'}
                            <input type="file" multiple accept="image/jpeg,image/png,application/pdf" className="sr-only"
                                disabled={busy === k} aria-label={`Upload ${label} report`}
                                onChange={(e) => {
                                    const files = [...e.target.files];
                                    e.target.value = '';
                                    if (files.length) handleUpload(p, c.value, files);
                                }} />
                        </label>
                    </div>
                    <div className="ci-card-result">
                        <p className="ci-card-label" id={`${id}-res`}>Result</p>
                        {ocrHint && (
                            <p className="ci-hint">
                                <ScanText size={15} aria-hidden="true" />
                                <span>Open the <Term k="OCR" /> extraction to have the result and summary drafted for you to check, or choose them yourself.</span>
                            </p>
                        )}
                        <div className="lf-choices ci-choices" role="radiogroup" aria-labelledby={`${id}-h ${id}-res`}>
                            {CI_RESULTS.map((r) => {
                                const findings = r.value === 'WITH_FINDINGS';
                                return (
                                    <label key={r.value} className={`lf-choice ${findings ? 'warn' : 'ok'}`}>
                                        <input type="radio" name={`result-${k}`} checked={v.result === r.value}
                                            onChange={() => setField(k, 'result', r.value)} />
                                        {findings
                                            ? <AlertTriangle size={18} className="mark" aria-hidden="true" />
                                            : <CheckCircle2 size={18} className="mark" aria-hidden="true" />}
                                        <span><b>{r.label}</b></span>
                                    </label>
                                );
                            })}
                        </div>
                        {v.result && (
                            <button type="button" className="lf-linkbtn ci-clear" onClick={() => setField(k, 'result', null)}>Clear result</button>
                        )}
                        <div className="ci-summary">
                            <label htmlFor={`${id}-sum`}>Summary of findings</label>
                            <textarea id={`${id}-sum`} rows={3} value={v.summary} maxLength={MAX_TEXT}
                                onChange={(e) => setField(k, 'summary', e.target.value)} />
                            <span className="ci-counter">{v.summary.length} / {MAX_TEXT}</span>
                        </div>
                    </div>
                </div>
                {saveFoot(k, cardDirty(k), () => discard(k), () => handleSaveCard(k), label)}
            </li>
        );
    };

    const reportsStep = (
        <div className="ci-step" key="reports">
            <p className="ci-note">
                <Term k="NFIS" /> and <Term k="TU" /> are required for every borrower. Files are saved as soon
                as you upload them (JPG, PNG or PDF, up to 10 MB); the applicant can't see them. For NFIS and TU, the OCR extraction
                can draft the result and summary for you to check; you can also choose them yourself. Save each card.
            </p>
            {/* one dropdown per borrower; the closed row still shows each report's status and any unsaved card */}
            {borrowers.map((p) => {
                const unsaved = CI_CHECKS.some((c) => dirtyCards.includes(keyOf(p.id, c.value)));
                return (
                    <details key={p.id} className="ci-borrower" open={open.has(p.id)} onToggle={(e) => setPersonOpen(p.id, e.currentTarget.open)}>
                        <summary className="ci-person-head">
                            <Person p={p} id={`ci-b-${p.id}`} />
                            <span className="ci-person-chips">
                                {CI_CHECKS.map((c) => {
                                    const st = cardStatus(c, byKey[keyOf(p.id, c.value)]);
                                    return <Chip key={c.value} tone={st.tone} Icon={st.Icon}>{c.value}<span className="sr-only">: {st.label}</span></Chip>;
                                })}
                                {unsaved && <Chip tone="warn" Icon={Clock}>Unsaved</Chip>}
                            </span>
                            <ChevronDown size={18} className="ci-chev" aria-hidden="true" />
                        </summary>
                        <ul className="ci-cards">{CI_CHECKS.map((c) => reportCard(p, c))}</ul>
                    </details>
                );
            })}
        </div>
    );

    // Step 3: a recap of what is saved, overall remarks, flags, Mark CI Done
    const recapCell = (p, c) => {
        const slot = byKey[keyOf(p.id, c.value)];
        const docs = slot?.documents ?? [];
        const findings = slot?.result === 'WITH_FINDINGS';
        return (
            <td key={c.value}>
                <div className="ci-recap-cell">
                    {slot?.result
                        ? <Chip tone={findings ? 'warn' : 'ok'} Icon={findings ? AlertTriangle : CheckCircle2}>{resultLabel(slot.result)}</Chip>
                        : <Chip tone={c.required ? 'warn' : 'none'}>{c.required ? 'Result needed' : 'No result'}</Chip>}
                    <span className="ci-recap-meta">
                        <span className={docs.length || !c.required ? undefined : 'ci-recap-miss'}>
                            {docs.length ? `${docs.length} ${docs.length === 1 ? 'file' : 'files'}` : 'No report'}
                        </span>
                        {AI_CHECKED.has(c.value) && isAiChecked(slot, confirmed) && <span>OCR-extracted</span>}
                    </span>
                    {slot?.summary && <p className="ci-recap-sum">{slot.summary}</p>}
                    <button type="button" className="lf-linkbtn ci-recap-edit" onClick={() => goToCard(p.id, c.value)}>
                        <PenLine size={13} aria-hidden="true" />Edit<span className="sr-only"> {c.label} for {fullName(p)}</span>
                    </button>
                </div>
            </td>
        );
    };

    const sendStep = (
        <div className="ci-step" key="send">
            {dirtyCards.length > 0 && (
                <p className="ci-warn" role="note">
                    <AlertTriangle size={16} aria-hidden="true" />
                    <span>
                        <b>{dirtyCards.length === 1 ? 'One report card has' : `${dirtyCards.length} report cards have`} unsaved changes.</b>{' '}
                        The recap shows what is saved.{' '}
                        <button type="button" className="lf-linkbtn" onClick={() => { const [id, check] = dirtyCards[0].split(':'); goToCard(Number(id), check); }}>
                            Go to step 2 to save or discard them
                        </button>
                    </span>
                </p>
            )}

            <section className="ci-recap" aria-labelledby="ci-recap-h">
                <h3 id="ci-recap-h" className="ci-sub-h">Results</h3>
                <div className="ci-tablewrap">
                    <table>
                        <thead>
                            <tr>
                                <th>Borrower</th>
                                {CI_CHECKS.map((c) => <th key={c.value}><Terms text={c.label} /></th>)}
                            </tr>
                        </thead>
                        <tbody>
                            {borrowers.map((p) => (
                                <tr key={p.id}>
                                    <td className="ci-party">{fullName(p)}<small>{partyLabel(p)}</small></td>
                                    {CI_CHECKS.map((c) => recapCell(p, c))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            <div className="ci-summary ci-overall" title={tt('Overall CI remarks')}>
                <label htmlFor="ci-overall">Overall <Term k="CI" /> remarks <small>optional</small></label>
                <textarea id="ci-overall" rows={3} value={currentRemarks} maxLength={MAX_TEXT}
                    onChange={(e) => { setRemarks(e.target.value); setJustSaved(null); }} />
                <span className="ci-counter">{currentRemarks.length} / {MAX_TEXT}</span>
                {saveFoot('remarks', remarksDirty, () => setRemarks(null), handleSaveRemarks, 'overall CI remarks')}
            </div>

            <CiFindingFlags applicationId={app.id}
                hasFindings={Object.values(byKey).some((c) => c.result === 'WITH_FINDINGS')}
                unsaved={dirtyCards.some((k) => edits[k].result === 'WITH_FINDINGS')} />

            <section className={`ci-done ${missing.length ? 'warn' : 'ok'}`} aria-labelledby="ci-done-h">
                <div className="ci-done-head">
                    <span className="ci-done-ic" aria-hidden="true">
                        {missing.length ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
                    </span>
                    <div>
                        <h3 id="ci-done-h">Mark <Term k="CI" /> Done</h3>
                        <p>
                            {missing.length > 0
                                ? 'Still needed before this can go to the Credit Officer:'
                                : <Terms>All NFIS and TU results and reports are in.</Terms>}
                        </p>
                    </div>
                </div>
                {missing.length > 0 && <ul className="ci-still">{missing.map((m) => <li key={m}><Terms text={m} /></li>)}</ul>}
                {errorAt('done')}
                <div className="ci-done-foot">
                    <button type="button" className="lf-primary" title={tt('Mark CI Done')} disabled={missing.length > 0 || dirty || busy === 'done'} onClick={handleDone}>
                        <Send size={16} aria-hidden="true" />{busy === 'done' ? 'Sending...' : 'Mark CI Done and send to Credit Evaluation'}
                    </button>
                    {dirty && <span className="ci-unsaved">Save or discard your changes first.</span>}
                </div>
            </section>
        </div>
    );

    return (
        <>
            {loadError && <p className="lf-err" role="alert">{loadError}</p>}
            {error && error.at === null && <p className="lf-err" role="alert">{error.message}</p>}
            {{ reports: reportsStep, send: sendStep }[show] ?? null}
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
