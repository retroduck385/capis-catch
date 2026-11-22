// One credit score category (Capacity, Character, Collateral, Condition) opened from the review summary's Credit
// score card, so the reviewer can inspect it without leaving the review. Read only, and short on purpose: per
// criterion only the points and the band the Credit Officer picked (plus the CO's remark, if any). The full scoring
// page (what the record says, the suggestion, every band) opens in a new tab from the footer.
// rules: fetchCreditScoreRules(); entries: { [criterion]: credit_score_entries row }; sub: totalCreditScore().byCategory[x]
// Shell: components/infoModal.jsx. Styles: review.css (.rv-score-*).
import { Gauge } from 'lucide-react';
import InfoModal from '../../components/infoModal';
import { Terms } from '../../components/term';

const ScoreCategoryDialog = ({ appId, category, rules, entries, sub, onClose }) => {
    const criteria = rules.criteria.filter((c) => c.category === category.value);
    const allScored = criteria.every((c) => entries[c.code]?.band);
    return (
        <InfoModal Icon={Gauge} tone={allScored ? 'ok' : 'warn'} eyebrow="Credit score"
            title={`${category.label}: ${sub.score} / ${sub.max}`} onClose={onClose}
            note="Scored by the Credit Officer. Read-only here."
            link={{ to: `/creditScorePage?id=${appId}#cs-${category.value}`, label: 'Open credit scoring' }}>
            <ul className="rv-score-crits">
                {criteria.map((c) => {
                    const bands = rules.bands.filter((b) => b.criterion === c.code);
                    const max = Math.max(...bands.map((b) => b.points));
                    const entry = entries[c.code];
                    const picked = bands.find((b) => b.code === entry?.band);
                    return (
                        <li key={c.code} className={picked ? 'ok' : 'warn'}>
                            <div className="top">
                                <b><Terms text={c.label} /></b>
                                <span className="pts">{picked ? `${picked.points} / ${max}` : `— / ${max}`}</span>
                            </div>
                            <p>{picked ? <Terms text={picked.label} /> : 'Not scored yet.'}</p>
                            {entry?.remarks && <p className="remark">Credit Officer&apos;s remark: {entry.remarks}</p>}
                        </li>
                    );
                })}
            </ul>
        </InfoModal>
    );
};

export default ScoreCategoryDialog;
