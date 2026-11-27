// The application profile sent with a policy check (mrac_runs.profile, 20261122_mrac_profile.sql). The policy
// recommender (mrac-service) reads it to find which policies the file triggers: borrower types, documents on file, CI
// results, collateral, the figures. The flat `facts` (facts.js) stay what the rules test and what "figures changed
// since the check" compares; this is the wider picture.
//
// Pure (no React, no Supabase) so tests/mracProfile.test.mjs can check it. Same privacy rule as the AI suggestion
// (aiSuggestion/buildInput.js): borrowers by ROLE only; never names, birth dates, gender, dependents, addresses,
// contact details, employer / bank / lender names, ID / TIN / account / title numbers, the application number or the
// CI's free-text summaries. The database refuses a profile with a personal key (mrac_profile_problem).
// One exception (Josh, 2026-11-22): civil status as a category (SINGLE / MARRIED / WIDOWED / SEPARATED), ONLY so the
// recommender can find document rules (marriage certificate, CENOMAR, spousal consent). The recommender is told never
// to use it as a judgment of the borrower, and the database accepts it only as borrowers[].civil_status with one of
// those values.
// Home ownership (Josh, 2026-11-27) goes out the same way: as a category only (OWNED / RENTED / LIVING_WITH_RELATIVES /
// OTHER), never the address, rent or length of stay, because the RAAC tests it (Residence ownership).
import { roleOf, yearsBetween } from '../aiSuggestion/buildInput.js';
import { ciSlots, raacNfis, undisclosedLoans, validityRows, yearsSince } from '../ciRequest/ciFacts.js';

const BORROWERS = ['PRINCIPAL', 'SPOUSE', 'CO_BORROWER'];
// The civil_status_type values; anything else is sent as null
const CIVIL_STATUSES = new Set(['SINGLE', 'MARRIED', 'WIDOWED', 'SEPARATED']);
const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const text = (v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim());
const one = (x) => (Array.isArray(x) ? x[0] ?? null : x ?? null);
const present = (party) => party?.addresses?.find((a) => a.address_type === 'PRESENT') ?? null;
const HOME_OWNERSHIP = new Set(['OWNED', 'RENTED', 'LIVING_WITH_RELATIVES', 'OTHER']);
// "₱58,500.00" -> 58500; anything that isn't a number -> null
const amount = (v) => {
    const n = Number(String(v ?? '').replace(/[^0-9.-]/g, ''));
    return text(v) === null || Number.isNaN(n) ? null : n;
};
const round2 = (n) => Math.round(n * 100) / 100;
// "2026-07-15" / "07/15/2026" -> "2026-07"
const monthOf = (v) => {
    const s = text(v);
    if (!s) return null;
    const iso = s.match(/^(\d{4})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}`;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// A requested document's name with any party's name in it replaced by the role ("Certificate of Full Payment")
const EXTRA_TYPES = { SPA: 'Special power of attorney', SEC_DTI_MAYORS_PERMIT: 'SEC / DTI / Mayor\'s permit' };
const FULL_PAYMENT = /full[\s-]*payment|fully[\s-]*paid|zero[\s-]*balance|certificate of (settlement|clearance)/i;
const docName = (doc, parties) => {
    let name = text(doc.label) ?? EXTRA_TYPES[doc.document_type] ?? 'Other document';
    for (const p of parties) {
        for (const part of [p.first_name, p.middle_name, p.last_name].map(text).filter((x) => x && x.length > 1)) {
            name = name.replace(new RegExp(part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), roleOf(p));
        }
    }
    return name.slice(0, 120);
};

// The income documents a person confirmed in the Document check (readings: fetchConfirmedReadings in api.js)
const incomeDocuments = (party, readings) => {
    const docsOf = (type) => (party.application_requirements ?? []).filter((r) => r.requirement_type === type)
        .flatMap((r) => r.documents ?? []).map((d) => readings[d.id]).filter(Boolean);
    const coe = docsOf('COE_ITR').find((r) => r.monthly_basic_salary || r.monthly_gross_income || r.employment_status) ?? null;
    // one row per payslip, across the borrower's confirmed payslip files
    const slips = docsOf('PAYSLIPS_REMITTANCES').flatMap((r) => {
        const n = Math.max(0, ...Object.values(r).map((v) => v.length));
        return Array.from({ length: n }, (_, i) => ({ month: monthOf(r.pay_date?.[i] ?? r.period_end?.[i]),
            basic: amount(r.basic_pay?.[i]), gross: amount(r.gross_pay?.[i]), deductions: amount(r.total_deductions?.[i]),
            net: amount(r.net_pay?.[i]) }));
    }).filter((s) => s.basic !== null || s.gross !== null);
    // Payslips can be semi-monthly, so the figures are per MONTH: the sum over the months the payslips cover
    // (null when a pay date is missing, rather than guessing the pay frequency)
    const months = new Set(slips.map((s) => s.month));
    const dated = slips.length > 0 && !months.has(null);
    const monthly = (key) => {
        const nums = slips.map((s) => s[key]).filter((n) => n !== null);
        return dated && nums.length ? round2(nums.reduce((a, b) => a + b, 0) / months.size) : null;
    };
    return {
        coec_confirmed: Boolean(coe),
        employment_status: text(coe?.employment_status?.[0]),
        coec_monthly_basic_salary: amount(coe?.monthly_basic_salary?.[0]),
        coec_monthly_gross_income: amount(coe?.monthly_gross_income?.[0]),
        payslips_confirmed: slips.length,
        payslip_months: dated ? months.size : null,
        payslip_monthly_basic_pay: monthly('basic'),
        payslip_monthly_gross_pay: monthly('gross'),
        payslip_monthly_deductions: monthly('deductions'),
        payslip_monthly_net_pay: monthly('net'),
    };
};

// Free-text citizenship -> true / false / null (not stated)
const filipino = (v) => (text(v) === null ? null : /filipin|pilipin|philippine/i.test(v));

// latest mark per document id (marks come oldest first)
const latestMarks = (marks) => {
    const out = {};
    for (const m of marks) out[m.document_id] = m.mark;
    return out;
};

// app: the application record (fetchApplication); computed: computeFp(); score: totalCreditScore();
// ci: { checks } from fetchCiResults; ciFlagged: a CI flagged findings; fileMarks: document_file_marks rows;
// openDocumentRequest: an AO request to the applicant is still open; exceptions: the FP's V. Exception/s rows;
// facts: buildMracFacts() (for the principal's age at maturity and stand-alone DBR); readings: the confirmed AI
// readings per document id (fetchConfirmedReadings).
export const buildPolicyProfile = ({ app, computed, score = {}, ci = { checks: [] }, ciFlagged = false, fileMarks = [],
    openDocumentRequest = false, exceptions = [], facts = {}, readings = {}, extraDocuments = [] }) => {
    const collateral = one(app.collateral_details);
    const referral = one(app.referral_details);
    const parties = app.applicants ?? [];
    const borrowers = (computed.incomes ?? []).map((i) => i.party).filter((p) => BORROWERS.includes(p.role));
    const income = Object.fromEntries((computed.incomes ?? []).map((i) => [i.party.id, i]));
    const ciOf = (party, type) => ci.checks.find((x) => x.applicant_id === party.id && x.check_type === type)?.result ?? null;
    const slots = ciSlots(app, ci);
    const endUser = Boolean(text(referral?.developer_name));
    const tcp = num(collateral?.selling_price);
    const records = raacNfis(slots, { endUser, lcr: num(computed.lcr), tcpLcr: num(app.loan_amount) && tcp ? num(app.loan_amount) / tcp : null });
    const tuRows = undisclosedLoans(slots);
    const validity = validityRows(slots);
    const marks = latestMarks(fileMarks);
    const principal = parties.find((p) => p.role === 'PRINCIPAL');
    // a spouse / co-borrower on "Same as principal" lives in the principal's home
    const home = (party) => {
        const a = present(party);
        return a?.same_as_principal && party.role !== 'PRINCIPAL' ? present(principal) : a;
    };

    return {
        schema: 1,
        loan: {
            amount: num(app.loan_amount),
            term_years: num(app.loan_term_years),
            interest_rate: num(app.interest_rate),
            fixing_period: text(app.fixing_period),
            purpose: text(one(app.loan_purposes)?.label ?? app.loan_purpose_other),
            property_type: text(collateral?.property_type),
            collateral_value: num(computed.collateralValue),
            collateral_basis: computed.appraised !== null && computed.appraised !== undefined ? 'APPRAISED_VALUE' : 'SELLING_PRICE',
            lcr: num(computed.lcr),
            from_developer: Boolean(text(referral?.developer_name)),
            // CATCH reads a developer-referred loan as end-user financing (same rule as the NFIS LCR caps, ciFacts.js)
            financing: endUser ? 'END_USER' : 'REGULAR',
            loan_to_tcp: num(app.loan_amount) && tcp ? num(app.loan_amount) / tcp : null,
            referral_channel: text(referral?.channel),
        },
        borrowers: borrowers.map((party) => {
            const job = one(party.employment_info);
            const i = income[party.id] ?? {};
            const loans = party.existing_loans ?? [];
            const address = present(party);
            const ownership = home(party)?.home_ownership;
            return {
                role: roleOf(party),
                relationship_to_principal: party.role === 'CO_BORROWER' ? text(party.relationship_to_principal) : null,
                filipino_citizen: filipino(party.citizenship),
                // document rules only (see the top of this file); the spouse form has no civil status, so it stays null
                civil_status: CIVIL_STATUSES.has(party.civil_status) ? party.civil_status : null,
                lives_abroad: address && address.living_in_ph === false ? true : address ? false : null,
                employment_type: job?.employment_type ?? null,
                tenure_years: job && job.employment_type !== 'UNEMPLOYED' ? yearsBetween(job.employment_date, app.submitted_at) : null,
                home_ownership: HOME_OWNERSHIP.has(ownership) ? ownership : null,
                // FP income: declared gross (application) x the basis factor (COE 80%, payslip 90%) = basic, + other
                income_basis: i.basis?.value ?? null,
                income_basis_factor: num(i.basis?.factor),
                declared_gross_income: num(i.declared),
                basic_income: num(i.basic),
                other_income: num(i.other),
                gross_income: num(i.gross),
                income_documents: incomeDocuments(party, readings),
                existing_loans: loans.map((l) => ({ type: text(l.loan_type), monthly_payment: num(l.monthly_payment),
                    over_6_months: l.term_over_6_months ?? null })),
            };
        }),
        other_parties: {
            mortgagor: parties.some((p) => p.role === 'MORTGAGOR'),
            attorney_in_fact: parties.some((p) => p.role === 'ATTORNEY_IN_FACT'),
        },
        totals: {
            existing_monthly_amortization: num(computed.existing),
            total_gross_income: num(computed.totalGross),
            new_monthly_amortization: num(computed.amortization),
            dbr: num(computed.dbr),
            dbr_principal_only: num(facts.dbr_standalone),
            principal_age_at_maturity: num(facts.age_at_maturity),
        },
        credit_score: {
            total: num(score.total),
            complete: Boolean(score.complete),
            risk_rating: score.riskRating ?? null,
            recommendation: score.recommendation ?? null,
            // the CO's Character picks (band labels); null when not scored
            character_bands: score.characterBands ?? null,
        },
        // The CI results by role: each NFIS record as its kind, age, balance and RAAC reading (never the reporting
        // institution, case number, who filed it or the CI's remarks); TU as counts and the worst lateness
        ci: {
            borrowers: borrowers.map((p) => {
                const slot = slots.find((s) => s.party.id === p.id);
                const raac = records.filter((r) => r.record.applicant_id === p.id);
                const tu = tuRows.find((r) => r.who === slot?.who);
                const valid = Object.fromEntries(validity.filter((v) => v.who === slot?.who).map((v) => [v.check.toLowerCase(), v.status]));
                return {
                    role: roleOf(p), nfis: ciOf(p, 'NFIS'), tu: ciOf(p, 'TU'), bras: ciOf(p, 'BRAS'),
                    nfis_records: raac.map((r) => ({
                        kind: r.record.record_type,
                        years_since_reported: yearsSince(r.record.date_reported),
                        outstanding_balance: num(r.record.outstanding_balance),
                        settled: r.record.settlement ? r.record.settlement !== 'UNPAID' : null,
                        case_type: r.record.case_type ?? null,
                        raac: r.status,
                        lcr_within_cap: r.lcrOk ?? null,
                    })),
                    tu_open_accounts: slot ? slot.tu.accounts.filter((a) => a.is_open).length : null,
                    tu_max_days_late: slot && slot.tu.accounts.length ? Math.max(...slot.tu.accounts.map((a) => num(a.max_dpd) ?? 0)) : null,
                    tu_undeclared_loans: tu?.extraLoans ?? null,
                    tu_undeclared_cards: tu?.extraCards ?? null,
                    nfis_validity: valid.nfis ?? null,
                    tu_validity: valid.tu ?? null,
                };
            }),
            findings_flagged: Boolean(ciFlagged),
        },
        // The checklist CATCH derived from each borrower's employment type, with what is on file and the staff marks
        documents: {
            borrowers: borrowers.map((p) => ({
                role: roleOf(p),
                required: (p.application_requirements ?? []).map((r) => {
                    const docs = r.documents ?? [];
                    return {
                        requirement: r.requirement_type,
                        files: docs.length,
                        // confirmed: the AI reading of the file was checked and confirmed by a person (Document check)
                        confirmed: docs.filter((d) => readings[d.id]).length,
                        cleared: docs.filter((d) => marks[d.id] === 'CLEARED').length,
                        needs_new_copy: docs.filter((d) => marks[d.id] === 'NEEDS_NEW_COPY').length,
                    };
                }),
                // asked for by name outside the checklist; shows_full_payment = a settlement / full-payment proof
                other_documents: extraDocuments.filter((d) => d.applicant_id === p.id).map((d) => {
                    const name = docName(d, parties);
                    return { document: name, details_saved: Boolean(d.has_details), shows_full_payment: FULL_PAYMENT.test(name) };
                }),
            })),
            open_request_to_applicant: Boolean(openDocumentRequest),
        },
        exceptions: exceptions.filter((e) => e.policy || e.exception_recommendation || e.mitigant).map((e) => ({
            policy: text(e.policy), recommendation: text(e.exception_recommendation), mitigant: text(e.mitigant),
        })),
    };
};

// The one key that matches PERSONAL_KEY but is allowed, only on a borrower and only as a CIVIL_STATUSES value
export const DOCUMENT_ONLY_KEYS = ['civil_status'];

// Same pattern the database refuses (mrac_profile_problem / credit_suggestion_input_problem)
export const PERSONAL_KEY = /((^|_)name$|address|email|mobile|phone|birth|gender|civil|dependent|residence|length_of_stay|^tin$|account_number|^tct|application_no)/i;
