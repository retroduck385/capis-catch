// What the Decision Support sections read (`ctx`): the data fetchDecisionSupport() loaded plus what is derived from it
// (FP figures, credit score, routing, whether the last policy check is out of date, the readiness checklist).
// Shared by the Decision Support page and the decision-support brief on the review summary, so both show the same.
import { formatDay } from '../../components/people';
import { computeFp } from '../financialPackage/compute';
import { totalCreditScore } from '../financialPackage/creditScore';
import { CREDIT_RESULTS } from '../financialPackage/options';
import { buildMracFacts } from '../mrac/facts';
import { OVERALL } from '../mrac/labels';
import { splitRouting } from '../review/approval';
import { reviewState } from '../review/reviewChecks';
import { buildReadiness } from './readiness';

const humanize = (key) => key.replaceAll('_', ' ');

// Which facts differ between the ones the check ran on and the figures now (numbers compared with a small tolerance)
const changedFacts = (runFacts, nowFacts) => {
    if (!runFacts) return [];
    return Object.keys(nowFacts).filter((key) => {
        if (key === 'schema' || !(key in runFacts)) return false;
        const a = runFacts[key];
        const b = nowFacts[key];
        if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) > 1e-6 * Math.max(1, Math.abs(b));
        return (a ?? null) !== (b ?? null);
    }).map(humanize);
};

export const buildDssContext = (data, myId) => {
    const { app, fp, rules, mrac, rows, reviews } = data;
    const pkg = fp.pkg ?? {};
    const details = Object.fromEntries(fp.parties.map((r) => [r.applicant_id, r]));
    const computed = computeFp(app, details, pkg, { interest_rate: app.interest_rate });
    const score = totalCreditScore(rules, Object.fromEntries(fp.creditScore.map((r) => [r.criterion, r])));
    const exceptions = fp.exceptions.filter((e) => e.policy || e.exception_recommendation || e.mitigant);
    const { reviewers, approvers } = splitRouting(rows);
    const resultLabel = CREDIT_RESULTS.find((r) => r.value === pkg.credit_result)?.label;

    // Same facts the Financial Package would send now, to tell whether the last check is out of date
    const nowFacts = buildMracFacts({ app, computed, score, pricing: { interest_rate: app.interest_rate }, exceptions: fp.exceptions });
    const mracChanges = mrac?.status === 'DONE' ? changedFacts(mrac.facts, nowFacts) : [];

    const base = {
        ...data, pkg, computed, score, exceptions, reviewers, approvers, resultLabel, mracChanges,
        reviewState: reviewState(rows, reviews), myId,
    };
    return { ...base, readiness: buildReadiness(base) };
};

// The latest policy check in a word, for a tile or the brief: [label, tone ('ok' | 'warn' | 'bad' | 'plain'), sub line]
export const policyStatus = (mrac, mracChanges) => {
    if (!mrac) return ['Not run', 'warn', 'The Credit Officer has not run one'];
    if (mrac.status === 'FAILED') return ['Check failed', 'warn', 'Ask the Credit Officer to run it again'];
    if (mrac.status !== 'DONE') return ['In progress', 'warn', 'Reload in a moment'];
    const [label, tone] = OVERALL[mrac.result?.overall] ?? [mrac.result?.overall ?? 'Done', 'plain'];
    if (mracChanges.length > 0) return [label, 'warn', `Out of date: ${mracChanges.join(', ')} changed`];
    return [label, tone, `Run on ${formatDay(mrac.finished_at)}`];
};
