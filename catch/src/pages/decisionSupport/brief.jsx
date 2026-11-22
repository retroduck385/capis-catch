// Decision-support brief: the short version of the Decision Support page, inside the page where a person acts on the
// application (the review summary, for reviewers and approvers). Four status tiles (readiness, policy check,
// exception highlights, time in stage against its turnaround target: DSS-14), then only the readiness items that
// still need attention. Readiness, policy check and exception highlights each open that section of the full
// Decision Support page in a modal (briefDialog.jsx), with a link to the full page in a new tab, so the review and its
// draft stay put. Read only: it informs, people decide.
// Data: buildDssContext() over fetchDecisionSupport(), the same as the full page. Styles: decisionSupport.css (.ds-brief).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ExternalLink, Eye, Hourglass, ListChecks, Maximize2, Scale, ShieldCheck, TriangleAlert } from 'lucide-react';
import { personName } from '../../components/people';
import { Terms } from '../../components/term';
import { ROLE_LABELS } from '../../roles';
import { Section } from '../applicationForm/fields';
import { policyStatus } from './context';
import { READY } from './readiness';
import { ExceptionHighlights, PolicyCheck, Readiness } from './sections';
import BriefDialog from './briefDialog';
import { dssHref } from './format';
import { stageLabel, stageTat, TAT_LABELS, TAT_TONES } from '../workTray/options';
import '../mrac/mrac.css';
import './decisionSupport.css';

const dayCount = (d) => (d < 1 ? `${Math.max(1, Math.round(d * 24))} h` : `${d.toFixed(1)} days`);

// One status tile; with onOpen it is a button that opens its section in a modal (without: a plain tile)
const BriefTile = ({ Icon, label, value, sub, tone, onOpen }) => {
    const inner = (
        <>
            <span className="ic" aria-hidden="true"><Icon size={18} /></span>
            <span className="lbl">{label}</span>
            <span className="val"><Terms text={value} /></span>
            <span className="sub"><Terms text={sub} /></span>
        </>
    );
    return onOpen ? (
        <button type="button" className={`ds-brief-tile ${tone}`} onClick={onOpen} aria-haspopup="dialog">
            {inner}
            <Maximize2 size={14} className="go" aria-hidden="true" />
            <span className="sr-only"> (opens the details in a dialog)</span>
        </button>
    ) : <div className={`ds-brief-tile ${tone}`}>{inner}</div>;
};

const DecisionBrief = ({ ctx, id = 'rv-dss' }) => {
    const { app, readiness, mrac, mracChanges, exceptions, names, aoId, coId, stage } = ctx;
    const tat = stageTat(stage?.stage, stage?.enteredAt);
    const [policyLabel, policyTone, policySub] = policyStatus(mrac, mracChanges);
    const criteria = mrac?.status === 'DONE' ? mrac.result?.criteria ?? [] : [];
    const fails = criteria.filter((c) => c.status === 'fail').length;
    const reviews = criteria.filter((c) => c.status === 'needs_review').length;
    const flagged = fails + reviews + exceptions.length;
    const open = readiness.items.filter((i) => i.state !== READY.DONE);
    const [openTile, setOpenTile] = useState(null);
    const ownerName = (role) => personName(role === 'ACCOUNT_OFFICER' ? names[aoId] : role === 'CREDIT_OFFICER' ? names[coId] : null);

    const highlightsSub = [
        fails ? `${fails} fail${fails === 1 ? 's' : ''}` : null,
        reviews ? `${reviews} need${reviews === 1 ? 's' : ''} review` : null,
        `${exceptions.length} recorded exception${exceptions.length === 1 ? '' : 's'}`,
    ].filter(Boolean).join(' · ');

    const highlightsTone = fails > 0 ? 'bad' : flagged > 0 || mrac?.status !== 'DONE' ? 'warn' : 'ok';
    const tiles = {
        readiness: { section: 'ds-readiness', label: 'Readiness', Icon: ListChecks, tone: readiness.ready ? 'ok' : 'warn', Component: Readiness },
        policy: { section: 'ds-policy', label: 'Policy check (MRAC)', Icon: ShieldCheck, tone: policyTone, Component: PolicyCheck },
        highlights: { section: 'ds-highlights', label: 'Exception highlights', Icon: TriangleAlert, tone: highlightsTone, Component: ExceptionHighlights },
    };

    return (
        <Section id={id} title="Decision support" className="mrac ds ds-brief">
            <div className="ds-brief-tiles">
                <BriefTile Icon={ListChecks} label="Readiness"
                    value={`${readiness.readyCount} of ${readiness.total}`}
                    sub={readiness.ready ? 'Ready for decision' : `${open.length} item${open.length === 1 ? '' : 's'} need attention`}
                    tone={readiness.ready ? 'ok' : 'warn'} onOpen={() => setOpenTile('readiness')} />
                <BriefTile Icon={ShieldCheck} label="Policy check (MRAC)"
                    value={policyLabel} sub={policySub} tone={policyTone} onOpen={() => setOpenTile('policy')} />
                <BriefTile Icon={TriangleAlert} label="Exception highlights"
                    value={flagged === 0 ? 'None' : String(flagged)} sub={mrac?.status === 'DONE' ? highlightsSub : 'Needs a policy check'}
                    tone={highlightsTone} onOpen={() => setOpenTile('highlights')} />
                {tat && (
                    <BriefTile Icon={Hourglass} label={`Time in ${stageLabel(stage.stage)}`}
                        value={dayCount(tat.days)}
                        sub={`${TAT_LABELS[tat.state]} · target ${tat.target} day${tat.target === 1 ? '' : 's'} (placeholder until the bank's SLA)`}
                        tone={TAT_TONES[tat.state]} />
                )}
            </div>

            {open.length > 0 && (
                <ul className="ds-brief-open" aria-label="Still needed for a decision">
                    {open.map((item) => {
                        const who = ownerName(item.owner);
                        const role = ROLE_LABELS[item.owner] ?? item.owner;
                        return (
                            <li key={item.key} className="warn">
                                <span className="mrac-chip warn">
                                    {item.state === READY.CHECK ? <Eye size={13} aria-hidden="true" /> : <AlertTriangle size={13} aria-hidden="true" />}
                                    {item.state === READY.CHECK ? 'Check' : 'Missing'}
                                </span>
                                <span className="what"><b>{item.label}</b> <Terms text={item.detail} /></span>
                                <span className="who">Waiting on {who ? `${who} (${role})` : role}</span>
                            </li>
                        );
                    })}
                </ul>
            )}

            <p className="ds-brief-foot">
                <span>Read-only summary. Policy results are suggestions with their source clause; you decide.</span>
                <Link to={dssHref(app.id)} target="_blank" rel="noopener" className="ds-go">
                    <Scale size={14} aria-hidden="true" />Full analysis<ExternalLink size={13} aria-hidden="true" />
                    <span className="sr-only"> (opens in a new tab)</span>
                </Link>
            </p>

            {openTile && <BriefDialog ctx={ctx} tile={tiles[openTile]} onClose={() => setOpenTile(null)} />}
        </Section>
    );
};

export default DecisionBrief;
