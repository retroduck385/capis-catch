import { AddressFields, EmploymentFields, Section } from '../fields';

// Same fields as before, grouped into cards of up to four per row.
// Renders the state from useEmploymentForm
const JOB_GROUPS = [
    ['Employer contact', ['contact_number', 'email_address', 'employer_tin']],
    ['Income and CTC', ['gross_monthly_income', 'ctc_no', 'ctc_date_issued', 'ctc_place_issued']],
];

const EmploymentSection = ({ title, employment }) => {
    const job = { role: employment.role, values: employment.job, errors: employment.errors.job, onChange: employment.setJobField };
    return (
        <>
            <Section title={title} className="ct-cols-4">
                <EmploymentFields {...job} only={['employment_type', 'employer_business_name', 'occupation', 'employment_date']} />
            </Section>
            {!employment.unemployed && (
                <>
                    {JOB_GROUPS.map(([groupTitle, keys]) => (
                        <Section key={groupTitle} title={groupTitle} className="ct-cols-4">
                            <EmploymentFields {...job} only={keys} />
                        </Section>
                    ))}
                    <Section title="Employer / Business Address" className="ct-cols-4">
                        <AddressFields kind="EMPLOYER" idPrefix={`${employment.role}-employer`} values={employment.address}
                            errors={employment.errors.address} onChange={employment.setAddressField} />
                    </Section>
                </>
            )}
        </>
    );
};

export default EmploymentSection;
