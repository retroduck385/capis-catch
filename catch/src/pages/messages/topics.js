// Topics: a message can be about one section of a loan-file page ("comment on a tile").
// The topic is the section's element id (fp-iv, cs-total, rv-ci, ds-readiness, kyc-spouse), stored on the message
// (messages.topic, 20261115_message_mentions_topics.sql). The thread shows it as a chip that opens that section.
// Plain JavaScript with no React or Supabase imports, so the PGlite test suite can import it under Node.
import { STAFF_ROLES } from '../../roles.js';

// Must match the check in the migration
export const TOPIC_RE = /^(fp|cs|rv|ds|kyc)-[A-Za-z0-9_-]{1,40}$/;

const PAGES = {
    fp: { name: 'Financial Package', path: '/financialPackagePage' },
    cs: { name: 'Credit score', path: '/creditScorePage' },
    rv: { name: 'Review summary', path: '/reviewSummaryPage' },
    ds: { name: 'Decision support', path: '/decisionSupportPage' },
    kyc: { name: 'KYC', path: '/loanFolderPage' },
};

// Section names as shown in each page's navigator. A section missing here still works: its id is shown tidied up.
const LABELS = {
    'fp-general': 'General information', 'fp-i': 'I. Borrower/s highlight', 'fp-ii': 'II. Facility',
    'fp-iii': 'III. Collateral', 'fp-iv': 'IV. Credit checking', 'fp-v': 'V. Exceptions',
    'fp-mrac': 'Policy check (MRAC)', 'fp-vi': 'VI. Terms and conditions', 'fp-vii': 'VII. Approval',
    'fp-viii': 'VIII. Employment', 'fp-ix': 'IX. Cash flow', 'fp-x': 'X. Deposit checking',
    'fp-xi': 'XI. Loan verification', 'fp-xii': 'XII. Trade checking', 'fp-xiii': 'XIII. Title',
    'fp-xiv': 'XIV. Customer information', 'fp-result': 'Credit result',
    'cs-CAPACITY': '1. Capacity', 'cs-CHARACTER': '2. Character', 'cs-COLLATERAL': '3. Collateral',
    'cs-CONDITION': '4. Condition', 'cs-total': 'Total score', 'cs-history': 'Change history',
    'rv-progress': 'Review progress', 'rv-flags': 'Flags to check', 'rv-recommendation': "Credit Officer's recommendation",
    'rv-income': 'Income', 'rv-figures': 'Key figures', 'rv-ci': 'IV. Credit checking', 'rv-score': 'Credit score',
    'rv-exceptions': 'V. Exceptions', 'rv-changes': 'Changes', 'rv-approval': 'VII. Approval',
    'rv-review': 'Review', 'rv-decision': 'Decision',
    'ds-readiness': 'Readiness', 'ds-highlights': 'Exception highlights', 'ds-policy': 'Policy check',
    'ds-recommendation': "Credit Officer's recommendation", 'ds-figures': 'Key figures', 'ds-score': 'Credit score',
    'ds-ci': 'IV. Credit checking', 'ds-exceptions': 'V. Exceptions', 'ds-decisions': 'Sign-offs and decisions',
    'ds-next': 'Where to act',
    'kyc-loan': 'Loan details', 'kyc-principalInfo': 'Principal borrower', 'kyc-principalAddress': 'Address',
    'kyc-principalEmployment': 'Employment', 'kyc-spouse': 'Spouse', 'kyc-coBorrowers': 'Co-borrowers',
    'kyc-mortgagor': 'Mortgagor / Attorney-in-Fact', 'kyc-obligations': 'Financial obligations',
    'kyc-references': 'Character references', 'kyc-collateral': 'Collateral & referral', 'kyc-documents': 'Documents',
};

const prefixOf = (topic) => topic.slice(0, topic.indexOf('-'));
const restOf = (topic) => topic.slice(topic.indexOf('-') + 1);

// "Financial Package · IV. Credit checking"
export const topicLabel = (topic) => {
    if (!topic || !TOPIC_RE.test(topic)) return null;
    const page = PAGES[prefixOf(topic)];
    const coBorrower = topic.match(/^kyc-coBorrower-(\d+)$/);
    const section = LABELS[topic] ?? (coBorrower ? `Co-borrower ${coBorrower[1]}` : restOf(topic).replace(/[-_]/g, ' '));
    return `${page.name} · ${section}`;
};

// Where the chip goes
export const topicTarget = (topic, applicationId) => {
    if (!topic || !TOPIC_RE.test(topic)) return null;
    const page = PAGES[prefixOf(topic)];
    return { pathname: page.path, path: `${page.path}?id=${applicationId}#${topic}`, label: topicLabel(topic) };
};

// THE rule for the comment button (commentButton.jsx renders nothing unless this is true):
//   staff roles only (an allow-list: an applicant, a signed-out visitor or an unknown role never passes),
//   only on a section with a known id, and only when a Messages drawer is on the page.
export const canCommentOn = ({ role, topic, panelOpenFor }) =>
    STAFF_ROLES.includes(role) && typeof topic === 'string' && TOPIC_RE.test(topic) && panelOpenFor != null;

// ---------- the page's Messages drawer, reachable from any comment button ----------
// One drawer per page (messagesPanel.jsx registers itself). Comment buttons ask it to open with a topic.
let panel = null;                 // { applicationId, open(topic) }
const listeners = new Set();

export const registerPanel = (applicationId, open) => {
    const mine = { applicationId, open };
    panel = mine;
    listeners.forEach((l) => l());
    return () => {
        if (panel === mine) panel = null;
        listeners.forEach((l) => l());
    };
};
export const subscribePanel = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};
export const panelApplicationId = () => panel?.applicationId ?? null;
export const openTopic = (topic) => panel?.open(topic);

// ---------- going to a section ----------
// Waits for the section to be on the page (pages load their data first), switches the Financial Package to the tab
// that holds it, scrolls to it and outlines it briefly.
let jumpTimer = 0;
export const jumpToTopic = (topic) => {
    if (!topic || !TOPIC_RE.test(topic)) return;
    clearInterval(jumpTimer);
    let tries = 0;
    let switched = false;
    jumpTimer = setInterval(() => {
        tries += 1;
        const el = document.getElementById(topic);
        if (!el) {
            if (tries > 50) clearInterval(jumpTimer);
            return;
        }
        const tabPanel = el.closest('[data-fp-page]');
        if (tabPanel?.hidden) {
            if (!switched) document.getElementById(`fp-tab-${tabPanel.dataset.fpPage}`)?.click();
            switched = true;
            if (tries > 50) clearInterval(jumpTimer);
            return;
        }
        clearInterval(jumpTimer);
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        // After a tab switch the Financial Package scrolls to its tabs first: go after that
        setTimeout(() => {
            el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
            el.animate?.([{ outline: '3px solid #1d4ed8', outlineOffset: '6px' }, { outline: '3px solid transparent', outlineOffset: '6px' }],
                { duration: 1800 });
        }, switched ? 450 : 0);
    }, 120);
};
