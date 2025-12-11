import { useState, useEffect, useRef } from "react";
import {
  getUserMessages,
  sendMessageToUser,
  buildSSEUrl,
  type AdminBotMessage,
} from "../api/client";
import "./UserChat.css";

interface Props {
  telegramId: number;
  userName: string;
  onClose: () => void;
}

export function UserChat({ telegramId, userName, onClose }: Props) {
  const [messages, setMessages] = useState<AdminBotMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [inputText, setInputText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Initial fetch
  useEffect(() => {
    let isMounted = true;

    async function fetchMessages() {
      try {
        const data = await getUserMessages(telegramId, { limit: 100 });
        if (isMounted) {
          // Reverse to show oldest first (chat order)
          setMessages(data.items.reverse());
          setLoading(false);
        }
      } catch (e) {
        console.error("Failed to fetch messages", e);
        if (isMounted) setLoading(false);
      }
    }

    fetchMessages();

    return () => {
      isMounted = false;
    };
  }, [telegramId]);

  // SSE subscription for new messages
  useEffect(() => {
    const sseUrl = buildSSEUrl(`/api/admin/users/${telegramId}/messages/stream`);
    const eventSource = new EventSource(sseUrl);

    eventSource.addEventListener("new_message", (event) => {
      const msg: AdminBotMessage = JSON.parse(event.data);
      setMessages((prev) => [...prev, msg]);
    });

    eventSource.onerror = (e) => {
      console.error("[SSE] Chat stream error", e);
    };

    return () => {
      eventSource.close();
    };
  }, [telegramId]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || sending) return;

    setSending(true);
    try {
      await sendMessageToUser(telegramId, text);

      // Optimistic update (SSE will confirm)
      const optimisticMsg: AdminBotMessage = {
        id: Date.now(),
        direction: "outgoing",
        message_type: "text",
        text,
        command: null,
        callback_data: null,
        created_at: Math.floor(Date.now() / 1000),
      };
      setMessages((prev) => [...prev, optimisticMsg]);
      setInputText("");
    } catch (e) {
      console.error("Failed to send message", e);
      alert("Failed to send message");
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    return date.toLocaleDateString();
  };

  // Group messages by date
  const groupedMessages: { date: string; messages: AdminBotMessage[] }[] = [];
  let currentDate = "";

  for (const msg of messages) {
    const date = formatDate(msg.created_at);
    if (date !== currentDate) {
      currentDate = date;
      groupedMessages.push({ date, messages: [] });
    }
    groupedMessages[groupedMessages.length - 1].messages.push(msg);
  }

  if (loading) {
    return (
      <div className="user-chat">
        <div className="user-chat-header">
          <button className="back-btn" onClick={onClose}>
            <span className="back-icon">&#8592;</span>
          </button>
          <span className="user-name">{userName}</span>
        </div>
        <div className="user-chat-loading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="user-chat">
      <div className="user-chat-header">
        <button className="back-btn" onClick={onClose}>
          <span className="back-icon">&#8592;</span>
        </button>
        <span className="user-name">{userName}</span>
        <span className="user-id">ID: {telegramId}</span>
      </div>

      <div className="user-chat-messages">
        {groupedMessages.length === 0 ? (
          <div className="no-messages">No messages yet</div>
        ) : (
          groupedMessages.map((group) => (
            <div key={group.date}>
              <div className="date-separator">
                <span>{group.date}</span>
              </div>
              {group.messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`message ${msg.direction === "incoming" ? "incoming" : "outgoing"}`}
                >
                  <div className="message-content">
                    {msg.text || msg.callback_data || "[no text]"}
                  </div>
                  <div className="message-meta">
                    <span className="message-type">{msg.message_type}</span>
                    <span className="message-time">{formatTime(msg.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="user-chat-input">
        <textarea
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          disabled={sending}
          rows={1}
        />
        <button
          className="send-btn"
          onClick={handleSend}
          disabled={!inputText.trim() || sending}
        >
          {sending ? "..." : "Send"}
        </button>
      </div>
    </div>
  );
}
