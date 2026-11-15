// The assigned Account Officer's work in the loan folder as three numbered steps (components/stepStrip.jsx):
// 1. Document check (AI), 2. KYC verification per section, 3. Request CI. Documents come first because confirming
// them can change the record the KYC check is about, and the CI request takes the ID details from them.
import StepStrip from '../../components/stepStrip';
import { whenOf } from './options';

const docsText = (progress) => {
    if (!progress) return 'Open to check the documents';
    if (progress.total === 0) return 'No documents to check';
    return `${progress.confirmed} of ${progress.total} documents confirmed`;
};

// appId, docProgress: { total, confirmed } | null, verifiedCount / sectionCount, ciRequest: latest | null,
// openStep: 'kyc' | 'ci' | null (what the page is showing), onOpenKyc / onOpenCi
const AoSteps = ({ appId, docProgress, verifiedCount, sectionCount, ciRequest, openStep, onOpenKyc, onOpenCi }) => (
    <StepStrip openStep={openStep} steps={[
        {
            key: 'docs', title: 'Document check (AI)', text: docsText(docProgress),
            done: !!docProgress && docProgress.confirmed === docProgress.total,
            meter: docProgress && { value: docProgress.confirmed, max: docProgress.total },
            to: `/documentCheckPage?id=${appId}`,
        },
        {
            key: 'kyc', title: 'KYC verification', text: `${verifiedCount} of ${sectionCount} sections verified`,
            done: sectionCount > 0 && verifiedCount === sectionCount,
            meter: { value: verifiedCount, max: sectionCount },
            onClick: onOpenKyc,
        },
        {
            key: 'ci', title: 'Request CI (NFIS & TU)', text: ciRequest ? `Sent ${whenOf(ciRequest.requested_at)}` : 'Not sent yet',
            done: !!ciRequest,
            onClick: onOpenCi,
        },
    ]} />
);

export default AoSteps;
