// Decision Support (basic, Sprint 4 scope): the supporting information for a credit decision on one page, read only.
// Opened from the loan folder. Every staff role except the Credit Investigator (DSS_ROLES in roles.js).
// Shows the latest policy check (MRAC / policy RAG, with its cited clauses), the Credit Officer's recommendation,
// key figures, credit score, CI results, exceptions, and the sign-offs / decisions so far.
// No decisions are made here: reviewers and approvers act on the review summary. Sprint 5 (committee decision support,
// CATCH Document 3.2.4.4.1) extends this page: add sections in sections.jsx and swap the loader in api.js for one RPC.
// Laid out like the review summary: header card + metrics, section navigator, section cards.
import { RouteSkeleton } from '../../components/skeleton';
import { Fragment, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, Info as InfoIcon } from 'lucide-react';
import Breadcrumbs from '../../components/breadcrumbs';
import { UserAuth } from '../../context/authContext';
import { getParties } from '../applicationForm/api';
import { BORROWER_ROLES, partyLabel } from '../applicationForm/options';
import { computeFp, percent } from '../financialPackage/compute';
import { totalCreditScore } from '../financialPackage/creditScore';
import { CREDIT_RESULTS } from '../financialPackage/options';
import { buildMracFacts } from '../mrac/facts';
import { OVERALL } from '../mrac/labels';
import { splitRouting } from '../review/approval';
import { reviewState } from '../review/reviewChecks';
import { scrollToSection, useActiveSection } from '../review/useActiveSection';
import { STAGE_STATUS_LABELS, stageLabel } from '../workTray/options';
import MessagesPanel from '../messages/messagesPanel';
import { fetchDecisionSupport } from './api';
import { money } from './format';
import { buildReadiness } from './readiness';
import { SECTIONS } from './registry';
import '../loanFolder/loanFolder.css';
import '../financialPackage/financialPackage.css';
import '../review/review.css';

const fullName = (p) => [p.first_name, p.middle_name, p.last_name, p.name_extension].filter(Boolean).join(' ');
const humanize = (key) => key.replaceAll('_', ' ');

// Which facts differ between the ones the check ran on and the figures now (numbers compared with a small tolerance)
const changedFacts = (runFacts, nowFacts) => {
    if (!runFacts) return [];
    return Object.keys(nowFacts).filter((key) => {
        if (key === 'schema' || !(key in runFacts)) return false;
        const a = runFacts[key];
        const b = nowFacts[key];
        if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) > 1e-6 * Math.max(1, Math.abs(b));
        return (a ?? null) !== (b ?? null);
    }).map(humanize);
};

const DecisionSupportPage = () => {
    const { session } = UserAuth();
    const [searchParams] = useSearchParams();
    const applicationId = Number(searchParams.get('id'));

    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [activeId, pickSection] = useActiveSection(SECTIONS.map((s) => s.id), Boolean(data));

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

    if (loading) return <RouteSkeleton label="Loading decision support" />;
    if (error) return <p className="ct-error">{error}</p>;
    if (!data) return null;

    const { app, fp, rules, mrac, stage, rows, reviews, approvals } = data;
    const pkg = fp.pkg ?? {};
    const details = Object.fromEntries(fp.parties.map((r) => [r.applicant_id, r]));
    const computed = computeFp(app, details, pkg, { interest_rate: app.interest_rate });
    const score = totalCreditScore(rules, Object.fromEntries(fp.creditScore.map((r) => [r.criterion, r])));
    const exceptions = fp.exceptions.filter((e) => e.policy || e.exception_recommendation || e.mitigant);
    const { reviewers, approvers } = splitRouting(rows);
    const resultLabel = CREDIT_RESULTS.find((r) => r.value === pkg.credit_result)?.label;

    // Same facts the Financial Package would send now, to tell whether the last check is out of date
    const nowFacts = buildMracFacts({ app, computed, score, pricing: { interest_rate: app.interest_rate }, exceptions: fp.exceptions });
    const mracChanges = mrac?.status === 'DONE' ? changedFacts(mrac.facts, nowFacts) : [];

    const base = {
        ...data, pkg, computed, score, exceptions, reviewers, approvers, resultLabel, mracChanges,
        reviewState: reviewState(rows, reviews), myId: session?.user?.id,
    };
    const ctx = { ...base, readiness: buildReadiness(base) };

    const visible = SECTIONS.filter((s) => !s.show || s.show(ctx));
    const borrowers = getParties(app, BORROWER_ROLES).map((p) => `${fullName(p)} (${partyLabel(p)})`).join(', ');
    const stageText = stage ? `${stageLabel(stage.stage)} · ${STAGE_STATUS_LABELS[stage.status] ?? '—'}` : '—';

    const mracDone = mrac?.status === 'DONE';
    const [policyLabel, policyTone] = mracDone
        ? (OVERALL[mrac.result?.overall] ?? [mrac.result?.overall ?? 'Done', 'plain'])
        : [mrac ? (mrac.status === 'FAILED' ? 'Check failed' : 'In progress') : 'Not run', 'warn'];

    const metrics = [
        {
            key: 'ready', label: 'Readiness', value: `${ctx.readiness.readyCount} of ${ctx.readiness.total}`,
            sub: ctx.readiness.ready ? 'Ready for decision' : 'Items missing', tone: ctx.readiness.ready ? 'info' : 'warn',
        },
        {
            key: 'policy', label: 'Policy check', value: policyLabel,
            sub: mracDone ? (mracChanges.length ? 'Figures changed since' : new Date(mrac.finished_at).toLocaleDateString()) : 'MRAC / RAG',
            tone: mracDone && mracChanges.length ? 'warn' : policyTone === 'ok' ? 'info' : policyTone === 'plain' ? 'plain' : 'warn',
        },
        { key: 'result', label: 'Credit result', value: resultLabel ?? 'Not set', sub: 'CO recommendation', tone: resultLabel ? 'info' : 'warn' },
        {
            key: 'risk', label: 'Credit risk rating', value: score.riskRating ?? 'Not scored',
            sub: score.riskRating ? `${score.total} / 100` : `${score.scored} of ${score.count} scored`,
            tone: score.riskRating ? 'info' : 'warn',
        },
        {
            key: 'loan', label: 'Loan amount', value: money(app.loan_amount),
            sub: app.loan_term_years ? `${app.loan_term_years} years` : 'Term not set', tone: 'plain',
        },
        { key: 'dbr', label: 'Debt burden ratio', value: percent(computed.dbr) ?? '—', sub: 'DBR', tone: 'plain' },
        { key: 'lcr', label: 'Loan-to-collateral', value: percent(computed.lcr) ?? '—', sub: 'LCR', tone: 'plain' },
    ];

    const goTo = (id) => (e) => {
        e.preventDefault();
        pickSection(id);
        scrollToSection(id);
    };

    return (
        <div className="lf fp rv">
            <Breadcrumbs current="decision" appId={app.id} appNo={app.application_no} />
            <header className="lf-card">
                <div className="lf-titlerow">
                    <div>
                        <h1>Decision support {app.application_no}</h1>
                        <ul className="lf-meta">
                            <li>Borrower/s: {borrowers || '—'}</li>
                            <li>Stage: {stageText}</li>
                            {approvals.length > 0 && <li>Approver decisions so far: {approvals.length}</li>}
                        </ul>
                    </div>
                    <div className="lf-actions">
                        <MessagesPanel applicationId={app.id} inline />
                        <Link to={`/financialPackagePage?id=${app.id}`} className="lf-btn">Financial Package</Link>
                        <Link to={`/reviewSummaryPage?id=${app.id}`} className="lf-btn">Review summary</Link>
                        <Link to={`/loanFolderPage?id=${app.id}`} className="lf-btn">
                            Loan folder<ArrowRight size={16} aria-hidden="true" />
                        </Link>
                    </div>
                </div>

                <div className="fp-metrics">
                    {metrics.map((m) => (
                        <div key={m.key} className={`fp-metric ${m.tone}`}>
                            <span className="lbl">{m.label}</span>
                            <span className="val">{m.value}</span>
                            <span className="sub">{m.sub}</span>
                        </div>
                    ))}
                </div>

                <p className="lf-note">
                    <InfoIcon size={16} aria-hidden="true" />
                    <span>
                        Supporting information for the decision, read only. Policy-check results are AI suggestions with
                        their source clause; people decide.
                    </span>
                </p>
            </header>

            <div className="lf-body edit">
                <nav className="lf-card lf-nav fp-nav" aria-label="Decision support sections">
                    <ul>
                        {visible.map((s) => (
                            <li key={s.id}>
                                <a href={`#${s.id}`} onClick={goTo(s.id)} aria-current={activeId === s.id ? 'true' : undefined}>
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
