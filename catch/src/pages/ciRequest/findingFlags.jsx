// "Flag the findings": when a saved CI result is "With findings", a Credit Investigator can flag them with a short
// note. The assigned Account Officer and the assigned Credit Officer (the Dispatch Admins while no Credit Officer is
// assigned) get a bell alert that opens IV. Credit Checking. Every flag is kept and shown here: who, when, the note.
// Shown under the CI results wherever they appear; only a Credit Investigator gets the form.
// (ci_finding_flags / flag_ci_findings() in 20261116_findings_and_file_marks.sql)
// Look: .ci-flags in ciRequest.css, on --lf-* tokens with light fallbacks: an amber box on every page, and it follows
// dark mode on the converted ones (the CI request). Who flagged it is a Byline.
import { useEffect, useId, useState } from 'react';
import { Flag } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { UserAuth } from '../../context/authContext';
import { fetchStaffNames } from '../loanFolder/api';
import { Term } from '../../components/term';
import Byline from '../../components/byline';
import './ciRequest.css';

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
    const uid = useId().replace(/:/g, '');

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
        <section className="ci-flags" aria-labelledby={`ci-flags-h${uid}`}>
            <div className="ci-flags-head">
                <span className="ci-flags-ic" aria-hidden="true"><Flag size={15} /></span>
                <h3 id={`ci-flags-h${uid}`}>
                    <Term k="CI" /> {flags.length > 0 ? 'findings flagged' : 'findings not flagged yet'}
                </h3>
                {flags.length > 0 && <span className="ci-flags-n">{flags.length}</span>}
            </div>
            {flags.length > 0 && (
                <ul className="ci-flags-list">
                    {flags.map((f) => (
                        <li key={f.id}>
                            <span className="ci-flags-by">
                                Flagged by <Byline layout="inline" name={names[f.flagged_by]} fallback="Credit Investigator" at={f.flagged_at} />
                            </span>
                            <p className="ci-flags-note">{f.note}</p>
                        </li>
                    ))}
                </ul>
            )}

            {canFlag && (
                <div className="ci-flags-form">
                    <label htmlFor={`ci-flag-note${uid}`}>
                        {flags.length > 0 ? 'Flag again, with a short note' : 'Flag the findings, with a short note'}
                    </label>
                    <textarea id={`ci-flag-note${uid}`} rows={2} value={note} maxLength={MAX}
                        onChange={(e) => { setNote(e.target.value); setDone(false); }} aria-describedby={`ci-flag-hint${uid}`} />
                    <p id={`ci-flag-hint${uid}`} className="ci-flags-hint">
                        {note.length} / {MAX}. Alerts the assigned Account Officer and Credit Officer (the Dispatch Admins if no
                        Credit Officer is assigned yet). The note is read here, not in the alert. A flag can't be edited or removed.
                    </p>
                    <button type="button" className="ci-flags-btn" disabled={busy} onClick={submit}>
                        <Flag size={15} aria-hidden="true" />{busy ? 'Flagging...' : 'Flag findings'}
                    </button>
                </div>
            )}
            {role === 'CREDIT_INVESTIGATOR' && !hasFindings && unsaved && (
                <p className="ci-flags-hint">Save your findings first, then you can flag them.</p>
            )}
            {done && <p role="status" className="ci-flags-sent">Flag sent.</p>}
            {error && <p role="alert" className="ci-flags-err">{error}</p>}
        </section>
    );
};

export default CiFindingFlags;
