// Loan folder overview pieces (styles: the "Loan folder page" blocks in loanFolder.css).
//   KycProgress  read-only viewers' progress card: a ring (verified / needs clarification / not checked) with a
//                legend whose keys filter the section board, like the work tray's turnaround donut.
//   KycBoard     every form section as a small status card, with a segmented filter (All / Verified / ...).
//                For the editing AO each card's title opens that section.
// Both share one filter, kept by the page: 'ALL' | 'VERIFIED' | 'NEEDS_CLARIFICATION' | 'NONE'.
import { AlertTriangle, ArrowRight, CheckCircle2, CircleDashed } from 'lucide-react';
import CommentButton from '../messages/commentButton';
import { Term } from '../../components/term';
import { useCountUp } from '../workTray/useCountUp';
import { CheckChip, CheckSummary } from './kycCheckPanel';
import { TONE_OF, statusOf } from './options';

const FILTERS = [
    { key: 'ALL', label: 'All' },
    { key: 'VERIFIED', label: 'Verified' },
    { key: 'NEEDS_CLARIFICATION', label: 'Needs clarification' },
    { key: 'NONE', label: 'Not checked' },
];

export const StatusIcon = ({ status, size = 18 }) => {
    const Icon = { VERIFIED: CheckCircle2, NEEDS_CLARIFICATION: AlertTriangle, NONE: CircleDashed }[status];
    return <Icon size={size} className={`lf-ico ${TONE_OF[status]}`} aria-hidden="true" />;
};

// Ring geometry (viewBox 100): dash segments with round ends; a round cap reaches W/2 past each end of a dash
const R = 42;
const C = 2 * Math.PI * R;
const W = 10;
const GAP = 4;

const ringSegments = (counts) => {
    const parts = [['ok', counts.VERIFIED], ['warn', counts.NEEDS_CLARIFICATION]].filter(([, n]) => n > 0);
    if (parts.length === 1 && parts[0][1] === counts.ALL) return [{ tone: parts[0][0], len: C, start: 0, full: true }];
    let at = 0;
    return parts.map(([tone, n]) => {
        const arc = (n / counts.ALL) * C;
        const seg = { tone, len: Math.max(0.01, arc - W - GAP), start: at + (W + GAP) / 2 };
        at += arc;
        return seg;
    });
};

export const KycProgress = ({ counts, filter, onFilter }) => {
    const shown = useCountUp(counts.VERIFIED);
    const toggle = (key) => onFilter(filter === key ? 'ALL' : key);
    return (
        <article className="lf-card lf-progresscard">
            <h2 className="lf-wtitle"><Term k="KYC" /> verification</h2>
            <div className="lf-ringrow">
                <div className="lf-ring">
                    <svg viewBox="0 0 100 100" role="img"
                        aria-label={`${counts.VERIFIED} verified, ${counts.NEEDS_CLARIFICATION} need clarification, ${counts.NONE} not checked, of ${counts.ALL} sections`}>
                        <circle className="track" cx="50" cy="50" r={R} />
                        {ringSegments(counts).map((s) => (
                            <circle key={s.tone} className={`seg ${s.tone}${s.full ? ' full' : ''}`} cx="50" cy="50" r={R}
                                strokeDasharray={`${s.len} ${C - s.len}`} strokeDashoffset={-s.start} />
                        ))}
                    </svg>
                    <div className="mid" aria-hidden="true">
                        <b>{shown}</b>
                        <span>of {counts.ALL} verified</span>
                    </div>
                </div>
                <ul className="lf-keys" aria-label="Show sections">
                    {FILTERS.slice(1).map((f) => (
                        <li key={f.key}>
                            <button type="button" className={`lf-key ${TONE_OF[f.key]}${counts[f.key] ? '' : ' zero'}`}
                                aria-pressed={filter === f.key} onClick={() => toggle(f.key)}>
                                <i aria-hidden="true" />{f.label}<b>{counts[f.key]}</b>
                            </button>
                        </li>
                    ))}
                </ul>
            </div>
        </article>
    );
};

// askFor(section, check): the "Ask the applicant" row for a Needs clarification (or null)
export const KycBoard = ({ sections, latestCheck, names, counts, filter, onFilter, canEdit, onOpen, askFor }) => {
    const shown = sections.filter((s) => filter === 'ALL' || statusOf(latestCheck(s.key)) === filter);
    const label = FILTERS.find((f) => f.key === filter)?.label;
    return (
        <section id="lf-kyc-board" className="lf-card lf-board" aria-labelledby="lf-kyc-title">
            <div className="lf-cardhead">
                <div className="lf-cardtitle">
                    <h2 id="lf-kyc-title"><Term k="KYC" /> verification by section</h2>
                    <span className="lf-count"><b>{counts.VERIFIED}</b> of {counts.ALL} verified</span>
                </div>
                <div className="lf-seg" role="group" aria-label="Show sections">
                    {FILTERS.map((f) => (
                        <button key={f.key} type="button" className={f.key === 'ALL' ? undefined : TONE_OF[f.key]}
                            aria-pressed={filter === f.key} onClick={() => onFilter(f.key)}>
                            {f.key !== 'ALL' && <i aria-hidden="true" />}
                            {f.label}<b>{counts[f.key]}</b>
                        </button>
                    ))}
                </div>
            </div>
            {/* keyed by the filter so the cards cascade in again when it changes */}
            <ul key={filter} className="lf-kyc">
                {shown.map((s, i) => {
                    const check = latestCheck(s.key);
                    const status = statusOf(check);
                    return (
                        <li key={s.key} id={canEdit ? undefined : `kyc-${s.key}`} className={`lf-kyc-item ${TONE_OF[status]}`}
                            style={{ '--i': i }}>
                            {/* a 3-column grid (icon | name | chip); the body sits under the name so all text lines up */}
                            <span className="lf-kyc-ic"><StatusIcon status={status} /></span>
                            <div className="lf-kyc-head">
                                {canEdit ? (
                                    <button type="button" className="lf-kyc-name open" onClick={() => onOpen(s.key)}>
                                        {s.title}<ArrowRight size={15} className="go" aria-hidden="true" />
                                    </button>
                                ) : <b className="lf-kyc-name">{s.title}</b>}
                            </div>
                            <CheckChip check={check} />
                            <div className="lf-kyc-body">
                                {!s.complete && <span className="lf-tag">Incomplete</span>}
                                <CheckSummary check={check} names={names} />
                                {askFor(s, check)}
                            </div>
                            {/* comment: bottom right of every card, so they line up across a row */}
                            <div className="lf-kyc-foot"><CommentButton topic={`kyc-${s.key}`} className="lf-comment" /></div>
                        </li>
                    );
                })}
            </ul>
            {shown.length === 0 && (
                <p className="lf-empty">
                    No sections are {label?.toLowerCase()}.{' '}
                    <button type="button" className="lf-linkbtn" onClick={() => onFilter('ALL')}>Show all sections</button>
                </p>
            )}
        </section>
    );
};
