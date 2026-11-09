import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserAuth } from '../../context/authContext';
import { ASSIGNABLE_ROLES, ASSIGNING_HEADS, REVIEW_ROLES } from '../../roles';
import { EMPLOYMENT_TYPES } from '../applicationForm/options';
import { fetchStaffNames } from '../loanFolder/api';
import { fetchActiveReviewAssignments, fetchSignoffs } from '../review/api';
import { assignApplication, fetchAssignableStaff, fetchWorkTray, unassignApplication } from './api';
import {
    SLOT_LABELS, STAGES, STAGE_STATUS_LABELS, STATUS_TONES, TAT_LABELS, TAT_TONES, stageLabel,
} from './options';
import { folderPath } from './paths';
import { clearTrails } from '../../components/trailStore';
import './workTray.css';

const employmentLabel = (type) => EMPLOYMENT_TYPES.find((t) => t.value === type)?.label ?? '';

const SLOT_ID = { ACCOUNT_OFFICER: 'ao_id', CREDIT_OFFICER: 'co_id' };
const SLOT_NAME = { ACCOUNT_OFFICER: 'ao_name', CREDIT_OFFICER: 'co_name' };

const peso = (n) => `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

// Tray rows + who each application is routed to for review / approval (VII. Approval):
// routing = { [application_id]: [{ id, assignee_role, user_id, seq, signedOff }] }, names = { [user_id]: name }
const fetchTray = async () => {
    const [rows, review, signoffs] = await Promise.all([fetchWorkTray(), fetchActiveReviewAssignments(), fetchSignoffs()]);
    const names = await fetchStaffNames(review.map((r) => r.user_id));
    const signed = new Set(signoffs.map((s) => s.assignment_id));
    const routing = {};
    review.forEach((r) => { (routing[r.application_id] ??= []).push({ ...r, signedOff: signed.has(r.id) }); });
    return { rows, routing, names };
};

const isRoutedTo = (routing, row, userId) => (routing[row.application_id] ?? []).some((x) => x.user_id === userId);

// The reviewer whose turn it is (mirrors current_review_assignment()); only while the application is in Review
const isMyReviewTurn = (routing, row, userId) => row.stage === 'REVIEW'
    && (routing[row.application_id] ?? []).filter((x) => x.assignee_role === 'REVIEWER' && !x.signedOff)
        .sort((a, b) => a.seq - b.seq)[0]?.user_id === userId;


const SLOT_FULL_LABELS = { ACCOUNT_OFFICER: 'Account Officer', CREDIT_OFFICER: 'Credit Officer' };

// One AO or CO line in the "Assigned to" column: read-only text. AOs / COs get Assign me / Release for their
// own slot; the heads change people in the Manage dialog instead.
const AssigneeLine = ({ row, slotRole, myId, myRole, isHead, busy, onAssign, onUnassign }) => {
    const assigneeId = row[SLOT_ID[slotRole]];
    const assigneeName = row[SLOT_NAME[slotRole]];
    const isMine = assigneeId === myId;
    const name = isMine ? 'You' : assigneeName ?? 'Unknown';

    return (
        <div className='wt-slot'>
            <span className='wt-slotlabel'>{SLOT_LABELS[slotRole]}</span>
            {assigneeId
                ? <span className='wt-person' title={name}>{name}</span>
                : <span className='wt-unassigned'>Unassigned</span>}
            {!isHead && myRole === slotRole && !assigneeId && (
                <button className='wt-mini take' disabled={busy} onClick={() => onAssign(row.application_id, slotRole)}>
                    Assign me
                </button>
            )}
            {!isHead && isMine && (
                <button className='wt-mini drop' disabled={busy} onClick={() => onUnassign(row.application_id, slotRole)}>
                    Release
                </button>
            )}
        </div>
    );
};

// Heads change the AO / CO of one application here, so the table itself stays free of dropdowns.
const ManageDialog = ({ row, staff, busy, error, onAssign, onUnassign, onClose }) => {
    const ref = useRef(null);

    useEffect(() => {
        const dialog = ref.current;
        if (row && dialog && !dialog.open) dialog.showModal();
        if (!row && dialog?.open) dialog.close();
    }, [row]);

    return (
        <dialog
            ref={ref}
            className='wt-dialog'
            aria-labelledby='wt-dialog-title'
            onClose={onClose}
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            {row && (
                <div className='wt-dialog-body'>
                    <h2 id='wt-dialog-title'>Assign people</h2>
                    <p className='wt-sub'>{row.application_no} · {row.applicant_name ?? 'Applicant'}</p>
                    {ASSIGNABLE_ROLES.map((slotRole) => {
                        const assigneeId = row[SLOT_ID[slotRole]];
                        const label = SLOT_FULL_LABELS[slotRole];
                        return (
                            <div key={slotRole} className='wt-field'>
                                <label htmlFor={`wt-pick-${slotRole}`}>{label}</label>
                                <div className='wt-field-row'>
                                    <select
                                        id={`wt-pick-${slotRole}`}
                                        disabled={busy}
                                        value={assigneeId ?? ''}
                                        onChange={(e) => e.target.value
                                            && onAssign(row.application_id, slotRole, e.target.value)}>
                                        <option value=''>{assigneeId ? 'Reassign to...' : `Choose ${label}...`}</option>
                                        {staff.filter((s) => s.role === slotRole).map((s) => (
                                            <option key={s.user_id} value={s.user_id}>{s.name}</option>
                                        ))}
                                    </select>
                                    {assigneeId && (
                                        <button
                                            type='button'
                                            disabled={busy}
                                            onClick={() => onUnassign(row.application_id, slotRole)}>
                                            Unassign
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                    {error && <p className='wt-error-inline' role='alert'>{error}</p>}
                    <div className='wt-dialog-actions'>
                        <button type='button' onClick={onClose}>Done</button>
                    </div>
                </div>
            )}
        </dialog>
    );
};

// Reviewers (in order) and approvers the CO picked in VII. Approval; changed on that page, not here
const ReviewSlots = ({ routing, names, myId }) => {
    const nameOf = (x) => (x.user_id === myId ? 'You' : names[x.user_id] ?? 'Unknown');
    const reviewers = routing.filter((x) => x.assignee_role === 'REVIEWER');
    const approvers = routing.filter((x) => x.assignee_role === 'APPROVER');
    if (!reviewers.length && !approvers.length) return null;
    return (
        <div className='wt-review'>
            {reviewers.length > 0 && <div>Reviewers: <b>{reviewers.map((x) => `${x.seq}. ${nameOf(x)}${x.signedOff ? ' (signed off)' : ''}`).join(', ')}</b></div>}
            {approvers.length > 0 && <div>Approvers: <b>{approvers.map(nameOf).join(', ')}</b></div>}
        </div>
    );
};

// Time in the current stage against its TAT: a coloured chip, a progress bar and the days over
const TatCell = ({ row }) => {
    if (row.tat_days == null) return <span className='wt-dim'>-</span>;
    const days = Number(row.days_in_stage);
    const limit = Number(row.tat_days);
    const pct = limit > 0 ? Math.min(100, Math.round((days / limit) * 100)) : 100;
    const over = days - limit;
    const detail = over > 0 ? `${days}d / ${limit}d (${over.toFixed(1)}d over)` : `${days}d / ${limit}d`;
    return (
        <div className={`wt-tat ${TAT_TONES[row.tat_state] ?? 'plain'}`} title={detail}>
            <div className='wt-tat-top'>
                <span className='wt-chip'>{TAT_LABELS[row.tat_state]}</span>
                <span>{days}d / {limit}d</span>
            </div>
            <div className='wt-bar' role='img' aria-label={`${pct}% of the turnaround time used`}>
                <span style={{ width: `${pct}%` }} />
            </div>
        </div>
    );
};

const SummaryTile = ({ icon, label, value, tone, active, onClick }) => (
    <button type='button' className={`wt-tile ${tone}`} aria-pressed={active} onClick={onClick}>
        <span className='ic' aria-hidden='true'><svg viewBox='0 0 24 24'>{icon}</svg></span>
        <span className='val'>{value}</span>
        <span className='lbl'>{label}</span>
    </button>
);

// Donut geometry for the turnaround-time ring (SVG circles drawn as dash segments)
const DONUT_R = 42;
const DONUT_C = 2 * Math.PI * DONUT_R;
// Every submitted application, FIFO by submission. AOs and COs can open all of them (view only until
// they're assigned).
const WorkTray = () => {
    useEffect(() => { clearTrails(); }, []); // a row opened from here starts a fresh breadcrumb trail
    const { session, role } = UserAuth();
    const myId = session?.user?.id;
    const isHead = ASSIGNING_HEADS.includes(role);
    const isAssignable = ASSIGNABLE_ROLES.includes(role);
    const navigate = useNavigate();
    const [tray, setTray] = useState({ rows: [], routing: {}, names: {} });
    const { rows, routing, names } = tray;

    const [staff, setStaff] = useState([]);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState(null);
    const [error, setError] = useState(null);
    const [loadedAt, setLoadedAt] = useState(null);
    const [managingId, setManagingId] = useState(null);   // application whose AO / CO the head is changing

    // Reviewers / approvers start on what's routed to them
    const defaultAssignment = REVIEW_ROLES.includes(role) ? 'MINE' : 'ALL'; // ALL / MINE / UNASSIGNED
    const [search, setSearch] = useState('');
    const [tat, setTat] = useState('ALL');           // ALL / NEAR / BEYOND
    const [assignment, setAssignment] = useState(defaultAssignment);
    const [stage, setStage] = useState('OPEN');      // OPEN = everything not yet decided

    // Refresh after an action or on the Refresh button
    const load = async () => {
        try {
            setError(null);
            setTray(await fetchTray());
            setLoadedAt(new Date());
        } catch (err) {
            setError(err.message);
        }
    };

    useEffect(() => {
        fetchTray()
            .then((t) => { setTray(t); setLoadedAt(new Date()); })
            .catch((err) => setError(err.message))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        if (!isHead) return;
        fetchAssignableStaff().then(setStaff).catch((err) => setError(err.message));
    }, [isHead]);

    const runAction = async (applicationId, action) => {
        setBusyId(applicationId);
        try {
            setError(null);
            await action();
            await load();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusyId(null);
        }
    };

    const handleAssign = (applicationId, slotRole, userId) =>
        runAction(applicationId, () => assignApplication(applicationId, slotRole, userId));
    const handleUnassign = (applicationId, slotRole) =>
        runAction(applicationId, () => unassignApplication(applicationId, slotRole));

    // "Unassigned" = your own slot is empty (AO/CO), or any slot is empty (everyone else)
    const isUnassigned = useCallback((r) => (isAssignable
        ? !r[SLOT_ID[role]]
        : !r.ao_id || !r.co_id), [isAssignable, role]);
    const isMine = useCallback((r) => r.ao_id === myId || r.co_id === myId || isRoutedTo(routing, r, myId),
        [routing, myId]);

    // FIFO position by submission order (rows come back sorted)
    const fifo = useMemo(() => new Map(rows.map((r, i) => [r.application_id, i + 1])), [rows]);

    // ---- dashboard numbers, always over everything the user can see (not the filtered list) ----
    const stats = useMemo(() => {
        const open = rows.filter((r) => r.stage !== 'DECIDED');
        const byTat = { ON_TRACK: 0, NEAR: 0, BEYOND: 0 };
        open.forEach((r) => { if (r.tat_state in byTat) byTat[r.tat_state] += 1; });
        const byStage = Object.fromEntries(STAGES.map((s) => [s.value, 0]));
        rows.forEach((r) => { if (r.stage in byStage) byStage[r.stage] += 1; });
        const timed = open.filter((r) => r.tat_days != null);
        return {
            open: open.length,
            byTat,
            timed: timed.length,
            byStage,
            unassigned: open.filter(isUnassigned).length,
            mine: open.filter(isMine).length,
        };
    }, [rows, isUnassigned, isMine]);

    const visible = useMemo(() => {
        const q = search.trim().toLowerCase();
        return rows.filter((r) =>
            (stage === 'OPEN' ? r.stage !== 'DECIDED' : stage === 'ALL' || r.stage === stage)
            && (tat === 'ALL' || r.tat_state === tat)
            && (assignment === 'ALL'
                || (assignment === 'MINE' && isMine(r))
                || (assignment === 'UNASSIGNED' && isUnassigned(r)))
            && (!q || [r.application_no, r.applicant_name].some((v) => v?.toLowerCase().includes(q))));
    }, [rows, search, tat, assignment, stage, isMine, isUnassigned]);

    const filtersActive = search || tat !== 'ALL' || assignment !== defaultAssignment || stage !== 'OPEN';
    const clearFilters = () => { setSearch(''); setTat('ALL'); setAssignment(defaultAssignment); setStage('OPEN'); };

    // Tiles toggle their filter on and off
    const toggleTat = (value) => setTat((cur) => (cur === value ? 'ALL' : value));
    const toggleAssignment = (value) => setAssignment((cur) => (cur === value ? 'ALL' : value));

    const managingRow = managingId == null ? null : rows.find((r) => r.application_id === managingId) ?? null;

    if (loading) return <p>Loading work tray...</p>;

    const { byTat } = stats;
    const maxStage = Math.max(1, ...STAGES.map((s) => stats.byStage[s.value]));
    // Ring segments in on track -> near -> beyond order, with a small gap between them
    const donut = (() => {
        if (stats.timed === 0) return [];
        const parts = [['ok', byTat.ON_TRACK], ['warn', byTat.NEAR], ['bad', byTat.BEYOND]].filter(([, n]) => n > 0);
        const gap = parts.length > 1 ? 3 : 0;
        let start = 0;
        return parts.map(([toneName, n]) => {
            const full = (n / stats.timed) * DONUT_C;
            const seg = { tone: toneName, start, len: Math.max(0, full - gap) };
            start += full;
            return seg;
        });
    })();

    return (
        <div className='wt'>
            {/* ---------- dashboard: TAT donut, stage columns, two focus KPIs ---------- */}
            <section className='wt-dash' aria-label='Overview'>
                <article className='wt-card wt-widget'>
                    <h2 className='wt-wtitle'>Turnaround time</h2>
                    <div className='wt-donutrow'>
                        <div className='wt-donut'>
                            <svg
                                viewBox='0 0 100 100'
                                role='img'
                                aria-label={`${byTat.ON_TRACK} on track, ${byTat.NEAR} near TAT, ${byTat.BEYOND} beyond TAT`}>
                                <circle className='ring' cx='50' cy='50' r={DONUT_R} />
                                {donut.map((seg) => (
                                    <circle
                                        key={seg.tone}
                                        className={`seg ${seg.tone}`}
                                        cx='50' cy='50' r={DONUT_R}
                                        strokeDasharray={`${seg.len} ${DONUT_C - seg.len}`}
                                        strokeDashoffset={-seg.start} />
                                ))}
                            </svg>
                            <div className='mid'>
                                <b>{stats.open}</b>
                                <span>open</span>
                            </div>
                        </div>
                        <ul className='wt-keys'>
                            <li>
                                <button
                                    type='button' className={`wt-key bad${byTat.BEYOND ? '' : ' zero'}`}
                                    aria-pressed={tat === 'BEYOND'} onClick={() => toggleTat('BEYOND')}>
                                    <i />Beyond TAT <b>{byTat.BEYOND}</b>
                                </button>
                            </li>
                            <li>
                                <button
                                    type='button' className={`wt-key warn${byTat.NEAR ? '' : ' zero'}`}
                                    aria-pressed={tat === 'NEAR'} onClick={() => toggleTat('NEAR')}>
                                    <i />Near TAT <b>{byTat.NEAR}</b>
                                </button>
                            </li>
                            <li>
                                <span className={`wt-key ok static${byTat.ON_TRACK ? '' : ' zero'}`}>
                                    <i />On track <b>{byTat.ON_TRACK}</b>
                                </span>
                            </li>
                        </ul>
                    </div>
                </article>

                <article className='wt-card wt-widget'>
                    <h2 className='wt-wtitle'>Pipeline</h2>
                    <div className='wt-cols' role='group' aria-label='Filter by stage'>
                        {STAGES.map((s) => {
                            const count = stats.byStage[s.value];
                            const pressed = stage === s.value;
                            return (
                                <button
                                    key={s.value}
                                    type='button'
                                    className={`wt-col${s.value === 'DECIDED' ? ' done' : ''}`}
                                    aria-pressed={pressed}
                                    onClick={() => setStage(pressed ? 'OPEN' : s.value)}>
                                    <span className='num'>{count}</span>
                                    <span className='well'>
                                        <span className='fill' style={{ transform: `scaleY(${count / maxStage})` }} />
                                    </span>
                                    <span className='name'>{s.label}</span>
                                </button>
                            );
                        })}
                    </div>
                </article>

                <div className='wt-kpis'>
                    <SummaryTile
                        icon={<path d='M12 9v4m0 4h.01M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z' />}
                        label='Unassigned' value={stats.unassigned} tone={stats.unassigned ? 'warn' : 'ok'}
                        active={assignment === 'UNASSIGNED'} onClick={() => toggleAssignment('UNASSIGNED')} />
                    <SummaryTile
                        icon={<path d='M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm9 2 2 2 4-4' />}
                        label={REVIEW_ROLES.includes(role) ? 'For my review' : 'Assigned to me'} value={stats.mine} tone='info'
                        active={assignment === 'MINE'} onClick={() => toggleAssignment('MINE')} />
                </div>
            </section>

            {/* ---------- table ---------- */}
            <section className='wt-card' aria-label='Applications'>
                <div className='wt-toolbar'>
                    <div className='wt-search'>
                        <input
                            type='search'
                            aria-label='Search reference or applicant'
                            placeholder='Search by reference or name'
                            value={search}
                            onChange={(e) => setSearch(e.target.value)} />
                    </div>
                    <select aria-label='TAT filter' value={tat} onChange={(e) => setTat(e.target.value)}>
                        <option value='ALL'>All TAT</option>
                        <option value='NEAR'>Near TAT</option>
                        <option value='BEYOND'>Beyond TAT</option>
                    </select>
                    <select aria-label='Assignment filter' value={assignment} onChange={(e) => setAssignment(e.target.value)}>
                        <option value='ALL'>All applications</option>
                        <option value='MINE'>Assigned to me</option>
                        <option value='UNASSIGNED'>Unassigned</option>
                    </select>
                    <select aria-label='Stage filter' value={stage} onChange={(e) => setStage(e.target.value)}>
                        <option value='OPEN'>All open stages</option>
                        <option value='ALL'>All stages incl. decided</option>
                        {STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                    {filtersActive && <button type='button' onClick={clearFilters}>Clear filters</button>}
                    <span className='spacer' />
                    {loadedAt && <small>Updated {loadedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>}
                    <button type='button' onClick={load}>Refresh</button>
                </div>

                <p className='wt-count' aria-live='polite'>
                    Showing <b>{visible.length}</b> of {rows.length} applications · first in, first out by submission
                </p>

                {error && <p className='wt-error' role='alert'>{error}</p>}

                <div className='wt-scroll'>
                    <table>
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>Application</th>
                                <th>Stage</th>
                                <th className='wt-amt'>Amount</th>
                                <th>TAT position</th>
                                <th>Assigned to</th>
                            </tr>
                        </thead>
                        <tbody>
                            {visible.length === 0 && (
                                <tr><td colSpan={6} className='wt-empty'>No applications match these filters.</td></tr>
                            )}
                            {visible.map((r) => {
                                const routedToMe = isRoutedTo(routing, r, myId);
                                const path = folderPath(role, r, routedToMe);
                                const tatTone = r.stage === 'DECIDED' ? '' : TAT_TONES[r.tat_state] ?? '';
                                const mine = isMine(r);
                                return (
                                    // The whole row opens the loan folder when you have access
                                    <tr
                                        key={r.application_id}
                                        tabIndex={r.can_open ? 0 : undefined}
                                        onClick={r.can_open ? () => navigate(path) : undefined}
                                        onKeyDown={r.can_open ? (e) => e.key === 'Enter' && e.target === e.currentTarget
                                            && navigate(path) : undefined}
                                        className={[
                                            'wt-row', tatTone,
                                            r.can_open ? 'clickable' : 'locked',
                                            mine ? 'mine' : '',
                                        ].join(' ')}>
                                        <td className='wt-fifo'>{fifo.get(r.application_id)}</td>
                                        <td>
                                            <div className='wt-refline'>
                                                <span className='wt-ref'>{r.application_no}</span>
                                                {!r.can_open && <span className='wt-chip plain nodot'>Locked</span>}
                                                {r.can_open && isAssignable && r[SLOT_ID[role]] !== myId
                                                    && <span className='wt-chip plain nodot'>View only</span>}
                                                {routedToMe && (
                                                    <span className='wt-chip info nodot'>
                                                        Yours: {role === 'APPROVER' ? 'approval' : 'review'}
                                                    </span>
                                                )}
                                                {isMyReviewTurn(routing, r, myId)
                                                    && <span className='wt-chip info nodot'>Your turn to review</span>}
                                            </div>
                                            <span className='wt-name'>{r.applicant_name ?? '-'}</span>
                                            <span className='wt-sub'>
                                                {[employmentLabel(r.employment_type), r.branch].filter(Boolean).join(' · ')}
                                            </span>
                                        </td>
                                        <td>
                                            <div className='wt-stagecell'>
                                                <span>{stageLabel(r.stage)}</span>
                                                {STAGE_STATUS_LABELS[r.stage_status] && (
                                                    <span className={`wt-chip ${STATUS_TONES[r.stage_status] ?? 'plain'}`}>
                                                        {STAGE_STATUS_LABELS[r.stage_status]}
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className='wt-amt'>{r.loan_amount != null ? peso(r.loan_amount) : '-'}</td>
                                        <td><TatCell row={r} /></td>
                                        {/* Assign / release controls: don't open the folder when using them */}
                                        <td onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                                            <div className='wt-slots'>
                                                {ASSIGNABLE_ROLES.map((slotRole) => (
                                                    <AssigneeLine
                                                        key={slotRole}
                                                        row={r}
                                                        slotRole={slotRole}
                                                        myId={myId}
                                                        myRole={role}
                                                        isHead={isHead}
                                                        busy={busyId === r.application_id}
                                                        onAssign={handleAssign}
                                                        onUnassign={handleUnassign} />
                                                ))}
                                                <ReviewSlots routing={routing[r.application_id] ?? []} names={names} myId={myId} />
                                                {isHead && (
                                                    <button
                                                        type='button'
                                                        className='wt-mini manage'
                                                        aria-label={`Manage assignment for ${r.application_no}`}
                                                        onClick={() => setManagingId(r.application_id)}>
                                                        Manage
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </section>

            {isHead && (
                <ManageDialog
                    row={managingRow}
                    staff={staff}
                    busy={managingRow ? busyId === managingRow.application_id : false}
                    error={error}
                    onAssign={handleAssign}
                    onUnassign={handleUnassign}
                    onClose={() => setManagingId(null)} />
            )}
        </div>
    );
};

export default WorkTray;