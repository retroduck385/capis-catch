// The rows a Credit Investigator types on a report card (20261126_ci_facts.sql): one per NFIS record, one per TU
// account (every account, open and closed). Saved with the card's result and summary (saveCiCard).
//   FactRowsEditor: the CI's editor. Each row is a collapsible box; fields that don't apply to the row's kind are
//     hidden (and saved empty), required ones carry a *. The DB checks the same rules and names the row on an error.
//   FactRowsView:   read-only list, for the CO / AO / heads (CiResultsView).
// Field lists, drafts and payloads: ciFactRows.js. Look: .ci-facts in ciRequest.css.
import { useId } from 'react';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { FIELDS, NOUN, YES_NO, isRequired, rowSummary, shown, toDraft } from './ciFactRows';

// ---------- editor ----------
// rows: drafts (toDraft); onChange(nextDrafts). files: this borrower's NFIS files (certificate of full payment).
// For the other lists on a report (IDs, addresses, employers, inquiries: ciReportValues.js) the field list, the noun,
// the one-line summary and a new empty row are passed in instead of coming from checkType.
export const FactRowsEditor = ({
    checkType, rows, onChange, files = [], disabled = false, fields, noun: nounProp, summarize, makeRow, emptyText,
}) => {
    const uid = useId().replace(/:/g, '');
    const list = fields ?? FIELDS[checkType];
    const noun = nounProp ?? NOUN[checkType];
    const sum = summarize ?? ((r) => rowSummary(checkType, r));
    const setValue = (key, field, value) => onChange(rows.map((r) => (r._key === key ? { ...r, [field]: value } : r)));
    const remove = (row) => {
        if (row.id && !window.confirm(`Remove this ${noun}? It goes when you save the card.`)) return;
        onChange(rows.filter((r) => r._key !== row._key));
    };
    const add = () => onChange([...rows, { ...(makeRow ? makeRow() : toDraft(checkType)), _new: true }]);

    const input = (f, row) => {
        const id = `${uid}-${row._key}-${f.key}`;
        const common = { id, disabled, value: row[f.key], onChange: (e) => setValue(row._key, f.key, e.target.value) };
        const options = f.kind === 'bool' ? YES_NO
            : f.kind === 'file' ? files.map((d) => ({ value: String(d.id), label: d.file_name })) : f.options;
        return (
            <div key={f.key} className={`ci-fact-field${f.wide ? ' wide' : ''}`}>
                <label htmlFor={id}>
                    {f.label}{isRequired(f, row) && <span className="ci-req" aria-label="required"> *</span>}
                </label>
                {options ? (
                    <select {...common} required={isRequired(f, row)}>
                        <option value="">{f.kind === 'file' && options.length === 0 ? 'No NFIS file to pick' : 'Pick...'}</option>
                        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                ) : (
                    <input {...common} required={isRequired(f, row)}
                        type={{ date: 'date', month: 'month', text: 'text' }[f.kind] ?? 'number'}
                        inputMode={f.kind === 'money' || f.kind === 'number' ? 'decimal' : f.kind === 'int' ? 'numeric' : undefined}
                        step={{ money: '0.01', int: '1', number: 'any' }[f.kind]}
                        min={f.kind === 'money' || f.kind === 'int' ? '0' : undefined}
                        max={f.kind === 'date' ? new Date().toISOString().slice(0, 10) : undefined}
                        maxLength={f.kind === 'text' ? (f.wide ? 1000 : 200) : undefined} />
                )}
                {f.hint && <small>{f.hint}</small>}
            </div>
        );
    };

    return (
        <div className="ci-facts">
            {rows.length === 0 && (
                <p className="ci-facts-empty">
                    {emptyText ?? (checkType === 'NFIS' ? 'No records listed.' : 'No accounts listed.')}
                </p>
            )}
            <ol className="ci-fact-list">
                {rows.map((row, i) => (
                    <li key={row._key}>
                        <details className="ci-fact" open={row._new || undefined}>
                            <summary>
                                <span className="ci-fact-no">{i + 1}</span>
                                <span className="ci-fact-sum">{sum(row)}</span>
                                <ChevronDown size={16} className="ci-chev" aria-hidden="true" />
                            </summary>
                            <div className="ci-fact-grid">
                                {list.filter((f) => shown(f, row)).map((f) => input(f, row))}
                            </div>
                            <div className="ci-fact-foot">
                                <button type="button" className="ci-mini quiet" disabled={disabled} onClick={() => remove(row)}>
                                    <Trash2 size={14} aria-hidden="true" />Remove {noun} {i + 1}
                                </button>
                            </div>
                        </details>
                    </li>
                ))}
            </ol>
            <button type="button" className="ci-mini" disabled={disabled} onClick={add}>
                <Plus size={14} aria-hidden="true" />Add {rows.length ? 'another ' : ''}{noun}
            </button>
        </div>
    );
};

// ---------- read-only ----------
export const FactRowsView = ({ checkType, rows }) => {
    if (!rows?.length) return null;
    return (
        <ol className="ci-fact-view">
            {rows.map((r) => (
                <li key={r.id}>
                    {rowSummary(checkType, r)}
                    {checkType === 'NFIS' && r.remarks && <span className="ci-fact-rem">{r.remarks}</span>}
                </li>
            ))}
        </ol>
    );
};
