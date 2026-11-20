import { Shuffle, Users } from 'lucide-react';
import { useState } from 'react';
import { MANAGER_LABELS } from '../../roles';
import { autoAssignUnassigned, setOfficerAvailability } from './api';

const TEAM_LABELS = { ACCOUNT_OFFICER: 'Account Officers', CREDIT_OFFICER: 'Credit Officers' };

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const lastAssigned = (at) => (at
    ? new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    : 'Never');

// AO / CO Manager only: their team's workload and who's in the auto-assignment rotation.
// Workload = borrowers (principal + spouse + co-borrowers) on each officer's open files; CATCH gives each new
// file to the available officer with the lowest workload (assignment_weight() / pick_assignee() in the DB).
// staff = list_assignable_staff() rows; unassigned = open files with this team's slot empty; onChanged reloads.
const TeamWorkload = ({ slotRole, staff, unassigned, onChanged }) => {
    const [busy, setBusy] = useState(null);       // user_id being toggled, or 'auto'
    const [error, setError] = useState(null);
    const [result, setResult] = useState(null);

    const available = staff.filter((s) => s.available).length;
    const maxLoad = Math.max(1, ...staff.map((s) => s.workload));

    const toggle = async (s) => {
        setBusy(s.user_id);
        setError(null);
        setResult(null);
        try {
            await setOfficerAvailability(s.user_id, !s.available);
            await onChanged();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(null);
        }
    };

    const runAuto = async () => {
        setBusy('auto');
        setError(null);
        setResult(null);
        try {
            const { assigned, left } = await autoAssignUnassigned();
            setResult(left
                ? `Assigned ${plural(assigned, 'file')}. ${plural(left, 'file')} still unassigned: nobody is available.`
                : `Assigned ${plural(assigned, 'file')}.`);
            await onChanged();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(null);
        }
    };

    return (
        <section className='wt-card wt-team' aria-labelledby='wt-team-title'>
            <div className='wt-team-head'>
                <div>
                    <h2 id='wt-team-title' className='wt-wtitle'>
                        <Users size={17} aria-hidden='true' />Team workload · {TEAM_LABELS[slotRole]}
                    </h2>
                    <p className='wt-team-sub'>
                        You are the {MANAGER_LABELS[slotRole]}. New applications go to the available officer with the
                        fewest borrowers on open files. {available} of {staff.length} available.
                    </p>
                </div>
                <button
                    type='button' className='wt-team-auto' onClick={runAuto}
                    disabled={busy !== null || unassigned === 0}
                    title={unassigned ? undefined : 'Every open file has someone in this slot'}>
                    <Shuffle size={15} aria-hidden='true' />
                    {busy === 'auto' ? 'Assigning...' : `Auto-assign unassigned (${unassigned})`}
                </button>
            </div>

            {error && <p className='wt-error-inline' role='alert'>{error}</p>}
            {result && <p className='wt-team-result' role='status'>{result}</p>}

            {staff.length === 0 ? (
                <p className='wt-team-empty'>
                    No {TEAM_LABELS[slotRole].toLowerCase()} with a completed profile yet. Ask the Department Head to add them.
                </p>
            ) : (
                <ul className='wt-team-list'>
                    {staff.map((s) => (
                        <li key={s.user_id} className={s.available ? undefined : 'off'}>
                            <span className='nm'>{s.name}</span>
                            <span className='load' title={`${plural(s.workload, 'borrower')} on ${plural(s.open_files, 'open file')}`}>
                                <span className='bar' aria-hidden='true'>
                                    <i style={{ width: `${(s.workload / maxLoad) * 100}%` }} />
                                </span>
                                <b>{s.workload}</b> <span className='unit'>borrowers · {plural(s.open_files, 'file')}</span>
                            </span>
                            <span className='last'>Last assigned {lastAssigned(s.last_assigned_at)}</span>
                            <button
                                type='button' className={`wt-team-switch${s.available ? ' on' : ''}`}
                                role='switch' aria-checked={s.available} disabled={busy !== null}
                                aria-label={`${s.name}: available for new files`}
                                onClick={() => toggle(s)}>
                                <i aria-hidden='true' />{s.available ? 'Available' : 'Unavailable'}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
};

export default TeamWorkload;
