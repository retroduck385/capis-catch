// Final report (the panel's "final artifact"): the file's Financial Package (both pages), credit scoring sheet,
// decision support and sign-offs as one printable document. /finalReportPage?id=<application id>
// Every staff role except the Credit Investigator (DSS_ROLES, like Decision Support), once the file is Decided.
// The assigned Credit Officer can preview it as a DRAFT while editing in Credit Evaluation (also after a reviewer
// return). "Download PDF" opens the browser's print dialog ("Save as PDF"): A4 portrait, each part on a new page
// (finalReport.css). Nothing is uploaded or stored. Read only; layout after the bank's KYC-FP workbook, values from
// our own records only.
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Download, FileText, Lock } from 'lucide-react';
import { DecisionSupportSkeleton } from '../../components/skeleton';
import Breadcrumbs from '../../components/breadcrumbs';
import { personName } from '../../components/people';
import { UserAuth } from '../../context/authContext';
import { computeFp } from '../financialPackage/compute';
import { totalCreditScore } from '../financialPackage/creditScore';
import { CREDIT_RESULTS } from '../financialPackage/options';
import { buildReadiness } from '../decisionSupport/readiness';
import { fetchStaffNames } from '../loanFolder/api';
import { buildMracFacts } from '../mrac/facts';
import { positionLabel, splitRouting } from '../review/approval';
import { reviewState } from '../review/reviewChecks';
import { fetchFinalReport } from './api';
import { DecisionPage, FpPageOne, FpPageTwo, ScorePage, Sheet, SignoffPage } from './reportPages';
import { buildSignoffs, reportMode, whenPH } from './signoffs';
import '../loanFolder/loanFolder.css';
import './finalReport.css';

// Which facts differ between the ones the last policy check ran on and the figures now (same rule as Decision Support)
const changedFacts = (runFacts, nowFacts) => {
    if (!runFacts) return [];
    return Object.keys(nowFacts).filter((key) => {
        if (key === 'schema' || !(key in runFacts)) return false;
        const a = runFacts[key];
        const b = nowFacts[key];
        if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) > 1e-6 * Math.max(1, Math.abs(b));
        return (a ?? null) !== (b ?? null);
    }).map((key) => key.replaceAll('_', ' '));
};

const FinalReportPage = () => {
    const { session, role } = UserAuth();
    const [searchParams] = useSearchParams();
    const applicationId = Number(searchParams.get('id'));
    const [data, setData] = useState(null);
    const [me, setMe] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [next, myName] = await Promise.all([
                    fetchFinalReport(applicationId),
                    fetchStaffNames([session?.user?.id]).catch(() => ({})),
                ]);
                if (!cancelled) { setData(next); setMe(myName[session?.user?.id] ?? null); }
            } catch (err) {
                if (!cancelled) setError(err.message);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [applicationId, session?.user?.id]);

    // Printing this page hides the app's top bar and backdrop (finalReport.css, html.fr-print)
    useEffect(() => {
        document.documentElement.classList.add('fr-print');
        return () => document.documentElement.classList.remove('fr-print');
    }, []);

    if (loading) return <DecisionSupportSkeleton />;
    if (error) return <div className="lf lf-folder fr"><p className="lf-err" role="alert">{error}</p></div>;
    if (!data) return null;

    const { app, fp, rules, mrac, stage, rows, reviews, approvals, coCanEdit } = data;
    const mode = reportMode({ stage, role, coCanEdit });
    const back = (
        <Link to={`/loanFolderPage?id=${app.id}`} className="lf-btn"><ArrowLeft size={16} aria-hidden="true" />Loan folder</Link>
    );
    if (!mode) {
        return (
            <div className="lf lf-folder fr">
                <Breadcrumbs current="report" appId={app.id} appNo={app.application_no} />
                <section className="lf-card fr-locked">
                    <Lock size={20} aria-hidden="true" />
                    <p>The final report is available once the file is decided. The assigned Credit Officer can preview a draft while working on the Financial Package.</p>
                    {back}
                </section>
            </div>
        );
    }

    // The same derived figures as Decision Support
    const pkg = fp.pkg ?? {};
    const details = Object.fromEntries(fp.parties.map((d) => [d.applicant_id, d]));
    const computed = computeFp(app, details, pkg, { interest_rate: app.interest_rate });
    const score = totalCreditScore(rules, Object.fromEntries(fp.creditScore.map((x) => [x.criterion, x])));
    const exceptions = fp.exceptions.filter((e) => e.policy || e.exception_recommendation || e.mitigant);
    const { reviewers, approvers } = splitRouting(rows);
    const resultLabel = CREDIT_RESULTS.find((x) => x.value === pkg.credit_result)?.label;
    const nowFacts = buildMracFacts({ app, computed, score, pricing: { interest_rate: app.interest_rate }, exceptions: fp.exceptions });
    const mracChanges = mrac?.status === 'DONE' ? changedFacts(mrac.facts, nowFacts) : [];
    const base = {
        ...data, pkg, computed, score, exceptions, reviewers, approvers, resultLabel, mracChanges,
        reviewState: reviewState(rows, reviews), myId: session?.user?.id,
    };
    const r = { ...base, readiness: buildReadiness(base) };
    const signoffs = buildSignoffs({ stages: data.stages, rows, reviews, approvals, app, aoId: data.aoId, coId: data.coId, positionLabel });
    const generated = { at: whenPH(new Date().toISOString()), by: personName(me) || me || 'staff' };
    const sheet = { mode, app, generated };

    return (
        <div className="lf lf-folder fr">
            <div className="fr-noprint">
                <Breadcrumbs current="report" appId={app.id} appNo={app.application_no} />
                <header className="lf-hero">
                    <div className="lf-hero-main">
                        <p className="lf-eyebrow"><FileText size={15} aria-hidden="true" />{mode === 'DRAFT' ? 'Final report (draft preview)' : 'Final report'}</p>
                        <h1>Application <span className="lf-appno">{app.application_no}</span></h1>
                        <p className="fr-hint">
                            {mode === 'DRAFT'
                                ? 'Draft: every page is marked DRAFT. The final report is available once the file is decided.'
                                : 'A4, five parts, each on a new page. In the print dialog choose "Save as PDF"; untick "Headers and footers" if the browser adds the address.'}
                        </p>
                    </div>
                    <div className="lf-actions">
                        {back}
                        <button type="button" className="lf-primary" onClick={() => window.print()}>
                            <Download size={16} aria-hidden="true" />Download PDF
                        </button>
                    </div>
                </header>
            </div>

            {mode === 'DRAFT' && <div className="fr-mark-print" aria-hidden="true">DRAFT</div>}
            <div className="fr-sheets">
                <Sheet no={1} title="Financial Package (I to VII)" {...sheet}><FpPageOne r={r} /></Sheet>
                <Sheet no={2} title="Financial Package (VIII to XIV)" {...sheet}><FpPageTwo r={r} /></Sheet>
                <Sheet no={3} title="Housing Loan Credit Scoring Sheet" {...sheet}><ScorePage r={r} /></Sheet>
                <Sheet no={4} title="Decision Support" {...sheet}><DecisionPage r={r} /></Sheet>
                <Sheet no={5} title="Sign-offs" {...sheet}><SignoffPage r={r} signoffs={signoffs} /></Sheet>
            </div>
        </div>
    );
};

export default FinalReportPage;
