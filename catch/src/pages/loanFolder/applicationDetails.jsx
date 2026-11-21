// "Application details" card in the loan folder's overview: the shared application summary (applicationSummary.jsx),
// one tab at a time (Loan / Borrowers / Obligations / References / Collateral & referral) so the whole record isn't
// on screen at once. Fields show as label-over-value tiles, and empty fields are hidden unless "Show empty fields"
// is on. Tabs follow the ARIA pattern: arrow keys / Home / End move between them, Tab goes into the panel.
// Switching tabs keeps the page where it was (the panel is swapped, and the page must not jump to the top).
// Styles: "Application details" in loanFolder.css.
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { getParties, getParty } from '../applicationForm/api';
import ApplicationSummary from '../applicationForm/applicationSummary';
import { SummaryContext } from '../applicationForm/summaryContext';

const ApplicationDetails = ({ app, onViewDocument }) => {
    const id = useId();
    const [tab, setTab] = useState('loan');
    const [showEmpty, setShowEmpty] = useState(false);
    const tabRefs = useRef({});
    const keepY = useRef(null);   // the window's scroll position when a tab was picked

    // Picks a tab without moving the page: remember the scroll position, swap the panel, then put it back
    const pick = (key, focus = false) => {
        keepY.current = window.scrollY;
        setTab(key);
        if (focus) tabRefs.current[key]?.focus({ preventScroll: true });
    };
    useLayoutEffect(() => {
        const y = keepY.current;
        if (y === null) return undefined;
        keepY.current = null;
        const restore = () => { if (Math.abs(window.scrollY - y) > 1) window.scrollTo(0, y); };
        restore();
        // and once more after the browser has laid out and painted the new panel
        let second = 0;
        const first = requestAnimationFrame(() => { restore(); second = requestAnimationFrame(restore); });
        return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
    }, [tab]);

    const principal = getParty(app, 'PRINCIPAL');
    const count = (rows) => (rows ?? []).length;
    const tabs = [
        { key: 'loan', label: 'Loan' },
        { key: 'parties', label: 'Borrowers', n: getParties(app).length },
        { key: 'obligations', label: 'Obligations', n: count(principal?.bank_accounts) + count(principal?.existing_loans) + count(principal?.credit_cards) },
        { key: 'references', label: 'References', n: count(app.character_references) },
        { key: 'collateral', label: 'Collateral & referral' },
    ];

    const onKey = (e) => {
        const at = tabs.findIndex((t) => t.key === tab);
        const next = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: tabs.length - 1 }[e.key];
        if (next === undefined) return;
        e.preventDefault();
        pick(tabs[(next + tabs.length) % tabs.length].key, true);
    };

    return (
        <section className="lf-card lf-summary" aria-labelledby={`${id}-title`}>
            <div className="lf-cardhead">
                <div className="lf-cardtitle">
                    <h2 id={`${id}-title`}>Application details</h2>
                    <span className="lf-count">As submitted, with any corrections</span>
                </div>
                <label className="lf-switch">
                    <input type="checkbox" role="switch" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} />
                    <span className="track" aria-hidden="true" />
                    Show empty fields
                </label>
            </div>
            <div className="lf-tabs" role="tablist" aria-label="Application details" onKeyDown={onKey}>
                {tabs.map((t) => (
                    <button key={t.key} ref={(el) => { tabRefs.current[t.key] = el; }} type="button" role="tab"
                        id={`${id}-tab-${t.key}`} aria-controls={`${id}-panel`} aria-selected={tab === t.key}
                        tabIndex={tab === t.key ? 0 : -1} onClick={() => pick(t.key)}>
                        {t.label}
                        {t.n !== undefined && <b>{t.n}</b>}
                    </button>
                ))}
            </div>
            <div key={tab} id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${tab}`} className="lf-summary-body" data-tab={tab} tabIndex={0}>
                <SummaryContext.Provider value={{ stacked: true, hideEmpty: !showEmpty }}>
                    <ApplicationSummary app={app} onViewDocument={onViewDocument} groups={[tab]} />
                </SummaryContext.Provider>
            </div>
        </section>
    );
};

export default ApplicationDetails;
