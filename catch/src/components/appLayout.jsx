// Frame for every signed-in page (applicant and staff): a rounded blue top bar (brand, role-specific nav as a pill
// group, bell + profile picture, sign out) above the page content, so pages get the full width.
// The profile picture and the sign-out door are compact; on hover or keyboard focus each slides open to show the
// user's name and role, or "Sign out". Styled by applicantTheme.css (.ct-e).
import { BookOpen, FileText, Layers, LogOut, Moon, Plus, Sun, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { UserAuth } from '../context/authContext';
import { fetchStaffNames } from '../pages/loanFolder/api';
import { nameWithoutRole } from '../pages/workTray/options';
import { homePathFor, ROLE_LABELS } from '../roles';
import NotificationBell from './notificationBell';
import SkylineBackdrop from './skylineBackdrop';

const linksFor = (role) => {
    if (role === 'APPLICANT') {
        return [['/applicantHomePage', 'My applications', FileText]];
    }
    // No "My profile" link: the profile picture at the right of the bar opens it
    return [
        ['/adminHomePage', 'Work tray', Layers],
        ['/policySearchPage', 'Policy search', BookOpen],
        ...(role === 'ACCOUNT_OFFICER' ? [['/accountOfficerApplicationInputPage', 'New application', Plus]] : []),
        ...(role === 'DEPT_HEAD' ? [['/staffAccountsPage', 'Staff accounts', Users]] : []),
    ];
};

const THEME_KEY = 'catch-theme';
const readTheme = () => {
    try { return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'; } catch { return 'light'; }
};

// Two initials: from the name when there is one, otherwise from the email
const initialsOf = (name, email) => {
    const parts = name ? name.split(/\s+/) : (email ?? '?').split('@')[0].split(/[._-]/);
    return parts.filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';
};

const AppLayout = ({ children }) => {
    const { session, role, signOut } = UserAuth();
    const navigate = useNavigate();
    const email = session?.user?.email;
    const userId = session?.user?.id;
    const roleLabel = ROLE_LABELS[role] ?? '';
    const profilePath = role === 'APPLICANT' ? '/profilePage' : '/staffProfilePage';
    const [staffName, setStaffName] = useState(null);
    const [compact, setCompact] = useState(false);
    const [theme, setTheme] = useState(readTheme);

    // Opt-in dark mode (light stays the default, per earlier meeting feedback); remembered in this browser
    const toggleTheme = () => {
        const next = theme === 'dark' ? 'light' : 'dark';
        setTheme(next);
        try { localStorage.setItem(THEME_KEY, next); } catch { /* storage blocked: keep it for this visit */ }
    };

    // Past ~80px of scroll the bar collapses to the logo (CSS .compact); hover / focus opens it again.
    // Checked once per frame at most.
    useEffect(() => {
        let raf = 0;
        const onScroll = () => {
            if (raf) return;
            raf = requestAnimationFrame(() => { raf = 0; setCompact(window.scrollY > 80); });
        };
        onScroll();
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
    }, []);

    // Staff name for the profile chip (staff_name RPC); applicants show their email
    useEffect(() => {
        if (!userId || !role || role === 'APPLICANT') return undefined;
        let cancelled = false;
        fetchStaffNames([userId])
            .then((names) => { if (!cancelled) setStaffName(names[userId] || null); })
            .catch(() => { if (!cancelled) setStaffName(null); });
        return () => { cancelled = true; };
    }, [userId, role]);

    const displayName = nameWithoutRole(staffName, roleLabel) || email || '';
    const who = [displayName, roleLabel].filter(Boolean).join(' · ');

    const handleSignOut = async () => {
        try {
            await signOut();
            navigate('/loginPage');
        } catch (err) {
            console.error(err);
        }
    };

    return (
        <div className="ct ct-e ct-e-app" data-theme={theme}>
            <SkylineBackdrop />
            <header className={`ct-topnav${compact ? ' compact' : ''}`}>
                <Link to={homePathFor(role)} className="ct-topnav-brand">
                    <span className="ct-topnav-mark" aria-hidden="true" /><span className="ct-topnav-word">CATCH</span>
                </Link>
                {/* Icon-first links: the label slides out on hover / focus (the current page too; its white pill
                    marks it).
                    The label stays in the accessibility tree (only faded), so every link keeps its name. */}
                <nav aria-label="Main">
                    {linksFor(role).map(([to, label, Icon]) => (
                        <NavLink key={to} to={to} className="ct-expand">
                            <Icon size={18} aria-hidden="true" />
                            <span className="ct-expand-text"><span>{label}</span></span>
                        </NavLink>
                    ))}
                </nav>
                <div className="ct-topnav-end">
                    <div className="ct-topnav-user">
                        <NotificationBell onDark />
                        <span className="ct-topnav-divider" aria-hidden="true" />
                        {/* Profile picture: slides open on hover / focus to show name and role */}
                        <Link to={profilePath} className="ct-topnav-avatar ct-expand" aria-label={`My profile (${who})`}>
                            <span className="ct-avatar" aria-hidden="true">{initialsOf(staffName && displayName, email)}</span>
                            <span className="ct-expand-text" aria-hidden="true">
                                <span>
                                    <b>{displayName}</b>
                                    {roleLabel && <small>{roleLabel}</small>}
                                </span>
                            </span>
                        </Link>
                    </div>
                    {/* Sign out: the door icon, sliding open to "Sign out" on hover / focus */}
                    {/* Theme switch: moon / sun, sliding open to its label like the others */}
                    <button
                        type="button"
                        className="ct-themebtn ct-expand"
                        onClick={toggleTheme}
                        aria-pressed={theme === 'dark'}
                        aria-label="Dark mode">
                        {theme === 'dark' ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
                        <span className="ct-expand-text" aria-hidden="true">
                            <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
                        </span>
                    </button>
                    <button type="button" className="ct-signout ct-expand" onClick={handleSignOut} aria-label="Sign out">
                        <LogOut size={18} aria-hidden="true" />
                        <span className="ct-expand-text" aria-hidden="true"><span>Sign out</span></span>
                    </button>
                </div>
            </header>
            <div className="ct-e-body">
                <main className="ct-main">{children}</main>
            </div>
        </div>
    );
};

export default AppLayout;
