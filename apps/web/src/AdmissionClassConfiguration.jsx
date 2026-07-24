import { useState, useEffect } from 'react';
import { Plus, Pencil, X, Search } from 'lucide-react';
import { api } from './api';

export default function AdmissionClassConfiguration({ onMessage }) {
  const [configurations, setConfigurations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);

  const [formData, setFormData] = useState({
    academicYear: '',
    branchId: '',
    curriculumId: '',
    admissionTypeId: '',
    classIds: []
  });

  const [masterData, setMasterData] = useState({
    academicYears: [],
    branches: [],
    curricula: [],
    admissionTypes: [],
    classes: []
  });

  const [classDropdownOpen, setClassDropdownOpen] = useState(false);
  const [classSearch, setClassSearch] = useState('');

  useEffect(() => {
    loadConfigurations();
    loadMasterData();
  }, []);

  const loadConfigurations = async () => {
    try {
      setLoading(true);
      const response = await api('/admission-class-configurations');
      setConfigurations(response.data || []);
    } catch (error) {
      onMessage?.({ type: 'error', text: error.message });
    } finally {
      setLoading(false);
    }
  };

  const loadMasterData = async () => {
    try {
      const meta = await api('/leads/meta');
      setMasterData({
        academicYears: meta.academicYears || [],
        branches: meta.branches || [],
        curricula: meta.curricula || [],
        admissionTypes: meta.admissionTypes || [],
        classes: meta.classes || []
      });
    } catch (error) {
      onMessage?.({ type: 'error', text: 'Failed to load master data' });
    }
  };

  const cancelEdit = () => {
    setEditing(null);
    setFormData({
      academicYear: '',
      branchId: '',
      curriculumId: '',
      admissionTypeId: '',
      classIds: []
    });
    setClassSearch('');
  };

  const handleCreateNew = () => {
    cancelEdit();
  };

  const handleEdit = async (id) => {
    try {
      const response = await api(`/admission-class-configurations/${id}`);
      setFormData({
        academicYear: String(response.academicYear),
        branchId: String(response.branchId),
        curriculumId: String(response.curriculumId),
        admissionTypeId: String(response.admissionTypeId),
        classIds: response.classIds.map(String)
      });
      setEditing(id);
    } catch (error) {
      onMessage?.({ type: 'error', text: error.message });
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();

    if (!formData.academicYear || !formData.branchId || !formData.curriculumId || !formData.admissionTypeId) {
      onMessage?.({ type: 'error', text: 'All fields are required' });
      return;
    }

    if (formData.classIds.length === 0) {
      onMessage?.({ type: 'error', text: 'At least one class must be selected' });
      return;
    }

    try {
      setLoading(true);
      const payload = {
        academicYear: String(formData.academicYear),
        branchId: Number(formData.branchId),
        curriculumId: Number(formData.curriculumId),
        admissionTypeId: Number(formData.admissionTypeId),
        classIds: formData.classIds.map(Number)
      };

      if (editing) {
        await api(`/admission-class-configurations/${editing}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
        onMessage?.({ type: 'success', text: 'Configuration updated successfully' });
      } else {
        await api('/admission-class-configurations', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        onMessage?.({ type: 'success', text: 'Configuration created successfully' });
      }

      await loadConfigurations();
      cancelEdit();
    } catch (error) {
      onMessage?.({ type: 'error', text: error.message });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this configuration?')) return;

    try {
      setLoading(true);
      await api(`/admission-class-configurations/${id}`, { method: 'DELETE' });
      onMessage?.({ type: 'success', text: 'Configuration deleted successfully' });
      await loadConfigurations();
    } catch (error) {
      onMessage?.({ type: 'error', text: error.message });
    } finally {
      setLoading(false);
    }
  };

  const toggleClass = (classId) => {
    setFormData(prev => ({
      ...prev,
      classIds: prev.classIds.includes(classId)
        ? prev.classIds.filter(id => id !== classId)
        : [...prev.classIds, classId]
    }));
  };

  const filteredClasses = masterData.classes.filter(c =>
    c.displayName.toLowerCase().includes(classSearch.toLowerCase())
  );

  const selectedClassNames = formData.classIds
    .map(id => masterData.classes.find(c => String(c.id) === id)?.displayName)
    .filter(Boolean);

  const filteredConfigs = configurations.filter(config =>
    `${config.academicYear} ${config.branch} ${config.curriculum} ${config.admissionType}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <section className="panel">
      <div className="panel-title">
        <div>
          <h2>Admission Class Configuration</h2>
          <p>Manage classes available for specific academic year, branch, curriculum, and admission type combinations</p>
        </div>
      </div>

      <div className="config-content">
        <form className={`config-add ${editing ? 'editing' : ''}`} onSubmit={handleSave}>
          <div className="config-form-title">
            <h3>{editing ? 'Edit' : 'Add'} admission class configuration</h3>
            {editing && <button type="button" title="Cancel editing" onClick={cancelEdit}><X size={15} /></button>}
          </div>

          <label>
            Academic Year *
            <select
              required
              value={formData.academicYear}
              onChange={(e) => setFormData({ ...formData, academicYear: e.target.value })}
            >
              <option value="">Select academic year</option>
              {masterData.academicYears.map(ay => (
                <option key={ay.id} value={ay.academicYear}>{ay.academicYear}</option>
              ))}
            </select>
          </label>

          <label>
            Branch *
            <select
              required
              value={formData.branchId}
              onChange={(e) => setFormData({ ...formData, branchId: e.target.value })}
            >
              <option value="">Select branch</option>
              {masterData.branches.map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </label>

          <label>
            Curriculum *
            <select
              required
              value={formData.curriculumId}
              onChange={(e) => setFormData({ ...formData, curriculumId: e.target.value })}
            >
              <option value="">Select curriculum</option>
              {masterData.curricula.map(c => (
                <option key={c.id} value={c.id}>{c.displayName}</option>
              ))}
            </select>
          </label>

          <label>
            Admission Type *
            <select
              required
              value={formData.admissionTypeId}
              onChange={(e) => setFormData({ ...formData, admissionTypeId: e.target.value })}
            >
              <option value="">Select admission type</option>
              {masterData.admissionTypes.map(at => (
                <option key={at.id} value={at.id}>{at.displayName}</option>
              ))}
            </select>
          </label>

          <div className="label">
            <span>Classes *</span>
            <div className="multi-select-wrapper" style={{ position: 'relative' }}>
              <div
                className="multi-select-trigger"
                onClick={() => setClassDropdownOpen(!classDropdownOpen)}
              >
                <div className="selected-items">
                  {selectedClassNames.length > 0 ? (
                    selectedClassNames.map(name => (
                      <span key={name} className="badge">{name}</span>
                    ))
                  ) : (
                    <span className="placeholder">Select classes</span>
                  )}
                </div>
              </div>

              {classDropdownOpen && (
                <div className="multi-select-dropdown">
                  <div className="search-box">
                    <Search size={14} />
                    <input
                      type="text"
                      placeholder="Search classes…"
                      value={classSearch}
                      onChange={(e) => setClassSearch(e.target.value)}
                      autoFocus
                    />
                  </div>
                  <div className="actions">
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, classIds: masterData.classes.map(c => String(c.id)) })}
                    >
                      Select all
                    </button>
                    <button type="button" onClick={() => setFormData({ ...formData, classIds: [] })}>
                      Clear all
                    </button>
                  </div>
                  <div className="options">
                    {filteredClasses.map(cls => (
                      <label key={cls.id} className="checkbox-item">
                        <input
                          type="checkbox"
                          checked={formData.classIds.includes(String(cls.id))}
                          onChange={() => toggleClass(String(cls.id))}
                        />
                        <span>{cls.displayName}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="config-form-actions">
            <button className="primary" disabled={loading}>
              {editing ? <Pencil size={15} /> : <Plus size={16} />}
              {loading ? 'Saving…' : editing ? 'Save changes' : 'Add configuration'}
            </button>
            {editing && <button type="button" className="secondary" onClick={cancelEdit}>Cancel</button>}
          </div>
        </form>

        <div className="config-list">
          <div className="config-list-tools">
            <div className="local-search">
              <Search size={16} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search configurations…" />
            </div>
            <span>{filteredConfigs.length} configurations</span>
          </div>
          <div className="config-records">
            {filteredConfigs.map(config => (
              <article key={config.id} className={editing === config.id ? 'selected' : ''}>
                <div>
                  <strong>{config.academicYear} · {config.branch}</strong>
                  <small>{config.curriculum} · {config.admissionType} · {config.classCount} classes</small>
                </div>
                <div className="config-record-actions">
                  <button className="config-edit" onClick={() => handleEdit(config.id)}>
                    <Pencil size={14} /> Edit
                  </button>
                  <button className="config-delete" onClick={() => handleDelete(config.id)} title="Delete">
                    ×
                  </button>
                </div>
              </article>
            ))}
            {filteredConfigs.length === 0 && (
              <div className="empty">
                <strong>{configurations.length === 0 ? 'No configurations found' : 'No results match your search'}</strong>
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        .config-content{padding:20px;display:grid;grid-template-columns:420px 1fr;gap:20px}
        .config-add{display:grid;gap:14px;background:#f7f8fc;border:1px solid #dfe1ea;border-radius:10px;padding:16px}
        .config-form-title{display:flex;justify-content:space-between;align-items:center;margin-bottom:4px}
        .config-form-title h3{margin:0;font:700 14px;color:#222439}
        .config-form-title button{border:0;background:none;color:#9294a4;cursor:pointer;padding:4px;display:grid;place-items:center}
        .config-add label{display:grid;gap:7px;font-weight:600;font-size:12px;color:#55576d}
        .config-add select{border:1px solid #dfe1ea;border-radius:8px;padding:10px 11px;outline:none;background:#fff;width:100%;color:#222439;cursor:pointer}
        .config-add select:focus{border-color:#696ec4;box-shadow:0 0 0 3px #696ec41a}
        .multi-select-wrapper{width:100%}
        .multi-select-trigger{border:1px solid #dfe1ea;border-radius:8px;padding:8px 11px;background:#fff;cursor:pointer;display:flex;align-items:center;gap:8px;min-height:40px;flex-wrap:wrap}
        .multi-select-trigger:hover{border-color:#696ec4}
        .selected-items{display:flex;gap:6px;flex-wrap:wrap;flex:1}
        .badge{background:#eeeefd;color:#555ab1;padding:4px 10px;border-radius:6px;font-size:11px;font-weight:600;display:inline-flex;align-items:center}
        .placeholder{color:#9294a4;font-size:12px}
        .multi-select-dropdown{position:absolute;top:calc(100% + 4px);left:0;right:0;z-index:10;background:#fff;border:1px solid #dfe1ea;border-radius:8px;box-shadow:0 8px 24px #24264c12;overflow:hidden}
        .search-box{display:flex;align-items:center;gap:8px;padding:10px;border-bottom:1px solid #ececf1;color:#9294a4}
        .search-box input{border:0;outline:0;flex:1;font-size:12px;background:transparent}
        .search-box input::placeholder{color:#9294a4}
        .multi-select-dropdown .actions{display:flex;gap:6px;padding:8px;border-bottom:1px solid #ececf1}
        .multi-select-dropdown .actions button{border:1px solid #dfe1ea;background:#fff;border-radius:6px;padding:7px 11px;font-size:11px;font-weight:600;color:#55576d;cursor:pointer}
        .multi-select-dropdown .actions button:hover{border-color:#696ec4;background:#f0f0fc}
        .options{max-height:220px;overflow-y:auto;padding:4px}
        .checkbox-item{display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;border-radius:6px}
        .checkbox-item:hover{background:#f5f5fb}
        .checkbox-item input{width:15px;height:15px;cursor:pointer;accent-color:#696ec4}
        .checkbox-item span{font-size:11px;color:#222439}
        .config-form-actions{display:flex;gap:9px;margin-top:4px}
        .config-form-actions button{border:0;border-radius:8px;padding:10px 14px;font-weight:700;font-size:12px;display:inline-flex;align-items:center;gap:6px;cursor:pointer}
        .primary{background:#454aa2;color:#fff}
        .primary:hover:not(:disabled){background:#30347d}
        .primary:disabled{opacity:.65}
        .secondary{border:1px solid #dfe1ea;background:#fff;color:#55576d}
        .secondary:hover{border-color:#696ec4;background:#f0f0fc}
        .config-list{display:flex;flex-direction:column;gap:12px}
        .config-list-tools{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:0 12px;font-size:12px;color:#73758b}
        .local-search{display:flex;align-items:center;gap:8px;flex:1;border:1px solid #dfe1ea;border-radius:8px;padding:0 10px;color:#9294a4}
        .local-search input{border:0;outline:0;flex:1;padding:8px 0;font-size:12px;background:transparent}
        .local-search input::placeholder{color:#9294a4}
        .config-records{display:grid;gap:8px}
        .config-records article{display:flex;justify-content:space-between;align-items:center;padding:14px 12px;border:1px solid #dfe1ea;border-radius:8px;background:#fff}
        .config-records article.selected{border-color:#696ec4;background:#f5f5fc;box-shadow:inset 0 0 0 1px #696ec41a}
        .config-records article>div:first-child{display:grid;gap:2px;flex:1}
        .config-records article strong{font-size:12px;color:#222439}
        .config-records article small{font-size:11px;color:#8c8e9d}
        .config-record-actions{display:flex;gap:6px}
        .config-edit{border:0;background:none;color:#555ab1;font-weight:600;font-size:11px;cursor:pointer;display:inline-flex;align-items:center;gap:5px}
        .config-edit:hover{text-decoration:underline}
        .config-delete{border:1px solid #f5e5e5;background:#fff;color:#b84848;width:28px;height:28px;border-radius:6px;cursor:pointer;display:grid;place-items:center;font-size:18px;line-height:1;font-weight:300}
        .config-delete:hover{background:#fff0f0;border-color:#e7b5b5}
        .empty{text-align:center;padding:20px;color:#8c8e9e;font-size:12px}
        .empty strong{color:#222439}
        @media(max-width:1200px){.config-content{grid-template-columns:1fr}}
      `}</style>
    </section>
  );
}
