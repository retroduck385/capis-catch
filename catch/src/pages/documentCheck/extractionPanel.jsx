// Right side of the document check: what the AI read from one document, field by field, next to what the
// applicant typed in. The assigned AO corrects values, picks per differing field whether the application keeps
// its value or takes the document's, then confirms & locks (confirm_extraction). Everyone else sees it read-only.
// CI reports (NFIS / TU, `ci` set): a Credit Investigator checks the values, edits the AI's proposed result and
// summary, and confirms (confirm_ci_extraction); that saves the CI result. Nothing is copied to the application.
// Look: .dc-* in documentCheck.css (inset field cards, Keep / Update pills, the table frame). Status chips use the
// page's tones: a difference or an expired ID is amber (it needs a look), a wrong format is the form red.
import { useEffect, useId, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, CircleHelp, Lock } from 'lucide-react';
import SelectMenu from '../../components/selectMenu';
import Byline from '../../components/byline';
import { CI_RESULTS } from '../ciRequest/options';
import { confirmCiExtraction, confirmExtraction } from './api';
import { readIssues, SEVERITIES } from './issues';
import { UNEXPECTED_KINDS, differsTone, fieldTone } from './severity';
import {
    FORMAT_HINTS, LOW_CONFIDENCE, applicationValue, bankSummary, compareStatus, displayValue, isExpired, isValid,
    lowestConfidence, needsChoice, payslipSummary, percentOff, toNumber, tuSummary,
} from './compare';
import { formatMoney } from '../applicationForm/options';
import { Term, Terms } from '../../components/term';

// The word chip beside a note under "Check on the document": Major in red, Minor in yellow (documentCheck.css .dc-sev)
// Hover shows the definition, so there is no separate legend.
const SeverityChip = ({ severity }) => (
    <span className={`dc-sev ${SEVERITIES[severity].tone}`} title={SEVERITIES[severity].hint}>
        {SEVERITIES[severity].label}
    </span>
);

// "These will be copied to the application": this many show at once, the rest open from a dropdown
const COPY_SHOWN = 4;
const CopyItem = ({ h }) => <li><b>{h.def.label}</b> → {displayValue(h.value, h.def.data_type)}</li>;

const KIND_LABELS = {
    PASSPORT: 'Passport', DRIVERS_LICENSE: "Driver's License", UMID: 'UMID', PHILSYS_ID: 'PhilSys ID',
    PRC_ID: 'PRC ID', POSTAL_ID: 'Postal ID', VOTERS_ID: "Voter's ID", SSS_ID: 'SSS ID', TIN_ID: 'TIN ID',
    OTHER_ID: 'Other ID', NOT_AN_ID: 'Not an ID', COE: 'Certificate of Employment',
    COEC: 'Certificate of Employment and Compensation', ITR_BIR_2316: 'ITR (BIR 2316)', ITR_BIR_1701: 'ITR (BIR 1701)',
    PAYSLIP: 'Payslips', PAYROLL_STATEMENT: 'Payroll statement', REMITTANCE: 'Remittance receipts',
    BANK_STATEMENT: 'Bank statement', PASSBOOK: 'Passbook', NFIS_RESULT: 'NFIS result',
    TU_CREDIT_REPORT: 'TransUnion credit report', OTHER: 'Other / unclear',
};

// Row lists (extraction_field_defs.row_group); 'rows' = pay periods or statement months
const ROW_GROUP_LABELS = {
    ids: 'IDs', addresses: 'Addresses', employers: 'Employment', accounts: 'Accounts', inquiries: 'Previous inquiries',
};
const groupOf = (def) => def.row_group ?? 'rows';
const resultLabel = (value) => CI_RESULTS.find((r) => r.value === value)?.label ?? '—';

const STATUS_CHIPS = {
    MATCH: ['Matches application', 'ok'],
    DIFFERS: ['Differs from application', 'warn'],
    NOT_IN_APPLICATION: ['Not in application', 'none'],
    NOT_ON_DOCUMENT: ['Not found on document', 'none'],
};

// tone: ok | warn | none | info | err (.lf-chip tones; info and err come from documentCheck.css)
const Chip = ({ tone, children }) => <span className={`lf-chip dc-chip ${tone}`}>{children}</span>;

const peso = (n) => displayValue(n, 'AMOUNT');
const monthLabel = (m) => new Date(`${m}-01T00:00:00`).toLocaleString('en-PH', { month: 'short', year: 'numeric' });

const SEX_OPTIONS = [{ value: 'MALE', label: 'Male' }, { value: 'FEMALE', label: 'Female' }];

const ValueInput = ({ def, value, onChange, onFocus, readOnly, compact }) => {
    const [focused, setFocused] = useState(false);
    const id = useId();
    const cls = `dc-input${compact ? ' compact' : ''}`;
    if (def.data_type === 'SEX') {
        // the animated dropdown (components/selectMenu.jsx); focus bubbles up to highlight the field on the document
        return (
            <div className="dc-select" onFocus={onFocus}>
                <SelectMenu id={`dc-sex${id.replace(/:/g, '')}`} value={String(value ?? '').toUpperCase()} options={SEX_OPTIONS}
                    placeholder="—" disabled={readOnly} aria-label={def.label} onChange={onChange} />
            </div>
        );
    }
    // Amounts, like the form's money boxes: typed as they are, shown with commas and cents once you leave the box.
    // Display only: the value kept and confirmed is exactly what was read or typed.
    const amount = def.data_type === 'AMOUNT' && !focused ? toNumber(value) : null;
    return (
        <input className={cls} value={amount !== null ? formatMoney(amount) : value ?? ''} readOnly={readOnly}
            placeholder={FORMAT_HINTS[def.data_type] ?? ''}
            inputMode={['AMOUNT', 'NUMBER'].includes(def.data_type) ? 'decimal' : undefined}
            onChange={(e) => onChange(e.target.value)} onFocus={(e) => { setFocused(true); onFocus?.(e); }}
            onBlur={() => setFocused(false)} aria-label={def.label} />
    );
};

// ci = null for application documents; for CI reports { check: saved ci_checks row | null, label: "TU for <name>" }
const ExtractionPanel = ({ doc, defs, check, ctx, canEdit, names, focusedId, onFocusField, onConfirmed, onDirtyChange, ci = null }) => {
    const { run, fields } = check;
    const confirmed = Boolean(run.confirmed_at);
    const editable = canEdit && !confirmed;

    const initial = useMemo(() => Object.fromEntries(fields.map((f) =>
        [f.id, (confirmed ? f.final_value : f.extracted_value) ?? ''])), [fields, confirmed]);
    const [values, setValues] = useState(initial);
    const [choices, setChoices] = useState({});
    const [reviewing, setReviewing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    // CI reports: the AI's proposed result + summary, edited by the CI (after confirm: what's saved now)
    const proposedResult = run.output?.proposed_result ?? '';
    const proposedSummary = run.output?.findings_summary ?? '';
    const [ciResult, setCiResult] = useState(confirmed ? ci?.check?.result ?? '' : proposedResult);
    const [ciSummary, setCiSummary] = useState(confirmed ? ci?.check?.summary ?? '' : proposedSummary);

    const dirty = editable && (Object.keys(choices).length > 0
        || fields.some((f) => (values[f.id] ?? '') !== (f.extracted_value ?? ''))
        || (ci && (ciResult !== proposedResult || ciSummary.trim() !== proposedSummary.trim())));
    useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
    useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

    const defOf = useMemo(() => Object.fromEntries(defs.map((d) => [d.field_key, d])), [defs]);
    const headerDefs = defs.filter((d) => d.scope === 'HEADER');
    const fieldOf = (key, itemNo = 0) => fields.find((f) => f.field_key === key && f.item_no === itemNo) ?? null;

    // One table per row list; item_no counts 1..n within each list
    const rowGroups = [...new Set(defs.filter((d) => d.scope === 'ROW').map(groupOf))].map((group) => {
        const groupDefs = defs.filter((d) => d.scope === 'ROW' && groupOf(d) === group);
        const keys = new Set(groupDefs.map((d) => d.field_key));
        const itemNos = [...new Set(fields.filter((f) => f.item_no > 0 && keys.has(f.field_key)).map((f) => f.item_no))]
            .sort((a, b) => a - b);
        const rows = itemNos.map((n) => Object.fromEntries(groupDefs.map((d) => [d.field_key, fieldOf(d.field_key, n)])));
        return {
            group, itemNos, rows,
            shownDefs: groupDefs.filter((d) => rows.some((r) => r[d.field_key] && (r[d.field_key].extracted_value || values[r[d.field_key].id]))),
            values: rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, f]) => [k, f ? values[f.id] : null]))),
        };
    }).filter((g) => g.rows.length > 0);
    const groupValues = Object.fromEntries(rowGroups.map((g) => [g.group, g.values]));
    const rowValues = groupValues.rows ?? [];

    // Per header field: comparison with the application and whether the AO must pick keep / update
    const header = headerDefs.map((def) => {
        const field = fieldOf(def.field_key);
        if (!field) return null;
        const value = values[field.id];
        const appValue = applicationValue(def, ctx);
        const status = compareStatus(def, value, appValue, ctx);
        const tone = fieldTone({
            def, status,
            expired: def.field_key === 'expiry_date' && isExpired(value),
            invalid: !isValid(value, def.data_type),
            lowConfidence: (lowestConfidence(field.lines) ?? 1) < LOW_CONFIDENCE,
        });
        return { def, field, value, appValue, status, tone, needs: needsChoice(def, status) };
    }).filter(Boolean);

    const invalid = fields.filter((f) => defOf[f.field_key] && !isValid(values[f.id], defOf[f.field_key].data_type));
    const unpicked = header.filter((h) => h.needs && !choices[h.field.id]);
    const emptyUpdate = header.filter((h) => h.status === 'NOT_ON_DOCUMENT' && choices[h.field.id] === 'UPDATE');
    const ciProblems = !ci ? [] : [
        !ciResult && 'Pick the result: No adverse findings, With findings or Inconclusive.',
        ciResult === 'WITH_FINDINGS' && !ciSummary.trim() && 'Write a summary of the findings.',
    ].filter(Boolean);
    const toCopy = header.filter((h) => h.needs && choices[h.field.id] === 'UPDATE');
    const corrected = fields.filter((f) => (values[f.id] ?? '') !== (f.extracted_value ?? ''));

    const setValue = (id, v) => {
        setValues((prev) => ({ ...prev, [id]: v }));
        setReviewing(false);
    };
    const setChoice = (id, choice) => {
        setChoices((prev) => ({ ...prev, [id]: choice }));
        setReviewing(false);
    };

    const handleConfirm = async () => {
        setSaving(true);
        setError(null);
        try {
            const byId = Object.fromEntries(header.map((h) => [h.field.id, h]));
            const finalValue = (f) => String(values[f.id] ?? '').trim() || null;
            if (ci) {
                await confirmCiExtraction(run.id, fields.map((f) => ({ id: f.id, final_value: finalValue(f) })),
                    ciResult, ciSummary.trim() || null);
            } else {
                await confirmExtraction(run.id, fields.map((f) => {
                    const h = byId[f.id];
                    const target = Boolean(defOf[f.field_key]?.target_column);
                    return {
                        id: f.id,
                        final_value: finalValue(f),
                        apply_to_record: target ? Boolean(h?.needs && choices[f.id] === 'UPDATE') : null,
                    };
                }));
            }
            onDirtyChange?.(false);
            await onConfirmed();
        } catch (err) {
            setError(err.message);
            setReviewing(false);
        } finally {
            setSaving(false);
        }
    };

    const kind = run.output?.document_kind;
    const issues = readIssues(run.output);
    const lowLines = fields.filter((f) => (lowestConfidence(f.lines) ?? 1) < LOW_CONFIDENCE).length;
    // the box's warning icon takes the worst severity in it
    const worstTone = (issues.some((i) => i.severity === 'MAJOR') || UNEXPECTED_KINDS.has(kind)) ? 'dc-sev-major'
        : (issues.some((i) => i.severity === 'MINOR') || lowLines > 0) ? 'dc-sev-minor' : '';

    let summary = null;
    if (doc.document_type === 'PAYSLIPS_REMITTANCES') {
        const s = payslipSummary(rowValues);
        const declared = ctx.employment?.gross_monthly_income ?? null;
        const off = s ? percentOff(s.average, declared) : null;
        summary = s ? (
            <>
                <p><strong>Average monthly gross: {peso(s.average)}</strong> over {s.months.length} month{s.months.length === 1 ? '' : 's'}
                    {' '}({s.months.map(monthLabel).join(', ')})</p>
                <p>Declared gross monthly income: {declared === null ? 'not given' : peso(declared)}
                    {off !== null && <> — documents show <strong className={Math.abs(off) > 10 ? 'dc-flag' : ''}>
                        {Math.abs(off).toFixed(1)}% {off >= 0 ? 'more' : 'less'}</strong></>}</p>
                {s.missing.length > 0 && <p className="dc-flag">No payslip for {s.missing.map(monthLabel).join(', ')}.</p>}
                {s.months.length < 3 && <p className="dc-flag">The checklist asks for 3 months; these cover {s.months.length}.</p>}
            </>
        ) : <p>Add the period dates and gross pay to see the monthly average.</p>;
    } else if (doc.document_type === 'FS_BANK_STATEMENTS') {
        const s = bankSummary(rowValues);
        summary = s ? (
            <>
                <p><strong>Average monthly deposits (<Term k="AMD" />): {peso(s.average)}</strong> over {s.months.length} month{s.months.length === 1 ? '' : 's'}
                    {' '}({monthLabel(s.months[0])} – {monthLabel(s.months.at(-1))})</p>
                {s.missing.length > 0 && <p className="dc-flag">No statement for {s.missing.map(monthLabel).join(', ')}.</p>}
            </>
        ) : <p>Add each month and its deposits to see the average monthly deposits.</p>;
    } else if (doc.document_type === 'CI_TU') {
        const t = tuSummary(Object.fromEntries(header.map((h) => [h.def.field_key, h.value])), groupValues, ctx.party);
        const accountName = (r) => [r.acct_lender, r.acct_type].filter(Boolean).join(' · ') || 'Account';
        summary = (
            <>
                <p>Open accounts on the report: <strong>{t.open.length}</strong> ({t.openCards.length} card{t.openCards.length === 1 ? '' : 's'},
                    {' '}{t.openLoans.length} loan{t.openLoans.length === 1 ? '' : 's'}). Declared in the application:
                    {' '}{t.declaredCards.length} card{t.declaredCards.length === 1 ? '' : 's'}, {t.declaredLoans.length} loan{t.declaredLoans.length === 1 ? '' : 's'}.</p>
                <p>Monthly installments on open loans: {peso(t.reportInstallments)} on the report vs {peso(t.declaredInstallments)} declared.</p>
                {t.undeclaredLoans.map((r, i) => (
                    <p key={`u${i}`} className="dc-flag">Not declared in the application: {accountName(r)}
                        {r.acct_installment ? `, ${peso(r.acct_installment)}/mo` : ''}{r.acct_balance ? `, balance ${peso(r.acct_balance)}` : ''}.</p>
                ))}
                {t.openCards.length > t.declaredCards.length && (
                    <p className="dc-flag">The report shows {t.openCards.length} open card(s); the application lists {t.declaredCards.length}.</p>
                )}
                {t.adverse.map(({ row, flags }, i) => (
                    <p key={`a${i}`} className="dc-flag">{accountName(row)}{row.acct_section ? ` (${String(row.acct_section).toLowerCase()})` : ''}: {flags.join('; ')}.</p>
                ))}
                {t.flags.map((f) => <p key={f} className="dc-flag">{f}.</p>)}
                {t.recentInquiries > 0 && <p className="dc-flag">{t.recentInquiries} new credit application(s) in the last 6 months.</p>}
                {t.idChecks.map((c, i) => (
                    <p key={`i${i}`} className={c.status === 'DIFFERS' ? 'dc-flag' : ''}>
                        {c.type} on the report {c.number}: {c.status === 'MATCH' ? 'matches the application'
                            : c.status === 'DIFFERS' ? `differs from the application (${c.appValue})` : 'not in the application'}.
                    </p>
                ))}
                {t.adverse.length === 0 && t.flags.length === 0 && t.undeclaredLoans.length === 0 && (
                    <p className="dc-good">No past dues, late payments or undeclared loans found in the values above.</p>
                )}
            </>
        );
    }

    const chipsFor = (def, field, value, status) => {
        const chips = [];
        if (status) {
            const [text, tone] = STATUS_CHIPS[status];
            // a difference on a key fact (name, birth date, TIN, income ...) is a problem (red), others a look (amber)
            const shown = status === 'DIFFERS' ? (differsTone(def) === 'bad' ? 'err' : 'warn') : tone;
            chips.push(<Chip key="s" tone={shown}>{text}</Chip>);
        }
        const conf = lowestConfidence(field.lines);
        if (conf !== null && conf < LOW_CONFIDENCE) {
            chips.push(<Chip key="c" tone="warn">Hard to read (<Term k="OCR" /> {Math.round(conf * 100)}%)</Chip>);
        }
        if (def.field_key === 'expiry_date' && isExpired(value)) chips.push(<Chip key="e" tone="err">Expired</Chip>);
        if ((value ?? '') !== (field.extracted_value ?? '')) chips.push(<Chip key="k" tone="info">Corrected</Chip>);
        if (!isValid(value, def.data_type)) chips.push(<Chip key="v" tone="err">Use {FORMAT_HINTS[def.data_type] ?? 'a valid value'}</Chip>);
        return chips;
    };

    // Keep / Update: what each choice does, shown under the pills once one is picked (not only in a tooltip)
    const explainChoice = (key, status, def, value, appValue) => (status === 'NOT_ON_DOCUMENT'
        ? (key === 'KEEP'
            ? `Keep what the applicant entered (${displayValue(appValue, def.data_type)}). The document doesn't show it.`
            : 'Type the value as it appears on the document in the box above; it then replaces the application value.')
        : key === 'KEEP'
        ? (status === 'NOT_IN_APPLICATION' ? 'Leave this blank in the application.'
            : `Keep what the applicant entered (${displayValue(appValue, def.data_type)}). The application is not changed.`)
        : (status === 'NOT_IN_APPLICATION' ? `Add ${displayValue(value, def.data_type)} to the application.`
            : `Change the application to what the document says (${displayValue(value, def.data_type)}).`));

    return (
        <div className="dc-x">
            {/* Action bar (stays at the top while the fields scroll) */}
            <div className="dc-actionbar">
                <div className="dc-actionbar-top">
                    <div className="dc-kind">
                        <p className="dc-kind-name"><Terms text={kind ? KIND_LABELS[kind] ?? kind : 'Document'} /></p>
                        <p className="dc-muted">
                            <Byline layout="inline" ai role={run.model} at={run.finished_at ?? run.created_at} /> <span className="dc-count">{fields.length} values</span>
                        </p>
                    </div>
                    {editable && !reviewing && (
                        <div className="dc-acts">
                            <button type="button" className="lf-primary" disabled={saving} onClick={() => { setError(null); setReviewing(true); }}>
                                Confirm
                            </button>
                        </div>
                    )}
                </div>

                {confirmed && (
                    <p className="dc-strip ok">
                        <CheckCircle2 size={16} aria-hidden="true" />
                        <span>
                            <span className="dc-strip-by">Confirmed by <Byline layout="inline" name={names[run.confirmed_by]} fallback={ci ? 'Credit Investigator' : 'Account Officer'} at={run.confirmed_at} /></span>
                            {' '}{ci ? <Terms text='The result and summary were saved to the CI results.' />
                                : `${fields.filter((f) => f.apply_to_record).length} value(s) copied to the application.`}
                        </span>
                    </p>
                )}
                {!canEdit && !confirmed && (
                    <p className="lf-note">
                        <Lock size={16} aria-hidden="true" />
                        <span>{ci ? 'View only. A Credit Investigator confirms this, while the application is in Credit Investigation.'
                            : 'View only. The assigned Account Officer confirms this, while the application is in Intake or Credit Investigation.'}</span>
                    </p>
                )}

                {editable && reviewing && (
                    <div className="dc-review" role="region" aria-label="Confirm the values">
                        {invalid.length > 0 || unpicked.length > 0 || emptyUpdate.length > 0 || ciProblems.length > 0 ? (
                            <>
                                <p className="dc-review-title"><AlertTriangle size={16} aria-hidden="true" />Before confirming</p>
                                <ul>
                                    {invalid.map((f) => <li key={f.id}>{defOf[f.field_key].label}{f.item_no ? ` (row ${f.item_no})` : ''}: fix the format ({FORMAT_HINTS[defOf[f.field_key].data_type]})</li>)}
                                    {unpicked.map((h) => <li key={h.field.id}>{h.def.label}: choose whether to keep the application value or update it</li>)}
                                    {emptyUpdate.map((h) => <li key={`e${h.field.id}`}>{h.def.label}: type the value as it appears on the document, or choose Keep</li>)}
                                    {ciProblems.map((m) => <li key={m}>{m}</li>)}
                                </ul>
                                <div className="dc-acts"><button type="button" className="lf-btn quiet" onClick={() => setReviewing(false)}>Back</button></div>
                            </>
                        ) : (
                            <>
                                <p className="dc-review-title">You checked {fields.length} values against the document. {corrected.length} corrected.</p>
                                {ci ? (
                                    <>
                                        <p>Saved to the <Term k="CI" /> results (<Terms text={ci.label} />): <strong>{resultLabel(ciResult)}</strong>
                                            {ciSummary.trim() ? ` — "${ciSummary.trim()}"` : ''}.</p>
                                        {(ci.check?.result || ci.check?.summary)
                                            && (ci.check.result !== ciResult || (ci.check.summary ?? '') !== ciSummary.trim()) && (
                                            <p className="dc-flag">This replaces the saved result ({resultLabel(ci.check.result)}{ci.check.summary ? `: "${ci.check.summary}"` : ''}).</p>
                                        )}
                                        <p>Nothing is copied to the application.</p>
                                    </>
                                ) : toCopy.length > 0 ? (
                                    <>
                                        <p>These {toCopy.length === 1 ? 'value' : 'values'} will be <strong>copied to the application</strong>:</p>
                                        <ul className="dc-copylist">
                                            {toCopy.slice(0, COPY_SHOWN).map((h) => <CopyItem key={h.field.id} h={h} />)}
                                        </ul>
                                        {toCopy.length > COPY_SHOWN + 1 && (
                                            <details className="dc-more">
                                                <summary>Show {toCopy.length - COPY_SHOWN} more <ChevronDown size={15} aria-hidden="true" /></summary>
                                                <ul className="dc-copylist">
                                                    {toCopy.slice(COPY_SHOWN).map((h) => <CopyItem key={h.field.id} h={h} />)}
                                                </ul>
                                            </details>
                                        )}
                                        {toCopy.length === COPY_SHOWN + 1 && (
                                            <ul className="dc-copylist"><CopyItem h={toCopy[COPY_SHOWN]} /></ul>
                                        )}
                                    </>
                                ) : <p>Nothing will be copied to the application.</p>}
                                <p className="dc-muted">After this the values can&apos;t be changed. Changes are recorded in the change history.</p>
                                <div className="dc-acts">
                                    <button type="button" className="lf-primary" disabled={saving} onClick={handleConfirm}>
                                        {saving ? 'Confirming...' : 'Yes, confirm'}
                                    </button>
                                    <button type="button" className="lf-btn quiet" disabled={saving} onClick={() => setReviewing(false)}>Cancel</button>
                                </div>
                            </>
                        )}
                    </div>
                )}
                {error && <p className="lf-err" role="alert">{error}</p>}
            </div>

            <div className="dc-scroll">
                {(issues.length > 0 || UNEXPECTED_KINDS.has(kind) || lowLines > 0) && (
                    <div className="lf-warnnote dc-issues">
                        <AlertTriangle size={16} aria-hidden="true" className={worstTone} />
                        <div>
                            <p>Check on the document</p>
                            <ul>
                                {UNEXPECTED_KINDS.has(kind) && (
                                    <li><SeverityChip severity="MAJOR" /><span>The AI isn&apos;t sure this is the right kind of document (<Terms text={KIND_LABELS[kind]} />).</span></li>
                                )}
                                {issues.filter((i) => i.severity === 'MAJOR').map((i, n) => <li key={`major-${n}`}><SeverityChip severity="MAJOR" /><span>{i.text}</span></li>)}
                                {lowLines > 0 && <li><SeverityChip severity="MINOR" /><span>{lowLines} value(s) came from text the <Term k="OCR" /> found hard to read.</span></li>}
                                {issues.filter((i) => i.severity === 'MINOR').map((i, n) => <li key={`minor-${n}`}><SeverityChip severity="MINOR" /><span>{i.text}</span></li>)}
                                {issues.filter((i) => !i.severity).map((i, n) => <li key={`plain-${n}`} className="plain"><span>{i.text}</span></li>)}
                            </ul>
                        </div>
                    </div>
                )}

                {ci && (
                    <section className="dc-sub">
                        <h3 className="dc-h"><Terms text={confirmed ? 'CI result (saved now)' : 'Proposed CI result'} /></h3>
                        {!confirmed && <p className="dc-muted"><Terms>Drafted by the AI from the values below. Check it against the report and edit it; it is saved to the CI results only when you confirm.</Terms></p>}
                        <fieldset className="lf-choices">
                            <legend className="sr-only"><Term k="CI" /> result</legend>
                            {CI_RESULTS.map((r) => (
                                <label key={r.value} className={`lf-choice ${r.tone}`}>
                                    <input type="radio" name={`ci-result-${run.id}`} checked={ciResult === r.value} disabled={!editable}
                                        onChange={() => { setCiResult(r.value); setReviewing(false); }} />
                                    {r.value === 'NO_ADVERSE_FINDINGS'
                                        ? <CheckCircle2 size={20} className="mark" aria-hidden="true" />
                                        : r.value === 'INCONCLUSIVE'
                                            ? <CircleHelp size={20} className="mark" aria-hidden="true" />
                                            : <AlertTriangle size={20} className="mark" aria-hidden="true" />}
                                    <span><b>{r.label}</b></span>
                                </label>
                            ))}
                        </fieldset>
                        <label className="lf-fieldlabel" htmlFor={`ci-summary-${run.id}`}>Summary of findings</label>
                        <textarea id={`ci-summary-${run.id}`} rows={4} maxLength={4000} readOnly={!editable} value={ciSummary}
                            className="dc-input" onChange={(e) => { setCiSummary(e.target.value); setReviewing(false); }} />
                        {editable && (ciResult !== proposedResult || ciSummary.trim() !== proposedSummary.trim()) && (
                            <p className="dc-muted">
                                AI proposed: {resultLabel(proposedResult)}{proposedSummary ? ` — "${proposedSummary}"` : ''}
                                {' '}<button type="button" className="lf-linkbtn" onClick={() => { setCiResult(proposedResult); setCiSummary(proposedSummary); }}>Undo</button>
                            </p>
                        )}
                    </section>
                )}

                {header.length > 0 && (
                    <section>
                        <h3 className="dc-h">Details</h3>
                        <div className="dc-fieldlist">
                            {header.map(({ def, field, value, appValue, status, tone, needs }) => {
                                // Keep: the box shows the application's value (read only). Display only: what the
                                // document says (value) stays the staged reading, and nothing is copied (apply_to_record false).
                                const kept = needs && editable && choices[field.id] === 'KEEP';
                                return (
                                <div key={field.id} onClick={() => onFocusField(field)}
                                    className={`dc-field sev-${tone}${focusedId === field.id ? ' on' : ''}`}>
                                    <div className="dc-field-top">
                                        <span className="dc-field-label">{def.label}</span>
                                        {chipsFor(def, field, value, status)}
                                    </div>
                                    <ValueInput def={def} value={kept ? (appValue ?? '') : value} readOnly={!editable || kept}
                                        onChange={(v) => setValue(field.id, v)} onFocus={() => onFocusField(field)} />
                                    {kept && (
                                        <p className="dc-muted">
                                            Showing the application&apos;s value. The document says: {displayValue(value, def.data_type)}
                                        </p>
                                    )}
                                    {(value ?? '') !== (field.extracted_value ?? '') && (
                                        <p className="dc-muted">
                                            AI read: {displayValue(field.extracted_value, def.data_type)}
                                            {editable && <>{' '}<button type="button" className="lf-linkbtn" onClick={() => setValue(field.id, field.extracted_value ?? '')}>Undo</button></>}
                                        </p>
                                    )}
                                    {appValue !== undefined && (
                                        <p className="dc-app"><span>Application</span>{displayValue(appValue, def.data_type)}</p>
                                    )}
                                    {needs && editable && (
                                        <>
                                            <div className="dc-pick" role="radiogroup" aria-label={`${def.label}: keep the application value or update it`}>
                                                {[['KEEP', 'Keep'], ['UPDATE', 'Update']].map(([key, label]) => (
                                                    <label key={key} title={explainChoice(key, status, def, value, appValue)}>
                                                        <input type="radio" name={`choice-${field.id}`} checked={choices[field.id] === key}
                                                            onChange={(e) => {
                                                                setChoice(field.id, key);
                                                                if (key === 'UPDATE' && status === 'NOT_ON_DOCUMENT') {
                                                                    e.currentTarget.closest('.dc-field')?.querySelector('input.dc-input, .dc-select button')?.focus();
                                                                }
                                                            }} />
                                                        {label}
                                                        <span className="sr-only">: {explainChoice(key, status, def, value, appValue)}</span>
                                                    </label>
                                                ))}
                                            </div>
                                            <p className="dc-muted" aria-hidden="true">
                                                {choices[field.id] ? explainChoice(choices[field.id], status, def, value, appValue)
                                                    : 'Choose Keep or Update before confirming.'}
                                            </p>
                                        </>
                                    )}
                                    {status === 'DIFFERS' && !def.target_column && editable && (
                                        <p className="dc-muted">
                                            {ci ? 'Mention it in the summary if it matters. The Account Officer corrects the application.'
                                                : 'Fix this in the application form section if the application is wrong.'}
                                        </p>
                                    )}
                                    {confirmed && field.apply_to_record && <p className="dc-good dc-small">Copied to the application</p>}
                                </div>
                                );
                            })}
                        </div>
                    </section>
                )}

                {rowGroups.map(({ group, itemNos, rows, shownDefs }) => (
                    <section key={group}>
                        <h3 className="dc-h">
                            {ROW_GROUP_LABELS[group] ?? (doc.document_type === 'FS_BANK_STATEMENTS' ? 'Months' : 'Pay periods / transfers')}
                        </h3>
                        <div className="dc-tablewrap">
                            <table>
                                <thead>
                                    <tr>
                                        <th>#</th>
                                        {shownDefs.map((d) => <th key={d.field_key}>{d.label}</th>)}
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map((r, i) => (
                                        <tr key={itemNos[i]}>
                                            <td className="num">{itemNos[i]}</td>
                                            {shownDefs.map((d) => {
                                                const f = r[d.field_key];
                                                if (!f) return <td key={d.field_key} className="none">—</td>;
                                                const v = values[f.id];
                                                const conf = lowestConfidence(f.lines);
                                                const flagged = !isValid(v, d.data_type) || (conf !== null && conf < LOW_CONFIDENCE);
                                                return (
                                                    <td key={d.field_key} onClick={() => onFocusField(f)}
                                                        className={[focusedId === f.id ? 'on' : '', flagged ? 'flag' : ''].filter(Boolean).join(' ') || undefined}
                                                        title={(v ?? '') !== (f.extracted_value ?? '') ? `AI read: ${f.extracted_value ?? '—'}` : undefined}>
                                                        <ValueInput def={d} value={v} compact readOnly={!editable}
                                                            onChange={(nv) => setValue(f.id, nv)} onFocus={() => onFocusField(f)} />
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </section>
                ))}
                {rowGroups.length > 0 && (
                    <p className="dc-muted dc-legend">Amber cells: wrong format or hard-to-read text. Hover a corrected cell to see what the AI read.</p>
                )}

                {summary && (
                    <section className="dc-sub dc-summary">
                        <h3 className="dc-h">{ci ? 'Checks against the application (computed from the values above)' : 'Summary (computed from the values above)'}</h3>
                        {summary}
                    </section>
                )}
            </div>
        </div>
    );
};

export default ExtractionPanel;
