import { useState, useEffect } from 'react';
import { ArrowLeft, Trash2, Loader, AlertCircle } from 'lucide-react';
import { api } from '../api';
import TemplatePreviewPanel from '../components/TemplatePreviewPanel';
import '../styles/SettingsWhatsAppTemplatesView.css';

export default function SettingsWhatsAppTemplatesView({ integrationId, templateId, onBack }) {
  const [template, setTemplate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadTemplate();
  }, [templateId]);

  const loadTemplate = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await api.get(
        `/whatsapp/integrations/${integrationId}/templates/${templateId}`
      );
      setTemplate(response.data?.data);
    } catch (err) {
      setError(`Failed to load template: ${err.message}`);
      console.error('Error loading template:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Delete this template? This action cannot be undone.')) {
      return;
    }

    try {
      setDeleting(true);
      setError(null);
      await api.delete(`/whatsapp/integrations/${integrationId}/templates/${templateId}`);
      alert('Template deleted successfully');
      onBack();
    } catch (err) {
      setError(`Failed to delete: ${err.message}`);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="settings-view-template">
        <div className="loading-state">
          <Loader size={32} className="spinning" />
          <p>Loading template...</p>
        </div>
      </div>
    );
  }

  if (!template) {
    return (
      <div className="settings-view-template">
        <div className="error-state">
          <p>Template not found</p>
          <button className="btn btn-primary" onClick={onBack}>
            Go Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-view-template">
      <header className="page-header">
        <button className="btn-back" onClick={onBack}>
          <ArrowLeft size={20} />
          Back
        </button>
        <div className="header-title">
          <h1>{template.label || template.name}</h1>
          <div className="header-meta">
            <span className={`status-badge status-${template.status?.toLowerCase()}`}>
              {template.status || 'UNKNOWN'}
            </span>
            {template.category && <span className="badge">{template.category}</span>}
            {template.language && <span className="badge">{template.language}</span>}
          </div>
        </div>
        <button
          className="btn btn-danger"
          onClick={handleDelete}
          disabled={deleting}
          title="Delete template"
        >
          <Trash2 size={18} />
          {deleting ? 'Deleting...' : 'Delete'}
        </button>
      </header>

      {error && (
        <div className="alert alert-error">
          <AlertCircle size={18} />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="alert-close">✕</button>
        </div>
      )}

      <div className="view-container">
        <main className="template-details">
          <section className="details-section">
            <h2>Template Information</h2>
            <div className="details-grid">
              <div className="detail-item">
                <label>Template Name</label>
                <p>{template.name}</p>
              </div>
              <div className="detail-item">
                <label>Label</label>
                <p>{template.label || 'N/A'}</p>
              </div>
              <div className="detail-item">
                <label>Category</label>
                <p>{template.category || 'N/A'}</p>
              </div>
              <div className="detail-item">
                <label>Language</label>
                <p>{template.language || 'N/A'}</p>
              </div>
              <div className="detail-item">
                <label>Type</label>
                <p>{template.type || 'N/A'}</p>
              </div>
              <div className="detail-item">
                <label>Status</label>
                <p>
                  <span className={`status-badge status-${template.status?.toLowerCase()}`}>
                    {template.status}
                  </span>
                </p>
              </div>
            </div>
          </section>

          {template.text && (
            <section className="details-section">
              <h2>Message Body</h2>
              <div className="message-body">
                {template.header_content && (
                  <div className="message-header">
                    <strong>Header ({template.template_type}):</strong> {template.header_content}
                  </div>
                )}
                <div className="message-text">
                  {template.text.split('\n').map((line, i) => (
                    <p key={i}>{line}</p>
                  ))}
                </div>
                {template.footer && (
                  <div className="message-footer">
                    {template.footer}
                  </div>
                )}
              </div>
            </section>
          )}

          {template.sample_text && (
            <section className="details-section">
              <h2>Sample Text</h2>
              <div className="sample-text">
                {template.sample_text}
              </div>
            </section>
          )}

          {template.quick_replies && template.quick_replies.length > 0 && (
            <section className="details-section">
              <h2>Quick Replies</h2>
              <ul className="replies-list">
                {template.quick_replies.map((reply, i) => (
                  <li key={i}>{reply}</li>
                ))}
              </ul>
            </section>
          )}

          {template.call_to_action && template.call_to_action.length > 0 && (
            <section className="details-section">
              <h2>Call-to-Action Buttons</h2>
              <div className="cta-list">
                {template.call_to_action.map((btn, i) => (
                  <div key={i} className="cta-item">
                    <strong>{btn.button_title}</strong>
                    <span className="badge">{btn.type}</span>
                    <p>{btn.button_value}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {template.rejection_reason && (
            <section className="details-section rejection">
              <h2>Rejection Reason</h2>
              <div className="rejection-reason">
                {template.rejection_reason}
              </div>
            </section>
          )}

          {template.updated_at && (
            <section className="details-section">
              <small className="text-muted">
                Last updated: {new Date(template.updated_at).toLocaleString()}
              </small>
            </section>
          )}
        </main>

        <aside className="preview-sidebar">
          <TemplatePreviewPanel formData={template} />
        </aside>
      </div>
    </div>
  );
}
