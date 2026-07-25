import { useState, useMemo } from 'react';

export default function WhatsAppMobilePreview({ template }) {
  const extractVariables = (text) => {
    const matches = text.match(/\{\{(\d+)\}\}/g) || [];
    return [...new Set(matches)];
  };

  const renderTextWithFormatting = (text) => {
    if (!text) return text;

    let formatted = text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/__(.*?)__/g, '<u>$1</u>')
      .replace(/~~(.*?)~~/g, '<s>$1</s>')
      .replace(/```(.*?)```/g, '<code>$1</code>');

    // Highlight variables
    formatted = formatted.replace(
      /\{\{(\d+)\}\}/g,
      '<span style="background:#fff3cd;color:#000;padding:2px 4px;border-radius:2px;">{{$1}}</span>'
    );

    return formatted;
  };

  const bodyVars = extractVariables(template?.body || '');

  return (
    <div style={styles.container}>
      <div style={styles.phoneFrame}>
        {/* Phone Status Bar */}
        <div style={styles.statusBar}>
          <span style={styles.time}>9:41</span>
          <div style={styles.statusIcons}>📶 📡 🔋</div>
        </div>

        {/* Chat Header */}
        <div style={styles.chatHeader}>
          <div style={styles.headerLeft}>
            <span style={styles.backBtn}>←</span>
            <div>
              <div style={styles.contactName}>Example Contact</div>
              <div style={styles.lastSeen}>online</div>
            </div>
          </div>
          <div style={styles.headerIcons}>☎️ ℹ️</div>
        </div>

        {/* Messages Area */}
        <div style={styles.messagesArea}>
          {/* Header/Media (based on template_type) */}
          {template?.header_content && (
            <div style={styles.messageBubble}>
              {template.template_type === 'IMAGE' && (
                <div style={styles.mediaPreview}>
                  <div style={styles.imagePlaceholder}>🖼️ Image</div>
                </div>
              )}
              {template.template_type === 'VIDEO' && (
                <div style={styles.mediaPreview}>
                  <div style={styles.videoPlaceholder}>▶️ Video</div>
                </div>
              )}
              {template.template_type === 'FILE' && (
                <div style={styles.mediaPreview}>
                  <div style={styles.docPlaceholder}>📄 Document</div>
                </div>
              )}
            </div>
          )}

          {/* Body */}
          <div style={styles.messageBubble}>
            <div
              style={styles.bodyText}
              dangerouslySetInnerHTML={{ __html: renderTextWithFormatting(template?.body || '') }}
            />
          </div>

          {/* Footer */}
          {template?.footer && (
            <div style={styles.messageBubble}>
              <div style={styles.footerText}>{template.footer}</div>
            </div>
          )}

          {/* Buttons */}
          {template?.buttons_json && template.buttons_json.length > 0 && (
            <div style={styles.buttonsContainer}>
              {template.buttons_json.filter(b => b.type === 'CALL_TO_ACTION').map((btn, idx) => (
                <button key={idx} style={styles.ctaButton}>
                  {btn.button_text}
                </button>
              ))}
            </div>
          )}

          {/* Quick Replies */}
          {template?.buttons_json && template.buttons_json.some(b => b.type === 'QUICK_REPLY') && (
            <div style={styles.quickRepliesContainer}>
              {template.buttons_json
                .filter(b => b.type === 'QUICK_REPLY')
                .map((reply, idx) => (
                  <button key={idx} style={styles.quickReplyButton}>
                    {reply.button_text}
                  </button>
                ))}
            </div>
          )}
        </div>

        {/* Input Area */}
        <div style={styles.inputArea}>
          <input
            type="text"
            placeholder="Type a message"
            style={styles.messageInput}
            disabled
          />
          <button style={styles.sendBtn}>➤</button>
        </div>
      </div>

      {/* Info Panel */}
      <div style={styles.infoPanel}>
        <div style={styles.infoTitle}>Preview Information</div>

        {bodyVars.length > 0 && (
          <div style={styles.infoSection}>
            <div style={styles.infoLabel}>Variables ({bodyVars.length})</div>
            {bodyVars.map(varName => {
              const varNum = varName.replace(/\{\{|\}\}/g, '');
              const sampleValue = template?.sample_values_json?.[varName];
              return (
                <div key={varName} style={styles.variable}>
                  <span style={styles.varName}>{varName}</span>
                  <span style={styles.varValue}>→ {sampleValue || '(no sample)'}</span>
                </div>
              );
            })}
          </div>
        )}

        <div style={styles.infoSection}>
          <div style={styles.infoLabel}>Message Stats</div>
          <div style={styles.stat}>
            <span>Body Length:</span>
            <span>{template?.body?.length || 0}/1024</span>
          </div>
          {template?.footer && (
            <div style={styles.stat}>
              <span>Footer Length:</span>
              <span>{template.footer.length}/60</span>
            </div>
          )}
          <div style={styles.stat}>
            <span>Buttons:</span>
            <span>{template?.buttons_json?.length || 0}/3</span>
          </div>
        </div>

        {bodyVars.length > 0 && (
          <div style={styles.warningBox}>
            ⚠️ Make sure to provide sample values for all variables
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
      `}</style>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    gap: '1rem',
    height: '100%',
  },
  phoneFrame: {
    flex: 1,
    background: '#fff',
    borderRadius: '40px',
    border: '8px solid #1a1a1a',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
    maxWidth: '360px',
  },
  statusBar: {
    padding: '8px 16px',
    background: '#000',
    color: '#fff',
    fontSize: '0.75rem',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  time: {
    fontWeight: 600,
  },
  statusIcons: {
    fontSize: '0.7rem',
  },
  chatHeader: {
    padding: '12px 16px',
    background: '#075e54',
    color: '#fff',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '0.9rem',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  backBtn: {
    fontSize: '1.2rem',
    cursor: 'pointer',
  },
  contactName: {
    fontWeight: 600,
    fontSize: '0.95rem',
  },
  lastSeen: {
    fontSize: '0.75rem',
    opacity: 0.8,
  },
  headerIcons: {
    display: 'flex',
    gap: '12px',
  },
  messagesArea: {
    flex: 1,
    overflowY: 'auto',
    padding: '12px 8px',
    background: '#e5ddd5',
    backgroundImage: 'radial-gradient(circle at 1px 1px, #d1d5db 1px, transparent 1px)',
    backgroundSize: '20px 20px',
  },
  messageBubble: {
    marginBottom: '8px',
    marginRight: 'auto',
    maxWidth: '85%',
    background: '#fff',
    padding: '8px 12px',
    borderRadius: '8px 8px 8px 2px',
    boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
  },
  headerText: {
    fontSize: '0.9rem',
    fontWeight: 600,
    marginBottom: '4px',
  },
  bodyText: {
    fontSize: '0.9rem',
    lineHeight: 1.4,
    color: '#1a1a1a',
  },
  footerText: {
    fontSize: '0.75rem',
    color: '#999',
    marginTop: '4px',
  },
  mediaPreview: {
    height: '150px',
    background: '#f0f0f0',
    borderRadius: '6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '4px',
  },
  imagePlaceholder: {
    fontSize: '2rem',
  },
  videoPlaceholder: {
    fontSize: '2rem',
  },
  docPlaceholder: {
    fontSize: '2rem',
  },
  buttonsContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    marginTop: '8px',
  },
  ctaButton: {
    padding: '10px 16px',
    background: '#075e54',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    fontSize: '0.85rem',
    fontWeight: 500,
    cursor: 'pointer',
    textAlign: 'center',
  },
  quickRepliesContainer: {
    display: 'flex',
    gap: '4px',
    flexWrap: 'wrap',
    marginTop: '8px',
  },
  quickReplyButton: {
    padding: '8px 12px',
    background: '#e5ddd5',
    border: '1px solid #d1d5db',
    borderRadius: '16px',
    fontSize: '0.8rem',
    cursor: 'pointer',
  },
  inputArea: {
    padding: '8px 12px',
    background: '#f0f0f0',
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    borderTop: '1px solid #d1d5db',
  },
  messageInput: {
    flex: 1,
    padding: '10px 12px',
    border: '1px solid #d1d5db',
    borderRadius: '20px',
    fontSize: '0.85rem',
    background: '#fff',
  },
  sendBtn: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    background: '#075e54',
    color: '#fff',
    border: 'none',
    cursor: 'pointer',
    fontSize: '1rem',
  },
  infoPanel: {
    flex: 1,
    padding: '1rem',
    background: '#fafafa',
    borderRadius: '8px',
    overflowY: 'auto',
    fontSize: '0.85rem',
  },
  infoTitle: {
    fontWeight: 600,
    marginBottom: '1rem',
    fontSize: '0.95rem',
  },
  infoSection: {
    marginBottom: '1.5rem',
    paddingBottom: '1rem',
    borderBottom: '1px solid #e5e7eb',
  },
  infoLabel: {
    fontWeight: 600,
    marginBottom: '0.5rem',
    color: '#1a1a1a',
  },
  variable: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '0.5rem',
    background: '#fff',
    borderRadius: '4px',
    marginBottom: '0.5rem',
  },
  varName: {
    background: '#fef3c7',
    padding: '2px 6px',
    borderRadius: '2px',
    fontWeight: 500,
  },
  varValue: {
    color: '#666',
  },
  stat: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '0.5rem 0',
    color: '#666',
  },
  warningBox: {
    padding: '0.75rem',
    background: '#fef3c7',
    border: '1px solid #fcd34d',
    borderRadius: '4px',
    color: '#92400e',
    fontSize: '0.8rem',
  },
};
