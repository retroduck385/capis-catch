import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { UserAuth } from '../../context/authContext';
import { ROLE_LABELS } from '../../roles';
import { stageLabel } from '../workTray/options';
import { MAX_LENGTH, fetchMentionCandidates } from './api';
import { jumpToTopic, registerPanel, topicLabel, topicTarget } from './topics';
import { useMessages } from './useMessages';
import { Terms } from '../../components/term';

// The "@na" being typed right before the caret, or null. Names have spaces, so the query runs from the last @
// (at the start or after a space) to the caret, on one line.
const mentionQuery = (text, caret) => {
    const at = text.lastIndexOf('@', caret - 1);
    if (at < 0 || (at > 0 && !/\s/.test(text[at - 1]))) return null;
    const query = text.slice(at + 1, caret);
    if (query.length > 40 || /[\n@]/.test(query)) return null;
    return { at, query };
};

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The message text with each mentioned "@Name" highlighted (a mention of me stands out more)
const Body = ({ message, names, userId }) => {
    const mentioned = (message.mentions ?? []).map((id) => ({ id, name: names[id] })).filter((p) => p.name);
    if (mentioned.length === 0) return <p className='whitespace-pre-wrap break-words'>{message.body}</p>;
    const byName = Object.fromEntries(mentioned.map((p) => [p.name, p.id]));
    const pattern = new RegExp(`(@(?:${Object.keys(byName).sort((a, b) => b.length - a.length).map(escapeRe).join('|')}))`, 'g');
    return (
        <p className='whitespace-pre-wrap break-words'>
            {message.body.split(pattern).map((part, i) => {
                const id = part.startsWith('@') ? byName[part.slice(1)] : null;
                if (!id) return part;
                const me = id === userId;
                return (
                    <span key={i} className={`rounded px-1 font-semibold ${me ? 'bg-amber-200 text-amber-950' : 'bg-blue-100 text-blue-900'}`}>
                        {part}{me && <span className='sr-only'> (you)</span>}
                    </span>
                );
            })}
        </p>
    );
};

// Staff-only message thread for one loan file (F7), a drawer opened from a button beside the notification bell.
// Rendered through a portal into <body>, so it never sits inside a page's <form> (the Financial Package page).
// Light colours on purpose (no dark mode). The button is fixed top-right, left of the bell (bell: top-3 right-4, 40px
// wide); below the sm breakpoint it shrinks to an icon so both fit a narrow screen.
// `inline` puts the button where the component is rendered (a page's action row) instead of fixed top-right; the
// drawer is still portaled to <body>.
// @mentions: typing @ lists the staff who can open this file; a mentioned name is highlighted in the thread.
// Topics: a comment button on a page section (commentButton.jsx) opens this drawer with that section attached;
// the message then carries a chip that opens the section.
const MessagesPanel = ({ applicationId, inline = false }) => {
    const { session } = UserAuth();
    const userId = session?.user?.id;
    const navigate = useNavigate();
    const location = useLocation();
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState('');
    const [topic, setTopic] = useState(null);            // section this draft is about
    const [candidates, setCandidates] = useState(null);  // null = not loaded yet
    const [caret, setCaret] = useState(0);
    const [active, setActive] = useState(0);             // highlighted row of the @ list
    const [dismissed, setDismissed] = useState(false);   // Esc closed the @ list for the text as it is
    const { items, hasMore, unread, canPost, names, dividerId, latest, error, sending, loadEarlier, send } =
        useMessages(applicationId, userId, open);
    const buttonRef = useRef(null);
    const closeRef = useRef(null);
    const listRef = useRef(null);
    const textRef = useRef(null);
    const picked = useRef(new Set());                    // ids chosen from the @ list (tells namesakes apart)
    const listOpen = useRef(false);

    // Comment buttons on the page open this drawer with their section as the topic (only for people who can post)
    useEffect(() => {
        if (!canPost) return undefined;
        return registerPanel(applicationId, (next) => {
            setTopic(next);
            setOpen(true);
            setTimeout(() => textRef.current?.focus(), 0);
        });
    }, [applicationId, canPost]);

    // Arriving from a topic chip (or a link with #section): go to that section once the page has it
    useEffect(() => {
        if (location.hash) jumpToTopic(decodeURIComponent(location.hash.slice(1)));
    }, [location.hash, location.pathname]);

    // The @ list's people, loaded the first time the drawer opens
    useEffect(() => {
        if (!open || !canPost || candidates) return;
        let cancelled = false;
        fetchMentionCandidates(applicationId)
            .then((rows) => { if (!cancelled) setCandidates(rows); })
            .catch(() => { if (!cancelled) setCandidates([]); });
        return () => { cancelled = true; };
    }, [open, canPost, candidates, applicationId]);

    const mention = useMemo(() => (dismissed ? null : mentionQuery(draft, caret)), [draft, caret, dismissed]);
    const matches = useMemo(() => {
        if (!mention || !candidates) return [];
        const q = mention.query.toLowerCase();
        return candidates.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 8);
    }, [mention, candidates]);
    const showList = matches.length > 0;
    const activeRow = Math.min(active, Math.max(matches.length - 1, 0));
    useEffect(() => { listOpen.current = showList; }, [showList]);

    // Esc closes and returns focus to the button (the @ list takes Esc first)
    useEffect(() => {
        if (!open) return;
        const onKey = (e) => {
            if (e.key !== 'Escape' || listOpen.current) return;
            setOpen(false);
            buttonRef.current?.focus();
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

    const onDraft = (e) => {
        setDraft(e.target.value);
        setCaret(e.target.selectionStart);
        setDismissed(false);
        setActive(0);
    };
    const onCaret = (e) => setCaret(e.target.selectionStart);

    // Replace the "@na" being typed with "@Full Name "
    const pick = (person) => {
        if (!mention) return;
        const before = draft.slice(0, mention.at);
        const after = draft.slice(caret);
        const inserted = `@${person.name} `;
        const next = (before + inserted + after).slice(0, MAX_LENGTH);
        picked.current.add(person.user_id);
        setDraft(next);
        const at = Math.min(before.length + inserted.length, next.length);
        setCaret(at);
        setActive(0);
        setTimeout(() => { textRef.current?.focus(); textRef.current?.setSelectionRange(at, at); }, 0);
    };

    // Everyone whose "@Name" is in the text; with two people of the same name, the one picked from the list
    const mentionsIn = (body) => {
        const named = (candidates ?? []).filter((c) => body.includes(`@${c.name}`));
        return named.filter((c) => picked.current.has(c.user_id)
            || !named.some((o) => o.name === c.name && picked.current.has(o.user_id))).map((c) => c.user_id);
    };

    const submit = async () => {
        const body = draft.trim();
        if (!body || sending) return;
        if (await send(body, mentionsIn(body), topic)) {
            setDraft(''); setTopic(null); setCaret(0); picked.current = new Set();
            textRef.current?.focus();
        }
    };

    const onKeyDown = (e) => {
        if (showList) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((activeRow + 1) % matches.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((activeRow - 1 + matches.length) % matches.length); return; }
            if ((e.key === 'Enter' && !e.ctrlKey && !e.metaKey) || e.key === 'Tab') { e.preventDefault(); pick(matches[activeRow]); return; }
            if (e.key === 'Escape') { e.preventDefault(); setDismissed(true); return; }
        }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); }
    };

    // A topic chip: go to that section, on this page or another one
    const goToTopic = (key) => {
        const target = topicTarget(key, applicationId);
        if (!target) return;
        if (window.innerWidth < 768) setOpen(false); // the drawer would cover the section
        if (location.pathname === target.pathname) {
            navigate(`${location.pathname}${location.search}#${key}`, { replace: true });
            jumpToTopic(key);
        } else {
            navigate(target.path);
        }
    };

    const firstNewId = items.find((m) => m.id > dividerId && m.sender_id !== userId)?.id;
    const label = unread ? `Messages, ${unread} unread` : 'Messages';
    const badge = unread > 99 ? '99+' : String(unread);

    const button = (
        <button
            ref={buttonRef}
            type='button'
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls='messages-panel'
            aria-label={label}
            className={inline
                ? 'lf-btn'
                : 'fixed top-3 right-16 z-50 flex items-center gap-2 rounded-full border border-gray-300 bg-white p-2 shadow-sm hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 sm:px-4'}>
            <svg aria-hidden='true' viewBox='0 0 24 24' className={inline ? 'h-5 w-5 shrink-0' : 'h-6 w-6 shrink-0'} fill='none' stroke='currentColor' strokeWidth='2'>
                <path strokeLinecap='round' strokeLinejoin='round'
                    d='M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z' />
            </svg>
            <span className={inline ? '' : 'hidden sm:inline'}>Messages</span>
            {unread > 0 && (
                <span aria-hidden='true'
                    className={inline
                        ? 'count'
                        : 'absolute -top-1 -right-1 min-w-6 rounded-full bg-red-700 px-1.5 text-center text-sm font-semibold leading-6 text-white'}>
                    {badge}
                </span>
            )}
        </button>
    );

    const drawer = createPortal(
        <div className='text-base text-gray-900'>
            {!inline && button}

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
                                        {m.topic && topicLabel(m.topic) && (
                                            <p className='py-1'>
                                                <button type='button' onClick={() => goToTopic(m.topic)}
                                                    title='Go to this section'
                                                    className='max-w-full truncate rounded-full border border-blue-300 bg-white px-2.5 py-0.5 text-left text-sm font-semibold text-blue-900 hover:bg-blue-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600'>
                                                    <span className='sr-only'>About </span>{topicLabel(m.topic)}<span aria-hidden='true'> ›</span>
                                                </button>
                                            </p>
                                        )}
                                        <Body message={m} names={names} userId={userId} />
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
                                {topic && (
                                    <p className='flex items-center gap-2 pb-1 text-sm'>
                                        <span className='min-w-0 truncate rounded-full border border-blue-300 bg-blue-50 px-2.5 py-0.5 font-semibold text-blue-900'>
                                            About: <Terms text={topicLabel(topic)} />
                                        </span>
                                        <button type='button' onClick={() => setTopic(null)}
                                            className='shrink-0 text-blue-800 underline hover:text-blue-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600'>
                                            Remove
                                        </button>
                                    </p>
                                )}
                                <div className='relative'>
                                    {showList && (
                                        <ul id='mention-list' role='listbox' aria-label='People you can mention'
                                            className='absolute bottom-full left-0 z-10 mb-1 max-h-64 w-full overflow-y-auto rounded border border-gray-400 bg-white shadow-lg'>
                                            {matches.map((c, i) => (
                                                <li key={c.user_id} id={`mention-${c.user_id}`} role='option' aria-selected={i === activeRow}
                                                    // mousedown, not click: keep the focus in the text box
                                                    onMouseDown={(e) => { e.preventDefault(); pick(c); }}
                                                    onMouseEnter={() => setActive(i)}
                                                    className={`flex cursor-pointer flex-wrap items-baseline gap-x-2 px-3 py-1.5 ${i === activeRow ? 'bg-blue-100' : ''}`}>
                                                    <span className='font-semibold'>{c.name}</span>
                                                    <span className='text-sm text-gray-700'>{ROLE_LABELS[c.role] ?? c.role}</span>
                                                    {c.on_file && <span className='rounded border border-green-700 px-1 text-xs text-green-800'>On this file</span>}
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                    <textarea
                                        id='message-text'
                                        ref={textRef}
                                        value={draft}
                                        onChange={onDraft}
                                        onKeyDown={onKeyDown}
                                        onKeyUp={onCaret}
                                        onClick={onCaret}
                                        maxLength={MAX_LENGTH}
                                        rows={3}
                                        role='combobox'
                                        aria-expanded={showList}
                                        aria-controls='mention-list'
                                        aria-autocomplete='list'
                                        aria-activedescendant={showList ? `mention-${matches[activeRow].user_id}` : undefined}
                                        aria-describedby='message-hint'
                                        className='w-full rounded border border-gray-400 bg-white p-2 text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600' />
                                </div>
                                <div className='flex items-center justify-between gap-3 pt-1'>
                                    <span id='message-hint' className='text-sm text-gray-700'>
                                        {draft.length} / {MAX_LENGTH}. Type @ to mention someone. Ctrl+Enter sends. Messages can't be edited or deleted.
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

    return inline ? <>{button}{drawer}</> : drawer;
};

export default MessagesPanel;
