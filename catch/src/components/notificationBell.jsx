import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserAuth } from '../context/authContext';
import { useNotifications } from '../pages/notifications/useNotifications';

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

// Bell with unread count, top right of every signed-in page (mounted once in PrivateRoute).
// Light colours on purpose (meeting feedback: no dark mode); restyle freely.
const NotificationBell = () => {
    const { session } = UserAuth();
    const navigate = useNavigate();
    const { items, unread, hasMore, latest, error, loadMore, markOneRead, markAllRead } =
        useNotifications(session?.user?.id);
    const [open, setOpen] = useState(false);
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

    const openItem = (n) => {
        markOneRead(n.id);
        setOpen(false);
        if (n.link) navigate(n.link);
    };

    const badge = unread > 99 ? '99+' : String(unread);

    return (
        <div className='fixed top-3 right-4 z-50 text-base text-gray-900'>
            <button
                ref={buttonRef}
                type='button'
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                aria-controls='notification-panel'
                aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
                className='relative rounded-full border border-gray-300 bg-white p-2 shadow-sm hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600'>
                <svg aria-hidden='true' viewBox='0 0 24 24' className='h-6 w-6' fill='none' stroke='currentColor' strokeWidth='2'>
                    <path strokeLinecap='round' strokeLinejoin='round'
                        d='M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5m6 0a3 3 0 1 1-6 0' />
                </svg>
                {unread > 0 && (
                    <span aria-hidden='true'
                        className='absolute -top-1 -right-1 min-w-6 rounded-full bg-red-700 px-1.5 text-center text-sm font-semibold leading-6 text-white'>
                        {badge}
                    </span>
                )}
            </button>

            {/* Announces new notifications to screen readers */}
            <p className='sr-only' aria-live='polite'>{latest ? `New notification: ${latest.title}` : ''}</p>

            {open && (
                <div
                    ref={panelRef}
                    id='notification-panel'
                    role='region'
                    aria-label='Notifications'
                    className='absolute right-0 mt-2 w-96 max-w-[calc(100vw-2rem)] rounded-lg border border-gray-300 bg-white shadow-lg'>
                    <div className='flex items-center justify-between border-b border-gray-200 px-4 py-3'>
                        <h2 className='text-lg font-semibold'>Notifications</h2>
                        {unread > 0 && (
                            <button type='button' onClick={markAllRead}
                                className='text-blue-800 underline hover:text-blue-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600'>
                                Mark all as read
                            </button>
                        )}
                    </div>

                    {error && <p className='px-4 py-2 text-red-700'>{error}</p>}

                    <ul className='max-h-[70vh] overflow-y-auto'>
                        {items.length === 0 && <li className='px-4 py-6 text-gray-700'>No notifications yet.</li>}
                        {items.map((n) => (
                            <li key={n.id} className='border-b border-gray-100 last:border-b-0'>
                                <button type='button' onClick={() => openItem(n)}
                                    className={`flex w-full gap-3 px-4 py-3 text-left hover:bg-gray-50 focus:outline-none focus-visible:bg-blue-50 ${n.read_at ? '' : 'bg-blue-50/60'}`}>
                                    <span aria-hidden='true'
                                        className={`mt-2 h-2.5 w-2.5 shrink-0 rounded-full ${n.read_at ? 'bg-transparent' : 'bg-blue-700'}`} />
                                    <span className='min-w-0'>
                                        {!n.read_at && <span className='sr-only'>Unread: </span>}
                                        <span className={`block ${n.read_at ? 'font-normal' : 'font-semibold'}`}>{n.title}</span>
                                        {n.body && <span className='block text-gray-700'>{n.body}</span>}
                                        <span className='block text-sm text-gray-600' title={new Date(n.created_at).toLocaleString()}>
                                            {timeAgo(n.created_at)}
                                        </span>
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>

                    {hasMore && (
                        <div className='border-t border-gray-200 px-4 py-2 text-center'>
                            <button type='button' onClick={loadMore}
                                className='text-blue-800 underline hover:text-blue-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600'>
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
