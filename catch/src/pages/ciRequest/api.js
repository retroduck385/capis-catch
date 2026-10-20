// Supabase calls for CI requests (see 20261020_ci_request.sql). Functions throw on error;
// callers handle it in try/catch/finally.
import { supabase } from '../../supabaseClient';

const check = ({ data, error }) => {
    if (error) throw error;
    return data;
};

// Assigned AO, while in Intake: Intake -> Credit Investigation (Requested). Returns the request id.
export const requestCi = async (applicationId, nfisRemarks, tuRemarks) =>
    check(await supabase.rpc('request_ci', {
        p_application_id: applicationId, p_nfis_remarks: nfisRemarks, p_tu_remarks: tuRemarks,
    }));

// Requests for one application, oldest first; the last one is current
export const fetchCiRequests = async (applicationId) =>
    check(await supabase.from('ci_requests').select('*')
        .eq('application_id', applicationId).order('requested_at').order('id')) ?? [];
