// Supabase calls for the AO's "Send notice to applicant" panel (see 20261029_applicant_notices.sql).
// Functions throw on error; callers handle it in try/catch/finally.
import { supabase } from '../../supabaseClient';

const check = ({ data, error }) => {
    if (error) throw error;
    return data;
};

// Outcome, whether I can send, reason suggestions, masked destinations, earlier notices and their delivery status
export const fetchNoticeContext = async (applicationId) =>
    check(await supabase.rpc('applicant_notice_context', { p_application_id: applicationId }));

// The exact in-app / SMS / email texts for this reason, plus the problem with it (null = fine)
export const previewNotice = async (applicationId, reason, correction) =>
    check(await supabase.rpc('preview_applicant_notice',
        { p_application_id: applicationId, p_reason: reason, p_correction: correction }));

export const sendNotice = async (applicationId, reason, correction) =>
    check(await supabase.rpc('send_applicant_notice',
        { p_application_id: applicationId, p_reason: reason, p_correction: correction }));
