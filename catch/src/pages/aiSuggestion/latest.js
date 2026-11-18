// The latest finished AI suggestion of a file, with who asked (Decision Support and the final report read it).
// Its own file so the Decision Support loader can use it without importing the panel's api.js (which uses that loader).
import { supabase } from '../../supabaseClient';
import { fetchStaffNames } from '../loanFolder/api';

export const fetchLatestSuggestion = async (applicationId) => {
    const { data: row, error } = await supabase.from('credit_ai_suggestions')
        .select('id, requested_by, requested_at, model, input, sent, output, input_tokens, output_tokens, finished_at')
        .eq('application_id', applicationId).eq('status', 'DONE').order('id', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    if (!row) return null;
    const names = await fetchStaffNames([row.requested_by]);
    return { ...row, requestedByName: names[row.requested_by] ?? null };
};
