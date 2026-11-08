// Staff profile: name + mobile number, shown wherever a staff member is assigned or acts
// (work tray, status notes). Required before a staff account can use the app.
// The same page serves every staff role; the Department Head also gets a shortcut to Staff accounts.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Info, Layers, Plus, Users } from 'lucide-react';
import { UserAuth } from '../context/authContext';
import { fetchProfile, saveProfile, toForm } from './applicationForm/api';
import { FieldGroup, FormError, Section } from './applicationForm/fields';
import { PARTY_FIELDS, PERSON_FIELDS } from './applicationForm/options';
import { ROLE_LABELS } from '../roles';
import { hasErrors, isProfileComplete, validatePerson } from './applicationForm/validators';
import { ROLE_INFO, initialsOf } from './staffAccounts/options';
import './staffProfile.css';

const dateOf = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'long' }) : '-');
const dateTimeOf = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '-');

const ALL_FIELDS = PARTY_FIELDS.STAFF_PROFILE.map(([f]) => f);
const REQUIRED = PARTY_FIELDS.STAFF_PROFILE.filter(([, r]) => r).map(([f]) => f);
const NAME_FIELDS = ['first_name', 'middle_name', 'last_name', 'name_extension'];
const CONTACT_FIELDS = ['mobile_number'];

// Shortcuts shown on the identity card, by role
const shortcutsFor = (role) => [
    ['/adminHomePage', 'Work tray', 'See the applications you work on', Layers],
    ...(role === 'ACCOUNT_OFFICER' ? [['/accountOfficerApplicationInputPage', 'New application', 'Enter an application for an applicant', Plus]] : []),
    ...(role === 'DEPT_HEAD' ? [['/staffAccountsPage', 'Staff accounts', 'Add logins and see each role', Users]] : []),
];

const StaffProfilePage = () => {
    const { session, role } = UserAuth();
    const userId = session?.user?.id;
    const email = session?.user?.email;
    const navigate = useNavigate();

    const [form, setForm] = useState(() => toForm(null, ALL_FIELDS));
    const [firstTime, setFirstTime] = useState(false);
    const [errors, setErrors] = useState({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!userId) return;
        fetchProfile(userId)
            .then((profile) => {
                setForm(toForm(profile, ALL_FIELDS));
                setFirstTime(!isProfileComplete(profile, 'STAFF_PROFILE'));
            })
            .catch((err) => setError(err.message))
            .finally(() => setLoading(false));
    }, [userId]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        const found = validatePerson(form, 'STAFF_PROFILE');
        setErrors(found);
        if (hasErrors(found)) return;

        setSaving(true);
        setError(null);
        try {
            await saveProfile(userId, form);
            navigate('/adminHomePage');
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <p>Loading profile...</p>;

    const onChange = (f, v) => setForm((p) => ({ ...p, [f]: v }));
    const fullName = [form.first_name, form.last_name].filter(Boolean).join(' ').trim();
    const filled = REQUIRED.filter((f) => String(form[f] ?? '').trim() !== '').length;
    const info = ROLE_INFO[role];

    const user = session?.user;

    return (
        <div className="sp">
            <div className="sp-head">
                {!firstTime && <Link to="/adminHomePage" className="sp-back"><ArrowLeft size={16} aria-hidden="true" />Work tray</Link>}
                <h1>My profile</h1>
                <p className="sp-muted">
                    {firstTime
                        ? 'Complete your profile to continue. Your name is shown on the applications you are assigned to.'
                        : 'Your name is shown on the applications you are assigned to.'}
                </p>
            </div>

            {firstTime && (
                <p className="sp-banner" role="note">
                    <Info size={18} aria-hidden="true" />
                    <span>
                        <b>One last step.</b> The rest of the system opens once your name and mobile number are saved.
                    </span>
                </p>
            )}

            <div className="sp-grid">
                <div className="sp-col">
                <aside className="sp-card sp-id" aria-label="Your account">
                    <span className="sp-avatar" style={{ '--hue': info?.hue }} aria-hidden="true">
                        {initialsOf(fullName, email)}
                    </span>
                    <h2>{fullName || 'Your name'}</h2>
                    <span className="sp-role" style={{ '--hue': info?.hue }}>{ROLE_LABELS[role] ?? role}</span>
                    <p className="sp-email" title={email}>{email}</p>
                    {info && <p className="sp-blurb">{info.blurb}</p>}

                    {!firstTime && (
                        <ul className="sp-links">
                            {shortcutsFor(role).map(([to, label, hint, Icon]) => (
                                <li key={to}>
                                    <Link to={to}>
                                        <Icon size={18} aria-hidden="true" />
                                        <span><b>{label}</b><small>{hint}</small></span>
                                        <ArrowRight size={16} aria-hidden="true" />
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    )}
                </aside>

                <section className="sp-card sp-account" aria-label="Account details">
                    <h2>Account details</h2>
                    <dl>
                        <div><dt>Email</dt><dd>{email}</dd></div>
                        <div><dt>Role</dt><dd>{ROLE_LABELS[role] ?? role}</dd></div>
                        <div><dt>Account created</dt><dd>{dateOf(user?.created_at)}</dd></div>
                        <div><dt>Last sign-in</dt><dd>{dateTimeOf(user?.last_sign_in_at)}</dd></div>
                    </dl>
                    <p className="sp-hint">To change your email or role, ask your Department Head.</p>
                </section>
                </div>

                <div className="sp-col">
                <form onSubmit={handleSubmit} noValidate className="sp-card sp-form">
                    <div className="sp-formhead">
                        <h2>Personal information</h2>
                        <span className="sp-muted">{filled} of {REQUIRED.length} required fields filled</span>
                    </div>
                    <div className="sp-meter" role="img" aria-label={`${filled} of ${REQUIRED.length} required fields filled`}>
                        <span style={{ width: `${(filled / REQUIRED.length) * 100}%` }} />
                    </div>

                    <Section title="Name">
                        <FieldGroup config={PERSON_FIELDS} fields={NAME_FIELDS} required={REQUIRED}
                            values={form} errors={errors} onChange={onChange} prefix="STAFF_PROFILE-" />
                    </Section>
                    <Section title="Contact">
                        <FieldGroup config={PERSON_FIELDS} fields={CONTACT_FIELDS} required={REQUIRED}
                            values={form} errors={errors} onChange={onChange} prefix="STAFF_PROFILE-" />
                    </Section>

                    <FormError error={error} />
                    <div className="sp-actions">
                        {!firstTime && <Link to="/adminHomePage" className="sp-cancel">Cancel</Link>}
                        <button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save profile'}</button>
                    </div>
                </form>

                </div>
            </div>
        </div>
    );
};

export default StaffProfilePage;
