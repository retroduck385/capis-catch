// Master profile: the applicant's own details, filled in once and used to pre-fill
// the Principal Borrower step of every new application. Required before applying.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { UserAuth } from '../context/authContext';
import { fetchProfile, saveProfile, toForm } from './applicationForm/api';
import { FormError, PersonFields, Section, StepButtons } from './applicationForm/fields';
import { PARTY_FIELDS } from './applicationForm/options';
import { hasErrors, validatePerson } from './applicationForm/validators';

const FIELDS = PARTY_FIELDS.PROFILE.map(([f]) => f);

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

    if (loading) return <p>Loading profile...</p>;

    return (
        <div className="max-w-3xl m-auto p-4 text-left">
            <h2>My Profile</h2>
            <p className="py-2">
                {applyNext
                    ? 'Please complete your profile before applying. We use it to fill in your loan application for you.'
                    : 'These details are used to fill in your loan applications.'}
            </p>
            <p className="text-sm">Email: {session?.user?.email}</p>
            <form onSubmit={handleSubmit}>
                <Section title="Personal Information">
                    <PersonFields role="PROFILE" values={form} errors={errors}
                        onChange={(f, v) => setForm((p) => ({ ...p, [f]: v }))} />
                </Section>
                <FormError error={error} />
                <StepButtons saving={saving} nextLabel={applyNext ? 'Save & Start Application' : 'Save Profile'} />
            </form>
            <p><Link to="/applicantHomePage" className="underline">Back to home</Link></p>
        </div>
    );
};

export default ProfilePage;
