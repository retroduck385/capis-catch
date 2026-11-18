// Upload checklist. Required items per borrower come from the DB (required_documents() by
// employment type), so "Self-Employed" or an OFW automatically get their extra requirements.
// Each requirement is a card: a status chip (amber until it has enough files, green after), the files as rows with
// View / Remove, and a labelled upload. Shown in the applicant's wizard and the staff loan folder (styles in
// applicantPages.css, written against the shared --lf-* tokens so they work in both).
import { useState } from 'react';
import { CheckCircle2, Eye, FileText, Paperclip, Trash2 } from 'lucide-react';
import { deleteDocument, getDocumentUrl, getParties, uploadDocument } from '../api';
import { FormError, Section, StepButtons } from '../fields';
import { BORROWER_ROLES, minFilesFor, partyLabel, REQUIREMENT_LABELS } from '../options';
import '../applicantPages.css';

// Shown under the Valid ID / Passport upload: the ID kinds the document reading recognizes (DOCUMENT_KINDS
// in ocr-service/extract.py, without "Other ID"). TO CONFIRM with the bank's accepted ID list.
const ACCEPTED_IDS = [
    'Passport', "Driver's License", 'UMID', 'PhilSys ID (National ID)', 'PRC ID', 'Postal ID', "Voter's ID", 'SSS ID', 'TIN ID',
];

const DocumentsStep = ({ app, complete, onSaved, onRefresh, onBack }) => {
    const [busy, setBusy] = useState(null); // requirement id or doc id being worked on
    const [error, setError] = useState(null);

    const borrowers = getParties(app, BORROWER_ROLES);

    const handleUpload = async (party, requirement, files) => {
        setBusy(requirement.id);
        setError(null);
        try {
            for (const file of files) {
                await uploadDocument({
                    // Always the applicant's folder, so files the AO uploads stay visible to the applicant
                    userId: app.user_id, applicationId: app.id, applicantId: party.id, requirement, file,
                });
            }
            await onRefresh();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(null);
        }
    };

    const handleDelete = async (doc) => {
        setBusy(doc.id);
        setError(null);
        try {
            await deleteDocument(doc);
            await onRefresh();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(null);
        }
    };

    const handleView = async (doc) => {
        try {
            window.open(await getDocumentUrl(doc), '_blank', 'noopener');
        } catch (err) {
            setError(err.message);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!complete) {
            setError('Upload every required document before continuing.');
            return;
        }
        await onSaved();
    };

    return (
        <form onSubmit={handleSubmit} noValidate>
            <p className="ct-intro">Accepted: JPG, PNG or PDF, up to 10 MB each. Use clear, readable scans.
                Files are renamed automatically when uploaded.</p>
            {borrowers.map((party) => (
                <Section key={party.id} title={`${partyLabel(party)}: ${party.first_name ?? ''} ${party.last_name ?? ''}`}>
                    {(party.application_requirements ?? []).length === 0 && (
                        <p className="ct-none">No requirements yet. Complete this person&apos;s employment information first.</p>
                    )}
                    {(party.application_requirements ?? []).length > 0 && (
                        <ul className="ap-docs">
                            {party.application_requirements.map((req) => {
                                const docs = req.documents ?? [];
                                const needed = minFilesFor(req.requirement_type);
                                const done = docs.length >= needed;
                                const label = REQUIREMENT_LABELS[req.requirement_type];
                                return (
                                    <li key={req.id} className={`ap-doc ${done ? 'ok' : 'warn'}`}>
                                        <div className="ap-doc-head">
                                            <span className="ap-doc-icon" aria-hidden="true">
                                                {done ? <CheckCircle2 size={18} /> : <Paperclip size={18} />}
                                            </span>
                                            <div className="ap-doc-title">
                                                <strong>{label}</strong>
                                                {req.requirement_type === 'VALID_ID_PASSPORT' && (
                                                    <p className="ap-doc-hint">Accepted IDs: {ACCEPTED_IDS.join(', ')}.</p>
                                                )}
                                            </div>
                                            <span className={`ap-chip ${done ? 'ok' : 'warn'}`}>
                                                {done ? `${docs.length} of ${needed} uploaded` : `${docs.length} of ${needed} required`}
                                            </span>
                                        </div>
                                        {docs.length > 0 && (
                                            <ul className="ap-files">
                                                {docs.map((doc) => (
                                                    <li key={doc.id}>
                                                        <FileText size={16} aria-hidden="true" />
                                                        <span className="ap-file-name" title={doc.original_file_name ?? undefined}>{doc.file_name}</span>
                                                        <button type="button" className="ap-filebtn" onClick={() => handleView(doc)}>
                                                            <Eye size={15} aria-hidden="true" />View
                                                        </button>
                                                        <button type="button" className="ap-filebtn quiet" disabled={busy === doc.id}
                                                            onClick={() => handleDelete(doc)}>
                                                            <Trash2 size={15} aria-hidden="true" />{busy === doc.id ? 'Removing...' : 'Remove'}
                                                        </button>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                        <label className="ap-upload">
                                            <span className="sr-only">Upload {label}</span>
                                            <input type="file" multiple accept="image/jpeg,image/png,application/pdf"
                                                disabled={busy === req.id}
                                                onChange={(e) => {
                                                    const files = [...e.target.files];
                                                    e.target.value = '';
                                                    if (files.length) handleUpload(party, req, files);
                                                }} />
                                            {busy === req.id && <span className="ap-uploading" role="status">Uploading...</span>}
                                        </label>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </Section>
            ))}
            <FormError error={error} />
            <StepButtons onBack={onBack} saving={false} nextLabel="Continue" />
        </form>
    );
};

export default DocumentsStep;
