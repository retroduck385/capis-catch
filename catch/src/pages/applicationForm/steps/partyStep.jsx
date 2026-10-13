// Spouse and each co-borrower share this step. The spouse step always shows and starts with
// "Are you married?", which reads and writes the principal's civil status.
import { useState } from 'react';
import { deleteParty, getAddress, getParty, toForm, updateParty, upsertAddress, upsertParty } from '../api';
import { AddressFields, Field, FormError, PersonFields, Section, StepButtons, YesNo } from '../fields';
import { ADDRESS_KEYS, CIVIL_STATUSES, PARTY_FIELDS, partyLabel } from '../options';
import useEmploymentForm from '../useEmploymentForm';
import { hasErrors, validateAddress, validatePerson } from '../validators';
import EmploymentSection from './employmentSection';

const NOT_MARRIED = CIVIL_STATUSES.filter((o) => o.value !== 'MARRIED');

const PartyStep = ({ app, role, partyNo = 1, onSaved, onBack }) => {
    const principal = getParty(app, 'PRINCIPAL');
    const party = getParty(app, role, partyNo);
    const isSpouse = role === 'SPOUSE';
    const label = partyLabel({ role, party_no: partyNo });
    const fields = PARTY_FIELDS[role].map(([f]) => f);

    // Spouse: true | false | null (not answered yet), from the principal's civil status.
    // Co-borrowers always show the form, so it's just true for them.
    const [married, setMarried] = useState(() => {
        if (!isSpouse || !principal?.civil_status) return isSpouse ? null : true;
        return principal.civil_status === 'MARRIED';
    });
    const [civilStatus, setCivilStatus] = useState(
        principal?.civil_status && principal.civil_status !== 'MARRIED' ? principal.civil_status : '');
    const [person, setPerson] = useState(() => toForm(party, fields));
    const [address, setAddress] = useState(() => {
        const saved = getAddress(party, 'PRESENT');
        return { ...toForm(saved, ADDRESS_KEYS), same_as_principal: saved ? saved.same_as_principal : true };
    });
    const employment = useEmploymentForm(party, role);
    const [errors, setErrors] = useState({ person: {}, address: {}, civilStatus: null });
    const [error, setError] = useState(null);
    const [saving, setSaving] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (married === null) {
            setError('Please answer whether you are married.');
            return;
        }

        if (!married) {
            if (!civilStatus) {
                setErrors((x) => ({ ...x, civilStatus: 'Please choose your civil status' }));
                return;
            }
            if (party && !window.confirm('This will remove the spouse information you entered. Continue?')) return;
            setSaving(true);
            setError(null);
            try {
                if (principal.civil_status !== civilStatus) await updateParty(principal.id, { civil_status: civilStatus });
                if (party) await deleteParty(app.id, role);
                await onSaved();
            } catch (err) {
                setError(err.message);
            } finally {
                setSaving(false);
            }
            return;
        }

        const found = { person: validatePerson(person, role), address: validateAddress(address, 'PRESENT'), civilStatus: null };
        const jobValid = employment.validate();
        setErrors(found);
        if (hasErrors(found.person) || hasErrors(found.address) || !jobValid) return;

        setSaving(true);
        setError(null);
        try {
            if (isSpouse && principal.civil_status !== 'MARRIED') await updateParty(principal.id, { civil_status: 'MARRIED' });
            const saved = await upsertParty(app.id, role, person, partyNo);
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
            {isSpouse && (
                <Section title="Are you married?">
                    <YesNo name="married" value={married} onChange={setMarried} />
                    {married === false && (
                        <Field name="civil_status" label="Civil Status" required options={NOT_MARRIED}
                            value={civilStatus} error={errors.civilStatus} onChange={(_, v) => setCivilStatus(v)} />
                    )}
                    {married === false && party && (
                        <p className="text-sm">Saving will remove the spouse details you entered.</p>
                    )}
                </Section>
            )}

            {married && (
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
