// Policy search: its own tab in the staff sidebar (components/appLayout.jsx). Any staff member asks a question and gets
// the most relevant passages of the bank's policy manuals and the housing RAAC, quoted with their source.
import { UserAuth } from '../../context/authContext';
import { ROLE_LABELS } from '../../roles';
import PolicyAsk from './policyAsk';

const PolicySearchPage = () => {
    const { session, role } = UserAuth();

    return (
        <div className="wt-page">
            <div className="ct-pagehead">
                <div>
                    <h1>Policy search</h1>
                    <p>{ROLE_LABELS[role] ?? role} · {session?.user?.email}</p>
                </div>
            </div>
            <PolicyAsk />
        </div>
    );
};

export default PolicySearchPage;
