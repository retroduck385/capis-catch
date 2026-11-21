// Side panels that can be hidden and shown again (group notes item 38), on the staff pages' section lists and the loan
// folder's KYC check rail. Remembered per page type (panelState.js).
//   const panel = useSidePanel('fp');   (useSidePanel.js)
//   panel.hidden ? <PanelRail panel={panel} label="sections" /> : <nav>...<PanelHide panel={panel} label="sections" /></nav>
// While hidden, the panel is replaced by a slim strip (PanelRail) with a Show button and any icon buttons passed as
// children (the Financial Package keeps its Policy check there). Focus moves to the button that replaces the one pressed.
// The page's grid gets narrower for the strip through the `side-hidden` class (sidePanel.css).
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react';
import './sidePanel.css';

// The small "Hide" button at the top of a shown panel
export const PanelHide = ({ panel, label, side = 'left' }) => {
    const Icon = side === 'left' ? PanelLeftClose : PanelRightClose;
    return (
        <button autoFocus={panel.toggled} type="button" className={`sp-hide ${side}`} aria-expanded="true" onClick={panel.toggle}
            title={`Hide ${label}`}>
            <Icon size={16} aria-hidden="true" /><span>Hide {label}</span>
        </button>
    );
};

// The slim strip in place of a hidden panel: Show, then any extra icon buttons (children)
export const PanelRail = ({ panel, label, side = 'left', children = null }) => {
    const Icon = side === 'left' ? PanelLeftOpen : PanelRightOpen;
    return (
        <div className={`sp-rail ${side}`} role="group" aria-label={`${label} (hidden)`}>
            <button autoFocus={panel.toggled} type="button" className="sp-show" aria-expanded="false" onClick={panel.toggle}
                title={`Show ${label}`}>
                <Icon size={18} aria-hidden="true" /><span className="sp-show-txt">Show {label}</span>
            </button>
            {children}
        </div>
    );
};
