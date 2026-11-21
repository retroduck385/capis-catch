// Housing Loan Credit Scoring Sheet (KYC-FP "Credit_Score" tab). One card per category (id `cs-<CATEGORY>`), then the
// total (`cs-total`). Laid out like the Financial Package page (.lf-fp, see credit score page).
// The page suggests a band where the record allows it (see creditScore.js); the CO accepts, changes or
// leaves each one. Only the CO's picks count toward the total.
// Each criterion is a card (not a table row): what the record says, the suggestion, then the score and remarks.
// The score is a rating form (group notes item 32): one choice per band with its points, the suggested band tagged,
// a radio group per criterion (arrow keys move, like any radio group); "Clear" un-scores it. Cards stack on a phone.
// Styles: creditScore.css (.cs-*).
import { Check } from 'lucide-react';
import { Section } from '../applicationForm/fields';
import { CATEGORIES } from './creditScore';
import { Terms } from '../../components/term';

const pts = (n) => `${n} ${Math.abs(n) === 1 ? 'pt' : 'pts'}`;

const CriterionCard = ({ criterion, bands, suggestion, entry, onScore, onRemarks, disabled }) => {
    const bandLabel = (code) => {
        const b = bands.find((x) => x.code === code);
        return b ? `${b.label} (${pts(b.points)})` : code;
    };
    const picked = bands.find((b) => b.code === entry?.band);
    const suggested = suggestion.band;
    // The CO's pick differs from what the record suggests now (an override, or the data changed since)
    const differs = picked && suggested && picked.code !== suggested;
    const changedSince = differs && entry.suggested_band && entry.suggested_band !== suggested;
    // stripe: scored ok, a suggestion waiting (or a record that changed since) amber, nothing to go on slate
    const tone = changedSince || (!picked && suggested) ? 'warn' : picked ? 'ok' : 'none';
    const id = `cs-c-${criterion.code}`;

    return (
        <li className={`cs-crit ${tone}`} aria-labelledby={`${id}-h`}>
            <div className="cs-crit-head">
                <h4 id={`${id}-h`}><Terms text={criterion.label} /></h4>
                <span className={`cs-pts${picked ? ' on' : ''}`}>{picked ? pts(picked.points) : 'Not scored'}</span>
            </div>
            <div className="cs-crit-body">
                <div className="cs-col">
                    <p className="cs-label">From the record</p>
                    <p className="cs-val">{suggestion.input ?? '—'}</p>
                </div>
                <div className="cs-col">
                    <p className="cs-label">Suggestion</p>
                    {suggested ? <p className="cs-val"><b>{bandLabel(suggested)}</b></p> : <p className="fp-pending">No suggestion</p>}
                    <p className="fp-note cs-source"><Terms text={suggestion.source} /></p>
                    {!disabled && suggested && entry?.band !== suggested && (
                        <button type="button" className="cs-use" onClick={() => onScore(criterion.code, suggested)}>
                            <Check size={14} aria-hidden="true" />Use suggestion
                        </button>
                    )}
                </div>
                <div className="cs-col cs-score">
                    <p className="cs-label">Score</p>
                    <div className="cs-bands" role="radiogroup" aria-label={`${criterion.label} score`}>
                        {bands.map((b) => {
                            const on = entry?.band === b.code;
                            return (
                                <label key={b.code} className={`cs-band${on ? ' on' : ''}${disabled ? ' off' : ''}`}>
                                    <input type="radio" name={`${id}-band`} value={b.code} checked={on} disabled={disabled}
                                        onChange={() => onScore(criterion.code, b.code)} />
                                    <span className="cs-band-txt"><Terms text={b.label} /></span>
                                    <span className="cs-band-pts">{pts(b.points)}</span>
                                    {suggested === b.code && <span className="cs-band-sug">Suggested</span>}
                                </label>
                            );
                        })}
                    </div>
                    {picked && !disabled && (
                        <button type="button" className="lf-linkbtn cs-clear" onClick={() => onScore(criterion.code, '')}>Clear score</button>
                    )}
                    {!picked && suggested && <p className="cs-flag">Suggestion not confirmed yet</p>}
                    {changedSince && <p className="cs-flag">The record changed since this was scored</p>}
                    {differs && !changedSince && <p className="cs-flag quiet">Differs from the suggestion</p>}
                    <input aria-label={`${criterion.label} remarks`} placeholder="Remarks (e.g. why you changed it)"
                        value={entry?.remarks ?? ''} disabled={disabled} onChange={(e) => onRemarks(criterion.code, e.target.value)} />
                </div>
            </div>
        </li>
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
                        <Check size={16} aria-hidden="true" />Use all {unscoredSuggestions} suggestions for unscored criteria
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
                        <ul className="cs-crits">
                            {criteria.map((c) => (
                                <CriterionCard key={c.code} criterion={c} suggestion={suggestions[c.code]}
                                    bands={rules.bands.filter((b) => b.criterion === c.code)} entry={scores[c.code]}
                                    onScore={onScore} onRemarks={onRemarks} disabled={disabled} />
                            ))}
                        </ul>
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
                    <div className="fp-info-row cs-total-row">
                        <dt>Total Score</dt>
                        <dd>{totals.total} / 100{!totals.complete && ` (${totals.scored} of ${totals.count} criteria scored)`}</dd>
                    </div>
                    {[['Description', totals.description], ['Risk Rating', totals.riskRating], ['Recommendation', totals.recommendation]].map(([label, value]) => (
                        <div key={label} className="fp-info-row">
                            <dt>{label}</dt>
                            <dd>{value ? <Terms text={value} /> : <span className="fp-pending">When every criterion is scored</span>}</dd>
                        </div>
                    ))}
                </dl>
                <p className="fp-note">The recommendation is a guide from the score; the Credit Result in the Financial Package is your decision.</p>
            </Section>
        </>
    );
};
