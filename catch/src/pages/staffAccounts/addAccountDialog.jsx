// "Add account" dialog: email, temporary password and a role picked from cards. Same validation and the same
// createStaffAccount() call as before; only the presentation changed.
import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, RefreshCw } from 'lucide-react';
import { ROLE_LABELS, STAFF_ROLES } from '../../roles';
import { APPROVAL_POSITIONS } from '../review/approval';
import { createStaffAccount } from './api';
import { ROLE_INFO, generatePassword } from './options';

const MIN_PASSWORD = 8;
const EMPTY = { email: '', password: '', role: '', position: '' };

const validate = (form) => {
    const errors = {};
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) errors.email = 'Enter a valid email address';
    if (form.password.length < MIN_PASSWORD) errors.password = `At least ${MIN_PASSWORD} characters`;
    if (!form.role) errors.role = 'Choose a role';
    if (form.role === 'APPROVER' && !form.position) errors.position = 'Choose the approver\'s position';
    return errors;
};

const AddAccountDialog = ({ open, onClose, onCreated }) => {
    const ref = useRef(null);
    const [form, setForm] = useState(EMPTY);
    const [errors, setErrors] = useState({});
    const [showPassword, setShowPassword] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        const dialog = ref.current;
        if (!dialog) return;
        if (open && !dialog.open) dialog.showModal();
        if (!open && dialog.open) dialog.close();
    }, [open]);

    const close = () => {
        setForm(EMPTY);
        setErrors({});
        setError(null);
        setShowPassword(false);
        onClose();
    };

    const set = (field, value) => setForm((p) => ({
        ...p, [field]: value, ...(field === 'role' && value !== 'APPROVER' ? { position: '' } : {}),
    }));

    const handleSubmit = async (e) => {
        e.preventDefault();
        const found = validate(form);
        setErrors(found);
        if (Object.keys(found).length) return;

        setSaving(true);
        setError(null);
        try {
            const email = form.email.trim();
            const { existing } = await createStaffAccount(email, form.password, form.role, form.position);
            onCreated(existing
                ? `${email} already had a login, so it keeps its current password. It now has the ${ROLE_LABELS[form.role]} role.`
                : `Account created for ${email} (${ROLE_LABELS[form.role]}). Give them the temporary password so they can log in.`);
            close();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <dialog
            ref={ref}
            className="sa-dialog"
            aria-labelledby="sa-add-title"
            onClose={close}
            onClick={(e) => { if (e.target === e.currentTarget && !saving) close(); }}>
            <form onSubmit={handleSubmit} noValidate className="sa-dialog-body">
                <h2 id="sa-add-title">Add staff account</h2>
                <p className="sa-muted">Create a login for an employee and choose the role they will work under.</p>

                <div className="sa-field">
                    <label htmlFor="sa-email">Work email</label>
                    <input id="sa-email" type="email" autoComplete="off" value={form.email}
                        aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? 'sa-email-err' : undefined}
                        onChange={(e) => set('email', e.target.value)} />
                    {errors.email && <p id="sa-email-err" className="sa-err">{errors.email}</p>}
                </div>

                <div className="sa-field">
                    <label htmlFor="sa-password">Temporary password</label>
                    <div className="sa-pw">
                        <input id="sa-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password"
                            value={form.password} aria-invalid={Boolean(errors.password)}
                            aria-describedby={errors.password ? 'sa-pw-err' : 'sa-pw-hint'}
                            onChange={(e) => set('password', e.target.value)} />
                        <button type="button" className="icon" aria-label={showPassword ? 'Hide password' : 'Show password'}
                            onClick={() => setShowPassword((s) => !s)}>
                            {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                        </button>
                        <button type="button" onClick={() => { set('password', generatePassword()); setShowPassword(true); }}>
                            <RefreshCw size={15} aria-hidden="true" />Generate
                        </button>
                    </div>
                    {errors.password
                        ? <p id="sa-pw-err" className="sa-err">{errors.password}</p>
                        : <p id="sa-pw-hint" className="sa-hint">At least {MIN_PASSWORD} characters. Give it to the employee yourself.</p>}
                </div>

                <fieldset className="sa-field sa-rolepick">
                    <legend>Role</legend>
                    <div className="sa-picks">
                        {STAFF_ROLES.map((r) => (
                            <label key={r} className="sa-pick" style={{ '--hue': ROLE_INFO[r].hue }}>
                                <input type="radio" name="sa-role" value={r} checked={form.role === r}
                                    onChange={() => set('role', r)} />
                                <span className="name">{ROLE_LABELS[r]}</span>
                                <span className="desc">{ROLE_INFO[r].blurb}</span>
                            </label>
                        ))}
                    </div>
                    {errors.role && <p className="sa-err">{errors.role}</p>}
                </fieldset>

                {form.role === 'APPROVER' && (
                    <div className="sa-field">
                        <label htmlFor="sa-position">Position (decides which approvals they sign)</label>
                        <select id="sa-position" value={form.position} aria-invalid={Boolean(errors.position)}
                            onChange={(e) => set('position', e.target.value)}>
                            <option value="">Choose a position...</option>
                            {APPROVAL_POSITIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                        </select>
                        {errors.position && <p className="sa-err">{errors.position}</p>}
                    </div>
                )}

                {error && <p className="sa-err" role="alert">{error}</p>}

                <div className="sa-dialog-actions">
                    <button type="button" onClick={close} disabled={saving}>Cancel</button>
                    <button type="submit" className="sa-primary" disabled={saving}>
                        {saving ? 'Creating...' : 'Create account'}
                    </button>
                </div>
            </form>
        </dialog>
    );
};

export default AddAccountDialog;
