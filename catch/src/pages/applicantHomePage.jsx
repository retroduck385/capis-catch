import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { UserAuth } from '../context/authContext';
import { Link, useNavigate } from 'react-router-dom';
import { fetchProfile, listMyApplications } from './applicationForm/api';
import { isProfileComplete } from './applicationForm/validators';
import ApplicantStatusLabel from './notifications/applicantStatusLabel';
import { Ghost, RegisterSkeleton } from '../components/skeleton';

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

    return (
        <div>
            {profileComplete === false && (
                <div className="ct-banner" role="status" style={{ marginBottom: '1.25rem' }}>
                    <AlertTriangle size={14} aria-hidden="true" />
                    <p>
                        <strong>Add your personal details before you apply.</strong>{' '}
                        We use them to fill in your application. <Link to="/profilePage?next=apply">Complete your profile</Link>
                    </p>
                </div>
            )}

            <div className="ct-pagehead">
                <div>
                    <h1>{firstName ? `Welcome back, ${firstName}` : 'My applications'}</h1>
                    <p>Start a housing loan application or pick up where you left off.</p>
                </div>
                <button type="button" className="ct-primary" onClick={applyHousingLoan}>
                    {hasDraft ? 'Continue your application' : 'Start a housing loan application'}
                </button>
            </div>

            <div className="ct-stats">
                <div className="ct-stat"><span>Total applications</span><strong>{loaded ? applications.length : <Ghost>00</Ghost>}</strong></div>
                <div className="ct-stat"><span>Drafts in progress</span><strong>{loaded ? draftCount : <Ghost>00</Ghost>}</strong></div>
                <div className="ct-stat"><span>Submitted</span><strong>{loaded ? applications.length - draftCount : <Ghost>00</Ghost>}</strong></div>
            </div>

            <div className="ct-card">
                <div className="ct-card-head">
                    <h2>Application register</h2>
                    {loaded
                        ? <span className="ct-mono ct-muted">{applications.length} {applications.length === 1 ? 'record' : 'records'}</span>
                        : <Ghost>0 records</Ghost>}
                </div>
                {error && <p className="ct-error" role="alert" style={{ padding: '0 1rem' }}>{error}</p>}
                {!loaded ? (
                    <RegisterSkeleton />
                ) : applications.length === 0 ? (
                    <p className="ct-empty">You haven't started an application yet. Start one above. It saves after every step, so you can leave and come back.</p>
                ) : (
                    <ul className="ct-register">
                        {applications.map((a) => (
                            <li key={a.id}>
                                <span className="ct-mono">{a.application_no ?? 'Draft'}</span>
                                <span><span className="ct-badge"><ApplicantStatusLabel application={a} /></span></span>
                                <span className="amt">{a.loan_amount ? `PHP ${Number(a.loan_amount).toLocaleString()}` : ''}</span>
                                <Link className="ct-link" to={`/applicationFormPage?id=${a.id}`}>
                                    {a.status === 'DRAFT' ? 'Continue' : 'View'}
                                </Link>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
};

export default ApplicantHomePage;
