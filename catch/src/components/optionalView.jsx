// "Optional view": pages a staff member can open but only read for this application (e.g. the Financial Package for
// an AO or a reviewer), kept apart from the buttons for their own work. who: "Account Officers", "Reviewers", ...
// children: the links (className "lf-btn quiet"). Styles: .lf-optional in loanFolder.css
import { Eye } from 'lucide-react';

const OptionalView = ({ who, children }) => (
    <div className="lf-optional">
        <p className="lf-optional-label">
            <Eye size={16} aria-hidden="true" />
            <span><b>Optional view</b> · read-only for {who}</span>
        </p>
        <div className="lf-actions">{children}</div>
    </div>
);

export default OptionalView;
