import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, CornerDownRight, GripVertical, Layers3, ListPlus, Pencil, Plus, Search, Settings2, Trash2, X } from 'lucide-react';
import { api } from './api';

/**
 * Master data for a business unit that does not use the school profile.
 *
 * School Admissions has four fixed tabs because crm_leads points at their
 * tables with real foreign keys. Everywhere else the unit says what its own
 * sections are: a consultancy can keep only "Courses Offered" and "Service
 * Type", rename either later, and change what their pickers prompt for.
 *
 * A section is either a flat list, or two named levels where each sub-value
 * belongs to one parent value -- the Stage and Sub-stage arrangement.
 */

const blankSection = {
  displayName: '', description: '', placeholder: '',
  childLabel: '', childPlaceholder: '', sectionType: 'list', isActive: true,
};
const blankValue = { code: '', displayName: '', position: 0, isActive: true };

/**
 * Holds a callback without making it a dependency.
 *
 * The screens above pass `onMessage` as an inline arrow, so it is a new
 * function on every one of their renders. Listing it in a dependency array
 * makes effects re-run for reasons that have nothing to do with their data.
 */
function useLatest(value) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/**
 * Every call names the unit being edited.
 *
 * The API reads the unit from the X-Business-Unit-Id header, which `api`
 * fills from whichever unit is active in the header bar. This screen is
 * reached from Business Units, where an administrator may be editing a unit
 * they are not currently working in.
 */
function useUnitApi(businessUnitId) {
  return useCallback(
    (path, options = {}) => api(path, {
      ...options,
      headers: {
        ...options.headers,
        ...(businessUnitId ? { 'X-Business-Unit-Id': String(businessUnitId) } : {}),
      },
    }),
    [businessUnitId],
  );
}

function SectionManager({ sections, call, onOpen, onMessage, onChanged }) {
  const [form, setForm] = useState(blankSection);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);

  const reset = () => { setEditing(null); setForm(blankSection); };
  const isHierarchy = form.sectionType === 'hierarchy';
  // What the section was before this edit, so the form can explain a switch.
  const editingType = sections.find(section => section.id === editing)?.sectionType;

  async function save(event) {
    event.preventDefault();
    if (!form.displayName.trim()) return onMessage?.({ type: 'error', text: 'Enter a section name' });
    if (isHierarchy && !form.childLabel.trim()) {
      return onMessage?.({ type: 'error', text: 'Name the sub-level, for example "Specialisation"' });
    }
    setBusy(true);
    try {
      await call(editing ? `/business-config/sections/${editing}` : '/business-config/sections', {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify({
          displayName: form.displayName.trim(),
          description: form.description.trim(),
          placeholder: form.placeholder.trim(),
          childLabel: form.childLabel.trim(),
          childPlaceholder: form.childPlaceholder.trim(),
          sectionType: form.sectionType,
          isActive: form.isActive,
        }),
      });
      onMessage?.({ type: 'success', text: editing ? 'Section updated' : 'Section added' });
      reset();
      await onChanged();
    } catch (error) {
      onMessage?.({ type: 'error', text: error.message });
    } finally {
      setBusy(false);
    }
  }

  async function remove(section) {
    if (!window.confirm(`Delete "${section.displayName}" and everything in it?`)) return;
    try {
      await call(`/business-config/sections/${section.id}`, { method: 'DELETE' });
      onMessage?.({ type: 'success', text: 'Section deleted' });
      if (editing === section.id) reset();
      await onChanged();
    } catch (error) {
      onMessage?.({ type: 'error', text: error.message });
    }
  }

  async function move(index, delta) {
    const next = [...sections];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    try {
      await call('/business-config/sections/reorder', {
        method: 'PUT',
        body: JSON.stringify({ order: next.map(section => section.id) }),
      });
      await onChanged();
    } catch (error) {
      onMessage?.({ type: 'error', text: error.message });
    }
  }

  const countOf = (section) => section.sectionType === 'hierarchy'
    ? `${section.values.length} ${section.displayName}, ${section.values.reduce((sum, value) => sum + value.children.length, 0)} ${section.childLabel || 'sub-values'}`
    : `${section.values.length} values`;

  return (
    <section className="panel">
      <div className="config-toolbar">
        <div>
          <strong>Sections</strong>
          <span>Add, rename, reorder or remove the configuration tabs this business unit shows.</span>
        </div>
      </div>

      <div className="config-content">
        <form className={`config-add ${editing ? 'editing' : ''}`} onSubmit={save}>
          <div className="config-form-title">
            <h3>{editing ? 'Edit section' : 'Add section'}</h3>
            {editing && <button type="button" title="Cancel editing" onClick={reset}><X size={15} /></button>}
          </div>

          <label>
            Section name *
            <input
              value={form.displayName}
              onChange={event => setForm({ ...form, displayName: event.target.value })}
              placeholder="Courses Offered"
            />
          </label>

          <label>
            Placeholder
            <input
              value={form.placeholder}
              onChange={event => setForm({ ...form, placeholder: event.target.value })}
              placeholder="Select course"
            />
          </label>

          <label>
            Description
            <input
              value={form.description}
              onChange={event => setForm({ ...form, description: event.target.value })}
              placeholder="Courses this unit offers"
            />
          </label>

          <label>
            Section type *
            <select
              value={form.sectionType}
              onChange={event => setForm({ ...form, sectionType: event.target.value })}
            >
              <option value="list">Simple list of values</option>
              <option value="hierarchy">Parent with sub-values</option>
            </select>
          </label>

          {/* Turning a list into a hierarchy keeps every value, as a parent.
              The reverse is refused by the API while sub-values exist. */}
          {editing && editingType === 'list' && isHierarchy && (
            <p className="config-hint">
              Existing values stay, each becoming a {form.displayName.trim() || 'parent'} that can hold its own{' '}
              {form.childLabel.trim() || 'sub-values'}.
            </p>
          )}
          {editing && editingType === 'hierarchy' && !isHierarchy && (
            <p className="config-hint">
              Only possible while no sub-values exist. Delete them first, or this will be refused.
            </p>
          )}

          {isHierarchy && <>
            <label>
              Sub-level name *
              <input
                value={form.childLabel}
                onChange={event => setForm({ ...form, childLabel: event.target.value })}
                placeholder="Specialisation"
              />
            </label>
            <label>
              Sub-level placeholder
              <input
                value={form.childPlaceholder}
                onChange={event => setForm({ ...form, childPlaceholder: event.target.value })}
                placeholder="Select specialisation"
              />
            </label>
            <p className="config-hint">
              Each {form.displayName.trim() || 'parent value'} keeps its own {form.childLabel.trim() || 'sub-values'},
              the way a sub-stage belongs to one stage.
            </p>
          </>}

          <label className="config-check">
            <input type="checkbox" checked={form.isActive} onChange={event => setForm({ ...form, isActive: event.target.checked })} />
            Active
          </label>

          <div className="config-form-actions">
            <button className="primary" disabled={busy}>
              {editing ? <Pencil size={15} /> : <Plus size={16} />}
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Add section'}
            </button>
            {editing && <button type="button" className="secondary" onClick={reset}>Cancel</button>}
          </div>
        </form>

        <div className="config-list">
          <div className="config-list-tools">
            <span>{sections.length} sections</span>
          </div>
          <div className="config-records">
            {sections.map((section, index) => (
              <article key={section.id} className={editing === section.id ? 'selected' : ''}>
                <div>
                  <strong><GripVertical size={13} /> {section.displayName}</strong>
                  <small>
                    {countOf(section)}
                    {' · '}{section.isActive ? 'Active' : 'Inactive'}
                  </small>
                </div>
                <div className="config-record-actions">
                  <button className="config-edit" type="button" title="Open this section's values" onClick={() => onOpen(section.id)}>
                    <ListPlus size={14} /> Values
                  </button>
                  <button type="button" title="Move up" onClick={() => move(index, -1)} disabled={index === 0}><ArrowUp size={14} /></button>
                  <button type="button" title="Move down" onClick={() => move(index, 1)} disabled={index === sections.length - 1}><ArrowDown size={14} /></button>
                  <button className="config-edit" type="button" onClick={() => {
                    setEditing(section.id);
                    setForm({
                      displayName: section.displayName,
                      description: section.description || '',
                      placeholder: section.placeholder || '',
                      childLabel: section.childLabel || '',
                      childPlaceholder: section.childPlaceholder || '',
                      sectionType: section.sectionType,
                      isActive: section.isActive,
                    });
                  }}><Pencil size={14} /> Edit</button>
                  <button type="button" title="Delete section" onClick={() => remove(section)}><Trash2 size={14} /></button>
                </div>
              </article>
            ))}
            {!sections.length && <div className="empty"><strong>No sections yet</strong><span>Add one to start describing this unit's master data.</span></div>}
          </div>
        </div>
      </div>
    </section>
  );
}

const newRowKey = () => globalThis.crypto?.randomUUID?.() || `row-${Math.random().toString(36).slice(2)}`;
const blankRow = () => ({ key: newRowKey(), code: '', displayName: '', position: 0, isActive: true });

/**
 * Values for one section.
 *
 * A hierarchy is edited the way Stage and Sub-stage are: one tab listing the
 * parent values, another listing the sub-values, where each sub-value names
 * its parent in a required dropdown and shows that parent underneath it.
 *
 * Adding is done a row at a time rather than a form at a time. The parent is
 * chosen once at the top and every row beneath it is saved under that parent,
 * so a course type with a dozen courses is one pass instead of a dozen.
 */
function SectionValuesEditor({ section, call, onMessage, onChanged }) {
  const isHierarchy = section.sectionType === 'hierarchy';
  const childLabel = section.childLabel || 'Sub-value';

  const [level, setLevel] = useState('parent');
  const [drafts, setDrafts] = useState([blankRow()]);
  const [parentId, setParentId] = useState('');
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);

  const onChild = isHierarchy && level === 'child';
  const parents = section.values;
  const children = useMemo(
    () => parents.flatMap(parent => parent.children.map(child => ({ ...child, parent }))),
    [parents],
  );

  const reset = useCallback(() => {
    setEditing(null);
    setDrafts([blankRow()]);
    setParentId('');
  }, []);

  useEffect(() => { reset(); setLevel('parent'); setSearch(''); }, [section.id, reset]);
  useEffect(() => { reset(); }, [level, reset]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const source = onChild ? children : parents;
    if (!term) return source;
    return source.filter(row => `${row.code} ${row.displayName}`.toLowerCase().includes(term));
  }, [onChild, children, parents, search]);

  const patchRow = (key, change) =>
    setDrafts(current => current.map(row => (row.key === key ? { ...row, ...change } : row)));
  const addRow = () => setDrafts(current => [...current, blankRow()]);
  const dropRow = (key) =>
    setDrafts(current => (current.length === 1 ? [blankRow()] : current.filter(row => row.key !== key)));

  async function save(event) {
    event.preventDefault();
    const filled = drafts.filter(row => row.displayName.trim());
    if (!filled.length) return onMessage?.({ type: 'error', text: 'Enter at least one name' });
    if (onChild && !editing && !parentId) {
      return onMessage?.({ type: 'error', text: `Select the parent ${section.displayName.toLowerCase()}` });
    }
    setBusy(true);
    try {
      if (editing) {
        const row = filled[0];
        await call(`/business-config/values/${editing}`, {
          method: 'PUT',
          body: JSON.stringify({
            displayName: row.displayName.trim(),
            position: Number(row.position) || 0,
            isActive: row.isActive,
          }),
        });
        onMessage?.({ type: 'success', text: 'Saved' });
        reset();
      } else {
        // Saved one at a time so a single rejected name -- a duplicate, say --
        // does not discard the rest. Rows that fail stay on screen with the
        // reason; the ones that worked disappear.
        const failed = [];
        let added = 0;
        for (const row of filled) {
          try {
            await call(`/business-config/sections/${section.id}/values`, {
              method: 'POST',
              body: JSON.stringify({
                code: row.code.trim(),
                displayName: row.displayName.trim(),
                position: Number(row.position) || 0,
                isActive: row.isActive,
                parentValueId: onChild ? parentId : null,
              }),
            });
            added += 1;
          } catch (error) {
            failed.push({ row, message: error.message });
          }
        }
        setDrafts(failed.length ? failed.map(entry => entry.row) : [blankRow()]);
        if (added) {
          onMessage?.({
            type: failed.length ? 'error' : 'success',
            text: `${added} added${failed.length ? `; ${failed.length} kept back: ${failed[0].message}` : ''}`,
          });
        } else {
          onMessage?.({ type: 'error', text: failed[0]?.message || 'Nothing was saved' });
        }
      }
      await onChanged();
    } catch (error) {
      onMessage?.({ type: 'error', text: error.message });
    } finally {
      setBusy(false);
    }
  }

  async function remove(row) {
    const childCount = row.children?.length || 0;
    const warning = childCount
      ? `Delete "${row.displayName}" and its ${childCount} ${childLabel.toLowerCase()}?`
      : `Delete "${row.displayName}"?`;
    if (!window.confirm(warning)) return;
    try {
      await call(`/business-config/values/${row.id}`, { method: 'DELETE' });
      if (editing === row.id) reset();
      if (String(parentId) === String(row.id)) setParentId('');
      await onChanged();
    } catch (error) {
      onMessage?.({ type: 'error', text: error.message });
    }
  }

  function edit(row) {
    setEditing(row.id);
    setDrafts([{ key: newRowKey(), code: row.code, displayName: row.displayName, position: row.position || 0, isActive: row.isActive }]);
    if (row.parent) setParentId(String(row.parent.id));
  }

  const levelName = onChild ? childLabel : section.displayName;
  const parentMissing = onChild && !parents.length;

  return (
    <section className="panel">
      <div className="config-toolbar">
        <div>
          <strong>{section.displayName}</strong>
          <span>
            {section.description
              || (isHierarchy
                ? `Each ${section.displayName.toLowerCase()} keeps its own ${childLabel.toLowerCase()}.`
                : `Values available under ${section.displayName}.`)}
          </span>
        </div>
      </div>

      {/* Two levels, two lists -- the arrangement Stages and Sub-stages use. */}
      {isHierarchy && (
        <div className="config-level-tabs" role="tablist" aria-label={`${section.displayName} levels`}>
          <button
            type="button" role="tab" aria-selected={level === 'parent'}
            className={level === 'parent' ? 'active' : ''}
            onClick={() => setLevel('parent')}
          >
            {section.displayName} <span>{parents.length}</span>
          </button>
          <button
            type="button" role="tab" aria-selected={level === 'child'}
            className={level === 'child' ? 'active' : ''}
            onClick={() => setLevel('child')}
          >
            {childLabel} <span>{children.length}</span>
          </button>
        </div>
      )}

      {/* Stacked, so the entry rows get the full width rather than a 300px column. */}
      <div className="config-content stacked">
        <form className={`config-add ${editing ? 'editing' : ''}`} onSubmit={save}>
          <div className="config-form-title">
            <h3>{editing ? `Edit ${levelName.toLowerCase()}` : `Add ${levelName.toLowerCase()}`}</h3>
            {editing && <button type="button" title="Cancel editing" onClick={reset}><X size={15} /></button>}
          </div>

          {onChild && (
            <label className="config-parent-picker">
              Parent {section.displayName.toLowerCase()} *
              <select
                required
                value={parentId}
                disabled={Boolean(editing)}
                onChange={event => setParentId(event.target.value)}
              >
                <option value="">{section.placeholder || `Select ${section.displayName.toLowerCase()}`}</option>
                {parents.map(parent => (
                  <option key={parent.id} value={String(parent.id)}>{parent.displayName}</option>
                ))}
              </select>
              {!editing && <small>Chosen once — every row below is added under it.</small>}
            </label>
          )}

          {parentMissing && (
            <p className="config-hint">
              Add a {section.displayName.toLowerCase()} first — a {childLabel.toLowerCase()} has to belong to one.
            </p>
          )}

          <div className="config-draft-head">
            <span>{levelName} name *</span>
            <span>Code</span>
            <span>Order</span>
            <span>Active</span>
            <span />
          </div>

          {drafts.map((row, index) => (
            <div className="config-draft-row" key={row.key}>
              <input
                value={row.displayName}
                onChange={event => patchRow(row.key, { displayName: event.target.value })}
                placeholder={onChild
                  ? (section.childPlaceholder || `Add a ${childLabel.toLowerCase()}`)
                  : (section.placeholder || `Add a ${section.displayName.toLowerCase()}`)}
                aria-label={`${levelName} name`}
              />
              <input
                value={row.code}
                onChange={event => patchRow(row.key, { code: event.target.value })}
                placeholder="From the name"
                disabled={Boolean(editing)}
                aria-label="Code"
              />
              <input
                type="number" min="0" value={row.position}
                onChange={event => patchRow(row.key, { position: event.target.value })}
                aria-label="Display order"
              />
              <input
                type="checkbox" checked={row.isActive}
                onChange={event => patchRow(row.key, { isActive: event.target.checked })}
                aria-label="Active"
              />
              {editing ? <span /> : (
                <div className="config-draft-actions">
                  {index === drafts.length - 1 && (
                    <button type="button" title="Add another row" onClick={addRow} disabled={parentMissing}>
                      <Plus size={15} />
                    </button>
                  )}
                  <button type="button" title="Remove this row" onClick={() => dropRow(row.key)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>
          ))}

          <div className="config-form-actions">
            <button className="primary" disabled={busy || parentMissing}>
              {editing ? <Pencil size={15} /> : <Plus size={16} />}
              {busy ? 'Saving…' : editing ? 'Save changes' : `Add ${levelName.toLowerCase()}`}
            </button>
            {editing && <button type="button" className="secondary" onClick={reset}>Cancel</button>}
          </div>
        </form>

        <div className="config-list">
          <div className="config-list-tools">
            <div className="local-search">
              <Search size={16} />
              <input value={search} onChange={event => setSearch(event.target.value)} placeholder={`Search ${levelName.toLowerCase()}…`} />
            </div>
            <span>{rows.length} records</span>
          </div>

          <div className="config-records">
            {rows.map(row => (
              <article key={row.id} className={editing === row.id ? 'selected' : ''}>
                <div>
                  <strong>{row.displayName}</strong>
                  {onChild && <em className="config-parent-of">{row.parent.displayName}</em>}
                  <small>
                    {row.code} · Order {row.position || 0} · {row.isActive ? 'Active' : 'Inactive'}
                    {!onChild && isHierarchy ? ` · ${row.children.length} ${childLabel.toLowerCase()}` : ''}
                  </small>
                </div>
                <div className="config-record-actions">
                  {!onChild && isHierarchy && (
                    <button type="button" title={`Add ${childLabel.toLowerCase()} under ${row.displayName}`} onClick={() => {
                      setLevel('child');
                      setEditing(null);
                      setDrafts([blankRow()]);
                      setParentId(String(row.id));
                    }}><CornerDownRight size={14} /></button>
                  )}
                  <button className="config-edit" type="button" onClick={() => edit(row)}><Pencil size={14} /> Edit</button>
                  <button type="button" title="Delete" onClick={() => remove(row)}><Trash2 size={14} /></button>
                </div>
              </article>
            ))}

            {!rows.length && (
              <div className="empty">
                <strong>{search.trim() ? 'No results match your search' : `No ${levelName.toLowerCase()} yet`}</strong>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function BusinessConfigurationPage({ businessUnitId, onMessage, embedded = false }) {
  const [sections, setSections] = useState([]);
  const [activeId, setActiveId] = useState('manage');
  const [loading, setLoading] = useState(true);
  const call = useUnitApi(businessUnitId);
  const notify = useLatest(onMessage);

  const load = useCallback(async () => {
    try {
      const result = await call('/business-config/sections');
      setSections(result.data || []);
    } catch (error) {
      notify.current?.({ type: 'error', text: error.message });
    } finally {
      setLoading(false);
    }
  }, [call, notify]);

  useEffect(() => { load(); }, [load]);

  const active = sections.find(section => String(section.id) === String(activeId));

  const content = <>
    <div className="config-tabs academic-config-tabs" role="tablist" aria-label="Business configuration sections">
      {sections.map(section => (
        <button
          key={section.id}
          type="button"
          role="tab"
          aria-selected={String(activeId) === String(section.id)}
          className={String(activeId) === String(section.id) ? 'active' : ''}
          onClick={() => setActiveId(section.id)}
        >
          <Layers3 size={15} />
          {section.displayName}
        </button>
      ))}
      <button
        type="button"
        role="tab"
        aria-selected={activeId === 'manage'}
        className={activeId === 'manage' ? 'active' : ''}
        onClick={() => setActiveId('manage')}
      >
        <Settings2 size={15} />
        Manage sections
      </button>
    </div>

    <div className="academic-tab-content" role="tabpanel">
      {loading && <div className="loading"><span /></div>}
      {!loading && (activeId === 'manage' || !active) && (
        <SectionManager sections={sections} call={call} onOpen={setActiveId} onMessage={onMessage} onChanged={load} />
      )}
      {!loading && active && activeId !== 'manage' && (
        <SectionValuesEditor key={active.id} section={active} call={call} onMessage={onMessage} onChanged={load} />
      )}
    </div>
  </>;

  if (embedded) return <section className="academic-config-panel embedded">{content}</section>;
  return (
    <main className="page settings-config-page academic-config-page">
      <section className="panel academic-config-panel">{content}</section>
    </main>
  );
}
