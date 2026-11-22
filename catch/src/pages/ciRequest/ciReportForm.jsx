// The boxes for one borrower x check (NFIS or TU), on the CI report page next to the report (documentCheckPage, ci=1):
// result, report date, summary, the NFIS records or TU accounts, and every other field on the report (who was
// searched, the TU subject's identity, IDs, addresses, employers, summary totals, score, bureau flags, inquiries).
// One set of boxes for both ways of filling them:
//   - the Credit Investigator types what they read, or
//   - "Run AI": the AI reads the report and fills the SAME boxes (aiToForm + valuesFromAi). Nothing is saved until the
//     CI checks the boxes against the report and presses Save; that save also confirms the AI run (save_ci_card p_run_id).
// When the AI finishes reading and nothing is saved or typed yet, the boxes fill by themselves.
// Identity boxes show Matches / Differs against the application (documentCheck/compare.js); nothing is copied to it.
// The page remounts this (key) after a save, so it starts again from what is saved.
// Look: .ci-form in ciRequest.css (it carries .lf-ci, so the CI card styles apply inside the .lf-folder check page).
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, CircleHelp, Clock, Loader2, RotateCcw, Save, Sparkles } from 'lucide-react';
import { saveCiCard } from './api';
import { FactRowsEditor } from './ciFactsEditor';
import { aiToForm, rowProblems, rowsDirty, toDraft, toPayload } from './ciFactRows';
import { layoutOf, listRowSummary, newListRow, valuesDirty, valuesFromAi, valuesFromSaved, valuesPayload } from './ciReportValues';
import { applicationValue, compareStatus } from '../documentCheck/compare';
import { CI_RESULTS } from './options';
import './ciRequest.css';

const MAX_TEXT = 4000;
const RESULT_ICONS = { NO_ADVERSE_FINDINGS: CheckCircle2, WITH_FINDINGS: AlertTriangle, INCONCLUSIVE: CircleHelp };
const COMPARE_CHIPS = {
    MATCH: ['Matches application', 'ok'],
    DIFFERS: ['Differs from application', 'warn'],
    NOT_IN_APPLICATION: ['Not in application', 'none'],
};
const today = () => new Date().toISOString().slice(0, 10);

const fromSaved = (checkType, slot, layout) => ({
    result: slot?.result ?? null,
    summary: slot?.summary ?? '',
    report_date: slot?.report_date ?? '',
    rows: (slot?.rows ?? []).map((r) => toDraft(checkType, r)),
    values: valuesFromSaved(layout, slot?.values ?? []),
});
const isEmpty = (v, layout) => !v.result && !v.summary.trim() && !v.report_date && v.rows.length === 0
    && valuesPayload(layout, v.values).length === 0;

// One single box of "the rest of the report": label, input by kind, hint, and Matches / Differs when the
// application has the same thing
const Box = ({ id, box, value, onChange, disabled, ctx }) => {
    const appValue = box.compareWith && ctx ? applicationValue(box.def, ctx) : undefined;
    const status = value.trim() ? compareStatus(box.def, value, appValue, ctx) : null;
    const chip = COMPARE_CHIPS[status];
    return (
        <div className={`ci-fact-field${box.wide ? ' wide' : ''}`}>
            <label htmlFor={id}>{box.label}</label>
            {box.kind === 'select' ? (
                <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
                    <option value="">Pick...</option>
                    {box.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
            ) : (
                <input id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}
                    type={{ date: 'date', month: 'month', money: 'number', number: 'number' }[box.kind] ?? 'text'}
                    step={{ money: '0.01', number: 'any' }[box.kind]} inputMode={box.kind === 'money' ? 'decimal' : undefined}
                    maxLength={box.kind === 'text' ? 1000 : undefined} />
            )}
            {chip && <span className={`lf-chip ci-chip ${chip[1]} ci-compare`}>{chip[0]}</span>}
            {box.hint && <small>{box.hint}</small>}
        </div>
    );
};

// party: the borrower; checkType: NFIS | TU; slot: what is saved ({ result, summary, report_date, rows, values,
// documents }). defs: the AI's field list (extraction_field_defs); ctx: the borrower in the application, for the
// Matches / Differs tags. ai: { status (docStatus key of the report on screen), check (its fetchDocumentChecks
// entry), fileName }. onRunAi(): "Run AI" on the report on screen. onSaved(): reload. onDirtyChange(bool).
const CiReportForm = ({ party, checkType, slot, defs = [], ctx, canEdit, ai, running, onRunAi, onSaved, onDirtyChange }) => {
    const layout = useMemo(() => layoutOf(checkType, defs), [checkType, defs]);
    const saved = useMemo(() => fromSaved(checkType, slot, layout), [checkType, slot, layout]);
    const [value, setValue] = useState(saved);
    const [aiRunId, setAiRunId] = useState(null);     // the AI run that filled the boxes (null: typed by hand)
    const [autoFilled, setAutoFilled] = useState(null); // AI run the boxes were filled from by themselves
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const id = `ci-form-${party.id}-${checkType}`;
    const nfis = checkType === 'NFIS';

    const runId = ai?.check?.run?.id ?? null;
    const aiReady = ai?.status === 'READY' && runId !== null;
    const fromAi = () => ({ ...aiToForm(checkType, ai.check), values: valuesFromAi(layout, ai.check) });

    // The AI just finished (or had finished) and nothing is saved or typed: fill the boxes with what it read
    if (canEdit && aiReady && autoFilled !== runId && aiRunId === null && isEmpty(value, layout) && isEmpty(saved, layout)) {
        setAutoFilled(runId);
        setValue(fromAi());
        setAiRunId(runId);
    }

    const dirty = value.result !== saved.result || value.summary.trim() !== saved.summary
        || value.report_date !== saved.report_date || rowsDirty(checkType, value.rows, slot?.rows ?? [])
        || valuesDirty(layout, value.values, slot?.values ?? []) || aiRunId !== null;
    useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
    useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

    const set = (field, v) => setValue((prev) => ({ ...prev, [field]: v }));
    const setBox = (key, v) => setValue((prev) => ({ ...prev, values: { ...prev.values, fields: { ...prev.values.fields, [key]: v } } }));
    const setList = (group, rows) => setValue((prev) => ({ ...prev, values: { ...prev.values, lists: { ...prev.values.lists, [group]: rows } } }));
    const fillFromAi = () => {
        if (!isEmpty(value, layout) && !window.confirm('Replace what is in the boxes with what the AI read from this report?')) return;
        setValue(fromAi());
        setAiRunId(runId);
        setError(null);
    };
    const discard = () => { setValue(saved); setAiRunId(null); setError(null); };

    const save = async () => {
        const problems = rowProblems(checkType, value.rows);
        if (problems.length) { setError(problems.join(' ')); return; }
        setBusy(true);
        setError(null);
        try {
            await saveCiCard({
                applicantId: party.id, checkType, result: value.result, summary: value.summary,
                reportDate: value.report_date, rows: toPayload(checkType, value.rows),
                runId: aiRunId !== null && aiRunId === runId && aiReady ? aiRunId : null,
                values: valuesPayload(layout, value.values),
            });
            onDirtyChange?.(false);
            await onSaved();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    // The AI bar: what the AI can do for this report right now
    const aiBar = () => {
        if (!canEdit || !ai) return null;
        const s = ai.status;
        if (s === 'NOT_READ' || s === 'OCR_FAILED' || s === 'AI_FAILED') {
            const failed = s !== 'NOT_READ';
            return (
                <div className={`ci-aibar${failed ? ' err' : ''}`}>
                    {failed ? <AlertTriangle size={17} aria-hidden="true" /> : <Sparkles size={17} aria-hidden="true" />}
                    <p>{failed
                        ? "The AI couldn't read this report. Run it again, or fill in the boxes yourself."
                        : 'Optional: the AI reads this report and fills in the boxes below for you to check.'}</p>
                    <button type="button" className="ci-mini go" disabled={running} onClick={onRunAi}>
                        {failed ? <RotateCcw size={14} aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />}
                        {running ? 'Starting...' : failed ? 'Run AI again' : 'Run AI'}
                    </button>
                </div>
            );
        }
        if (s === 'OCR' || s === 'AI' || s === 'WAITING') {
            return (
                <div className="ci-aibar" role="status">
                    <Loader2 size={17} className="dc-spin" aria-hidden="true" />
                    <p>The AI is reading {ai.fileName}. The boxes fill in when it is done; you can also start typing.</p>
                </div>
            );
        }
        if (s === 'READY') {
            return aiRunId === runId ? (
                <div className="ci-aibar warn" role="status">
                    <Sparkles size={17} aria-hidden="true" />
                    <p><b>Filled in by the AI from {ai.fileName}.</b> Check every box against the report and fix what is wrong, then Save. Nothing is saved until you do. Boxes it couldn't fit (like a date in another format) are left empty.</p>
                </div>
            ) : (
                <div className="ci-aibar">
                    <Sparkles size={17} aria-hidden="true" />
                    <p>The AI has read {ai.fileName}.</p>
                    <button type="button" className="ci-mini go" onClick={fillFromAi}>
                        <Sparkles size={14} aria-hidden="true" />Fill the boxes with what it read
                    </button>
                </div>
            );
        }
        if (s === 'CONFIRMED') {
            return (
                <div className="ci-aibar ok">
                    <CheckCircle2 size={17} aria-hidden="true" />
                    <p>The AI's reading of {ai.fileName} was checked and saved.</p>
                </div>
            );
        }
        return null;
    };

    const ro = !canEdit;
    const filledBoxes = valuesPayload(layout, value.values).length;
    const hasRest = layout.sections.length > 0 || layout.groups.length > 0;
    return (
        <div className="lf-ci ci-form">
            {aiBar()}

            <fieldset className="ci-form-sec" disabled={ro}>
                <legend>Result</legend>
                <div className="lf-choices ci-choices" role="radiogroup" aria-label={`${checkType} result`}>
                    {CI_RESULTS.map((r) => {
                        const Icon = RESULT_ICONS[r.value];
                        return (
                            <label key={r.value} className={`lf-choice ${r.tone}`}>
                                <input type="radio" name={`${id}-result`} checked={value.result === r.value}
                                    onChange={() => set('result', r.value)} />
                                <Icon size={18} className="mark" aria-hidden="true" />
                                <span><b>{r.label}</b></span>
                            </label>
                        );
                    })}
                </div>
            </fieldset>

            <div className="ci-form-sec ci-summary ci-date">
                <label htmlFor={`${id}-date`}>Report date{!ro && <span className="ci-req" aria-label="required"> *</span>}</label>
                <input id={`${id}-date`} type="date" value={value.report_date} max={today()} disabled={ro}
                    onChange={(e) => set('report_date', e.target.value)} />
                <small>The date printed on the report. Over a year old (4 months for court cases), it has to be run again.</small>
            </div>

            <div className="ci-form-sec ci-summary">
                <label htmlFor={`${id}-sum`}>Summary of findings</label>
                <textarea id={`${id}-sum`} rows={3} value={value.summary} maxLength={MAX_TEXT} readOnly={ro}
                    onChange={(e) => set('summary', e.target.value)} />
                <span className="ci-counter">{value.summary.length} / {MAX_TEXT}</span>
            </div>

            <section className="ci-form-sec ci-facts-box" aria-labelledby={`${id}-rows`}>
                <h3 id={`${id}-rows`}>
                    {nfis ? 'NFIS records' : 'TU accounts'}
                    {!ro && nfis && value.result === 'WITH_FINDINGS' && <span className="ci-req" aria-label="required"> *</span>}
                    {value.rows.length > 0 && <small> {value.rows.length}</small>}
                </h3>
                {nfis && value.result === 'NO_ADVERSE_FINDINGS' && value.rows.length === 0 ? (
                    <p className="ci-facts-note">No adverse findings: no NFIS records to list.</p>
                ) : (
                    <>
                        <p className="ci-facts-hint">
                            {nfis
                                ? 'One per record on the NFIS result. The credit score and the policy check read these.'
                                : 'Every account on the TU report, open and closed. The credit score and FP XI. Loan Verification read these.'}
                        </p>
                        <FactRowsEditor checkType={checkType} rows={value.rows} files={nfis ? slot?.documents ?? [] : []}
                            disabled={ro} onChange={(rows) => set('rows', rows)} />
                    </>
                )}
            </section>

            {hasRest && (
                <details className="ci-form-sec ci-rest" open>
                    <summary>
                        <span>Rest of the report</span>
                        <small>{filledBoxes ? `${filledBoxes} filled in` : 'nothing filled in yet'}</small>
                        <ChevronDown size={16} className="ci-chev" aria-hidden="true" />
                    </summary>
                    <p className="ci-facts-hint">
                        Everything else on the report, as printed. Name, birth date and address are compared with the
                        application; nothing here changes the application.
                    </p>
                    {layout.sections.map((sec) => (
                        <fieldset key={sec.title} className="ci-rest-sec" disabled={ro}>
                            <legend>{sec.title}</legend>
                            <div className="ci-fact-grid">
                                {sec.boxes.map((b) => (
                                    <Box key={b.key} id={`${id}-v-${b.key}`} box={b} ctx={ctx} disabled={ro}
                                        value={value.values.fields[b.key] ?? ''} onChange={(v) => setBox(b.key, v)} />
                                ))}
                            </div>
                        </fieldset>
                    ))}
                    {layout.groups.map((g) => (
                        <section key={g.group} className="ci-rest-sec" aria-labelledby={`${id}-g-${g.group}`}>
                            <h4 id={`${id}-g-${g.group}`}>
                                {g.title}{(value.values.lists[g.group]?.length ?? 0) > 0 && <small> {value.values.lists[g.group].length}</small>}
                            </h4>
                            <FactRowsEditor rows={value.values.lists[g.group] ?? []} disabled={ro}
                                onChange={(rows) => setList(g.group, rows)} fields={g.boxes} noun={g.noun}
                                summarize={(row) => listRowSummary(g.boxes, row)} makeRow={() => newListRow(g.boxes)}
                                emptyText={`No ${g.title.toLowerCase()} listed.`} />
                        </section>
                    ))}
                </details>
            )}

            {canEdit && (dirty || error) && (
                <div className="ci-card-foot ci-form-foot">
                    {error && <p className="lf-err" role="alert">{error}</p>}
                    {dirty && (
                        <>
                            <span className="lf-chip ci-chip warn"><Clock size={13} aria-hidden="true" />Unsaved changes</span>
                            <span className="ci-card-acts">
                                <button type="button" className="lf-btn quiet" disabled={busy} onClick={discard}>Discard</button>
                                <button type="button" className="lf-primary" disabled={busy} onClick={save}>
                                    <Save size={16} aria-hidden="true" />{busy ? 'Saving...' : 'Save'}
                                </button>
                            </span>
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

export default CiReportForm;
