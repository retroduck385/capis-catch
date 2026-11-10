// The Decision Support page's sections, in page order. Sprint 5 adds a section (exception highlights, precedents,
// the committee actions...) by writing a component in sections.jsx and adding one entry here.
// Optional per entry: `show(ctx)` returns false to hide the section; `labelFor(ctx)` overrides the navigator text.
import {
    CreditChecking, Decisions, Exceptions, Figures, NextStep, PolicyCheck, Recommendation, Score,
} from './sections';

export const SECTIONS = [
    { id: 'ds-policy', label: 'Policy check (RAG)', Component: PolicyCheck },
    { id: 'ds-recommendation', label: "Credit Officer's recommendation", Component: Recommendation },
    { id: 'ds-figures', label: 'Key figures', Component: Figures },
    { id: 'ds-score', label: 'Credit score', Component: Score },
    { id: 'ds-ci', label: 'IV. Credit checking', Component: CreditChecking },
    { id: 'ds-exceptions', label: 'V. Exceptions', Component: Exceptions, labelFor: (ctx) => `V. Exceptions (${ctx.exceptions.length})` },
    { id: 'ds-decisions', label: 'Sign-offs and decisions', Component: Decisions },
    { id: 'ds-next', label: 'Where to act', Component: NextStep },
];
