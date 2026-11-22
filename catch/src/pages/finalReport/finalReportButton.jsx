// "Final report" link for a page header (the Financial Package; the review summary for Approvers). Shows whichever
// version reportMode() in signoffs.js gives this viewer, and nothing when it gives none:
//   DRAFT  "Preview final report (Draft)": the assigned Credit Officer while they can edit in Credit Evaluation
//          (coCanEdit from the page; also after a reviewer return)
//   FINAL  "Final report": the Account Officer and the assigned Credit Officer once every reviewer has endorsed it
//          (Approval and Decided), the Approvers once Decided
// Reviewers get theirs as a strip on the review summary (ReportStrip in review/reviewParts.jsx).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { UserAuth } from '../../context/authContext';
import { REPORT_PAGE_ROLES } from '../../roles';
import { fetchAssignee } from '../financialPackage/api';
import { fetchCurrentStage } from '../review/api';
import { reportMode } from './signoffs';

const FinalReportButton = ({ applicationId, coCanEdit = false, onClick }) => {
    const { role, session } = UserAuth();
    const myId = session?.user?.id;
    const [stage, setStage] = useState(null);
    const [assigned, setAssigned] = useState(false);
    const allowed = REPORT_PAGE_ROLES.includes(role);

    useEffect(() => {
        if (!allowed || !applicationId) return undefined;
        let cancelled = false;
        Promise.all([
            fetchCurrentStage(applicationId),
            role === 'CREDIT_OFFICER' ? fetchAssignee(applicationId, 'CREDIT_OFFICER').catch(() => null) : null,
        ]).then(([s, coId]) => {
            if (cancelled) return;
            setStage(s);
            setAssigned(Boolean(myId) && coId === myId);
        }).catch(() => {});
        return () => { cancelled = true; };
    }, [allowed, applicationId, role, myId]);

    const mode = allowed ? reportMode({ stage, role, coCanEdit, assigned }) : null;
    if (!mode) return null;
    return (
        <Link to={`/finalReportPage?id=${applicationId}`} className="lf-btn" onClick={onClick}>
            <FileText size={16} aria-hidden="true" />{mode === 'DRAFT' ? 'Preview final report (Draft)' : 'Final report'}
        </Link>
    );
};

export default FinalReportButton;
