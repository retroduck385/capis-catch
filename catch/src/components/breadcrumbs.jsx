// Staff-side breadcrumb, shown above a page's header card. It follows the path actually clicked for this application,
// e.g. Work tray > Review summary > Credit score > Loan folder, with the current page highlighted. Stepping back
// to an earlier page keeps the pages you left visible, faded, after the current one so you can jump forward again;
// opening a different page drops them, and opening a row in the work tray starts the trail afresh (see
// trailStore.js). Everything except the current page is a link.
// current: key of this page (see PAGES). appNo / appId: the application. onNavigate: optional click guard on the
// links (e.g. an unsaved-changes confirm).
// Styles: .lf-crumbs in loanFolder.css
import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { UserAuth } from '../context/authContext';
import { nextTrail, readTrail, trailKey, writeTrail } from './trailStore';

const PAGES = {
    folder: { label: (no) => `Application ${no}`, to: (id) => `/loanFolderPage?id=${id}` },
    package: { label: () => 'Financial Package', to: (id) => `/financialPackagePage?id=${id}` },
    score: { label: () => 'Credit score', to: (id) => `/creditScorePage?id=${id}` },
    routing: { label: () => 'Approval routing', to: (id) => `/approvalRoutingPage?id=${id}` },
    review: { label: () => 'Review summary', to: (id) => `/reviewSummaryPage?id=${id}` },
    request: { label: (no) => `CI request ${no}`, to: (id) => `/ciRequestPage?id=${id}` },
};

const Breadcrumbs = ({ current, appId, appNo, onNavigate }) => {
    const { session } = UserAuth();
    const key = trailKey(session?.user?.id, appId);
    const state = useMemo(() => nextTrail(readTrail(key), current), [key, current]);

    useEffect(() => { writeTrail(key, state); }, [key, state]);

    const item = (page, kind) => ({ label: PAGES[page].label(appNo), to: PAGES[page].to(appId), kind });
    const trail = [
        { label: 'Work tray', to: '/adminHomePage', kind: 'back' },
        ...state.path.filter((p) => PAGES[p]).map((p) => item(p, p === current ? 'here' : 'back')),
        ...state.ahead.filter((p) => PAGES[p]).map((p) => item(p, 'ahead')),
    ];

    return (
        <nav className="lf-crumbs" aria-label="Breadcrumb">
            <ol>
                {trail.map((t, i) => (
                    <li key={`${i}-${t.label}`} className={t.kind === 'ahead' ? 'ahead' : undefined}>
                        {t.kind === 'here'
                            ? <span aria-current="page">{t.label}</span>
                            : <Link to={t.to} onClick={onNavigate}>{t.label}</Link>}
                        {i < trail.length - 1 && <ChevronRight size={14} className="crumb-sep" aria-hidden="true" />}
                    </li>
                ))}
            </ol>
        </nav>
    );
};

export default Breadcrumbs;
