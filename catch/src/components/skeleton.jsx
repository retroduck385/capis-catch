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

// Header card of a staff page. metrics: [label, value, sub][]
const Header = ({ title, meta = [], actions = [], metrics = [], progress = false, note, hint }) => (
    <header className="lf-card" aria-hidden="true">
        <div className="lf-titlerow">
            <div>
                <h1><T>{title}</T></h1>
                <ul className="lf-meta">{meta.map((m) => <li key={m}><T>{m}</T></li>)}</ul>
            </div>
            <div className="lf-actions">{actions.map((a) => <span key={a} className="lf-btn sk-btn">{a}</span>)}</div>
        </div>
        {metrics.length > 0 && (
            <div className="fp-metrics">
                {metrics.map(([lbl, val, sub, more]) => (
                    <div key={lbl} className="fp-metric plain">
                        <span className="lbl"><T>{lbl}</T></span>
                        <span className="val"><T>{val}</T></span>
                        <span className="sub"><T>{sub}</T></span>
                        {more && <span className="more"><T>{more}</T></span>}
                    </div>
                ))}
            </div>
        )}
        {progress && (
            <div className="lf-progress">
                <div className="lf-progress-top"><span><T>KYC verification</T></span><span><T>0 of 11 sections verified</T></span></div>
                <div className="lf-meter"><span /></div>
            </div>
        )}
        {note && (
            <p className="lf-note">
                <span className="sk-btn" style={{ width: 16, height: 16, flex: 'none', borderRadius: 4 }} />
                <span><T>{note}</T></span>
            </p>
        )}
        {hint && <p className="fp-note cs-hint"><T>{hint}</T></p>}
    </header>
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
    <Status label="Loading loan folder" className="lf">
        <Crumbs items={['Work tray', `Application ${APP_NO}`]} />
        <Header title={`Application ${APP_NO}`} progress
            meta={['Submitted Sep 29, 2026, 2:05 PM', 'CI requested Oct 20, 2026, 4:48 PM by Josh Denzel Account Officer']}
            actions={['Messages', `Financial package${GAP}`]} />
        <div className="lf-body">
            <div className="lf-main">
                <Card title="KYC verification" aside="0 of 11 verified">
                    <ul className="lf-kyc">
                        {KYC_TITLES.map((t) => (
                            <li key={t} className="lf-kyc-item none">
                                <div className="lf-kyc-top"><b><T>{t}</T></b><span className="lf-chip none sk-btn">Not checked</span></div>
                                <p className="lf-kyc-meta"><T>Not checked yet.</T></p>
                            </li>
                        ))}
                    </ul>
                </Card>
                <Card title="Application summary">
                    <Info rows={[['Loan type', 'Housing loan'], ['Loan amount', '₱1,000,000.00'], ['Term', '2 years'],
                        ['Principal borrower', BORROWERS], ['Civil status', 'Single'], ['Present address', '123 Sample Street, Quezon City']]} />
                </Card>
                <Card title="Change history"><Bars n={3} h="3rem" /></Card>
            </div>
        </div>
    </Status>
);

export const FinancialPackageSkeleton = () => (
    <Status label="Loading financial package" className="lf fp">
        <Crumbs items={['Work tray', `Application ${APP_NO}`, 'Financial Package']} />
        <Header title={`Financial Package ${APP_NO}`}
            meta={['Financial Package and Credit Recommendation, Housing Loans', 'Handling Account Officer: Josh Denzel']}
            actions={['Messages', `Loan folder${GAP}`]}
            metrics={[['Credit risk rating', 'Not scored', '0 of 17 scored', 'Open scoring'], ['Debt burden ratio', '00.00%', 'DBR'],
                ['Loan-to-collateral', '00.00%', 'LCR'], ['Monthly amortization', '₱00,000.00', 'New loan'],
                ['Combined gross income', '₱000,000.00', 'Per month']]} />
        <div className="lf-body edit">
            <Nav groups={[
                { group: 'Page 1: Recommendation', items: ['General information', 'I. Borrower/s highlight', 'II. Facility', 'III. Collateral', 'IV. Credit checking', 'V. Exceptions', 'VI. Terms and conditions', 'VII. Approval'] },
                { group: 'Page 2: Application information', items: ['VIII. Employment', 'IX. Cash flow', 'X. Deposit checking', 'XI. Loan verification', 'XII. Trade checking', 'XIII. Title', 'XIV. Customer information'] },
                { group: 'Result', items: ['Credit result', 'Change history'] },
            ]} />
            <div className="lf-main fp-main">
                <Sec title="General information">
                    <Info rows={[['Application number', APP_NO], ['Date', 'Oct 24, 2026'], ['Borrower/s', BORROWERS],
                        ['Account Officer', 'Josh Denzel'], ['Credit Officer', 'Josh Credit Officer'], ['Branch', 'Main Branch']]} />
                </Sec>
                <Sec title="I. Borrower/s highlight">
                    <Info rows={[['Principal borrower', BORROWERS], ['Employer', 'Sample Company Inc.'], ['Position', 'Senior Analyst'],
                        ['Years in service', '5 years'], ['Monthly gross income', '₱000,000.00']]} />
                </Sec>
                <Sec title="II. Facility">
                    <Fields labels={['Loan amount', 'Term', 'Interest rate', 'Purpose', 'Repayment mode', 'Processing fee']} />
                </Sec>
            </div>
        </div>
    </Status>
);

export const CreditScoreSkeleton = () => (
    <Status label="Loading credit scoring" className="lf fp rv">
        <Crumbs items={['Work tray', `Application ${APP_NO}`, 'Financial Package', 'Credit score']} />
        <Header title={`Credit Scoring ${APP_NO}`} meta={[`Borrower/s: ${BORROWERS}`, 'Housing Loan Credit Scoring Sheet']}
            actions={['Work tray', `Loan folder${GAP}`]}
            metrics={[['Total score', '0 / 100', '0 of 17 criteria scored'], ['Credit risk rating', 'Not scored', 'When every criterion is scored'],
                ['Recommendation', '—', 'A guide, not the decision'], ['Loan amount', '₱1,000,000.00', 'Requested'],
                ['Suggestions to confirm', '13', 'Not counted until picked']]}
            hint="Suggestions use the saved Financial Package (income basis, interest rate, appraised value, loan and deposit checks). Save the FP first if you changed any of those." />
        <div className="lf-body edit">
            <Nav items={['1. Capacity', '2. Character', '3. Collateral', '4. Condition', 'Total score', 'Change history']} />
            <div className="lf-main fp-main">
                <div className="lf-card cs-intro" aria-hidden="true">
                    <p><T>CATCH suggests a band wherever the record has the data. Suggestions don't count until you pick or accept them, and you can change any score. Character items mostly wait for the Credit Investigator's results.</T></p>
                </div>
                <Sec title="1. Capacity (Maximum Score: 30)">
                    <div className="cs-sub">
                        <div className="cs-sub-top"><span><T>Sub-total</T></span><b><T>0 / 30</T></b></div>
                        <div className="lf-meter"><span /></div>
                    </div>
                    <Table className="cs-table" head={['Criterion', 'From the record', 'Suggestion', 'Score', 'Points']}
                        cells={['Debt to Income Ratio / Debt Burden Ratio', '00.00%', 'No suggestion', '@inputs', '—']} rows={4} />
                </Sec>
            </div>
        </div>
    </Status>
);

export const ApprovalRoutingSkeleton = () => (
    <Status label="Loading VII. Approval" className="lf fp rv">
        <Crumbs items={['Work tray', `Application ${APP_NO}`, 'Financial Package', 'Approval routing']} />
        <Header title={`VII. Approval ${APP_NO}`} meta={[`Borrower/s: ${BORROWERS}`, 'Stage: Intake · In Progress']}
            actions={['Messages', 'Work tray', `Loan folder${GAP}`]}
            metrics={[['Credit result', 'Not set', 'CO recommendation'], ['Credit risk rating', 'Not scored', '0 of 17 scored'],
                ['Loan amount', '₱1,000,000.00', '2 years'], ['Approval authority', 'Credit Committee', 'Based on loan amount']]} />
        <div className="lf-body edit">
            <Nav items={['Prepared by', 'Approval authority', 'Reviewers and approvers', 'Routing history']} />
            <div className="lf-main fp-main">
                <Sec title="Prepared by">
                    <Info rows={[['Account Officer', 'Josh Denzel Account Officer'], ['Credit Officer', 'Unassigned'], ['Credit result', 'Not set'],
                        ['Credit risk rating', 'Not scored'], ['Loan amount', '₱1,000,000.00']]} />
                </Sec>
                <Sec title="Approval authority">
                    <Table head={['Loan amount', 'Approval authority', 'Reviewers']} cells={['Up to ₱5,000,000.00', 'Credit Department Head', '1 reviewer']} rows={4} />
                </Sec>
                <Sec title="Reviewers and approvers"><Bars n={3} h="3.2rem" /></Sec>
            </div>
        </div>
    </Status>
);

export const ReviewSummarySkeleton = () => (
    <Status label="Loading review summary" className="lf fp rv">
        <Crumbs items={['Work tray', `Application ${APP_NO}`, 'Review summary']} />
        <Header title={`Review summary ${APP_NO}`}
            meta={[`Borrower/s: ${BORROWERS} (Principal Borrower)`, 'Stage: Review · Pending (for 15.9 days)', 'Sent for review by Josh Credit Officer on 10/24/2026, 6:18:46 PM']}
            actions={['Messages', 'Financial Package', 'Credit scoring', `Loan folder${GAP}`]}
            metrics={[['Credit result', 'Endorsed', 'CO recommendation'], ['Credit risk rating', 'Not scored', '0 of 17 scored'],
                ['Loan amount', '₱1,000,000.00', '2 years'], ['Debt burden ratio', '00.00%', 'DBR'],
                ['Loan-to-collateral', '50.00%', 'LCR'], ['Monthly amortization', '₱00,000.00', 'New loan']]}
            note="You are reviewer 1 of 1. It's your turn." />
        <div className="lf-body edit">
            <Nav items={['Review progress', 'Flags to check (4)', "Credit Officer's recommendation", 'Income evidence', 'Key figures',
                'IV. Credit checking', 'Credit score', 'V. Exceptions', 'Changes since', 'VII. Approval', 'Your review']} />
            <div className="lf-main fp-main">
                <Sec title="Review progress"><Bars n={1} h="3.4rem" /></Sec>
                <Sec title="Flags to check (4)"><Bars n={3} h="2.7rem" /></Sec>
                <Sec title="Credit Officer's recommendation">
                    <Info rows={[['Credit result', 'Endorsed'], ['Justification and remarks', 'Sample remarks from the credit officer'], ['Recommended by', 'Josh Credit Officer']]} />
                </Sec>
            </div>
        </div>
    </Status>
);

export const CiRequestSkeleton = () => (
    <Status label="Loading CI request" className="lf fp">
        <Crumbs items={['Work tray', `CI request ${APP_NO}`]} />
        <Header title={`CI request ${APP_NO}`} meta={['NFIS and TransUnion inquiry details', 'Requested by Josh Denzel Account Officer']}
            actions={['Messages']}
            metrics={[['Application', APP_NO, 'Housing loan'], ['Borrowers', '1', 'Principal borrower'],
                ['Requested', 'Oct 24, 2026', 'NFIS and TU'], ['Loan amount', '₱1,000,000.00', 'Housing loan']]} />
        <Card title="NFIS Request Form">
            <Info rows={[['Name of borrower', BORROWERS], ['Date of birth', 'Jan 01, 1990'], ['Place of birth', 'Quezon City'],
                ['Address', '123 Sample Street, Quezon City'], ['Employer', 'Sample Company Inc.'], ['Valid ID', 'Passport 0000000']]} />
        </Card>
        <Card title="TransUnion (TU) Request Template">
            <Info rows={[['Name of borrower', BORROWERS], ['Date of birth', 'Jan 01, 1990'], ['Address', '123 Sample Street, Quezon City'],
                ['Contact number', '0900 000 0000']]} />
        </Card>
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
                <h2 className="wt-wtitle"><T>Pipeline</T></h2>
                <div className="wt-cols">
                    {STAGE_NAMES.map((s) => (
                        <div key={s} className="wt-col"><span className="num"><T>0</T></span><span className="well"><span className="fill" /></span><span className="name"><T>{s}</T></span></div>
                    ))}
                </div>
            </article>
            <div className="wt-kpis">
                {['Unassigned', 'Assigned to me'].map((l) => (
                    <div key={l} className="wt-tile plain"><span className="ic sk-btn" /><span className="val"><T>00</T></span><span className="lbl"><T>{l}</T></span></div>
                ))}
            </div>
        </section>

        <section className="wt-card" aria-hidden="true">
            <div className="wt-toolbar">
                <div className="wt-search"><Box h="2.5rem" /></div>
                <Box w="7.5rem" h="2.5rem" /><Box w="11rem" h="2.5rem" /><Box w="11.5rem" h="2.5rem" />
                <span className="spacer" />
                <small><T>Updated 00:00 PM</T></small>
                <Box w="5.5rem" h="2.5rem" />
            </div>
            <p className="wt-count"><T>Showing 0 of 0 applications · first in, first out by submission</T></p>
            <div className="wt-scroll">
                <table>
                    <thead>
                        <tr>
                            <th><T>#</T></th><th><T>Application</T></th><th><T>Stage</T></th><th className="wt-amt"><T>Amount</T></th>
                            <th><T>TAT position</T></th><th><T>Assigned to</T></th>
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
                                    <div className="wt-stagecell"><span><T>Credit Evaluation</T></span><span className="wt-chip plain sk-btn">In progress</span></div>
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
    <Status label={label} className="sp">
        <div className="sp-head" aria-hidden="true">
            <span className="sp-back"><T>{back}</T></span>
            <h1><T>My profile</T></h1>
            <p className="sp-muted"><T>These details are used to fill in your loan applications.</T></p>
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
                <div className="sp-card sp-form">
                    <div className="sp-formhead"><h2><T>Personal information</T></h2><span className="sp-muted"><T>0 of 12 required fields filled</T></span></div>
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
    <Status label="Opening your application" className="ct-shell">
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
                        {[['Type', 'Housing loan'], ['Amount', 'PHP 1,000,000'], ['Status', 'Draft']].map(([k, v]) => (
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
            </div>
        </aside>
        <section className="ct-content" aria-hidden="true">
            <div className="inner">
                <div className="ct-pagehead"><div><h1><T>Loan details</T></h1><p><T>Step 1 of 12. Your answers save when you continue.</T></p></div></div>
                <div className="ct-card">
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
                    <span className="ct-mono"><T>{APP_NO}</T></span>
                    <span><span className="ct-badge sk-btn">Submitted</span></span>
                    <span className="amt"><T>PHP 1,000,000</T></span>
                    <span className="ct-link"><T>View</T></span>
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
    <Status label="Loading documents" className="min-h-screen lg:h-screen flex flex-col text-left">
        <div aria-hidden="true" className="contents">
            <header className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 border-b bg-white">
                <span className="border rounded px-3 py-1.5 text-sm sk-btn">← Back to loan folder</span>
                <h2 className="text-xl font-semibold"><T>Document check</T></h2>
                <span className="text-gray-600"><T>Application {APP_NO}</T></span>
            </header>
            <nav className="flex gap-1 px-4 border-b bg-white"><span className="px-3 py-2 text-sm"><T>{BORROWERS.toUpperCase()} · Principal Borrower</T></span></nav>
            <div className="flex-1 lg:min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-4 p-4 bg-gray-50">
                <section className="bg-white rounded-lg border p-3 flex flex-col h-[80vh] lg:h-auto lg:min-h-0">
                    <h3 className="font-semibold pb-2"><T>Documents for {BORROWERS}</T></h3>
                    <ul className="space-y-1 pb-3">{stack(3, (i) => <li key={i}><Box h="2.5rem" /></li>)}</ul>
                    <div className="flex-1 min-h-0"><Box h="100%" style={{ minHeight: '16rem' }} /></div>
                </section>
                <section className="bg-white rounded-lg border p-3 flex flex-col h-[80vh] lg:h-auto lg:min-h-0">
                    <h3 className="font-semibold pb-2"><T>Extracted information</T></h3>
                    <div className="space-y-3">{stack(6, (i) => <div key={i} className="space-y-1"><T>Field name</T><Box h="2.4rem" /></div>)}</div>
                </section>
            </div>
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
