// The Decision Support page's sections, in page order. Sprint 5 adds a section (precedents, the committee actions...)
// by writing a component in sections.jsx and adding one entry here.
// Optional per entry: `show(ctx)` returns false to hide the section; `labelFor(ctx)` overrides the navigator text.
import {
    CreditChecking, Decisions, ExceptionHighlights, Exceptions, Figures, NextStep, PolicyCheck, Readiness,
    Recommendation, Score,
} from './sections';

const flaggedCount = (ctx) => (ctx.mrac?.status === 'DONE'
    ? (ctx.mrac.result?.criteria ?? []).filter((c) => c.status !== 'pass').length : 0) + ctx.exceptions.length;

export const SECTIONS = [
    {
        id: 'ds-readiness', label: 'Readiness', Component: Readiness,
        labelFor: (ctx) => `Readiness (${ctx.readiness.readyCount} of ${ctx.readiness.total})`,
    },
    {
        id: 'ds-highlights', label: 'Exception highlights', Component: ExceptionHighlights,
        labelFor: (ctx) => `Exception highlights (${flaggedCount(ctx)})`,
    },
    { id: 'ds-policy', label: 'Policy check (RAG)', Component: PolicyCheck },
    { id: 'ds-recommendation', label: "Credit Officer's recommendation", Component: Recommendation },
    { id: 'ds-figures', label: 'Key figures', Component: Figures },
    { id: 'ds-score', label: 'Credit score', Component: Score },
    { id: 'ds-ci', label: 'IV. Credit checking', Component: CreditChecking },
    { id: 'ds-exceptions', label: 'V. Exceptions', Component: Exceptions, labelFor: (ctx) => `V. Exceptions (${ctx.exceptions.length})` },
    { id: 'ds-decisions', label: 'Sign-offs and decisions', Component: Decisions },
    { id: 'ds-next', label: 'Where to act', Component: NextStep },
];
