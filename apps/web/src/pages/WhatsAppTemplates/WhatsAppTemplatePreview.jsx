import React, { useState } from 'react';
import { MessageCircle, Phone, Video, MoreVertical, ArrowLeft } from 'lucide-react';

export default function WhatsAppTemplatePreview({ template, businessName = 'Pallavi International School' }) {
  const [hoverTimestamp, setHoverTimestamp] = useState(false);

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

  // Generate realistic timestamp
  const now = new Date();
  const timeString = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  // Get current hour for greeting context
  const hour = now.getHours();
  const isBusinessHours = hour >= 9 && hour < 18;

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'flex-start',
      height: '100%',
      padding: '20px 0',
      background: '#f5f5f5'
    }}>
      {/* Phone Mockup */}
      <div style={{
        width: '360px',
        background: '#000',
        borderRadius: '48px',
        padding: '12px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        maxHeight: '90vh'
      }}>
        {/* Notch */}
        <div style={{
          height: '28px',
          background: '#000',
          borderBottomLeftRadius: '20px',
          borderBottomRightRadius: '20px',
          marginBottom: '8px'
        }} />

        {/* Screen */}
        <div style={{
          background: '#fff',
          borderRadius: '24px',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0
        }}>
          {/* Status Bar */}
          <div style={{
            background: '#fff',
            padding: '4px 12px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '11px',
            color: '#000',
            borderBottom: '1px solid #f0f0f0',
            height: '24px'
          }}>
            <span>9:41</span>
            <span>●●●●●</span>
          </div>

          {/* Chat Header - Real WhatsApp Style */}
          <div style={{
            background: '#fff',
            padding: '12px 16px',
            borderBottom: '1px solid #e5e5e5',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px'
          }}>
            {/* Left Section */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
              <ArrowLeft size={24} color="#007aff" style={{ cursor: 'pointer' }} />

              {/* Business Avatar */}
              <div style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #25d366 0%, #20ba5f 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontSize: '18px',
                fontWeight: 'bold',
                flexShrink: 0
              }}>
                {businessName.charAt(0).toUpperCase()}
              </div>

              {/* Business Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: '15px',
                  fontWeight: '600',
                  color: '#000',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}>
                  {businessName}
                  <span style={{ fontSize: '11px', color: '#25d366' }}>✓</span>
                </div>
                <div style={{
                  fontSize: '12px',
                  color: '#65676b',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}>
                  {isBusinessHours ? 'Typically replies instantly' : 'Business Account'}
                </div>
              </div>
            </div>

            {/* Right Actions */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <Phone size={20} color="#007aff" style={{ cursor: 'pointer' }} />
              <Video size={20} color="#007aff" style={{ cursor: 'pointer' }} />
              <MoreVertical size={20} color="#007aff" style={{ cursor: 'pointer' }} />
            </div>
          </div>

          {/* Chat Background with Watermark */}
          <div style={{
            flex: 1,
            overflow: 'auto',
            padding: '16px 12px',
            background: '#ece5dd url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22400%22 height=%22400%22%3E%3Ctext x=%2750%25%27 y=%2750%25%27 dominant-baseline=%22middle%22 text-anchor=%22middle%22 font-size=%2280%27 opacity=%270.03%27 fill=%27%23000%27%3E✓✓%3C/text%3E%3C/svg%3E")',
            backgroundSize: '400px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-start',
            gap: '8px'
          }}>
            {/* Message Group */}
            <div style={{
              display: 'flex',
              justifyContent: 'flex-end',
              marginBottom: '4px'
            }}>
              <div
                onMouseEnter={() => setHoverTimestamp(true)}
                onMouseLeave={() => setHoverTimestamp(false)}
                style={{
                  background: '#dcf8c6',
                  color: '#000',
                  borderRadius: '18px 18px 4px 18px',
                  padding: '8px 12px',
                  maxWidth: '85%',
                  wordWrap: 'break-word',
                  lineHeight: '1.4',
                  fontSize: '13px',
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'break-word',
                  position: 'relative',
                  boxShadow: '0 1px 0.5px rgba(0,0,0,0.13)'
                }}>
                {/* Header if present */}
                {template.header_type !== 'NONE' && (
                  <div style={{
                    marginBottom: '8px',
                    paddingBottom: '8px',
                    borderBottom: '1px solid rgba(0,0,0,0.1)'
                  }}>
                    {template.header_type === 'TEXT' && (
                      <div style={{
                        fontSize: '13px',
                        fontWeight: '600',
                        color: '#0084ff',
                        whiteSpace: 'pre-wrap'
                      }}>
                        {template.header_content || '[Header]'}
                      </div>
                    )}
                    {template.header_type === 'IMAGE' && (
                      <div style={{
                        width: '200px',
                        height: '120px',
                        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                        borderRadius: '8px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#fff',
                        fontSize: '12px',
                        marginBottom: '4px'
                      }}>
                        🖼️ Image
                      </div>
                    )}
                    {template.header_type === 'VIDEO' && (
                      <div style={{
                        width: '200px',
                        height: '120px',
                        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                        borderRadius: '8px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#fff',
                        fontSize: '12px',
                        marginBottom: '4px'
                      }}>
                        ▶️ Video
                      </div>
                    )}
                    {template.header_type === 'DOCUMENT' && (
                      <div style={{
                        background: '#f0f0f0',
                        borderRadius: '8px',
                        padding: '8px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        marginBottom: '4px'
                      }}>
                        <div style={{ fontSize: '20px' }}>📄</div>
                        <div style={{ fontSize: '12px', color: '#333' }}>Document</div>
                      </div>
                    )}
                  </div>
                )}

                {/* Body */}
                <div style={{ marginBottom: '4px' }}>
                  {displayText || '[Message body]'}
                </div>

                {/* Footer if present */}
                {template.footer && (
                  <div style={{
                    marginTop: '8px',
                    paddingTop: '8px',
                    borderTop: '1px solid rgba(0,0,0,0.1)',
                    fontSize: '11px',
                    color: '#555',
                    fontStyle: 'italic'
                  }}>
                    {template.footer}
                  </div>
                )}

                {/* Timestamp */}
                <div style={{
                  fontSize: '11px',
                  color: '#666',
                  marginTop: '4px',
                  textAlign: 'right',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  gap: '2px'
                }}>
                  <span>{timeString}</span>
                  <span style={{ fontSize: '10px', color: '#25d366' }}>✓✓</span>
                </div>
              </div>
            </div>

            {/* Buttons Section */}
            {template.buttons && template.buttons.length > 0 && (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                marginTop: '8px',
                alignSelf: 'flex-end',
                width: '100%',
                maxWidth: '280px'
              }}>
                {/* Call to Action Buttons */}
                {template.buttons
                  .filter(btn => btn.type === 'CALL_TO_ACTION' || btn.type === 'CTA')
                  .map((btn, idx) => (
                    <button
                      key={`cta-${idx}`}
                      style={{
                        background: '#fff',
                        border: '2px solid #25d366',
                        color: '#25d366',
                        borderRadius: '8px',
                        padding: '12px 16px',
                        fontSize: '13px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        boxShadow: '0 1px 0.5px rgba(0,0,0,0.13)',
                        width: '100%'
                      }}
                      onMouseOver={e => e.target.style.background = '#f0f0f0'}
                      onMouseOut={e => e.target.style.background = '#fff'}
                    >
                      {btn.button_text || '[Button]'}
                    </button>
                  ))}

                {/* Quick Replies */}
                {template.buttons
                  .filter(btn => btn.type === 'QUICK_REPLY' || (btn.button_title && !btn.type))
                  .map((reply, idx) => (
                    <button
                      key={`qr-${idx}`}
                      style={{
                        background: '#e7f7ff',
                        border: '1px solid #0084ff',
                        color: '#0084ff',
                        borderRadius: '24px',
                        padding: '8px 16px',
                        fontSize: '13px',
                        fontWeight: '500',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        width: '100%'
                      }}
                      onMouseOver={e => e.target.style.background = '#d0ebff'}
                      onMouseOut={e => e.target.style.background = '#e7f7ff'}
                    >
                      {reply.button_title || reply.button_text || '[Button]'}
                    </button>
                  ))}
              </div>
            )}

            {/* Legacy Quick Replies Support */}
            {template.quick_replies && template.quick_replies.length > 0 && (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                marginTop: '12px',
                alignSelf: 'flex-end',
                width: '100%',
                maxWidth: '280px'
              }}>
                {template.quick_replies.slice(0, 3).map((reply, idx) => (
                  <button
                    key={idx}
                    style={{
                      background: '#e7f7ff',
                      border: '1px solid #0084ff',
                      color: '#0084ff',
                      borderRadius: '24px',
                      padding: '8px 16px',
                      fontSize: '13px',
                      fontWeight: '500',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      width: '100%'
                    }}
                    onMouseOver={e => e.target.style.background = '#d0ebff'}
                    onMouseOut={e => e.target.style.background = '#e7f7ff'}
                  >
                    {reply.button_title || '[Button]'}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Input Area */}
          <div style={{
            padding: '12px 16px',
            borderTop: '1px solid #e5e5e5',
            background: '#f5f5f5',
            display: 'flex',
            gap: '8px',
            alignItems: 'flex-end'
          }}>
            <div style={{
              display: 'flex',
              gap: '8px',
              alignItems: 'center'
            }}>
              <button style={{
                background: 'none',
                border: 'none',
                fontSize: '22px',
                cursor: 'not-allowed',
                opacity: 0.5
              }}>
                😊
              </button>
              <button style={{
                background: 'none',
                border: 'none',
                fontSize: '20px',
                cursor: 'not-allowed',
                opacity: 0.5
              }}>
                📎
              </button>
            </div>

            <input
              type="text"
              placeholder="Type message..."
              disabled
              style={{
                flex: 1,
                border: '1px solid #d0d0d0',
                borderRadius: '20px',
                padding: '8px 14px',
                fontSize: '13px',
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
              width: '32px',
              height: '32px',
              minWidth: '32px',
              cursor: 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '16px',
              boxShadow: '0 1px 2px rgba(0,0,0,0.15)'
            }}>
              ▶
            </button>
          </div>
        </div>
      </div>

      {/* Info Text */}
      <div style={{
        position: 'absolute',
        bottom: '12px',
        fontSize: '11px',
        color: '#67697b',
        textAlign: 'center',
        fontStyle: 'italic'
      }}>
        Preview updates as you type
      </div>
    </div>
  );
}
