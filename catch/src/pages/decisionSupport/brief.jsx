// Decision-support brief: the short version of the Decision Support page, inside the page where a person acts on the
// application (the review summary, for reviewers and approvers). Four status tiles (readiness, policy check,
// exception highlights, time in stage against its turnaround target: DSS-14), then only the readiness items that
// still need attention. Each tile opens that section of the
// full Decision Support page in a new tab, so the review and its draft stay put. Read only: it informs, people decide.
// Data: buildDssContext() over fetchDecisionSupport(), the same as the full page. Styles: decisionSupport.css (.ds-brief).
import { Link } from 'react-router-dom';
import { AlertTriangle, ExternalLink, Eye, Hourglass, ListChecks, Scale, ShieldCheck, TriangleAlert } from 'lucide-react';
import { personName } from '../../components/people';
import { Terms } from '../../components/term';
import { ROLE_LABELS } from '../../roles';
import { Section } from '../applicationForm/fields';
import { policyStatus } from './context';
import { READY } from './readiness';
import { stageLabel, stageTat, TAT_LABELS, TAT_TONES } from '../workTray/options';
import '../mrac/mrac.css';
import './decisionSupport.css';

const dssHref = (appId, section) => `/decisionSupportPage?id=${appId}${section ? `#${section}` : ''}`;

const dayCount = (d) => (d < 1 ? `${Math.max(1, Math.round(d * 24))} h` : `${d.toFixed(1)} days`);

// One status tile; opens its section of the full page in a new tab (without a section: a plain tile)
const BriefTile = ({ appId, section, Icon, label, value, sub, tone }) => (section ? (
    <Link to={dssHref(appId, section)} target="_blank" rel="noopener" className={`ds-brief-tile ${tone}`}>
        <span className="ic" aria-hidden="true"><Icon size={18} /></span>
        <span className="lbl">{label}</span>
        <span className="val"><Terms text={value} /></span>
        <span className="sub"><Terms text={sub} /></span>
        <ExternalLink size={14} className="go" aria-hidden="true" />
        <span className="sr-only"> (opens the Decision Support page in a new tab)</span>
    </Link>
) : (
    <div className={`ds-brief-tile ${tone}`}>
        <span className="ic" aria-hidden="true"><Icon size={18} /></span>
        <span className="lbl">{label}</span>
        <span className="val"><Terms text={value} /></span>
        <span className="sub"><Terms text={sub} /></span>
    </div>
));

const DecisionBrief = ({ ctx, id = 'rv-dss' }) => {
    const { app, readiness, mrac, mracChanges, exceptions, names, aoId, coId, stage } = ctx;
    const tat = stageTat(stage?.stage, stage?.enteredAt);
    const [policyLabel, policyTone, policySub] = policyStatus(mrac, mracChanges);
    const criteria = mrac?.status === 'DONE' ? mrac.result?.criteria ?? [] : [];
    const fails = criteria.filter((c) => c.status === 'fail').length;
    const reviews = criteria.filter((c) => c.status === 'needs_review').length;
    const flagged = fails + reviews + exceptions.length;
    const open = readiness.items.filter((i) => i.state !== READY.DONE);
    const ownerName = (role) => personName(role === 'ACCOUNT_OFFICER' ? names[aoId] : role === 'CREDIT_OFFICER' ? names[coId] : null);

    const highlightsSub = [
        fails ? `${fails} fail${fails === 1 ? 's' : ''}` : null,
        reviews ? `${reviews} need${reviews === 1 ? 's' : ''} review` : null,
        `${exceptions.length} recorded exception${exceptions.length === 1 ? '' : 's'}`,
    ].filter(Boolean).join(' · ');

    return (
        <Section id={id} title="Decision support" className="mrac ds ds-brief">
            <div className="ds-brief-tiles">
                <BriefTile appId={app.id} section="ds-readiness" Icon={ListChecks} label="Readiness"
                    value={`${readiness.readyCount} of ${readiness.total}`}
                    sub={readiness.ready ? 'Ready for decision' : `${open.length} item${open.length === 1 ? '' : 's'} need attention`}
                    tone={readiness.ready ? 'ok' : 'warn'} />
                <BriefTile appId={app.id} section="ds-policy" Icon={ShieldCheck} label="Policy check (MRAC)"
                    value={policyLabel} sub={policySub} tone={policyTone} />
                <BriefTile appId={app.id} section="ds-highlights" Icon={TriangleAlert} label="Exception highlights"
                    value={flagged === 0 ? 'None' : String(flagged)} sub={mrac?.status === 'DONE' ? highlightsSub : 'Needs a policy check'}
                    tone={fails > 0 ? 'bad' : flagged > 0 || mrac?.status !== 'DONE' ? 'warn' : 'ok'} />
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
        </Section>
    );
};

export default DecisionBrief;
