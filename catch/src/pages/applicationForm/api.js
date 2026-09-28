// Supabase reads/writes for the application form. Functions throw on error;
// callers handle it in try/catch/finally.
import { supabase } from '../../supabaseClient';

const BUCKET = 'application-documents';

const check = ({ data, error }) => {
    if (error) throw error;
    return data;
};

// '' from inputs -> null so Postgres dates/numbers accept it
export const toRow = (form) =>
    Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v === '' ? null : v]));

// null from the DB -> '' so inputs stay controlled
export const toForm = (row, fields) =>
    Object.fromEntries(fields.map((f) => [f, row?.[f] ?? '']));

// Nested 1:1 relations may come back as an object or a one-item array
export const one = (x) => (Array.isArray(x) ? x[0] ?? null : x ?? null);

export const getParty = (app, role) => app?.applicants?.find((a) => a.role === role) ?? null;
export const getAddress = (party, type) => party?.addresses?.find((a) => a.address_type === type) ?? null;

const APPLICATION_SELECT = `
    *,
    loan_purposes ( label ),
    applicants (
        *,
        addresses ( * ),
        employment_info ( * ),
        dependents ( * ),
        bank_accounts ( * ),
        existing_loans ( * ),
        credit_cards ( * ),
        application_requirements ( *, documents ( * ) )
    ),
    collateral_details ( * ),
    referral_details ( * ),
    character_references ( * )
`;

export const fetchApplication = async (applicationId) =>
    check(await supabase.from('loan_applications').select(APPLICATION_SELECT).eq('id', applicationId).single());

// Re-derives the document checklist from employment types, then loads the whole record
export const refreshApplication = async (applicationId) => {
    check(await supabase.rpc('sync_requirements', { p_application_id: applicationId }));
    return fetchApplication(applicationId);
};

export const getOrCreateDraft = async (userId) => {
    const findDraft = async () =>
        check(await supabase.from('loan_applications').select('id')
            .eq('user_id', userId).eq('status', 'DRAFT').maybeSingle());

    const existing = await findDraft();
    if (existing) return existing.id;

    const { data, error } = await supabase.from('loan_applications')
        .insert({ user_id: userId }).select('id').single();
    // 23505 = another tab/render already created the draft (one_draft_per_user index)
    if (error?.code === '23505') return (await findDraft()).id;
    if (error) throw error;
    return data.id;
};

export const listMyApplications = async (userId) =>
    check(await supabase.from('loan_applications')
        .select('id, application_no, status, loan_amount, created_at, submitted_at')
        .eq('user_id', userId).order('created_at', { ascending: false }));

export const fetchLoanPurposes = async () =>
    check(await supabase.from('loan_purposes').select('id, label').eq('is_active', true).order('label'));

export const updateLoanApplication = async (applicationId, fields) =>
    check(await supabase.from('loan_applications').update(toRow(fields)).eq('id', applicationId));

export const upsertParty = async (applicationId, role, fields) =>
    check(await supabase.from('applicants')
        .upsert({ ...toRow(fields), application_id: applicationId, role }, { onConflict: 'application_id,role' })
        .select().single());

export const deleteParty = async (applicationId, role) =>
    check(await supabase.from('applicants').delete().eq('application_id', applicationId).eq('role', role));

export const upsertAddress = async (applicantId, addressType, fields) =>
    check(await supabase.from('addresses')
        .upsert({ ...toRow(fields), applicant_id: applicantId, address_type: addressType },
            { onConflict: 'applicant_id,address_type' }));

export const deleteAddress = async (applicantId, addressType) =>
    check(await supabase.from('addresses').delete().eq('applicant_id', applicantId).eq('address_type', addressType));

export const upsertEmployment = async (applicantId, fields) =>
    check(await supabase.from('employment_info')
        .upsert({ ...toRow(fields), applicant_id: applicantId }, { onConflict: 'applicant_id' }));

// For list tables (dependents, bank_accounts, existing_loans, credit_cards): replace all rows
export const replaceApplicantRows = async (table, applicantId, rows) => {
    check(await supabase.from(table).delete().eq('applicant_id', applicantId));
    if (rows.length === 0) return;
    check(await supabase.from(table).insert(rows.map((r) => ({ ...toRow(r), applicant_id: applicantId }))));
};

export const upsertReferences = async (applicationId, references) =>
    check(await supabase.from('character_references')
        .upsert(references.map((r, i) => ({ ...toRow(r), application_id: applicationId, reference_no: i + 1 })),
            { onConflict: 'application_id,reference_no' }));

export const upsertCollateral = async (applicationId, fields) =>
    check(await supabase.from('collateral_details')
        .upsert({ ...toRow(fields), application_id: applicationId }, { onConflict: 'application_id' }));

export const upsertReferral = async (applicationId, fields) =>
    check(await supabase.from('referral_details')
        .upsert({ ...toRow(fields), application_id: applicationId }, { onConflict: 'application_id' }));

export const uploadDocument = async ({ userId, applicationId, applicantId, requirement, file }) => {
    const safeName = file.name.replace(/[^\w.-]+/g, '_');
    const path = `${userId}/${applicationId}/${requirement.id}/${Date.now()}-${safeName}`;
    check(await supabase.storage.from(BUCKET).upload(path, file));
    try {
        check(await supabase.from('documents').insert({
            application_id: applicationId,
            applicant_id: applicantId,
            requirement_id: requirement.id,
            document_type: requirement.requirement_type,
            file_name: file.name,
            file_path: path,
        }));
    } catch (err) {
        await supabase.storage.from(BUCKET).remove([path]); // don't leave an orphaned file
        throw err;
    }
};

export const deleteDocument = async (doc) => {
    check(await supabase.storage.from(BUCKET).remove([doc.file_path]));
    check(await supabase.from('documents').delete().eq('id', doc.id));
};

export const getDocumentUrl = async (doc) =>
    check(await supabase.storage.from(BUCKET).createSignedUrl(doc.file_path, 60)).signedUrl;

// Returns a list of missing items; empty list = submitted
export const submitApplication = async (applicationId) =>
    check(await supabase.rpc('submit_application', { p_application_id: applicationId }));
