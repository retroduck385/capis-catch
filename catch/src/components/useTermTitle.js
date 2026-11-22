// For buttons, links and form labels, where a hover (components/term.jsx) can't be nested: a plain title attribute
// explaining the known terms in a text. Staff get every term; an applicant only APPLICANT_TERMS (glossary.js).
//   const tt = useTermTitle();
//   <button title={tt('Beyond TAT')}>Beyond TAT</button>
import { UserAuth } from '../context/authContext';
import { APPLICANT_TERMS, termsTitle } from '../glossary';
import { STAFF_ROLES } from '../roles';

export const useTermTitle = () => {
    const role = UserAuth()?.role;
    if (STAFF_ROLES.includes(role)) return (text) => termsTitle(text);
    if (role === 'APPLICANT') return (text) => termsTitle(text, (k) => APPLICANT_TERMS.has(k));
    return () => undefined;
};
