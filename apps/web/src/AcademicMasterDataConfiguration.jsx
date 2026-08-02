import { useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Search, X } from 'lucide-react';
import { api } from './api';

const configs = {
  curricula: {
    title: 'Curriculum',
    description: 'Configure curricula that can be mapped to admission classes and enquiries.',
    endpoint: '/curricula',
    codeLabel: 'Curriculum code',
    codePlaceholder: 'CBSE',
    nameLabel: 'Curriculum name',
    namePlaceholder: 'CBSE',
    showPosition: true,
  },
  admissionTypes: {
    title: 'Admission Types',
    description: 'Configure admission types such as Day Scholar, Hostel, Transport, or any custom option.',
    endpoint: '/admission-types',
    codeLabel: 'Admission type code',
    codePlaceholder: 'day_scholar',
    nameLabel: 'Admission type name',
    namePlaceholder: 'Day Scholar',
    showPosition: false,
  },
};

const emptyForm = { code: '', displayName: '', position: 0, isActive: true };

export default function AcademicMasterDataConfiguration({ type, onMessage }) {
  const config = configs[type] || configs.curricula;
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => { loadItems(); }, [config.endpoint]);

  const loadItems = async () => {
    try {
      setLoading(true);
      const response = await api(config.endpoint);
      setItems(response.data || []);
    } catch (error) {
      onMessage?.({ type: 'error', text: error.message });
    } finally {
      setLoading(false);
    }
  };

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return items;
    return items.filter(item => `${item.code} ${item.displayName}`.toLowerCase().includes(query));
  }, [items, search]);

  const resetForm = () => {
    setEditing(null);
    setForm(emptyForm);
  };

  const editItem = item => {
    setEditing(item.id);
    setForm({
      code: item.code || '',
      displayName: item.displayName || '',
      position: item.position || 0,
      isActive: item.isActive !== 0 && item.isActive !== false,
    });
  };

  const saveItem = async event => {
    event.preventDefault();
    if (!form.code.trim() || !form.displayName.trim()) {
      onMessage?.({ type: 'error', text: `${config.codeLabel} and ${config.nameLabel} are required` });
      return;
    }
    try {
      setLoading(true);
      await api(editing ? `${config.endpoint}/${editing}` : config.endpoint, {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify({
          code: form.code.trim(),
          displayName: form.displayName.trim(),
          position: Number(form.position) || 0,
          isActive: form.isActive,
        }),
      });
      onMessage?.({ type: 'success', text: `${config.title} saved successfully` });
      await loadItems();
      resetForm();
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
          <h2>{config.title}</h2>
          <p>{config.description}</p>
        </div>
      </div>

      <div className="config-content">
        <form className={`config-add ${editing ? 'editing' : ''}`} onSubmit={saveItem}>
          <div className="config-form-title">
            <h3>{editing ? 'Edit' : 'Add'} {config.title.toLowerCase()}</h3>
            {editing && <button type="button" title="Cancel editing" onClick={resetForm}><X size={15} /></button>}
          </div>

          <label>
            {config.codeLabel} *
            <input value={form.code} onChange={event => setForm({ ...form, code: event.target.value })} placeholder={config.codePlaceholder} />
          </label>

          <label>
            {config.nameLabel} *
            <input value={form.displayName} onChange={event => setForm({ ...form, displayName: event.target.value })} placeholder={config.namePlaceholder} />
          </label>

          {config.showPosition && (
            <label>
              Display order
              <input type="number" min="0" value={form.position} onChange={event => setForm({ ...form, position: event.target.value })} />
            </label>
          )}

          <label className="config-check">
            <input type="checkbox" checked={form.isActive} onChange={event => setForm({ ...form, isActive: event.target.checked })} />
            Active
          </label>

          <div className="config-form-actions">
            <button className="primary" disabled={loading}>{editing ? <Pencil size={15} /> : <Plus size={16} />}{loading ? 'Saving...' : editing ? 'Save changes' : 'Add configuration'}</button>
            {editing && <button type="button" className="secondary" onClick={resetForm}>Cancel</button>}
          </div>
        </form>

        <div className="config-list">
          <div className="config-list-tools">
            <div className="local-search"><Search size={16} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder={`Search ${config.title.toLowerCase()}...`} /></div>
            <span>{filteredItems.length} records</span>
          </div>

          <div className="config-records">
            {filteredItems.map(item => (
              <article key={item.id} className={editing === item.id ? 'selected' : ''}>
                <div>
                  <strong>{item.displayName}</strong>
                  <small>{item.code}{config.showPosition ? ` · Order ${item.position || 0}` : ''} · {item.isActive === 0 || item.isActive === false ? 'Inactive' : 'Active'}</small>
                </div>
                <div className="config-record-actions">
                  <button className="config-edit" type="button" onClick={() => editItem(item)}><Pencil size={14} /> Edit</button>
                </div>
              </article>
            ))}
            {!filteredItems.length && <div className="empty"><strong>{items.length ? 'No results match your search' : `No ${config.title.toLowerCase()} found`}</strong></div>}
          </div>
        </div>
      </div>
    </section>
  );
}
