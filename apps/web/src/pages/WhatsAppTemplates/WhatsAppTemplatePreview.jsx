export default function WhatsAppTemplatePreview({ template }) {
  const variables = template.body?.match(/\{\{(\d+)\}\}/g) || [];

  const replaceSampleValues = (text, sampleText) => {
    if (!sampleText || !text) return text;

    const sampleWords = sampleText.split(/\s+/);
    let result = text;

    variables.forEach((variable, idx) => {
      const replacement = sampleWords[idx] || variable;
      const regex = new RegExp(variable.replace(/\{/g, '\\{').replace(/\}/g, '\\}'), 'g');
      result = result.replace(regex, replacement);
    });

    return result;
  };

  const displayText = replaceSampleValues(template.body || '', template.sample_text || '');

  return (
    <div style={{
      width: '100%',
      maxWidth: '320px',
      margin: '0 auto'
    }}>
      {/* Phone Mockup */}
      <div style={{
        background: '#000',
        borderRadius: '40px',
        padding: '10px',
        boxShadow: '0 10px 40px rgba(0,0,0,0.4)',
        aspectRatio: '9/19.5',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}>
        {/* Notch */}
        <div style={{
          height: '24px',
          background: '#000',
          borderBottomLeftRadius: '18px',
          borderBottomRightRadius: '18px',
          marginBottom: '6px'
        }} />

        {/* Screen */}
        <div style={{
          background: '#fff',
          borderRadius: '20px',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0
        }}>
          {/* Header - WhatsApp Styling */}
          <div style={{
            background: '#f0f0f0',
            padding: '8px 12px',
            borderBottom: '1px solid #e5e5e5',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              background: '#25d366',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontSize: '16px',
              fontWeight: 'bold'
            }}>
              💬
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: '13px',
                fontWeight: '600',
                color: '#000',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}>
                WhatsApp Message
              </div>
              <div style={{
                fontSize: '11px',
                color: '#666',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}>
                Business Account
              </div>
            </div>
            <div style={{
              fontSize: '20px',
              cursor: 'pointer'
            }}>
              ⋮
            </div>
          </div>

          {/* Chat Area */}
          <div style={{
            flex: 1,
            overflow: 'auto',
            padding: '12px 8px',
            background: '#fff',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            gap: '8px'
          }}>
            {/* Message Bubble */}
            <div style={{
              display: 'flex',
              justifyContent: 'flex-start',
              marginBottom: '4px'
            }}>
              <div style={{
                background: '#e5e5ea',
                color: '#000',
                borderRadius: '18px',
                padding: '8px 12px',
                maxWidth: '85%',
                wordWrap: 'break-word',
                lineHeight: '1.4',
                fontSize: '13px',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'break-word'
              }}>
                {/* Header if present */}
                {template.header_type !== 'NONE' && (
                  <div style={{ marginBottom: '8px', paddingBottom: '8px', borderBottom: '1px solid #d0d0d0' }}>
                    {template.header_type === 'TEXT' && (
                      <div style={{ fontSize: '12px', fontWeight: '600', color: '#0084ff' }}>
                        {template.header_content || '[Header]'}
                      </div>
                    )}
                    {template.header_type === 'IMAGE' && (
                      <div style={{ fontSize: '11px', color: '#666' }}>
                        🖼️ Image
                      </div>
                    )}
                    {template.header_type === 'VIDEO' && (
                      <div style={{ fontSize: '11px', color: '#666' }}>
                        🎥 Video
                      </div>
                    )}
                    {template.header_type === 'DOCUMENT' && (
                      <div style={{ fontSize: '11px', color: '#666' }}>
                        📄 Document
                      </div>
                    )}
                  </div>
                )}

                {/* Body */}
                <div>{displayText || '[Message body]'}</div>

                {/* Footer if present */}
                {template.footer && (
                  <div style={{
                    marginTop: '8px',
                    paddingTop: '8px',
                    borderTop: '1px solid #d0d0d0',
                    fontSize: '11px',
                    color: '#999'
                  }}>
                    {template.footer}
                  </div>
                )}
              </div>
            </div>

            {/* Quick Replies if present */}
            {template.quick_replies && template.quick_replies.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
                {template.quick_replies.slice(0, 3).map((reply, idx) => (
                  <div
                    key={idx}
                    style={{
                      alignSelf: 'flex-start',
                      background: '#e7f7ff',
                      border: '1px solid #0084ff',
                      borderRadius: '18px',
                      padding: '6px 12px',
                      fontSize: '12px',
                      color: '#0084ff',
                      fontWeight: '500',
                      maxWidth: '85%',
                      cursor: 'pointer'
                    }}
                  >
                    {reply.button_title || '[Button]'}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Input Area */}
          <div style={{
            padding: '8px 12px',
            borderTop: '1px solid #e5e5e5',
            background: '#f5f5f5',
            display: 'flex',
            gap: '6px',
            alignItems: 'center'
          }}>
            <input
              type="text"
              placeholder="Type message..."
              disabled
              style={{
                flex: 1,
                border: '1px solid #d0d0d0',
                borderRadius: '20px',
                padding: '6px 12px',
                fontSize: '12px',
                background: '#fff',
                outline: 'none',
                color: '#999'
              }}
            />
            <button disabled style={{
              background: '#25d366',
              color: '#fff',
              border: 'none',
              borderRadius: '50%',
              width: '28px',
              height: '28px',
              cursor: 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '14px'
            }}>
              ➤
            </button>
          </div>
        </div>
      </div>

      {/* Info Text */}
      <div style={{
        fontSize: '11px',
        color: '#67697b',
        textAlign: 'center',
        marginTop: '12px',
        padding: '0 8px'
      }}>
        Preview updates as you type
      </div>
    </div>
  );
}
