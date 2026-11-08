// PLACEHOLDER for in-depth role editing: one card per staff role with sample access toggles and masked-field
// previews. Purely visual: toggles only change local state, nothing is read from or written to the database, and
// Save / Add role are disabled until this is wired up.
import { useState } from 'react';
import { Info, Plus, ShieldCheck } from 'lucide-react';
import { ROLE_LABELS, STAFF_ROLES } from '../../roles';
import { PERMISSIONS, ROLE_INFO, SAMPLE_ACCESS } from './options';

const initialState = () => Object.fromEntries(STAFF_ROLES.map((r) => [r, new Set(SAMPLE_ACCESS[r].on)]));

const Switch = ({ checked, onChange, label }) => (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="sa-switch" onClick={onChange}>
        <span />
    </button>
);

const RoleAccessPreview = ({ focusRole, counts }) => {
    const [access, setAccess] = useState(initialState);
    const dirty = STAFF_ROLES.some((r) => {
        const base = new Set(SAMPLE_ACCESS[r].on);
        return base.size !== access[r].size || [...base].some((k) => !access[r].has(k));
    });

    const toggle = (role, key) => setAccess((prev) => {
        const next = new Set(prev[role]);
        if (next.has(key)) next.delete(key); else next.add(key);
        return { ...prev, [role]: next };
    });

    return (
        <section aria-label="Roles and access">
            <div className="sa-banner" role="note">
                <Info size={18} aria-hidden="true" />
                <p>
                    <b>Design preview.</b> In-depth role editing isn't connected yet. These toggles show where field-level
                    access and masking will be set, and the values here are sample data. Nothing is saved, and what each role
                    can actually do is still decided by the database.
                </p>
            </div>

            <div className="sa-rolehead">
                <div>
                    <h2>Role access cards</h2>
                    <p className="sa-muted">Role-based data visibility with field-level privacy masking rules.</p>
                </div>
                <div className="sa-rolehead-actions">
                    {dirty && <button type="button" onClick={() => setAccess(initialState())}>Reset sample values</button>}
                    <button type="button" disabled title="Coming soon"><Plus size={16} aria-hidden="true" />Add role</button>
                    <button type="button" className="sa-primary" disabled title="Coming soon">Save changes</button>
                </div>
            </div>

            <div className="sa-roles">
                {STAFF_ROLES.map((role) => {
                    const on = access[role];
                    return (
                        <article
                            key={role}
                            id={`sa-role-${role}`}
                            className={`sa-rolecard${focusRole === role ? ' focus' : ''}`}
                            style={{ '--hue': ROLE_INFO[role].hue }}>
                            <header>
                                <div>
                                    <h3>{ROLE_LABELS[role]}</h3>
                                    <span className="level">ACCESS L{SAMPLE_ACCESS[role].level}</span>
                                </div>
                                <ShieldCheck size={18} aria-hidden="true" />
                            </header>
                            <p className="blurb">{ROLE_INFO[role].blurb}</p>
                            <ul>
                                {PERMISSIONS.map((p) => {
                                    const checked = on.has(p.key);
                                    return (
                                        <li key={p.key}>
                                            <span className="row">
                                                <span>{p.label}</span>
                                                <Switch checked={checked} label={`${p.label} for ${ROLE_LABELS[role]}`}
                                                    onChange={() => toggle(role, p.key)} />
                                            </span>
                                            {p.masked && !checked && (
                                                <span className="masked"><code>{p.masked}</code><b>MASKED</b></span>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                            <footer>{counts[role] ?? 0} {counts[role] === 1 ? 'account' : 'accounts'} in this role</footer>
                        </article>
                    );
                })}
            </div>
        </section>
    );
};

export default RoleAccessPreview;
