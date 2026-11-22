// "What the CI results mean for this file": shown under IV. Credit Checking wherever the CI results are (CO's FP,
// reviewer summary, approver / committee decision support), from the CI's saved rows (ciFacts.js):
//   1. Report validity: an NFIS / TU report over a year old (4 months for an NFIS with a court case) must be run again.
//   2. NFIS records against the RAAC's acceptable records: acceptable / acceptable only within the LCR cap /
//      a deviation (needs an exception) / not allowed (replevin, foreclosure).
//   3. TU accounts the borrowers didn't declare in the KYC, and the DBR with their installments.
// Flags for people only: nothing here changes the file, approves or rejects. The CO writes any exception in V.
// Look: .ci-meaning in ciRequest.css (lf tokens, so it follows dark mode on the .lf-folder pages).
import { AlertTriangle, CalendarClock, CheckCircle2, Info, OctagonX, Scale } from 'lucide-react';
import { one } from '../applicationForm/api';
import { NFIS_RECORD_TYPES } from './options';
import { ciSlots, dbrWithTu, lcrCapOf, raacNfis, undisclosedLoans, validityRows } from './ciFacts';

const pct = (v) => (v === null || v === undefined ? null : `${(v * 100).toFixed(2)}%`);
const peso = (v) => `₱${Number(v).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`;
const labelOf = (v) => NFIS_RECORD_TYPES.find((t) => t.value === v)?.label ?? v;
const day = (v) => (v ? new Date(`${v}T00:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : null);

const RAAC_CHIPS = {
    ACCEPTABLE: ['Acceptable record', 'ok', CheckCircle2],
    ACCEPTABLE_IF_LCR: ['Acceptable only within the LCR cap', 'warn', Scale],
    DEVIATION: ['Character deviation: needs an exception', 'warn', AlertTriangle],
    NOT_ALLOWED: ['Not allowed', 'err', OctagonX],
    CHECK: ['Needs more details', 'none', Info],
};

const Chip = ({ tone, Icon, children }) => (
    <span className={`lf-chip ci-chip ${tone}`}>{Icon && <Icon size={13} aria-hidden="true" />}{children}</span>
);

// app: fetchApplication record; ci: { checks, nfisRecords, tuAccounts }; computed: computeFp() when the page has it
// (LCR, DBR); without it the LCR is loan / TCP from the KYC and the DBR line is left out.
const CiFileChecks = ({ app, ci, computed = null }) => {
    const slots = ciSlots(app, ci);
    if (!slots.some((s) => s.nfis.result || s.tu.result)) return null;

    const endUser = Boolean(one(app.referral_details)?.developer_name);
    const tcp = Number(one(app.collateral_details)?.selling_price) || null;
    const loan = Number(app.loan_amount) || null;
    const tcpLcr = loan && tcp ? loan / tcp : null;
    const lcr = computed?.lcr ?? tcpLcr;
    const cap = lcrCapOf(endUser);

    const validity = validityRows(slots).filter((v) => v.status !== 'OK');
    const records = raacNfis(slots, { endUser, lcr, tcpLcr });
    const tu = undisclosedLoans(slots).filter((r) => r.extraLoans || r.extraCards || r.tuInstallments > r.declaredPayments + 0.005);
    const dbr = dbrWithTu(computed, undisclosedLoans(slots));
    const stops = records.filter((r) => r.status === 'NOT_ALLOWED');

    return (
        <section className="ci-meaning" aria-labelledby="ci-meaning-h">
            <h4 id="ci-meaning-h">What the CI results mean for this file</h4>
            <p className="ci-meaning-note">
                Read from the Credit Investigator's saved records and accounts. These are flags for the Credit Officer and the
                approvers: nothing here changes the file. Write any exception in V. Exceptions.
            </p>

            {stops.length > 0 && (
                <p className="ci-meaning-stop" role="note">
                    <OctagonX size={17} aria-hidden="true" />
                    <span>
                        <b>{stops.map((r) => `${r.who}: ${labelOf(r.record.record_type)}`).join('; ')}.</b>{' '}
                        The RAAC does not allow borrowers with a history of replevin or foreclosure, regardless of the date of the report.
                    </span>
                </p>
            )}

            <div className="ci-meaning-block">
                <h5><CalendarClock size={15} aria-hidden="true" />Report validity</h5>
                {validity.length === 0 ? (
                    <p className="ci-meaning-ok"><CheckCircle2 size={14} aria-hidden="true" />Every NFIS and TU report is still valid.</p>
                ) : (
                    <ul>
                        {validity.map((v) => (
                            <li key={`${v.who}-${v.check}`}>
                                <Chip tone={v.status === 'EXPIRED' ? 'err' : 'warn'}>
                                    {v.status === 'EXPIRED' ? 'Expired' : v.status === 'SOON' ? 'Expires soon' : 'No report date'}
                                </Chip>{' '}
                                {v.who}: {v.check}{v.expiresOn ? `, valid until ${day(v.expiresOn)}` : ''}
                                {v.months === 4 ? ' (4 months: it has a court case)' : ''}.
                                {v.status === 'EXPIRED' && ' It has to be run again before the recommendation.'}
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {records.length > 0 && (
                <div className="ci-meaning-block">
                    <h5><Scale size={15} aria-hidden="true" />NFIS records against the RAAC (acceptable records, June 2021)</h5>
                    <ul>
                        {records.map((r) => {
                            const [label, tone, Icon] = RAAC_CHIPS[r.status];
                            const over = r.status === 'ACCEPTABLE_IF_LCR' && r.lcrOk === false;
                            return (
                                <li key={r.record.id ?? `${r.who}-${r.record.date_reported}`}>
                                    <Chip tone={over ? 'warn' : tone} Icon={over ? AlertTriangle : Icon}>
                                        {over ? 'LCR above the cap: a deviation' : label}
                                    </Chip>{' '}
                                    <b>{r.who}: {labelOf(r.record.record_type)}.</b> {r.reason}
                                    {r.status === 'ACCEPTABLE_IF_LCR' && (
                                        <span className="ci-meaning-sub">
                                            Maximum LCR {pct(r.cap.cap)} of the {r.cap.against}{r.condition ? `, ${r.condition}` : ''}.{' '}
                                            {r.lcr === null ? 'No LCR yet.' : `This loan: ${pct(r.lcr)}${r.lcrOk ? ', within the cap.' : ', above it.'}`}
                                        </span>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                    <p className="ci-meaning-note">This loan is {endUser ? 'end-user financing (from a developer): LCR against TCP' : 'a regular loan: LCR against appraised value'}, cap {pct(cap.cap)}.</p>
                </div>
            )}

            {tu.length > 0 && (
                <div className="ci-meaning-block">
                    <h5><AlertTriangle size={15} aria-hidden="true" />TU accounts not declared in the KYC</h5>
                    <ul>
                        {tu.map((r) => (
                            <li key={r.who}>
                                <b>{r.who}:</b>{' '}
                                {r.extraLoans > 0 && `TU shows ${r.tuLoans} open loan${r.tuLoans === 1 ? '' : 's'}, ${r.declaredLoans} declared. `}
                                {r.extraCards > 0 && `TU shows ${r.tuCards} open card${r.tuCards === 1 ? '' : 's'}, ${r.declaredCards} declared. `}
                                {r.tuInstallments > r.declaredPayments + 0.005
                                    && `Monthly installments on TU ${peso(r.tuInstallments)} vs ${peso(r.declaredPayments)} declared.`}
                            </li>
                        ))}
                    </ul>
                    {dbr !== null && (
                        <p className="ci-meaning-sub">
                            With the TU installments, the DBR would be <b>{pct(dbr)}</b> (now {pct(computed.dbr)} on what was declared).
                            Ask the borrower, and update the existing loans if they owe them.
                        </p>
                    )}
                </div>
            )}
        </section>
    );
};

export default CiFileChecks;
