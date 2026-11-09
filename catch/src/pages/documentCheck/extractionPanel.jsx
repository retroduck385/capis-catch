// Right side of the document check: what the AI read from one document, field by field, next to what the
// applicant typed in. The assigned AO corrects values, picks per differing field whether the application keeps
// its value or takes the document's, then confirms & locks (confirm_extraction). Everyone else sees it read-only.
import { useEffect, useMemo, useState } from 'react';
import { confirmExtraction } from './api';
import {
    FORMAT_HINTS, LOW_CONFIDENCE, applicationValue, bankSummary, compareStatus, displayValue, isExpired, isValid,
    lowestConfidence, needsChoice, payslipSummary, percentOff,
} from './compare';

const KIND_LABELS = {
    PASSPORT: 'Passport', DRIVERS_LICENSE: "Driver's License", UMID: 'UMID', PHILSYS_ID: 'PhilSys ID',
    PRC_ID: 'PRC ID', POSTAL_ID: 'Postal ID', VOTERS_ID: "Voter's ID", SSS_ID: 'SSS ID', TIN_ID: 'TIN ID',
    OTHER_ID: 'Other ID', NOT_AN_ID: 'Not an ID', COE: 'Certificate of Employment',
    COEC: 'Certificate of Employment and Compensation', ITR_BIR_2316: 'ITR (BIR 2316)', ITR_BIR_1701: 'ITR (BIR 1701)',
    PAYSLIP: 'Payslips', PAYROLL_STATEMENT: 'Payroll statement', REMITTANCE: 'Remittance receipts',
    BANK_STATEMENT: 'Bank statement', PASSBOOK: 'Passbook', OTHER: 'Other / unclear',
};
const UNEXPECTED_KINDS = new Set(['NOT_AN_ID', 'OTHER']);

const STATUS_CHIPS = {
    MATCH: ['Matches application', 'bg-green-100 text-green-800'],
    DIFFERS: ['Differs from application', 'bg-red-100 text-red-800'],
    NOT_IN_APPLICATION: ['Not in application', 'bg-gray-100 text-gray-700'],
    NOT_ON_DOCUMENT: ['Not found on document', 'bg-gray-100 text-gray-700'],
};

const Chip = ({ className, children }) => (
    <span className={`text-xs rounded-full px-2 py-0.5 whitespace-nowrap ${className}`}>{children}</span>
);

const peso = (n) => displayValue(n, 'AMOUNT');
const monthLabel = (m) => new Date(`${m}-01T00:00:00`).toLocaleString('en-PH', { month: 'short', year: 'numeric' });

const ValueInput = ({ def, value, onChange, onFocus, readOnly, compact }) => {
    const cls = `border rounded w-full ${compact ? 'px-1 py-0.5 text-sm' : 'px-2 py-1'} ${readOnly ? 'bg-gray-50' : 'bg-white'}`;
    if (def.data_type === 'SEX') {
        return (
            <select className={cls} value={String(value ?? '').toUpperCase()} disabled={readOnly}
                onChange={(e) => onChange(e.target.value)} onFocus={onFocus}>
                <option value="">—</option>
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
            </select>
        );
    }
    return (
        <input className={cls} value={value ?? ''} readOnly={readOnly} placeholder={FORMAT_HINTS[def.data_type] ?? ''}
            inputMode={def.data_type === 'AMOUNT' ? 'decimal' : undefined}
            onChange={(e) => onChange(e.target.value)} onFocus={onFocus} aria-label={def.label} />
    );
};

const ExtractionPanel = ({ doc, defs, check, ctx, canEdit, names, focusedId, onFocusField, onConfirmed, onRerun, onDirtyChange }) => {
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

    const dirty = editable && (Object.keys(choices).length > 0
        || fields.some((f) => (values[f.id] ?? '') !== (f.extracted_value ?? '')));
    useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
    useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

    const defOf = useMemo(() => Object.fromEntries(defs.map((d) => [d.field_key, d])), [defs]);
    const headerDefs = defs.filter((d) => d.scope === 'HEADER');
    const rowDefs = defs.filter((d) => d.scope === 'ROW');
    const fieldOf = (key, itemNo = 0) => fields.find((f) => f.field_key === key && f.item_no === itemNo) ?? null;

    const itemNos = [...new Set(fields.filter((f) => f.item_no > 0).map((f) => f.item_no))].sort((a, b) => a - b);
    const rows = itemNos.map((n) => Object.fromEntries(rowDefs.map((d) => [d.field_key, fieldOf(d.field_key, n)])));
    const shownRowDefs = rowDefs.filter((d) => rows.some((r) => r[d.field_key] && (r[d.field_key].extracted_value || values[r[d.field_key].id])));
    const rowValues = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, f]) => [k, f ? values[f.id] : null])));

    // Per header field: comparison with the application and whether the AO must pick keep / update
    const header = headerDefs.map((def) => {
        const field = fieldOf(def.field_key);
        if (!field) return null;
        const value = values[field.id];
        const appValue = applicationValue(def, ctx);
        const status = compareStatus(def, value, appValue, ctx);
        return { def, field, value, appValue, status, needs: needsChoice(def, status) };
    }).filter(Boolean);

    const invalid = fields.filter((f) => defOf[f.field_key] && !isValid(values[f.id], defOf[f.field_key].data_type));
    const unpicked = header.filter((h) => h.needs && !choices[h.field.id]);
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
            await confirmExtraction(run.id, fields.map((f) => {
                const h = byId[f.id];
                const target = Boolean(defOf[f.field_key]?.target_column);
                return {
                    id: f.id,
                    final_value: String(values[f.id] ?? '').trim() || null,
                    apply_to_record: target ? Boolean(h?.needs && choices[f.id] === 'UPDATE') : null,
                };
            }));
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
    const issues = run.output?.issues ?? [];
    const lowLines = fields.filter((f) => (lowestConfidence(f.lines) ?? 1) < LOW_CONFIDENCE).length;

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
                    {off !== null && <> — documents show <strong className={Math.abs(off) > 10 ? 'text-red-700' : ''}>
                        {Math.abs(off).toFixed(1)}% {off >= 0 ? 'more' : 'less'}</strong></>}</p>
                {s.missing.length > 0 && <p className="text-red-700">No payslip for {s.missing.map(monthLabel).join(', ')}.</p>}
                {s.months.length < 3 && <p className="text-amber-700">The checklist asks for 3 months; these cover {s.months.length}.</p>}
            </>
        ) : <p>Add the period dates and gross pay to see the monthly average.</p>;
    } else if (doc.document_type === 'FS_BANK_STATEMENTS') {
        const s = bankSummary(rowValues);
        summary = s ? (
            <>
                <p><strong>Average monthly deposits (AMD): {peso(s.average)}</strong> over {s.months.length} month{s.months.length === 1 ? '' : 's'}
                    {' '}({monthLabel(s.months[0])} – {monthLabel(s.months.at(-1))})</p>
                {s.missing.length > 0 && <p className="text-red-700">No statement for {s.missing.map(monthLabel).join(', ')}.</p>}
            </>
        ) : <p>Add each month and its deposits to see the average monthly deposits.</p>;
    }

    const chipsFor = (def, field, value, status) => {
        const chips = [];
        if (status) {
            const [text, cls] = STATUS_CHIPS[status];
            chips.push(<Chip key="s" className={cls}>{def.compare_with === 'PRESENT_ADDRESS' && status === 'MATCH' ? 'Looks like application' : text}</Chip>);
        }
        const conf = lowestConfidence(field.lines);
        if (conf !== null && conf < LOW_CONFIDENCE) {
            chips.push(<Chip key="c" className="bg-amber-100 text-amber-800">Hard to read (OCR {Math.round(conf * 100)}%)</Chip>);
        }
        if (def.field_key === 'expiry_date' && isExpired(value)) chips.push(<Chip key="e" className="bg-red-100 text-red-800">Expired</Chip>);
        if ((value ?? '') !== (field.extracted_value ?? '')) chips.push(<Chip key="k" className="bg-blue-100 text-blue-800">Corrected</Chip>);
        if (!isValid(value, def.data_type)) chips.push(<Chip key="v" className="bg-red-100 text-red-800">Use {FORMAT_HINTS[def.data_type] ?? 'a valid value'}</Chip>);
        return chips;
    };

    return (
        <div className="flex flex-col h-full min-h-0">
            {/* Action bar (stays at the top while the fields scroll) */}
            <div className="border-b pb-3 mb-3">
                <div className="flex items-start gap-2 flex-wrap">
                    <div className="flex-1 min-w-0">
                        <p className="font-semibold">{kind ? KIND_LABELS[kind] ?? kind : 'Document'}</p>
                        <p className="text-xs text-gray-600">
                            Read by AI ({run.model}) on {new Date(run.finished_at ?? run.created_at).toLocaleString()} · {fields.length} values
                        </p>
                    </div>
                    {editable && !reviewing && (
                        <>
                            <button type="button" className="border rounded px-3 py-1.5 text-sm" onClick={onRerun} disabled={saving}>Run AI again</button>
                            <button type="button" className="rounded px-4 py-1.5 bg-blue-700 text-white disabled:opacity-50"
                                disabled={saving} onClick={() => { setError(null); setReviewing(true); }}>
                                Confirm & lock
                            </button>
                        </>
                    )}
                </div>

                {confirmed && (
                    <p className="mt-2 rounded bg-green-50 border border-green-200 px-3 py-2 text-green-800 text-sm">
                        Confirmed and locked by {names[run.confirmed_by] ?? 'Account Officer'} on {new Date(run.confirmed_at).toLocaleString()}.
                        {' '}{fields.filter((f) => f.apply_to_record).length} value(s) copied to the application.
                    </p>
                )}
                {!canEdit && !confirmed && (
                    <p className="mt-2 text-sm italic text-gray-600">View only. The assigned Account Officer confirms this, while the application is in Intake or Credit Investigation.</p>
                )}

                {editable && reviewing && (
                    <div className="mt-2 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
                        {invalid.length > 0 || unpicked.length > 0 ? (
                            <>
                                <p className="font-semibold">Before confirming:</p>
                                <ul className="list-disc pl-5">
                                    {invalid.map((f) => <li key={f.id}>{defOf[f.field_key].label}{f.item_no ? ` (row ${f.item_no})` : ''}: fix the format ({FORMAT_HINTS[defOf[f.field_key].data_type]})</li>)}
                                    {unpicked.map((h) => <li key={h.field.id}>{h.def.label}: choose whether to keep the application value or update it</li>)}
                                </ul>
                                <button type="button" className="mt-2 border rounded px-3 py-1 bg-white" onClick={() => setReviewing(false)}>Back</button>
                            </>
                        ) : (
                            <>
                                <p>You checked {fields.length} values against the document. {corrected.length} corrected.</p>
                                {toCopy.length > 0 ? (
                                    <p>These will be <strong>copied to the application</strong>: {toCopy.map((h) => `${h.def.label} → ${displayValue(h.value, h.def.data_type)}`).join('; ')}.</p>
                                ) : <p>Nothing will be copied to the application.</p>}
                                <p className="text-gray-700">After this the extraction is locked. Changes are recorded in the change history.</p>
                                <div className="flex gap-2 mt-2">
                                    <button type="button" className="rounded px-4 py-1.5 bg-blue-700 text-white disabled:opacity-50" disabled={saving} onClick={handleConfirm}>
                                        {saving ? 'Confirming...' : 'Yes, confirm & lock'}
                                    </button>
                                    <button type="button" className="border rounded px-3 py-1 bg-white" disabled={saving} onClick={() => setReviewing(false)}>Cancel</button>
                                </div>
                            </>
                        )}
                    </div>
                )}
                {error && <p className="mt-2 text-red-600 text-sm">{error}</p>}
            </div>

            <div className="flex-1 min-h-0 overflow-auto pr-1 space-y-4">
                {(issues.length > 0 || UNEXPECTED_KINDS.has(kind) || lowLines > 0) && (
                    <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
                        <p className="font-semibold">Check on the document</p>
                        <ul className="list-disc pl-5">
                            {UNEXPECTED_KINDS.has(kind) && <li>The AI isn't sure this is the right kind of document ({KIND_LABELS[kind]}).</li>}
                            {lowLines > 0 && <li>{lowLines} value(s) came from text the OCR found hard to read.</li>}
                            {issues.map((issue) => <li key={issue}>{issue}</li>)}
                        </ul>
                    </div>
                )}

                {header.length > 0 && (
                    <section>
                        <h4 className="font-semibold pb-1">Details</h4>
                        <div className="space-y-2">
                            {header.map(({ def, field, value, appValue, status, needs }) => (
                                <div key={field.id} onClick={() => onFocusField(field)}
                                    className={`rounded border p-2 ${focusedId === field.id ? 'ring-2 ring-amber-400 border-amber-400' : ''}`}>
                                    <div className="flex items-center gap-2 flex-wrap pb-1">
                                        <span className="text-sm font-semibold">{def.label}</span>
                                        {chipsFor(def, field, value, status)}
                                    </div>
                                    <ValueInput def={def} value={value} readOnly={!editable}
                                        onChange={(v) => setValue(field.id, v)} onFocus={() => onFocusField(field)} />
                                    {(value ?? '') !== (field.extracted_value ?? '') && (
                                        <p className="text-xs text-gray-600 pt-0.5">
                                            AI read: {displayValue(field.extracted_value, def.data_type)}
                                            {editable && <button type="button" className="underline ml-2" onClick={() => setValue(field.id, field.extracted_value ?? '')}>Undo</button>}
                                        </p>
                                    )}
                                    {appValue !== undefined && (
                                        <p className="text-sm pt-1"><span className="text-gray-600">Application:</span> {displayValue(appValue, def.data_type)}</p>
                                    )}
                                    {needs && editable && (
                                        <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-sm">
                                            <label>
                                                <input type="radio" name={`choice-${field.id}`} checked={choices[field.id] === 'KEEP'}
                                                    onChange={() => setChoice(field.id, 'KEEP')} /> Keep application value
                                            </label>
                                            <label>
                                                <input type="radio" name={`choice-${field.id}`} checked={choices[field.id] === 'UPDATE'}
                                                    onChange={() => setChoice(field.id, 'UPDATE')} />
                                                {' '}{status === 'NOT_IN_APPLICATION' ? 'Fill in the application with this value' : 'Update application to document value'}
                                            </label>
                                        </div>
                                    )}
                                    {status === 'DIFFERS' && !def.target_column && editable && (
                                        <p className="text-xs text-gray-600 pt-0.5">Fix this in the application form section if the application is wrong.</p>
                                    )}
                                    {confirmed && field.apply_to_record && <p className="text-xs text-green-700 pt-0.5">Copied to the application</p>}
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {rows.length > 0 && (
                    <section>
                        <h4 className="font-semibold pb-1">{doc.document_type === 'FS_BANK_STATEMENTS' ? 'Months' : 'Pay periods / transfers'}</h4>
                        <div className="overflow-x-auto">
                            <table className="text-sm border-collapse min-w-full">
                                <thead>
                                    <tr className="bg-gray-50">
                                        <th className="border px-1 py-1 text-left">#</th>
                                        {shownRowDefs.map((d) => <th key={d.field_key} className="border px-1 py-1 text-left whitespace-nowrap">{d.label}</th>)}
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map((r, i) => (
                                        <tr key={itemNos[i]}>
                                            <td className="border px-1">{itemNos[i]}</td>
                                            {shownRowDefs.map((d) => {
                                                const f = r[d.field_key];
                                                if (!f) return <td key={d.field_key} className="border px-1 text-gray-400">—</td>;
                                                const v = values[f.id];
                                                const conf = lowestConfidence(f.lines);
                                                const flagged = !isValid(v, d.data_type) || (conf !== null && conf < LOW_CONFIDENCE);
                                                return (
                                                    <td key={d.field_key} onClick={() => onFocusField(f)}
                                                        className={`border px-1 py-0.5 min-w-28 ${focusedId === f.id ? 'bg-amber-100' : ''} ${flagged ? 'bg-red-50' : ''}`}
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
                        <p className="text-xs text-gray-600 pt-1">Red cells: wrong format or hard-to-read text. Hover a corrected cell to see what the AI read.</p>
                    </section>
                )}

                {summary && (
                    <section className="rounded border bg-gray-50 px-3 py-2 text-sm space-y-0.5">
                        <h4 className="font-semibold">Summary (computed from the values above)</h4>
                        {summary}
                    </section>
                )}
            </div>
        </div>
    );
};

export default ExtractionPanel;
