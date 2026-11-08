import { useState } from 'react';
import { UserAuth } from '../context/authContext';
import { Link, useNavigate } from 'react-router-dom';
import ApplicantShell, { BrandPanel } from '../components/applicantShell';

const LoginPage = () => {
    const [email, setEmail] = useState ("");
    const [password, setPassword] = useState ("");
    const [error, setError] = useState (null);
    const [loading, setLoading] = useState (false);

    const { session, signInUser } = UserAuth();
    const navigate = useNavigate();

    console.log(session); // delete when deploying
    console.log(email, password); // delete when deploying
    
    const handleSignIn = async (e) => {
    e.preventDefault()
    setLoading(true)
    try{
        const result = await signInUser(email, password)

        if(result.success){
            navigate('/homePage') // HomeRedirect picks applicant or admin home by role
        } else {
            setError(result.error)
        }
    } catch (err){
        console.error(err) // delete this after 
        setError ("an error occured");
    } finally {
        setLoading(false);
    }
    }

    return(
    <ApplicantShell bare>
        <BrandPanel heading="Lorem ipsum dolor sit amet." lede="Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua." />
        <section className="ct-auth-panel">
            <form onSubmit={ handleSignIn } className="ct-card">
                <h2>Sign in</h2>
                <p>Use the email and password you registered with.</p>
                <div className="fields">
                    <label>
                        Email
                        <input value={email} onChange={(e) => setEmail(e.target.value)}
                            type="email" autoComplete="email" required />
                    </label>
                    <label>
                        Password
                        <input value={password} onChange={(e) => setPassword(e.target.value)}
                            type="password" autoComplete="current-password" required />
                    </label>
                </div>
                <button type="submit" disabled={loading}>{loading ? 'Signing in...' : 'Sign in'}</button>
                {error && <p className="ct-error" role="alert">{error}</p>}
                <p style={{ marginTop: '1.25rem' }}>New here? <Link to="/signUpPage">Create an account</Link></p>
            </form>
        </section>
    </ApplicantShell>
);
};

export default LoginPage;