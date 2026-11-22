// CI results (BPMN Credit Investigator lane: TU, NFIS -> upload results -> Done). BRAS was dropped (meeting 2026-11-18).
// Per borrower and per check: the report file(s), a result, the report date, the CI's summary of findings and the
// NFIS records / TU accounts, plus overall remarks.
// Those are filled in on the CI report page ("Open report": /documentCheckPage?ci=1), report on the left and ONE set
// of boxes on the right (ciReportForm.jsx). The CI types them, or presses Run AI there and the AI fills the same boxes
// for them to check; nothing is saved until they press Save (save_ci_card, 20261126_ci_facts.sql).
//   CiResultsEditor: the Credit Investigator, while the application is in Credit Investigation. Draws one of the
//     page's step subpages (show):
//       'reports': one card per borrower x check: upload the file(s), see what is saved, Open report to fill it in.
//       'send': a recap of every saved result, the overall remarks (their own Save), flag the findings, Mark CI Done.
//     Look: .lf-ci in ciRequest.css (a block per borrower, report cards with a status stripe, the recap table, the Mark
//     CI Done panel).
//   CiResultsView:   read-only, for everyone else (CO's Financial Package, AO's loan folder) and after Done.
import { PanelSkeleton } from '../../components/skeleton';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, CircleHelp, Clock, FileText, PenLine, Save, Send, Sparkles, Trash2, Upload, UserRound } from 'lucide-react';
import { partyLabel } from '../applicationForm/options';
import { fetchStaffNames } from '../loanFolder/api';
import { completeCi, fetchCiDone, fetchCiRequests, getCiDocumentUrl, removeCiDocument, saveCiFindings, uploadCiDocument } from './api';
import { FactRowsView } from './ciFactsEditor';
import { AI_CHECKED, REQUIRED_CHECKS, fullName, isAiChecked, keyOf, missingItems, reportUrl, useCiResults } from './ciResultsData';
import { CI_CHECKS, CI_RESULTS, needsAttention, resultTone } from './options';
import CiFindingFlags from './findingFlags';
import CiFileChecks from './ciFileChecks';
import { Term, Terms } from '../../components/term';
import { useTermTitle } from '../../components/useTermTitle';

const MAX_TEXT = 4000;
const DROP_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
const resultLabel = (value) => CI_RESULTS.find((r) => r.value === value)?.label ?? null;
const cardId = (p, c) => `ci-card-${p.id}-${c.value}`;
const RESULT_ICONS = { NO_ADVERSE_FINDINGS: CheckCircle2, WITH_FINDINGS: AlertTriangle, INCONCLUSIVE: CircleHelp };
const showDay = (v) => (v ? new Date(`${v}T00:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : null);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

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
    if (hasDoc && slot?.result) {
        if (!slot.report_date) return { label: 'Report date needed', tone: 'warn', Icon: Clock };
        if (check.value === 'NFIS' && slot.result === 'WITH_FINDINGS' && !slot.rows?.length) {
            return { label: 'Records needed', tone: 'warn', Icon: Clock };
        }
        if (check.value === 'NFIS' && slot.result === 'NO_ADVERSE_FINDINGS' && slot.rows?.length) {
            return { label: 'Result and records disagree', tone: 'warn', Icon: AlertTriangle };
        }
        return { label: 'Done', tone: 'ok', Icon: CheckCircle2 };
    }
    if (!check.required) {
        if (!hasDoc && !slot?.result) return { label: 'Optional', tone: 'none' };
        return { label: hasDoc ? 'No result yet' : 'No report yet', tone: 'none' };
    }
    if (!hasDoc) return { label: 'Report missing', tone: 'warn', Icon: AlertTriangle };
    return { label: 'To fill in', tone: 'warn', Icon: Clock };
};

const Chip = ({ tone, Icon, children }) => (
    <span className={`lf-chip ci-chip ${tone}`}>{Icon && <Icon size={13} aria-hidden="true" />}{children}</span>
);

// How the saved boxes were filled: by the AI (a confirmed AI reading of one of the files) or typed by hand
const AiTag = ({ checkType, slot, confirmed, hasResult }) => {
    if (!AI_CHECKED.has(checkType)) return null;
    if (isAiChecked(slot, confirmed)) return <Chip tone="ok" Icon={Sparkles}>Filled by AI, checked</Chip>;
    return hasResult ? <Chip tone="none">Typed by hand</Chip> : null;
};

// A borrower in step 2's dropdown row: person disc, name, role
const Person = ({ p, id }) => (
    <>
        <span className="ci-person" aria-hidden="true"><UserRound size={16} /></span>
        <h3 id={id}><span className="who">{fullName(p)}</span> <span className="role">{partyLabel(p)}</span></h3>
    </>
);

const ResultText = ({ value }) => (value
    ? <span className={resultTone(value) === 'ok' ? 'text-green-700 font-semibold' : 'text-red-700 font-semibold'}>{resultLabel(value)}</span>
    : <span className="italic text-gray-500">No result yet</span>);

// ============================================================
// Editor (Credit Investigator)
// ============================================================
// data: useCiResults(app) from the page (the steps read it too). show: 'reports' | 'send'.
// onGoTo(step, targetId?): open another step (and scroll to a card). onDirtyChange(bool): unsaved edits or not.
export const CiResultsEditor = ({ app, ciRequest, data, show, onGoTo, onChanged, onDirtyChange }) => {
    const { borrowers, byKey, confirmed, loading, error: loadError, reload } = data;
    const tt = useTermTitle();

    const [remarks, setRemarks] = useState(null);     // null = unchanged
    const [busy, setBusy] = useState(null);           // slot key (upload) / doc id / 'remarks' / 'done'
    const [error, setError] = useState(null);         // { message, at: card key | 'remarks' | null }
    const [justSaved, setJustSaved] = useState(null); // 'remarks', until the next edit
    const [dragKey, setDragKey] = useState(null);     // report card a file is being dragged over
    const [openIds, setOpenIds] = useState(null);     // borrowers expanded in step 2 (null until the data loads)
    const [serverMissing, setServerMissing] = useState(null);

    const fail = (message, at = null) => setError({ message, at });
    const savedRemarks = ciRequest?.ci_remarks ?? '';
    const currentRemarks = remarks ?? savedRemarks;
    const remarksDirty = currentRemarks.trim() !== savedRemarks;
    const dirty = remarksDirty;

    // Ask before closing the tab with unsaved remarks; tell the page so its steps can show it
    useEffect(() => {
        onDirtyChange?.(dirty);
        if (!dirty) return undefined;
        const warn = (e) => { e.preventDefault(); };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [dirty, onDirtyChange]);

    const leaveOk = () => !dirty || window.confirm('You have unsaved changes on this page. Leave without saving?');

    // Every saved result + summary as is (save_ci_findings leaves unchanged rows alone): only the remarks change
    const savedRows = () => borrowers.flatMap((p) => CI_CHECKS.map((c) => {
        const slot = byKey[keyOf(p.id, c.value)];
        return { applicant_id: p.id, check_type: c.value, result: slot?.result ?? null, summary: slot?.summary ?? '' };
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

    // Drag and drop onto a report card: the same upload as the button, but only PDF / JPG / PNG (the picker's accept
    // list doesn't apply to dropped files)
    const dragHasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
    const handleDrop = (e, party, checkType) => {
        const k = keyOf(party.id, checkType);
        e.preventDefault();
        setDragKey(null);
        if (busy === k) return;
        const dropped = [...e.dataTransfer.files];
        const ok = dropped.filter((f) => DROP_TYPES.includes(f.type));
        if (ok.length === 0) {
            fail('Only PDF, JPG or PNG files can be uploaded.', k);
            return;
        }
        if (ok.length < dropped.length) fail(`${dropped.length - ok.length} file(s) skipped: only PDF, JPG or PNG can be uploaded.`, k);
        handleUpload(party, checkType, ok);
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

    const handleSaveRemarks = async () => {
        setBusy('remarks');
        setError(null);
        try {
            await saveCiFindings(app.id, savedRows(), currentRemarks);
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
    const borrowerDone = (p) => REQUIRED_CHECKS.every((c) => cardStatus(c, byKey[keyOf(p.id, c.value)]).tone === 'ok');
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

    // Save state under the remarks: unsaved (Discard / Save), or "Saved" until the next edit
    const saveFoot = (key, dirtyNow, onDiscard, onSave, label) => {
        const isDirty = dirtyNow && justSaved !== key;
        return (isDirty || justSaved === key || error?.at === key) && (
        <div className="ci-card-foot">
            {errorAt(key)}
            {isDirty ? (
                <>
                    <Chip tone="warn" Icon={Clock}>Unsaved changes</Chip>
                    <span className="ci-card-acts">
                        <button type="button" className="lf-btn quiet" onClick={onDiscard}>Discard</button>
                        <button type="button" className="lf-primary" disabled={busy === key} onClick={onSave}>
                            <Save size={16} aria-hidden="true" />{busy === key ? 'Saving...' : 'Save'}
                            <span className="sr-only"> {label}</span>
                        </button>
                    </span>
                </>
            ) : justSaved === key && <span role="status"><Chip tone="ok" Icon={CheckCircle2}>Saved</Chip></span>}
        </div>
        );
    };

    // A report file: a pill that opens it in a new tab, and Remove
    const fileRow = (doc, k) => (
        <li key={doc.id} className="ci-file-row">
            <button type="button" className="ci-file" title={doc.original_file_name} onClick={() => openFile(doc, (m) => fail(m, k))}>
                <FileText size={15} aria-hidden="true" /><span>{doc.file_name}</span>
            </button>
            <span className="ci-file-actions">
                <button type="button" className="ci-mini quiet" disabled={busy === doc.id} onClick={() => handleRemove(doc, k)}>
                    <Trash2 size={14} aria-hidden="true" />Remove<span className="sr-only"> {doc.file_name}</span>
                </button>
            </span>
        </li>
    );

    // Step 2: per borrower, one card per check: the report file(s) | what is saved, and Open report to fill it in
    const reportCard = (p, c) => {
        const k = keyOf(p.id, c.value);
        const slot = byKey[k];
        const docs = docsOf(p, c);
        const status = cardStatus(c, slot);
        const id = cardId(p, c);
        const label = `${c.label} for ${fullName(p)}`;
        const rows = slot?.rows?.length ?? 0;
        return (
            <li key={c.value} id={id} tabIndex={-1} className={`ci-card ${status.tone}`} aria-labelledby={`${id}-h`}>
                <div className="ci-card-head">
                    <h4 id={`${id}-h`}>
                        <Terms text={c.label} />
                        {c.required ? <span className="ci-req" aria-label="required">&nbsp;*</span> : <small> optional</small>}
                    </h4>
                    <span className="ci-card-chips">
                        <AiTag checkType={c.value} slot={slot} confirmed={confirmed} hasResult={!!slot?.result} />
                        <Chip tone={status.tone} Icon={status.Icon}>{status.label}</Chip>
                    </span>
                </div>
                <div className="ci-card-body">
                    <div className={`ci-card-files${dragKey === k ? ' dragging' : ''}`}
                        onDragOver={(e) => { if (dragHasFiles(e) && busy !== k) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (dragKey !== k) setDragKey(k); } }}
                        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragKey((cur) => (cur === k ? null : cur)); }}
                        onDrop={(e) => { if (dragHasFiles(e)) handleDrop(e, p, c.value); }}>
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
                        {dragKey === k && <p className="ci-dropnote" aria-hidden="true"><Upload size={20} />Drop to upload</p>}
                        {errorAt(k)}
                    </div>
                    <div className="ci-card-result">
                        <p className="ci-card-label">Saved</p>
                        {slot?.result ? (
                            <ul className="ci-saved">
                                <li><Chip tone={resultTone(slot.result)} Icon={RESULT_ICONS[slot.result]}>{resultLabel(slot.result)}</Chip></li>
                                <li className={slot.report_date ? undefined : 'ci-recap-miss'}>
                                    {slot.report_date ? `Report dated ${showDay(slot.report_date)}` : 'No report date yet'}
                                </li>
                                {(c.value === 'TU' || rows > 0) && (
                                    <li>{plural(rows, c.value === 'NFIS' ? 'NFIS record' : 'TU account')}</li>
                                )}
                                {slot.summary && <li className="ci-recap-sum">{slot.summary}</li>}
                            </ul>
                        ) : <p className="ci-nofile">Nothing filled in yet.</p>}
                        {docs.length > 0 ? (
                            <Link to={reportUrl(app.id, docs[0])} className="lf-primary ci-open"
                                onClick={(e) => { if (!leaveOk()) e.preventDefault(); }}>
                                {slot?.result ? 'Open report' : 'Open report to fill it in'}<ArrowRight size={16} aria-hidden="true" />
                                <span className="sr-only"> {label}</span>
                            </Link>
                        ) : <p className="ci-facts-hint">Upload the report first, then open it to fill in the result.</p>}
                    </div>
                </div>
            </li>
        );
    };

    const reportsStep = (
        <div className="ci-step" key="reports">
            <p className="ci-note">
                <Term k="NFIS" /> and <Term k="TU" /> are required for every borrower. Files are saved as soon
                as you upload them (JPG, PNG or PDF, up to 10 MB); the applicant can't see them. Then press Open report:
                the report shows next to the boxes to fill in. You can type them yourself, or press Run AI there to have them
                filled for you to check.
            </p>
            {/* one dropdown per borrower; the closed row still shows each report's status */}
            {borrowers.map((p) => (
                <details key={p.id} className="ci-borrower" open={open.has(p.id)} onToggle={(e) => setPersonOpen(p.id, e.currentTarget.open)}>
                    <summary className="ci-person-head">
                        <Person p={p} id={`ci-b-${p.id}`} />
                        <span className="ci-person-chips">
                            {CI_CHECKS.map((c) => {
                                const st = cardStatus(c, byKey[keyOf(p.id, c.value)]);
                                return <Chip key={c.value} tone={st.tone} Icon={st.Icon}>{c.value}<span className="sr-only">: {st.label}</span></Chip>;
                            })}
                        </span>
                        <ChevronDown size={18} className="ci-chev" aria-hidden="true" />
                    </summary>
                    <ul className="ci-cards">{CI_CHECKS.map((c) => reportCard(p, c))}</ul>
                </details>
            ))}
        </div>
    );

    // Step 3: a recap of what is saved, overall remarks, flags, Mark CI Done
    const recapCell = (p, c) => {
        const slot = byKey[keyOf(p.id, c.value)];
        const docs = slot?.documents ?? [];
        return (
            <td key={c.value}>
                <div className="ci-recap-cell">
                    {slot?.result
                        ? <Chip tone={resultTone(slot.result)} Icon={RESULT_ICONS[slot.result]}>{resultLabel(slot.result)}</Chip>
                        : <Chip tone={c.required ? 'warn' : 'none'}>{c.required ? 'Result needed' : 'No result'}</Chip>}
                    <span className="ci-recap-meta">
                        <span className={docs.length || !c.required ? undefined : 'ci-recap-miss'}>
                            {docs.length ? `${docs.length} ${docs.length === 1 ? 'file' : 'files'}` : 'No report'}
                        </span>
                        {slot?.report_date
                            ? <span>Dated {showDay(slot.report_date)}</span>
                            : <span className="ci-recap-miss">No report date</span>}
                        {slot?.rows?.length > 0 && <span>{slot.rows.length} {c.value === 'NFIS' ? 'record' : 'account'}{slot.rows.length === 1 ? '' : 's'}</span>}
                        {AI_CHECKED.has(c.value) && isAiChecked(slot, confirmed) && <span>Filled by AI, checked</span>}
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
                hasFindings={Object.values(byKey).some((c) => needsAttention(c.result))} />

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
// Read-only view (CO, AO, heads; and the CI after Done). computed: computeFp() when the page has it (the LCR and
// DBR in "What the CI results mean for this file").
// ============================================================
export const CiResultsView = ({ app, title = 'CI results', computed = null }) => {
    const { borrowers, byKey, raw, loading, error: loadError } = useCiResults(app);
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
                                            {saved?.report_date && <p className="text-sm">Report dated {showDay(saved.report_date)}</p>}
                                            {saved?.summary && <p className="whitespace-pre-wrap">{saved.summary}</p>}
                                            <FactRowsView checkType={c.value} rows={saved?.rows} />
                                            {(saved?.documents ?? []).map((doc) => (
                                                <span key={doc.id} className="block">
                                                    <button type="button" className="underline text-left"
                                                        title={doc.original_file_name} onClick={() => openFile(doc, setError)}>
                                                        {doc.file_name}
                                                    </button>
                                                    <Link to={reportUrl(app.id, doc)} className="underline text-sm ml-2">Open report</Link>
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
            <CiFileChecks app={app} ci={raw} computed={computed} />
            <CiFindingFlags applicationId={app.id}
                hasFindings={Object.values(byKey).some((c) => needsAttention(c.result))} />
            <p className="pt-2"><span className="font-semibold">Overall <Term k="CI" /> remarks:</span>{' '}
                <span className="whitespace-pre-wrap">{meta.request.ci_remarks || '—'}</span></p>
        </div>
    );
};
