import { Bell, FileText, MessageSquare, Users } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserAuth } from '../context/authContext';
import { openTopic, panelApplicationId } from '../pages/messages/topics';
import { useNotifications } from '../pages/notifications/useNotifications';
import './notificationBell.css';

// "5 min ago"; the full date is in the title attribute
const timeAgo = (iso) => {
    const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    const days = Math.round(hours / 24);
    return days < 7 ? `${days} d ago` : new Date(iso).toLocaleDateString();
};

const KindIcon = ({ kind }) => {
    if (kind === 'MESSAGE_POSTED') return <MessageSquare size={15} aria-hidden='true' />;
    if (kind === 'APPROVAL_ROUTED' || kind === 'NEW_APPLICATION') return <Users size={15} aria-hidden='true' />;
    if (kind?.startsWith('STAGE_') || kind === 'DONE_REVERTED' || kind === 'DEFERRED_ACCOUNT_UPDATED')
        return <FileText size={15} aria-hidden='true' />;
    return <Bell size={15} aria-hidden='true' />;
};

// Bell with unread count, top right of every signed-in page (mounted in the app layout's top bar).
// onDark: light icon for the navy top bar; the dropdown panel stays white either way.
const NotificationBell = ({ onDark = false }) => {
    const { session } = UserAuth();
    const navigate = useNavigate();
    const { items, unread, hasMore, latest, error, loadMore, markOneRead, markAllRead } =
        useNotifications(session?.user?.id);
    const [open, setOpen] = useState(false);
    const [tab, setTab] = useState('ALL');
    const buttonRef = useRef(null);
    const panelRef = useRef(null);

    // Esc closes and returns focus to the bell; a click outside closes
    useEffect(() => {
        if (!open) return;
        const onKey = (e) => {
            if (e.key === 'Escape') { setOpen(false); buttonRef.current?.focus(); }
        };
        const onClick = (e) => {
            if (!panelRef.current?.contains(e.target) && !buttonRef.current?.contains(e.target)) setOpen(false);
        };
        document.addEventListener('keydown', onKey);
        document.addEventListener('mousedown', onClick);
        return () => {
            document.removeEventListener('keydown', onKey);
            document.removeEventListener('mousedown', onClick);
        };
    }, [open]);

    const filteredItems = useMemo(() => {
        if (tab === 'MESSAGES') return items.filter((n) => n.kind === 'MESSAGE_POSTED');
        if (tab === 'UPDATES') return items.filter((n) => n.kind !== 'MESSAGE_POSTED');
        return items;
    }, [items, tab]);

    const openItem = (n) => {
        markOneRead(n.id);
        setOpen(false);
        // Message notification: open the drawer directly if already on that file; otherwise navigate and
        // signal the panel to open on arrival via router state
        if (n.kind === 'MESSAGE_POSTED') {
            const currentApp = panelApplicationId();
            if (currentApp !== null && String(currentApp) === String(n.application_id)) {
                openTopic(null);
                return;
            }
            if (n.link) { navigate(n.link, { state: { openMessages: true } }); return; }
        }
        if (n.link) navigate(n.link);
    };

    const badge = unread > 99 ? '99+' : String(unread);
    const emptyMsg = tab === 'MESSAGES' ? 'No message notifications.'
        : tab === 'UPDATES' ? 'No update notifications.'
        : 'No notifications yet.';

    return (
        <div style={{ position: 'relative', zIndex: 50 }}>
            <button
                ref={buttonRef}
                type='button'
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                aria-controls='notification-panel'
                aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
                className={`nb-btn${onDark ? '' : ' nb-btn--light'}`}>
                <svg aria-hidden='true' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                    <path strokeLinecap='round' strokeLinejoin='round'
                        d='M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5m6 0a3 3 0 1 1-6 0' />
                </svg>
                {unread > 0 && (
                    <span className='nb-badge' aria-hidden='true'>{badge}</span>
                )}
            </button>

            {/* Announces new notifications to screen readers */}
            <p className='sr-only' aria-live='polite'>{latest ? `New notification: ${latest.title}` : ''}</p>

            {open && (
                <div ref={panelRef} id='notification-panel' role='region' aria-label='Notifications' className='nb-panel'>
                    <div className='nb-head'>
                        <h2>Notifications</h2>
                        {unread > 0 && (
                            <button type='button' className='nb-mark-read' onClick={markAllRead}>
                                Mark all as read
                            </button>
                        )}
                    </div>

                    <ul className='nb-tabs' role='tablist' aria-label='Filter notifications'>
                        {[['ALL', 'All'], ['MESSAGES', 'Messages'], ['UPDATES', 'Updates']].map(([value, label]) => (
                            <li key={value} role='none'>
                                <button
                                    type='button'
                                    role='tab'
                                    aria-selected={tab === value}
                                    className='nb-tab'
                                    onClick={() => setTab(value)}>
                                    {label}
                                </button>
                            </li>
                        ))}
                    </ul>

                    {error && <p className='nb-error' role='alert'>{error}</p>}

                    <ul className='nb-list'>
                        {filteredItems.length === 0 && (
                            <li className='nb-empty'>{emptyMsg}</li>
                        )}
                        {filteredItems.map((n) => (
                            <li key={n.id} className={`nb-item${n.read_at ? '' : ' unread'}`}>
                                <button type='button' className='nb-item-btn' onClick={() => openItem(n)}>
                                    <span className='nb-ic' aria-hidden='true'>
                                        <KindIcon kind={n.kind} />
                                    </span>
                                    <span className='nb-text'>
                                        {!n.read_at && <span className='sr-only'>Unread: </span>}
                                        <span className='nb-title'>{n.title}</span>
                                        {n.body && <span className='nb-body'>{n.body}</span>}
                                        <time
                                            className='nb-time'
                                            dateTime={n.created_at}
                                            title={new Date(n.created_at).toLocaleString()}>
                                            {timeAgo(n.created_at)}
                                        </time>
                                    </span>
                                    {!n.read_at && <span className='nb-dot' aria-hidden='true' />}
                                </button>
                            </li>
                        ))}
                    </ul>

                    {hasMore && (
                        <div className='nb-footer'>
                            <button type='button' className='nb-older' onClick={loadMore}>
                                Show older
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default NotificationBell;
