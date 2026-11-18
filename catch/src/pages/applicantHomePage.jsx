// The applicant's home: a welcome banner with the one main action (start or continue an application), any documents
// the Account Officer asked for, three counts, and the applicant's applications as rows. Beside them: the same identity
// card as the profile page (staffProfile.css .sp-id) and "How it works", ticked off as the applicant goes.
// Styled by applicationForm/applicantPages.css (.ap), the same glass look as the staff pages; the columns fill the panel.
import { useEffect, useState } from 'react';
import { ArrowRight, Check, CircleAlert, FilePen, FileText, House, Send, UserRound } from 'lucide-react';
import { UserAuth } from '../context/authContext';
import { Link, useNavigate } from 'react-router-dom';
import { fetchProfile, listMyApplications } from './applicationForm/api';
import { formatPeso } from './applicationForm/options';
import { isProfileComplete } from './applicationForm/validators';
import ApplicantStatusLabel from './notifications/applicantStatusLabel';
import ApplicantRequestCard from './documentRequests/applicantRequestCard';
import { Ghost, RegisterSkeleton } from '../components/skeleton';
import { formatDay } from '../components/people';
import { useCountUp } from './workTray/useCountUp';
import { initialsOf } from './staffAccounts/options';
import './applicationForm/applicantPages.css';
import './staffProfile.css';

// What happens, in order; each step's `done` is worked out from the profile and the applications below
const HOW_IT_WORKS = [
    ['Complete your profile', 'We use it to fill in your application.'],
    ['Fill in your application', 'It saves after every step, so you can stop and come back.'],
    ['Upload your documents', 'Clear scans or photos: JPG, PNG or PDF, up to 10 MB each.'],
    ['Submit it for review', 'Your Account Officer checks it and may ask for more documents.'],
    ['Get your notice', 'Your Account Officer sends you the decision.'],
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

    useEffect(() => {
        if (!session?.user?.id) return;
        listMyApplications(session.user.id)
            .then(setApplications)
            .catch((err) => setError(err.message))
            .finally(() => setLoaded(true));
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
    const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ');
    const email = session?.user?.email;

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

                    <ApplicantRequestCard />

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
                                            <span><span className={`ct-badge ${draft ? 'warm' : 'plain'}`}><ApplicantStatusLabel application={a} /></span></span>
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

                <aside className="ap-home-side" aria-label="Your profile and how it works">
                    <section className="sp-card sp-id" aria-label="Your profile">
                        <span className="sp-avatar" style={{ '--hue': '#1e3f97' }} aria-hidden="true">{initialsOf(fullName, email)}</span>
                        <h2>{fullName || 'Your name'}</h2>
                        <span className="sp-role" style={{ '--hue': '#1e3f97' }}>Loan Applicant</span>
                        <p className="sp-email" title={email}>{email}</p>
                        {profileComplete !== null && (
                            <p className={`ap-me-status ${profileComplete ? 'ok' : 'warn'}`}>
                                {profileComplete ? <Check size={16} aria-hidden="true" /> : <CircleAlert size={16} aria-hidden="true" />}
                                {profileComplete ? 'Profile complete' : 'Profile not complete yet'}
                            </p>
                        )}
                        <ul className="sp-links">
                            <li>
                                <Link to="/profilePage">
                                    <UserRound size={18} aria-hidden="true" />
                                    <span><b>My profile</b><small>Your details for every application</small></span>
                                    <ArrowRight size={16} aria-hidden="true" />
                                </Link>
                            </li>
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
