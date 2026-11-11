// Frame for every signed-in page (applicant and staff): navy sidebar (brand, role-specific nav, user, sign out) plus
// the page content, with the notification bell top right. Styled by applicantTheme.css (.ct-e).
import { BookOpen, FileText, Layers, LogOut, Plus, User, Users } from 'lucide-react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { UserAuth } from '../context/authContext';
import { homePathFor, ROLE_LABELS } from '../roles';
import NotificationBell from './notificationBell';

const linksFor = (role) => {
    if (role === 'APPLICANT') {
        return [['/applicantHomePage', 'My applications', FileText], ['/profilePage', 'My profile', User]];
    }
    return [
        ['/adminHomePage', 'Work tray', Layers],
        ['/policySearchPage', 'Policy search', BookOpen],
        ...(role === 'ACCOUNT_OFFICER' ? [['/accountOfficerApplicationInputPage', 'New application', Plus]] : []),
        ...(role === 'DEPT_HEAD' ? [['/staffAccountsPage', 'Staff accounts', Users]] : []),
        ['/staffProfilePage', 'My profile', User],
    ];
};

const initialsOf = (email) => (email ?? '?').split('@')[0].split(/[._-]/).filter(Boolean)
    .slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';

const AppLayout = ({ children }) => {
    const { session, role, signOut } = UserAuth();
    const navigate = useNavigate();
    const email = session?.user?.email;

    const handleSignOut = async () => {
        try {
            await signOut();
            navigate('/loginPage');
        } catch (err) {
            console.error(err);
        }
    };

    return (
        <div className="ct ct-e">
            <aside className="ct-side">
                <Link to={homePathFor(role)} className="ct-side-brand">
                    <span className="ct-side-mark" aria-hidden="true" />CATCH
                </Link>
                <nav aria-label="Main">
                    {linksFor(role).map(([to, label, Icon]) => (
                        <NavLink key={to} to={to}><Icon size={18} aria-hidden="true" /><span>{label}</span></NavLink>
                    ))}
                </nav>
                <div className="ct-side-user">
                    <div className="who">
                        <span className="ct-avatar" aria-hidden="true">{initialsOf(email)}</span>
                        <div>
                            <b title={email}>{email}</b>
                            <span>{ROLE_LABELS[role] ?? ''}</span>
                        </div>
                    </div>
                    <button type="button" onClick={handleSignOut}>
                        <LogOut size={16} aria-hidden="true" />Sign out
                    </button>
                </div>
            </aside>
            <div className="ct-e-body">
                <div className="ct-topbar"><NotificationBell /></div>
                <main className="ct-main">{children}</main>
            </div>
        </div>
    );
};

export default AppLayout;
