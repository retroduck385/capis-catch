// Master profile: the applicant's own details, filled in once and used to pre-fill
// the Principal Borrower step of every new application. Required before applying.
// Same layout as the staff profile page (identity card + account details beside the form); styles in staffProfile.css.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, FileText, Info } from 'lucide-react';
import { UserAuth } from '../context/authContext';
import ApplicantShell from '../components/applicantShell';
import { fetchProfile, saveProfile, toForm } from './applicationForm/api';
import { FieldGroup, FormError, Section } from './applicationForm/fields';
import { PARTY_FIELDS, PERSON_FIELDS } from './applicationForm/options';
import { hasErrors, validatePerson } from './applicationForm/validators';
import { initialsOf } from './staffAccounts/options';
import './staffProfile.css';

const FIELDS = PARTY_FIELDS.PROFILE.map(([f]) => f);
const REQUIRED = PARTY_FIELDS.PROFILE.filter(([, r]) => r).map(([f]) => f);
const HUE = '#1e3f97';

const dateOf = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'long' }) : '-');
const dateTimeOf = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '-');

// Same fields as PARTY_FIELDS.PROFILE, grouped so related details sit together
const GROUPS = [
    ['Name', ['first_name', 'middle_name', 'last_name', 'name_extension']],
    ['Personal details', ['gender', 'civil_status', 'date_of_birth', 'birth_place']],
    ['Contact and identification', ['mobile_number', 'citizenship', 'sss_no', 'tin']],
];

const ProfilePage = () => {
    const { session } = UserAuth();
    const user = session?.user;
    const userId = user?.id;
    const email = user?.email;
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const applyNext = searchParams.get('next') === 'apply';

    const [form, setForm] = useState(() => toForm(null, FIELDS));
    const [errors, setErrors] = useState({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!userId) return;
        fetchProfile(userId)
            .then((profile) => setForm(toForm(profile, FIELDS)))
            .catch((err) => setError(err.message))
            .finally(() => setLoading(false));
    }, [userId]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        const found = validatePerson(form, 'PROFILE');
        setErrors(found);
        if (hasErrors(found)) return;

        setSaving(true);
        setError(null);
        try {
            await saveProfile(userId, form);
            navigate(applyNext ? '/applicationFormPage' : '/applicantHomePage');
        } catch (err) {
            // 23505 = unique violation (user_profile.sss_no / tin)
            setError(err.code === '23505' ? 'That SSS No. or TIN is already registered to another account.' : err.message);
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <ApplicantShell><p>Loading your profile...</p></ApplicantShell>;

    const onChange = (f, v) => setForm((p) => ({ ...p, [f]: v }));
    const fullName = [form.first_name, form.last_name].filter(Boolean).join(' ').trim();
    const filled = REQUIRED.filter((f) => String(form[f] ?? '').trim() !== '').length;

    return (
        <ApplicantShell>
            <div className="sp">
                <div className="sp-head">
                    <Link to="/applicantHomePage" className="sp-back"><ArrowLeft size={16} aria-hidden="true" />My applications</Link>
                    <h1>My profile</h1>
                    <p className="sp-muted">These details are used to fill in your loan applications.</p>
                </div>

                {applyNext && (
                    <p className="sp-banner" role="note">
                        <Info size={18} aria-hidden="true" />
                        <span>
                            <b>Before you apply.</b> Please complete your profile first. We use it to fill in your loan application for you.
                        </span>
                    </p>
                )}

                <div className="sp-grid">
                    <div className="sp-col">
                        <aside className="sp-card sp-id" aria-label="Your account">
                            <span className="sp-avatar" style={{ '--hue': HUE }} aria-hidden="true">{initialsOf(fullName, email)}</span>
                            <h2>{fullName || 'Your name'}</h2>
                            <span className="sp-role" style={{ '--hue': HUE }}>Loan Applicant</span>
                            <p className="sp-email" title={email}>{email}</p>
                            <p className="sp-blurb">Fill this in once. We copy it into the Principal Borrower step of every new application.</p>
                            <ul className="sp-links">
                                <li>
                                    <Link to="/applicantHomePage">
                                        <FileText size={18} aria-hidden="true" />
                                        <span><b>My applications</b><small>See and continue your applications</small></span>
                                        <ArrowRight size={16} aria-hidden="true" />
                                    </Link>
                                </li>
                            </ul>
                        </aside>

                        <section className="sp-card sp-account" aria-label="Account details">
                            <h2>Account details</h2>
                            <dl>
                                <div><dt>Email</dt><dd>{email}</dd></div>
                                <div><dt>Account type</dt><dd>Loan Applicant</dd></div>
                                <div><dt>Account created</dt><dd>{dateOf(user?.created_at)}</dd></div>
                                <div><dt>Last sign-in</dt><dd>{dateTimeOf(user?.last_sign_in_at)}</dd></div>
                            </dl>
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

                            {GROUPS.map(([title, fields]) => (
                                <Section key={title} title={title}>
                                    <FieldGroup config={PERSON_FIELDS} fields={fields} required={REQUIRED}
                                        values={form} errors={errors} prefix="PROFILE-" onChange={onChange} />
                                </Section>
                            ))}

                            <FormError error={error} />
                            <div className="sp-actions">
                                <Link to="/applicantHomePage" className="sp-cancel">Cancel</Link>
                                <button type="submit" disabled={saving}>
                                    {saving ? 'Saving...' : applyNext ? 'Save and start application' : 'Save profile'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        </ApplicantShell>
    );
};

export default ProfilePage;
