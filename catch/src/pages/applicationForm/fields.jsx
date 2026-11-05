// Inputs for the application form. Look and feel come from the .ct rules in applicant.css.
import { useState } from 'react';
import {
    ADDRESS_FIELDS, EMPLOYMENT_FIELDS, EMPLOYMENT_KEYS, EMPLOYMENT_TYPES, formatMoney, HOME_OWNERSHIP, PARTY_FIELDS,
    parseMoney, PERSON_FIELDS,
} from './options';

// Shows commas while typing (1,500,000.5) and always 2 decimals once you leave the box (1,500,000.50).
// The value passed to onChange has no commas, so validators and Postgres get a plain number.
const MoneyInput = ({ id, value, onChange, placeholder, disabled, ...aria }) => {
    const [focused, setFocused] = useState(false);
    return (
        <input id={id} type="text" inputMode="decimal"
            value={formatMoney(value, { fixed: !focused })} placeholder={placeholder ?? '0.00'} disabled={disabled}
            onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} {...aria}
            onChange={(e) => onChange(parseMoney(e.target.value))} />
    );
};

export const Field = ({ name, label, value, onChange, error, required, type = 'text', options, placeholder, disabled, hint }) => {
    if (type === 'checkbox') {
        return (
            <label className="ct-check">
                <input type="checkbox" checked={!!value} disabled={disabled}
                    onChange={(e) => onChange(name, e.target.checked)} />
                {label}
            </label>
        );
    }

    // Ties the error text to its input so screen readers announce it with the field
    const describedBy = [hint && `${name}-hint`, error && `${name}-error`].filter(Boolean).join(' ');
    const aria = { ...(error ? { 'aria-invalid': true } : {}), ...(describedBy ? { 'aria-describedby': describedBy } : {}) };
    return (
        <div className="ct-field">
            <label htmlFor={name}>
                {label}{required && <span className="text-red-600"> *</span>}
            </label>
            {options ? (
                <select id={name} value={value ?? ''} disabled={disabled} {...aria}
                    onChange={(e) => onChange(name, e.target.value)}>
                    <option value="">Select one</option>
                    {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
            ) : type === 'money' ? (
                <MoneyInput id={name} value={value} placeholder={placeholder} disabled={disabled} {...aria}
                    onChange={(v) => onChange(name, v)} />
            ) : (
                <input id={name} type={type} value={value ?? ''}
                    placeholder={placeholder} disabled={disabled} step={type === 'number' ? 'any' : undefined} {...aria}
                    onChange={(e) => onChange(name, e.target.value)} />
            )}
            {hint && <p id={`${name}-hint`} className="ct-hint">{hint}</p>}
            {error && <p id={`${name}-error`} className="ct-fielderr">{error}</p>}
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

export const Section = ({ title, children, className = '' }) => (
    <fieldset className={`ct-section ${className}`.trim()}>
        <legend>{title}</legend>
        {children}
    </fieldset>
);

export const PersonFields = ({ role, values, errors, onChange }) => {
    const fields = PARTY_FIELDS[role].map(([f]) => f);
    const required = PARTY_FIELDS[role].filter(([, r]) => r).map(([f]) => f);
    return <FieldGroup config={PERSON_FIELDS} fields={fields} required={required}
        values={values} errors={errors} onChange={onChange} prefix={`${role}-`} />;
};

// A person's fields as cards of up to four per row. Each group shows only the fields that role has, so the same
// cards serve spouse, co-borrower, mortgagor and attorney-in-fact. firstTitle renames the first card.
const PERSON_CARDS = [
    ['Name', ['first_name', 'middle_name', 'last_name', 'name_extension']],
    ['Personal details', ['relationship_to_principal', 'gender', 'maiden_name', 'civil_status', 'date_of_birth', 'birth_place']],
    ['Contact', ['mobile_number', 'email_address']],
    ['Citizenship and government IDs', ['citizenship', 'sss_no', 'tin']],
];

export const PersonCards = ({ role, values, errors, onChange, firstTitle }) => {
    const all = PARTY_FIELDS[role].map(([f]) => f);
    const required = PARTY_FIELDS[role].filter(([, r]) => r).map(([f]) => f);
    return PERSON_CARDS.map(([title, keys], i) => {
        const shown = keys.filter((k) => all.includes(k));
        if (shown.length === 0) return null;
        const heading = i === 0 && firstTitle ? firstTitle : (title.startsWith('Citizenship') && !shown.includes('citizenship') ? 'Government IDs' : title);
        return (
            <Section key={title} title={heading} className="ct-cols-4">
                <FieldGroup config={PERSON_FIELDS} fields={shown} required={required}
                    values={values} errors={errors} onChange={onChange} prefix={`${role}-`} />
            </Section>
        );
    });
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
                        <Field name={`${idPrefix}-monthly_rent`} label="Monthly Rent (PHP)" type="money" required
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

// only (optional): show just these keys, so a caller can split the job fields across several sections
export const EmploymentFields = ({ role, values, errors, onChange, only }) => {
    const config = {
        ...EMPLOYMENT_FIELDS,
        employment_type: {
            ...EMPLOYMENT_FIELDS.employment_type,
            options: role === 'SPOUSE' ? EMPLOYMENT_TYPES : EMPLOYMENT_TYPES.filter((o) => o.value !== 'UNEMPLOYED'),
        },
    };
    const unemployed = values.employment_type === 'UNEMPLOYED';
    const fields = unemployed ? ['employment_type'] : EMPLOYMENT_KEYS;
    const shown = only ? fields.filter((f) => only.includes(f)) : fields;
    const required = ['employment_type', 'employer_business_name', 'occupation', 'employment_date',
        'contact_number', 'gross_monthly_income'];
    return <FieldGroup config={config} fields={shown} required={required}
        values={values} errors={errors} onChange={onChange} prefix={`${role}-job-`} />;
};

// Editable list of rows (bank accounts, loans, cards)
export const RowList = ({ title, config, rows, errors = [], onChange, emptyRow }) => {
    const update = (i, field, value) => onChange(rows.map((r, j) => (j === i ? { ...r, [field]: value } : r)));
    return (
        <Section title={title}>
            {rows.length === 0 && <p className="italic">Nothing added yet.</p>}
            {rows.map((row, i) => (
                <div key={i} className="ct-row">
                    <FieldGroup config={config} fields={Object.keys(config)} required={Object.keys(config).filter((f) => config[f].type !== 'checkbox')}
                        values={row} errors={errors[i]} onChange={(f, v) => update(i, f, v)} prefix={`${title}-${i}-`} />
                    <button type="button" style={{ marginTop: '0.75rem' }} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                        Remove
                    </button>
                </div>
            ))}
            <button type="button" style={{ marginTop: '0.75rem' }} onClick={() => onChange([...rows, { ...emptyRow }])}>
                + Add
            </button>
        </Section>
    );
};

export const StepButtons = ({ onBack, saving, nextLabel = 'Save and continue', disabled }) => (
    <div className="ct-actions">
        {onBack ? <button type="button" onClick={onBack}>Back</button> : <span />}
        <button type="submit" disabled={saving || disabled}>
            {saving ? 'Saving...' : nextLabel}
        </button>
    </div>
);

export const FormError = ({ error }) => (error ? <p className="ct-error" role="alert">{error}</p> : null);

// value: true | false | null (not answered yet)
export const YesNo = ({ name, value, onChange }) => (
    <div className="py-2">
        <label className="pr-4">
            <input type="radio" name={name} checked={value === true} onChange={() => onChange(true)} /> Yes
        </label>
        <label>
            <input type="radio" name={name} checked={value === false} onChange={() => onChange(false)} /> No
        </label>
    </div>
);
