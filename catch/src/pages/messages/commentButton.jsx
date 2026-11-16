// "Comment on this section": a small button on the sections staff look at. It opens the page's Messages drawer
// with that section attached as the topic. Staff only: it renders nothing for an applicant, for a signed-out
// visitor, on a section without a known id, or on a page without a Messages drawer (canCommentOn in topics.js).
import { useSyncExternalStore } from 'react';
import { MessageSquarePlus } from 'lucide-react';
import { UserAuth } from '../../context/authContext';
import { canCommentOn, openTopic, panelApplicationId, subscribePanel, topicLabel } from './topics';

const CommentButton = ({ topic, className = '' }) => {
    const role = UserAuth()?.role;
    const panelOpenFor = useSyncExternalStore(subscribePanel, panelApplicationId);
    if (!canCommentOn({ role, topic, panelOpenFor })) return null;
    const label = `Comment on ${topicLabel(topic)}`;
    return (
        <button type='button' onClick={() => openTopic(topic)} aria-label={label} title={label}
            className={`ml-2 inline-flex min-h-0! items-center rounded border-0! bg-transparent! p-1! align-middle text-gray-600 hover:bg-blue-50! hover:text-blue-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${className}`}>
            <MessageSquarePlus size={16} aria-hidden='true' />
        </button>
    );
};

export default CommentButton;
