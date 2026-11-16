// "Ask the applicant": a button shown wherever a missing or unclear item appears (a KYC section marked Needs
// clarification, a file on the Document check, the Decision support readiness list, a file marked Needs a new copy).
// It opens the "Ask the applicant for documents" box in the loan folder with the documents already ticked and the
// note prefilled. Nothing is sent: the assigned Account Officer still reviews the box and clicks Send request.
// The button renders nothing unless the signed-in user is the assigned AO and may open a request right now
// (document_request_can_open() in 20261116_findings_and_file_marks.sql).
import { useNavigate } from 'react-router-dom';
import { MailQuestion } from 'lucide-react';
import { useCanAsk } from './askStore';

// ask: { items?: [{ applicant_id, requirement_type | null, label }], missingFor?: applicant id, note?, from? }
//   items       tick exactly these documents (one not on the checklist is added as an "Other" document)
//   missingFor  no items: tick that borrower's still-missing checklist documents (omitted = everyone's)
//   note        prefilled into "What we need" (cut to the limit); from: where it came from, shown above the box
// confirmLeave: optional, returns false to stay (a page with unsaved edits asks before it is left)
// plain: drop the built-in Tailwind look and use only className (the loan folder styles it as .lf-ask-btn)
const AskApplicantButton = ({ applicationId, ask, confirmLeave, children = 'Ask the applicant', className = '', plain = false }) => {
    const navigate = useNavigate();
    const can = useCanAsk(applicationId);
    if (!can) return null;
    return (
        <button type='button'
            onClick={() => {
                if (confirmLeave && !confirmLeave()) return;
                navigate(`/loanFolderPage?id=${applicationId}`, { state: { ask: { ...ask, at: Date.now() } } });
            }}
            className={plain ? className : `inline-flex min-h-0! items-center gap-1.5 rounded border border-blue-800! bg-white! px-2.5! py-1! text-sm font-semibold text-blue-900! hover:bg-blue-50! focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${className}`}>
            <MailQuestion size={15} aria-hidden='true' />{children}
        </button>
    );
};

export default AskApplicantButton;
