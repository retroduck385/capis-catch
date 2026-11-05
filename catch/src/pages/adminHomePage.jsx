import { UserAuth } from '../context/authContext';
import { ROLE_LABELS } from '../roles';
import WorkTray from './workTray/workTray';

// Home for all staff roles (AO, CI, Dispatch Admin, CO, Reviewer, Approver, Dept Head): the work tray.
// Sign out, profile and role-specific links live in the sidebar (components/appLayout.jsx).
const AdminHomePage = () => {
    const { session, role } = UserAuth();

    return (
        <div>
            <div className="ct-pagehead">
                <div>
                    <h1>Work tray</h1>
                    <p>{ROLE_LABELS[role] ?? role}, {session?.user?.email}</p>
                </div>
            </div>
            <WorkTray />
        </div>
    );
};

export default AdminHomePage;
