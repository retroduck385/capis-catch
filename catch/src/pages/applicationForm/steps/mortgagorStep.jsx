import { useState } from 'react';
import { deleteParty, getAddress, getParty, toForm, upsertAddress, upsertParty } from '../api';
import { AddressFields, FormError, PersonCards, Section, StepButtons, YesNo } from '../fields';
import { ADDRESS_FIELDS, PARTY_FIELDS } from '../options';
import { hasErrors, validateAddress, validatePerson } from '../validators';

const CONTACT_ADDRESS_KEYS = Object.keys(ADDRESS_FIELDS);

const MortgagorStep = ({ app, onSaved, onBack }) => {
    const mortgagor = getParty(app, 'MORTGAGOR');
    const aif = getParty(app, 'ATTORNEY_IN_FACT');

    // null = not answered yet
    const [hasMortgagor, setHasMortgagor] = useState(mortgagor ? true : null);
    const [hasAif, setHasAif] = useState(aif ? true : null);
    const [mortgagorForm, setMortgagorForm] = useState(() => toForm(mortgagor, PARTY_FIELDS.MORTGAGOR.map(([f]) => f)));
    const [aifForm, setAifForm] = useState(() => toForm(aif, PARTY_FIELDS.ATTORNEY_IN_FACT.map(([f]) => f)));
    const [aifAddress, setAifAddress] = useState(() => toForm(getAddress(aif, 'PRESENT'), CONTACT_ADDRESS_KEYS));
    const [errors, setErrors] = useState({ mortgagor: {}, aif: {}, aifAddress: {} });
    const [error, setError] = useState(null);
    const [saving, setSaving] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (hasMortgagor === null || hasAif === null) {
            setError('Please answer both questions.');
            return;
        }
        const found = {
            mortgagor: hasMortgagor ? validatePerson(mortgagorForm, 'MORTGAGOR') : {},
            aif: hasAif ? validatePerson(aifForm, 'ATTORNEY_IN_FACT') : {},
            aifAddress: hasAif ? validateAddress(aifAddress, 'CONTACT') : {},
        };
        setErrors(found);
        if (Object.values(found).some(hasErrors)) return;

        setSaving(true);
        setError(null);
        try {
            if (hasMortgagor) await upsertParty(app.id, 'MORTGAGOR', mortgagorForm);
            else if (mortgagor) await deleteParty(app.id, 'MORTGAGOR');

            if (hasAif) {
                const saved = await upsertParty(app.id, 'ATTORNEY_IN_FACT', aifForm);
                await upsertAddress(saved.id, 'PRESENT', aifAddress);
            } else if (aif) {
                await deleteParty(app.id, 'ATTORNEY_IN_FACT');
            }
            await onSaved();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} noValidate>
            <Section title="Mortgagor">
                <p>Is the mortgagor (registered owner putting up the property) someone other than you?</p>
                <YesNo name="has-mortgagor" value={hasMortgagor} onChange={setHasMortgagor} />
            </Section>
            {hasMortgagor && (
                <PersonCards role="MORTGAGOR" values={mortgagorForm} errors={errors.mortgagor} firstTitle="Mortgagor's Information"
                    onChange={(f, v) => setMortgagorForm((m) => ({ ...m, [f]: v }))} />
            )}

            <Section title="Attorney-in-Fact">
                <p>Will an attorney-in-fact act on your behalf (e.g. you are an OFW or seafarer)?</p>
                <YesNo name="has-aif" value={hasAif} onChange={setHasAif} />
            </Section>
            {hasAif && (
                <>
                    <PersonCards role="ATTORNEY_IN_FACT" values={aifForm} errors={errors.aif} firstTitle="Attorney-in-Fact's Information"
                        onChange={(f, v) => setAifForm((a) => ({ ...a, [f]: v }))} />
                    <Section title="Attorney-in-Fact's Present Address" className="ct-cols-4">
                        <AddressFields kind="CONTACT" idPrefix="aif" values={aifAddress} errors={errors.aifAddress}
                            onChange={(f, v) => setAifAddress((a) => ({ ...a, [f]: v }))} />
                    </Section>
                </>
            )}
            <FormError error={error} />
            <StepButtons onBack={onBack} saving={saving} />
        </form>
    );
};

export default MortgagorStep;
