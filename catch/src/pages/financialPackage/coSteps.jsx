// The assigned Credit Officer's work as four numbered steps, shown in the header of each of the three pages it
// spans (components/stepStrip.jsx, each step a link): 1. Financial Package -> 2. Credit score -> 3. Credit result ->
// 4. Approval routing. The credit result is set on the Financial Package's unlisted page 3 (?page=3); on that page
// step 3 switches to it in place (onOpenResult) instead of reloading the page.
// CoOptionalView: the loan folder and Decision support, which a CO can only read, kept apart under "Optional view".
// Steps are worked out from what is SAVED (the other pages read the saved FP / score), so unsaved edits don't count
// and guard() asks before leaving with them. Sending for review needs a saved Credit Result of Endorsed or
// Not endorsed (send_for_review()), not the credit score, so steps 3 and 4 say so when it's missing.
import { ArrowRight, Scale, ScanText } from 'lucide-react';
import { Link } from 'react-router-dom';
import OptionalView from '../../components/optionalView';
import StepStrip from '../../components/stepStrip';
import { CREDIT_RESULTS } from './options';

const SENDABLE = ['ENDORSED', 'NOT_ENDORSED'];

// appId; current: 'package' | 'score' | 'result' | 'routing' (this page); pkg: the saved financial_packages row or null;
// score: totalCreditScore() of the saved score; sent: reviewers assigned; guard: () => boolean before leaving;
// onOpenResult: on the Financial Package page, show its credit result in place
const CoSteps = ({ appId, current, pkg, score, sent, guard, onOpenResult }) => {
    const result = pkg?.credit_result ?? null;
    const resultLabel = CREDIT_RESULTS.find((r) => r.value === result)?.label;
    const sendable = SENDABLE.includes(result);

    let resultText = 'Endorsed or Not endorsed, saved in the FP';
    if (sendable) resultText = `Saved · ${resultLabel}`;
    else if (resultLabel) resultText = `${resultLabel} · needs Endorsed or Not endorsed to send`;
    let routingText = 'Pick the reviewers, then send for review';
    if (sent) routingText = 'Sent for review';
    else if (!sendable) routingText = 'Needs a saved Credit result first';

    return (
        <StepStrip openStep={current} guard={guard} steps={[
            {
                key: 'package', title: 'Financial Package', text: pkg ? 'Saved' : 'Not saved yet', done: Boolean(pkg),
                to: `/financialPackagePage?id=${appId}`,
            },
            {
                key: 'score', title: 'Credit score',
                text: score.complete ? `${score.riskRating ?? 'Scored'} · ${score.total} / 100` : `${score.scored} of ${score.count} criteria scored`,
                done: score.complete, meter: { value: score.scored, max: score.count },
                to: `/creditScorePage?id=${appId}`,
            },
            {
                key: 'result', title: 'Credit result', text: resultText, done: sendable,
                ...(onOpenResult ? { onClick: onOpenResult } : { to: `/financialPackagePage?id=${appId}&page=3` }),
            },
            {
                key: 'routing', title: 'Approval routing', text: routingText, done: sent,
                to: `/approvalRoutingPage?id=${appId}`,
            },
        ]} />
    );
};

// documentCheck: also link the document check (the Financial Package page only)
export const CoOptionalView = ({ appId, guard, documentCheck = false }) => {
    const onLeave = (e) => { if (guard && !guard()) e.preventDefault(); };
    return (
        <OptionalView who="Credit Officers">
            <Link to={`/decisionSupportPage?id=${appId}`} onClick={onLeave} className="lf-btn quiet">
                <Scale size={16} aria-hidden="true" />Decision support
            </Link>
            {documentCheck && (
                <Link to={`/documentCheckPage?id=${appId}`} onClick={onLeave} className="lf-btn quiet">
                    <ScanText size={16} aria-hidden="true" />Document check
                </Link>
            )}
            <Link to={`/loanFolderPage?id=${appId}`} onClick={onLeave} className="lf-btn quiet">
                Loan folder<ArrowRight size={16} aria-hidden="true" />
            </Link>
        </OptionalView>
    );
};

export default CoSteps;
