// AI suggestion for the credit result (20261120_credit_ai_suggestions.sql). The ocr-service worker answers it with the
// Claude API; the page only asks (assigned Credit Officer) and reads. Functions throw on error.
import { supabase } from '../../supabaseClient';
import { getParties } from '../applicationForm/api';
import { BORROWER_ROLES } from '../applicationForm/options';
import { fetchCiFindingFlagCount, fetchCiResults } from '../ciRequest/api';
import { fetchDecisionSupport } from '../decisionSupport/api';
import { computeFp } from '../financialPackage/compute';
import { totalCreditScore } from '../financialPackage/creditScore';
import { fetchStaffNames } from '../loanFolder/api';
import { buildMracFacts } from '../mrac/facts';
import { buildSuggestionInput, changedFacts } from './buildInput';

const check = ({ data, error }) => {
    if (error) throw error;
    return data;
};

// Every suggestion of the file, newest first, with the names of who asked
export const fetchSuggestions = async (applicationId) => {
    const rows = check(await supabase.from('credit_ai_suggestions')
        .select('id, application_id, mrac_run_id, input, requested_by, requested_at, status, model, sent, output, input_tokens, output_tokens, error, finished_at')
        .eq('application_id', applicationId).order('id', { ascending: false })) ?? [];
    const names = rows.length ? await fetchStaffNames(rows.map((r) => r.requested_by)) : {};
    return { rows, names };
};

// Builds the input from what is SAVED (the same loader as Decision Support) and asks. Throws a readable error when the
// policy check is missing, unfinished or out of date (the database checks the same).
export const askForSuggestion = async (applicationId) => {
    const data = await fetchDecisionSupport(applicationId);
    const { app, fp, rules, mrac } = data;
    if (!mrac) throw new Error('Run the policy check first (MRAC / policy RAG, above).');
    if (mrac.status !== 'DONE') throw new Error('Wait for the policy check to finish, then ask again.');
    const pkg = fp.pkg ?? {};
    const details = Object.fromEntries(fp.parties.map((d) => [d.applicant_id, d]));
    const computed = computeFp(app, details, pkg, { interest_rate: app.interest_rate });
    const score = totalCreditScore(rules, Object.fromEntries(fp.creditScore.map((x) => [x.criterion, x])));
    const facts = buildMracFacts({ app, computed, score, pricing: { interest_rate: app.interest_rate }, exceptions: fp.exceptions });
    const changed = changedFacts(mrac.facts, facts);
    if (changed.length) throw new Error(`The figures changed since the policy check (${changed.join(', ')}). Run the policy check again first.`);
    const ids = getParties(app, BORROWER_ROLES).map((p) => p.id);
    const [ci, flags] = await Promise.all([fetchCiResults(ids), fetchCiFindingFlagCount(app.id).catch(() => 0)]);
    const input = buildSuggestionInput({
        app, computed, score, rules, entries: fp.creditScore, ci,
        ciFlagged: flags > 0, exceptions: fp.exceptions, facts,
    });
    return check(await supabase.rpc('request_credit_suggestion', {
        p_application_id: app.id, p_mrac_run_id: mrac.id, p_input: input, p_facts: facts,
    }));
};
