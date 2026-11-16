import {
    Check, CheckCheck, ChevronRight, Eye, Hourglass, Lock, Play, RefreshCw, Send, Settings2, Undo2, UserMinus, UserPlus, X,
} from 'lucide-react';
import { WorkTraySkeleton } from '../../components/skeleton';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserAuth } from '../../context/authContext';
import { ASSIGNABLE_ROLES, ASSIGNING_HEADS, REVIEW_ROLES } from '../../roles';
import { EMPLOYMENT_TYPES, formatPeso } from '../applicationForm/options';
import { fetchStaffNames } from '../loanFolder/api';
import { fetchActiveReviewAssignments, fetchSignoffs } from '../review/api';
import { assignApplication, fetchAssignableStaff, fetchWorkTray, unassignApplication } from './api';
import {
    AVATAR_TONES, SLOT_LABELS, STAGES, STAGE_COLORS, STAGE_STATUS_LABELS, STATUS_TONES, TAT_LABELS, TAT_TONES, stageLabel,
} from './options';
import { folderPath } from './paths';
import { clearTrails } from '../../components/trailStore';
import FilterSelect from './filterSelect';
import { useCountUp } from './useCountUp';
import './workTray.css';

// Toolbar filter choices
const TAT_FILTERS = [
    { value: 'ALL', label: 'All TAT' }, { value: 'NEAR', label: 'Near TAT' }, { value: 'BEYOND', label: 'Beyond TAT' },
];
const ASSIGNMENT_FILTERS = [
    { value: 'ALL', label: 'All applications' }, { value: 'MINE', label: 'Assigned to me' },
    { value: 'UNASSIGNED', label: 'Unassigned' },
];
const STAGE_FILTERS = [
    { value: 'OPEN', label: 'Open stages' }, { value: 'ALL', label: 'All stages' },
    ...STAGES.map((s) => ({ value: s.value, label: s.label })),
];

const employmentLabel = (type) => EMPLOYMENT_TYPES.find((t) => t.value === type)?.label ?? '';

const SLOT_ID = { ACCOUNT_OFFICER: 'ao_id', CREDIT_OFFICER: 'co_id' };
const SLOT_NAME = { ACCOUNT_OFFICER: 'ao_name', CREDIT_OFFICER: 'co_name' };

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

// Stage status as a small icon + word (no pill)
const STATUS_ICONS = { PENDING: Hourglass, IN_PROGRESS: Play, REQUESTED: Send, RETURNED: Undo2, DONE: Check };

const initialsOf = (name) => (name ?? '').split(/\s+/).filter(Boolean).slice(0, 2)
    .map((p) => p[0].toUpperCase()).join('') || '?';

// Same name -> same colour on every row
const toneOf = (name) => {
    let h = 0;
    for (const ch of name ?? '') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const [bg, fg] = AVATAR_TONES[h % AVATAR_TONES.length];
    return { background: bg, color: fg };
};

// One person as an initials circle in their colour; the name is in the tooltip. "You" is filled blue; a
// signed-off reviewer gets a tick.
const Avatar = ({ name, you = false, signed = false }) => (
    <span
        className={['wt-av', you ? 'you' : '', signed ? 'signed' : ''].join(' ')}
        style={you ? undefined : toneOf(name)}
        title={name}
        aria-hidden='true'>
        {initialsOf(name)}
        {signed && <Check className='tick' size={9} strokeWidth={3.5} />}
    </span>
);

// Up to `max` overlapping avatars, then "+N"
const AvatarStack = ({ people, max = 3 }) => {
    const extra = people.length - max;
    return (
        <span className='wt-stack' aria-hidden='true'>
            {people.slice(0, max).map((p) => <Avatar key={p.key} name={p.name} you={p.you} signed={p.signed} />)}
            {extra > 0 && <span className='wt-av more' title={people.slice(max).map((p) => p.name).join(', ')}>+{extra}</span>}
        </span>
    );
};

// One AO or CO line in the "Assigned to" column: avatar + name. AOs / COs get Assign me / Release for their
// own slot; the heads change people in the Manage dialog instead. Release takes two clicks (Release -> Confirm?),
// and the confirm step resets after 3 s or when the button loses focus, so a stray click can't drop you.
const AssigneeLine = ({ row, slotRole, myId, myRole, isHead, busy, onAssign, onUnassign }) => {
    const assigneeId = row[SLOT_ID[slotRole]];
    const assigneeName = row[SLOT_NAME[slotRole]];
    const isMine = assigneeId === myId;
    const name = isMine ? 'You' : assigneeName ?? 'Unknown';
    const [confirming, setConfirming] = useState(false);

    useEffect(() => {
        if (!confirming) return undefined;
        const t = setTimeout(() => setConfirming(false), 3000);
        return () => clearTimeout(t);
    }, [confirming]);

    const onRelease = () => {
        if (!confirming) { setConfirming(true); return; }
        setConfirming(false);
        onUnassign(row.application_id, slotRole);
    };

    return (
        <div className='wt-slot'>
            <span className='wt-slotlabel' title={SLOT_FULL_LABELS[slotRole]}>{SLOT_LABELS[slotRole]}</span>
            {assigneeId
                ? (
                    <span className='wt-person'>
                        <Avatar name={assigneeName ?? 'Unknown'} you={isMine} />
                        <span className='nm' title={assigneeName ?? undefined}>{name}</span>
                    </span>
                )
                : (
                    <span className='wt-person none'>
                        <span className='wt-av empty' aria-hidden='true' />
                        <span className='nm'>Unassigned</span>
                    </span>
                )}
            {!isHead && myRole === slotRole && !assigneeId && (
                <button className='wt-mini take' disabled={busy} onClick={() => onAssign(row.application_id, slotRole)}>
                    <UserPlus size={13} strokeWidth={2.4} aria-hidden='true' />Assign me
                </button>
            )}
            {!isHead && isMine && (
                <button
                    type='button'
                    className={`wt-mini drop${confirming ? ' confirm' : ''}`}
                    disabled={busy}
                    onClick={onRelease}
                    onBlur={() => setConfirming(false)}
                    aria-label={confirming
                        ? `Confirm: release yourself as ${SLOT_FULL_LABELS[slotRole]}`
                        : `Release yourself as ${SLOT_FULL_LABELS[slotRole]}`}>
                    <UserMinus size={13} strokeWidth={2.4} aria-hidden='true' />
                    {confirming ? 'Confirm?' : 'Release'}
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

// Reviewers (in order) and approvers the CO picked in VII. Approval; changed on that page, not here.
// One compact line each: an avatar stack (names on hover); a reviewer who signed off has a green tick.
// Screen readers get the full list as text.
const ReviewSlots = ({ routing, names, myId }) => {
    const nameOf = (x) => (x.user_id === myId ? 'You' : names[x.user_id] ?? 'Unknown');
    const toPerson = (x) => ({ key: x.id, name: nameOf(x), you: x.user_id === myId, signed: x.signedOff });
    const reviewers = routing.filter((x) => x.assignee_role === 'REVIEWER').sort((a, b) => a.seq - b.seq);
    const approvers = routing.filter((x) => x.assignee_role === 'APPROVER');
    if (!reviewers.length && !approvers.length) return null;
    const reviewerText = reviewers.map((x) => `${x.seq}. ${nameOf(x)}${x.signedOff ? ' (signed off)' : ''}`).join(', ');
    const approverText = approvers.map(nameOf).join(', ');
    return (
        <div className='wt-review'>
            {reviewers.length > 0 && (
                <div className='wt-slot' title={`Reviewers: ${reviewerText}`}>
                    <span className='wt-slotlabel'>Review</span>
                    <AvatarStack people={reviewers.map(toPerson)} />
                    <span className='sr-only'>Reviewers: {reviewerText}</span>
                </div>
            )}
            {approvers.length > 0 && (
                <div className='wt-slot' title={`Approvers: ${approverText}`}>
                    <span className='wt-slotlabel'>Approval</span>
                    <AvatarStack people={approvers.map(toPerson)} />
                    <span className='sr-only'>Approvers: {approverText}</span>
                </div>
            )}
        </div>
    );
};

// Time in the current stage against its TAT: the state in colour, days used, and a progress bar
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
                <span className='wt-tatlabel'>{TAT_LABELS[row.tat_state]}</span>
                <span>{days}d / {limit}d</span>
            </div>
            <div className='wt-bar' role='img' aria-label={`${pct}% of the turnaround time used`}>
                <span style={{ width: `${pct}%` }} />
            </div>
        </div>
    );
};

// hero = the blue gradient card (the viewer's own work); otherwise glass
// A number that counts up to its value (see useCountUp)
const CountUp = ({ value }) => useCountUp(value);

const SummaryTile = ({ icon, label, value, tone, active, onClick, hero = null }) => (
    <button type='button' className={`wt-tile ${tone}${hero ? ` hero ${hero}` : ''}`} aria-pressed={active} onClick={onClick}>
        <span className='ic' aria-hidden='true'><svg viewBox='0 0 24 24'>{icon}</svg></span>
        <span className='val'><CountUp value={value} /></span>
        <span className='lbl'>{label}</span>
    </button>
);

// Donut geometry for the turnaround-time ring (SVG circles drawn as dash segments with round ends)
const DONUT_R = 42;
const DONUT_C = 2 * Math.PI * DONUT_R;
const DONUT_W = 10;   // stroke width; a round cap reaches half of it past each end of a dash
const DONUT_GAP = 4;  // visible gap between segments
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

    // Refresh after an action or on the Refresh button (refreshing spins the Refresh icon)
    const [refreshing, setRefreshing] = useState(false);
    const load = async () => {
        setRefreshing(true);
        try {
            setError(null);
            setTray(await fetchTray());
            setLoadedAt(new Date());
        } catch (err) {
            setError(err.message);
        } finally {
            setRefreshing(false);
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
        // Beyond-TAT count per stage, so the stage tracker shows where work is stuck
        const lateByStage = Object.fromEntries(STAGES.map((s) => [s.value, 0]));
        open.forEach((r) => { if (r.tat_state === 'BEYOND' && r.stage in lateByStage) lateByStage[r.stage] += 1; });
        const timed = open.filter((r) => r.tat_days != null);
        return {
            open: open.length,
            byTat,
            timed: timed.length,
            byStage,
            lateByStage,
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

    if (loading) return <WorkTraySkeleton />;

    const { byTat } = stats;
    // Bar chart covers the open stages only; Decided keeps growing, so it sits below as a plain count
    const openStages = STAGES.filter((s) => s.value !== 'DECIDED');
    const maxOpenStage = Math.max(1, ...openStages.map((s) => stats.byStage[s.value]));
    const lateTotal = openStages.reduce((n, s) => n + stats.lateByStage[s.value], 0);
    // Ring segments in on track -> near -> beyond order. With several segments each dash is shortened by the
    // round caps plus a small gap, so neighbours don't touch; a single segment is drawn as the full ring.
    const donut = (() => {
        if (stats.timed === 0) return [];
        const parts = [['ok', byTat.ON_TRACK], ['warn', byTat.NEAR], ['bad', byTat.BEYOND]].filter(([, n]) => n > 0);
        const trim = parts.length > 1 ? DONUT_W + DONUT_GAP : 0;
        let start = 0;
        return parts.map(([toneName, n]) => {
            const full = (n / stats.timed) * DONUT_C;
            const seg = { tone: toneName, start: start + trim / 2, len: Math.max(0.01, full - trim) };
            start += full;
            return seg;
        });
    })();

    return (
        <div className='wt'>
            {/* ---------- dashboard: TAT donut, stage chart, two focus KPIs ---------- */}
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
                                <b><CountUp value={stats.open} /></b>
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
                    <h2 className='wt-wtitle'>Applications by stage</h2>
                    {/* Process arrows: one chevron per open stage, in order, all the same width. The count is the
                        size; the fill gets stronger for busier stages (12-40% of the stage colour, capped so navy
                        text stays 4.5:1+). A white tag shows how many are beyond TAT. Each chevron filters. */}
                    <ol className='wt-flow' aria-label='Filter by stage'>
                        {openStages.map((s, i) => {
                            const count = stats.byStage[s.value];
                            const late = stats.lateByStage[s.value];
                            const pressed = stage === s.value;
                            const mix = Math.round(12 + (count / maxOpenStage) * 28);
                            const summary = `${s.label}: ${count} application${count === 1 ? '' : 's'}`
                                + `${late ? `, ${late} beyond TAT` : ''}`;
                            return (
                                <li
                                    key={s.value}
                                    className={count ? undefined : 'zero'}
                                    style={{ '--st': STAGE_COLORS[s.value], '--mix': `${mix}%`, '--i': i }}>
                                    <button
                                        type='button'
                                        aria-pressed={pressed}
                                        aria-label={summary}
                                        title={summary}
                                        onClick={() => setStage(pressed ? 'OPEN' : s.value)}>
                                        <span className='name' aria-hidden='true'>{s.label}</span>
                                        <span className='num' aria-hidden='true'><CountUp value={count} /></span>
                                        {late > 0 && <span className='late' aria-hidden='true'>{late} late</span>}
                                    </button>
                                </li>
                            );
                        })}
                    </ol>
                    <div className='wt-barfoot'>
                        <span className={`wt-legend${lateTotal ? '' : ' zero'}`}><i />Beyond TAT ({lateTotal})</span>
                        <button
                            type='button'
                            className='wt-decided'
                            aria-pressed={stage === 'DECIDED'}
                            aria-label={`Decided: ${stats.byStage.DECIDED} application${stats.byStage.DECIDED === 1 ? '' : 's'}. Show them in the table`}
                            onClick={() => setStage(stage === 'DECIDED' ? 'OPEN' : 'DECIDED')}>
                            {/* the end of the flow: a double tick, the count, and an arrow into the table */}
                            <span className='ic' aria-hidden='true'><CheckCheck size={15} strokeWidth={2.4} /></span>
                            <b><CountUp value={stats.byStage.DECIDED} /></b>
                            <span className='lbl'>decided</span>
                            <ChevronRight className='go' size={16} aria-hidden='true' />
                        </button>
                    </div>
                </article>

                {/* Your own work (the blue hero) first, unassigned below it */}
                <div className='wt-kpis'>
                    <SummaryTile
                        icon={<path d='M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm9 2 2 2 4-4' />}
                        label={REVIEW_ROLES.includes(role) ? 'For my review' : 'Assigned to me'} value={stats.mine} tone='info' hero='blue'
                        active={assignment === 'MINE'} onClick={() => toggleAssignment('MINE')} />
                    <SummaryTile
                        icon={<path d='M12 9v4m0 4h.01M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z' />}
                        label='Unassigned' value={stats.unassigned} tone={stats.unassigned ? 'warn' : 'ok'}
                        active={assignment === 'UNASSIGNED'} onClick={() => toggleAssignment('UNASSIGNED')} />
                </div>
            </section>

            {/* ---------- table ---------- */}
            <section className='wt-card wt-tablecard' aria-labelledby='wt-table-title'>
                {/* Two rows so nothing is squeezed: title + count with Refresh, then search (which stretches),
                    filters and Clear. A filter that's on is tinted blue; the last refresh time is Refresh's tooltip. */}
                <div className='wt-toolbar'>
                    <div className='wt-toolbar-top'>
                        <div className='wt-tabletitle'>
                            <h2 id='wt-table-title'>Applications</h2>
                            <p className='wt-count' aria-live='polite'>
                                <b>{visible.length}</b> of {rows.length}
                            </p>
                        </div>
                        <button
                            type='button' className={`wt-refresh${refreshing ? ' spinning' : ''}`} onClick={load}
                            disabled={refreshing} aria-busy={refreshing}
                            title={loadedAt ? `Updated ${loadedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : undefined}>
                            <RefreshCw size={15} aria-hidden='true' />Refresh
                        </button>
                    </div>
                    <div className='wt-toolbar-filters'>
                    <div className='wt-search'>
                        <input
                            type='search'
                            aria-label='Search reference or applicant'
                            placeholder='Search by reference or name'
                            value={search}
                            onChange={(e) => setSearch(e.target.value)} />
                    </div>
                    <FilterSelect
                        label='TAT filter' value={tat} onChange={setTat} active={tat !== 'ALL'}
                        options={TAT_FILTERS} />
                    <FilterSelect
                        label='Assignment filter' value={assignment} onChange={setAssignment}
                        active={assignment !== defaultAssignment} options={ASSIGNMENT_FILTERS} />
                    <FilterSelect
                        label='Stage filter' value={stage} onChange={setStage} active={stage !== 'OPEN'}
                        options={STAGE_FILTERS} />
                    {filtersActive && (
                        <button type='button' className='wt-clear' onClick={clearFilters}>
                            <X size={15} aria-hidden='true' />Clear
                        </button>
                    )}
                    </div>
                </div>

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
                                <th>Review &amp; approval</th>
                            </tr>
                        </thead>
                        <tbody>
                            {visible.length === 0 && (
                                <tr><td colSpan={7} className='wt-empty'>No applications match these filters.</td></tr>
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
                                            {/* Flags after the reference: quiet icon + word, except "Your turn",
                                                which asks for action and gets the one orange tag */}
                                            <div className='wt-refline'>
                                                <span className='wt-ref'>{r.application_no}</span>
                                                {!r.can_open && (
                                                    <span className='wt-flag'><Lock size={12} aria-hidden='true' />Locked</span>
                                                )}
                                                {r.can_open && isAssignable && r[SLOT_ID[role]] !== myId && (
                                                    <span className='wt-flag'><Eye size={12} aria-hidden='true' />View only</span>
                                                )}
                                                {isMyReviewTurn(routing, r, myId)
                                                    ? <span className='wt-flag turn'>Your turn to review</span>
                                                    : routedToMe && (
                                                        <span className='wt-flag info'>
                                                            Yours: {role === 'APPROVER' ? 'approval' : 'review'}
                                                        </span>
                                                    )}
                                            </div>
                                            <span className='wt-name'>{r.applicant_name ?? '-'}</span>
                                            <span className='wt-sub'>
                                                {[employmentLabel(r.employment_type), r.branch].filter(Boolean).join(' · ')}
                                            </span>
                                        </td>
                                        <td>
                                            <div className='wt-stagecell' style={{ '--st': STAGE_COLORS[r.stage] }}>
                                                <span className='wt-stage'>{stageLabel(r.stage)}</span>
                                                {STAGE_STATUS_LABELS[r.stage_status] && (() => {
                                                    const StatusIcon = STATUS_ICONS[r.stage_status] ?? Hourglass;
                                                    return (
                                                        <span className={`wt-status ${STATUS_TONES[r.stage_status] ?? 'plain'}`}>
                                                            <StatusIcon size={13} strokeWidth={2.4} aria-hidden='true' />
                                                            {STAGE_STATUS_LABELS[r.stage_status]}
                                                        </span>
                                                    );
                                                })()}
                                            </div>
                                        </td>
                                        <td className='wt-amt'>{r.loan_amount != null ? formatPeso(r.loan_amount) : '-'}</td>
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
                                                {isHead && (
                                                    <button
                                                        type='button'
                                                        className='wt-mini manage'
                                                        title='Manage assignment'
                                                        aria-label={`Manage assignment for ${r.application_no}`}
                                                        onClick={() => setManagingId(r.application_id)}>
                                                        <Settings2 size={15} aria-hidden='true' />
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                        {/* Reviewers / approvers in their own column, so rows stay two lines tall */}
                                        <td>
                                            {(routing[r.application_id] ?? []).length > 0
                                                ? <ReviewSlots routing={routing[r.application_id]} names={names} myId={myId} />
                                                : <span className='wt-dim wt-notrouted'>Not routed yet</span>}
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