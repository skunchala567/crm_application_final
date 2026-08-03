import { useMemo, useState } from "react";
import { Download, Search, X } from "lucide-react";
import "./DownloadFieldsDialog.css";

export default function DownloadFieldsDialog({ title = "Download Data", groups = [], defaultSelected = [], onClose, onDownload }) {
  const allFields = useMemo(() => groups.flatMap(group => group.fields), [groups]);
  const defaultIds = useMemo(() => defaultSelected.length ? defaultSelected : allFields.filter(field => field.defaultSelected).map(field => field.id), [allFields, defaultSelected]);
  const [selected, setSelected] = useState(() => new Set(defaultIds));
  const [query, setQuery] = useState("");
  const visibleGroups = groups.map(group => ({
    ...group,
    fields: group.fields.filter(field => field.label.toLowerCase().includes(query.toLowerCase().trim())),
  })).filter(group => group.fields.length);
  const visibleIds = visibleGroups.flatMap(group => group.fields.map(field => field.id));
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selected.has(id));

  function toggle(id) {
    setSelected(current => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleVisible() {
    setSelected(current => {
      const next = new Set(current);
      if (allVisibleSelected) visibleIds.forEach(id => next.delete(id));
      else visibleIds.forEach(id => next.add(id));
      return next;
    });
  }

  function reset() {
    setSelected(new Set(defaultIds));
    setQuery("");
  }

  return <div className="download-dialog-backdrop" role="presentation">
    <section className="download-fields-dialog" role="dialog" aria-modal="true" aria-label={title}>
      <header>
        <div><Download size={18}/><h2>{title}</h2></div>
        <button type="button" aria-label="Close" onClick={onClose}><X size={18}/></button>
      </header>
      <div className="download-dialog-search"><Search size={16}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search field"/></div>
      <p className="download-dialog-note">Choose the fields to include in the Excel/CSV download.</p>
      <label className="download-select-all"><input type="checkbox" checked={allVisibleSelected} onChange={toggleVisible}/> <span>{allVisibleSelected ? "Clear visible fields" : "Select all visible fields"}</span><b>{selected.size}</b></label>
      <div className="download-field-groups">
        {visibleGroups.length ? visibleGroups.map(group => <section key={group.name} className="download-field-group">
          <h3>{group.name}</h3>
          <div>{group.fields.map(field => <label key={field.id} className="download-field-option">
            <input type="checkbox" checked={selected.has(field.id)} onChange={() => toggle(field.id)}/>
            <span>{field.label}</span>
          </label>)}</div>
        </section>) : <p className="download-empty">No fields match your search.</p>}
      </div>
      <footer>
        <button type="button" className="download-reset" onClick={reset}>Reset</button>
        <button type="button" className="download-primary" disabled={!selected.size} onClick={() => onDownload(allFields.filter(field => selected.has(field.id)))}><Download size={15}/> Download</button>
      </footer>
    </section>
  </div>;
}
