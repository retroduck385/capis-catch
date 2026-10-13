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

// Only co-borrowers have party_no > 1
export const getParty = (app, role, partyNo = 1) =>
    app?.applicants?.find((a) => a.role === role && (a.party_no ?? 1) === partyNo) ?? null;

const ROLE_ORDER = ['PRINCIPAL', 'SPOUSE', 'CO_BORROWER', 'MORTGAGOR', 'ATTORNEY_IN_FACT'];

// Parties in KYC order (principal, spouse, co-borrowers 1..n, ...), optionally limited to some roles
export const getParties = (app, roles = ROLE_ORDER) =>
    (app?.applicants ?? [])
        .filter((a) => roles.includes(a.role))
        .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.party_no - b.party_no);

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

export const upsertParty = async (applicationId, role, fields, partyNo = 1) =>
    check(await supabase.from('applicants')
        .upsert({ ...toRow(fields), application_id: applicationId, role, party_no: partyNo },
            { onConflict: 'application_id,role,party_no' })
        .select().single());

export const updateParty = async (applicantId, fields) =>
    check(await supabase.from('applicants').update(toRow(fields)).eq('id', applicantId));

export const deleteParty = async (applicationId, role, partyNo = 1) =>
    check(await supabase.from('applicants').delete()
        .eq('application_id', applicationId).eq('role', role).eq('party_no', partyNo));

// Keeps co-borrowers numbered 1..count: adds empty ones, removes the highest-numbered extras
export const setCoBorrowerCount = async (applicationId, count, existingNos) => {
    check(await supabase.from('applicants').delete()
        .eq('application_id', applicationId).eq('role', 'CO_BORROWER').gt('party_no', count));
    const missing = Array.from({ length: count }, (_, i) => i + 1).filter((n) => !existingNos.includes(n));
    if (missing.length === 0) return;
    check(await supabase.from('applicants').insert(
        missing.map((n) => ({ application_id: applicationId, role: 'CO_BORROWER', party_no: n }))));
};

// Master profile: personal details in user_profile, mobile number on users.phone_number
export const fetchProfile = async (userId) => {
    const profile = check(await supabase.from('user_profile').select('*').eq('user_id', userId).maybeSingle());
    const user = check(await supabase.from('users').select('phone_number').eq('id', userId).maybeSingle());
    return { ...(profile ?? {}), mobile_number: user?.phone_number ?? null };
};

export const saveProfile = async (userId, { mobile_number, ...fields }) => {
    check(await supabase.from('user_profile')
        .upsert({ ...toRow(fields), user_id: userId }, { onConflict: 'user_id' }));
    check(await supabase.from('users').update({ phone_number: mobile_number || null }).eq('id', userId));
};

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

// The applicant's file name is only sent as file_name; the name_document() trigger
// renames it to the standard format and keeps the original in original_file_name.
export const uploadDocument = async ({ userId, applicationId, applicantId, requirement, file }) => {
    const ext = file.name.match(/\.([A-Za-z0-9]+)$/)?.[1]?.toLowerCase();
    const path = `${userId}/${applicationId}/${requirement.id}/${Date.now()}${ext ? `.${ext}` : ''}`;
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
