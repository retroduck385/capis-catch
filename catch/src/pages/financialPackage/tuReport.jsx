// VIII. Employment / business verification: one borrower's TransUnion (TU) report, uploaded by the Credit Investigator,
// shown as a row (result chip, report date) with a "View TU report" button that opens the file in a popup over the
// Financial Package. The CO checks the employer against the bureau report without leaving the page, so unsaved edits
// stay put. Read-only: the CI fills the report in on the CI report page ("Open the CI report" in the popup's footer).
// ci: fetchCiResults() from the page (null when it couldn't be read). The popup is the shared InfoModal (tone = the CI
// result) around Document check's DocumentViewer (zoom, pages, Open file). Styles: .fp-tu* in financialPackage.css;
// the viewer's own in documentCheck.css.
import { useState } from 'react';
import { FileSearch, FileText } from 'lucide-react';
import InfoModal from '../../components/infoModal';
import { Term } from '../../components/term';
import { partyLabel } from '../applicationForm/options';
import { fullName, reportUrl } from '../ciRequest/ciResultsData';
import { CI_RESULTS, resultTone } from '../ciRequest/options';
import DocumentViewer from '../documentCheck/documentViewer';
import '../documentCheck/documentCheck.css';

const showDay = (v) => (v ? new Date(`${v}T00:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : null);

const TuReport = ({ app, party, ci }) => {
    const [openId, setOpenId] = useState(null);   // the ci_documents row shown in the popup; null = closed
    const [page, setPage] = useState(1);

    if (!ci) return <p className="fp-note fp-tu-none">The <Term k="TU" /> report could not be loaded.</p>;

    const docs = ci.documents.filter((d) => d.applicant_id === party.id && d.check_type === 'TU');
    const slot = ci.checks.find((c) => c.applicant_id === party.id && c.check_type === 'TU');
    const result = CI_RESULTS.find((r) => r.value === slot?.result);
    const tone = resultTone(slot?.result);
    const doc = docs.find((d) => d.id === openId);
    const show = (id) => { setOpenId(id); setPage(1); };

    let meta = 'Not uploaded by the Credit Investigator yet';
    if (docs.length) {
        meta = [slot?.report_date ? `Dated ${showDay(slot.report_date)}` : 'No report date yet',
            docs.length > 1 && `${docs.length} files`].filter(Boolean).join(' · ');
    }

    return (
        <div className={`fp-tu${docs.length ? '' : ' empty'}`}>
            <span className="fp-tu-ic" aria-hidden="true"><FileText size={17} /></span>
            <span className="fp-tu-txt">
                <b><Term k="TU">TransUnion (TU)</Term> report</b>
                <span>{meta}</span>
            </span>
            {result && <span className={`lf-chip ${tone}`}>{result.label}</span>}
            {docs.length > 0 && (
                <button type="button" className="lf-btn quiet fp-tu-btn" aria-haspopup="dialog" onClick={() => show(docs[0].id)}>
                    <FileSearch size={16} aria-hidden="true" />View TU report
                </button>
            )}

            {doc && (
                <InfoModal className="fp-tu-modal" Icon={FileText} tone={tone} eyebrow="TransUnion (TU) report"
                    title={`${partyLabel(party)}: ${fullName(party)}`}
                    note={[result?.label ?? 'No result yet', slot?.report_date && `Report dated ${showDay(slot.report_date)}`].filter(Boolean).join(' · ')}
                    link={{ to: reportUrl(app.id, doc), label: 'Open the CI report' }}
                    onClose={() => setOpenId(null)}>
                    {docs.length > 1 && (
                        <div className="fp-tu-files" role="group" aria-label="Files">
                            {docs.map((d, i) => (
                                <button key={d.id} type="button" aria-pressed={d.id === doc.id} onClick={() => show(d.id)}
                                    title={d.original_file_name ?? d.file_name}>
                                    File {i + 1}
                                </button>
                            ))}
                        </div>
                    )}
                    <div className="fp-tu-viewer">
                        <DocumentViewer key={doc.id} doc={doc} highlights={[]} page={page} onPageChange={setPage} />
                    </div>
                </InfoModal>
            )}
        </div>
    );
};

export default TuReport;
