// Plain inputs for the application form. Styling is placeholder until the UI pass.
import { ADDRESS_FIELDS, EMPLOYMENT_FIELDS, EMPLOYMENT_KEYS, EMPLOYMENT_TYPES, HOME_OWNERSHIP, PARTY_FIELDS, PERSON_FIELDS } from './options';

export const Field = ({ name, label, value, onChange, error, required, type = 'text', options, placeholder, disabled }) => {
    if (type === 'checkbox') {
        return (
            <label className="flex gap-2 items-center py-2 text-left">
                <input type="checkbox" checked={!!value} disabled={disabled}
                    onChange={(e) => onChange(name, e.target.checked)} />
                {label}
            </label>
        );
    }

    return (
        <div className="flex flex-col py-2 text-left">
            <label htmlFor={name}>
                {label}{required && <span className="text-red-600"> *</span>}
            </label>
            {options ? (
                <select id={name} className="p-2 mt-1 border" value={value ?? ''} disabled={disabled}
                    onChange={(e) => onChange(name, e.target.value)}>
                    <option value="">-- Select --</option>
                    {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
            ) : (
                <input id={name} className="p-2 mt-1 border" type={type} value={value ?? ''}
                    placeholder={placeholder} disabled={disabled} step={type === 'number' ? 'any' : undefined}
                    onChange={(e) => onChange(name, e.target.value)} />
            )}
            {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>
    );
};

// Renders fields from a config map like PERSON_FIELDS; `required` is a list of required keys
export const FieldGroup = ({ config, fields, values, errors = {}, required = [], onChange, prefix = '' }) => (
    <>
        {fields.map((f) => (
            <Field key={f} name={prefix + f} {...config[f]}
                value={values[f]} error={errors[f]} required={required.includes(f)}
                onChange={(_, v) => onChange(f, v)} />
        ))}
    </>
);

export const Section = ({ title, children }) => (
    <fieldset className="border p-4 my-4 text-left">
        <legend className="font-semibold px-1">{title}</legend>
        {children}
    </fieldset>
);

export const PersonFields = ({ role, values, errors, onChange }) => {
    const fields = PARTY_FIELDS[role].map(([f]) => f);
    const required = PARTY_FIELDS[role].filter(([, r]) => r).map(([f]) => f);
    return <FieldGroup config={PERSON_FIELDS} fields={fields} required={required}
        values={values} errors={errors} onChange={onChange} prefix={`${role}-`} />;
};

// kind: PRESENT | PERMANENT | EMPLOYER | CONTACT (matches validateAddress)
export const AddressFields = ({ kind, values, errors, onChange, idPrefix }) => {
    const required = ['building_street', 'subdivision_barangay', 'municipality_city', 'province',
        ...(kind === 'EMPLOYER' ? [] : ['zip_code'])];
    return (
        <>
            <FieldGroup config={ADDRESS_FIELDS} fields={Object.keys(ADDRESS_FIELDS)} required={required}
                values={values} errors={errors} onChange={onChange} prefix={`${idPrefix}-`} />
            {kind === 'PRESENT' && (
                <>
                    <Field name={`${idPrefix}-living_in_ph`} type="checkbox" label="Living in the Philippines?"
                        value={values.living_in_ph} onChange={(_, v) => onChange('living_in_ph', v)} />
                    <Field name={`${idPrefix}-home_ownership`} label="Home Ownership" options={HOME_OWNERSHIP} required
                        value={values.home_ownership} error={errors.home_ownership}
                        onChange={(_, v) => onChange('home_ownership', v)} />
                    {values.home_ownership === 'RENTED' && (
                        <Field name={`${idPrefix}-monthly_rent`} label="Monthly Rent (PHP)" type="number" required
                            value={values.monthly_rent} error={errors.monthly_rent}
                            onChange={(_, v) => onChange('monthly_rent', v)} />
                    )}
                </>
            )}
            {(kind === 'PRESENT' || kind === 'PERMANENT') && (
                <Field name={`${idPrefix}-date_move_in`} label="Date of Move-In" type="date" required
                    value={values.date_move_in} error={errors.date_move_in}
                    onChange={(_, v) => onChange('date_move_in', v)} />
            )}
        </>
    );
};

export const EmploymentFields = ({ role, values, errors, onChange }) => {
    const config = {
        ...EMPLOYMENT_FIELDS,
        employment_type: {
            ...EMPLOYMENT_FIELDS.employment_type,
            options: role === 'SPOUSE' ? EMPLOYMENT_TYPES : EMPLOYMENT_TYPES.filter((o) => o.value !== 'UNEMPLOYED'),
        },
    };
    const unemployed = values.employment_type === 'UNEMPLOYED';
    const fields = unemployed ? ['employment_type'] : EMPLOYMENT_KEYS;
    const required = ['employment_type', 'employer_business_name', 'occupation', 'employment_date',
        'contact_number', 'gross_monthly_income'];
    return <FieldGroup config={config} fields={fields} required={required}
        values={values} errors={errors} onChange={onChange} prefix={`${role}-job-`} />;
};

// Editable list of rows (bank accounts, loans, cards)
export const RowList = ({ title, config, rows, errors = [], onChange, emptyRow }) => {
    const update = (i, field, value) => onChange(rows.map((r, j) => (j === i ? { ...r, [field]: value } : r)));
    return (
        <Section title={title}>
            {rows.length === 0 && <p className="italic">None added.</p>}
            {rows.map((row, i) => (
                <div key={i} className="border-b pb-2 mb-2">
                    <FieldGroup config={config} fields={Object.keys(config)} required={Object.keys(config).filter((f) => config[f].type !== 'checkbox')}
                        values={row} errors={errors[i]} onChange={(f, v) => update(i, f, v)} prefix={`${title}-${i}-`} />
                    <button type="button" className="border px-3 py-1" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                        Remove
                    </button>
                </div>
            ))}
            <button type="button" className="border px-3 py-1" onClick={() => onChange([...rows, { ...emptyRow }])}>
                + Add
            </button>
        </Section>
    );
};

export const StepButtons = ({ onBack, saving, nextLabel = 'Save & Continue', disabled }) => (
    <div className="flex justify-between py-4">
        {onBack ? <button type="button" className="border px-4 py-2" onClick={onBack}>Back</button> : <span />}
        <button type="submit" className="border px-4 py-2" disabled={saving || disabled}>
            {saving ? 'Saving...' : nextLabel}
        </button>
    </div>
);

export const FormError = ({ error }) => (error ? <p className="text-red-600 py-2">{error}</p> : null);
