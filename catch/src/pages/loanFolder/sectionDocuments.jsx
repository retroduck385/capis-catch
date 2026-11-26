// "Documents" button in a loan folder KYC section's header (editing AO): a popup with the files of the person the
// section is about, so the AO checks the form against them without leaving the folder. Co-borrower 2's section
// shows Co-borrower 2's files; Address / Principal Borrower open on the principal's ID, Employment on their COE /
// payslips / bank statements, each with "Other files" of the same person one click away (kycTargets.js).
// Left: the Document check's DocumentViewer (zoom, pages). Right: what the AI read from that file, read-only, with
// "Matches / Differs from application" like the Document check. Values the AO has not confirmed yet say so: they
// are only the AI's proposal (Human-in-the-Loop). Clicking a value marks where it was read on the page.
// Checks (ocr / AI runs + fields) load when the popup first opens. Styles: .sd-* in loanFolder.css.
import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Eye, FileText, ScanText } from 'lucide-react';
import InfoModal from '../../components/infoModal';
import DocumentViewer from '../documentCheck/documentViewer';
import { fetchDocumentChecks, fetchFieldDefs } from '../documentCheck/api';
import { applicationValue, compareStatus, displayValue } from '../documentCheck/compare';
import { getParties, one } from '../applicationForm/api';
import { joinAddress, presentAddressOf } from '../applicationForm/derived';
import { REQUIREMENT_LABELS, partyLabel } from '../applicationForm/options';
import { sectionParties, splitSectionDocs } from './kycTargets';
import '../documentCheck/documentCheck.css';

const STATUS = {
    MATCH: ['Matches application', 'ok'],
    DIFFERS: ['Differs from application', 'warn'],
    NOT_IN_APPLICATION: ['Not in application', 'none'],
    NOT_ON_DOCUMENT: ['Not on document', 'none'],
};
const ROW_GROUP_LABELS = { rows: 'Rows', ids: 'IDs', addresses: 'Addresses', employers: 'Employment', accounts: 'Accounts' };
const docLabel = (d) => REQUIREMENT_LABELS[d.document_type] ?? (d.document_type === 'OTHER' ? 'Other document' : d.document_type);
const nameOf = (p) => [p.first_name, p.last_name].filter(Boolean).join(' ') || partyLabel(p);

// What the AI read from one file: header values (with the application comparison) and row tables, read-only
const Values = ({ check, defs, ctx, focusedId, onFocus }) => {
    if (!check) return <p className="lf-empty">Loading what the AI read…</p>;
    const { run, fields } = check;
    if (!run || run.status !== 'DONE') {
        const failed = run?.status === 'FAILED' || check.ocr?.status === 'FAILED';
        return <p className="lf-empty">{failed ? "The AI couldn't read this file. Check it on the Document check." : 'The AI is still reading this file.'}</p>;
    }
    const confirmed = Boolean(run.confirmed_at);
    const shown = (f) => (confirmed ? f.final_value : f.extracted_value);
    const header = defs.filter((d) => d.scope === 'HEADER')
        .map((def) => ({ def, field: fields.find((f) => f.field_key === def.field_key && f.item_no === 0) }))
        .filter((h) => h.field);
    const groups = [...new Set(defs.filter((d) => d.scope === 'ROW').map((d) => d.row_group ?? 'rows'))].map((g) => {
        const gDefs = defs.filter((d) => d.scope === 'ROW' && (d.row_group ?? 'rows') === g);
        const keys = new Set(gDefs.map((d) => d.field_key));
        const nos = [...new Set(fields.filter((f) => f.item_no > 0 && keys.has(f.field_key)).map((f) => f.item_no))].sort((a, b) => a - b);
        const cell = (k, n) => fields.find((f) => f.field_key === k && f.item_no === n);
        return { g, nos, cell, cols: gDefs.filter((d) => nos.some((n) => shown(cell(d.field_key, n) ?? {}))) };
    }).filter((x) => x.nos.length > 0);

    return (
        <>
            <p className={`sd-state ${confirmed ? 'ok' : 'warn'}`}>
                {confirmed ? <CheckCircle2 size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
                {confirmed ? 'Confirmed on the Document check' : "The AI's reading, not confirmed yet. Check it against the file."}
            </p>
            <ul className="sd-values">
                {header.map(({ def, field }) => {
                    const value = shown(field);
                    const appValue = applicationValue(def, ctx);
                    const status = compareStatus(def, value, appValue, ctx);
                    return (
                        <li key={field.id}>
                            <button type="button" className={focusedId === field.id ? 'on' : undefined}
                                aria-pressed={focusedId === field.id} onClick={() => onFocus(field)}>
                                <span className="k">{def.label}</span>
                                <span className="v">{displayValue(value, def.data_type)}</span>
                                {status && <span className={`lf-chip dc-chip ${STATUS[status][1]}`}>{STATUS[status][0]}</span>}
                                {status === 'DIFFERS' && <span className="app">Application: {displayValue(appValue, def.data_type)}</span>}
                            </button>
                        </li>
                    );
                })}
            </ul>
            {groups.map(({ g, nos, cell, cols }) => (
                <div key={g} className="dc-tablewrap sd-table">
                    <table>
                        <caption className="sr-only">{ROW_GROUP_LABELS[g] ?? g}</caption>
                        <thead><tr><th>#</th>{cols.map((d) => <th key={d.field_key}>{d.label}</th>)}</tr></thead>
                        <tbody>
                            {nos.map((n) => (
                                <tr key={n}>
                                    <td className="num">{n}</td>
                                    {cols.map((d) => {
                                        const f = cell(d.field_key, n);
                                        return <td key={d.field_key}>{f ? displayValue(shown(f), d.data_type) : '—'}</td>;
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ))}
        </>
    );
};

const SectionDocuments = ({ app, sectionKey, sectionTitle }) => {
    const people = useMemo(() => sectionParties(getParties(app), sectionKey), [app, sectionKey]);
    // per person: files "for this section" first, then their other files
    const lists = useMemo(() => people.map((party) => {
        const docs = (party.application_requirements ?? []).flatMap((r) => r.documents ?? []);
        return { party, ...splitSectionDocs(sectionKey, docs) };
    }), [people, sectionKey]);
    const all = useMemo(() => lists.flatMap((l) => [...l.main, ...l.other]), [lists]);

    const [open, setOpen] = useState(false);
    const [docId, setDocId] = useState(null);
    const [showOther, setShowOther] = useState(false);
    const [defs, setDefs] = useState(null);
    const [checks, setChecks] = useState({});
    const [error, setError] = useState(null);
    const [page, setPage] = useState(1);
    const [focused, setFocused] = useState(null);

    const readTypes = useMemo(() => new Set((defs ?? []).map((d) => d.document_type)), [defs]);
    useEffect(() => {
        if (!open || defs) return undefined;
        let cancelled = false;
        (async () => {
            try {
                const fieldDefs = await fetchFieldDefs();
                const types = new Set(fieldDefs.map((d) => d.document_type));
                const next = await fetchDocumentChecks(all.filter((d) => types.has(d.document_type)).map((d) => d.id));
                if (cancelled) return;
                setDefs(fieldDefs);
                setChecks(next);
            } catch (err) {
                if (!cancelled) setError(err.message);
            }
        })();
        return () => { cancelled = true; };
    }, [open, defs, all]);

    if (people.length === 0) return null;
    const mainCount = lists.reduce((n, l) => n + l.main.length, 0);
    const otherCount = lists.reduce((n, l) => n + l.other.length, 0);
    const shownLists = lists.map((l) => ({ party: l.party, docs: showOther ? l.other : l.main })).filter((l) => l.docs.length > 0);
    const shownDocs = shownLists.flatMap((l) => l.docs);
    const doc = shownDocs.find((d) => d.id === docId) ?? shownDocs[0] ?? null;
    const owner = doc ? people.find((p) => (p.application_requirements ?? []).some((r) => (r.documents ?? []).some((d) => d.id === doc.id))) : null;
    const principal = getParties(app, ['PRINCIPAL'])[0] ?? null;
    const ctx = owner ? {
        party: owner, employment: one(owner.employment_info),
        presentAddress: joinAddress(presentAddressOf(owner, principal)), loanAmount: app.loan_amount ?? null,
    } : null;
    const check = doc ? checks[doc.id] : null;
    const docDefs = doc ? (defs ?? []).filter((d) => d.document_type === doc.document_type) : [];
    const highlights = (focused?.lines ?? []).map((l) => ({ id: l.id, page_no: l.page_no, bbox: l.bbox, text: l.text }));

    const pick = (id) => { setDocId(id); setPage(1); setFocused(null); };
    const switchList = (other) => { setShowOther(other); setDocId(null); setPage(1); setFocused(null); };
    const focus = (field) => {
        setFocused((cur) => (cur?.id === field.id ? null : field));
        if (field.lines?.[0]) setPage(field.lines[0].page_no);
    };
    const title = people.length === 1 ? `${nameOf(people[0])} · ${partyLabel(people[0])}` : sectionTitle;

    return (
        <>
            <button type="button" className="lf-btn sd-open" aria-haspopup="dialog" disabled={all.length === 0}
                title={all.length === 0 ? 'No files uploaded for this section yet' : undefined}
                onClick={() => { setOpen(true); setShowOther(mainCount === 0); setDocId(null); setPage(1); setFocused(null); }}>
                <FileText size={16} aria-hidden="true" />Documents
                {all.length > 0 && <span className="lf-btn-n" aria-hidden="true">{all.length}</span>}
                <span className="sr-only"> for {sectionTitle} ({all.length} {all.length === 1 ? 'file' : 'files'})</span>
            </button>
            {open && (
                <InfoModal className="sd-modal" Icon={FileText} eyebrow={`Documents for ${sectionTitle}`} title={title}
                    note={doc ? doc.file_name : null} onClose={() => setOpen(false)}
                    link={doc ? { to: `/documentCheckPage?id=${app.id}&doc=${doc.id}`, label: 'Open in Document check', Icon: ScanText } : null}>
                    {(mainCount > 0 && otherCount > 0) && (
                        <div className="sd-lists" role="group" aria-label="Which files to show">
                            <button type="button" aria-pressed={!showOther} onClick={() => switchList(false)}>For this section ({mainCount})</button>
                            <button type="button" aria-pressed={showOther} onClick={() => switchList(true)}>
                                Other files{people.length === 1 ? ` of ${nameOf(people[0])}` : ''} ({otherCount})
                            </button>
                        </div>
                    )}
                    <div className="sd-files" role="group" aria-label="Files">
                        {shownLists.map(({ party, docs }) => docs.map((d) => (
                            <button key={d.id} type="button" aria-pressed={d.id === doc?.id} onClick={() => pick(d.id)} title={d.file_name}>
                                <FileText size={14} aria-hidden="true" />
                                {docLabel(d)}{people.length > 1 ? ` · ${partyLabel(party)}` : ''}
                            </button>
                        )))}
                    </div>
                    {error && <p className="lf-err" role="alert">{error}</p>}
                    {doc ? (
                        <div className="sd-work">
                            <div className="sd-viewer">
                                <DocumentViewer key={doc.id} doc={doc} pageSizes={check?.pages} highlights={highlights}
                                    page={page} onPageChange={setPage} />
                            </div>
                            <section className="sd-side" aria-label="What the AI read">
                                <h3>What the AI read</h3>
                                {defs && !readTypes.has(doc.document_type)
                                    ? <p className="lf-empty">The AI doesn&apos;t read this kind of file. Check it by eye.</p>
                                    : <Values check={defs ? check : null} defs={docDefs} ctx={ctx} focusedId={focused?.id} onFocus={focus} />}
                            </section>
                        </div>
                    ) : <p className="lf-empty">No files here.</p>}
                </InfoModal>
            )}
        </>
    );
};

export default SectionDocuments;
