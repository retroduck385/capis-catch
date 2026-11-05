// Master profile: the applicant's own details, filled in once and used to pre-fill
// the Principal Borrower step of every new application. Required before applying.
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { UserAuth } from '../context/authContext';
import ApplicantShell from '../components/applicantShell';
import { fetchProfile, saveProfile, toForm } from './applicationForm/api';
import { FieldGroup, FormError, Section, StepButtons } from './applicationForm/fields';
import { PARTY_FIELDS, PERSON_FIELDS } from './applicationForm/options';
import { hasErrors, validatePerson } from './applicationForm/validators';

const FIELDS = PARTY_FIELDS.PROFILE.map(([f]) => f);
const REQUIRED = PARTY_FIELDS.PROFILE.filter(([, r]) => r).map(([f]) => f);

// Same fields as PARTY_FIELDS.PROFILE, grouped so related details sit together (four per row)
const GROUPS = [
    ['Name', ['first_name', 'middle_name', 'last_name', 'name_extension']],
    ['Personal details', ['gender', 'civil_status', 'date_of_birth', 'birth_place']],
    ['Contact and identification', ['mobile_number', 'citizenship', 'sss_no', 'tin']],
];

const ProfilePage = () => {
    const { session } = UserAuth();
    const userId = session?.user?.id;
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

    return (
        <ApplicantShell>
          <div className="ct-sheet ct-sheet-profile">
            <div className="ct-titleblock">
                <div><small>Applicant</small><strong>My profile</strong></div>
                <div><small>Email</small><strong style={{ fontSize: '1rem', fontStretch: '100%' }}>{session?.user?.email}</strong></div>
            </div>
            <div className="ct-sheet-body">
            <p>
                {applyNext
                    ? 'Please complete your profile before applying. We use it to fill in your loan application for you.'
                    : 'These details are used to fill in your loan applications.'}
            </p>
            <form onSubmit={handleSubmit}>
                {GROUPS.map(([title, fields]) => (
                    <Section key={title} title={title}>
                        <FieldGroup config={PERSON_FIELDS} fields={fields} required={REQUIRED}
                            values={form} errors={errors} prefix="PROFILE-"
                            onChange={(f, v) => setForm((p) => ({ ...p, [f]: v }))} />
                    </Section>
                ))}
                <FormError error={error} />
                <StepButtons onBack={() => navigate('/applicantHomePage')} saving={saving} nextLabel={applyNext ? 'Save and start application' : 'Save profile'} />
            </form>
            </div>
          </div>
        </ApplicantShell>
    );
};

export default ProfilePage;
