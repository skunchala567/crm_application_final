import { useState, useEffect } from 'react';
import { Plus, Pencil, X } from 'lucide-react';
import { api } from './api';

export default function AcademicYearsConfiguration({ onMessage }) {
  const [years, setYears] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null);
  const [formData, setFormData] = useState({
    academicYear: '',
    displayName: '',
    isActive: 1
  });

  useEffect(() => {
    loadYears();
  }, []);

  const loadYears = async () => {
    try {
      setLoading(true);
      const response = await api('/academic-years');
      setYears(response.data || []);
    } catch (error) {
      onMessage?.({ type: 'error', text: error.message });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateNew = () => {
    setFormData({ academicYear: '', displayName: '', isActive: 1 });
    setEditing(null);
  };

  const handleEdit = (year) => {
    setFormData({
      academicYear: year.academicYear,
      displayName: year.displayName || '',
      isActive: year.isActive
    });
    setEditing(year.id);
  };

  const cancelEdit = () => {
    setEditing(null);
    setFormData({ academicYear: '', displayName: '', isActive: 1 });
  };

  const handleSave = async (e) => {
    e.preventDefault();

    if (!formData.academicYear.trim()) {
      onMessage?.({ type: 'error', text: 'Academic Year is required' });
      return;
    }

    try {
      setLoading(true);
      const payload = {
        academicYear: formData.academicYear.trim(),
        displayName: formData.displayName.trim() || formData.academicYear.trim(),
        isActive: Number(formData.isActive)
      };

      if (editing) {
        await api(`/academic-years/${editing}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
        onMessage?.({ type: 'success', text: 'Academic Year updated successfully' });
      } else {
        await api('/academic-years', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        onMessage?.({ type: 'success', text: 'Academic Year created successfully' });
      }

      await loadYears();
      cancelEdit();
    } catch (error) {
      onMessage?.({ type: 'error', text: error.message });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this academic year?')) return;

    try {
      setLoading(true);
      await api(`/academic-years/${id}`, { method: 'DELETE' });
      onMessage?.({ type: 'success', text: 'Academic Year deleted successfully' });
      await loadYears();
    } catch (error) {
      onMessage?.({ type: 'error', text: error.message });
    } finally {
      setLoading(false);
    }
  };

  const handleToggleStatus = async (year) => {
    try {
      setLoading(true);
      await api(`/academic-years/${year.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          academicYear: year.academicYear,
          displayName: year.displayName,
          isActive: year.isActive ? 0 : 1
        })
      });
      onMessage?.({ type: 'success', text: 'Status updated successfully' });
      await loadYears();
    } catch (error) {
      onMessage?.({ type: 'error', text: error.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="panel">
      <div className="panel-title">
        <div>
          <h2>Academic Years</h2>
          <p>Add, edit, or mark years active/inactive for admissions</p>
        </div>
      </div>

      <div className="config-content">
        <form className={`config-add ${editing ? 'editing' : ''}`} onSubmit={handleSave}>
          <div className="config-form-title">
            <h3>{editing ? 'Edit' : 'Add'} academic year</h3>
            {editing && <button type="button" title="Cancel editing" onClick={cancelEdit}><X size={15} /></button>}
          </div>

          <label>
            Academic Year *
            <input
              required
              maxLength="20"
              value={formData.academicYear}
              onChange={(e) => setFormData({ ...formData, academicYear: e.target.value })}
              placeholder="e.g., 2026-27"
            />
          </label>

          <label>
            Display Name
            <input
              maxLength="100"
              value={formData.displayName}
              onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
              placeholder="e.g., 2026-2027"
            />
          </label>

          <label>
            Active status *
            <span className="config-yes-no">
              <button
                type="button"
                className={formData.isActive ? 'active' : ''}
                onClick={() => setFormData({ ...formData, isActive: 1 })}
              >
                Active
              </button>
              <button
                type="button"
                className={!formData.isActive ? 'active' : ''}
                onClick={() => setFormData({ ...formData, isActive: 0 })}
              >
                Inactive
              </button>
            </span>
          </label>

          <div className="config-form-actions">
            <button className="primary" disabled={loading}>
              {editing ? <Pencil size={15} /> : <Plus size={16} />}
              {loading ? 'Saving…' : editing ? 'Save changes' : 'Add year'}
            </button>
            {editing && <button type="button" className="secondary" onClick={cancelEdit}>Cancel</button>}
          </div>
        </form>

        <div className="config-list">
          <div className="config-list-tools">
            <span>{years.length} years</span>
          </div>
          <div className="config-records">
            {years.map(year => (
              <article key={year.id} className={editing === year.id ? 'selected' : ''}>
                <div>
                  <strong>{year.academicYear}</strong>
                  <small>{year.displayName || year.academicYear}</small>
                </div>
                <div className="config-record-actions">
                  <button className="config-edit" onClick={() => handleEdit(year)}>
                    <Pencil size={14} /> Edit
                  </button>
                  <button
                    className={`config-status ${year.isActive ? 'active' : 'inactive'}`}
                    onClick={() => handleToggleStatus(year)}
                  >
                    <i />
                    {year.isActive ? 'Active' : 'Inactive'}
                  </button>
                </div>
              </article>
            ))}
            {years.length === 0 && (
              <div className="empty">
                <strong>No academic years found</strong>
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        .config-content{padding:20px;display:grid;grid-template-columns:380px 1fr;gap:20px}
        .config-add{display:grid;gap:14px;background:#f7f8fc;border:1px solid #dfe1ea;border-radius:10px;padding:16px}
        .config-form-title{display:flex;justify-content:space-between;align-items:center;margin-bottom:4px}
        .config-form-title h3{margin:0;font:700 14px;color:#222439}
        .config-form-title button{border:0;background:none;color:#9294a4;cursor:pointer;padding:4px;display:grid;place-items:center}
        .config-add label{display:grid;gap:7px;font-weight:600;font-size:12px;color:#55576d}
        .config-add input{border:1px solid #dfe1ea;border-radius:8px;padding:10px 11px;outline:none;background:#fff}
        .config-add input:focus{border-color:#696ec4;box-shadow:0 0 0 3px #696ec41a}
        .config-yes-no{display:flex;gap:8px;margin-top:3px}
        .config-yes-no button{border:1px solid #dfe1ea;background:#fff;border-radius:8px;padding:9px 13px;font-size:11px;font-weight:600;color:#55576d;cursor:pointer}
        .config-yes-no button.active{border-color:#696ec4;background:#eeeefd;color:#555ab1}
        .config-form-actions{display:flex;gap:9px;margin-top:4px}
        .config-form-actions button{border:0;border-radius:8px;padding:10px 14px;font-weight:700;font-size:12px;display:inline-flex;align-items:center;gap:6px;cursor:pointer}
        .primary{background:#454aa2;color:#fff}
        .primary:hover:not(:disabled){background:#30347d}
        .primary:disabled{opacity:.65}
        .secondary{border:1px solid #dfe1ea;background:#fff;color:#55576d}
        .secondary:hover{border-color:#696ec4;background:#f0f0fc}
        .config-list{display:flex;flex-direction:column;gap:12px}
        .config-list-tools{display:flex;justify-content:space-between;align-items:center;padding:0 12px;font-size:12px;color:#73758b}
        .config-records{display:grid;gap:8px}
        .config-records article{display:flex;justify-content:space-between;align-items:center;padding:14px 12px;border:1px solid #dfe1ea;border-radius:8px;background:#fff}
        .config-records article.selected{border-color:#696ec4;background:#f5f5fc;box-shadow:inset 0 0 0 1px #696ec41a}
        .config-records article>div:first-child{display:grid;gap:2px}
        .config-records article strong{font-size:12px;color:#222439}
        .config-records article small{font-size:11px;color:#8c8e9d}
        .config-record-actions{display:flex;gap:8px}
        .config-edit{border:0;background:none;color:#555ab1;font-weight:600;font-size:11px;cursor:pointer;display:inline-flex;align-items:center;gap:5px}
        .config-edit:hover{text-decoration:underline}
        .config-status{border:0;background:none;color:#555ab1;font-weight:600;font-size:11px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border-radius:6px}
        .config-status i{display:inline-block;width:7px;height:7px;border-radius:50%;background:#dfe1ea}
        .config-status.active i{background:#278a6d}
        .config-status.active{color:#278a6d}
        .config-status.inactive i{background:#d9d9e0}
        .config-status.inactive{color:#9294a4}
        .empty{text-align:center;padding:20px;color:#8c8e9e;font-size:12px}
        .empty strong{color:#222439}
        @media(max-width:1024px){.config-content{grid-template-columns:1fr}}
      `}</style>
    </section>
  );
}
