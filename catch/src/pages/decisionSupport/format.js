import { formatMoney } from '../applicationForm/options';

export const money = (v) => (v === null || v === undefined || v === '' ? '—' : `₱${formatMoney(v)}`);

// The Decision Support page, optionally at one of its sections (an id from registry.js)
export const dssHref = (appId, section) => `/decisionSupportPage?id=${appId}${section ? `#${section}` : ''}`;
