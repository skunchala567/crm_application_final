import { useState } from 'react';
import { X, Download, AlertCircle } from 'lucide-react';
import './WhatsAppPreview.css';

export default function WhatsAppPreview({ template }) {
  const [imageLoading, setImageLoading] = useState(true);
  const [imageError, setImageError] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);

  if (!template) {
    return (
      <div className="whatsapp-preview empty">
        <p>Select a template to preview</p>
      </div>
    );
  }

  // Replace {{n}} variables with sample values
  const renderMessage = (text, sampleText) => {
    if (!text) return '';

    let rendered = text;

    // If sample_text exists, use it to replace variables
    if (sampleText) {
      // Simple approach: replace {{1}}, {{2}} etc with lines from sample_text
      const sampleLines = sampleText.split('\n').filter(line => line.trim());
      let varIndex = 0;

      rendered = rendered.replace(/\{\{(\d+)\}\}/g, () => {
        if (varIndex < sampleLines.length) {
          return sampleLines[varIndex++];
        }
        return `{{${varIndex++}}}`;
      });
    }

    return rendered;
  };

  const messageBody = renderMessage(template.text || template.body, template.sample_text);

  // Determine template type and media (using correct database columns)
  const templateType = (template.template_type || template.type || 'TEXT').toUpperCase();
  const mediaUrl = template.media_url; // Image URL from database
  const videoUrl = template.video_url; // Video URL from database
  const documentUrl = template.document_url; // Document URL from database
  const fileName = template.file_name; // File name from database
  const fileSize = template.file_size; // File size in bytes from database
  const mimeType = template.mime_type; // MIME type from database

  // Get file icon based on extension
  const getFileIcon = (name, mime) => {
    if (!name) return '📄';
    const ext = name.split('.').pop().toLowerCase();
    const iconMap = {
      'pdf': '📕',
      'doc': '📗', 'docx': '📗',
      'xls': '📙', 'xlsx': '📙',
      'ppt': '📘', 'pptx': '📘',
      'zip': '📦',
      'txt': '📄',
      'csv': '📊'
    };
    return iconMap[ext] || '📄';
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <>
      <div className="whatsapp-preview">
        <div className="wa-header">
          <div className="wa-business-info">
            <div className="wa-business-name">Business Account</div>
            <div className="wa-time">Just now</div>
          </div>
        </div>

        <div className="wa-messages">
          <div className="wa-message-group">
            {/* Media Preview - Image */}
            {templateType === 'IMAGE' && mediaUrl && (
              <div className="wa-message media-message">
                <div className="media-container">
                  {imageLoading && (
                    <div className="media-skeleton">
                      <div className="skeleton-pulse" />
                    </div>
                  )}
                  {imageError ? (
                    <div className="media-error">
                      <AlertCircle size={32} />
                      <p>Image unavailable</p>
                    </div>
                  ) : (
                    <img
                      src={mediaUrl}
                      alt="Message media"
                      className="wa-media-image"
                      onLoad={() => setImageLoading(false)}
                      onError={() => {
                        setImageLoading(false);
                        setImageError(true);
                      }}
                      onClick={() => setSelectedImage(mediaUrl)}
                      style={{ display: imageLoading ? 'none' : 'block' }}
                    />
                  )}
                </div>
              </div>
            )}

            {/* Media Preview - Video */}
            {templateType === 'VIDEO' && videoUrl && (
              <div className="wa-message media-message">
                <div className="media-container">
                  {videoError ? (
                    <div className="media-error">
                      <AlertCircle size={32} />
                      <p>Video unavailable</p>
                    </div>
                  ) : (
                    <video
                      controls
                      controlsList="nodownload"
                      className="wa-media-video"
                      onError={() => setVideoError(true)}
                      poster={mediaUrl}
                    >
                      <source src={videoUrl} />
                      Your browser doesn't support video playback.
                    </video>
                  )}
                </div>
              </div>
            )}

            {/* Media Preview - Document */}
            {(templateType === 'FILE' || templateType === 'DOCUMENT') && documentUrl && (
              <div className="wa-message document-message">
                <div className="document-card">
                  <div className="document-icon">{getFileIcon(fileName, mimeType)}</div>
                  <div className="document-info">
                    <div className="document-name">{fileName || 'Document'}</div>
                    {fileSize && <div className="document-size">{formatFileSize(fileSize)}</div>}
                  </div>
                  <a href={documentUrl} target="_blank" rel="noopener noreferrer" className="document-action">
                    <Download size={18} />
                  </a>
                </div>
              </div>
            )}

            {/* Message body */}
            {messageBody && (
              <div className="wa-message">
                <div className="wa-text">
                  {messageBody.split('\n').map((line, idx) => (
                    <div key={idx}>{line || <br />}</div>
                  ))}
                </div>
              </div>
            )}

            {/* Footer if exists */}
            {template.footer && (
              <div className="wa-message footer-message">
                <div className="footer-text">{template.footer}</div>
              </div>
            )}

            {/* Quick Replies */}
            {template.quick_replies && template.quick_replies.length > 0 && (
              <div className="wa-quick-replies">
                {template.quick_replies.map((reply, idx) => (
                  <button key={idx} className="wa-quick-reply-btn">
                    {reply}
                  </button>
                ))}
              </div>
            )}

            {/* CTA Buttons */}
            {template.call_to_action && template.call_to_action.length > 0 && (
              <div className="wa-cta-buttons">
                {template.call_to_action.map((btn, idx) => (
                  <button key={idx} className="wa-cta-btn">
                    {btn.button_title}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Image Lightbox Modal */}
      {selectedImage && (
        <div className="media-lightbox" onClick={() => setSelectedImage(null)}>
          <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
            <button className="lightbox-close" onClick={() => setSelectedImage(null)}>
              <X size={24} />
            </button>
            <img src={selectedImage} alt="Full size" className="lightbox-image" />
          </div>
        </div>
      )}
    </>
  );
}
