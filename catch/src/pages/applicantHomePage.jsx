// The applicant's home: a welcome banner with the one main action (start or continue an application), any documents
// the Account Officer asked for, three counts, and the applicant's applications as rows. Beside them: a short
// "Before you start" guide (what to prepare, from the requirement list) and "How it works", ticked off as the
// applicant goes. The profile is reached from the top bar's menu.
// Styled by applicationForm/applicantPages.css (.ap), the same glass look as the staff pages; the columns fill the panel.
import { useEffect, useState } from 'react';
import { ArrowRight, Bell, Check, FilePen, FileText, FileUp, House, IdCard, MessageCircleQuestion, Send, UserRound, Wallet } from 'lucide-react';
import { UserAuth } from '../context/authContext';
import { Link, useNavigate } from 'react-router-dom';
import { fetchProfile, listMyVisibleApplications } from './applicationForm/api';
import { formatPeso } from './applicationForm/options';
import { isProfileComplete } from './applicationForm/validators';
import ApplicantStatusLabel from './notifications/applicantStatusLabel';
import { fetchMyClarifications } from './kycClarify/api';
import './kycClarify/kycClarify.css';
import { Ghost, RegisterSkeleton } from '../components/skeleton';
import { formatDay } from '../components/people';
import { useCountUp } from './workTray/useCountUp';
import { Terms } from '../components/term';
import './applicationForm/applicantPages.css';

// What happens, in order; each step's `done` is worked out from the profile and the applications below
const HOW_IT_WORKS = [
    ['Complete your profile', 'We use it to fill in your application.'],
    ['Fill in your application', 'It saves after every step, so you can stop and come back.'],
    ['Upload your documents', 'Clear scans or photos: JPG, PNG or PDF, up to 10 MB each.'],
    ['Submit it for review', 'Your Account Officer checks it and may ask for more documents.'],
    ['Get your notice', 'Your Account Officer sends you the decision.'],
];

// Before you start: what to have ready (REQUIREMENT_LABELS in applicationForm/options.js; two ID files are required)
const GUIDE = [
    [IdCard, 'Two valid IDs', 'Passport, driver’s license, UMID or another government ID. Not expired, every detail readable.'],
    [Wallet, 'Proof of income', 'COE or ITR, plus your last 3 months of payslips or remittances. Self-employed: SEC, DTI or Mayor’s permit and bank statements.'],
    [FileUp, 'Clear files', 'JPG, PNG or PDF, up to 10 MB each. Someone signing for you? Add a Special Power of Attorney.'],
    [Bell, 'After you submit', 'If your Account Officer needs anything, the request shows on this page and in your notifications.'],
];

// One count tile; the number counts up once the list has loaded (straight to the value under reduced motion)
const StatTile = ({ label, value, Icon, loaded }) => {
    const shown = useCountUp(loaded ? value : 0);
    return (
        <div className="ap-stat">
            <span className="ap-stat-icon" aria-hidden="true"><Icon size={20} /></span>
            <span className="ap-stat-label">{label}</span>
            <strong>{loaded ? shown : <Ghost>00</Ghost>}</strong>
        </div>
    );
};

const ApplicantHomePage = () => {
    const { session } = UserAuth();
    const navigate = useNavigate();
    const [applications, setApplications] = useState([]);
    const [loaded, setLoaded] = useState(false); // false until the application list has come back
    const [profile, setProfile] = useState(null);
    const [profileComplete, setProfileComplete] = useState(null); // null = still loading
    const [error, setError] = useState(null);
    const [asked, setAsked] = useState(() => new Set());   // applications with an open KYC question

    useEffect(() => {
        if (!session?.user?.id) return;
        listMyVisibleApplications(session.user.id)
            .then(setApplications)
            .catch((err) => setError(err.message))
            .finally(() => setLoaded(true));
        // Open KYC questions per application, for the "Clarification requested" badge (extra: no badge if it fails)
        fetchMyClarifications()
            .then((rows) => setAsked(new Set(rows.map((t) => t.application_id))))
            .catch(() => setAsked(new Set()));
        fetchProfile(session.user.id)
            .then((p) => { setProfile(p); setProfileComplete(isProfileComplete(p)); })
            .catch((err) => setError(err.message));
    }, [session?.user?.id]);

    const draftCount = applications.filter((a) => a.status === 'DRAFT').length;
    const hasDraft = draftCount > 0;
    const firstName = profile?.first_name;

    const applyHousingLoan = () => {
        navigate(profileComplete ? '/applicationFormPage' : '/profilePage?next=apply');
    };

    const stats = [
        ['Total applications', applications.length, FileText],
        ['Drafts in progress', draftCount, FilePen],
        ['Submitted', applications.length - draftCount, Send],
    ];

    // How it works: what is done so far, and the first step that isn't (null while loading)
    const submitted = applications.length - draftCount > 0;
    const doneSteps = [profileComplete === true, submitted, submitted, submitted, false];
    const currentStep = loaded && profileComplete !== null ? doneSteps.indexOf(false) : null;

    return (
        <div className="ap ap-home">
            {profileComplete === false && (
                <div className="ap-alert" role="status">
                    <span className="ap-alert-icon" aria-hidden="true"><UserRound size={20} /></span>
                    <div>
                        <strong>Add your personal details before you apply.</strong>
                        <p>We use them to fill in your application.</p>
                    </div>
                    <Link to="/profilePage?next=apply" className="ap-btn">
                        Complete your profile<ArrowRight size={16} aria-hidden="true" />
                    </Link>
                </div>
            )}

            <div className="ap-home-grid">
                <div className="ap-home-main">
                    <section className="ap-hero" aria-labelledby="ap-hero-title">
                        <div className="ap-hero-text">
                            <p className="ap-eyebrow">Housing loan</p>
                            <h1 id="ap-hero-title">{firstName ? `Welcome back, ${firstName}` : 'My applications'}</h1>
                            <p>Start a housing loan application or pick up where you left off. Your answers save after every step.</p>
                        </div>
                        <button type="button" className="ap-hero-cta" onClick={applyHousingLoan}>
                            {hasDraft ? 'Continue your application' : 'Start a housing loan application'}
                            <ArrowRight size={18} aria-hidden="true" />
                        </button>
                        <House className="ap-hero-art" size={190} strokeWidth={1.1} aria-hidden="true" />
                    </section>

                    <div className="ap-stats">
                        {stats.map(([label, value, Icon]) => (
                            <StatTile key={label} label={label} value={value} Icon={Icon} loaded={loaded} />
                        ))}
                    </div>

                    <section className="ap-card" aria-labelledby="ap-apps-title">
                        <header className="ap-card-head">
                            <h2 id="ap-apps-title">Your applications</h2>
                            {loaded
                                ? <span className="ap-count">{applications.length} {applications.length === 1 ? 'application' : 'applications'}</span>
                                : <Ghost>0 applications</Ghost>}
                        </header>
                        {error && <p className="ct-error" role="alert">{error}</p>}
                        {!loaded ? (
                            <RegisterSkeleton />
                        ) : applications.length === 0 ? (
                            <div className="ap-empty">
                                <span className="ap-empty-icon" aria-hidden="true"><FileText size={24} /></span>
                                <p>You haven&apos;t started an application yet. Start one above. It saves after every step, so you can leave and come back.</p>
                            </div>
                        ) : (
                            <ul className="ct-register">
                                {applications.map((a) => {
                                    const draft = a.status === 'DRAFT';
                                    return (
                                        <li key={a.id}>
                                            <span className="ap-app">
                                                {a.application_no ? <span className="ct-mono">{a.application_no}</span> : <b>New application</b>}
                                                <small>
                                                    {draft ? 'Started ' : 'Submitted '}
                                                    <span className="ap-nowrap">{formatDay(draft ? a.created_at : a.submitted_at)}</span>
                                                </small>
                                            </span>
                                            <span className="ap-status">
                                                <span className={`ct-badge ${draft ? 'warm' : 'plain'}`}><ApplicantStatusLabel application={a} /></span>
                                                {asked.has(a.id) && (
                                                    <span className="ct-badge warm">
                                                        <MessageCircleQuestion size={14} aria-hidden="true" />Clarification requested
                                                    </span>
                                                )}
                                            </span>
                                            <span className="amt">{a.loan_amount ? formatPeso(a.loan_amount) : ''}</span>
                                            <Link className={`ap-rowlink${draft ? ' primary' : ''}`} to={`/applicationFormPage?id=${a.id}`}>
                                                {draft ? 'Continue' : 'View'}<ArrowRight size={16} aria-hidden="true" />
                                            </Link>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </section>
                </div>

                <aside className="ap-home-side" aria-label="Before you start and how it works">
                    <section className="ap-card ap-guide" aria-labelledby="ap-guide-title">
                        <header className="ap-card-head"><h2 id="ap-guide-title">Before you start</h2></header>
                        <ul className="ap-guide-list">
                            {GUIDE.map(([Icon, title, text]) => (
                                <li key={title}>
                                    <span className="ap-guide-ic" aria-hidden="true"><Icon size={18} /></span>
                                    <span><b>{title}</b><small><Terms text={text} /></small></span>
                                </li>
                            ))}
                        </ul>
                    </section>

                    <section className="ap-card ap-next" aria-labelledby="ap-next-title">
                        <header className="ap-card-head"><h2 id="ap-next-title">How it works</h2></header>
                        <ol className="ap-steps">
                            {HOW_IT_WORKS.map(([title, hint], i) => {
                                const state = doneSteps[i] ? 'done' : i === currentStep ? 'current' : 'todo';
                                return (
                                    <li key={title} className={state} aria-current={state === 'current' ? 'step' : undefined}>
                                        <span className="n" aria-hidden="true">{state === 'done' ? <Check size={13} strokeWidth={3} /> : i + 1}</span>
                                        <span>
                                            <b>{title}</b>
                                            <small>{hint}</small>
                                            {state === 'done' && <span className="sr-only"> (done)</span>}
                                        </span>
                                    </li>
                                );
                            })}
                        </ol>
                    </section>
                </aside>
            </div>
        </div>
    );
};

export default ApplicantHomePage;
