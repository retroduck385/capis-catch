import { applicantLabel } from './applicantStatus';
import { useVisibleStatus } from './useVisibleStatus';

// The status label for one of the applicant's own applications: the stage in plain words ("Background check"), or
// the outcome once the Account Officer has sent the notice (applicantStatus.js)
const ApplicantStatusLabel = ({ application }) => {
    const visible = useVisibleStatus(application);
    return <>{applicantLabel(application.status, visible)}</>;
};

export default ApplicantStatusLabel;
