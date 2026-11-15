// A staff member's work on one page as numbered steps, styled like the applicant wizard's steps: a check mark when
// done, an amber "Next" on the first step still to do. Guided only: every step stays clickable.
// Used by the AO's loan folder (loanFolder/aoSteps.jsx), the Credit Investigator's CI request page and the Credit
// Officer's three pages (financialPackage/coSteps.jsx), where each step is a link to its page.
// steps: [{ key, title, text, done, skipped, tag, meter: { value, max }, to | onClick }]
//   skipped: an optional step passed over (e.g. results entered by hand): not "done", but "Next" moves on.
//   to: a link to another page; onClick: something on this page. guard: optional () => boolean before a link.
// openStep: key of the step the page is showing (aria-current). Styles: .lf-steps in loanFolder.css
import { Check } from 'lucide-react';
import { Link } from 'react-router-dom';

const Meter = ({ value, max }) => (max > 0 ? (
    <span className="lf-step-meter" aria-hidden="true"><span style={{ width: `${Math.round((value / max) * 100)}%` }} /></span>
) : null);

const StepStrip = ({ steps, openStep = null, guard, label = 'Your steps' }) => {
    const nextKey = steps.find((s) => !s.done && !s.skipped)?.key;

    return (
        <div className="lf-steps-wrap">
            <p className="lf-steps-label">{label}</p>
            <ol className={`lf-steps${steps.length > 3 ? ' many' : ''}`} style={{ '--lf-step-count': steps.length }}>
                {steps.map((s, i) => {
                    const isNext = s.key === nextKey;
                    const className = ['lf-step', s.done && 'is-done', isNext && 'is-next'].filter(Boolean).join(' ');
                    const body = (
                        <>
                            <span className="n">{s.done ? <Check size={15} strokeWidth={3} aria-hidden="true" /> : i + 1}</span>
                            <span className="txt">
                                <span className="title">
                                    {s.title}
                                    <span className="sr-only">{s.done ? ' (done)' : isNext ? ' (next step)' : ''}</span>
                                </span>
                                <span className="sub">{s.text}</span>
                                {s.meter && <Meter value={s.meter.value} max={s.meter.max} />}
                            </span>
                            {isNext && <span className="lf-next" aria-hidden="true">Next</span>}
                            {!isNext && s.tag && <span className="lf-step-tag">{s.tag}</span>}
                        </>
                    );
                    return (
                        <li key={s.key} className={className}>
                            {s.to
                                ? (
                                    <Link to={s.to} aria-current={openStep === s.key ? 'step' : undefined}
                                        onClick={(e) => { if (guard && !guard()) e.preventDefault(); }}>
                                        {body}
                                    </Link>
                                )
                                : (
                                    <button type="button" onClick={s.onClick}
                                        aria-current={openStep === s.key ? 'step' : undefined}>
                                        {body}
                                    </button>
                                )}
                        </li>
                    );
                })}
            </ol>
        </div>
    );
};

export default StepStrip;
