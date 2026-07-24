import { useState } from 'react';
import { X } from 'lucide-react';
import { api } from './api';
import './StageChangeDialog.css';

export function StageChangeDialog({ leads, meta, onClose, onSuccess, onError }) {
  const [stageId, setStageId] = useState('');
  const [substageId, setSubstageId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const isBulk = Array.isArray(leads);
  const lead = isBulk ? null : leads;
  const leadCount = isBulk ? leads.length : 1;

  const stages = meta?.stages || [];
  const substages = stageId ? (meta?.substages || []).filter(s => String(s.stageId) === String(stageId)) : [];

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!stageId || !substageId) {
      setError('Please select both stage and sub-stage');
      return;
    }

    setSaving(true);
    try {
      const result = isBulk
        ? await api('/leads/actions/bulk-change-stage', {
            method: 'PUT',
            body: JSON.stringify({
              leadIds: leads,
              stageId: Number(stageId),
              substageId: Number(substageId),
            }),
          })
        : await api(`/leads/${lead.id}/change-stage`, {
            method: 'PUT',
            body: JSON.stringify({
              stageId: Number(stageId),
              substageId: Number(substageId),
            }),
          });

      onSuccess(result);
      onClose();
    } catch (err) {
      setError(err.message);
      onError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <section className="stage-change-dialog" role="dialog" aria-modal="true" aria-labelledby="stage-change-title">
        <div className="stage-change-header">
          <div>
            <span className="eyebrow">{isBulk ? 'Bulk lead' : 'Lead'} stage change</span>
            <h2 id="stage-change-title">Change Stage</h2>
            {isBulk ? (
              <p>{leadCount} leads will be updated to the selected stage</p>
            ) : (
              <p>{lead?.studentName} · {lead?.leadId}</p>
            )}
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <label>
              Stage *
              <select
                required
                value={stageId}
                onChange={(e) => {
                  setStageId(e.target.value);
                  setSubstageId('');
                }}
              >
                <option value="">Select stage</option>
                {stages.map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.displayName}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Sub-stage *
              <select
                required
                value={substageId}
                onChange={(e) => setSubstageId(e.target.value)}
                disabled={!stageId}
              >
                <option value="">{stageId ? 'Select sub-stage' : 'Select stage first'}</option>
                {substages.map((substage) => (
                  <option key={substage.id} value={substage.id}>
                    {substage.displayName}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {error && <div className="error-message">{error}</div>}

          <footer>
            <button type="button" className="secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button
              type="submit"
              className="primary"
              disabled={saving || !stageId || !substageId}
            >
              {saving ? 'Updating...' : isBulk ? `Change Stage for ${leadCount} Leads` : 'Change Stage'}
            </button>
          </footer>
        </form>
      </section>
    </>
  );
}
