import { useState } from 'react';
import { one, toForm, upsertCollateral, upsertReferral } from '../api';
import { FieldGroup, FormError, Section, StepButtons } from '../fields';
import { COLLATERAL_FIELDS, REFERRAL_FIELDS } from '../options';
import { hasErrors, validateCollateral, validateReferral } from '../validators';

const CollateralStep = ({ app, onSaved, onBack }) => {
    const [collateral, setCollateral] = useState(() =>
        toForm(one(app.collateral_details), Object.keys(COLLATERAL_FIELDS)));
    const [referral, setReferral] = useState(() =>
        toForm(one(app.referral_details), Object.keys(REFERRAL_FIELDS)));
    const [errors, setErrors] = useState({ collateral: {}, referral: {} });
    const [error, setError] = useState(null);
    const [saving, setSaving] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        const found = { collateral: validateCollateral(collateral), referral: validateReferral(referral) };
        setErrors(found);
        if (hasErrors(found.collateral) || hasErrors(found.referral)) return;

        setSaving(true);
        setError(null);
        try {
            await upsertCollateral(app.id, collateral);
            await upsertReferral(app.id, referral);
            await onSaved();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <form onSubmit={handleSubmit}>
            <Section title="Collateral Details">
                <FieldGroup config={COLLATERAL_FIELDS} fields={Object.keys(COLLATERAL_FIELDS)}
                    required={['property_type', 'selling_price', 'registered_owner']}
                    values={collateral} errors={errors.collateral} prefix="collateral-"
                    onChange={(f, v) => setCollateral((c) => ({ ...c, [f]: v }))} />
            </Section>
            <Section title="Referral Details">
                <FieldGroup config={REFERRAL_FIELDS} fields={Object.keys(REFERRAL_FIELDS)}
                    required={referral.channel === 'DEVELOPER' ? ['channel', 'developer_name'] : ['channel']}
                    values={referral} errors={errors.referral} prefix="referral-"
                    onChange={(f, v) => setReferral((r) => ({ ...r, [f]: v }))} />
            </Section>
            <FormError error={error} />
            <StepButtons onBack={onBack} saving={saving} />
        </form>
    );
};

export default CollateralStep;
