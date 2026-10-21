// Values the KYC tab derives from the record (shared by the CI request forms and the Financial Package).
// "As of" is the submission date, like the sheet's ROUNDDOWN(YEARFRAC(..., submitted)).
import { getAddress } from './api';

const ADDRESS_PARTS = ['unit_house_no', 'building_street', 'subdivision_barangay', 'municipality_city', 'province', 'zip_code'];

// Same as the sheet's TEXTJOIN(", ", true, ...)
export const joinAddress = (address) =>
    address ? ADDRESS_PARTS.map((f) => address[f]).filter(Boolean).join(', ') || null : null;

// Spouse / co-borrower with "Same address as principal" store an empty row; use the principal's
export const presentAddressOf = (party, principal) => {
    const address = getAddress(party, 'PRESENT');
    return address?.same_as_principal ? getAddress(principal, 'PRESENT') : address;
};

// Whole months between two dates (null if either is missing or the start is later)
const monthsBetween = (from, asOf) => {
    if (!from) return null;
    const start = new Date(from);
    const end = asOf ? new Date(asOf) : new Date();
    let months = (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth();
    if (end.getDate() < start.getDate()) months -= 1;
    return months < 0 ? null : months;
};

// Whole years, or null
export const wholeYears = (from, asOf) => {
    const months = monthsBetween(from, asOf);
    return months === null ? null : Math.floor(months / 12);
};

// "3 years", or "3 months" if under a year (the sheet asks for the unit to be typed)
export const tenure = (from, asOf) => {
    const months = monthsBetween(from, asOf);
    if (months === null) return null;
    if (months < 12) return `${months} ${months === 1 ? 'month' : 'months'}`;
    const years = Math.floor(months / 12);
    return `${years} ${years === 1 ? 'year' : 'years'}`;
};
