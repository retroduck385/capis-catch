import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { UserAuth } from '../context/authContext';
import { AuthLayout, AuthField, PasswordField, AuthError } from '../components/authLayout';

const SignUpPage = () => {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);

    const { signUpNewUser } = UserAuth();
    const navigate = useNavigate();

    const handleSignUp = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
            const result = await signUpNewUser(email, password);

            if (result.success) {
                navigate('/applicantHomepage');
            } else {
                setError(result.error?.message ?? result.error);
            }
        } catch (err) {
            console.error(err);
            setError("Something went wrong. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <AuthLayout>
            <div className="auth-card">
                <h2>Create your account</h2>
                <p className="auth-sub">It takes about a minute.</p>
                <form onSubmit={handleSignUp} className="auth-form">
                    <AuthField label="Email" id="email" type="email" autoComplete="email" required
                        value={email} onChange={(e) => setEmail(e.target.value)} />
                    <PasswordField id="password" autoComplete="new-password" required minLength={6} meter                        value={password} onChange={(e) => setPassword(e.target.value)} />
                    <AuthError message={error} />
                    <button type="submit" className="auth-submit" disabled={loading}>
                        {loading && <span className="auth-spin" aria-hidden="true" />}
                        {loading ? 'Creating account…' : 'Create account'}
                    </button>
                </form>
                <p className="auth-switch">Already have an account? <Link to="/loginPage">Sign in</Link></p>
            </div>
        </AuthLayout>
    );
};

export default SignUpPage;
