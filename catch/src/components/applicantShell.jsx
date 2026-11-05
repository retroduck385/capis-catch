import { Building2 } from 'lucide-react';

// Content frame for applicant pages. Signed-in pages sit inside PrivateRoute's header, so this only sets the
// content width. `bare` is for sign-in and sign-up, which have no header and use a split brand/form layout.
const ApplicantShell = ({ children, bare = false, wide = true }) => {
    if (bare) {
        return (
            <div className="ct ct-e">
                <div className="ct-split">{children}</div>
            </div>
        );
    }
    return <div style={{ maxWidth: wide ? '92rem' : '48rem', margin: '0 auto' }}>{children}</div>;
};

// Left panel on sign-in / sign-up: wordmark, headline, and a sample of the progress an applicant will see.
const PREVIEW_STEPS = [
    ['Loan details', 'done'],
    ['Principal borrower', 'done'],
    ['Address', 'current'],
    ['Employment', 'todo'],
    ['Documents', 'todo'],
];

export const BrandPanel = ({ heading, lede }) => (
    <aside className="ct-brand">
        <span className="ct-brand-link"><Building2 size={16} aria-hidden="true" />CATCH</span>
        <div className="ct-brand-body">
            <h1>{heading}</h1>
            <p>{lede}</p>
            <div className="ct-preview" aria-hidden="true">
                <div className="ct-preview-head">
                    <strong>Housing loan application</strong>
                    <span>2 of 5 steps done</span>
                </div>
                <div className="ct-meter"><span style={{ width: '40%' }} /></div>
                <ul>
                    {PREVIEW_STEPS.map(([label, state]) => (
                        <li key={label} className={state}>
                            <span className="dot">{state === 'done' ? '✓' : ''}</span>
                            {label}
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    </aside>
);

export default ApplicantShell;
