// "Flag the findings": when a saved CI result is "With findings", a Credit Investigator can flag them with a short
// note. The assigned Account Officer and the assigned Credit Officer (the Dispatch Admins while no Credit Officer is
// assigned) get a bell alert that opens IV. Credit Checking. Every flag is kept and shown here: who, when, the note.
// Shown under the CI results wherever they appear; only a Credit Investigator gets the form.
// (ci_finding_flags / flag_ci_findings() in 20261116_findings_and_file_marks.sql)
import { useEffect, useState } from 'react';
import { Flag } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { UserAuth } from '../../context/authContext';
import { fetchStaffNames } from '../loanFolder/api';
import { Term } from '../../components/term';

const MAX = 500;

const check = ({ data, error }) => {
    if (error) throw error;
    return data;
};
const fetchFlags = async (applicationId) =>
    check(await supabase.from('ci_finding_flags').select('id, note, flagged_by, flagged_at')
        .eq('application_id', applicationId).order('id', { ascending: false })) ?? [];
const flagFindings = async (applicationId, note) =>
    check(await supabase.rpc('flag_ci_findings', { p_application_id: applicationId, p_note: note }));

// hasFindings: a SAVED result on this file is "With findings"; unsaved: the CI picked it but hasn't saved yet
const CiFindingFlags = ({ applicationId, hasFindings, unsaved = false }) => {
    const role = UserAuth()?.role;
    const [flags, setFlags] = useState([]);
    const [names, setNames] = useState({});
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [done, setDone] = useState(false);
    const [version, setVersion] = useState(0);          // bump to load the flags again

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const rows = await fetchFlags(applicationId);
                const who = await fetchStaffNames(rows.map((f) => f.flagged_by));
                if (!cancelled) { setFlags(rows); setNames(who); }
            } catch { /* not migrated yet: the CI results still show */ }
        })();
        return () => { cancelled = true; };
    }, [applicationId, version]);

    const canFlag = role === 'CREDIT_INVESTIGATOR' && hasFindings;
    if (flags.length === 0 && !canFlag && !(role === 'CREDIT_INVESTIGATOR' && unsaved)) return null;

    const submit = async () => {
        if (!note.trim()) { setError('Write a short note about the findings.'); return; }
        setBusy(true);
        setError(null);
        try {
            await flagFindings(applicationId, note.trim());
            setNote('');
            setDone(true);
            setVersion((v) => v + 1);
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className='my-3 rounded border border-amber-500 bg-amber-50 p-3 text-left text-gray-900'>
            <p className='flex items-center gap-2 font-semibold text-gray-900'>
                <Flag size={16} aria-hidden='true' />
                <span><Term k="CI" /> {flags.length > 0 ? `findings flagged (${flags.length})` : 'findings not flagged yet'}</span>
            </p>
            {flags.length > 0 && (
                <ul className='pt-1'>
                    {flags.map((f) => (
                        <li key={f.id} className='border-t border-amber-300 py-1.5 first:border-t-0'>
                            <span className='text-sm text-gray-800'>
                                Flagged by {names[f.flagged_by] ?? 'Credit Investigator'} · {new Date(f.flagged_at).toLocaleString()}
                            </span>
                            <span className='block whitespace-pre-wrap break-words text-gray-900'>{f.note}</span>
                        </li>
                    ))}
                </ul>
            )}

            {canFlag && (
                <div className='pt-2'>
                    <label htmlFor='ci-flag-note' className='block text-sm font-semibold text-gray-900'>
                        {flags.length > 0 ? 'Flag again, with a short note' : 'Flag the findings, with a short note'}
                    </label>
                    <textarea id='ci-flag-note' rows={2} value={note} maxLength={MAX} onChange={(e) => { setNote(e.target.value); setDone(false); }}
                        aria-describedby='ci-flag-hint'
                        className='mt-1 w-full rounded border border-gray-400 bg-white p-2 text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600' />
                    <p id='ci-flag-hint' className='text-sm text-gray-800'>
                        {note.length} / {MAX}. Alerts the assigned Account Officer and Credit Officer (the Dispatch Admins if no
                        Credit Officer is assigned yet). The note is read here, not in the alert. A flag can't be edited or removed.
                    </p>
                    <button type='button' disabled={busy} onClick={submit}
                        className='mt-1 min-h-0! rounded border border-amber-800! bg-white! px-3! py-1.5! font-semibold text-amber-950! hover:bg-amber-100! disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600'>
                        {busy ? 'Flagging...' : 'Flag findings'}
                    </button>
                </div>
            )}
            {role === 'CREDIT_INVESTIGATOR' && !hasFindings && unsaved && (
                <p className='pt-1 text-sm text-gray-900'>Save your findings first, then you can flag them.</p>
            )}
            {done && <p role='status' className='pt-1 font-semibold text-green-900'>Flag sent.</p>}
            {error && <p role='alert' className='pt-1 text-red-800'>{error}</p>}
        </div>
    );
};

export default CiFindingFlags;
