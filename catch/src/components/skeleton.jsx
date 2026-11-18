// Skeleton loading screens, used in place of "Loading..." text. Each one is built from the real page's own markup and
// classes, with placeholder words where the data will go; the placeholder text is painted as grey blocks (see
// skeleton.css). So the sizes, spacing and shapes come from the same stylesheets as the loaded page, and nothing jumps
// when the data arrives. Every screen is a polite live region with a screen-reader label; the blocks are aria-hidden.
import { ChevronRight } from 'lucide-react';
import './skeleton.css';

/* ---------- pieces ---------- */

const T = ({ children }) => <span className="sk-t">{children}</span>; // placeholder text
const Box = ({ h, w, style, className = '' }) => (
    <span className={`sk-box ${className}`.trim()} style={{ height: h, width: w, ...style }} />
);
const Status = ({ label, className = '', children }) => (
    <div className={`sk-root ${className}`.trim()} role="status" aria-busy="true" aria-live="polite">
        <span className="sr-only">{label}</span>
        {children}
    </div>
);
const stack = (n, make) => Array.from({ length: n }, (_, i) => make(i));

// The breadcrumb row above a staff page's header card
const Crumbs = ({ items }) => (
    <nav className="lf-crumbs" aria-hidden="true">
        <ol>
            {items.map((label, i) => (
                <li key={label}>
                    {i === items.length - 1
                        ? <span aria-current="page" className="sk-btn">{label}</span>
                        : <a className="sk-btn">{label}</a>}
                    {i < items.length - 1 && <ChevronRight size={14} className="crumb-sep" aria-hidden="true" />}
                </li>
            ))}
        </ol>
    </nav>
);

// Section navigator. Pass `items` (a flat list) or `groups` ([{ group, items }])
const Nav = ({ items, groups }) => (
    <nav className="lf-card lf-nav fp-nav" aria-hidden="true">
        {groups
            ? groups.map((g) => (
                <div key={g.group}>
                    <p className="fp-navgroup"><T>{g.group}</T></p>
                    <ul>{g.items.map((i) => <li key={i}><a><T>{i}</T></a></li>)}</ul>
                </div>
            ))
            : <ul>{items.map((i) => <li key={i}><a><T>{i}</T></a></li>)}</ul>}
    </nav>
);

// A section card (the page's fieldset.ct-section with its grey title bar)
const Sec = ({ title, children }) => (
    <fieldset className="ct-section" aria-hidden="true">
        <legend><T>{title}</T></legend>
        {children}
    </fieldset>
);

const Info = ({ rows }) => (
    <dl className="fp-info">
        {rows.map(([k, v]) => (
            <div key={k} className="fp-info-row"><dt><T>{k}</T></dt><dd><T>{v}</T></dd></div>
        ))}
    </dl>
);

const Fields = ({ labels }) => labels.map((l) => (
    <div key={l} className="ct-field"><label><T>{l}</T></label><Box h="2.6rem" /></div>
));

// cells: text, or '@input' / '@inputs' (a select, or a select with a remarks box)
const Table = ({ className = '', head, cells, rows }) => (
    <div className="fp-tablewrap">
        <table className={className}>
            <thead><tr>{head.map((h) => <th key={h}><T>{h}</T></th>)}</tr></thead>
            <tbody>
                {stack(rows, (i) => (
                    <tr key={i}>
                        {cells.map((c, j) => (
                            <td key={j}>
                                {c === '@input' ? <Box h="2.6rem" />
                                    : c === '@inputs' ? <span style={{ display: 'grid', gap: '0.4rem' }}><Box h="2.6rem" /><Box h="2.6rem" /></span>
                                        : <T>{c}</T>}
                            </td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
);

const Bars = ({ n, h }) => <div style={{ display: 'grid', gap: '0.6rem' }}>{stack(n, (i) => <Box key={i} h={h} />)}</div>;

// A loan-folder style card: title row, then content
const Card = ({ title, aside, children }) => (
    <section className="lf-card" aria-hidden="true">
        <div className="lf-cardhead"><h2><T>{title}</T></h2>{aside && <span><T>{aside}</T></span>}</div>
        {children}
    </section>
);

const APP_NO = 'HL-2026-000000';
const BORROWERS = 'Josh Denzel Chua Bun Pho Ng';
const GAP = '    '; // room for a button's arrow icon

const KYC_TITLES = ['Loan Details', 'Principal Borrower', 'Address', 'Employment', 'Spouse', 'Co-borrowers',
    'Mortgagor / Attorney-in-Fact', 'Financial Obligations', 'Character References', 'Collateral & Referral', 'Documents'];

/* ---------- staff pages ---------- */

export const LoanFolderSkeleton = () => (
    <Status label="Loading loan folder" className="lf lf-folder">
        <Crumbs items={['Work tray', `Application ${APP_NO}`]} />
        <header className="lf-hero" aria-hidden="true">
            <div className="lf-hero-main">
                <p className="lf-eyebrow"><T>Loan folder</T><span className="lf-mode read sk-btn">Read-only</span></p>
                <h1><T>{`Application ${APP_NO}`}</T></h1>
                <ul className="lf-meta"><li><T>Submitted Sep 29, 2026, 2:05 PM</T></li><li><T>CI requested Oct 20, 2026, 4:48 PM by Account Officer</T></li></ul>
            </div>
            <div className="lf-actions">{['Messages', `Financial package${GAP}`].map((a) => <span key={a} className="lf-btn sk-btn">{a}</span>)}</div>
        </header>
        <div className="lf-dash" aria-hidden="true">
            <article className="lf-card lf-progresscard">
                <h2 className="lf-wtitle"><T>KYC verification</T></h2>
                <div className="lf-ringrow">
                    <div className="lf-ring"><Box className="circle" h="100%" /></div>
                    <ul className="lf-keys">
                        {['Verified', 'Needs clarification', 'Not checked'].map((k) => <li key={k}><span className="lf-key sk-btn">{k}<b>0</b></span></li>)}
                    </ul>
                </div>
            </article>
            {['Credit investigation', 'Change history'].map((t) => (
                <div key={t} className="lf-tile">
                    <span className="ic sk-btn" />
                    <span className="lbl"><T>{t}</T></span>
                    <span className="val"><T>Requested</T></span>
                    <span className="sub"><T>Oct 20, 2026, 4:48 PM</T></span>
                </div>
            ))}
        </div>
        <div className="lf-body">
            <div className="lf-main">
                <Card title="KYC verification by section" aside="0 of 11 verified">
                    <ul className="lf-kyc">
                        {KYC_TITLES.map((t) => (
                            <li key={t} className="lf-kyc-item none">
                                <span className="lf-kyc-ic"><span className="sk-btn" style={{ display: 'block', width: 18, height: 18, borderRadius: '50%' }} /></span>
                                <div className="lf-kyc-head"><b className="lf-kyc-name"><T>{t}</T></b></div>
                                <span className="lf-chip none sk-btn">Not checked</span>
                                <div className="lf-kyc-body"><p className="lf-kyc-meta"><T>Not checked yet.</T></p></div>
                            </li>
                        ))}
                    </ul>
                </Card>
                <Card title="Application details">
                    <Info rows={[['Loan type', 'Housing loan'], ['Loan amount', '₱1,000,000.00'], ['Term', '2 years'],
                        ['Principal borrower', BORROWERS], ['Civil status', 'Single'], ['Present address', '123 Sample Street, Quezon City']]} />
                </Card>
                <Card title="Change history"><Bars n={2} h="2.5rem" /></Card>
            </div>
        </div>
    </Status>
);

export const FinancialPackageSkeleton = () => (
    <Status label="Loading financial package" className="lf lf-folder lf-fp fp">
        <Crumbs items={['Work tray', `Application ${APP_NO}`, 'Financial Package']} />
        <header className="lf-hero" aria-hidden="true">
            <div className="lf-hero-main">
                <p className="lf-eyebrow"><T>Financial Package &amp; Credit Recommendation</T><span className="lf-mode read sk-btn">You can edit</span></p>
                <h1><T>{`Application ${APP_NO}`}</T></h1>
                <ul className="lf-meta">{['Housing loan ₱1,000,000.00', 'Handling Account Officer Josh Denzel'].map((m) => <li key={m}><T>{m}</T></li>)}</ul>
            </div>
            <div className="lf-actions"><span className="lf-btn sk-btn">Messages</span></div>
        </header>
        <section className="fp-tiles" aria-hidden="true">
            {[['Credit risk rating', 'Not scored'], ['Debt burden ratio', '00.00%'], ['Loan-to-collateral', '00.00%'],
                ['Monthly amortization', '₱00,000.00'], ['Combined gross income', '₱000,000.00']].map(([l, v]) => (
                <div key={l} className="lf-tile fp-tile">
                    <Box h="2.3rem" w="2.3rem" style={{ borderRadius: 12, gridArea: 'ic' }} />
                    <span className="lbl"><T>{l}</T></span>
                    <span className="val"><T>{v}</T></span>
                    <span className="sub"><T>Per month</T></span>
                </div>
            ))}
        </section>
        <div className="fp-pagetabs" aria-hidden="true">
            {['Recommendation', 'Application information'].map((t) => <Box key={t} h="4.25rem" style={{ flex: '1 1 0', borderRadius: 18 }} />)}
        </div>
        <div className="lf-body edit">
            <Nav groups={[
                { group: 'Page 1: Recommendation', items: ['General information', 'I. Borrower/s highlight', 'II. Facility', 'III. Collateral', 'IV. Credit checking', 'V. Exceptions'] },
            ]} />
            <div className="lf-main fp-main">
                <Sec title="General Information">
                    <Info rows={[['Channel', 'Developer Referred'], ['Branch / Developer Name', 'Sample Homes Inc.'], ['Handling Account Officer', 'Josh Denzel']]} />
                </Sec>
                <Sec title="I. Borrower/s Highlight">
                    <Info rows={[['Principal borrower', BORROWERS], ['Employer', 'Sample Company Inc.'], ['Monthly gross income', '₱000,000.00']]} />
                </Sec>
                <Sec title="II. Facility Financial Package">
                    <Fields labels={['Variant', 'Interest rate', 'Fixing period', 'Manner of repayment']} />
                </Sec>
            </div>
        </div>
    </Status>
);

export const CreditScoreSkeleton = () => (
    <Status label="Loading credit scoring" className="lf lf-folder lf-fp lf-cs fp rv">
        <Crumbs items={['Work tray', `Application ${APP_NO}`, 'Financial Package', 'Credit score']} />
        <header className="lf-hero" aria-hidden="true">
            <div className="lf-hero-main">
                <p className="lf-eyebrow"><T>Housing Loan Credit Scoring</T><span className="lf-mode read sk-btn">You can edit</span></p>
                <h1><T>{`Application ${APP_NO}`}</T></h1>
                <ul className="lf-meta">{[`Borrower/s ${BORROWERS}`, 'Loan amount ₱1,000,000.00'].map((m) => <li key={m}><T>{m}</T></li>)}</ul>
            </div>
            <div className="lf-actions"><span className="lf-btn sk-btn">Messages</span></div>
        </header>
        <section className="fp-tiles" aria-hidden="true">
            {[['Total score', '0 / 100'], ['Credit risk rating', 'Not scored'], ['Recommendation', '—'], ['Loan amount', '₱1,000,000.00'], ['Suggestions to confirm', '13']].map(([l, v]) => (
                <div key={l} className="lf-tile fp-tile">
                    <Box h="2.3rem" w="2.3rem" style={{ borderRadius: 12, gridArea: 'ic' }} />
                    <span className="lbl"><T>{l}</T></span>
                    <span className="val"><T>{v}</T></span>
                    <span className="sub"><T>Requested</T></span>
                </div>
            ))}
        </section>
        <div className="lf-body edit">
            <Nav items={['1. Capacity', '2. Character', '3. Collateral', '4. Condition', 'Total score', 'Change history']} />
            <div className="lf-main fp-main">
                <Sec title="1. Capacity (Maximum Score: 30)">
                    <div className="cs-sub">
                        <div className="cs-sub-top"><span><T>Sub-total</T></span><b><T>0 / 30</T></b></div>
                        <div className="lf-meter"><span /></div>
                    </div>
                    <ul className="cs-crits">{stack(3, (i) => <li key={i}><Box h="8rem" style={{ borderRadius: 16 }} /></li>)}</ul>
                </Sec>
            </div>
        </div>
    </Status>
);

export const ApprovalRoutingSkeleton = () => (
    <Status label="Loading VII. Approval" className="lf lf-folder lf-fp lf-ar fp rv">
        <Crumbs items={['Work tray', `Application ${APP_NO}`, 'Financial Package', 'Approval routing']} />
        <header className="lf-hero" aria-hidden="true">
            <div className="lf-hero-main">
                <p className="lf-eyebrow"><T>VII. Approval routing</T><span className="lf-mode read sk-btn">You can edit</span></p>
                <h1><T>{`Application ${APP_NO}`}</T></h1>
                <ul className="lf-meta">{[`Borrower/s ${BORROWERS}`, 'Stage Credit Evaluation · In Progress'].map((m) => <li key={m}><T>{m}</T></li>)}</ul>
            </div>
            <div className="lf-actions"><span className="lf-btn sk-btn">Messages</span></div>
        </header>
        <section className="fp-tiles four" aria-hidden="true">
            {[['Credit result', 'Not set'], ['Credit risk rating', 'Not scored'], ['Loan amount', '₱1,000,000.00'], ['Approval authority', 'Credit Committee']].map(([l, v]) => (
                <div key={l} className="lf-tile fp-tile">
                    <Box h="2.3rem" w="2.3rem" style={{ borderRadius: 12, gridArea: 'ic' }} />
                    <span className="lbl"><T>{l}</T></span>
                    <span className="val"><T>{v}</T></span>
                    <span className="sub"><T>Requested</T></span>
                </div>
            ))}
        </section>
        <div className="lf-body edit">
            <Nav items={['Prepared by', 'Approval authority', 'Reviewers and approvers', 'Routing history']} />
            <div className="lf-main fp-main">
                <Sec title="Prepared by">
                    <Info rows={[['Account Officer', 'Josh Denzel'], ['Credit Officer', 'Unassigned'], ['Credit result', 'Not set'], ['Credit risk rating', 'Not scored']]} />
                </Sec>
                <Sec title="Approval authority">
                    <Table head={['Loan amount', 'Without deviation', 'With deviation']} cells={['Up to ₱3,000,000.00', 'Credit Department Head', 'Credit Division Head']} rows={4} />
                </Sec>
                <Sec title="Reviewers and approvers"><Bars n={3} h="3.2rem" /></Sec>
            </div>
        </div>
    </Status>
);

export const ReviewSummarySkeleton = () => (
    <Status label="Loading review summary" className="lf lf-folder lf-fp lf-rv fp rv">
        <Crumbs items={['Work tray', `Application ${APP_NO}`, 'Review summary']} />
        <header className="lf-hero" aria-hidden="true">
            <div className="lf-hero-main">
                <p className="lf-eyebrow"><T>Review summary</T><span className="lf-mode read sk-btn">Your turn</span></p>
                <h1><T>{`Application ${APP_NO}`}</T></h1>
                <ul className="lf-meta">{[`Borrower/s ${BORROWERS}`, 'Stage Review · Pending', 'Sent for review Josh Denzel · Yesterday'].map((m) => <li key={m}><T>{m}</T></li>)}</ul>
            </div>
            <div className="lf-actions"><span className="lf-btn sk-btn">Messages</span></div>
        </header>
        <p className="lf-note" aria-hidden="true"><T>You are reviewer 1 of 1. It's your turn.</T></p>
        <section className="fp-tiles six" aria-hidden="true">
            {[['Credit result', 'Endorsed'], ['Credit risk rating', 'Not scored'], ['Loan amount', '₱1,000,000.00'], ['Debt burden ratio', '00.00%'],
                ['Loan-to-collateral', '50.00%'], ['Monthly amortization', '₱00,000.00']].map(([l, v]) => (
                <div key={l} className="lf-tile fp-tile">
                    <Box h="2.3rem" w="2.3rem" style={{ borderRadius: 12, gridArea: 'ic' }} />
                    <span className="lbl"><T>{l}</T></span>
                    <span className="val"><T>{v}</T></span>
                    <span className="sub"><T>New loan</T></span>
                </div>
            ))}
        </section>
        <div className="lf-body edit">
            <Nav items={['Review progress', 'Decision support', 'Flags to check (4)', "Credit Officer's recommendation", 'Income evidence', 'Key figures',
                'IV. Credit checking', 'Credit score', 'V. Exceptions', 'Changes since', 'VII. Approval', 'Your review']} />
            <div className="lf-main fp-main">
                <Sec title="Review progress"><Bars n={1} h="3.4rem" /></Sec>
                <Sec title="Decision support"><Bars n={2} h="2.7rem" /></Sec>
                <Sec title="Flags to check (4)"><Bars n={3} h="2.7rem" /></Sec>
                <Sec title="Credit Officer's recommendation">
                    <Info rows={[['Credit result', 'Endorsed'], ['Justification and remarks', 'Sample remarks from the credit officer']]} />
                </Sec>
            </div>
        </div>
    </Status>
);

export const DecisionSupportSkeleton = () => (
    <Status label="Loading decision support" className="lf lf-folder lf-fp lf-ds fp rv">
        <Crumbs items={['Work tray', `Application ${APP_NO}`, 'Decision support']} />
        <header className="lf-hero" aria-hidden="true">
            <div className="lf-hero-main">
                <p className="lf-eyebrow"><T>Decision support</T><span className="lf-mode read sk-btn">Read-only</span></p>
                <h1><T>{`Application ${APP_NO}`}</T></h1>
                <ul className="lf-meta">{[`Borrower/s ${BORROWERS}`, 'Stage Review · Pending'].map((m) => <li key={m}><T>{m}</T></li>)}</ul>
            </div>
            <div className="lf-actions"><span className="lf-btn sk-btn">Messages</span><span className="lf-btn sk-btn">Financial Package</span></div>
        </header>
        <p className="lf-note" aria-hidden="true"><T>Supporting information for the decision, read only.</T></p>
        <section className="fp-tiles seven" aria-hidden="true">
            {['Readiness', 'Policy check', 'Credit result', 'Credit risk rating', 'Loan amount', 'Debt burden ratio', 'Loan-to-collateral'].map((l) => (
                <div key={l} className="lf-tile fp-tile">
                    <Box h="2.3rem" w="2.3rem" style={{ borderRadius: 12, gridArea: 'ic' }} />
                    <span className="lbl"><T>{l}</T></span>
                    <span className="val"><T>00.00%</T></span>
                    <span className="sub"><T>Requested</T></span>
                </div>
            ))}
        </section>
        <div className="lf-body edit">
            <Nav items={['Readiness (5 of 7)', 'Exception highlights (2)', 'Policy check (RAG)', "Credit Officer's recommendation", 'Key figures',
                'Credit score', 'IV. Credit checking', 'V. Exceptions', 'Sign-offs and decisions', 'Where to act']} />
            <div className="lf-main fp-main">
                <Sec title="Readiness for decision (5 of 7)"><Bars n={4} h="4rem" /></Sec>
                <Sec title="Exception highlights (2)"><Bars n={2} h="3.4rem" /></Sec>
            </div>
        </div>
    </Status>
);

export const CiRequestSkeleton = () => (
    <Status label="Loading CI request" className="lf lf-folder lf-ci">
        <Crumbs items={['Work tray', `CI request ${APP_NO}`]} />
        <header className="lf-hero" aria-hidden="true">
            <div className="lf-hero-main">
                <p className="lf-eyebrow"><T>CI request</T><span className="lf-mode read sk-btn">You can edit</span></p>
                <h1><T>{`Application ${APP_NO}`}</T></h1>
                <ul className="lf-meta">
                    {['Requested Josh Denzel · Yesterday, 3:33 PM', 'Borrowers 1', 'Housing loan ₱1,000,000.00'].map((m) => <li key={m}><T>{m}</T></li>)}
                </ul>
            </div>
            <div className="lf-actions"><span className="lf-btn sk-btn">Messages</span></div>
        </header>
        <section className="lf-card lf-stepcard" aria-hidden="true">
            <p className="lf-steps-label"><T>Your steps</T></p>
            <ol className="lf-steps" style={{ '--lf-step-count': 3 }}>
                {stack(3, (i) => <li key={i} className="lf-step"><Box h="4.75rem" style={{ borderRadius: 18 }} /></li>)}
            </ol>
        </section>
        <section className="lf-card ci-panel" aria-hidden="true">
            <div className="ci-panel-head">
                <Box h="2.75rem" w="2.75rem" style={{ borderRadius: 14 }} />
                <div className="ci-panel-title">
                    <p className="ci-panel-kicker"><T>Step 1 of 3</T></p>
                    <h2><T>Review the request</T></h2>
                    <p className="ci-panel-intro"><T>What the Account Officer is asking you to check, built from the application.</T></p>
                </div>
            </div>
            <div className="ci-step">
                <Box h="3.25rem" style={{ borderRadius: 16 }} />
                <Box h="9rem" style={{ borderRadius: 16 }} />
                <Box h="14rem" style={{ borderRadius: 16 }} />
            </div>
        </section>
    </Status>
);

/* ---------- work tray ---------- */

const STAGE_NAMES = ['Intake', 'Credit Investigation', 'Credit Evaluation', 'Review', 'Approval', 'Decided'];

export const WorkTraySkeleton = () => (
    <Status label="Loading work tray" className="wt">
        <section className="wt-dash" aria-hidden="true">
            <article className="wt-card wt-widget">
                <h2 className="wt-wtitle"><T>Turnaround time</T></h2>
                <div className="wt-donutrow">
                    <div className="wt-donut">
                        <svg viewBox="0 0 100 100"><circle className="ring" cx="50" cy="50" r="42" /></svg>
                        <div className="mid"><b><T>00</T></b><span><T>open</T></span></div>
                    </div>
                    <ul className="wt-keys">
                        {['Beyond TAT', 'Near TAT', 'On track'].map((k) => (
                            <li key={k}><span className="wt-key plain static"><i /><T>{k}</T><b><T>0</T></b></span></li>
                        ))}
                    </ul>
                </div>
            </article>
            <article className="wt-card wt-widget">
                <h2 className="wt-wtitle"><T>Applications by stage</T></h2>
                <ol className="wt-flow">
                    {STAGE_NAMES.filter((s) => s !== 'Decided').map((s) => (
                        <li key={s} className="zero" style={{ '--st': '#94a3b8', '--mix': '12%' }}><button type="button" tabIndex={-1} disabled><span className="name"><T>{s}</T></span><span className="num"><T>0</T></span></button></li>
                    ))}
                </ol>
            </article>
            <div className="wt-kpis">
                {['Assigned to me', 'Unassigned'].map((l) => (
                    <div key={l} className="wt-tile plain"><span className="ic sk-btn" /><span className="val"><T>00</T></span><span className="lbl"><T>{l}</T></span></div>
                ))}
            </div>
        </section>

        <section className="wt-card wt-tablecard" aria-hidden="true">
            <div className="wt-toolbar">
                <div className="wt-toolbar-top">
                    <div className="wt-tabletitle"><h2><T>Applications</T></h2><p className="wt-count"><T>0 of 0</T></p></div>
                    <Box w="6rem" h="2.6rem" />
                </div>
                <div className="wt-toolbar-filters">
                    <div className="wt-search"><Box h="2.6rem" /></div>
                    <Box w="10rem" h="2.6rem" /><Box w="10rem" h="2.6rem" /><Box w="10rem" h="2.6rem" />
                </div>
            </div>
            <div className="wt-scroll">
                <table>
                    <thead>
                        <tr>
                            <th><T>#</T></th><th><T>Application</T></th><th><T>Stage</T></th><th className="wt-amt"><T>Amount</T></th>
                            <th><T>TAT position</T></th><th><T>Assigned to</T></th><th><T>Review &amp; approval</T></th>
                        </tr>
                    </thead>
                    <tbody>
                        {stack(7, (i) => (
                            <tr key={i} className="wt-row">
                                <td className="wt-fifo"><T>0</T></td>
                                <td>
                                    <div className="wt-refline"><span className="wt-ref"><T>{APP_NO}</T></span></div>
                                    <span className="wt-name"><T>{BORROWERS}</T></span>
                                    <span className="wt-sub"><T>Employed · Main Branch</T></span>
                                </td>
                                <td>
                                    <div className="wt-stagecell"><span><T>Credit Evaluation</T></span><span className="wt-status plain sk-btn">In progress</span></div>
                                </td>
                                <td className="wt-amt"><T>₱1,000,000.00</T></td>
                                <td>
                                    <div className="wt-tat plain">
                                        <div className="wt-tat-top"><span><T>Day 0 of 0</T></span><span><T>On track</T></span></div>
                                        <div className="wt-bar"><span /></div>
                                    </div>
                                </td>
                                <td>
                                    <div className="wt-slots">
                                        <span className="wt-sub"><T>Account Officer: Josh Denzel</T></span>
                                        <span className="wt-sub"><T>Credit Officer: Unassigned</T></span>
                                    </div>
                                </td>
                                <td><span className="wt-sub"><T>Not routed yet</T></span></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    </Status>
);

/* ---------- profiles and the application form ---------- */

// My profile / staff profile (the .sp layout)
export const ProfileSkeleton = ({ label = 'Loading profile', back = 'My applications' }) => (
    <Status label={label} className="ap sp">
        <div className="sp-head" aria-hidden="true">
            <p className="ap-back"><span className="sk-btn"><T>{back}</T></span></p>
            <div>
                <p className="ap-eyebrow"><T>Your account</T></p>
                <h1><T>My profile</T></h1>
                <p className="sp-muted"><T>These details are used to fill in your loan applications.</T></p>
            </div>
        </div>
        <div className="sp-grid" aria-hidden="true">
            <div className="sp-col">
                <aside className="sp-card sp-id">
                    <span className="sp-avatar sk-btn">AB</span>
                    <h2><T>Your name</T></h2>
                    <span className="sp-role sk-btn">Loan Applicant</span>
                    <p className="sp-email"><T>name@example.com</T></p>
                    <p className="sp-blurb"><T>Fill this in once. We copy it into the Principal Borrower step of every new application.</T></p>
                    <Box h="3.4rem" />
                </aside>
                <section className="sp-card sp-account">
                    <h2><T>Account details</T></h2>
                    <dl>
                        {[['Email', 'name@example.com'], ['Account type', 'Loan Applicant'], ['Account created', 'Sep 29, 2026'], ['Last sign-in', 'Oct 24, 2026, 6:18 PM']]
                            .map(([k, v]) => <div key={k}><dt><T>{k}</T></dt><dd><T>{v}</T></dd></div>)}
                    </dl>
                </section>
            </div>
            <div className="sp-col">
                <div className="ct-card sp-card sp-form">
                    <div className="sp-formhead"><h2><T>Personal information</T></h2><span className="sp-count sk-btn">0 of 12 required fields filled</span></div>
                    <div className="sp-meter"><span /></div>
                    {['Name', 'Personal details', 'Contact'].map((g) => (
                        <fieldset key={g} className="ct-section">
                            <legend><T>{g}</T></legend>
                            <Fields labels={['First name', 'Middle name', 'Last name', 'Birth date']} />
                        </fieldset>
                    ))}
                </div>
            </div>
        </div>
    </Status>
);

// The applicant's step-by-step application form (progress sidebar + one step)
const FORM_STEPS = [['Loan details', 'Your loan'], ['Principal borrower', 'About you'], ['Address'], ['Employment'], ['Spouse'],
    ['Co-borrowers'], ['Mortgagor'], ['Financial obligations', 'Your finances and references'], ['References'], ['Collateral'],
    ['Documents', 'Finish'], ['Review']];

export const ApplicationFormSkeleton = () => (
    <Status label="Opening your application" className="ap ap-wizard ct-shell">
        <aside className="ct-aside" aria-hidden="true">
            <div className="ct-aside-inner">
                <div className="ct-prog-head">
                    <div className="ct-profile">
                        <span className="ct-avatar lg sk-btn">AB</span>
                        <div>
                            <h2><T>Your name</T></h2>
                            <p className="id ct-mono"><T>DRAFT APPLICATION</T></p>
                            <span className="ct-badge warm sk-btn">Draft</span>
                        </div>
                    </div>
                    <div className="ct-prog-meter">
                        <span className="ct-label"><T>Application progress</T></span>
                        <p className="ct-meter-label"><span><T>0 of 11 steps done</T></span><span><T>0%</T></span></p>
                        <div className="ct-meter"><span /></div>
                    </div>
                    <div className="ct-box">
                        <span className="ct-label"><T>Loan summary</T></span>
                        {[['Type', 'Housing loan'], ['Amount', '₱1,000,000.00'], ['Status', 'Draft']].map(([k, v]) => (
                            <div key={k} className="ct-kv"><span><T>{k}</T></span><span><T>{v}</T></span></div>
                        ))}
                    </div>
                </div>
                <ol className="ct-steps">
                    {FORM_STEPS.map(([title, group], i) => (
                        <li key={title} data-group={group}>
                            <button type="button" tabIndex={-1}><span className="n sk-btn">{i + 1}</span><span><T>{title}</T></span></button>
                        </li>
                    ))}
                </ol>
                <span className="ap-exit"><T>Save and exit</T></span>
            </div>
        </aside>
        <section className="ct-content" aria-hidden="true">
            <div className="inner">
                <div className="ct-pagehead"><div><p className="ap-eyebrow"><T>Step 1 of 12</T></p><h1><T>Loan details</T></h1><p><T>Your answers save when you continue.</T></p></div></div>
                <div className="ct-card ap-paper">
                    <div className="ct-sheet-body">
                        {['Loan', 'Purpose'].map((g) => (
                            <fieldset key={g} className="ct-section">
                                <legend><T>{g}</T></legend>
                                <Fields labels={['Loan type', 'Loan amount', 'Term', 'Preferred branch']} />
                            </fieldset>
                        ))}
                    </div>
                </div>
            </div>
        </section>
    </Status>
);

// The applicant home's application register while it loads (the rest of the page shows on its own)
export const RegisterSkeleton = () => (
    <Status label="Loading your applications">
        <ul className="ct-register" aria-hidden="true">
            {stack(3, (i) => (
                <li key={i}>
                    <span className="ap-app"><span className="ct-mono"><T>{APP_NO}</T></span><small><T>Submitted Oct 2, 2026</T></small></span>
                    <span><span className="ct-badge sk-btn">Submitted</span></span>
                    <span className="amt"><T>₱1,000,000.00</T></span>
                    <span className="ap-rowlink sk-btn">View</span>
                </li>
            ))}
        </ul>
    </Status>
);

/* ---------- smaller screens ---------- */

// Staff accounts list
export const ListSkeleton = ({ label = 'Loading', rows = 5 }) => (
    <Status label={label}>
        <div aria-hidden="true">
            {stack(rows, (i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.9rem', padding: '0.85rem 1.25rem', borderTop: i ? '1px solid rgba(12, 25, 41, 0.08)' : 0 }}>
                    <Box w="2.4rem" h="2.4rem" className="circle" />
                    <span style={{ flex: 1, display: 'grid', gap: '0.35rem' }}><T>Josh Denzel Account Officer</T><T>name@example.com</T></span>
                    <Box w="8rem" h="1.8rem" style={{ borderRadius: 999 }} />
                    <Box w="5rem" h="1.5rem" style={{ borderRadius: 999 }} />
                </div>
            ))}
        </div>
    </Status>
);

// Document check (Tailwind layout: header, party tabs, document list + viewer on the left, extracted fields on the right)
export const DocumentCheckSkeleton = () => (
    <Status label="Loading documents" className="lf lf-folder lf-doccheck">
        <Crumbs items={['Work tray', `Application ${APP_NO}`, 'Document check']} />
        <header className="lf-hero" aria-hidden="true">
            <div className="lf-hero-main">
                <p className="lf-eyebrow"><T>Document check (AI)</T><span className="lf-mode read sk-btn">Read-only</span></p>
                <h1><T>{`Application ${APP_NO}`}</T></h1>
                <ul className="lf-meta"><li><T>0 of 6 documents confirmed</T></li></ul>
            </div>
            <div className="lf-actions"><span className="lf-btn sk-btn">Loan folder</span></div>
        </header>
        <p className="lf-note" aria-hidden="true"><T>The AI only proposes values. Nothing in the application changes until the assigned Account Officer confirms.</T></p>
        <nav className="lf-tabs dc-people" aria-hidden="true"><span className="sk-btn" style={{ padding: '0.6rem 1rem', borderRadius: 10 }}>{BORROWERS} · Principal Borrower</span></nav>
        <div className="dc-work" aria-hidden="true">
            <section className="lf-card dc-pane">
                <div className="lf-cardhead"><h2><T>Documents for {BORROWERS}</T></h2></div>
                <ul className="dc-doclist">{stack(3, (i) => <li key={i}><Box h="3rem" style={{ borderRadius: 14 }} /></li>)}</ul>
                <div className="dc-viewer-wrap"><Box h="100%" style={{ minHeight: '16rem', borderRadius: 14 }} /></div>
            </section>
            <section className="lf-card dc-pane">
                <div className="lf-cardhead"><h2><T>Extracted information</T></h2></div>
                <div className="dc-fieldlist">{stack(5, (i) => <Box key={i} h="5.5rem" style={{ borderRadius: 14 }} />)}</div>
            </section>
        </div>
    </Status>
);

// The document preview on its own
export const ViewerSkeleton = () => (
    <Status label="Loading document"><Box h="100%" style={{ minHeight: '20rem' }} /></Status>
);

// A card with a title and a few lines (CI results)
export const PanelSkeleton = ({ label = 'Loading', lines = 4 }) => (
    <Status label={label}>
        <section className="lf-card" aria-hidden="true">
            <div className="lf-cardhead"><h2><T>Results</T></h2></div>
            <Bars n={lines} h="2.6rem" />
        </section>
    </Status>
);

// Route guards and redirects, before any page layout is showing
export const RouteSkeleton = ({ label = 'Loading' }) => (
    <Status label={label}>
        <div aria-hidden="true" style={{ width: '100%', maxWidth: '72rem', margin: '0 auto', padding: '2rem 1rem', display: 'grid', gap: '1.25rem' }}>
            <span style={{ display: 'grid', gap: '0.5rem' }}><Box w="16rem" h="1.8rem" /><Box w="min(24rem, 80%)" h="0.9rem" /></span>
            <Bars n={3} h="3rem" />
        </div>
    </Status>
);

// A bit of placeholder text inside a page that is otherwise showing (e.g. a count that hasn't loaded yet)
export const Ghost = ({ children }) => <T>{children}</T>;
