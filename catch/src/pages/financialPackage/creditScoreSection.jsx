// Housing Loan Credit Scoring Sheet (KYC-FP "Credit_Score" tab) inside the Financial Package.
// The page suggests a band where the record allows it (see creditScore.js); the CO accepts, changes or
// leaves each one. Only the CO's picks count toward the total.
import { Section } from '../applicationForm/fields';
import { CATEGORIES } from './creditScore';

const Cell = ({ children, className = '' }) => <td className={`border px-2 py-1 align-top ${className}`}>{children}</td>;
const Head = ({ children }) => <th className="border px-2 text-left align-top">{children}</th>;

const pts = (n) => `${n} ${Math.abs(n) === 1 ? 'pt' : 'pts'}`;

const CriterionRow = ({ criterion, bands, suggestion, entry, onScore, onRemarks, disabled }) => {
    const bandLabel = (code) => {
        const b = bands.find((x) => x.code === code);
        return b ? `${b.label} (${pts(b.points)})` : code;
    };
    const picked = bands.find((b) => b.code === entry?.band);
    const suggested = suggestion.band;
    // The CO's pick differs from what the record suggests now (an override, or the data changed since)
    const differs = picked && suggested && picked.code !== suggested;
    const changedSince = differs && entry.suggested_band && entry.suggested_band !== suggested;

    return (
        <tr>
            <Cell className="font-semibold">{criterion.label}</Cell>
            <Cell>{suggestion.input ?? '—'}</Cell>
            <Cell>
                {suggested
                    ? <span className="font-semibold">{bandLabel(suggested)}</span>
                    : <span className="italic text-gray-500">No suggestion</span>}
                <p className="text-xs text-gray-600">{suggestion.source}</p>
                {!disabled && suggested && entry?.band !== suggested && (
                    <button type="button" className="border px-2 mt-1 text-sm" onClick={() => onScore(criterion.code, suggested)}>
                        Use suggestion
                    </button>
                )}
            </Cell>
            <Cell>
                <select aria-label={`${criterion.label} score`} className="p-1 border w-full" value={entry?.band ?? ''}
                    disabled={disabled} onChange={(e) => onScore(criterion.code, e.target.value)}>
                    <option value="">-- Not scored --</option>
                    {bands.map((b) => <option key={b.code} value={b.code}>{b.label} ({pts(b.points)})</option>)}
                </select>
                {!picked && suggested && <p className="text-xs text-amber-700">Suggestion not confirmed yet</p>}
                {changedSince && <p className="text-xs text-amber-700">The record changed since this was scored</p>}
                {differs && !changedSince && <p className="text-xs text-amber-700">Differs from the suggestion</p>}
                <input aria-label={`${criterion.label} remarks`} className="p-1 border w-full mt-1 text-sm"
                    placeholder="Remarks (e.g. why you changed it)" value={entry?.remarks ?? ''} disabled={disabled}
                    onChange={(e) => onRemarks(criterion.code, e.target.value)} />
            </Cell>
            <Cell className="text-right">{picked ? picked.points : '—'}</Cell>
        </tr>
    );
};

export const CreditScoreSection = ({ rules, suggestions, scores, totals, onScore, onRemarks, onUseAll, disabled }) => {
    const unscoredSuggestions = rules.criteria.filter((c) => !scores[c.code]?.band && suggestions[c.code].band).length;
    return (
        <Section title="Credit Scoring (Housing Loan Credit Scoring Sheet)">
            <p className="text-sm">
                CATCH suggests a band wherever the record has the data. Suggestions don't count until you pick or
                accept them, and you can change any score. Character items mostly wait for the Credit
                Investigator's results.
            </p>
            {!disabled && unscoredSuggestions > 0 && (
                <button type="button" className="border px-3 py-1 my-2" onClick={onUseAll}>
                    Use all {unscoredSuggestions} suggestions for unscored criteria
                </button>
            )}

            {CATEGORIES.map((cat) => {
                const criteria = rules.criteria.filter((c) => c.category === cat.value);
                const sub = totals.byCategory[cat.value];
                return (
                    <div key={cat.value} className="overflow-x-auto py-2">
                        <h4 className="font-semibold">{cat.label} (Maximum Score: {sub.max})</h4>
                        <table className="border-collapse w-full">
                            <thead>
                                <tr>
                                    <Head>Criterion</Head><Head>From the record</Head><Head>Suggestion</Head>
                                    <Head>Score</Head><Head>Points</Head>
                                </tr>
                            </thead>
                            <tbody>
                                {criteria.map((c) => (
                                    <CriterionRow key={c.code} criterion={c} suggestion={suggestions[c.code]}
                                        bands={rules.bands.filter((b) => b.criterion === c.code)} entry={scores[c.code]}
                                        onScore={onScore} onRemarks={onRemarks} disabled={disabled} />
                                ))}
                                <tr>
                                    <Cell className="font-semibold">Sub-total</Cell>
                                    <Cell /><Cell /><Cell />
                                    <Cell className="text-right font-semibold">{sub.score}</Cell>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                );
            })}

            <dl className="grid grid-cols-[14rem_1fr] gap-x-4 gap-y-1 py-2">
                <dt className="font-semibold">Total Score</dt>
                <dd>{totals.total} / 100{!totals.complete && ` (${totals.scored} of ${totals.count} criteria scored)`}</dd>
                <dt className="font-semibold">Description</dt>
                <dd>{totals.description ?? <span className="italic">When every criterion is scored</span>}</dd>
                <dt className="font-semibold">Risk Rating</dt>
                <dd>{totals.riskRating ?? <span className="italic">When every criterion is scored</span>}</dd>
                <dt className="font-semibold">Recommendation</dt>
                <dd>{totals.recommendation ?? <span className="italic">When every criterion is scored</span>}</dd>
            </dl>
            <p className="italic text-sm">The recommendation is a guide from the score; the Credit Result below is your decision.</p>
        </Section>
    );
};
