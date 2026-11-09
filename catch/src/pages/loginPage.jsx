import { useState } from 'react';
import { UserAuth } from '../context/authContext';
import { Link, useNavigate } from 'react-router-dom';
import { AuthLayout, AuthField, PasswordField, AuthError } from '../components/authLayout';

const LoginPage = () => {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);

    const { signInUser } = UserAuth();
    const navigate = useNavigate();

    const handleSignIn = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
            const result = await signInUser(email, password);

            if (result.success) {
                navigate('/homePage'); // HomeRedirect picks applicant or admin home by role
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
                <h2>Welcome</h2>
                <p className="auth-sub">Sign in to continue your application.</p>
                <form onSubmit={handleSignIn} className="auth-form">
                    <AuthField label="Email" id="email" type="email" autoComplete="email" required
                        value={email} onChange={(e) => setEmail(e.target.value)} />
                    <PasswordField id="password" autoComplete="current-password" required
                        value={password} onChange={(e) => setPassword(e.target.value)} />
                    <AuthError message={error} />
                    <button type="submit" className="auth-submit" disabled={loading}>
                        {loading && <span className="auth-spin" aria-hidden="true" />}
                        {loading ? 'Signing in…' : 'Sign in'}
                    </button>
                </form>
                <p className="auth-switch">New here? <Link to="/signUpPage">Create an account</Link></p>
            </div>
        </AuthLayout>
    );
};

export default LoginPage;
