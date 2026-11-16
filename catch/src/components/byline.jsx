// Who did something and when, the same way on every staff page (DESIGN.md 11.10, "Attribution"): an initials avatar
// in the person's colour, the name (a role in a test name is dropped), an optional role, and a short time
// ("Today, 2:07 PM") whose exact moment is in the tooltip and in <time datetime>. Formatting: people.js.
//   layout="stacked" (cards, lists): avatar beside two lines, name, then "role · time"
//   layout="inline" (strips, chips, rows): one line, avatar · name · time; the name truncates, the time never breaks
//   ai: the author is the AI (a sparkle disc instead of initials); role then names the model
//   time="day": a record date ("Sep 29, 2026") instead of a relative time
// Styles: byline.css.
import { Sparkles } from 'lucide-react';
import { avatarStyle, formatDay, formatWhen, fullWhen, initialsOf, personName } from './people';
import './byline.css';

const Byline = ({ name, role, at, layout = 'stacked', ai = false, time = 'when', fallback = 'Staff', className = '' }) => {
    const who = ai ? 'AI' : personName(name) || fallback;
    const shown = at ? (time === 'day' ? formatDay(at) : formatWhen(at)) : null;
    const stamp = shown && (
        <time className="byline-time" dateTime={new Date(at).toISOString()} title={fullWhen(at)}>{shown}</time>
    );
    return (
        <span className={`byline ${layout}${className ? ` ${className}` : ''}`}>
            {ai
                ? <span className="byline-av ai" aria-hidden="true"><Sparkles size={12} /></span>
                : <span className="byline-av" style={avatarStyle(who)} aria-hidden="true">{initialsOf(who)}</span>}
            <span className="byline-name" title={who}>{who}</span>
            {layout === 'stacked' ? (
                (role || stamp) && <span className="byline-meta">{role && <span className="byline-role">{role}</span>}{stamp}</span>
            ) : (
                <>{role && <span className="byline-role">{role}</span>}{stamp}</>
            )}
        </span>
    );
};

export default Byline;
