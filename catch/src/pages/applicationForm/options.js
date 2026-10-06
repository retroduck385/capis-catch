// Dropdown options and field labels. Values match the Postgres enums in
// supabase/migrations/20260928_application_side.sql; labels follow the KYC tab.

export const GENDERS = [
    { value: 'MALE', label: 'Male' },
    { value: 'FEMALE', label: 'Female' },
    { value: 'OTHER', label: 'Other' },
];

export const CIVIL_STATUSES = [
    { value: 'SINGLE', label: 'Single' },
    { value: 'MARRIED', label: 'Married' },
    { value: 'WIDOWED', label: 'Widowed' },
    { value: 'SEPARATED', label: 'Separated' },
];

export const HOME_OWNERSHIP = [
    { value: 'OWNED', label: 'Owned' },
    { value: 'RENTED', label: 'Rented' },
    { value: 'LIVING_WITH_RELATIVES', label: 'Living with relatives' },
    { value: 'OTHER', label: 'Other' },
];

export const EMPLOYMENT_TYPES = [
    { value: 'LOCALLY_EMPLOYED', label: 'Locally employed' },
    { value: 'LICENSED_PROFESSIONAL', label: 'Licensed professional' },
    { value: 'SEAFARER', label: 'Seafarer' },
    { value: 'VIRTUAL_ASSISTANT', label: 'Virtual assistant' },
    { value: 'COMMISSION_BASED', label: 'Commission-based' },
    { value: 'OFW', label: 'OFW' },
    { value: 'SELF_EMPLOYED', label: 'Self-employed / Business owner' },
    { value: 'RENTAL_BUSINESS', label: 'Rental business' },
    { value: 'PUV_OPERATOR', label: 'PUV operator' },
    { value: 'PENSIONER', label: 'Pensioner' },
    { value: 'UNEMPLOYED', label: 'Not employed' }, // spouse only
];

export const REFERRAL_CHANNELS = [
    { value: 'BRANCH', label: 'Branch Referred' },
    { value: 'DEVELOPER', label: 'Developer Referred' },
    { value: 'AO', label: 'AO Referred' },
    { value: 'BROKER', label: 'Broker Referred' },
];

export const REQUIREMENT_LABELS = {
    VALID_ID_PASSPORT: 'Valid ID / Passport',
    SPA: 'SPA (Special Power of Attorney)',
    FS_BANK_STATEMENTS: 'FS / Bank Statements',
    COE_ITR: 'COE / ITR',
    PAYSLIPS_REMITTANCES: 'Payslips / Remittances (3 mos)',
    SEC_DTI_MAYORS_PERMIT: "SEC / DTI / Mayor's Permit",
};

// Mirrors required_document_min() in the migration
export const REQUIREMENT_MIN_FILES = { VALID_ID_PASSPORT: 2 };
export const minFilesFor = (type) => REQUIREMENT_MIN_FILES[type] ?? 1;

export const PARTY_LABELS = {
    PRINCIPAL: 'Principal Borrower',
    SPOUSE: 'Spouse',
    CO_BORROWER: 'Co-borrower',
    MORTGAGOR: 'Mortgagor',
    ATTORNEY_IN_FACT: 'Attorney-in-Fact',
};

// "Co-borrower 2" for co-borrowers, the plain role label for everyone else
export const partyLabel = (party) =>
    PARTY_LABELS[party.role] + (party.role === 'CO_BORROWER' ? ` ${party.party_no ?? 1}` : '');

export const BORROWER_ROLES = ['PRINCIPAL', 'SPOUSE', 'CO_BORROWER'];

export const MAX_CO_BORROWERS = 5;
export const MAX_DEPENDENTS = 20;

// Person fields in KYC order
export const PERSON_FIELDS = {
    first_name: { label: 'First Name' },
    middle_name: { label: 'Middle Name' },
    maiden_name: { label: 'Last Name (Maiden Name)' },
    last_name: { label: 'Last Name' },
    name_extension: { label: 'Name Extension', placeholder: 'Jr., Sr., III' },
    relationship_to_principal: { label: 'Relationship with Principal Borrower' },
    mobile_number: { label: 'Mobile Number', placeholder: '09XXXXXXXXX' },
    email_address: { label: 'Email Address', type: 'email' },
    gender: { label: 'Gender', options: GENDERS },
    date_of_birth: { label: 'Date of Birth', type: 'date' },
    birth_place: { label: 'Birth Place' },
    civil_status: { label: 'Civil Status', options: CIVIL_STATUSES },
    citizenship: { label: 'Citizenship' },
    sss_no: { label: 'SSS No.' },
    tin: { label: 'TIN', placeholder: '000-000-000-000' },
};

// Which person fields each party fills in, and whether each is required: [field, required]
export const PARTY_FIELDS = {
    PRINCIPAL: [
        ['first_name', true], ['middle_name', false], ['last_name', true], ['name_extension', false],
        ['mobile_number', true], ['email_address', true], ['gender', true], ['date_of_birth', true],
        ['birth_place', true], ['civil_status', true], ['citizenship', true], ['sss_no', false], ['tin', true],
    ],
    SPOUSE: [
        ['first_name', true], ['middle_name', false], ['maiden_name', false], ['last_name', true],
        ['name_extension', false], ['mobile_number', true], ['email_address', false], ['date_of_birth', true],
        ['birth_place', true], ['citizenship', true], ['sss_no', false], ['tin', true],
    ],
    CO_BORROWER: [
        ['first_name', true], ['middle_name', false], ['last_name', true], ['name_extension', false],
        ['relationship_to_principal', true], ['mobile_number', true], ['email_address', false],
        ['gender', true], ['date_of_birth', true], ['birth_place', true], ['citizenship', true],
        ['sss_no', false], ['tin', true],
    ],
    MORTGAGOR: [
        ['first_name', true], ['middle_name', false], ['last_name', true], ['name_extension', false],
    ],
    ATTORNEY_IN_FACT: [
        ['first_name', true], ['middle_name', false], ['last_name', true], ['name_extension', false],
        ['relationship_to_principal', true], ['date_of_birth', true], ['civil_status', true],
        ['mobile_number', true], ['email_address', false], ['sss_no', false], ['tin', false],
    ],
    // Not a party role: the applicant's own master profile, which pre-fills PRINCIPAL.
    // Email comes from the login account.
    PROFILE: [
        ['first_name', true], ['middle_name', false], ['last_name', true], ['name_extension', false],
        ['mobile_number', true], ['gender', true], ['date_of_birth', true], ['birth_place', true],
        ['civil_status', true], ['citizenship', true], ['sss_no', false], ['tin', true],
    ],
    // Staff profile: just enough to show who is assigned / who acted. No SSS/TIN —
    // nothing in the workflow uses them for staff. Email comes from the login account.
    STAFF_PROFILE: [
        ['first_name', true], ['middle_name', false], ['last_name', true], ['name_extension', false],
        ['mobile_number', true],
    ],
};

export const ADDRESS_FIELDS = {
    unit_house_no: { label: 'Unit / House No.' },
    building_street: { label: 'Building / Block Name / Street Name' },
    subdivision_barangay: { label: 'Subdivision Name / Barangay Name' },
    municipality_city: { label: 'Municipality / City' },
    province: { label: 'Province' },
    zip_code: { label: 'ZIP Code' },
};

export const EMPLOYMENT_FIELDS = {
    employment_type: { label: 'Employment Type', options: EMPLOYMENT_TYPES },
    employer_business_name: { label: "Employer's / Business Name" },
    occupation: { label: 'Occupation' },
    employment_date: { label: 'Employment Date', type: 'date' },
    contact_number: { label: 'Contact Number of Employer / Business' },
    email_address: { label: 'Email Address of Employer / Business', type: 'email' },
    employer_tin: { label: "Employer's / Business TIN" },
    ctc_no: { label: 'CTC No.' },
    ctc_date_issued: { label: 'CTC Date Issued', type: 'date' },
    ctc_place_issued: { label: 'CTC Place Issued' },
    gross_monthly_income: { label: 'Gross Monthly Income (PHP)', type: 'money' },
};

export const COLLATERAL_FIELDS = {
    project_name: { label: 'Project Name' },
    property_type: { label: 'Property Type', placeholder: 'House and Lot, Condominium, Townhouse, Vacant Lot' },
    selling_price: { label: 'Selling Price (PHP)', type: 'money' },
    registered_owner: { label: 'Registered Owner' },
    tct_cct_no: { label: 'TCT / CCT No.' },
    lot_area: { label: 'Lot Area (sqm)', type: 'number' },
    floor_area: { label: 'Floor Area (sqm)', type: 'number' },
    contact_person: { label: 'Contact Person' },
    contact_number: { label: 'Contact Number' },
};

export const REFERRAL_FIELDS = {
    channel: { label: 'Channel', options: REFERRAL_CHANNELS },
    developer_name: { label: "Developer's Name" },
    branch: { label: 'Branch' },
    referrer: { label: 'Referrer' },
};

export const REFERENCE_FIELDS = {
    name: { label: 'Name' },
    address: { label: 'Address' },
    contact_number: { label: 'Contact Number' },
    relationship_to_principal: { label: 'Relationship with Principal Borrower' },
};

export const BANK_ACCOUNT_FIELDS = {
    bank_name: { label: 'Name of Bank' },
    account_type: { label: 'Account Type', placeholder: 'Savings, Checking, Time Deposit' },
    account_number: { label: 'Account Number' },
};

export const EXISTING_LOAN_FIELDS = {
    loan_type: { label: 'Loan Type', placeholder: 'Auto, Personal, Salary' },
    lending_institution: { label: 'Name of Bank / Lending Institution' },
    monthly_payment: { label: 'Monthly Payment (PHP)', type: 'money' },
    term_over_6_months: { label: 'Term longer than 6 months?', type: 'checkbox' },
};

export const CREDIT_CARD_FIELDS = {
    issuing_bank: { label: 'Issuing Bank' },
    credit_limit: { label: 'Credit Limit (PHP)', type: 'money' },
    expiry_date: { label: 'Expiry Date', type: 'date' },
};

export const PERSON_KEYS = Object.keys(PERSON_FIELDS);
export const ADDRESS_KEYS = [...Object.keys(ADDRESS_FIELDS), 'living_in_ph', 'home_ownership', 'monthly_rent', 'date_move_in'];
export const EMPLOYMENT_KEYS = Object.keys(EMPLOYMENT_FIELDS);

export const labelFor = (options, value) => options.find((o) => o.value === value)?.label ?? value;

// Money: inputs keep a plain numeric string ("1500000.5"); these add the commas for display
export const formatMoney = (value, { fixed = true } = {}) => {
    if (value === null || value === undefined || value === '') return '';
    if (fixed) return Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const [whole, cents] = String(value).split('.');
    return Number(whole || 0).toLocaleString('en-US') + (cents !== undefined ? `.${cents}` : '');
};

// What the user typed ("1,500,000.505") -> plain numeric string with at most 2 decimals ("1500000.50")
export const parseMoney = (text) => {
    const [whole, ...rest] = String(text).replace(/[^\d.]/g, '').split('.');
    return rest.length ? `${whole}.${rest.join('').slice(0, 2)}` : whole;
};
