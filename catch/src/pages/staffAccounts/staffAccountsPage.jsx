// Department Head: staff accounts (list, add) and a design placeholder for in-depth role editing.
// Approvers also get a position, which decides which approval authorities they're routed to
// (see src/pages/review/approval.js).
import { ListSkeleton } from '../../components/skeleton';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Plus, Search, X } from 'lucide-react';
import { ROLE_LABELS, STAFF_ROLES } from '../../roles';
import { APPROVAL_POSITIONS, positionLabel } from '../review/approval';
import { fetchStaffAccounts, setApprovalPosition } from './api';
import AddAccountDialog from './addAccountDialog';
import RoleAccessPreview from './roleAccessPreview';
import { ROLE_INFO, initialsOf } from './options';
import './staffAccounts.css';

const TABS = [['accounts', 'Accounts'], ['roles', 'Roles & access']];

const StaffAccountsPage = () => {
    const [accounts, setAccounts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [notice, setNotice] = useState(null);
    const [tab, setTab] = useState('accounts');
    const [adding, setAdding] = useState(false);
    const [search, setSearch] = useState('');
    const [roleFilter, setRoleFilter] = useState('ALL');
    const [focusRole, setFocusRole] = useState(null);

    const loadAccounts = () => fetchStaffAccounts()
        .then((rows) => { setAccounts(rows); setError(null); })
        .catch((err) => setError(err.message));

    useEffect(() => {
        loadAccounts().finally(() => setLoading(false));
    }, []);

    const handlePosition = async (account, position) => {
        if (!position) return;
        setError(null);
        setNotice(null);
        try {
            await setApprovalPosition(account.user_id, position);
            setNotice(`${account.email} is now ${positionLabel(position)}.`);
            await loadAccounts();
        } catch (err) {
            setError(err.message);
        }
    };

    const counts = useMemo(() => {
        const byRole = {};
        accounts.forEach((a) => { byRole[a.role] = (byRole[a.role] ?? 0) + 1; });
        return byRole;
    }, [accounts]);

    const visible = useMemo(() => {
        const q = search.trim().toLowerCase();
        return accounts.filter((a) => (roleFilter === 'ALL' || a.role === roleFilter)
            && (!q || [a.email, a.name].some((v) => v?.toLowerCase().includes(q))));
    }, [accounts, search, roleFilter]);

    const active = accounts.filter((a) => a.is_active).length;
    const pending = accounts.filter((a) => !a.name).length;

    const handleCreated = async (message) => {
        setNotice(message);
        await loadAccounts();
    };

    // From a role chip to that role's card in the placeholder tab
    const showRole = (role) => {
        setFocusRole(role);
        setTab('roles');
        requestAnimationFrame(() => document.getElementById(`sa-role-${role}`)?.scrollIntoView({ block: 'center' }));
    };

    return (
        <div className="sa">
            <div className="sa-head">
                <div>
                    <Link to="/adminHomePage" className="sa-back"><ArrowLeft size={16} aria-hidden="true" />Work tray</Link>
                    <h1>Staff accounts</h1>
                    <p className="sa-muted">Create logins for employees and choose the role they work under.</p>
                </div>
                <button type="button" className="sa-primary" onClick={() => setAdding(true)}>
                    <Plus size={18} aria-hidden="true" />Add account
                </button>
            </div>

            {notice && (
                <p className="sa-notice" role="status">
                    <CheckCircle2 size={18} aria-hidden="true" />
                    <span>{notice}</span>
                    <button type="button" className="icon" aria-label="Dismiss" onClick={() => setNotice(null)}>
                        <X size={16} aria-hidden="true" />
                    </button>
                </p>
            )}

            <div className="sa-tabs" role="tablist" aria-label="Staff accounts sections">
                {TABS.map(([key, label]) => (
                    <button key={key} type="button" role="tab" id={`sa-tab-${key}`} aria-selected={tab === key}
                        aria-controls={`sa-panel-${key}`} onClick={() => setTab(key)}>
                        {label}{key === 'accounts' && !loading && <span className="count">{accounts.length}</span>}
                    </button>
                ))}
            </div>

            {tab === 'accounts' ? (
                <div role="tabpanel" id="sa-panel-accounts" aria-labelledby="sa-tab-accounts" className="sa-panel">
                    <div className="sa-tiles">
                        <div className="sa-tile"><span className="lbl">Total accounts</span><span className="val">{accounts.length}</span></div>
                        <div className="sa-tile ok"><span className="lbl">Active</span><span className="val">{active}</span></div>
                        <div className={`sa-tile ${pending ? 'warn' : ''}`}>
                            <span className="lbl">Profile not completed</span><span className="val">{pending}</span>
                        </div>
                    </div>

                    <section className="sa-card" aria-label="Existing staff accounts">
                        <div className="sa-toolbar">
                            <div className="sa-search">
                                <Search size={16} aria-hidden="true" />
                                <input type="search" aria-label="Search by name or email" placeholder="Search by name or email"
                                    value={search} onChange={(e) => setSearch(e.target.value)} />
                            </div>
                            <select aria-label="Filter by role" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
                                <option value="ALL">All roles</option>
                                {STAFF_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                            </select>
                            <span className="sa-muted sa-count" aria-live="polite">
                                {visible.length} of {accounts.length}
                            </span>
                        </div>

                        {error && <p className="sa-error" role="alert">{error}</p>}

                        {loading ? <ListSkeleton label="Loading accounts" rows={5} /> : accounts.length === 0 ? (
                            <div className="sa-empty">
                                <p>No staff accounts yet.</p>
                                <button type="button" className="sa-primary" onClick={() => setAdding(true)}>
                                    <Plus size={18} aria-hidden="true" />Add the first account
                                </button>
                            </div>
                        ) : visible.length === 0 ? <p className="sa-empty">No accounts match these filters.</p> : (
                            <div className="sa-scroll">
                                <table>
                                    <thead>
                                        <tr><th>Employee</th><th>Role</th><th>Position</th><th>Status</th><th>Created</th></tr>
                                    </thead>
                                    <tbody>
                                        {visible.map((a) => (
                                            <tr key={a.user_id}>
                                                <td>
                                                    <div className="sa-person">
                                                        <span className="avatar" style={{ '--hue': ROLE_INFO[a.role]?.hue }} aria-hidden="true">
                                                            {initialsOf(a.name, a.email)}
                                                        </span>
                                                        <div>
                                                            <b>{a.name ?? 'Profile not completed'}</b>
                                                            <span>{a.email}</span>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td>
                                                    <button type="button" className="sa-rolechip" style={{ '--hue': ROLE_INFO[a.role]?.hue }}
                                                        title="See this role's access" onClick={() => showRole(a.role)}>
                                                        {ROLE_LABELS[a.role] ?? a.role}
                                                    </button>
                                                </td>
                                                <td>
                                                    {a.role === 'APPROVER' ? (
                                                        <select aria-label={`Position for ${a.email}`} value={a.approval_position ?? ''}
                                                            onChange={(e) => handlePosition(a, e.target.value)}>
                                                            <option value="">Not set (not routed)</option>
                                                            {APPROVAL_POSITIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                                                        </select>
                                                    ) : '—'}
                                                </td>
                                                <td>
                                                    <span className={`sa-status ${a.is_active ? 'ok' : 'off'}`}>
                                                        {a.is_active ? 'Active' : 'Inactive'}
                                                    </span>
                                                    {!a.name && <span className="sa-status warn">Profile pending</span>}
                                                </td>
                                                <td>{new Date(a.created_at).toLocaleDateString(undefined, { dateStyle: 'medium' })}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </section>
                </div>
            ) : (
                <div role="tabpanel" id="sa-panel-roles" aria-labelledby="sa-tab-roles" className="sa-panel">
                    <RoleAccessPreview focusRole={focusRole} counts={counts} />
                </div>
            )}

            <AddAccountDialog open={adding} onClose={() => setAdding(false)} onCreated={handleCreated} />
        </div>
    );
};

export default StaffAccountsPage;
