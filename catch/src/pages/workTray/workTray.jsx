import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserAuth } from '../../context/authContext';
import { ASSIGNABLE_ROLES, ASSIGNING_HEADS } from '../../roles';
import { EMPLOYMENT_TYPES } from '../applicationForm/options';
import { assignApplication, fetchAssignableStaff, fetchWorkTray, unassignApplication } from './api';
import { SLOT_LABELS, STAGES, STAGE_STATUS_LABELS, TAT_LABELS, stageLabel } from './options';

const employmentLabel = (type) => EMPLOYMENT_TYPES.find((t) => t.value === type)?.label ?? '';

const SLOT_ID = { ACCOUNT_OFFICER: 'ao_id', CREDIT_OFFICER: 'co_id' };
const SLOT_NAME = { ACCOUNT_OFFICER: 'ao_name', CREDIT_OFFICER: 'co_name' };

// One AO or CO slot in the "Assigned to" column
const AssigneeSlot = ({ row, slotRole, myId, myRole, isHead, staff, busy, onAssign, onUnassign }) => {
    const assigneeId = row[SLOT_ID[slotRole]];
    const isMine = assigneeId === myId;

    return (
        <div>
            {SLOT_LABELS[slotRole]}: {row[SLOT_NAME[slotRole]] ?? 'Unassigned'}{' '}
            {isHead && (
                <select
                    disabled={busy}
                    value={assigneeId ?? ''}
                    onChange={(e) => e.target.value && onAssign(row.application_id, slotRole, e.target.value)}
                    className='border'>
                    <option value=''>{assigneeId ? 'Reassign to...' : 'Assign to...'}</option>
                    {staff.filter((s) => s.role === slotRole).map((s) => (
                        <option key={s.user_id} value={s.user_id}>{s.name}</option>
                    ))}
                </select>
            )}
            {!isHead && myRole === slotRole && !assigneeId && (
                <button disabled={busy} onClick={() => onAssign(row.application_id, slotRole)} className='border px-2'>
                    Assign me
                </button>
            )}
            {assigneeId && (isHead || isMine) && (
                <button disabled={busy} onClick={() => onUnassign(row.application_id, slotRole)} className='border px-2'>
                    {isMine ? 'Release' : 'Unassign'}
                </button>
            )}
        </div>
    );
};

// Every submitted application, FIFO by submission. AOs/COs see the summary of all of them
// (so they can claim unassigned ones) but can only open the ones assigned to them.
const WorkTray = () => {
    const { session, role } = UserAuth();
    const myId = session?.user?.id;
    const isHead = ASSIGNING_HEADS.includes(role);
    const isAssignable = ASSIGNABLE_ROLES.includes(role);
    const navigate = useNavigate();

    const [rows, setRows] = useState([]);
    const [staff, setStaff] = useState([]);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState(null);
    const [error, setError] = useState(null);

    const [search, setSearch] = useState('');
    const [tat, setTat] = useState('ALL');           // ALL / NEAR / BEYOND
    const [assignment, setAssignment] = useState('ALL'); // ALL / MINE / UNASSIGNED
    const [stage, setStage] = useState('OPEN');      // OPEN = everything not yet decided

    // Refresh after an action or on the Refresh button
    const load = async () => {
        try {
            setError(null);
            setRows(await fetchWorkTray());
        } catch (err) {
            setError(err.message);
        }
    };

    useEffect(() => {
        fetchWorkTray()
            .then(setRows)
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

    const openRows = useMemo(() => rows.filter((r) => r.stage !== 'DECIDED'), [rows]);
    const nearCount = openRows.filter((r) => r.tat_state === 'NEAR').length;
    const beyondCount = openRows.filter((r) => r.tat_state === 'BEYOND').length;

    const visible = useMemo(() => {
        const q = search.trim().toLowerCase();
        return rows.filter((r) =>
            (stage === 'OPEN' ? r.stage !== 'DECIDED' : stage === 'ALL' || r.stage === stage)
            && (tat === 'ALL' || r.tat_state === tat)
            && (assignment === 'ALL'
                || (assignment === 'MINE' && (r.ao_id === myId || r.co_id === myId))
                || (assignment === 'UNASSIGNED' && isUnassigned(r)))
            && (!q || [r.application_no, r.applicant_name].some((v) => v?.toLowerCase().includes(q))));
    }, [rows, search, tat, assignment, stage, myId, isUnassigned]);

    if (loading) return <p>Loading work tray...</p>;

    return (
        <div>
            <h2>Work tray</h2>
            <p>
                {visible.length} of {rows.length} applications, first in first out by submission ·{' '}
                {nearCount} near TAT · {beyondCount} beyond TAT
            </p>

            <div className='flex flex-wrap gap-2 py-2'>
                <input
                    type='search'
                    placeholder='Search reference or applicant'
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className='border px-2' />
                <select value={tat} onChange={(e) => setTat(e.target.value)} className='border'>
                    <option value='ALL'>All TAT</option>
                    <option value='NEAR'>Near TAT</option>
                    <option value='BEYOND'>Beyond TAT</option>
                </select>
                <select value={assignment} onChange={(e) => setAssignment(e.target.value)} className='border'>
                    <option value='ALL'>All applications</option>
                    <option value='MINE'>Assigned to me</option>
                    <option value='UNASSIGNED'>Unassigned</option>
                </select>
                <select value={stage} onChange={(e) => setStage(e.target.value)} className='border'>
                    <option value='OPEN'>All open stages</option>
                    <option value='ALL'>All stages incl. decided</option>
                    {STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
                <button onClick={load} className='border px-2'>Refresh</button>
            </div>

            {error && <p className='text-red-600'>{error}</p>}

            <table className='border-collapse'>
                <thead>
                    <tr className='text-left'>
                        <th className='border px-2'>FIFO</th>
                        <th className='border px-2'>Reference</th>
                        <th className='border px-2'>Applicant</th>
                        <th className='border px-2'>Stage</th>
                        <th className='border px-2'>Status</th>
                        <th className='border px-2'>Amount</th>
                        <th className='border px-2'>Time in stage</th>
                        <th className='border px-2'>TAT position</th>
                        <th className='border px-2'>Assigned to</th>
                    </tr>
                </thead>
                <tbody>
                    {visible.length === 0 && (
                        <tr><td colSpan={9} className='border px-2'>No applications match these filters.</td></tr>
                    )}
                    {visible.map((r) => (
                        // The whole row opens the loan folder when you have access
                        <tr
                            key={r.application_id}
                            tabIndex={r.can_open ? 0 : undefined}
                            onClick={r.can_open ? () => navigate(`/loanFolderPage?id=${r.application_id}`) : undefined}
                            onKeyDown={r.can_open ? (e) => e.key === 'Enter' && e.target === e.currentTarget
                                && navigate(`/loanFolderPage?id=${r.application_id}`) : undefined}
                            className={r.can_open ? 'cursor-pointer hover:bg-gray-100' : ''}>
                            <td className='border px-2'>{rows.indexOf(r) + 1}</td>
                            <td className='border px-2'>
                                {r.application_no}
                                {!r.can_open && <div>(locked: not assigned to you)</div>}
                            </td>
                            <td className='border px-2'>
                                {r.applicant_name ?? '-'}
                                <div>{[employmentLabel(r.employment_type), r.branch].filter(Boolean).join(' · ')}</div>
                            </td>
                            <td className='border px-2'>{stageLabel(r.stage)}</td>
                            <td className='border px-2'>{STAGE_STATUS_LABELS[r.stage_status] ?? '-'}</td>
                            <td className='border px-2'>
                                {r.loan_amount != null
                                    ? `₱${Number(r.loan_amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
                                    : '-'}
                            </td>
                            <td className='border px-2'>{r.days_in_stage}d</td>
                            <td className='border px-2'>
                                {r.tat_days != null ? `${r.days_in_stage}d of ${r.tat_days}d · ${TAT_LABELS[r.tat_state]}` : '-'}
                            </td>
                            {/* Assign / release controls: don't open the folder when using them */}
                            <td className='border px-2' onClick={(e) => e.stopPropagation()}>
                                {ASSIGNABLE_ROLES.map((slotRole) => (
                                    <AssigneeSlot
                                        key={slotRole}
                                        row={r}
                                        slotRole={slotRole}
                                        myId={myId}
                                        myRole={role}
                                        isHead={isHead}
                                        staff={staff}
                                        busy={busyId === r.application_id}
                                        onAssign={handleAssign}
                                        onUnassign={handleUnassign} />
                                ))}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

export default WorkTray;
