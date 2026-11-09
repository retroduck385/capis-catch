import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BadgeCheck, Building2, ClipboardList, Eye, EyeOff, FileUp, Lock, Mail, Save, UserPlus } from 'lucide-react';
import '../auth.css';

const STEPS = [
    [UserPlus, 'Create an account', 'Sign up with your email.'],
    [ClipboardList, 'Fill in your application', 'Loan details, personal information, address and employment.'],
    [FileUp, 'Upload your documents', 'Add the requirements for each borrower.'],
    [BadgeCheck, 'Review and submit', 'Check everything, then send it in.'],
];

// Stagger index for the entrance animation (consumed by CSS as --e).
const e = (n) => ({ '--e': n });


// Architectural line drawing, anchored to the bottom of the brand panel. Decorative only.
// Two stroke weights (bold outline, `fine` detail); each stroke draws in order via --i.
const HouseLines = () => {
    const d = (i) => ({ '--i': i });
    return (
        <svg className="auth-house" viewBox="0 0 900 520" preserveAspectRatio="xMaxYMax meet" aria-hidden="true" focusable="false">
            <g fill="none" strokeLinecap="round" strokeLinejoin="round">
                {/* ground + garden path */}
                <path style={d(0)} pathLength="1" d="M0 480H900" />
                <path className="fine" style={d(1)} pathLength="1" d="M468 480L436 520M532 480L564 520" />

                {/* main house: walls, roof, gable depth line */}
                <path style={d(2)} pathLength="1" d="M330 480V250M670 480V250" />
                <path style={d(3)} pathLength="1" d="M290 266L500 96L710 266" />
                <path className="fine" style={d(4)} pathLength="1" d="M330 250L500 114L670 250" />
                <path style={d(4)} pathLength="1" d="M570 153V104H614V189" />

                {/* gable window */}
                <path style={d(5)} pathLength="1" d="M470 204V178A30 30 0 0 1 530 178V204Z" />
                <path className="fine" style={d(5)} pathLength="1" d="M500 148V204M470 176H530" />

                {/* windows with sills */}
                <rect style={d(6)} pathLength="1" x="364" y="326" width="72" height="84" rx="3" />
                <path className="fine" style={d(6)} pathLength="1" d="M400 326V410M364 368H436M354 418H446" />
                <rect style={d(6)} pathLength="1" x="564" y="326" width="72" height="84" rx="3" />
                <path className="fine" style={d(6)} pathLength="1" d="M600 326V410M564 368H636M554 418H646" />

                {/* arched door */}
                <path className="door" style={d(7)} pathLength="1" d="M466 480V374A34 34 0 0 1 534 374V480" />
                <path className="door fine" style={d(8)} pathLength="1" d="M500 340V480" />
                <circle className="door" style={d(8)} pathLength="1" cx="520" cy="432" r="3" />

                {/* garage annex */}
                <path style={d(9)} pathLength="1" d="M670 346H846V480M656 346H860" />
                <rect style={d(10)} pathLength="1" x="704" y="382" width="108" height="98" rx="2" />
                <path className="fine" style={d(10)} pathLength="1" d="M704 414H812M704 446H812" />
            </g>
            {/* life: lit windows and chimney smoke (kept out of the draw-in group) */}
            <g className="fx">
                <rect className="glow" x="367" y="329" width="66" height="78" rx="2" />
                <rect className="glow g2" x="567" y="329" width="66" height="78" rx="2" />
                <circle className="smoke" cx="592" cy="96" r="6" />
                <circle className="smoke s2" cx="592" cy="96" r="6" />
                <circle className="smoke s3" cx="592" cy="96" r="6" />
            </g>
        </svg>
    );
};

// Shared frame for /loginPage and /signUpPage: an immersive brand panel on the left, one focused form on the right.
export const AuthLayout = ({ children }) => (
    <div className="auth">
        <aside className="auth-aside">
            <HouseLines />
            <Link to="/loginPage" className="auth-logo" style={e(0)}>
                <span className="auth-logo-mark"><Building2 size={16} aria-hidden="true" /></span>
                CATCH
            </Link>

            <div className="auth-pitch">
                <span className="auth-eyebrow" style={e(1)}>Housing loan applications</span>
                <h1>
                    <span className="line"><span style={e(2)}>Home financing,</span></span>
                    <span className="line"><em><span style={e(3)}>made simple.</span></em></span>
                </h1>
                <p style={e(4)}>Apply online, upload your documents once, and follow your application from submission to decision.</p>

                <ol className="auth-steps">
                    {STEPS.map(([Icon, title, text], i) => (
                        <li key={title} style={{ ...e(5 + i), '--i': i }}>
                            <div className="top">
                                <span className="tile"><Icon size={18} aria-hidden="true" /></span>
                                <span className="num" aria-hidden="true">0{i + 1}</span>
                            </div>
                            <strong>{title}</strong>
                            <span>{text}</span>
                        </li>
                    ))}
                </ol>
            </div>

            <div className="auth-foot" style={e(9)}>
                <Save size={16} aria-hidden="true" />
                <span>Your progress is saved as you go, so you can finish later.</span>
            </div>
        </aside>
        <main className="auth-main">{children}</main>
    </div>
);

export const AuthField = ({ label, id, hint, icon: Icon = Mail, ...input }) => (
    <div className="auth-field">
        <label htmlFor={id}>{label}</label>
        <div className="auth-control">
            <Icon className="auth-icon" size={18} aria-hidden="true" />
            <input id={id} {...input} />
        </div>
        {hint && <span className="auth-hint">{hint}</span>}
    </div>
);

const strength = (pw) => {
    let s = 0;
    if (pw.length >= 6) s++;
    if (pw.length >= 10) s++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
    if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++;
    return s;
};
const LEVELS = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'];

export const PasswordField = ({ label = 'Password', id, hint, meter = false, ...input }) => {
    const [shown, setShown] = useState(false);
    const score = meter && input.value ? strength(input.value) : 0;
    return (
        <div className="auth-field">
            <label htmlFor={id}>{label}</label>
            <div className="auth-control">
                <Lock className="auth-icon" size={18} aria-hidden="true" />
                <input id={id} type={shown ? 'text' : 'password'} {...input} />
                <button type="button" className="auth-eye" onClick={() => setShown((s) => !s)}
                    aria-label={shown ? 'Hide password' : 'Show password'} aria-pressed={shown}>
                    {shown ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                </button>
            </div>
            {meter && input.value ? (
                <div className="auth-strength" data-level={score} aria-live="polite">
                    <div aria-hidden="true"><i /><i /><i /><i /></div>
                    <span>{LEVELS[score]}</span>
                </div>
            ) : hint && <span className="auth-hint">{hint}</span>}
        </div>
    );
};

export const AuthError = ({ message }) =>
    message ? <p className="auth-error" role="alert">{message}</p> : null;
