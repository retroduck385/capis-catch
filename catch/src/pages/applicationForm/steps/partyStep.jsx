// Spouse (required when principal is married) and co-borrower (optional) share this step
import { useState } from 'react';
import { deleteParty, getAddress, getParty, toForm, upsertAddress, upsertParty } from '../api';
import { AddressFields, Field, FormError, PersonFields, Section, StepButtons } from '../fields';
import { ADDRESS_KEYS, PARTY_FIELDS, PARTY_LABELS } from '../options';
import useEmploymentForm from '../useEmploymentForm';
import { hasErrors, validateAddress, validatePerson } from '../validators';
import EmploymentSection from './employmentSection';

const PartyStep = ({ app, role, optional, onSaved, onBack }) => {
    const party = getParty(app, role);
    const label = PARTY_LABELS[role];
    const fields = PARTY_FIELDS[role].map(([f]) => f);

    // Optional parties need an explicit yes/no; null = not answered yet
    const [included, setIncluded] = useState(optional ? (party ? true : null) : true);
    const [person, setPerson] = useState(() => toForm(party, fields));
    const [address, setAddress] = useState(() => {
        const saved = getAddress(party, 'PRESENT');
        return { ...toForm(saved, ADDRESS_KEYS), same_as_principal: saved ? saved.same_as_principal : true };
    });
    const employment = useEmploymentForm(party, role);
    const [errors, setErrors] = useState({ person: {}, address: {} });
    const [error, setError] = useState(null);
    const [saving, setSaving] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (included === null) {
            setError(`Please answer whether you have a ${label.toLowerCase()}.`);
            return;
        }

        setSaving(true);
        setError(null);
        try {
            if (!included) {
                if (party) await deleteParty(app.id, role);
                await onSaved();
                return;
            }

            const found = { person: validatePerson(person, role), address: validateAddress(address, 'PRESENT') };
            const jobValid = employment.validate();
            setErrors(found);
            if (hasErrors(found.person) || hasErrors(found.address) || !jobValid) return;

            const saved = await upsertParty(app.id, role, person);
            if (address.same_as_principal) {
                const cleared = Object.fromEntries(ADDRESS_KEYS.map((k) => [k, null]));
                await upsertAddress(saved.id, 'PRESENT', { ...cleared, same_as_principal: true });
            } else {
                const rent = address.home_ownership === 'RENTED' ? address.monthly_rent : null;
                await upsertAddress(saved.id, 'PRESENT', { ...address, monthly_rent: rent });
            }
            await employment.save(saved.id);
            await onSaved();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <form onSubmit={handleSubmit}>
            {optional && (
                <Section title={`Do you have a ${label.toLowerCase()}?`}>
                    <label className="pr-4">
                        <input type="radio" name={`${role}-included`} checked={included === true}
                            onChange={() => setIncluded(true)} /> Yes
                    </label>
                    <label>
                        <input type="radio" name={`${role}-included`} checked={included === false}
                            onChange={() => setIncluded(false)} /> No
                    </label>
                    {included === false && party && (
                        <p className="text-sm">Saving will remove the {label.toLowerCase()} details you entered.</p>
                    )}
                </Section>
            )}

            {included && (
                <>
                    <Section title={`${label}'s Information`}>
                        <PersonFields role={role} values={person} errors={errors.person}
                            onChange={(f, v) => setPerson((p) => ({ ...p, [f]: v }))} />
                    </Section>
                    <Section title={`${label}'s Address`}>
                        <Field name={`${role}-same_as_principal`} type="checkbox"
                            label="Same as Principal Borrower's present address?"
                            value={address.same_as_principal}
                            onChange={(_, v) => setAddress((a) => ({ ...a, same_as_principal: v }))} />
                        {!address.same_as_principal && (
                            <AddressFields kind="PRESENT" idPrefix={`${role}-present`} values={address}
                                errors={errors.address}
                                onChange={(f, v) => setAddress((a) => ({ ...a, [f]: v }))} />
                        )}
                    </Section>
                    <EmploymentSection title={`${label}'s Employment Information`} employment={employment} />
                </>
            )}
            <FormError error={error} />
            <StepButtons onBack={onBack} saving={saving} />
        </form>
    );
};

export default PartyStep;
