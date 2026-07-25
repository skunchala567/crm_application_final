import '../styles/TemplatePreviewPanel.css';

export default function TemplatePreviewPanel({ formData }) {
  // Replace parameters with sample values
  const renderText = (text, sampleText) => {
    if (!text || !sampleText) return text;

    let result = text;
    const params = text.match(/\{\{(\d+)\}\}/g) || [];

    params.forEach((param) => {
      const paramNum = param.match(/\d+/)[0];
      const sampleParams = sampleText.match(/\[\d+\]|{{(\d+)}}/g) || [];
      const sampleIndex = sampleParams.findIndex(p => p.includes(paramNum));

      if (sampleIndex >= 0) {
        const sampleValue = sampleText.split(/[\[\]]/)[sampleIndex * 2 + 1] || 'value';
        result = result.replace(param, sampleValue);
      }
    });

    return result;
  };

  const displayText = renderText(formData.body, formData.sample_text);

  return (
    <div className="template-preview-panel">
      <h3>Preview</h3>

      <div className="whatsapp-preview">
        {/* WhatsApp Header */}
        <div className="preview-header">
          <div className="business-info">
            <div className="business-logo">🏢</div>
            <div className="business-name">
              <p className="name">{formData.label || 'Business Name'}</p>
              <p className="status">Official account</p>
            </div>
          </div>
        </div>

        {/* Message Container */}
        <div className="preview-messages">
          {/* Header/Media if present (based on template_type) */}
          {formData.header_content && (
            <div className="message-part header">
              {formData.template_type === 'IMAGE' ? (
                <div className="media-placeholder">
                  <span>🖼️ Image</span>
                </div>
              ) : formData.template_type === 'VIDEO' ? (
                <div className="media-placeholder">
                  <span>🎥 Video</span>
                </div>
              ) : formData.template_type === 'FILE' ? (
                <div className="media-placeholder">
                  <span>📄 Document</span>
                </div>
              ) : null}
            </div>
          )}

          {/* Main message body */}
          <div className="message">
            <div className="message-bubble">
              <div className="message-text">
                {displayText.split('\n').map((line, i) => (
                  <p key={i} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {line}
                  </p>
                ))}
              </div>
            </div>
            <div className="message-time">
              <span className="time">11:24</span>
              <span className="read-receipt">✓✓</span>
            </div>
          </div>

          {/* Footer if present */}
          {formData.footer && (
            <div className="message-part footer">
              <p>{formData.footer}</p>
            </div>
          )}
        </div>

        {/* Buttons */}
        {(formData.quick_replies?.length > 0 || formData.call_to_action?.length > 0) && (
          <div className="preview-buttons">
            {formData.quick_replies && formData.quick_replies.map((reply, i) => (
              <button key={i} className="quick-reply-button">
                {reply}
              </button>
            ))}

            {formData.call_to_action && formData.call_to_action.map((btn, i) => (
              <button key={i} className="cta-button">
                {btn.button_title}
              </button>
            ))}
          </div>
        )}

        {/* Message Info */}
        <div className="preview-info">
          <p className="category-badge">
            {formData.category || 'CATEGORY'} • {formData.language || 'LANGUAGE'}
          </p>
          {formData.template_type && (
            <p className="type-info">
              <strong>Type:</strong> {formData.template_type}
            </p>
          )}
          {formData.template_name && (
            <p className="name-info">
              <strong>Name:</strong> {formData.template_name}
            </p>
          )}
        </div>
      </div>

      {/* Info Box */}
      <div className="preview-notes">
        <h4>Important Notes</h4>
        <ul>
          <li>Message must be clear and not misleading</li>
          <li>Parameters {'{'}1{'}'}, {'{'}2{'}'} will be filled with sample values</li>
          <li>Maximum 1024 characters for body text</li>
          <li>Footer maximum 60 characters</li>
          <li>Template names must be lowercase with underscores</li>
        </ul>
      </div>
    </div>
  );
}
