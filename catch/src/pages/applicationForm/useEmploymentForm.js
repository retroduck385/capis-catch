// Form state for one party's employment + employer address (principal, spouse, co-borrower)
import { useState } from 'react';
import { deleteAddress, getAddress, one, toForm, upsertAddress, upsertEmployment } from './api';
import { ADDRESS_FIELDS, EMPLOYMENT_KEYS } from './options';
import { hasErrors, validateAddress, validateEmployment } from './validators';

const EMPLOYER_ADDRESS_KEYS = Object.keys(ADDRESS_FIELDS);

const useEmploymentForm = (party, role) => {
    const [job, setJob] = useState(() => toForm(one(party?.employment_info), EMPLOYMENT_KEYS));
    const [address, setAddress] = useState(() => toForm(getAddress(party, 'EMPLOYER'), EMPLOYER_ADDRESS_KEYS));
    const [errors, setErrors] = useState({ job: {}, address: {} });

    const unemployed = job.employment_type === 'UNEMPLOYED';

    const validate = () => {
        const found = {
            job: validateEmployment(job, role),
            address: unemployed ? {} : validateAddress(address, 'EMPLOYER'),
        };
        setErrors(found);
        return !hasErrors(found.job) && !hasErrors(found.address);
    };

    const save = async (applicantId) => {
        if (unemployed) {
            const cleared = Object.fromEntries(EMPLOYMENT_KEYS.map((k) => [k, null]));
            await upsertEmployment(applicantId, { ...cleared, employment_type: 'UNEMPLOYED' });
            await deleteAddress(applicantId, 'EMPLOYER');
        } else {
            await upsertEmployment(applicantId, job);
            await upsertAddress(applicantId, 'EMPLOYER', address);
        }
    };

    return {
        role,
        job,
        address,
        errors,
        unemployed,
        setJobField: (f, v) => setJob((j) => ({ ...j, [f]: v })),
        setAddressField: (f, v) => setAddress((a) => ({ ...a, [f]: v })),
        validate,
        save,
    };
};

export default useEmploymentForm;
