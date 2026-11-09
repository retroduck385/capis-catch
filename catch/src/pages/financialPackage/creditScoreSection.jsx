// Housing Loan Credit Scoring Sheet (KYC-FP "Credit_Score" tab). One card per category (id `cs-<CATEGORY>`), then the
// total (`cs-total`). Laid out like the Financial Package page (.lf / .fp / .rv, see credit score page).
// The page suggests a band where the record allows it (see creditScore.js); the CO accepts, changes or
// leaves each one. Only the CO's picks count toward the total.
import { Section } from '../applicationForm/fields';
import { CATEGORIES } from './creditScore';

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
            <td><b>{criterion.label}</b></td>
            <td>{suggestion.input ?? '—'}</td>
            <td>
                {suggested
                    ? <b>{bandLabel(suggested)}</b>
                    : <span className="fp-pending">No suggestion</span>}
                <p className="fp-note cs-source">{suggestion.source}</p>
                {!disabled && suggested && entry?.band !== suggested && (
                    <button type="button" className="rv-link" onClick={() => onScore(criterion.code, suggested)}>
                        Use suggestion
                    </button>
                )}
            </td>
            <td className="cs-score">
                <select aria-label={`${criterion.label} score`} value={entry?.band ?? ''}
                    disabled={disabled} onChange={(e) => onScore(criterion.code, e.target.value)}>
                    <option value="">-- Not scored --</option>
                    {bands.map((b) => <option key={b.code} value={b.code}>{b.label} ({pts(b.points)})</option>)}
                </select>
                {!picked && suggested && <p className="cs-flag">Suggestion not confirmed yet</p>}
                {changedSince && <p className="cs-flag">The record changed since this was scored</p>}
                {differs && !changedSince && <p className="cs-flag">Differs from the suggestion</p>}
                <input aria-label={`${criterion.label} remarks`} placeholder="Remarks (e.g. why you changed it)"
                    value={entry?.remarks ?? ''} disabled={disabled} onChange={(e) => onRemarks(criterion.code, e.target.value)} />
            </td>
            <td className="cs-num">{picked ? <b>{picked.points}</b> : '—'}</td>
        </tr>
    );
};

export const CreditScoreSection = ({ rules, suggestions, scores, totals, onScore, onRemarks, onUseAll, disabled }) => {
    const unscoredSuggestions = rules.criteria.filter((c) => !scores[c.code]?.band && suggestions[c.code].band).length;
    return (
        <>
            <div className="lf-card cs-intro">
                <p>
                    CATCH suggests a band wherever the record has the data. Suggestions don't count until you pick or
                    accept them, and you can change any score. Character items mostly wait for the Credit
                    Investigator's results.
                </p>
                {!disabled && unscoredSuggestions > 0 && (
                    <button type="button" className="lf-btn" onClick={onUseAll}>
                        Use all {unscoredSuggestions} suggestions for unscored criteria
                    </button>
                )}
            </div>

            {CATEGORIES.map((cat) => {
                const criteria = rules.criteria.filter((c) => c.category === cat.value);
                const sub = totals.byCategory[cat.value];
                const pct = sub.max > 0 ? Math.max(0, Math.min(100, (sub.score / sub.max) * 100)) : 0;
                return (
                    <Section key={cat.value} id={`cs-${cat.value}`} title={`${cat.label} (Maximum Score: ${sub.max})`}>
                        <div className="cs-sub">
                            <div className="cs-sub-top">
                                <span>Sub-total</span>
                                <b>{sub.score} / {sub.max}</b>
                            </div>
                            <div className="lf-meter" role="img" aria-label={`${sub.score} of ${sub.max} points`}>
                                <span style={{ width: `${pct}%` }} />
                            </div>
                        </div>
                        <div className="fp-tablewrap">
                            <table className="cs-table">
                                <thead>
                                    <tr>
                                        <th>Criterion</th><th>From the record</th><th>Suggestion</th>
                                        <th>Score</th><th className="cs-num">Points</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {criteria.map((c) => (
                                        <CriterionRow key={c.code} criterion={c} suggestion={suggestions[c.code]}
                                            bands={rules.bands.filter((b) => b.criterion === c.code)} entry={scores[c.code]}
                                            onScore={onScore} onRemarks={onRemarks} disabled={disabled} />
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </Section>
                );
            })}

            <Section id="cs-total" title="Total score">
                <dl className="fp-info">
                    {CATEGORIES.map((cat) => (
                        <div key={cat.value} className="fp-info-row">
                            <dt>{cat.label}</dt>
                            <dd>{totals.byCategory[cat.value].score} / {totals.byCategory[cat.value].max}</dd>
                        </div>
                    ))}
                    <div className="fp-info-row">
                        <dt>Total Score</dt>
                        <dd>{totals.total} / 100{!totals.complete && ` (${totals.scored} of ${totals.count} criteria scored)`}</dd>
                    </div>
                    {[['Description', totals.description], ['Risk Rating', totals.riskRating], ['Recommendation', totals.recommendation]].map(([label, value]) => (
                        <div key={label} className="fp-info-row">
                            <dt>{label}</dt>
                            <dd>{value ?? <span className="fp-pending">When every criterion is scored</span>}</dd>
                        </div>
                    ))}
                </dl>
                <p className="fp-note">The recommendation is a guide from the score; the Credit Result in the Financial Package is your decision.</p>
            </Section>
        </>
    );
};
