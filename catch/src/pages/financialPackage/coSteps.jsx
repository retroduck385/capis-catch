// The assigned Credit Officer's work as three numbered steps, shown in the header of each of the three pages it
// spans (components/stepStrip.jsx, each step a link): 1. Financial Package -> 2. Credit score -> 3. Approval routing.
// CoOptionalView: the loan folder and Decision support, which a CO can only read, kept apart under "Optional view".
// Steps are worked out from what is SAVED (the other pages read the saved FP / score), so unsaved edits don't count
// and guard() asks before leaving with them. Sending for review needs a saved Credit Result of Endorsed or
// Not endorsed (send_for_review()), not the credit score, so step 3 says so when it's missing.
import { ArrowRight, Scale } from 'lucide-react';
import { Link } from 'react-router-dom';
import OptionalView from '../../components/optionalView';
import StepStrip from '../../components/stepStrip';
import { CREDIT_RESULTS } from './options';

const SENDABLE = ['ENDORSED', 'NOT_ENDORSED'];

// appId; current: 'package' | 'score' | 'routing' (this page); pkg: the saved financial_packages row or null;
// score: totalCreditScore() of the saved score; sent: reviewers assigned; guard: () => boolean before leaving
const CoSteps = ({ appId, current, pkg, score, sent, guard }) => {
    const result = pkg?.credit_result ?? null;
    const resultLabel = CREDIT_RESULTS.find((r) => r.value === result)?.label;
    const sendable = SENDABLE.includes(result);

    let packageText = 'Not saved yet';
    if (pkg) packageText = resultLabel ? `Saved · Credit result: ${resultLabel}` : 'Saved · credit result not set';
    let routingText = 'Pick the reviewers, then send for review';
    if (sent) routingText = 'Sent for review';
    else if (!sendable) routingText = 'Needs a Credit Result of Endorsed or Not endorsed, saved in the FP';

    return (
        <StepStrip openStep={current} guard={guard} steps={[
            {
                key: 'package', title: 'Financial Package', text: packageText, done: Boolean(pkg),
                to: `/financialPackagePage?id=${appId}`,
            },
            {
                key: 'score', title: 'Credit score',
                text: score.complete ? `${score.riskRating ?? 'Scored'} · ${score.total} / 100` : `${score.scored} of ${score.count} criteria scored`,
                done: score.complete, meter: { value: score.scored, max: score.count },
                to: `/creditScorePage?id=${appId}`,
            },
            {
                key: 'routing', title: 'Approval routing', text: routingText, done: sent,
                to: `/approvalRoutingPage?id=${appId}`,
            },
        ]} />
    );
};

export const CoOptionalView = ({ appId, guard }) => {
    const onLeave = (e) => { if (guard && !guard()) e.preventDefault(); };
    return (
        <OptionalView who="Credit Officers">
            <Link to={`/decisionSupportPage?id=${appId}`} onClick={onLeave} className="lf-btn quiet">
                <Scale size={16} aria-hidden="true" />Decision support
            </Link>
            <Link to={`/loanFolderPage?id=${appId}`} onClick={onLeave} className="lf-btn quiet">
                Loan folder<ArrowRight size={16} aria-hidden="true" />
            </Link>
        </OptionalView>
    );
};

export default CoSteps;
