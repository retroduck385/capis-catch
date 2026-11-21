// Frame for every signed-in page (applicant and staff): a rounded blue top bar (brand, role-specific nav as a pill
// group, bell + profile chip) above the page content, so pages get the full width.
// The profile chip always shows the user's name and role; pressing it opens a menu card: who is signed in, View
// profile, a Dark mode switch (flips in place, the menu stays open), Sign out (which still asks first). Styled by applicantTheme.css (.ct-e).
import { BookOpen, Building2, ChevronDown, ChevronRight, FileText, Layers, LogOut, Moon, Plus, Sun, UserRound, Users } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
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

    const dialogRef = useRef(null);
    const [signingOut, setSigningOut] = useState(false);

    // Profile menu: closes on a click outside, on Escape (focus back on the chip) and after picking an item
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef(null);
    const menuBtnRef = useRef(null);
    useEffect(() => {
        if (!menuOpen) return undefined;
        const onDown = (e) => { if (!menuRef.current?.contains(e.target)) setMenuOpen(false); };
        const onKey = (e) => {
            if (e.key !== 'Escape') return;
            setMenuOpen(false);
            menuBtnRef.current?.focus();
        };
        document.addEventListener('pointerdown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('pointerdown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [menuOpen]);

    const openConfirm = () => dialogRef.current?.showModal();
    const closeConfirm = () => dialogRef.current?.close();

    const handleSignOut = async () => {
        setSigningOut(true);
        try {
            await signOut();
            navigate('/loginPage');
        } catch (err) {
            console.error(err);
            setSigningOut(false);
        }
    };

    return (
        <div className="ct ct-e ct-e-app" data-theme={theme}>
            <SkylineBackdrop />
            <header className={`ct-topnav${compact ? ' compact' : ''}`}>
                <Link to={homePathFor(role)} className="ct-topnav-brand">
                    <span className="ct-topnav-mark" aria-hidden="true"><Building2 size={16} /></span>
                    <span className="ct-topnav-word">CATCH</span>
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
                        {/* Profile chip: name and role always shown; opens the profile menu */}
                        <div ref={menuRef} className="ct-usermenu">
                            <button ref={menuBtnRef} type="button" className="ct-topnav-avatar" aria-haspopup="true"
                                aria-expanded={menuOpen} aria-controls="ct-usermenu-list" aria-label={`Account menu (${who})`}
                                onClick={() => setMenuOpen((o) => !o)}>
                                <span className="ct-avatar" aria-hidden="true">{initialsOf(staffName && displayName, email)}</span>
                                <span className="ct-usermenu-who" aria-hidden="true">
                                    <b>{displayName}</b>
                                    {roleLabel && <small>{roleLabel}</small>}
                                </span>
                                <ChevronDown size={16} className="ct-usermenu-chev" aria-hidden="true" />
                            </button>
                            {menuOpen && (
                                <div id="ct-usermenu-list" className="ct-usermenu-list">
                                    {/* Who is signed in */}
                                    <div className="ct-um-head">
                                        <span className="ct-avatar" aria-hidden="true">{initialsOf(staffName && displayName, email)}</span>
                                        <span className="ct-um-who">
                                            <b>{displayName}</b>
                                            {roleLabel && <span className="ct-um-role">{roleLabel}</span>}
                                            {email && email !== displayName && <small>{email}</small>}
                                        </span>
                                    </div>
                                    <div className="ct-um-group">
                                        <Link to={profilePath} className="ct-um-item" onClick={() => setMenuOpen(false)}>
                                            <span className="ct-um-ic" aria-hidden="true"><UserRound size={17} /></span>
                                            <span className="ct-um-label">View profile</span>
                                            <ChevronRight size={16} className="ct-um-go" aria-hidden="true" />
                                        </Link>
                                        {/* A switch: flips the theme in place and keeps the menu open */}
                                        <button type="button" role="switch" aria-checked={theme === 'dark'} className="ct-um-item"
                                            onClick={toggleTheme}>
                                            <span className="ct-um-ic" aria-hidden="true">
                                                {theme === 'dark' ? <Moon size={17} /> : <Sun size={17} />}
                                            </span>
                                            <span className="ct-um-label">Dark mode</span>
                                            <span className="ct-um-switch" aria-hidden="true"><span /></span>
                                        </button>
                                    </div>
                                    <div className="ct-um-group">
                                        <button type="button" className="ct-um-item danger" onClick={() => { setMenuOpen(false); openConfirm(); }}>
                                            <span className="ct-um-ic" aria-hidden="true"><LogOut size={17} /></span>
                                            <span className="ct-um-label">Sign out</span>
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </header>

            <dialog
                ref={dialogRef}
                className="ct-so-dialog"
                aria-labelledby="so-title"
                onClick={(e) => { if (e.target === e.currentTarget) closeConfirm(); }}>
                <div className="ct-so-header">
                    <span className="ct-so-icon" aria-hidden="true">
                        <LogOut size={22} />
                    </span>
                    <p className="ct-so-eyebrow">Session</p>
                </div>
                <div className="ct-so-body">
                    <h2 id="so-title" className="ct-so-title">Sign out?</h2>
                    <p className="ct-so-desc">You&rsquo;ll need to sign back in to access your work.</p>
                    <div className="ct-so-actions">
                        {/* autofocus Cancel — the safe option gets focus first */}
                        <button
                            type="button"
                            className="ct-so-cancel"
                            autoFocus
                            onClick={closeConfirm}>
                            Cancel
                        </button>
                        <button
                            type="button"
                            className="ct-so-confirm"
                            disabled={signingOut}
                            onClick={handleSignOut}>
                            {signingOut ? 'Signing out…' : 'Sign out'}
                        </button>
                    </div>
                </div>
            </dialog>
            <div className="ct-e-body">
                <main className="ct-main">{children}</main>
            </div>
        </div>
    );
};

export default AppLayout;
