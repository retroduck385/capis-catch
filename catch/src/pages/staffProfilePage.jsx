// Staff profile: name + mobile number, shown wherever a staff member is assigned or acts
// (work tray, status notes). Required before a staff account can use the app.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { UserAuth } from '../context/authContext';
import { fetchProfile, saveProfile, toForm } from './applicationForm/api';
import { FormError, PersonFields, Section, StepButtons } from './applicationForm/fields';
import { PARTY_FIELDS } from './applicationForm/options';
import { ROLE_LABELS } from '../roles';
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
        <div style={{ maxWidth: "48rem", margin: "0 auto" }}>
            <div className="ct-pagehead">
                <div>
                    <h1>My profile</h1>
                    <p>
                        {firstTime
                            ? "Please complete your profile first. Your name is shown on the applications you are assigned to."
                            : "Your name is shown on the applications you are assigned to."}
                    </p>
                </div>
                <span className="ct-badge plain">{ROLE_LABELS[role] ?? role}</span>
            </div>
            <div className="ct-card">
                <div className="ct-titleblock">
                    <div><small>Signed in as</small><strong style={{ fontSize: "0.85rem" }}>{session?.user?.email}</strong></div>
                </div>
                <div className="ct-sheet-body">
                    <form onSubmit={handleSubmit}>
                        <Section title="Personal Information">
                            <PersonFields role="STAFF_PROFILE" values={form} errors={errors}
                                onChange={(f, v) => setForm((p) => ({ ...p, [f]: v }))} />
                        </Section>
                        <FormError error={error} />
                        <StepButtons saving={saving} nextLabel="Save profile" />
                    </form>
                </div>
            </div>
            {!firstTime && <p style={{ marginTop: "1rem" }}><Link to="/adminHomePage" className="ct-link">Back to work tray</Link></p>}
        </div>
    );
};

export default StaffProfilePage;
