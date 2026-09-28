// Upload checklist. Required items per borrower come from the DB (required_documents() by
// employment type), so "Self-Employed" or an OFW automatically get their extra requirements.
import { useState } from 'react';
import { deleteDocument, getDocumentUrl, uploadDocument } from '../api';
import { FormError, Section, StepButtons } from '../fields';
import { BORROWER_ROLES, minFilesFor, PARTY_LABELS, REQUIREMENT_LABELS } from '../options';

const DocumentsStep = ({ app, session, complete, onSaved, onRefresh, onBack }) => {
    const [busy, setBusy] = useState(null); // requirement id or doc id being worked on
    const [error, setError] = useState(null);

    const borrowers = BORROWER_ROLES
        .map((role) => app.applicants?.find((a) => a.role === role))
        .filter(Boolean);

    const handleUpload = async (party, requirement, files) => {
        setBusy(requirement.id);
        setError(null);
        try {
            for (const file of files) {
                await uploadDocument({
                    userId: session.user.id, applicationId: app.id, applicantId: party.id, requirement, file,
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
        <form onSubmit={handleSubmit}>
            <p className="text-left py-2">Accepted: JPG, PNG or PDF, up to 10 MB each. Use clear, readable scans.</p>
            {borrowers.map((party) => (
                <Section key={party.id} title={`${PARTY_LABELS[party.role]}: ${party.first_name ?? ''} ${party.last_name ?? ''}`}>
                    {(party.application_requirements ?? []).length === 0 && (
                        <p className="italic">No requirements yet. Complete this person's employment information first.</p>
                    )}
                    {(party.application_requirements ?? []).map((req) => {
                        const docs = req.documents ?? [];
                        const needed = minFilesFor(req.requirement_type);
                        return (
                            <div key={req.id} className="border-b py-2">
                                <p className="font-semibold">
                                    {REQUIREMENT_LABELS[req.requirement_type]}
                                    {' '}({docs.length}/{needed} {docs.length >= needed ? '✓' : 'required'})
                                </p>
                                <ul>
                                    {docs.map((doc) => (
                                        <li key={doc.id} className="flex gap-2 items-center">
                                            <span>{doc.file_name}</span>
                                            <button type="button" className="border px-2" onClick={() => handleView(doc)}>View</button>
                                            <button type="button" className="border px-2" disabled={busy === doc.id}
                                                onClick={() => handleDelete(doc)}>Remove</button>
                                        </li>
                                    ))}
                                </ul>
                                <input type="file" multiple accept="image/jpeg,image/png,application/pdf"
                                    disabled={busy === req.id}
                                    onChange={(e) => {
                                        const files = [...e.target.files];
                                        e.target.value = '';
                                        if (files.length) handleUpload(party, req, files);
                                    }} />
                                {busy === req.id && <span> Uploading...</span>}
                            </div>
                        );
                    })}
                </Section>
            ))}
            <FormError error={error} />
            <StepButtons onBack={onBack} saving={false} nextLabel="Continue" />
        </form>
    );
};

export default DocumentsStep;
