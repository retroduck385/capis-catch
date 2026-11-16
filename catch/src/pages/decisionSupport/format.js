import { formatMoney } from '../applicationForm/options';

export const money = (v) => (v === null || v === undefined || v === '' ? '—' : `₱${formatMoney(v)}`);
