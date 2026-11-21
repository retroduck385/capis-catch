// Supabase calls for the values typed by hand (20261123_manual_document_values.sql). Functions throw on error.
import { supabase } from '../../supabaseClient';
import { fetchStaffNames } from '../loanFolder/api';
import { MANUAL_TYPES } from './manualValues';

const check = ({ data, error }) => {
    if (error) throw error;
    return data;
};

// The SPA / SEC / Other files of an application (current and replaced), the saves for them and the savers' names
export const fetchManualData = async (applicationId) => {
    const [files, saves, canSave] = await Promise.all([
        supabase.from('documents')
            .select('id, applicant_id, document_type, file_name, file_path, original_file_name, uploaded_at, superseded_at')
            .eq('application_id', applicationId).in('document_type', MANUAL_TYPES)
            .order('uploaded_at').order('id').then(check),
        supabase.from('document_manual_values').select('id, document_id, entries, saved_by, saved_at')
            .eq('application_id', applicationId).order('id', { ascending: false }).then(check),
        supabase.rpc('manual_values_can_save', { p_application_id: applicationId }).then(check),
    ]);
    const names = await fetchStaffNames((saves ?? []).map((s) => s.saved_by));
    return { files: files ?? [], saves: saves ?? [], canSave: Boolean(canSave), names };
};

// The local OCR text of a file, if it was read (requested SPA / SEC / Other uploads are; original ones aren't).
// PaddleOCR only: nothing is sent to the AI. [{ page_no, text }] in reading order, or [] when there is none.
export const fetchOcrText = async (documentId) => {
    const runs = check(await supabase.from('ocr_runs').select('id, status')
        .eq('document_id', documentId).eq('status', 'DONE').order('id', { ascending: false }).limit(1)) ?? [];
    if (!runs.length) return [];
    return check(await supabase.from('ocr_lines').select('page_no, line_no, text')
        .eq('run_id', runs[0].id).order('page_no').order('line_no')) ?? [];
};

// entries = [{ label, value }]; returns the new save's id
export const saveManualValues = async (documentId, entries) =>
    check(await supabase.rpc('save_manual_document_values', { p_document_id: documentId, p_entries: entries }));
