// Decision Support (basic, Sprint 4 scope): the supporting information for a credit decision on one page, read only.
// Opened from the loan folder. Every staff role except the Credit Investigator (DSS_ROLES in roles.js).
// Shows the latest policy check (MRAC / policy RAG, with its cited clauses), the Credit Officer's recommendation,
// key figures, credit score, CI results, exceptions, and the sign-offs / decisions so far.
// No decisions are made here: reviewers and approvers act on the review summary. Sprint 5 (committee decision support,
// CATCH Document 3.2.4.4.1) extends this page: add sections in sections.jsx and swap the loader in api.js for one RPC.
// Look (DESIGN.md, "Decision support"): the Credit Officer pages' .lf-fp look (root lf-ds): header with a Read-only tag
// and fact chips, the figures as tiles (Readiness and Policy check jump to their section), glass section cards.
// Styles: decisionSupport.css (.lf-ds block).
import { DecisionSupportSkeleton } from '../../components/skeleton';
import { Fragment, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import {
    ArrowRight, ClipboardCheck, Gauge, House, Info as InfoIcon, ListChecks, Lock, Percent, Scale, ShieldCheck, Stamp, Users, Wallet,
} from 'lucide-react';
import { formatDay } from '../../components/people';
import Breadcrumbs from '../../components/breadcrumbs';
import { UserAuth } from '../../context/authContext';
import { getParties } from '../applicationForm/api';
import { BORROWER_ROLES, partyLabel } from '../applicationForm/options';
import { percent } from '../financialPackage/compute';
import { OVERALL } from '../mrac/labels';
import { scrollToSection, useActiveSection } from '../review/useActiveSection';
import { STAGE_STATUS_LABELS, stageLabel } from '../workTray/options';
import MessagesPanel from '../messages/messagesPanel';
import { fetchDecisionSupport } from './api';
import { money } from './format';
import { buildDssContext } from './context';
import { SECTIONS } from './registry';
import '../loanFolder/loanFolder.css';
import '../financialPackage/financialPackage.css';
import '../review/review.css';
import { Terms } from '../../components/term';
import { useTermTitle } from '../../components/useTermTitle';
import FinalReportButton from '../finalReport/finalReportButton';

const fullName = (p) => [p.first_name, p.middle_name, p.last_name, p.name_extension].filter(Boolean).join(' ');

const DecisionSupportPage = () => {
    const { session } = UserAuth();
    const tt = useTermTitle();
    const [searchParams] = useSearchParams();
    const applicationId = Number(searchParams.get('id'));

    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [activeId, pickSection] = useActiveSection(SECTIONS.map((s) => s.id), Boolean(data));
    const { hash } = useLocation();
    const scrolledTo = useRef(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const next = await fetchDecisionSupport(applicationId);
                if (!cancelled) setData(next);
            } catch (err) {
                if (!cancelled) setError(err.message);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [applicationId]);

    // Opened at a section (a review checklist item links to /decisionSupportPage?id=7#ds-highlights): go there once loaded
    useEffect(() => {
        const id = hash ? decodeURIComponent(hash.slice(1)) : null;
        if (!data || !id || scrolledTo.current === id || !document.getElementById(id)) return;
        scrolledTo.current = id;
        pickSection(id);
        scrollToSection(id);
    }, [data, hash, pickSection]);

    if (loading) return <DecisionSupportSkeleton />;
    if (error) {
        return (
            <div className="lf lf-folder lf-fp lf-ds">
                <p className="lf-err" role="alert">{error}</p>
            </div>
        );
    }
    if (!data) return null;

    const ctx = buildDssContext(data, session?.user?.id);
    const { app, mrac, stage, approvals, computed, score, resultLabel, mracChanges } = ctx;

    const visible = SECTIONS.filter((s) => !s.show || s.show(ctx));
    const borrowers = getParties(app, BORROWER_ROLES).map((p) => `${fullName(p)} (${partyLabel(p)})`).join(', ');
    const stageText = stage ? `${stageLabel(stage.stage)} · ${STAGE_STATUS_LABELS[stage.status] ?? '—'}` : '—';

    const mracDone = mrac?.status === 'DONE';
    const [policyLabel, policyTone] = mracDone
        ? (OVERALL[mrac.result?.overall] ?? [mrac.result?.overall ?? 'Done', 'plain'])
        : [mrac ? (mrac.status === 'FAILED' ? 'Check failed' : 'In progress') : 'Not run', 'warn'];

    // The figures as tiles (tone 'warn': missing or needs a look; 'done': in place). `to`: the tile opens that section
    const metrics = [
        {
            key: 'ready', Icon: ListChecks, label: 'Readiness', value: `${ctx.readiness.readyCount} of ${ctx.readiness.total}`,
            sub: ctx.readiness.ready ? 'Ready for decision' : 'Items missing', tone: ctx.readiness.ready ? 'done' : 'warn', to: 'ds-readiness',
        },
        {
            key: 'policy', Icon: ShieldCheck, label: 'Policy check', value: policyLabel,
            sub: mracDone ? (mracChanges.length ? 'Figures changed since' : formatDay(mrac.finished_at)) : 'MRAC / RAG',
            tone: mracDone && mracChanges.length ? 'warn' : policyTone === 'ok' ? 'done' : policyTone === 'plain' ? '' : 'warn',
            to: 'ds-highlights',
        },
        { key: 'result', Icon: ClipboardCheck, label: 'Credit result', value: resultLabel ?? 'Not set', sub: 'CO recommendation', tone: resultLabel ? 'done' : 'warn' },
        {
            key: 'risk', Icon: Gauge, label: 'Credit risk rating', value: score.riskRating ?? 'Not scored',
            sub: score.riskRating ? `${score.total} / 100` : `${score.scored} of ${score.count} scored`,
            tone: score.riskRating ? 'done' : 'warn',
        },
        {
            key: 'loan', Icon: Wallet, label: 'Loan amount', value: money(app.loan_amount),
            sub: app.loan_term_years ? `${app.loan_term_years} years` : 'Term not set', tone: '',
        },
        { key: 'dbr', Icon: Percent, label: 'Debt burden ratio', value: percent(computed.dbr) ?? '—', sub: 'DBR', tone: computed.dbr === null ? 'warn' : '' },
        { key: 'lcr', Icon: House, label: 'Loan-to-collateral', value: percent(computed.lcr) ?? '—', sub: 'LCR', tone: '' },
    ];

    const goTo = (id) => (e) => {
        e.preventDefault();
        pickSection(id);
        scrollToSection(id);
    };

    return (
        <div className="lf lf-folder lf-fp lf-ds fp rv">
            <Breadcrumbs current="decision" appId={app.id} appNo={app.application_no} />
            <header className="lf-hero">
                <div className="lf-hero-main">
                    <p className="lf-eyebrow">
                        <Scale size={15} aria-hidden="true" />
                        <span>Decision support</span>
                        <span className="lf-mode read"><Lock size={13} aria-hidden="true" />Read-only</span>
                    </p>
                    <h1>Application <span className="lf-appno">{app.application_no}</span></h1>
                    <ul className="lf-meta">
                        <li>
                            <Users size={15} aria-hidden="true" />
                            <span className="k">Borrower/s</span>
                            <span className="v cs-names">{borrowers || '—'}</span>
                        </li>
                        <li>
                            <span className="k">Stage</span>
                            <span className="v">{stageText}</span>
                        </li>
                        {approvals.length > 0 && (
                            <li>
                                <Stamp size={15} aria-hidden="true" />
                                <span className="k">Approver decisions</span>
                                <span className="v">{approvals.length}</span>
                            </li>
                        )}
                    </ul>
                </div>
                <div className="lf-actions">
                    <MessagesPanel applicationId={app.id} inline />
                    <FinalReportButton applicationId={app.id} />
                    <Link to={`/financialPackagePage?id=${app.id}`} className="lf-btn">Financial Package</Link>
                    <Link to={`/reviewSummaryPage?id=${app.id}`} className="lf-btn">Review summary</Link>
                    <Link to={`/loanFolderPage?id=${app.id}`} className="lf-btn">
                        Loan folder<ArrowRight size={16} aria-hidden="true" />
                    </Link>
                </div>
            </header>

            <p className="lf-note">
                <InfoIcon size={16} aria-hidden="true" />
                <span>
                    Supporting information for the decision, read only. Policy-check results are AI suggestions with
                    their source clause; people decide.
                </span>
            </p>

            <section className="fp-tiles seven" aria-label="Key figures">
                {metrics.map(({ key, Icon, label, value, sub, tone, to }) => {
                    const body = (
                        <>
                            <span className="ic" aria-hidden="true"><Icon size={18} /></span>
                            <span className="lbl">{label}</span>
                            <span className="val"><Terms text={value} /></span>
                            <span className="sub">
                                <Terms text={sub} />
                                {to && <span className="go">See<ArrowRight size={14} aria-hidden="true" /></span>}
                            </span>
                        </>
                    );
                    return to
                        ? <a key={key} href={`#${to}`} onClick={goTo(to)} className={`lf-tile fp-tile ${tone}`}>{body}</a>
                        : <div key={key} className={`lf-tile fp-tile ${tone}`}>{body}</div>;
                })}
            </section>

            <div className="lf-body edit">
                <nav className="lf-card lf-nav fp-nav" aria-label="Decision support sections">
                    <ul>
                        {visible.map((s) => (
                            <li key={s.id}>
                                <a href={`#${s.id}`} onClick={goTo(s.id)} title={tt(s.labelFor ? s.labelFor(ctx) : s.label)} aria-current={activeId === s.id ? 'true' : undefined}>
                                    {s.labelFor ? s.labelFor(ctx) : s.label}
                                </a>
                            </li>
                        ))}
                    </ul>
                </nav>

                <div className="lf-main fp-main">
                    {visible.map(({ id, Component }) => <Fragment key={id}><Component ctx={ctx} /></Fragment>)}
                </div>
            </div>
        </div>
    );
};

export default DecisionSupportPage;
