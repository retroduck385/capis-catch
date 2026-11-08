import React, {useState} from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { UserAuth } from '../context/authContext';
import ApplicantShell, { BrandPanel } from '../components/applicantShell';

const SignUpPage = () => {
const [email, setEmail] = useState ("");
const [password, setPassword] = useState ("");
const [error, setError] = useState (null);
const [loading, setLoading] = useState (false);

const { session, signUpNewUser } = UserAuth();
const navigate = useNavigate();

console.log(session);
console.log(email, password); // to remove both console logs

const handleSignUp = async (e) => {
    e.preventDefault()
    setLoading(true)
    try{
        const result = await signUpNewUser(email, password)

        if(result.success){
            navigate('/applicantHomepage')
        } else {
            setError(result.error.message)
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
            <form onSubmit={ handleSignUp } className="ct-card">
                <h2>Create an account</h2>
                <p>It takes about a minute.</p>
                <div className="fields">
                    <label>
                        Email
                        <input value={email} onChange={(e) => setEmail(e.target.value)}
                            type="email" autoComplete="email" required />
                    </label>
                    <label>
                        Password
                        <input value={password} onChange={(e) => setPassword(e.target.value)}
                            type="password" autoComplete="new-password" required />
                    </label>
                </div>
                <button type="submit" disabled={loading}>{loading ? 'Creating account...' : 'Create account'}</button>
                {error && <p className="ct-error" role="alert">{error}</p>}
                <p style={{ marginTop: '1.25rem' }}>Already have an account? <Link to="/loginPage">Sign in</Link></p>
            </form>
        </section>
    </ApplicantShell>
);
};

export default SignUpPage;