import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { UserAuth } from '../../context/authContext';
import { ROLE_LABELS } from '../../roles';
import { stageLabel } from '../workTray/options';
import { MAX_LENGTH } from './api';
import { useMessages } from './useMessages';

// Staff-only message thread for one loan file (F7), a drawer opened from a button beside the notification bell.
// Rendered through a portal into <body>, so it never sits inside a page's <form> (the Financial Package page).
// Light colours on purpose (no dark mode). The button is fixed top-right, left of the bell (bell: top-3 right-4, 40px
// wide); below the sm breakpoint it shrinks to an icon so both fit a narrow screen.
const MessagesPanel = ({ applicationId }) => {
    const { session } = UserAuth();
    const userId = session?.user?.id;
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState('');
    const { items, hasMore, unread, canPost, names, dividerId, latest, error, sending, loadEarlier, send } =
        useMessages(applicationId, userId, open);
    const buttonRef = useRef(null);
    const closeRef = useRef(null);
    const listRef = useRef(null);
    const textRef = useRef(null);

    // Esc closes and returns focus to the button
    useEffect(() => {
        if (!open) return;
        const onKey = (e) => {
            if (e.key === 'Escape') { setOpen(false); buttonRef.current?.focus(); }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [open]);

    // Move focus into the drawer when it opens
    useEffect(() => {
        if (open) (textRef.current ?? closeRef.current)?.focus();
    }, [open, canPost]);

    // Newest at the bottom: scroll there on open and when a message arrives (unless the reader scrolled up)
    useEffect(() => {
        const el = listRef.current;
        if (!open || !el) return;
        const mine = items.at(-1)?.sender_id === userId;
        const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        if (mine || nearBottom || el.scrollTop === 0) el.scrollTop = el.scrollHeight;
    }, [open, items, userId]);

    const submit = async () => {
        const body = draft.trim();
        if (!body || sending) return;
        if (await send(body)) { setDraft(''); textRef.current?.focus(); }
    };

    const onKeyDown = (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); }
    };

    const firstNewId = items.find((m) => m.id > dividerId && m.sender_id !== userId)?.id;
    const label = unread ? `Messages, ${unread} unread` : 'Messages';
    const badge = unread > 99 ? '99+' : String(unread);

    return createPortal(
        <div className='text-base text-gray-900'>
            <button
                ref={buttonRef}
                type='button'
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                aria-controls='messages-panel'
                aria-label={label}
                className='fixed top-3 right-16 z-50 flex items-center gap-2 rounded-full border border-gray-300 bg-white p-2 shadow-sm hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 sm:px-4'>
                <svg aria-hidden='true' viewBox='0 0 24 24' className='h-6 w-6 shrink-0' fill='none' stroke='currentColor' strokeWidth='2'>
                    <path strokeLinecap='round' strokeLinejoin='round'
                        d='M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z' />
                </svg>
                <span className='hidden sm:inline'>Messages</span>
                {unread > 0 && (
                    <span aria-hidden='true'
                        className='absolute -top-1 -right-1 min-w-6 rounded-full bg-red-700 px-1.5 text-center text-sm font-semibold leading-6 text-white'>
                        {badge}
                    </span>
                )}
            </button>

            {/* Announces new messages to screen readers */}
            <p className='sr-only' aria-live='polite'>{latest ? 'New message on this application' : ''}</p>

            {open && (
                <aside
                    id='messages-panel'
                    aria-label='Messages for this application'
                    className='fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-gray-300 bg-white text-gray-900 shadow-lg'>
                    <div className='flex items-center justify-between border-b border-gray-200 py-3 pl-4 pr-28 sm:pr-52'>
                        <h2 className='text-lg font-semibold text-gray-900!'>Messages</h2>
                        <button ref={closeRef} type='button' onClick={() => { setOpen(false); buttonRef.current?.focus(); }}
                            className='rounded border border-gray-300 px-3 py-1 text-blue-800 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600'>
                            Close
                        </button>
                    </div>

                    <div ref={listRef} className='min-h-0 flex-1 overflow-y-auto px-4 py-3' tabIndex={0} aria-label='Message history'>
                        {hasMore && (
                            <p className='pb-2 text-center'>
                                <button type='button' onClick={loadEarlier}
                                    className='text-blue-800 underline hover:text-blue-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600'>
                                    Load earlier
                                </button>
                            </p>
                        )}
                        {items.length === 0 && <p className='py-6 text-gray-700'>No messages yet.</p>}
                        <ul>
                            {items.map((m) => (
                                <li key={m.id} className='pb-3'>
                                    {m.id === firstNewId && (
                                        <p className='mb-2 flex items-center gap-2 font-semibold text-red-800'>
                                            <span aria-hidden='true' className='h-px flex-1 bg-red-300' />
                                            New
                                            <span aria-hidden='true' className='h-px flex-1 bg-red-300' />
                                        </p>
                                    )}
                                    <div className={`rounded-lg border px-3 py-2 ${m.sender_id === userId ? 'border-blue-200 bg-blue-50' : 'border-gray-200 bg-gray-50'}`}>
                                        <p className='flex flex-wrap items-baseline gap-x-2'>
                                            <span className='font-semibold'>{m.sender_id === userId ? 'You' : (names[m.sender_id] ?? 'Staff')}</span>
                                            <span className='rounded border border-gray-400 px-1.5 text-sm text-gray-800'>{ROLE_LABELS[m.sender_role] ?? m.sender_role}</span>
                                            {m.stage && <span className='text-sm text-gray-700'>{stageLabel(m.stage)}</span>}
                                        </p>
                                        <p className='whitespace-pre-wrap break-words'>{m.body}</p>
                                        <p className='text-sm text-gray-600'>{new Date(m.created_at).toLocaleString()}</p>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </div>

                    <div className='border-t border-gray-200 px-4 py-3'>
                        {error && <p role='alert' className='pb-2 text-red-700'>{error}</p>}
                        {canPost ? (
                            <>
                                <label htmlFor='message-text' className='block pb-1 font-semibold'>Write a message</label>
                                <textarea
                                    id='message-text'
                                    ref={textRef}
                                    value={draft}
                                    onChange={(e) => setDraft(e.target.value)}
                                    onKeyDown={onKeyDown}
                                    maxLength={MAX_LENGTH}
                                    rows={3}
                                    aria-describedby='message-hint'
                                    className='w-full rounded border border-gray-400 bg-white p-2 text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600' />
                                <div className='flex items-center justify-between gap-3 pt-1'>
                                    <span id='message-hint' className='text-sm text-gray-700'>
                                        {draft.length} / {MAX_LENGTH}. Ctrl+Enter sends. Messages can't be edited or deleted.
                                    </span>
                                    <button type='button' onClick={submit} disabled={sending || !draft.trim()}
                                        className='shrink-0 rounded bg-blue-800 px-4 py-1.5 text-white hover:bg-blue-900 disabled:bg-gray-300 disabled:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2'>
                                        {sending ? 'Sending...' : 'Send'}
                                    </button>
                                </div>
                            </>
                        ) : (
                            <p className='italic text-gray-700'>Read-only: only people working on this file can post.</p>
                        )}
                    </div>
                </aside>
            )}
        </div>,
        document.body,
    );
};

export default MessagesPanel;
