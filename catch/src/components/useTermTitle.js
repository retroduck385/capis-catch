// For buttons, links and form labels, where a hover (components/term.jsx) can't be nested: a plain title attribute
// explaining the known terms in a text. Staff only: for an applicant it is always undefined (no title).
//   const tt = useTermTitle();
//   <button title={tt('Beyond TAT')}>Beyond TAT</button>
import { UserAuth } from '../context/authContext';
import { termsTitle } from '../glossary';
import { STAFF_ROLES } from '../roles';

export const useTermTitle = () => {
    const role = UserAuth()?.role;
    const staff = STAFF_ROLES.includes(role);
    return (text) => (staff ? termsTitle(text) : undefined);
};
