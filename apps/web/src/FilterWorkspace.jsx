import { Children, isValidElement, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Filter, ListFilter, RotateCcw, Save, Search, X } from "lucide-react";
import { api } from "./api";
import "./FilterWorkspaceCampaign.css";

const multiKeys = ["branchId","stage","substageId","sourceId","channelId","channelCategory","campaignId","campaignCategory","marketingCampaignId","marketingDeliveryStatus","ownerEmployeeId","classId","curriculumId","admissionTypeId","referredByEmployeeId","touchStatus","isParent","lookingForAdmission","whatsappResponse","contactAvailability"];
export const emptyAdvancedFilters = Object.fromEntries([...multiKeys.map(key => [key,[]]),...["followupFrom","followupTo","scoreMin","scoreMax"].map(key => [key,""])]);
export function normalizeFilters(filters={}) { return { ...emptyAdvancedFilters, ...filters, ...Object.fromEntries(multiKeys.map(key => [key, Array.isArray(filters[key]) ? filters[key].map(String) : filters[key] ? [String(filters[key])] : []])) }; }

const sections = [
  ["lead", "Lead details"], ["academic", "Academic details"], ["communication", "Communication details"],
  ["marketing", "Marketing campaigns"],
  ["date", "Date filters"], ["range", "Range filters"],
];

function Field({ label, children, searchText }) {
  if (searchText && !label.toLowerCase().includes(searchText.toLowerCase())) return null;
  const child = Children.only(children);
  const control = isValidElement(child) && child.type === "select"
    ? <MultiSearchSelect label={label} value={child.props.value} onChange={value => child.props.onChange({ target:{ value } })} disabled={child.props.disabled} options={Children.toArray(child.props.children).filter(isValidElement).map(option => ({ value:String(option.props.value ?? option.props.children ?? ""), label:String(option.props.children ?? "") }))}/>
    : child;
  return <label className="filter-field"><span>{label}</span>{control}</label>;
}

export function SearchSelect({ label, value, options, onChange, disabled=false }) {
  const root = useRef(null);
  const selected = options.find(option => option.value === String(value ?? "")) || options[0];
  const [query, setQuery] = useState(selected?.label || "");
  const [open, setOpen] = useState(false);
  useEffect(() => setQuery(selected?.label || ""), [selected?.label]);
  useEffect(() => {
    function close(event) { if (!root.current?.contains(event.target)) setOpen(false); }
    document.addEventListener("mousedown", close); return () => document.removeEventListener("mousedown", close);
  }, []);
  const filterTerm = query === selected?.label ? "" : query.toLowerCase().trim();
  const suggestions = options.filter(option => option.label.toLowerCase().includes(filterTerm));
  function choose(option) { onChange(option.value); setQuery(option.label); setOpen(false); }
  function type(text) {
    setQuery(text); setOpen(true);
    const exact = options.find(option => option.label.toLowerCase() === text.trim().toLowerCase());
    if (exact) onChange(exact.value); else if (!text) onChange("");
  }
  function keyDown(event) {
    if (event.key === "Escape") setOpen(false);
    if (event.key === "Enter" && open && suggestions.length) { event.preventDefault(); choose(suggestions[0]); }
  }
  return <div className="search-select" ref={root}>
    <Search size={15}/><input role="combobox" aria-label={label} aria-expanded={open} aria-autocomplete="list" disabled={disabled} value={query} onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onChange={event => type(event.target.value)} onKeyDown={keyDown}/><ChevronDown size={15}/>
    {open && <div className="search-select-menu" role="listbox">{suggestions.length ? suggestions.map(option => <button type="button" role="option" aria-selected={option.value === String(value ?? "")} key={`${option.value}-${option.label}`} onMouseDown={event => event.preventDefault()} onClick={() => choose(option)}>{option.label}</button>) : <p>No suggestions found</p>}</div>}
  </div>;
}

export function MultiSearchSelect({ label, value=[], options, onChange, disabled=false }) {
  const root=useRef(null); const [query,setQuery]=useState(""); const [open,setOpen]=useState(false);
  const values=Array.isArray(value)?value.map(String):(value?[String(value)]:[]);
  const choices=options.filter(option=>option.value!=="");
  const selected=choices.filter(option=>values.includes(String(option.value)));
  const suggestions=choices.filter(option=>option.label.toLowerCase().includes(query.toLowerCase().trim()));
  const allSelected=choices.length>0&&choices.every(option=>values.includes(String(option.value)));
  useEffect(()=>{function close(event){if(!root.current?.contains(event.target))setOpen(false)}document.addEventListener("mousedown",close);return()=>document.removeEventListener("mousedown",close)},[]);
  function toggle(option){const id=String(option.value);onChange(values.includes(id)?values.filter(item=>item!==id):[...values,id]);setQuery("");}
  return <div className="search-select multi-search-select" ref={root}>
    <Search size={15}/><div className="multi-select-input" onClick={()=>setOpen(true)}><input role="combobox" aria-label={label} aria-expanded={open} aria-autocomplete="list" disabled={disabled} value={query} placeholder={selected.length?(selected.length===1?selected[0].label:`${selected.length} selected`):(options[0]?.label||`Select ${label}`)} onFocus={()=>setOpen(true)} onChange={event=>{setQuery(event.target.value);setOpen(true)}}/></div>{selected.length>0&&<button type="button" className="multi-clear" aria-label={`Clear ${label}`} onClick={()=>onChange([])}><X size={13}/></button>}<ChevronDown size={15}/>
    {open&&<div className="search-select-menu multi-search-menu" role="listbox" aria-multiselectable="true">
      <div className="multi-select-actions">
        <button type="button" onMouseDown={event=>event.preventDefault()} onClick={()=>onChange(allSelected?[]:choices.map(option=>String(option.value)))}>{allSelected?"Clear all":"Select all"}<span>{allSelected?selected.length:choices.length}</span></button>
      </div>
      <div className="multi-select-options">{suggestions.length?suggestions.map(option=><button type="button" role="option" aria-selected={values.includes(String(option.value))} className={values.includes(String(option.value))?"selected":""} key={`${option.value}-${option.label}`} onMouseDown={event=>event.preventDefault()} onClick={()=>toggle(option)}><span className="multi-check">{values.includes(String(option.value))?"✓":""}</span>{option.label}</button>):<p>No suggestions found</p>}</div>
    </div>}
  </div>;
}

export default function FilterWorkspace({ mode="filter", meta, initialFilters, onApply, onClose, onSaved }) {
  const [filters, setFilters] = useState(normalizeFilters(initialFilters));
  const [activeSection, setActiveSection] = useState("lead");
  const [fieldSearch, setFieldSearch] = useState("");
  const [saved, setSaved] = useState([]);
  const [selectedSaved, setSelectedSaved] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [nameError, setNameError] = useState("");

  useEffect(() => { api("/saved-filters").then(result => setSaved(result.data)).catch(error => setNotice(error.message)); }, []);
  const employees = useMemo(() => meta.employees.filter(employee => !filters.branchId.length || filters.branchId.includes(String(employee.branchId))), [meta.employees, filters.branchId]);
  function set(key, value) { setFilters(current => ({ ...current, [key]: value })); }
  function loadSaved(id) {
    setSelectedSaved(id);
    const item = saved.find(entry => String(entry.id) === String(id));
    if (item) { setFilters(normalizeFilters(item.filters)); setName(item.name); setNotice(`${item.type === "funnel" ? "View" : "Filter"} loaded`); }
  }
  async function save(type) {
    if (!name.trim()) { setNameError("Enter a name before saving"); setNotice(""); return; }
    setNameError("");
    setSaving(true);
    try {
      const result = await api("/saved-filters", { method:"POST", body:JSON.stringify({ name:name.trim(), type, filters }) });
      setNotice(result.message); onSaved?.({ name:name.trim(), type, filters });
      const refreshed = await api("/saved-filters"); setSaved(refreshed.data);
    } catch (error) { setNotice(error.message); } finally { setSaving(false); }
  }

  return <div className="filter-workspace" role="dialog" aria-modal="true" aria-label="Filter leads">
    <header className="filter-workspace-head"><div className="filter-title"><Filter/><h2>{mode === "funnel" ? "Create lead view" : "Filter leads"}</h2></div><div className="saved-filter-loader"><select value={selectedSaved} onChange={event => loadSaved(event.target.value)}><option value="">Select and load saved filters</option>{saved.map(item => <option key={item.id} value={item.id}>{item.name} · {item.type === "funnel" ? "view" : item.type}</option>)}</select><ChevronDown/></div><button className="filter-close" onClick={onClose}><X/></button></header>
    <div className="filter-chip-row"><span>Lead details <b>{Object.values(filters).filter(value=>Array.isArray(value)?value.length:Boolean(value)).length}</b></span>{notice && <em>{notice}</em>}</div>
    <div className="filter-workspace-body">
      <aside className="filter-sections"><div className="filter-section-search"><Search/><input placeholder="Search section"/></div>{sections.map(([key,label]) => <button key={key} className={activeSection === key ? "active" : ""} onClick={() => setActiveSection(key)}><i/>{label}</button>)}</aside>
      <main className="filter-fields"><div className="field-search"><Search/><input value={fieldSearch} onChange={event => setFieldSearch(event.target.value)} placeholder="Search filter fields"/></div>
        {activeSection === "lead" && <div className="filter-grid">
          <Field label="Touch status" searchText={fieldSearch}><select value={filters.touchStatus} onChange={event => set("touchStatus",event.target.value)}><option value="">Any touch status</option><option value="touched">Is touched</option><option value="untouched">Untouched</option></select></Field>
          <Field label="Branch" searchText={fieldSearch}><select value={filters.branchId} onChange={event => {set("branchId",event.target.value);set("ownerEmployeeId","");}}><option value="">All branches</option>{meta.branches.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
          <Field label="Current stage" searchText={fieldSearch}><select value={filters.stage} onChange={event => {set("stage",event.target.value);set("substageId","");}}><option value="">All stages</option>{meta.stages.map(item => <option key={item.id}>{item.displayName}</option>)}</select></Field>
          <Field label="Sub-stage" searchText={fieldSearch}><select value={filters.substageId} onChange={event => set("substageId",event.target.value)}><option value="">All sub-stages</option>{meta.substages.filter(item => !filters.stage.length || filters.stage.includes(String(meta.stages.find(stage => String(stage.id) === String(item.stageId))?.displayName))).map(item => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></Field>
          <Field label="Lead source" searchText={fieldSearch}><select value={filters.sourceId} onChange={event => set("sourceId",event.target.value)}><option value="">All sources</option>{meta.sources.map(item => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></Field>
          <Field label="Counsellor referred to" searchText={fieldSearch}><select value={filters.ownerEmployeeId} onChange={event => set("ownerEmployeeId",event.target.value)}><option value="">All counsellors</option>{employees.map(item => <option key={`${item.id}-${item.branchId}`} value={item.id}>{item.name} · {item.branchName}</option>)}</select></Field>
          <Field label="Campaign category" searchText={fieldSearch}><select value={filters.campaignCategory} onChange={event => {set("campaignCategory",event.target.value);set("campaignId","");}}><option value="">All campaign categories</option>{[...new Set(meta.campaigns.map(item => item.category))].map(item => <option key={item}>{item}</option>)}</select></Field>
          <Field label="Campaign name" searchText={fieldSearch}><select value={filters.campaignId} onChange={event => set("campaignId",event.target.value)}><option value="">All campaigns</option>{meta.campaigns.filter(item => !filters.campaignCategory.length || filters.campaignCategory.includes(item.category)).map(item => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></Field>
          <Field label="Channel category" searchText={fieldSearch}><select value={filters.channelCategory} onChange={event => {set("channelCategory",event.target.value);set("channelId","");}}><option value="">All channel categories</option><option>Primary</option><option>Secondary</option></select></Field>
          <Field label="Channel" searchText={fieldSearch}><select value={filters.channelId} onChange={event => set("channelId",event.target.value)}><option value="">All channels</option>{meta.channels.filter(item => !filters.channelCategory.length || filters.channelCategory.includes(item.category)).map(item => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></Field>
          <Field label="Is parent" searchText={fieldSearch}><select value={filters.isParent} onChange={event => set("isParent",event.target.value)}><option value="">Any</option><option value="yes">Yes</option><option value="no">No</option></select></Field>
          <Field label="Looking for admissions" searchText={fieldSearch}><select value={filters.lookingForAdmission} onChange={event => set("lookingForAdmission",event.target.value)}><option value="">Any</option><option value="yes">Yes</option><option value="no">No</option></select></Field>
          <Field label="WhatsApp response" searchText={fieldSearch}><select value={filters.whatsappResponse} onChange={event => set("whatsappResponse",event.target.value)}><option value="">Any response</option><option>Responded</option><option>Not Responded</option><option>Opted Out</option></select></Field>
        </div>}
        {activeSection === "academic" && <div className="filter-grid">
          <Field label="Class" searchText={fieldSearch}><select value={filters.classId} onChange={event => set("classId",event.target.value)}><option value="">All classes</option>{meta.classes.map(item => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></Field>
          <Field label="Curriculum" searchText={fieldSearch}><select value={filters.curriculumId} onChange={event => set("curriculumId",event.target.value)}><option value="">All curricula</option>{meta.curricula.map(item => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></Field>
          <Field label="Admission type" searchText={fieldSearch}><select value={filters.admissionTypeId} onChange={event => set("admissionTypeId",event.target.value)}><option value="">All admission types</option>{meta.admissionTypes.map(item => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></Field>
          <Field label="Referred from" searchText={fieldSearch}><select value={filters.referredByEmployeeId} onChange={event => set("referredByEmployeeId",event.target.value)}><option value="">Anyone</option>{meta.employees.map(item => <option key={`${item.id}-${item.branchId}`} value={item.id}>{item.name} · {item.branchName}</option>)}</select></Field>
        </div>}
        {activeSection === "communication" && <div className="filter-grid"><Field label="Contact availability" searchText={fieldSearch}><select value={filters.contactAvailability} onChange={event => set("contactAvailability",event.target.value)}><option value="">Any contact details</option><option value="email">Has email address</option><option value="phone">Has phone number</option></select></Field></div>}
        {activeSection === "marketing" && <div className="filter-grid marketing-filter-grid">
          <div className="marketing-filter-intro"><span>WhatsApp campaigns</span><strong>Find leads by bulk campaign and delivery outcome</strong><small>Campaign filters work together with all lead, academic and date filters.</small></div>
          <Field label="Bulk marketing campaign" searchText={fieldSearch}><select value={filters.marketingCampaignId} onChange={event => set("marketingCampaignId",event.target.value)}><option value="">All bulk campaigns</option>{(meta.marketingCampaigns||[]).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
          <Field label="WhatsApp delivery status" searchText={fieldSearch}><select value={filters.marketingDeliveryStatus} onChange={event => set("marketingDeliveryStatus",event.target.value)}><option value="">Any delivery status</option>{["PENDING","RUNNING","QUEUED","SENT","DELIVERED","READ","FAILED","CANCELLED"].map(status => <option key={status} value={status}>{status.charAt(0)+status.slice(1).toLowerCase()}</option>)}</select></Field>
        </div>}
        {activeSection === "date" && <div className="filter-grid"><Field label="Follow-up from" searchText={fieldSearch}><input type="date" value={filters.followupFrom} onChange={event => set("followupFrom",event.target.value)}/></Field><Field label="Follow-up to" searchText={fieldSearch}><input type="date" value={filters.followupTo} onChange={event => set("followupTo",event.target.value)}/></Field></div>}
        {activeSection === "range" && <div className="filter-grid"><Field label="Minimum lead score" searchText={fieldSearch}><input type="number" min="0" max="100" value={filters.scoreMin} onChange={event => set("scoreMin",event.target.value)}/></Field><Field label="Maximum lead score" searchText={fieldSearch}><input type="number" min="0" max="100" value={filters.scoreMax} onChange={event => set("scoreMax",event.target.value)}/></Field></div>}
      </main>
    </div>
    <footer className="filter-workspace-footer"><div className={`filter-name-control ${nameError ? "invalid" : ""}`}><input className="filter-save-name" aria-invalid={Boolean(nameError)} aria-describedby="filter-name-error" value={name} onChange={event => {setName(event.target.value);if(event.target.value.trim())setNameError("");}} placeholder="Name this filter or view"/>{nameError && <span id="filter-name-error">{nameError}</span>}</div><button className="filter-secondary" onClick={() => {setFilters(emptyAdvancedFilters);setName("");setNameError("");setNotice("");}}><RotateCcw/> Reset</button><button className="filter-secondary" disabled={saving} onClick={() => save("filter")}><Save/> Save filter</button><button className="filter-secondary" disabled={saving} onClick={() => save("funnel")}><ListFilter/> Save view</button><button className="filter-apply" onClick={() => onApply(filters)}>Apply filter</button></footer>
  </div>;
}
