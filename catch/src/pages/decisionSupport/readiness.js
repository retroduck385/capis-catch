// DSS-10: is everything a decision needs in place? One line per input, each with done / missing / check, what is
// missing and who owns it. It informs; it never blocks (blocking stays in the stage rules).
// Pure function over what fetchDecisionSupport() loaded plus what the page derived (score, mracChanges, ...).
import { buildSteps } from '../applicationForm/steps';
import { missingApprovers } from '../review/approval';

export const READY = { DONE: 'done', MISSING: 'missing', CHECK: 'check' };

// Latest KYC check per loan-folder section (the wizard's steps without Review & Submit)
const verifiedSections = (app, kycChecks) => {
    const sections = buildSteps(app).filter((s) => s.key !== 'review');
    const verified = sections.filter((s) => kycChecks.findLast((c) => c.section === s.key)?.result === 'VERIFIED');
    return { total: sections.length, verified: verified.length };
};

export const buildReadiness = (ctx) => {
    const { app, kycChecks, docs, docStates, ciDone, score, fp, pkg, mrac, mracChanges, reviewers, approvers, staff } = ctx;
    const items = [];
    const add = (item) => items.push(item);
    const id = app.id;

    // 1. Application sections checked by the Account Officer
    const kyc = verifiedSections(app, kycChecks);
    add({
        key: 'kyc', label: 'Application sections verified',
        state: kyc.total > 0 && kyc.verified === kyc.total ? READY.DONE : READY.MISSING,
        detail: `${kyc.verified} of ${kyc.total} sections verified by the Account Officer.`,
        owner: 'ACCOUNT_OFFICER', to: `/loanFolderPage?id=${id}`, action: 'Loan folder',
    });

    // 2. Documents the AI reads, each confirmed by a person
    const confirmed = docs.filter((d) => docStates[d.id]?.run?.confirmed_at).length;
    const failed = docs.filter((d) => ['FAILED'].includes(docStates[d.id]?.run?.status)
        || docStates[d.id]?.ocr?.status === 'FAILED').length;
    add({
        key: 'documents', label: 'Documents read and confirmed',
        state: docs.length > 0 && confirmed === docs.length ? READY.DONE : READY.MISSING,
        detail: docs.length === 0
            ? 'No ID, income or bank documents have been uploaded yet.'
            : `${confirmed} of ${docs.length} documents confirmed by the Account Officer${failed ? `; ${failed} could not be read` : ''}.`,
        owner: 'ACCOUNT_OFFICER', to: `/documentCheckPage?id=${id}`, action: 'Document check',
    });

    // 3. Credit investigation
    add({
        key: 'ci', label: 'Credit investigation finished',
        state: ciDone ? READY.DONE : READY.MISSING,
        detail: ciDone ? `Marked done on ${new Date(ciDone.changed_at).toLocaleDateString()}.` : 'The Credit Investigator has not marked it done.',
        owner: 'CREDIT_INVESTIGATOR',
    });

    // 4. Credit score
    add({
        key: 'score', label: 'Credit score complete',
        state: score.complete ? READY.DONE : READY.MISSING,
        detail: score.complete ? `Scored ${score.total} / 100${score.riskRating ? ` (${score.riskRating})` : ''}.`
            : `${score.scored} of ${score.count} criteria scored.`,
        owner: 'CREDIT_OFFICER', to: `/creditScorePage?id=${id}`, action: 'Credit scoring',
    });

    // 5. Financial Package saved with the CO's credit result
    const fpSaved = Boolean(fp.pkg);
    const fpResult = Boolean(pkg.credit_result);
    add({
        key: 'fp', label: 'Financial Package saved with a credit result',
        state: fpSaved && fpResult ? READY.DONE : READY.MISSING,
        detail: !fpSaved ? 'No Financial Package has been saved yet.'
            : !fpResult ? 'The Credit Officer has not set the credit result.' : 'Saved, with the Credit Officer\'s recommendation.',
        owner: 'CREDIT_OFFICER', to: `/financialPackagePage?id=${id}`, action: 'Financial Package',
    });

    // 6. Policy check run and still current
    const policyDone = mrac?.status === 'DONE';
    let policyState = READY.MISSING;
    let policyDetail = 'No policy check has been run.';
    if (mrac && ['PENDING', 'RUNNING'].includes(mrac.status)) policyDetail = 'A check is in progress.';
    else if (mrac?.status === 'FAILED') policyDetail = 'The last check failed. Run it again.';
    else if (policyDone && mracChanges.length > 0) {
        policyState = READY.CHECK;
        policyDetail = `Out of date: ${mracChanges.join(', ')} changed after the check.`;
    } else if (policyDone) {
        policyState = READY.DONE;
        policyDetail = `Run on ${new Date(mrac.finished_at).toLocaleDateString()} with the current figures.`;
    }
    add({
        key: 'policy', label: 'Policy check run and current', state: policyState, detail: policyDetail,
        owner: 'CREDIT_OFFICER', to: `/financialPackagePage?id=${id}`, action: 'Financial Package',
    });

    // 7. Reviewers and approvers routed
    const tier = pkg.approval_tier;
    const unmet = tier ? missingApprovers(staff, tier) : [];
    let routingDetail = `${reviewers.length} reviewer${reviewers.length === 1 ? '' : 's'} and ${approvers.length} approver${approvers.length === 1 ? '' : 's'} routed.`;
    if (!tier) routingDetail = 'The approval authority has not been chosen.';
    else if (reviewers.length === 0 || approvers.length === 0) routingDetail = 'Reviewers and approvers have not been routed yet.';
    else if (unmet.length > 0) routingDetail = `No account can meet: ${unmet.join('; ')}.`;
    add({
        key: 'routing', label: 'Reviewers and approvers routed',
        state: tier && reviewers.length > 0 && approvers.length > 0 && unmet.length === 0 ? READY.DONE : READY.MISSING,
        detail: routingDetail, owner: 'CREDIT_OFFICER', to: `/approvalRoutingPage?id=${id}`, action: 'Approval routing',
    });

    const readyCount = items.filter((i) => i.state === READY.DONE).length;
    return { items, readyCount, total: items.length, ready: readyCount === items.length };
};
