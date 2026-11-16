import { BadgeCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { UserAuth } from '../context/authContext';
import { ROLE_LABELS } from '../roles';
import { fetchStaffNames } from './loanFolder/api';
import WorkTray from './workTray/workTray';
import { greetingFor, nameWithoutRole } from './workTray/options';

// Home for all staff roles (AO, CI, Dispatch Admin, CO, Reviewer, Approver, Dept Head): the work tray.
// Header: a greeting with the first name (staff_name RPC), the "Work tray" title, the role as a small tag, and
// today's date. If a name already contains the role (some test accounts do), the role is not repeated in it.
// Sign out, profile, policy search and role-specific links live in the top bar (components/appLayout.jsx).
const AdminHomePage = () => {
    const { session, role } = UserAuth();
    const userId = session?.user?.id;
    const [name, setName] = useState(null);

    useEffect(() => {
        if (!userId) return;
        let cancelled = false;
        fetchStaffNames([userId])
            .then((names) => { if (!cancelled) setName(names[userId] || null); })
            .catch(() => { if (!cancelled) setName(null); });
        return () => { cancelled = true; };
    }, [userId]);

    const roleLabel = ROLE_LABELS[role] ?? role ?? '';
    const now = new Date();
    const firstName = nameWithoutRole(name, roleLabel).split(/\s+/)[0];
    const today = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    return (
        <div className="wt-page">
            <header className="wt-head">
                <div className="wt-head-main">
                    <p className="wt-greet">{greetingFor(now)}{firstName ? `, ${firstName}` : ''}</p>
                    <h1>Work tray</h1>
                    {roleLabel && (
                        <span className="wt-roletag"><BadgeCheck size={15} aria-hidden="true" />{roleLabel}</span>
                    )}
                </div>
                <time className="wt-date" dateTime={now.toISOString().slice(0, 10)}>{today}</time>
            </header>
            <WorkTray />
        </div>
    );
};

export default AdminHomePage;
