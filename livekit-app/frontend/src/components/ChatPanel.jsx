import { useState, useEffect, useRef, useCallback } from 'react';
import { useRoomContext, useLocalParticipant } from '@livekit/components-react';
import { MessageCircle, Send, Loader2 } from 'lucide-react';
import { useMeeting } from '../context/MeetingContext';
import { chatService } from '../services/api';
import { normalizeMeetingLanguageCode } from '../lib/languages';
import PanelTabs from './PanelTabs';
import { Button } from './ui/button';

const MAX_CHARS = 2000;
const URL_RE = /\bhttps?:\/\/\S+/gi;

function linkifyText(text) {
  if (!text) return null;
  const parts = [];
  let last = 0;
  const re = new RegExp(URL_RE.source, 'gi');
  let m;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      parts.push(<span key={`t-${key++}`}>{text.slice(last, m.index)}</span>);
    }
    const url = m[0];
    parts.push(
      <a
        key={`a-${key++}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="text-primary underline break-all hover:text-primary/80"
      >
        {url}
      </a>
    );
    last = m.index + url.length;
  }
  if (last < text.length) {
    parts.push(<span key={`t-${key++}`}>{text.slice(last)}</span>);
  }
  return parts.length ? parts : text;
}

function ChatPanel() {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const {
    selectedLanguage,
    participantName,
    isChatOpen,
    incrementChatUnread,
    isFullScreen,
  } = useMeeting();

  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [isAtBottom, setIsAtBottom] = useState(true);
  const scrollRef = useRef(null);
  const processedIdsRef = useRef(new Set());
  const messagesRef = useRef(messages);
  const isChatOpenRef = useRef(isChatOpen);
  const selectedLanguageRef = useRef(selectedLanguage);

  messagesRef.current = messages;
  isChatOpenRef.current = isChatOpen;
  selectedLanguageRef.current = selectedLanguage;

  const usePipMode = isFullScreen && isChatOpen;

  const translateIncoming = useCallback(async (msg, targetLang) => {
    const src = normalizeMeetingLanguageCode(msg.sourceLanguage);
    const tgt = normalizeMeetingLanguageCode(targetLang);
    if (msg.isOwn) return msg;
    if (src === tgt) {
      return {
        ...msg,
        translations: { ...msg.translations, [tgt]: msg.originalText },
        translating: false,
      };
    }
    const translated = await chatService.translate(msg.originalText, src, tgt);
    return {
      ...msg,
      translations: { ...msg.translations, [tgt]: translated },
      translating: false,
    };
  }, []);

  // Retranslate when reader changes UI language
  useEffect(() => {
    let alive = true;
    const tgt = normalizeMeetingLanguageCode(selectedLanguage);
    const list = messagesRef.current;
    if (list.length === 0) return;

    void (async () => {
      const next = await Promise.all(
        list.map(async (msg) => {
          if (!alive) return msg;
          return translateIncoming(msg, tgt);
        })
      );
      if (alive) setMessages(next);
    })();

    return () => {
      alive = false;
    };
  }, [selectedLanguage, translateIncoming]);

  useEffect(() => {
    if (!room) return;

    const handleDataReceived = (payload, participant, _kind, topic) => {
      if (topic != null && topic !== 'chat') return;
      try {
        const raw = payload instanceof Uint8Array ? payload : payload?.data ?? payload;
        if (!raw) return;
        const decoder = new TextDecoder();
        const message = JSON.parse(decoder.decode(raw));
        if (message.type !== 'chat') return;

        const id = message.id;
        if (id && processedIdsRef.current.has(id)) return;
        if (id) processedIdsRef.current.add(id);

        const senderId = message.senderId || participant?.identity || 'unknown';
        const senderName = message.senderName || participant?.name || senderId;
        const sourceLanguage = normalizeMeetingLanguageCode(message.sourceLanguage || 'en');
        const originalText = message.text || '';
        const timestamp = message.timestamp || Date.now();
        const myId = localParticipant?.identity;
        const isOwn = myId != null && senderId === myId;

        const base = {
          id: id || `msg_${Date.now()}_${Math.random()}`,
          senderId,
          senderName,
          sourceLanguage,
          originalText,
          translations: {},
          timestamp,
          isOwn,
          translating: false,
        };

        if (isOwn) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === id)) return prev;
            return [...prev, base];
          });
          return;
        }

        if (!isChatOpenRef.current) {
          incrementChatUnread();
        }

        const tgt = normalizeMeetingLanguageCode(selectedLanguageRef.current);
        const needsTranslate =
          normalizeMeetingLanguageCode(sourceLanguage) !== tgt;

        setMessages((prev) => [
          ...prev,
          { ...base, translating: needsTranslate },
        ]);

        if (!needsTranslate) return;

        void (async () => {
          const updated = await translateIncoming(
            { ...base, translating: true },
            tgt
          );
          setMessages((prev) =>
            prev.map((m) => (m.id === base.id ? updated : m))
          );
        })();
      } catch (e) {
        console.error('ChatPanel: parse error', e);
      }
    };

    room.on('dataReceived', handleDataReceived);
    return () => room.off('dataReceived', handleDataReceived);
  }, [room, localParticipant?.identity, translateIncoming, incrementChatUnread]);

  useEffect(() => {
    if (isAtBottom && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isAtBottom]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setIsAtBottom(scrollHeight - scrollTop - clientHeight < 40);
  };

  const sendMessage = async () => {
    const text = draft.trim();
    if (!text || !room?.localParticipant || text.length > MAX_CHARS) return;

    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? `msg_${crypto.randomUUID()}`
        : `msg_${Date.now()}_${Math.random()}`;

    const sourceLanguage = normalizeMeetingLanguageCode(selectedLanguage);
    const payload = {
      type: 'chat',
      id,
      senderId: room.localParticipant.identity,
      senderName: participantName || room.localParticipant.identity,
      sourceLanguage,
      text,
      timestamp: Date.now(),
    };

    processedIdsRef.current.add(id);

    const optimistic = {
      id,
      senderId: room.localParticipant.identity,
      senderName: participantName || room.localParticipant.identity,
      sourceLanguage,
      originalText: text,
      translations: {},
      timestamp: payload.timestamp,
      isOwn: true,
      translating: false,
    };

    setMessages((prev) => [...prev, optimistic]);
    setDraft('');

    try {
      const encoded = new TextEncoder().encode(JSON.stringify(payload));
      await room.localParticipant.publishData(encoded, { reliable: true, topic: 'chat' });
    } catch (e) {
      console.error('Chat publish failed', e);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const displayText = (msg) => {
    const tgt = normalizeMeetingLanguageCode(selectedLanguage);
    if (msg.isOwn) return msg.originalText;
    const t = msg.translations[tgt];
    if (t) return t;
    return msg.originalText;
  };

  const showOriginalBelow = (msg) => {
    if (msg.isOwn) return false;
    const tgt = normalizeMeetingLanguageCode(selectedLanguage);
    const src = normalizeMeetingLanguageCode(msg.sourceLanguage);
    if (src === tgt) return false;
    const shown = msg.translations[tgt] || msg.originalText;
    return shown !== msg.originalText;
  };

  if (!isChatOpen) return null;

  const panelBody = (
    <>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0"
      >
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <MessageCircle className="w-8 h-8 mb-3 opacity-50" />
            <p className="text-center text-sm">No messages yet. Say hi.</p>
          </div>
        )}
        {messages.map((msg) => {
          const primary = displayText(msg);
          const secondary = showOriginalBelow(msg) ? msg.originalText : null;
          return (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.isOwn ? 'items-end' : 'items-start'}`}
            >
              <div className="flex items-baseline gap-2 mb-1 max-w-[95%]">
                <span className="text-xs font-medium text-emerald-400 truncate">
                  {msg.isOwn ? 'You' : msg.senderName}
                </span>
                <span className="text-xs text-muted-foreground">
                  {new Date(msg.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
              <div
                className={`max-w-[95%] break-words rounded-lg border px-3 py-2 text-sm ${
                  msg.isOwn
                    ? 'border-primary/30 bg-primary/15 text-foreground'
                    : 'border-border bg-muted/60 text-foreground'
                }`}
              >
                {msg.translating && !msg.isOwn ? (
                  <span className="inline-flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Translating…
                  </span>
                ) : (
                  <>
                    <div className="leading-relaxed">{linkifyText(primary)}</div>
                    {secondary && (
                      <div className="mt-1 text-xs text-muted-foreground leading-relaxed border-t border-border/50 pt-1">
                        {linkifyText(secondary)}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex flex-shrink-0 gap-2 border-t border-border meeting-control-strip p-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, MAX_CHARS))}
          onKeyDown={onKeyDown}
          placeholder="Message…"
          rows={2}
          className="flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          maxLength={MAX_CHARS}
        />
        <Button
          type="button"
          size="icon"
          className="self-end shrink-0"
          onClick={sendMessage}
          disabled={!draft.trim()}
          aria-label="Send message"
        >
          <Send className="h-5 w-5" />
        </Button>
      </div>
    </>
  );

  if (usePipMode) {
    return (
      <div
        className="fixed bottom-20 right-4 z-[9998] flex max-h-80 w-96 flex-col rounded-xl border meeting-panel-surface backdrop-blur-md"
        data-no-translate="true"
      >
        <PanelTabs compact />
        {panelBody}
      </div>
    );
  }

  return (
    <div
      className="z-40 flex h-full w-80 max-h-[45vh] flex-shrink-0 flex-col rounded-t-xl border meeting-panel-surface fixed bottom-12 left-0 right-0 sm:static sm:bottom-auto sm:left-auto sm:right-auto sm:z-auto sm:max-h-none sm:h-full sm:w-[350px] lg:w-[400px] sm:rounded-none sm:border-l sm:border-t-0 sm:shadow-none"
      data-no-translate="true"
    >
      <PanelTabs />
      {panelBody}
    </div>
  );
}

export default ChatPanel;
