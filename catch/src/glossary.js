// The short terms staff see on the pages, with a one-line explanation each. Shown by <Term> / <Terms>
// (components/term.jsx) when a staff member hovers, focuses or taps the term.
//
// To add a term: add one line below, KEY: ['What it stands for', 'One short line in plain words'].
//   - KEY is the term exactly as it is written on the page (case matters: "CrID").
//   - The second part is optional; leave it out when the name says it all.
//   - Meanings come from docs/glossary.md. Don't guess: leave a term out until someone confirms it.
//   - Search this file for "TO CONFIRM" to find the entries still waiting for a groupmate's answer.
//     ("to confirm" is never shown on screen.)
export const GLOSSARY = {
    // ---- Roles ----
    AO: ['Account Officer', 'The borrower\'s main contact; takes in the application and checks it section by section.'],
    CO: ['Credit Officer', 'Evaluates the file and prepares the Financial Package and the credit result.'],
    CI: ['Credit Investigator / Credit Investigation', 'Checks each borrower against NFIS, TransUnion and BRAS.'],
    AIF: ['Attorney-in-Fact', 'The person who signs for a borrower under a Special Power of Attorney.'],

    // ---- Credit checks and data sources ----
    KYC: ['Know Your Customer', 'The borrower\'s details from the application, verified by the Account Officer.'],
    NFIS: ['Negative File Information System', 'A shared database of adverse credit behavior.'],
    TU: ['TransUnion', 'The TransUnion Philippines credit bureau report.'],
    BRAS: ['Bank Reference and Account Status', 'The bank\'s own reference database for accounts held at the bank.'],

    // ---- Figures ----
    DBR: ['Debt Burden Ratio', 'New plus existing monthly amortizations, divided by the total gross income of all borrowers.'],
    LCR: ['Loan-to-Collateral Ratio', 'Loan amount divided by the appraised value, or by the selling price when no appraisal is entered.'],
    NDI: ['Net Disposable Income'],
    AMD: ['Average Monthly Deposit'],
    ADB: ['Average Daily Balance'],
    TCP: ['Total Contract Price', 'The collateral\'s selling price; used for the LCR when no appraised value is entered.'],
    TAT: ['Turnaround Time', 'The target time for a stage; "near" starts at 75% of it.'],

    // ---- Policy ----
    // MRAC and RAAC both appear in the app. MRAC: docs/approval-rules.md. RAAC: expansion given by the user
    // (2026-11-16). The docs don't say how the two relate, so neither line does.
    MRAC: ['Minimum Risk Acceptance Criteria', 'The baseline thresholds a file must meet to go on to full evaluation; the policy check tests the figures against them.'],
    RAAC: ['Risk Asset Acceptance Criteria', 'The bank\'s acceptance criteria for housing loans, one of the policy documents.'],
    RAG: ['Retrieval-Augmented Generation', 'Finds the policy passages that apply; every flag cites the passage it came from.'],
    DOSRI: ['Directors, Officers, Stockholders and Related Interests'],
    RPT: ['Related Party Transaction'],
    HGC: ['Home Guaranty Corporation'],

    // ---- Documents ----
    FP: ['Financial Package', 'The summary of the borrower and the loan that credit uses to decide.'],
    COE: ['Certificate of Employment'],
    COEC: ['Certificate of Employment with Compensation'],
    ITR: ['Income Tax Return'],
    SPA: ['Special Power of Attorney'],
    TCT: ['Transfer Certificate of Title', 'The land title of a house and lot.'],
    CCT: ['Condominium Certificate of Title', 'The title of a condominium unit.'],
    CTC: ['Community Tax Certificate'],
    DOU: ['Deed of Undertaking'],
    OCR: ['Optical Character Recognition', 'Reading the text out of an uploaded file, before the AI labels the values.'],

    // ---- Bank units ----
    CRMD: ['Credit and Risk Management Division'],             // TO CONFIRM with groupmates
    CIAD: ['Credit Investigation and Appraisal Department'],   // TO CONFIRM with groupmates
    CrID: ['Credit Investigation Department'],                 // TO CONFIRM with groupmates
    CCS: ['Centralized Collection Services'],                  // TO CONFIRM with groupmates
};

// Longest first, so "COEC" is found before "COE"
const KEYS = Object.keys(GLOSSARY).sort((a, b) => b.length - a.length);
export const TERM_RE = new RegExp(`\\b(${KEYS.join('|')})\\b`, 'g');

// "Debt Burden Ratio. New plus existing ..." (one line)
export const explain = (key) => {
    const entry = GLOSSARY[key];
    return entry ? entry.filter(Boolean).join('. ').replace(/\.\.$/, '.') : null;
};

// Splits a text into plain parts and terms, marking EVERY mention of a known term:
// [{ text }, { term: 'DBR' }, { text }, ...]
export const splitTerms = (text) => {
    const parts = [];
    let last = 0;
    text = String(text ?? '');
    for (const m of text.matchAll(TERM_RE)) {
        if (m.index > last) parts.push({ text: text.slice(last, m.index) });
        parts.push({ term: m[1] });
        last = m.index + m[1].length;
    }
    if (last < text.length) parts.push({ text: text.slice(last) });
    return parts;
};

// For a button, link or form label (where a hover can't be nested): a plain title attribute explaining each known
// term in the text once, one per line ("TAT: Turnaround Time. The target time ..."), or undefined when there is none
export const termsTitle = (text) => {
    const keys = [...new Set([...String(text ?? '').matchAll(TERM_RE)].map((m) => m[1]))];
    return keys.length ? keys.map((k) => `${k}: ${explain(k)}`).join('\n') : undefined;
};
