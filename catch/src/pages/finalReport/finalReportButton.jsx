// "Final report" link for a page header (the review summary, for Approvers): shown once the file is Decided, to the
// roles that can open the final report (FINAL_REPORT_ROLES: the Account Officer and the Approvers; the AO's is on the
// work tray row).
// draft: the Financial Package's version for the assigned Credit Officer, "Preview final report (Draft)", shown while
// they can edit in Credit Evaluation (coCanEdit from the page; also after a reviewer return).
// Renders nothing otherwise. Same rule as reportMode() in signoffs.js.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { UserAuth } from '../../context/authContext';
import { REPORT_PAGE_ROLES } from '../../roles';
import { fetchCurrentStage } from '../review/api';
import { reportMode } from './signoffs';

const FinalReportButton = ({ applicationId, draft = false, coCanEdit = false, onClick }) => {
    const { role } = UserAuth();
    const [stage, setStage] = useState(null);
    const allowed = REPORT_PAGE_ROLES.includes(role);

    useEffect(() => {
        if (!allowed || !applicationId) return undefined;
        let cancelled = false;
        fetchCurrentStage(applicationId).then((s) => { if (!cancelled) setStage(s); }).catch(() => {});
        return () => { cancelled = true; };
    }, [allowed, applicationId]);

    const mode = allowed ? reportMode({ stage, role, coCanEdit }) : null;
    if (!mode || (mode === 'DRAFT') !== draft) return null;
    return (
        <Link to={`/finalReportPage?id=${applicationId}`} className="lf-btn" onClick={onClick}>
            <FileText size={16} aria-hidden="true" />{draft ? 'Preview final report (Draft)' : 'Final report'}
        </Link>
    );
};

export default FinalReportButton;
