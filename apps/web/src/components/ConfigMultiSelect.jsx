import { useEffect, useRef } from 'react';
import { ChevronDown, Search } from 'lucide-react';

/**
 * The multi-select the admission class screen is built from.
 *
 * Shared rather than copied: the linked-configuration screens ask exactly the
 * same question -- pick several branches, several years -- and a second
 * implementation would drift from this one while wearing the same CSS classes.
 *
 * A trigger showing badges, a searchable list, and select-all. That last part
 * is what makes twenty branches workable; a flat row of twenty toggles is not
 * something anyone wants to read.
 */
export default function ConfigMultiSelect({ label, name, placeholder, options, selected, onChange, openPicker, setOpenPicker, search, setSearch, disabled = false }) {
  const rootRef = useRef(null);
  const selectedSet = new Set(selected.map(String));
  const filtered = options.filter(option => option.label.toLowerCase().includes(search.toLowerCase()));
  const selectedLabels = selected.map(id => options.find(option => String(option.id) === String(id))?.label).filter(Boolean);
  const toggle = id => onChange(selectedSet.has(String(id)) ? selected.filter(value => String(value) !== String(id)) : [...selected, String(id)]);
  useEffect(() => {
    if (openPicker !== name) return undefined;
    const closeOnOutside = event => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpenPicker('');
    };
    const closeOnEscape = event => {
      if (event.key === 'Escape') setOpenPicker('');
    };
    document.addEventListener('mousedown', closeOnOutside, true);
    document.addEventListener('touchstart', closeOnOutside, true);
    document.addEventListener('keydown', closeOnEscape, true);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside, true);
      document.removeEventListener('touchstart', closeOnOutside, true);
      document.removeEventListener('keydown', closeOnEscape, true);
    };
  }, [openPicker, name, setOpenPicker]);
  return <div className="label academic-multi-select" ref={rootRef}><span>{label}</span><div className="multi-select-wrapper">
    <button type="button" className="multi-select-trigger" disabled={disabled} onClick={() => !disabled && setOpenPicker(openPicker === name ? '' : name)}><div className="selected-items">{selectedLabels.length ? selectedLabels.slice(0, 6).map(item => <span key={item} className="badge">{item}</span>) : <span className="placeholder">{placeholder}</span>}{selectedLabels.length > 6 && <span className="badge">+{selectedLabels.length - 6}</span>}</div><ChevronDown size={14} /></button>
    {openPicker === name && <div className="multi-select-dropdown"><div className="search-box"><Search size={14} /><input autoFocus placeholder={`Search ${placeholder.toLowerCase()}...`} value={search} onChange={event => setSearch(event.target.value)} /></div><div className="actions"><button type="button" onClick={() => onChange(options.map(option => String(option.id)))}>Select all</button><button type="button" onClick={() => onChange([])}>Clear all</button></div><div className="options">{filtered.map(option => <label key={option.id} className="checkbox-item"><input type="checkbox" checked={selectedSet.has(String(option.id))} onChange={() => toggle(option.id)} /><span>{option.label}</span></label>)}{!filtered.length && <p>No options found</p>}</div></div>}
  </div></div>;
}
