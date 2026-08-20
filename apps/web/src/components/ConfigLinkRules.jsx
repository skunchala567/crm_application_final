import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Pencil, Plus, Search, Sliders, X } from 'lucide-react';
import ConfigMultiSelect from './ConfigMultiSelect.jsx';

/**
 * Configuration that answers a question instead of just listing values.
 *
 * A section on its own can only say what exists. The admission class
 * configuration in School Admissions does something more useful: it says that
 * at *this* branch, for *this* year and curriculum, *these* classes are on
 * offer, and the enquiry form narrows its dropdowns to match. That shape was
 * welded to four fixed columns and to classes.
 *
 * A link is the same shape with the columns pulled out: it names which
 * sections (and optionally a branch) form a key, and which section answers.
 * Because a link can also name a pipeline, one unit's admissions and franchise
 * leads no longer have to share one set of questions.
 *
 * Deliberately built from the same parts as the admission class screen -- the
 * same `config-add` form, the same searchable multi-select, the same list
 * beside it -- because someone who has used that screen already knows this one.
 */

const emptyRule = {
  displayName: '', description: '', pipelineId: '', resultSectionId: '',
  includesBranch: true, keySectionIds: [], isActive: true,
};

export default function ConfigLinkRules({ sections, pipelines, branches, call, onMessage, onChanged }) {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyRule);
  const [openRule, setOpenRule] = useState(null);
  const [search, setSearch] = useState('');
  const [openPicker, setOpenPicker] = useState('');
  const [pickerSearch, setPickerSearch] = useState({});

  const patch = changes => setForm(prev => ({ ...prev, ...changes }));
  const searchFor = name => ({
    search: pickerSearch[name] || '',
    setSearch: value => setPickerSearch(current => ({ ...current, [name]: value })),
  });

  const load = useCallback(async () => {
    try {
      const result = await call('/business-config/link-rules');
      setRules(result.data || []);
    } catch (error) {
      onMessage?.({ type: 'error', text: error.message });
    } finally {
      setLoading(false);
    }
  }, [call, onMessage]);

  useEffect(() => { load(); }, [load]);

  /* A section can answer a link only if it holds values. Offering an empty
     section would build a link that resolves to nothing. */
  const answerable = useMemo(
    () => sections.filter(section => (section.values || []).length > 0),
    [sections],
  );

  const cancelEdit = () => { setEditing(null); setForm(emptyRule); setPickerSearch({}); setOpenPicker(''); };

  const handleSave = async event => {
    event.preventDefault();
    if (!form.includesBranch && !form.keySectionIds.length) {
      onMessage?.({ type: 'error', text: 'Choose a branch or at least one configuration to key this link on' });
      return;
    }
    try {
      const result = await call(editing ? `/business-config/link-rules/${editing}` : '/business-config/link-rules', {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify({
          displayName: form.displayName,
          description: form.description,
          pipelineId: form.pipelineId || null,
          resultSectionId: Number(form.resultSectionId),
          includesBranch: form.includesBranch,
          keySectionIds: form.keySectionIds.map(Number),
          isActive: form.isActive,
        }),
      });
      // Changing a key invalidates every saved combination. The API says how
      // many it removed rather than letting the work disappear quietly.
      const cleared = Number(result.data?.clearedRows) || 0;
      onMessage?.({
        type: cleared ? 'info' : 'success',
        text: cleared
          ? `Link saved. ${cleared} saved combination${cleared === 1 ? '' : 's'} were cleared because the question changed.`
          : 'Configuration link saved',
      });
      cancelEdit();
      await load();
      onChanged?.();
    } catch (error) {
      onMessage?.({ type: 'error', text: error.message });
    }
  };

  const handleDelete = async rule => {
    if (!window.confirm(`Delete "${rule.displayName}" and its ${rule.rowCount} saved combination${rule.rowCount === 1 ? '' : 's'}?`)) return;
    try {
      await call(`/business-config/link-rules/${rule.id}`, { method: 'DELETE' });
      onMessage?.({ type: 'success', text: 'Configuration link deleted' });
      await load();
    } catch (error) {
      onMessage?.({ type: 'error', text: error.message });
    }
  };

  const handleEdit = rule => {
    setEditing(rule.id);
    setForm({
      displayName: rule.displayName,
      description: rule.description || '',
      pipelineId: rule.pipelineId ? String(rule.pipelineId) : '',
      resultSectionId: String(rule.resultSectionId),
      includesBranch: rule.includesBranch,
      keySectionIds: rule.keySections.map(section => String(section.sectionId)),
      isActive: rule.isActive,
    });
  };

  if (openRule) {
    return (
      <RuleRows rule={openRule} sections={sections} branches={branches} call={call}
        onMessage={onMessage} onBack={() => { setOpenRule(null); load(); }}/>
    );
  }

  const filtered = rules.filter(rule =>
    `${rule.displayName} ${rule.resultSectionName} ${rule.pipelineName || ''}`
      .toLowerCase().includes(search.toLowerCase()));

  /* The sentence the link will read as, kept under the form so the effect of
     each field is visible before anything is saved. */
  const keyNames = [
    form.includesBranch ? 'branch' : null,
    ...form.keySectionIds.map(id => sections.find(s => String(s.id) === String(id))?.displayName),
  ].filter(Boolean);
  const answerName = sections.find(s => String(s.id) === String(form.resultSectionId))?.displayName;

  return (
    <section className="panel">
      <div className="panel-title">
        <div>
          <h2>Linked configuration</h2>
          <p>Decide which values are offered once a branch and other choices are known.</p>
        </div>
      </div>

      {/* Repeated outside .panel-title, which is hidden when this screen is
          embedded in a business unit tab -- taking any control inside it with
          it, including the way back from a link's combinations. */}
      <div className="config-subhead">
        <div>
          <strong>Linked configuration</strong>
          <span>
            Decide which values are offered once a branch and other choices are known — the way
            admission classes depend on a branch and an academic year.
          </span>
        </div>
      </div>

      <div className="config-content">
        <form className={`config-add ${editing ? 'editing' : ''}`} onSubmit={handleSave}>
          <div className="config-form-title">
            <h3>{editing ? 'Edit link' : 'Add link'}</h3>
            {editing && <button type="button" title="Cancel editing" onClick={cancelEdit}><X size={15}/></button>}
          </div>

          <label>Name *
            <input required value={form.displayName} placeholder="e.g. Courses by branch and intake"
              onChange={event => patch({ displayName: event.target.value })}/>
          </label>

          <label>Lead pipeline
            <select value={form.pipelineId} onChange={event => patch({ pipelineId: event.target.value })}>
              <option value="">Every lead pipeline</option>
              {pipelines.map(pipeline => (
                <option key={pipeline.id} value={pipeline.id}>{pipeline.displayName}</option>
              ))}
            </select>
          </label>

          {/* Key first, answer last: the order the admission class form asks in. */}
          <label className="config-inline-check">
            <input type="checkbox" checked={form.includesBranch}
              onChange={event => patch({ includesBranch: event.target.checked })}/>
            <span>The answer depends on the branch</span>
          </label>

          <ConfigMultiSelect
            label="Also depends on" name="keySectionIds" placeholder="Select configurations"
            options={sections
              .filter(section => String(section.id) !== String(form.resultSectionId))
              .map(section => ({ id: section.id, label: section.displayName }))}
            selected={form.keySectionIds}
            openPicker={openPicker} setOpenPicker={setOpenPicker}
            {...searchFor('keySectionIds')}
            onChange={values => patch({ keySectionIds: values })}
          />

          <label>Offers *
            <select required value={form.resultSectionId}
              onChange={event => patch({ resultSectionId: event.target.value })}>
              <option value="">Select a configuration</option>
              {answerable.map(section => (
                <option key={section.id} value={section.id}>{section.displayName}</option>
              ))}
            </select>
          </label>
          {!answerable.length && (
            <p className="bulk-edit-note">
              No configuration has any values yet. Add values under Manage sections first — a link can
              only offer values that exist.
            </p>
          )}

          {answerName && keyNames.length > 0 && (
            <p className="config-sentence">
              Offers <strong>{answerName}</strong> based on <strong>{keyNames.join(' and ')}</strong>.
            </p>
          )}

          <div className="config-form-actions">
            <button className="primary" type="submit">
              {editing ? <Pencil size={15}/> : <Plus size={16}/>}
              {editing ? 'Save changes' : 'Add link'}
            </button>
            {editing && <button type="button" className="secondary" onClick={cancelEdit}>Cancel</button>}
          </div>
        </form>

        <div className="config-list">
          <div className="config-list-tools">
            <div className="local-search">
              <Search size={16}/>
              <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search links..."/>
            </div>
            <span>{filtered.length} link{filtered.length === 1 ? '' : 's'}</span>
          </div>
          <div className="config-records">
            {loading && <div className="loading"><span/></div>}
            {!loading && filtered.map(rule => (
              <article key={rule.id} className={editing === rule.id ? 'selected' : ''}>
                <div>
                  <strong>{rule.displayName}</strong>
                  <small>
                    Offers {rule.resultSectionName} by {[
                      rule.includesBranch ? 'branch' : null,
                      ...rule.keySections.map(section => section.displayName),
                    ].filter(Boolean).join(' and ')}
                  </small>
                  <small>
                    {rule.rowCount} combination{rule.rowCount === 1 ? '' : 's'}
                    {' · '}{rule.pipelineName || 'every pipeline'}
                  </small>
                </div>
                <div className="config-record-actions">
                  <button className="config-edit" type="button" onClick={() => setOpenRule(rule)}>
                    <Sliders size={14}/> Combinations
                  </button>
                  <button className="config-edit" type="button" onClick={() => handleEdit(rule)}>
                    <Pencil size={14}/> Edit
                  </button>
                  <button className="config-delete" type="button" title="Delete" onClick={() => handleDelete(rule)}>×</button>
                </div>
              </article>
            ))}
            {!loading && !filtered.length && (
              <div className="empty">
                <strong>{rules.length ? 'No results match your search' : 'No links yet'}</strong>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * The combinations of one link.
 *
 * Values are picked in bulk and every combination of them is written, which is
 * how the admission class screen fills six branches at once rather than asking
 * for the same form six times.
 */
function RuleRows({ rule, sections, branches, call, onMessage, onBack }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [branchIds, setBranchIds] = useState([]);
  const [keyValueIds, setKeyValueIds] = useState({});
  const [resultValueIds, setResultValueIds] = useState([]);
  const [search, setSearch] = useState('');
  const [openPicker, setOpenPicker] = useState('');
  const [pickerSearch, setPickerSearch] = useState({});

  const searchFor = name => ({
    search: pickerSearch[name] || '',
    setSearch: value => setPickerSearch(current => ({ ...current, [name]: value })),
  });

  const sectionById = useMemo(
    () => new Map(sections.map(section => [Number(section.id), section])),
    [sections],
  );

  /* A hierarchy section keeps its values one level down, so both shapes are
     flattened to the {id, label} pairs the picker expects. */
  const valuesOf = useCallback(sectionId => {
    const section = sectionById.get(Number(sectionId));
    if (!section) return [];
    return (section.values || [])
      .flatMap(value => [value, ...(value.children || [])])
      .map(value => ({ id: value.id, label: value.displayName }));
  }, [sectionById]);

  const load = useCallback(async () => {
    try {
      const result = await call(`/business-config/link-rules/${rule.id}/rows`);
      setRows(result.data || []);
    } catch (error) {
      onMessage?.({ type: 'error', text: error.message });
    } finally {
      setLoading(false);
    }
  }, [call, rule.id, onMessage]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async event => {
    event.preventDefault();
    setSaving(true);
    try {
      const result = await call(`/business-config/link-rules/${rule.id}/rows`, {
        method: 'POST',
        body: JSON.stringify({
          branchIds: branchIds.map(Number),
          keyValueIds: Object.fromEntries(
            Object.entries(keyValueIds).map(([sectionId, ids]) => [sectionId, ids.map(Number)])),
          resultValueIds: resultValueIds.map(Number),
        }),
      });
      onMessage?.({ type: 'success', text: result.message });
      setBranchIds([]); setKeyValueIds({}); setResultValueIds([]); setPickerSearch({});
      await load();
    } catch (error) {
      onMessage?.({ type: 'error', text: error.message });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async row => {
    if (!window.confirm('Delete this combination?')) return;
    try {
      await call(`/business-config/link-rules/${rule.id}/rows/${row.id}`, { method: 'DELETE' });
      await load();
    } catch (error) {
      onMessage?.({ type: 'error', text: error.message });
    }
  };

  const filtered = rows.filter(row =>
    `${row.branchName || ''} ${row.key.map(k => k.displayName).join(' ')} ${row.result.map(r => r.displayName).join(' ')}`
      .toLowerCase().includes(search.toLowerCase()));

  return (
    <section className="panel">
      <div className="panel-title">
        <div><h2>{rule.displayName}</h2></div>
      </div>

      {/* The only way back, so it cannot live in .panel-title. */}
      <div className="config-subhead">
        <div>
          <strong>{rule.displayName}</strong>
          <span>
            Offers {rule.resultSectionName} by {[
              rule.includesBranch ? 'branch' : null,
              ...rule.keySections.map(section => section.displayName),
            ].filter(Boolean).join(' and ')}. Every combination of what you pick is saved.
          </span>
        </div>
        <button type="button" className="config-back" onClick={onBack}>
          <ArrowLeft size={14}/> All links
        </button>
      </div>

      <div className="config-content">
        <form className="config-add" onSubmit={handleSave}>
          <div className="config-form-title"><h3>Add combinations</h3></div>

          {rule.includesBranch && (
            <ConfigMultiSelect
              label="Branch *" name="branchIds" placeholder="Select branches"
              options={branches.map(branch => ({ id: branch.id, label: branch.displayName }))}
              selected={branchIds} openPicker={openPicker} setOpenPicker={setOpenPicker}
              {...searchFor('branchIds')} onChange={setBranchIds}
            />
          )}

          {rule.keySections.map(section => (
            <ConfigMultiSelect
              key={section.sectionId}
              label={`${section.displayName} *`}
              name={`key-${section.sectionId}`}
              placeholder={`Select ${section.displayName.toLowerCase()}`}
              options={valuesOf(section.sectionId)}
              selected={keyValueIds[section.sectionId] || []}
              openPicker={openPicker} setOpenPicker={setOpenPicker}
              {...searchFor(`key-${section.sectionId}`)}
              onChange={values => setKeyValueIds(prev => ({ ...prev, [section.sectionId]: values }))}
            />
          ))}

          <ConfigMultiSelect
            label={`${rule.resultSectionName} to offer *`} name="resultValueIds"
            placeholder={`Select ${rule.resultSectionName.toLowerCase()}`}
            options={valuesOf(rule.resultSectionId)}
            selected={resultValueIds} openPicker={openPicker} setOpenPicker={setOpenPicker}
            {...searchFor('resultValueIds')} onChange={setResultValueIds}
          />

          <p className="bulk-edit-note">
            Picking several on each line saves every combination of them at once. Saving a combination
            that already exists replaces what it offers.
          </p>

          <div className="config-form-actions">
            <button className="primary" type="submit" disabled={saving}>
              <Plus size={16}/>{saving ? 'Saving…' : 'Add combinations'}
            </button>
          </div>
        </form>

        <div className="config-list">
          <div className="config-list-tools">
            <div className="local-search">
              <Search size={16}/>
              <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search combinations..."/>
            </div>
            <span>{filtered.length} combination{filtered.length === 1 ? '' : 's'}</span>
          </div>
          <div className="config-records">
            {loading && <div className="loading"><span/></div>}
            {!loading && filtered.map(row => (
              <article key={row.id}>
                <div>
                  <strong>{[row.branchName, ...row.key.map(k => k.displayName)].filter(Boolean).join(' · ')}</strong>
                  <small>offers {row.result.map(r => r.displayName).join(', ') || 'nothing'}</small>
                </div>
                <div className="config-record-actions">
                  <button className="config-delete" type="button" title="Delete" onClick={() => handleDelete(row)}>×</button>
                </div>
              </article>
            ))}
            {!loading && !filtered.length && (
              <div className="empty">
                <strong>{rows.length ? 'No results match your search' : 'No combinations yet'}</strong>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
