// The final report's sheets, laid out after the bank's KYC-FP workbook (FP, Credit_Score and Signatures tabs):
//   1  Financial Package, I. Borrower/s Highlight to VII. Approval      (FP tab, first page)
//   2  Financial Package, VIII to XIV and the credit result             (FP tab, second page; empty sections skipped)
//   3  Credit scoring sheet with sub-totals and the total               (Credit_Score tab)
//   4  Decision support: readiness, figures, exceptions, policy check   (Decision Support page)
//   5  Sign-offs with names, roles, dates and a signature line          (Signatures tab)
// Layout only comes from the workbook. Every value comes from our own records; nothing is copied from the sheet.
// Each sheet starts on a new A4 page when printed (finalReport.css). Read only.
import { getAddress, getParties, one } from '../applicationForm/api';
import { joinAddress, presentAddressOf, tenure, wholeYears } from '../applicationForm/derived';
import {
    BORROWER_ROLES, CIVIL_STATUSES, HOME_OWNERSHIP, REFERRAL_CHANNELS, formatPeso, labelFor, partyLabel,
} from '../applicationForm/options';
import { CI_CHECKS, CI_RESULTS } from '../ciRequest/options';
import { percent } from '../financialPackage/compute';
import { CATEGORIES } from '../financialPackage/creditScore';
import {
    CREDIT_RESULTS, DEPOSIT_CHECK_FIELDS, LOAN_CHECK_FIELDS, TITLE_FIELDS, TITLE_KINDS, TRADE_CHECK_FIELDS,
} from '../financialPackage/options';
import { OVERALL, STATUS, showFact, showRequirement } from '../mrac/labels';
import { positionLabel, tierLabel } from '../review/approval';
import { formatDay, personName } from '../../components/people';
import { Terms } from '../../components/term';
import { scoreSheet, whenPH } from './signoffs';

const blank = (v) => v === null || v === undefined || String(v).trim() === '';
const show = (v) => (blank(v) ? '—' : v);
const peso = (v) => (blank(v) ? null : formatPeso(v));
const day = (v) => (blank(v) ? null : formatDay(v));
const fullName = (p) => [p.first_name, p.middle_name, p.last_name, p.name_extension].filter(Boolean).join(' ') || null;
const yesNo = (v) => (v === true || v === 'true' ? 'Yes' : v === false || v === 'false' ? 'No' : null);
const nameOf = (names, id, fallback) => (id && personName(names[id])) || names[id] || fallback;

// ---------- building blocks ----------
export const Sheet = ({ no, title, mode, app, generated, children }) => (
    <section className={`fr-sheet${mode === 'DRAFT' ? ' draft' : ''}`} aria-label={`${no}. ${title}`}>
        <header className="fr-head">
            <div>
                <p className="fr-kicker">Financial Package and Credit Recommendation · Housing Loans</p>
                <h2>{no} · <Terms text={title} /></h2>
            </div>
            <div className="fr-head-meta">
                <b>{app.application_no}</b>
                <span>{mode === 'DRAFT' ? 'Draft — not for approval' : 'Final report'}</span>
            </div>
        </header>
        {children}
        <footer className="fr-foot">Generated in CATCH on {generated.at} by {generated.by}</footer>
    </section>
);

const H = ({ children }) => <h3 className="fr-h"><Terms text={children} /></h3>;

// Label / value rows; skipEmpty drops rows without a value (page 2)
const KV = ({ rows, skipEmpty = false, cols = 1 }) => {
    const kept = skipEmpty ? rows.filter(([, v]) => !blank(v)) : rows;
    if (kept.length === 0) return null;
    return (
        <dl className={`fr-kv${cols === 2 ? ' two' : ''}`}>
            {kept.map(([label, value]) => (
                <div key={label}><dt><Terms text={label} /></dt><dd>{show(value)}</dd></div>
            ))}
        </dl>
    );
};

const Text = ({ value, empty = 'None.' }) => <p className="fr-text">{blank(value) ? empty : value}</p>;

// A table from a row-list config (DEPOSIT_CHECK_FIELDS, ...); null when there are no rows
const RowTable = ({ config, rows }) => {
    if (rows.length === 0) return null;
    const fmt = (c, v) => (c.type === 'money' ? peso(v) : c.type === 'date' ? day(v) : v);
    return (
        <table className="fr-table fr-wide">
            <thead><tr>{Object.values(config).map((c) => <th key={c.label}>{c.label.replace(' (PHP)', '')}</th>)}</tr></thead>
            <tbody>
                {rows.map((r) => (
                    <tr key={r.id}>{Object.entries(config).map(([f, c]) => <td key={f} className={c.type === 'money' ? 'num' : undefined}>{show(fmt(c, r[f]))}</td>)}</tr>
                ))}
            </tbody>
        </table>
    );
};

const hasAny = (row, config) => Object.keys(config).some((f) => !blank(row[f]));

// ---------- 1. Financial Package (I to VII) ----------
export const FpPageOne = ({ r }) => {
    const { app, pkg, computed, score, names, aoId, ci, exceptions, approvers, positions } = r;
    const referral = one(app.referral_details);
    const c = one(app.collateral_details) ?? {};
    const borrowers = getParties(app, BORROWER_ROLES);
    const ciOf = (partyId, type) => ci.checks.find((x) => x.applicant_id === partyId && x.check_type === type) ?? null;
    const resultText = (x) => (x?.result ? labelFor(CI_RESULTS, x.result) : 'No result');
    return (
        <>
            <div className="fr-cols">
                <KV rows={[
                    ['Date Prepared', day(pkg.date_prepared)],
                    ['DOSRI / RPT', yesNo(pkg.dosri_rpt)],
                    ['Credit Risk Rating', score.complete ? `${score.riskRating} (${score.total} / 100)` : 'Not fully scored'],
                ]} />
                <KV rows={[
                    ['Channel', referral?.channel ? labelFor(REFERRAL_CHANNELS, referral.channel) : null],
                    ['Branch / Developer Name', referral?.developer_name || referral?.branch],
                    ['Handling Account Officer', nameOf(names, aoId, null)],
                ]} />
            </div>

            <H>I. Borrower/s Highlight</H>
            <table className="fr-table fr-wide">
                <thead><tr><th>Applicant Type</th><th>Name</th><th>Employer / Business Name</th><th>Position / Rank</th><th>Employment Tenure</th><th>Monthly Income (Gross)</th></tr></thead>
                <tbody>
                    {computed.incomes.map(({ party, gross }) => {
                        const job = one(party.employment_info);
                        const employed = job && job.employment_type !== 'UNEMPLOYED';
                        return (
                            <tr key={party.id}>
                                <td>{party.role === 'PRINCIPAL' ? 'Principal Borrower / Mortgagor' : partyLabel(party)}</td>
                                <td>{show(fullName(party))}</td>
                                <td>{show(employed ? job.employer_business_name : 'Not employed')}</td>
                                <td>{show(employed ? job.occupation : null)}</td>
                                <td>{show(employed ? tenure(job.employment_date, app.submitted_at) : null)}</td>
                                <td className="num">{show(peso(gross))}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
            <KV cols={2} rows={[['Combined Gross Income', peso(computed.totalGross)], ['Debt Burden Ratio (DBR)', percent(computed.dbr)]]} />

            <H>II. Facility Financial Package</H>
            <KV cols={2} rows={[
                ['Variant', pkg.variant],
                ['Loan Purpose', one(app.loan_purposes)?.label ?? app.loan_purpose_other],
                ['Proposed Loan Amount', peso(app.loan_amount)],
                ['Term (in Years)', app.loan_term_years],
                ['TCP / TAV', peso(computed.collateralValue)],
                ['Loan-to-Collateral Ratio (LCR)', percent(computed.lcr)],
                ['Monthly Amortization', peso(computed.amortization)],
                ['Manner of Repayment', pkg.manner_of_repayment],
                ['Interest Rate', blank(app.interest_rate) ? null : `${app.interest_rate}% per annum`],
                ['Fixing Period', app.fixing_period],
                ['HGC Eligibility', pkg.hgc_eligibility],
                ['Date of Enrollment', day(pkg.date_of_enrollment)],
            ]} />

            <H>III. Collateral Information</H>
            <KV cols={2} rows={[
                ['TCT / CCT No.', c.tct_cct_no],
                ['Collateral Type', c.property_type],
                ['Location of the Property', app.property_address],
                ['Registered Owner', c.registered_owner],
                ['Lot Area (sqm)', c.lot_area],
                ['Floor Area (sqm)', c.floor_area],
                ['TCP (Selling Price)', peso(c.selling_price)],
                ['Appraised Value', peso(pkg.appraised_value)],
                ['Date of Appraisal', day(pkg.date_of_appraisal)],
            ]} />
            {!blank(pkg.other_information) && <><p className="fr-label">Other Information</p><Text value={pkg.other_information} /></>}
            {!blank(pkg.statement_of_account) && <><p className="fr-label">Statement of Account</p><Text value={pkg.statement_of_account} /></>}

            <H>IV. Credit Checking</H>
            <table className="fr-table">
                <thead><tr><th>Name</th>{CI_CHECKS.map((k) => <th key={k.value}>{k.label}</th>)}</tr></thead>
                <tbody>
                    {borrowers.map((p) => (
                        <tr key={p.id}>
                            <td>{show(fullName(p))}<div className="fr-sub">{partyLabel(p)}</div></td>
                            {CI_CHECKS.map((k) => {
                                const x = ciOf(p.id, k.value);
                                return <td key={k.value}><b>{resultText(x)}</b>{x?.summary && <div className="fr-sub">{x.summary}</div>}</td>;
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>

            <H>V. Exception/s</H>
            {exceptions.length === 0 ? <Text value={null} empty="None recorded." /> : (
                <table className="fr-table">
                    <thead><tr><th>Policy</th><th>Exception/s / Recommendation</th><th>Risk Mitigant / Justifications</th></tr></thead>
                    <tbody>{exceptions.map((x) => <tr key={x.id}><td>{show(x.policy)}</td><td>{show(x.exception_recommendation)}</td><td>{show(x.mitigant)}</td></tr>)}</tbody>
                </table>
            )}

            <H>VI. Terms and Conditions</H>
            <Text value={pkg.terms_and_conditions} empty="Not set." />

            <H>VII. Approval</H>
            <KV rows={[['Approval authority', tierLabel(pkg.approval_tier)]]} />
            {approvers.length > 0 && (
                <table className="fr-table">
                    <thead><tr><th>Position</th><th>Approver</th></tr></thead>
                    <tbody>
                        {approvers.map((a) => (
                            <tr key={a.id}><td>{show(positionLabel(positions[a.user_id]))}</td><td>{nameOf(names, a.user_id, 'Approver')}</td></tr>
                        ))}
                    </tbody>
                </table>
            )}
        </>
    );
};

// ---------- 2. Financial Package (VIII to XIV + credit result); a section without data is left out ----------
const yearsOfStay = (address, asOf) => {
    if (!address) return null;
    const years = wholeYears(address.date_move_in, asOf);
    const ownership = address.home_ownership ? labelFor(HOME_OWNERSHIP, address.home_ownership) : null;
    return [years === null ? null : `${years} ${years === 1 ? 'year' : 'years'}`, ownership].filter(Boolean).join(' / ') || null;
};

export const FpPageTwo = ({ r }) => {
    const { app, pkg, fp, computed } = r;
    const details = Object.fromEntries(fp.parties.map((d) => [d.applicant_id, d]));
    const borrowers = getParties(app, BORROWER_ROLES);
    const everyone = getParties(app, [...BORROWER_ROLES, 'ATTORNEY_IN_FACT']);
    const principal = everyone.find((p) => p.role === 'PRINCIPAL');

    const employment = borrowers.map((p) => {
        const job = one(p.employment_info);
        const employed = job && job.employment_type !== 'UNEMPLOYED';
        return {
            p, rows: [
                ['Company Name / Address', employed ? [job.employer_business_name, joinAddress(getAddress(p, 'EMPLOYER'))].filter(Boolean).join(' / ') : null],
                ['Position / Rank / Status', employed ? job.occupation : null],
                ['Date Hired / Registration', employed ? day(job.employment_date) : null],
                ['Contact Numbers', employed ? job.contact_number : null],
                ['Remarks', details[p.id]?.employment_remarks],
            ],
        };
    }).filter((b) => b.rows.some(([, v]) => !blank(v)));

    const deposits = fp.depositChecks.filter((x) => hasAny(x, DEPOSIT_CHECK_FIELDS));
    const loans = fp.loanChecks.filter((x) => hasAny(x, LOAN_CHECK_FIELDS));
    const trades = fp.tradeChecks.filter((x) => hasAny(x, TRADE_CHECK_FIELDS));
    const titles = TITLE_KINDS.map((k) => ({ k, row: fp.titles.find((t) => t.title_kind === k.value) }))
        .filter(({ row }) => row && hasAny(row, TITLE_FIELDS));
    const result = [
        ['Credit Result', CREDIT_RESULTS.find((x) => x.value === pkg.credit_result)?.label],
        ['Justification and Remarks', pkg.justification], ['Amendment', pkg.amendment],
        ['Waiver and Acceptance', pkg.waiver_and_acceptance], ['Deferral(s)', pkg.deferrals],
    ].filter(([, v]) => !blank(v));

    return (
        <>
            {employment.length > 0 && (
                <>
                    <H>VIII. Employment / Business Verification</H>
                    {employment.map(({ p, rows }) => (
                        <div key={p.id} className="fr-block">
                            <p className="fr-label">{partyLabel(p)}: {show(fullName(p))}</p>
                            <KV rows={rows} skipEmpty />
                        </div>
                    ))}
                </>
            )}

            {computed.incomes.length > 0 && (
                <>
                    <H>IX. Financial Capacity / Cash Flow</H>
                    <table className="fr-table">
                        <thead><tr><th>Borrower</th><th>Basic Income (A)</th><th>Other Income (B)</th><th>Gross Income (A + B)</th><th>Remarks</th></tr></thead>
                        <tbody>
                            {computed.incomes.map(({ party, basis, basic, other, gross }) => (
                                <tr key={party.id}>
                                    <td>{show(fullName(party))}<div className="fr-sub">{partyLabel(party)}{basis ? ` · ${basis.label}` : ''}</div></td>
                                    <td className="num">{show(peso(basic))}</td>
                                    <td className="num">{show(peso(other))}</td>
                                    <td className="num">{show(peso(gross))}</td>
                                    <td>{show(details[party.id]?.cash_flow_remarks)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <KV cols={2} rows={[
                        ['Existing Monthly Amortization (C)', peso(computed.existing)],
                        ['Total Gross Income (D)', peso(computed.totalGross)],
                        ['New Monthly Amortization', peso(computed.amortization)],
                        ['DBR = (new amortization + C) ÷ D', percent(computed.dbr)],
                    ]} />
                </>
            )}

            {deposits.length > 0 && <><H>X. Deposit Checking</H><RowTable config={DEPOSIT_CHECK_FIELDS} rows={deposits} /></>}
            {loans.length > 0 && <><H>XI. Loan Verification (Based on Loandex and Disclosure)</H><RowTable config={LOAN_CHECK_FIELDS} rows={loans} /></>}
            {trades.length > 0 && <><H>XII. Trade Checking</H><RowTable config={TRADE_CHECK_FIELDS} rows={trades} /></>}

            {titles.length > 0 && (
                <>
                    <H>XIII. Title Verification and Traceback</H>
                    <div className="fr-cols">
                        {titles.map(({ k, row }) => (
                            <div key={k.value}>
                                <p className="fr-label">{k.label}</p>
                                <KV skipEmpty rows={Object.entries(TITLE_FIELDS).map(([f, c]) => [c.label, c.type === 'date' ? day(row[f]) : row[f]])} />
                            </div>
                        ))}
                    </div>
                </>
            )}

            <H>XIV. Customer Information</H>
            {everyone.map((p) => {
                const present = presentAddressOf(p, principal);
                const permanent = getAddress(p, 'PERMANENT');
                const age = wholeYears(p.date_of_birth, app.submitted_at);
                const deps = p.dependents ?? [];
                const isBorrower = BORROWER_ROLES.includes(p.role);
                return (
                    <div key={p.id} className="fr-block">
                        <p className="fr-label">
                            {p.role === 'PRINCIPAL' ? 'Principal Borrower / Mortgagor' : p.role === 'ATTORNEY_IN_FACT' ? 'Attorney-in-Fact' : partyLabel(p)}
                            {p.relationship_to_principal && p.role !== 'PRINCIPAL' ? ` — ${p.relationship_to_principal}` : ''}
                        </p>
                        <KV skipEmpty cols={2} rows={[
                            ["Borrower's Name", fullName(p)],
                            ['Birth Date / Age', p.date_of_birth ? `${day(p.date_of_birth)} (${age ?? '?'} y.o.)` : null],
                            ['Civil Status', p.civil_status ? labelFor(CIVIL_STATUSES, p.civil_status) : null],
                            ['Citizenship', p.citizenship],
                            ['Present Address', joinAddress(present)],
                            ['Permanent Address', joinAddress(permanent?.same_as_principal ? getAddress(principal, 'PERMANENT') : permanent)],
                            ['Years of Stay / Ownership', yearsOfStay(present, app.submitted_at)],
                            ['Contact Number/s', p.mobile_number],
                            ['Email Address', p.email_address],
                            ...(isBorrower ? [['No. of Children / Dependents and Age/s',
                                `${deps.length} dependents${deps.length ? `: ${deps.map((d) => d.age).join(', ')}` : ''}`]] : []),
                        ]} />
                        {isBorrower && !blank(details[p.id]?.other_information) && (
                            <><p className="fr-label small">Other Information</p><Text value={details[p.id].other_information} /></>
                        )}
                    </div>
                );
            })}

            {result.length > 0 && (
                <>
                    <H>Credit Result</H>
                    <dl className="fr-kv">
                        {result.map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="fr-pre">{value}</dd></div>)}
                    </dl>
                </>
            )}
        </>
    );
};

// ---------- 3. Credit scoring sheet ----------
export const ScorePage = ({ r }) => {
    const { app, rules, fp, score, names, coId, scoreSaved, reviews, rows } = r;
    const sheet = scoreSheet(rules, fp.creditScore, CATEGORIES);
    const borrowers = getParties(app, BORROWER_ROLES).map(fullName).filter(Boolean).join(', ');
    const preparedBy = scoreSaved?.changed_by ?? coId;
    const reviewedBy = reviews.filter((d) => d.action !== 'RETURNED').map((d) => ({
        d, a: rows.find((x) => x.id === d.assignment_id),
    })).filter(({ a }) => a);
    return (
        <>
            <KV cols={2} rows={[['Name of Borrower/s', borrowers], ['Loan Amount', peso(app.loan_amount)]]} />
            {sheet.map((g) => (
                <div key={g.category} className="fr-block">
                    <H>{`${g.label} (maximum score: ${g.max})`}</H>
                    <table className="fr-table fr-score">
                        <colgroup><col className="c-crit" /><col className="c-band" /><col className="c-pts" /><col className="c-act" /><col className="c-rem" /></colgroup>
                        <thead><tr><th>Criterion</th><th>Band</th><th className="num">Score</th><th className="num">Actual</th><th>Remarks</th></tr></thead>
                        {g.criteria.map(({ criterion, bands, picked, points, remarks }) => (
                            <tbody key={criterion.code} className="fr-crit">
                                {bands.map((b, i) => (
                                    <tr key={b.code} className={picked?.code === b.code ? 'picked' : undefined}>
                                        {i === 0 && <td rowSpan={bands.length}><b><Terms text={criterion.label} /></b></td>}
                                        <td>{picked?.code === b.code ? '✓ ' : ''}{b.label}</td>
                                        <td className="num">{Number(b.points).toFixed(1)}</td>
                                        {i === 0 && <td rowSpan={bands.length} className="num"><b>{points === null ? 'Not scored' : points.toFixed(1)}</b></td>}
                                        {i === 0 && <td rowSpan={bands.length}>{show(remarks)}</td>}
                                    </tr>
                                ))}
                            </tbody>
                        ))}
                        <tfoot><tr><td colSpan={3}>Sub-total</td><td className="num"><b>{g.subtotal.toFixed(1)}</b></td><td /></tr></tfoot>
                    </table>
                </div>
            ))}
            <div className="fr-total">
                <KV cols={2} rows={[
                    ['Total Score', `${score.total.toFixed(1)} / 100${score.complete ? '' : ` (${score.scored} of ${score.count} criteria scored)`}`],
                    ['Risk Rating', score.riskRating ?? 'Not fully scored'],
                    ['Description', score.description],
                    ['Recommendation', score.recommendation],
                ]} />
                <p className="fr-sub">The score is a guide only; the Credit Officer sets the credit result.</p>
            </div>
            <KV rows={[
                ['Prepared by', `${nameOf(names, preparedBy, 'Credit Officer')} (Credit Officer)${scoreSaved ? `, ${whenPH(scoreSaved.changed_at)}` : ''}`],
                ['Reviewed by', reviewedBy.length === 0 ? 'Not reviewed yet'
                    : reviewedBy.map(({ d, a }) => `${nameOf(names, a.user_id, 'Reviewer')} (Reviewer ${a.seq}), ${whenPH(d.decided_at)}`).join('; ')],
            ]} />
        </>
    );
};

// ---------- 4. Decision support ----------
const READY_WORDS = { done: 'Done', missing: 'Missing', check: 'Check' };
const AI_RESULTS = { ENDORSED: 'Endorsed', NOT_ENDORSED: 'Not endorsed', DEFERRED: 'Deferred' };

export const DecisionPage = ({ r }) => {
    const { readiness, computed, score, pkg, resultLabel, exceptions, mrac, mracChanges, app, aiSuggestion: ai, names } = r;
    const done = mrac?.status === 'DONE';
    const criteria = done ? mrac.result?.criteria ?? [] : [];
    const flagged = criteria.filter((c) => c.status !== 'pass');
    const cited = criteria.filter((c) => c.source);
    const points = done ? (mrac.result?.reasoning?.points ?? []).filter((p) => p.citation) : [];
    return (
        <>
            <H>{`Readiness for decision (${readiness.readyCount} of ${readiness.total})`}</H>
            <table className="fr-table">
                <tbody>
                    {readiness.items.map((i) => (
                        <tr key={i.key}><td className="fr-state">{READY_WORDS[i.state] ?? i.state}</td><td><b>{i.label}</b><div className="fr-sub">{i.detail}</div></td></tr>
                    ))}
                </tbody>
            </table>

            <H>Key figures</H>
            <KV cols={2} rows={[
                ['Proposed Loan Amount', peso(app.loan_amount)],
                ['Combined Gross Income', peso(computed.totalGross)],
                ['New Monthly Amortization', peso(computed.amortization)],
                ['Debt Burden Ratio (DBR)', percent(computed.dbr)],
                ['Collateral Value', peso(computed.collateralValue)],
                ['Loan-to-Collateral Ratio (LCR)', percent(computed.lcr)],
                ['Credit Score', `${score.total.toFixed(1)} / 100${score.riskRating ? ` · ${score.riskRating}` : ''}`],
            ]} />

            <H>Credit Officer&apos;s recommendation</H>
            <KV rows={[['Credit Result', resultLabel ?? 'Not set'], ['Justification and Remarks', pkg.justification]]} />

            <H>AI suggestion given to the CO</H>
            {!ai ? <Text value={null} empty="The Credit Officer did not ask for an AI suggestion." /> : (
                <>
                    <KV rows={[
                        ['Suggested result', AI_RESULTS[ai.output?.suggested_result] ?? ai.output?.suggested_result],
                        ['Asked by', `${nameOf(names, ai.requested_by, ai.requestedByName || 'Credit Officer')} (Credit Officer), ${whenPH(ai.requested_at)}`],
                        ['Model', ai.model],
                    ]} />
                    {ai.output?.reasons?.length > 0 && (
                        <ul className="fr-list">
                            {ai.output.reasons.map((x, i) => <li key={`${x.chunk_key}-${i}`}>{x.text} <span className="fr-sub">[{x.heading || x.chunk_key}]</span></li>)}
                        </ul>
                    )}
                    {ai.output?.missing_data?.length > 0 && <KV rows={[['Missing or to verify', ai.output.missing_data.join('; ')]]} />}
                    <p className="fr-sub">A suggestion only: the AI never sets the credit result. Synthetic test files only until Q-04 is cleared.</p>
                </>
            )}

            <H>{`Exceptions (${exceptions.length + flagged.length})`}</H>
            {exceptions.length + flagged.length === 0 ? <Text value={null} empty="No recorded exceptions and no criteria that fail or need review." /> : (
                <table className="fr-table">
                    <thead><tr><th>Source</th><th>Item</th><th>Details</th></tr></thead>
                    <tbody>
                        {exceptions.map((x) => (
                            <tr key={`x-${x.id}`}><td>Recorded (V.)</td><td>{show(x.policy)}</td><td>{[x.exception_recommendation, x.mitigant && `Mitigant: ${x.mitigant}`].filter(Boolean).join(' · ') || '—'}</td></tr>
                        ))}
                        {flagged.map((c) => (
                            <tr key={`c-${c.code}`}><td>Policy check: {STATUS[c.status]?.[0] ?? c.status}</td><td>{c.label}</td><td>Value {showFact(c.field, c.value)}, required {showRequirement(c.field, c.threshold)}{c.reason ? `. ${c.reason}` : ''}</td></tr>
                        ))}
                    </tbody>
                </table>
            )}

            <H>Policy check (MRAC / policy RAG)</H>
            {!mrac && <Text value={null} empty="No policy check was run for this application." />}
            {mrac && !done && <Text value={null} empty={mrac.status === 'FAILED' ? 'The last policy check failed.' : 'The last policy check had not finished.'} />}
            {done && (
                <>
                    <KV rows={[
                        ['Result', OVERALL[mrac.result?.overall]?.[0] ?? mrac.result?.overall],
                        ['Checked', whenPH(mrac.finished_at)],
                        ['Summary', mrac.result?.reasoning?.headline],
                    ]} />
                    {mracChanges.length > 0 && <p className="fr-warn">The figures changed after this check ({mracChanges.join(', ')}); the result may be out of date.</p>}
                    {criteria.length > 0 && (
                        <table className="fr-table">
                            <thead><tr><th>Criterion</th><th>Value</th><th>Required</th><th>Result</th></tr></thead>
                            <tbody>
                                {criteria.map((c) => (
                                    <tr key={c.code}>
                                        <td>{c.label}{c.source_ref && <div className="fr-sub">{c.source_ref}</div>}</td>
                                        <td className="num">{showFact(c.field, c.value)}</td>
                                        <td className="num">{showRequirement(c.field, c.threshold)}</td>
                                        <td><b>{STATUS[c.status]?.[0] ?? c.status}</b>{c.reason && <div className="fr-sub">{c.reason}</div>}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                    {points.length > 0 && (
                        <>
                            <p className="fr-label">Reasoning</p>
                            <ul className="fr-list">{points.map((p) => <li key={p.code}>{p.text} <span className="fr-sub">[{p.citation}]</span></li>)}</ul>
                        </>
                    )}
                    {cited.length > 0 && (
                        <>
                            <p className="fr-label">Policy passages cited</p>
                            {cited.map((c) => (
                                <blockquote key={c.code} className="fr-cite">
                                    <p className="fr-cite-head">
                                        <b>{c.label}:</b> {c.source.heading_path || c.source.chunk_key}
                                        <span className="fr-sub"> · {[c.source.document, c.source.manual_pages?.length ? `p. ${c.source.manual_pages.join(', ')}` : null,
                                            c.source.revision_date && `rev. ${c.source.revision_date}`].filter(Boolean).join(' · ')}</span>
                                    </p>
                                    <p className="fr-pre">{c.source.excerpt}</p>
                                </blockquote>
                            ))}
                        </>
                    )}
                    <p className="fr-sub">Policy-check results are suggestions with the policy passage each one came from. People decide.</p>
                </>
            )}
        </>
    );
};

// ---------- 5. Sign-offs ----------
export const SignoffPage = ({ r, signoffs }) => {
    const { names } = r;
    return (
        <>
            <p className="fr-sub">Each step as recorded in CATCH: who did it, what they did and when (Philippine time).</p>
            {signoffs.length === 0 && <Text value={null} empty="No steps recorded yet." />}
            <ol className="fr-signoffs">
                {signoffs.map((s) => (
                    <li key={s.key} className={s.outcome ? 'outcome' : undefined}>
                        <div className="fr-sign-top">
                            <span className="fr-step">{s.step}</span>
                            <span className="fr-when">{whenPH(s.at)}</span>
                        </div>
                        {s.outcome ? <p className="fr-outcome">Outcome: <b>{s.action}</b></p> : (
                            <>
                                <p><b>{nameOf(names, s.userId, 'Not recorded')}</b> · {s.role}</p>
                                <p>{s.action}</p>
                                {s.details.map((d) => <p key={d} className="fr-sub fr-pre">{d}</p>)}
                                <div className="fr-signline"><span>Signature</span><span>Date</span></div>
                            </>
                        )}
                    </li>
                ))}
            </ol>
        </>
    );
};
