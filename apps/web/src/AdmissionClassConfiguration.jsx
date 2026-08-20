import { useEffect, useRef, useState } from 'react';
import { Plus, Pencil, X, Search } from 'lucide-react';
import { api } from './api';
import ConfigMultiSelect from './components/ConfigMultiSelect.jsx';

const emptyForm = { academicYear: '', branchIds: [], curriculumIds: [], admissionTypeIds: [], classIds: [] };

export default function AdmissionClassConfiguration({ onMessage }) {
  const [configurations, setConfigurations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [formData, setFormData] = useState(emptyForm);
  const [masterData, setMasterData] = useState({ academicYears: [], branches: [], curricula: [], admissionTypes: [], classes: [] });
  const [openPicker, setOpenPicker] = useState('');
  const [pickerSearch, setPickerSearch] = useState({});

  useEffect(() => { loadConfigurations(); loadMasterData(); }, []);

  const loadConfigurations = async () => {
    try { setLoading(true); const response = await api('/admission-class-configurations'); setConfigurations(response.data || []); }
    catch (error) { onMessage?.({ type: 'error', text: error.message }); }
    finally { setLoading(false); }
  };

  const loadMasterData = async () => {
    try { setMasterData(await api('/admission-class-master-data')); }
    catch { onMessage?.({ type: 'error', text: 'Failed to load academic master data' }); }
  };

  const cancelEdit = () => { setEditing(null); setFormData(emptyForm); setPickerSearch({}); setOpenPicker(''); };

  const handleEdit = async (id) => {
    try {
      const response = await api(`/admission-class-configurations/${id}`);
      setFormData({
        academicYear: String(response.academicYear),
        branchIds: [String(response.branchId)],
        curriculumIds: [String(response.curriculumId)],
        admissionTypeIds: [String(response.admissionTypeId)],
        classIds: response.classIds.map(String),
      });
      setEditing(id);
    } catch (error) {
      onMessage?.({ type: 'error', text: error.message });
    }
  };

  const handleSave = async (event) => {
    event.preventDefault();
    if (!formData.academicYear || !formData.branchIds.length || !formData.curriculumIds.length || !formData.admissionTypeIds.length) {
      onMessage?.({ type: 'error', text: 'Academic year, branch, curriculum and admission type are required' });
      return;
    }
    if (!formData.classIds.length) {
      onMessage?.({ type: 'error', text: 'At least one class must be selected' });
      return;
    }
    const payload = {
      academicYear: String(formData.academicYear),
      branchIds: formData.branchIds.map(Number),
      curriculumIds: formData.curriculumIds.map(Number),
      admissionTypeIds: formData.admissionTypeIds.map(Number),
      branchId: Number(formData.branchIds[0]),
      curriculumId: Number(formData.curriculumIds[0]),
      admissionTypeId: Number(formData.admissionTypeIds[0]),
      classIds: formData.classIds.map(Number),
    };
    try {
      setLoading(true);
      const result = await api(editing ? `/admission-class-configurations/${editing}` : '/admission-class-configurations', {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      });
      onMessage?.({ type: 'success', text: result.message || (editing ? 'Configuration updated successfully' : 'Configuration created successfully') });
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
    try { setLoading(true); await api(`/admission-class-configurations/${id}`, { method: 'DELETE' }); onMessage?.({ type: 'success', text: 'Configuration deleted successfully' }); await loadConfigurations(); }
    catch (error) { onMessage?.({ type: 'error', text: error.message }); }
    finally { setLoading(false); }
  };

  const filteredConfigs = configurations.filter(config =>
    `${config.academicYear} ${config.branch} ${config.curriculum} ${config.admissionType}`.toLowerCase().includes(search.toLowerCase())
  );

  return <section className="panel">
    <div className="panel-title"><div><h2>Admission Class Configuration</h2><p>Create class availability for one or multiple branches, curricula and admission types at once.</p></div></div>
    <div className="config-content">
      <form className={`config-add ${editing ? 'editing' : ''}`} onSubmit={handleSave}>
        <div className="config-form-title"><h3>{editing ? 'Edit' : 'Add'} admission class configuration</h3>{editing && <button type="button" title="Cancel editing" onClick={cancelEdit}><X size={15} /></button>}</div>
        <label>Academic Year *<select required value={formData.academicYear} onChange={event => setFormData({ ...formData, academicYear: event.target.value })}><option value="">Select academic year</option>{masterData.academicYears.map(year => <option key={year.id} value={year.academicYear}>{year.displayName || year.academicYear}</option>)}</select></label>
        <ConfigMultiSelect label="Branch *" name="branchIds" placeholder="Select branches" options={masterData.branches.map(item => ({ id: item.id, label: item.name }))} selected={formData.branchIds} disabled={Boolean(editing)} openPicker={openPicker} setOpenPicker={setOpenPicker} search={pickerSearch.branchIds || ''} setSearch={value => setPickerSearch(current => ({ ...current, branchIds: value }))} onChange={values => setFormData({ ...formData, branchIds: values })} />
        <ConfigMultiSelect label="Curriculum *" name="curriculumIds" placeholder="Select curricula" options={masterData.curricula.filter(item => item.isActive !== 0 && item.isActive !== false).map(item => ({ id: item.id, label: item.displayName }))} selected={formData.curriculumIds} disabled={Boolean(editing)} openPicker={openPicker} setOpenPicker={setOpenPicker} search={pickerSearch.curriculumIds || ''} setSearch={value => setPickerSearch(current => ({ ...current, curriculumIds: value }))} onChange={values => setFormData({ ...formData, curriculumIds: values })} />
        <ConfigMultiSelect label="Admission Type *" name="admissionTypeIds" placeholder="Select admission types" options={masterData.admissionTypes.filter(item => item.isActive !== 0 && item.isActive !== false).map(item => ({ id: item.id, label: item.displayName }))} selected={formData.admissionTypeIds} disabled={Boolean(editing)} openPicker={openPicker} setOpenPicker={setOpenPicker} search={pickerSearch.admissionTypeIds || ''} setSearch={value => setPickerSearch(current => ({ ...current, admissionTypeIds: value }))} onChange={values => setFormData({ ...formData, admissionTypeIds: values })} />
        <ConfigMultiSelect label="Classes *" name="classIds" placeholder="Select classes" options={masterData.classes.map(item => ({ id: item.id, label: item.displayName }))} selected={formData.classIds} openPicker={openPicker} setOpenPicker={setOpenPicker} search={pickerSearch.classIds || ''} setSearch={value => setPickerSearch(current => ({ ...current, classIds: value }))} onChange={values => setFormData({ ...formData, classIds: values })} />
        {editing && <p className="bulk-edit-note">Bulk branch/curriculum/admission type selection is available while creating. Edit updates this selected combination only.</p>}
        <div className="config-form-actions"><button className="primary" disabled={loading}>{editing ? <Pencil size={15} /> : <Plus size={16} />}{loading ? 'Saving...' : editing ? 'Save changes' : 'Add configuration'}</button>{editing && <button type="button" className="secondary" onClick={cancelEdit}>Cancel</button>}</div>
      </form>
      <div className="config-list">
        <div className="config-list-tools"><div className="local-search"><Search size={16} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search configurations..." /></div><span>{filteredConfigs.length} configurations</span></div>
        <div className="config-records">{filteredConfigs.map(config => <article key={config.id} className={editing === config.id ? 'selected' : ''}><div><strong>{config.academicYear} · {config.branch}</strong><small>{config.curriculum} · {config.admissionType} · {config.classCount} classes</small></div><div className="config-record-actions"><button className="config-edit" onClick={() => handleEdit(config.id)}><Pencil size={14} /> Edit</button><button className="config-delete" onClick={() => handleDelete(config.id)} title="Delete">×</button></div></article>)}{!filteredConfigs.length && <div className="empty"><strong>{configurations.length ? 'No results match your search' : 'No configurations found'}</strong></div>}</div>
      </div>
    </div>
  </section>;
}
