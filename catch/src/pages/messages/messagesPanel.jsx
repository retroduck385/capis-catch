import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { UserAuth } from '../../context/authContext';
import { ROLE_LABELS } from '../../roles';
import { stageLabel } from '../workTray/options';
import { MAX_LENGTH, fetchMentionCandidates } from './api';
import { jumpToTopic, registerPanel, topicLabel, topicTarget } from './topics';
import { useMessages } from './useMessages';
import { ArrowUpRight, Lock, MessageSquare, Send, X } from 'lucide-react';
import { Terms } from '../../components/term';
import { useTermTitle } from '../../components/useTermTitle';
import { avatarStyle, formatWhen, fullWhen, initialsOf, personName } from '../../components/people';
import './messages.css';

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
    // Match the clean name (what the list inserts) and the stored one (older messages)
    const mentioned = (message.mentions ?? []).flatMap((id) => [names[id], personName(names[id])].filter(Boolean).map((name) => ({ id, name })));
    if (mentioned.length === 0) return <p className='msg-body'>{message.body}</p>;
    const byName = Object.fromEntries(mentioned.map((p) => [p.name, p.id]));
    const pattern = new RegExp(`(@(?:${Object.keys(byName).sort((a, b) => b.length - a.length).map(escapeRe).join('|')}))`, 'g');
    return (
        <p className='msg-body'>
            {message.body.split(pattern).map((part, i) => {
                const id = part.startsWith('@') ? byName[part.slice(1)] : null;
                if (!id) return part;
                const me = id === userId;
                return (
                    <span key={i} className={`msg-mention${me ? ' me' : ''}`}>
                        {part}{me && <span className='sr-only'> (you)</span>}
                    </span>
                );
            })}
        </p>
    );
};

// Staff-only message thread for one loan file (F7), a drawer opened from a button beside the notification bell.
// Rendered through a portal into the app frame (.ct-e-app), so it never sits inside a page's <form> (the Financial
// Package page) but still follows the theme and dark mode. Look (DESIGN.md, "Messages"): a floating glass sheet below
// the top bar, chat bubbles (yours on the right), short times, an orange "New" divider. Styles: messages.css.
// `inline` puts the button where the component is rendered (a page's action row) instead of fixed top-right; the
// drawer is still portaled to <body>.
// @mentions: typing @ lists the staff who can open this file; a mentioned name is highlighted in the thread.
// Topics: a comment button on a page section (commentButton.jsx) opens this drawer with that section attached;
// the message then carries a chip that opens the section.
// Back to the opener if it's still on the page, else the Messages button; never scroll to it
const focusOpener = (opener, fallback) => {
    const el = opener?.isConnected && opener !== document.body ? opener : fallback;
    el?.focus({ preventScroll: true });
};

const MessagesPanel = ({ applicationId, inline = false }) => {
    const { session } = UserAuth();
    const userId = session?.user?.id;
    const navigate = useNavigate();
    const location = useLocation();
    const [open, setOpen] = useState(false);
    const tt = useTermTitle();
    const [draft, setDraft] = useState('');
    const [topic, setTopic] = useState(null);            // section this draft is about
    const [candidates, setCandidates] = useState(null);  // null = not loaded yet
    const [caret, setCaret] = useState(0);
    const [active, setActive] = useState(0);             // highlighted row of the @ list
    const [dismissed, setDismissed] = useState(false);   // Esc closed the @ list for the text as it is
    const { items, hasMore, unread, canPost, names, dividerId, latest, error, sending, loadEarlier, send } =
        useMessages(applicationId, userId, open);
    const buttonRef = useRef(null);
    const openerRef = useRef(null);                      // what had focus when the drawer opened (a comment button, or the button)
    const closeRef = useRef(null);
    const listRef = useRef(null);
    const textRef = useRef(null);
    const picked = useRef(new Set());                    // ids chosen from the @ list (tells namesakes apart)
    const listOpen = useRef(false);

    // Comment buttons on the page open this drawer with their section as the topic (only for people who can post)
    useEffect(() => {
        if (!canPost) return undefined;
        return registerPanel(applicationId, (next) => {
            openerRef.current = document.activeElement;
            setTopic(next);
            setOpen(true);
            setTimeout(() => textRef.current?.focus(), 0);
        });
    }, [applicationId, canPost]);

    // Arriving from a topic chip (or a link with #section): go to that section once the page has it
    useEffect(() => {
        if (location.hash) jumpToTopic(decodeURIComponent(location.hash.slice(1)));
    }, [location.hash, location.pathname]);

    // Arriving from a message notification (openMessages in router state): open the drawer and clear the flag
    useEffect(() => {
        if (!location.state?.openMessages) return;
        window.history.replaceState({ ...window.history.state, usr: { ...window.history.state?.usr, openMessages: false } }, '');
        const t = setTimeout(() => setOpen(true), 0);
        return () => clearTimeout(t);
    }, [location.state?.openMessages]);

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

    // Closing returns focus to where the reader was (the comment button they used, else the Messages button) without
    // scrolling: focusing the header button used to jump the page back to the top
    const restoreFocus = () => focusOpener(openerRef.current, buttonRef.current);

    // Esc closes and returns focus to the opener (the @ list takes Esc first)
    useEffect(() => {
        if (!open) return;
        const onKey = (e) => {
            if (e.key !== 'Escape' || listOpen.current) return;
            setOpen(false);
            focusOpener(openerRef.current, buttonRef.current);
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
        const inserted = `@${personName(person.name) || person.name} `;
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
        const short = (c) => personName(c.name) || c.name;
        const named = (candidates ?? []).filter((c) => body.includes(`@${c.name}`) || body.includes(`@${short(c)}`));
        return named.filter((c) => picked.current.has(c.user_id)
            || !named.some((o) => short(o) === short(c) && picked.current.has(o.user_id))).map((c) => c.user_id);
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
    const closeDrawer = () => { setOpen(false); restoreFocus(); };

    const button = (
        <button
            ref={buttonRef}
            type='button'
            onClick={() => { openerRef.current = buttonRef.current; setOpen((o) => !o); }}
            aria-expanded={open}
            aria-controls='messages-panel'
            aria-label={label}
            className={inline
                ? 'lf-btn'
                : 'fixed top-3 right-16 z-50 flex items-center gap-2 rounded-full border border-gray-300 bg-white p-2 shadow-sm hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 sm:px-4'}>
            <MessageSquare size={inline ? 18 : 22} aria-hidden='true' className='shrink-0' />
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

    // Inside the app frame (so it follows the theme and dark mode), not in a page's <form>
    const host = document.querySelector('.ct-e-app') ?? document.body;
    const drawer = createPortal(
        <div className='msg-host'>
            {!inline && button}

            {/* Announces new messages to screen readers */}
            <p className='sr-only' aria-live='polite'>{latest ? 'New message on this application' : ''}</p>

            {open && (
                <aside id='messages-panel' aria-label='Messages for this application' className='msg-drawer'>
                    <header className='msg-head'>
                        <span className='msg-ic' aria-hidden='true'><MessageSquare size={18} /></span>
                        <div className='msg-title'>
                            <h2>Messages</h2>
                            <p>Staff only · this application</p>
                        </div>
                        <button ref={closeRef} type='button' className='msg-close' onClick={closeDrawer} aria-label='Close messages' title='Close (Esc)'>
                            <X size={18} aria-hidden='true' />
                        </button>
                    </header>

                    <div ref={listRef} className='msg-list' tabIndex={0} aria-label='Message history'>
                        {hasMore && (
                            <p className='msg-more'>
                                <button type='button' className='msg-pill' onClick={loadEarlier}>Load earlier</button>
                            </p>
                        )}
                        {items.length === 0 && (
                            <div className='msg-empty'>
                                <span className='msg-ic' aria-hidden='true'><MessageSquare size={20} /></span>
                                <p className='msg-empty-title'>No messages yet</p>
                                {canPost && <p>Start the conversation below. Type @ to mention someone.</p>}
                            </div>
                        )}
                        <ul className='msg-items'>
                            {items.map((m) => {
                                const mine = m.sender_id === userId;
                                const who = mine ? 'You' : personName(names[m.sender_id]) || 'Staff';
                                return (
                                    <li key={m.id} className={`msg-item${mine ? ' mine' : ''}`}>
                                        {m.id === firstNewId && <p className='msg-new'><span>New</span></p>}
                                        <div className='msg-row'>
                                            {!mine && <span className='msg-av' style={avatarStyle(who)} aria-hidden='true'>{initialsOf(who)}</span>}
                                            <div className='msg-bubble'>
                                                <p className='msg-meta'>
                                                    <b>{who}</b>
                                                    <span className='msg-role'>{ROLE_LABELS[m.sender_role] ?? m.sender_role}</span>
                                                    {m.stage && <span className='msg-stage'>{stageLabel(m.stage)}</span>}
                                                </p>
                                                {m.topic && topicLabel(m.topic) && (
                                                    <button type='button' className='msg-topic-link' onClick={() => goToTopic(m.topic)}
                                                        title={['Go to this section', tt(topicLabel(m.topic))].filter(Boolean).join('\n')}>
                                                        <span className='sr-only'>About </span>{topicLabel(m.topic)}
                                                        <ArrowUpRight size={14} aria-hidden='true' />
                                                    </button>
                                                )}
                                                <Body message={m} names={names} userId={userId} />
                                                <time className='msg-time' dateTime={m.created_at} title={fullWhen(m.created_at)}>{formatWhen(m.created_at)}</time>
                                            </div>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>

                    <div className='msg-compose'>
                        {error && <p role='alert' className='msg-err'>{error}</p>}
                        {canPost ? (
                            <>
                                <label htmlFor='message-text' className='msg-label'>Write a message</label>
                                {topic && (
                                    <p className='msg-topic'>
                                        <span className='msg-topic-chip'>About: <Terms text={topicLabel(topic)} /></span>
                                        <button type='button' className='msg-x' onClick={() => setTopic(null)} aria-label='Remove the section from this message'>
                                            <X size={14} aria-hidden='true' />
                                        </button>
                                    </p>
                                )}
                                <div className='msg-field'>
                                    {showList && (
                                        <ul id='mention-list' role='listbox' aria-label='People you can mention' className='msg-mentions'>
                                            {matches.map((c, i) => (
                                                <li key={c.user_id} id={`mention-${c.user_id}`} role='option' aria-selected={i === activeRow}
                                                    // mousedown, not click: keep the focus in the text box
                                                    onMouseDown={(e) => { e.preventDefault(); pick(c); }}
                                                    onMouseEnter={() => setActive(i)}
                                                    className={i === activeRow ? 'hi' : undefined}>
                                                    <span className='msg-av small' style={avatarStyle(personName(c.name))} aria-hidden='true'>{initialsOf(personName(c.name))}</span>
                                                    <span className='msg-mention-name'>{personName(c.name) || c.name}</span>
                                                    <span className='msg-role'>{ROLE_LABELS[c.role] ?? c.role}</span>
                                                    {c.on_file && <span className='msg-onfile'>On this file</span>}
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                    <textarea
                                        id='message-text'
                                        ref={textRef}
                                        className='msg-input'
                                        value={draft}
                                        onChange={onDraft}
                                        onKeyDown={onKeyDown}
                                        onKeyUp={onCaret}
                                        onClick={onCaret}
                                        maxLength={MAX_LENGTH}
                                        rows={3}
                                        placeholder='Message the team on this file'
                                        role='combobox'
                                        aria-expanded={showList}
                                        aria-controls='mention-list'
                                        aria-autocomplete='list'
                                        aria-activedescendant={showList ? `mention-${matches[activeRow].user_id}` : undefined}
                                        aria-describedby='message-hint' />
                                </div>
                                <div className='msg-foot'>
                                    <span id='message-hint' className='msg-hint'>
                                        <span className='msg-countnum'>{draft.length} / {MAX_LENGTH}</span>
                                        <span>@ to mention · Ctrl+Enter sends · can&apos;t be edited or deleted</span>
                                    </span>
                                    <button type='button' className='msg-send' onClick={submit} disabled={sending || !draft.trim()}>
                                        <Send size={16} aria-hidden='true' />{sending ? 'Sending...' : 'Send'}
                                    </button>
                                </div>
                            </>
                        ) : (
                            <p className='msg-readonly'><Lock size={15} aria-hidden='true' />Read-only: only people working on this file can post.</p>
                        )}
                    </div>
                </aside>
            )}
        </div>,
        host,
    );

    return inline ? <>{button}{drawer}</> : drawer;
};

export default MessagesPanel;
