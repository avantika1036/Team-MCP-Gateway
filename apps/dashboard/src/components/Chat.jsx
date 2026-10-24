import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import Toast from './Toast.jsx';

const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
  );

function renderInlineMarkdown(value) {
  let text = escapeHtml(value);
  const codeSpans = [];
  text = text.replace(/`([^`\n]+)`/g, (_match, code) => {
    const token = `\u0000CODE${codeSpans.length}\u0000`;
    codeSpans.push(`<code>${code}</code>`);
    return token;
  });
  text = text.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
  );
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*(\S(?:.*?\S)?)\*/g, '<em>$1</em>');
  return text.replace(/\u0000CODE(\d+)\u0000/g, (_match, index) => codeSpans[Number(index)] || '');
}

function renderMarkdown(source) {
  const lines = String(source ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const output = [];
  const lists = [];
  let paragraph = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      output.push(`<p>${renderInlineMarkdown(paragraph.join(' '))}</p>`);
      paragraph = [];
    }
  };
  const closeLists = () => {
    while (lists.length) {
      const list = lists.pop();
      if (list.itemOpen) output.push('</li>');
      output.push(`</${list.type}>`);
    }
  };
  const listMarker = (line) => {
    const match = line.match(/^(\s*)([-+*]|\d+[.)])\s+(.*)$/);
    if (!match) return null;
    return {
      indent: match[1].replace(/\t/g, '  ').length,
      type: /^\d/.test(match[2]) ? 'ol' : 'ul',
      content: match[3],
    };
  };
  const tableCells = (line) =>
    line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => cell.trim());
  const isTableSeparator = (line) => {
    const cells = tableCells(line);
    return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      continue;
    }

    if (trimmed.startsWith('```')) {
      flushParagraph();
      closeLists();
      const code = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        code.push(lines[i]);
        i += 1;
      }
      output.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    if (lines[i + 1] && isTableSeparator(lines[i + 1])) {
      flushParagraph();
      closeLists();
      const headerCells = tableCells(trimmed);
      output.push('<table><thead><tr>');
      output.push(headerCells.map((cell) => `<th>${renderInlineMarkdown(cell)}</th>`).join(''));
      output.push('</tr></thead><tbody>');
      i += 2;
      while (i < lines.length && lines[i].trim().includes('|') && lines[i].trim()) {
        const cells = tableCells(lines[i]);
        output.push('<tr>');
        output.push(
          headerCells
            .map((_, index) => `<td>${renderInlineMarkdown(cells[index] || '')}</td>`)
            .join(''),
        );
        output.push('</tr>');
        i += 1;
      }
      output.push('</tbody></table>');
      i -= 1;
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeLists();
      const level = heading[1].length;
      output.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    if (/^(---+|\*\*\*+|___+)$/.test(trimmed)) {
      flushParagraph();
      closeLists();
      output.push('<hr>');
      continue;
    }
    if (trimmed.startsWith('>')) {
      flushParagraph();
      closeLists();
      output.push(`<blockquote>${renderInlineMarkdown(trimmed.replace(/^>\s?/, ''))}</blockquote>`);
      continue;
    }

    const marker = listMarker(line);
    if (marker) {
      flushParagraph();
      const depth = Math.ceil(marker.indent / 4);
      while (lists.length > depth + 1) {
        const list = lists.pop();
        if (list.itemOpen) output.push('</li>');
        output.push(`</${list.type}>`);
      }
      while (lists.length < depth + 1) {
        const list = { type: marker.type, itemOpen: false };
        output.push(`<${list.type}>`);
        lists.push(list);
      }
      let current = lists[lists.length - 1];
      if (current.type !== marker.type) {
        if (current.itemOpen) output.push('</li>');
        output.push(`</${current.type}>`);
        lists.pop();
        output.push(`<${marker.type}>`);
        current = { type: marker.type, itemOpen: false };
        lists.push(current);
      }
      if (current.itemOpen) output.push('</li>');
      output.push(`<li>${renderInlineMarkdown(marker.content)}`);
      current.itemOpen = true;
      continue;
    }

    if (lists.length && /^\s{2,}/.test(line)) {
      output.push(`<br>${renderInlineMarkdown(trimmed)}`);
      continue;
    }
    closeLists();
    paragraph.push(trimmed);
  }

  flushParagraph();
  closeLists();
  return output.join('');
}

export default function Chat() {
  const { user, logout, api } = useAuth();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isBusy]);

  const sendMessage = async (text) => {
    const content = text.trim();
    if (!content || isBusy) return;

    const userMessage = { role: 'user', content };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput('');
    setIsBusy(true);

    try {
      const history = nextMessages
        .filter((message) => message.role === 'user' || message.role === 'assistant')
        .slice(-12)
        .map(({ role, content: msgContent }) => ({ role, content: msgContent }));

      const result = await api('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ messages: history }),
      });

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: result.reply || 'No response was returned.',
          toolCalls: result.toolCalls || [],
        },
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `I couldn't complete that request: ${error.message}`,
        },
      ]);
      setToast({ message: error.message, bad: true });
    } finally {
      setIsBusy(false);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input);
    }
  };

  const isStandalone = window.location.pathname.startsWith('/chat');

  return (
    <>
      {isStandalone && (
        <header className="topbar chat-topbar">
          <div className="brand">
            <div className="mark">U</div>
            <div>
              <strong>URUMI · CHAT AGENT</strong>
              <small>Authenticated MCP operations assistant</small>
            </div>
          </div>
          <div className="top-actions">
            {user?.role === 'admin' ? (
              <a href="/dashboard/" className="btn ghost">
                Admin console ↗
              </a>
            ) : (
              <a href="/dashboard/" className="btn ghost" onClick={(e) => {
                e.preventDefault();
                logout();
                window.location.href = '/dashboard/';
              }}>
                Admin console ↗
              </a>
            )}
            <button id="signOutBtn" className={`btn ghost ${user ? '' : 'hidden'}`} type="button" onClick={logout}>
              Sign out
            </button>
          </div>
        </header>
      )}

      <main className="chat-main" style={isStandalone ? {} : { margin: '0', width: '100%' }}>
        <div className="hero">
          <div>
            <div className="eyebrow">Gateway-connected assistant</div>
            <h1>How can I help?</h1>
            <p>Ask questions about your store, products, orders, or other connected MCP tools.</p>
          </div>
          <div className="user-chip" id="identityChip">
            <span className="live-dot"></span>
            {user ? `${user.displayName} · ${user.role}` : 'Authenticated session'}
          </div>
        </div>

        <section className="card chat-card">
          <div className="chat-toolbar">
            <div>
              <strong>Urumi assistant</strong>
              <small>Tool calling runs through the shared MCP gateway.</small>
            </div>
            <div className="muted" style={{ fontSize: '11px' }}>
              Audit enabled
            </div>
          </div>

          <div id="messages" className="messages" aria-live="polite">
            {messages.length === 0 ? (
              <div className="empty" id="emptyState">
                <h2>Your connected tools are ready.</h2>
                <p>
                  Try asking a question below. The agent can combine tools from different upstreams
                  in one conversation.
                </p>
                <div className="suggestions">
                  <button
                    className="suggestion"
                    type="button"
                    onClick={() => sendMessage('List the five latest products in the store.')}
                  >
                    List latest products
                  </button>
                  <button
                    className="suggestion"
                    type="button"
                    onClick={() =>
                      sendMessage("Show today's orders in the Asia/Kolkata timezone.")
                    }
                  >
                    Today's orders
                  </button>
                  <button
                    className="suggestion"
                    type="button"
                    onClick={() => sendMessage('Calculate the mean of 12, 18, 24, and 30.')}
                  >
                    Calculate a mean
                  </button>
                </div>
              </div>
            ) : (
              messages.map((message, idx) => (
                <article key={idx} className={`message ${message.role}`}>
                  <div className="message-label">
                    {message.role === 'user' ? 'You' : 'Urumi assistant'}
                  </div>
                  <div
                    className="message-content"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
                  />
                  {message.toolCalls && message.toolCalls.length > 0 && (
                    <details className="tool-list">
                      <summary>Tool calls ({message.toolCalls.length})</summary>
                      {message.toolCalls.map((tool, toolIdx) => (
                        <div key={toolIdx} className="tool-item">
                          <div className="tool-title">
                            <span>{tool.name}</span>
                            <span className={`tool-status ${tool.isError ? 'error' : ''}`}>
                              {tool.isError ? 'error' : 'complete'}
                            </span>
                          </div>
                          <pre>{JSON.stringify(tool.arguments, null, 2)}</pre>
                          <pre>{tool.result}</pre>
                        </div>
                      ))}
                    </details>
                  )}
                </article>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="composer">
            <form
              id="chatForm"
              onSubmit={(e) => {
                e.preventDefault();
                void sendMessage(input);
              }}
            >
              <textarea
                ref={textareaRef}
                id="chatInput"
                rows="2"
                required
                maxLength="6000"
                placeholder="Ask about products, orders, inventory, or another connected tool…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isBusy}
              />
              <button
                id="sendBtn"
                className="btn primary"
                type="submit"
                disabled={isBusy || !input.trim()}
              >
                {isBusy ? 'Working…' : 'Send ↑'}
              </button>
            </form>
            <div className="compose-note">
              The model may call tools. Actions are audited under your API key. Verify results before
              making business decisions.
            </div>
          </div>
        </section>
      </main>

      {toast && (
        <Toast message={toast.message} bad={toast.bad} onClose={() => setToast(null)} />
      )}
    </>
  );
}
