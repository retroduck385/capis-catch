// Staff profile: name + mobile number, shown wherever a staff member is assigned or acts
// (work tray, status notes). Required before a staff account can use the app.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { UserAuth } from '../context/authContext';
import { fetchProfile, saveProfile, toForm } from './applicationForm/api';
import { FormError, PersonFields, Section, StepButtons } from './applicationForm/fields';
import { PARTY_FIELDS } from './applicationForm/options';
import { hasErrors, isProfileComplete, validatePerson } from './applicationForm/validators';

const FIELDS = PARTY_FIELDS.STAFF_PROFILE.map(([f]) => f);

const StaffProfilePage = () => {
    const { session, role } = UserAuth();
    const userId = session?.user?.id;
    const navigate = useNavigate();

    const [form, setForm] = useState(() => toForm(null, FIELDS));
    const [firstTime, setFirstTime] = useState(false);
    const [errors, setErrors] = useState({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!userId) return;
        fetchProfile(userId)
            .then((profile) => {
                setForm(toForm(profile, FIELDS));
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

    return (
        <div className="max-w-3xl m-auto p-4 text-left">
            <h2>My Profile</h2>
            <p className="py-2">
                {firstTime
                    ? 'Please complete your profile first. Your name is shown on the applications you are assigned to.'
                    : 'Your name is shown on the applications you are assigned to.'}
            </p>
            <p className="text-sm">Email: {session?.user?.email} ({role})</p>
            <form onSubmit={handleSubmit}>
                <Section title="Personal Information">
                    <PersonFields role="STAFF_PROFILE" values={form} errors={errors}
                        onChange={(f, v) => setForm((p) => ({ ...p, [f]: v }))} />
                </Section>
                <FormError error={error} />
                <StepButtons saving={saving} nextLabel="Save Profile" />
            </form>
            {!firstTime && <p><Link to="/adminHomePage" className="underline">Back to home</Link></p>}
        </div>
    );
};

export default StaffProfilePage;
