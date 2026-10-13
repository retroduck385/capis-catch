// Department Head: create a login for an employee and choose their role
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Field, FormError, Section } from '../applicationForm/fields';
import { ROLE_LABELS, STAFF_ROLES } from '../../roles';
import { createStaffAccount, fetchStaffAccounts } from './api';

const ROLE_OPTIONS = STAFF_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }));
const MIN_PASSWORD = 8;
const EMPTY = { email: '', password: '', role: '' };

const validate = (form) => {
    const errors = {};
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) errors.email = 'Enter a valid email address';
    if (form.password.length < MIN_PASSWORD) errors.password = `At least ${MIN_PASSWORD} characters`;
    if (!form.role) errors.role = 'Choose a role';
    return errors;
};

const StaffAccountsPage = () => {
    const [form, setForm] = useState(EMPTY);
    const [errors, setErrors] = useState({});
    const [accounts, setAccounts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const [notice, setNotice] = useState(null);

    const loadAccounts = () => fetchStaffAccounts()
        .then(setAccounts)
        .catch((err) => setError(err.message));

    useEffect(() => {
        loadAccounts().finally(() => setLoading(false));
    }, []);

    const handleChange = (f, v) => setForm((p) => ({ ...p, [f]: v }));

    const handleSubmit = async (e) => {
        e.preventDefault();
        const found = validate(form);
        setErrors(found);
        if (Object.keys(found).length) return;

        setSaving(true);
        setError(null);
        setNotice(null);
        try {
            const email = form.email.trim();
            const { existing } = await createStaffAccount(email, form.password, form.role);
            setNotice(existing
                ? `${email} already had a login, so it keeps its current password. It now has the ${ROLE_LABELS[form.role]} role.`
                : `Account created for ${email} (${ROLE_LABELS[form.role]}). Give them the temporary password so they can log in.`);
            setForm(EMPTY);
            await loadAccounts();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="max-w-3xl m-auto p-4 text-left">
            <h2>Staff Accounts</h2>
            <p className="py-2">Create a login for an employee and choose the role they will work under.</p>

            <form onSubmit={handleSubmit}>
                <Section title="Add Account">
                    <Field name="email" label="Email" type="email" required
                        value={form.email} error={errors.email} onChange={handleChange} />
                    <Field name="password" label="Temporary Password" required
                        value={form.password} error={errors.password} onChange={handleChange} />
                    <Field name="role" label="Role" required options={ROLE_OPTIONS}
                        value={form.role} error={errors.role} onChange={handleChange} />
                </Section>
                <FormError error={error} />
                {notice && <p className="text-green-700 py-2">{notice}</p>}
                <button type="submit" disabled={saving} className="border px-4 py-3">
                    {saving ? 'Creating...' : 'Add Account'}
                </button>
            </form>

            <Section title="Existing Staff Accounts">
                {loading ? <p>Loading accounts...</p> : accounts.length === 0 ? <p>No staff accounts yet.</p> : (
                    <table className="w-full text-left">
                        <thead>
                            <tr><th>Email</th><th>Name</th><th>Role</th><th>Created</th></tr>
                        </thead>
                        <tbody>
                            {accounts.map((a) => (
                                <tr key={a.user_id} className="border-t">
                                    <td className="py-1">{a.email}</td>
                                    <td>{a.name ?? 'Profile not completed'}</td>
                                    <td>{ROLE_LABELS[a.role] ?? a.role}{!a.is_active && ' (inactive)'}</td>
                                    <td>{new Date(a.created_at).toLocaleDateString()}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </Section>

            <p><Link to="/adminHomePage" className="underline">Back to home</Link></p>
        </div>
    );
};

export default StaffAccountsPage;
