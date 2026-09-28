import { AddressFields, EmploymentFields, Section } from '../fields';

// Renders the state from useEmploymentForm
const EmploymentSection = ({ title, employment }) => (
    <Section title={title}>
        <EmploymentFields role={employment.role} values={employment.job} errors={employment.errors.job}
            onChange={employment.setJobField} />
        {!employment.unemployed && (
            <>
                <p className="font-semibold pt-2">Employer / Business Address</p>
                <AddressFields kind="EMPLOYER" idPrefix={`${employment.role}-employer`} values={employment.address}
                    errors={employment.errors.address} onChange={employment.setAddressField} />
            </>
        )}
    </Section>
);

export default EmploymentSection;
