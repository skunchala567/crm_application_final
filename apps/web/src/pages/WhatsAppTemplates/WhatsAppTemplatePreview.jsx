import { MessageCircle } from 'lucide-react';

export default function WhatsAppTemplatePreview({ template }) {
  const variables = template.body?.match(/\{\{(\d+)\}\}/g) || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div>
        <h4 style={{ margin: '0 0 8px 0', fontSize: '12px', fontWeight: '600', color: '#5c5e72' }}>
          Preview
        </h4>
      </div>

      {/* Phone Mockup */}
      <div style={{
        background: '#000',
        borderRadius: '40px',
        padding: '12px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        minHeight: '600px',
        display: 'flex',
        flexDirection: 'column'
      }}>
        {/* Phone Notch */}
        <div style={{
          height: '28px',
          background: '#000',
          borderBottomLeftRadius: '20px',
          borderBottomRightRadius: '20px',
          marginBottom: '8px'
        }} />

        {/* Phone Screen */}
        <div style={{
          background: '#fff',
          borderRadius: '24px',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          minHeight: '0'
        }}>
          {/* Chat Header */}
          <div style={{
            padding: '12px 14px',
            background: '#f5f5f5',
            borderBottom: '1px solid #e5e7eb',
            display: 'flex',
            alignItems: 'center',
            gap: '10px'
          }}>
            <MessageCircle size={20} style={{ color: '#25d366' }} />
            <div>
              <div style={{ fontSize: '12px', fontWeight: '600', color: '#000' }}>
                Template Preview
              </div>
              <div style={{ fontSize: '10px', color: '#999' }}>
                WhatsApp Business
              </div>
            </div>
          </div>

          {/* Message Bubble */}
          <div style={{
            flex: 1,
            padding: '12px 14px',
            overflow: 'auto',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            gap: '8px'
          }}>
            {/* Header */}
            {template.header_type !== 'NONE' && (
              <div style={{
                background: '#e5f4f8',
                borderRadius: '12px',
                padding: '8px',
                marginBottom: '8px',
                textAlign: 'center'
              }}>
                {template.header_type === 'TEXT' && (
                  <div style={{ fontSize: '12px', color: '#333' }}>
                    📝 {template.header_content || '[Header Text]'}
                  </div>
                )}
                {template.header_type === 'IMAGE' && (
                  <div style={{ fontSize: '11px', color: '#666' }}>
                    🖼️ Image Header
                  </div>
                )}
                {template.header_type === 'VIDEO' && (
                  <div style={{ fontSize: '11px', color: '#666' }}>
                    🎥 Video Header
                  </div>
                )}
                {template.header_type === 'DOCUMENT' && (
                  <div style={{ fontSize: '11px', color: '#666' }}>
                    📄 Document Header
                  </div>
                )}
              </div>
            )}

            {/* Body */}
            <div style={{
              background: '#e5f4f8',
              borderRadius: '12px',
              padding: '10px 12px',
              color: '#000',
              fontSize: '13px',
              lineHeight: '1.4',
              wordBreak: 'break-word'
            }}>
              {template.body ? (
                <BodyWithVariables body={template.body} sampleText={template.sample_text} />
              ) : (
                <span style={{ color: '#999' }}>[Message body]</span>
              )}
            </div>

            {/* Footer */}
            {template.footer && (
              <div style={{
                fontSize: '11px',
                color: '#666',
                textAlign: 'center',
                paddingTop: '4px'
              }}>
                {template.footer}
              </div>
            )}

            {/* Quick Replies */}
            {template.quick_replies && template.quick_replies.length > 0 && (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                marginTop: '8px'
              }}>
                {template.quick_replies.map((reply, idx) => (
                  <div
                    key={idx}
                    style={{
                      background: '#f0f0f0',
                      border: '1px solid #d1d5db',
                      borderRadius: '20px',
                      padding: '8px 12px',
                      textAlign: 'center',
                      fontSize: '12px',
                      color: '#333'
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
            padding: '10px 12px',
            borderTop: '1px solid #e5e7eb',
            background: '#f5f5f5',
            display: 'flex',
            gap: '8px',
            alignItems: 'center'
          }}>
            <input
              type="text"
              placeholder="Type a message..."
              disabled
              style={{
                flex: 1,
                border: '1px solid #d1d5db',
                borderRadius: '20px',
                padding: '8px 12px',
                fontSize: '12px',
                background: '#fff'
              }}
            />
            <button
              disabled
              style={{
                background: '#25d366',
                color: '#fff',
                border: 'none',
                borderRadius: '50%',
                width: '32px',
                height: '32px',
                cursor: 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '16px'
              }}
            >
              ➤
            </button>
          </div>
        </div>
      </div>

      {/* Info */}
      <div style={{
        fontSize: '11px',
        color: '#67697b',
        padding: '8px',
        background: '#f3f4f6',
        borderRadius: '6px',
        textAlign: 'center'
      }}>
        Preview updates as you type
      </div>
    </div>
  );
}

function BodyWithVariables({ body, sampleText }) {
  if (!sampleText) {
    return <span>{body}</span>;
  }

  // Replace variables with sample values
  let displayText = body;
  const variables = body.match(/\{\{(\d+)\}\}/g) || [];

  variables.forEach((variable, idx) => {
    const sampleWords = sampleText.split(/\s+/);
    const replacement = sampleWords[idx] || variable;
    displayText = displayText.replace(variable, <strong key={idx} style={{ background: '#fff3cd' }}>{replacement}</strong>);
  });

  return <span>{displayText}</span>;
}
