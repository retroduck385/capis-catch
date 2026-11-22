// A brief tile's modal (brief.jsx): one section of the Decision Support page (Readiness, Exception highlights or the
// policy check), shown over the review summary so the review and its draft stay put. Same section components and
// the same ctx as the full page; the footer opens the full page at that section in a new tab.
// Shell and styles: components/infoModal.jsx.
import { Scale } from 'lucide-react';
import InfoModal from '../../components/infoModal';
import { dssHref } from './format';

// tile: { section, label, Icon, tone, Component }
const BriefDialog = ({ ctx, tile, onClose }) => {
    const { section, label, Icon, tone, Component } = tile;
    return (
        <InfoModal Icon={Icon} tone={tone} eyebrow="Decision support" title={label} onClose={onClose}
            note="Read-only. Policy results are suggestions with their source clause; you decide."
            link={{ to: dssHref(ctx.app.id, section), label: 'Open full Decision Support', Icon: Scale }}>
            <Component ctx={ctx} fullHref={dssHref(ctx.app.id, 'ds-exceptions')} />
        </InfoModal>
    );
};

export default BriefDialog;
