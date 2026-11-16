// Who and when, formatted the same way on every staff page (DESIGN.md 11.10, "Attribution"). Used by byline.jsx and
// the work tray's avatars. Plain .js (no JSX) so the tests can import it: tests/people.test.mjs.
//   personName(name)        "Josh Denzel Account Officer" -> "Josh Denzel" (a role in a test account's name is dropped)
//   initialsOf(name)        "Josh Denzel" -> "JD"
//   avatarStyle(name)       the person's pastel fill + dark initials (same name, same colour, everywhere)
//   formatWhen(iso, now)    short, relative while recent: "Just now", "12 min ago", "Today, 2:07 PM", "Yesterday, 4:48 PM",
//                           "Mon, 2:07 PM" (this week), "Oct 26, 2:07 PM" (this year), "Oct 26, 2025" (older)
//   formatDay(iso)          a date for a record fact: "Sep 29, 2026"
//   fullWhen(iso)           the exact moment, for the tooltip: "Monday, October 26, 2026 at 2:07 PM"
import { ROLE_LABELS } from '../roles.js';

const LOCALE = 'en-PH';
const ROLE_WORDS = Object.values(ROLE_LABELS).sort((a, b) => b.length - a.length);
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const AVATAR_TONES = [
    ['#dbeafe', '#1e3a8a'], ['#e0f2fe', '#075985'], ['#e0e7ff', '#3730a3'],
    ['#eef2f7', '#334155'], ['#ffedd5', '#9a3412'], ['#cfe0ff', '#1e40af'],
];

export const personName = (name) => {
    const n = String(name ?? '').trim();
    if (!n) return '';
    let out = n;
    // lookarounds, not \b: a label can end in ")" ("Dispatch Admin (Credit Officer Admin)")
    for (const role of ROLE_WORDS) out = out.replace(new RegExp(`(?<!\\w)${escape(role)}(?!\\w)`, 'ig'), ' ');
    out = out.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
    return out || n;
};

export const initialsOf = (name) => String(name ?? '').split(/\s+/).filter(Boolean).slice(0, 2)
    .map((p) => p[0].toUpperCase()).join('') || '?';

export const avatarStyle = (name) => {
    let h = 0;
    for (const ch of String(name ?? '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const [bg, fg] = AVATAR_TONES[h % AVATAR_TONES.length];
    return { background: bg, color: fg };
};

const toDate = (iso) => {
    if (!iso) return null;
    const d = iso instanceof Date ? iso : new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
};
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const time = (d) => d.toLocaleTimeString(LOCALE, { hour: 'numeric', minute: '2-digit' });

export const formatWhen = (iso, now = new Date()) => {
    const d = toDate(iso);
    if (!d) return '—';
    const ms = now - d;
    if (ms >= 0 && ms < 60 * 1000) return 'Just now';
    if (ms >= 0 && ms < 60 * 60 * 1000) return `${Math.floor(ms / 60000)} min ago`;
    const days = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
    if (days === 0) return `Today, ${time(d)}`;
    if (days === 1) return `Yesterday, ${time(d)}`;
    if (days > 1 && days < 7) return `${d.toLocaleDateString(LOCALE, { weekday: 'short' })}, ${time(d)}`;
    if (d.getFullYear() === now.getFullYear()) {
        return `${d.toLocaleDateString(LOCALE, { month: 'short', day: 'numeric' })}, ${time(d)}`;
    }
    return d.toLocaleDateString(LOCALE, { dateStyle: 'medium' });
};

export const formatDay = (iso) => {
    const d = toDate(iso);
    return d ? d.toLocaleDateString(LOCALE, { dateStyle: 'medium' }) : '—';
};

export const fullWhen = (iso) => {
    const d = toDate(iso);
    return d ? d.toLocaleString(LOCALE, { dateStyle: 'full', timeStyle: 'short' }) : '';
};
