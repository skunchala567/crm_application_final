import { Children, isValidElement, useEffect, useMemo, useRef, useState } from "react";
import { CalendarRange, ChevronDown, ChevronLeft, ChevronRight, Filter, ListFilter, RotateCcw, Save, Search, X } from "lucide-react";
import { api } from "./api";
import "./FilterWorkspaceCampaign.css";

const multiKeys = ["branchId","stage","substageId","sourceId","channelId","channelCategory","campaignId","campaignCategory","marketingCampaignId","marketingDeliveryStatus","ownerEmployeeId","classId","curriculumId","admissionTypeId","referredByEmployeeId","touchStatus","leadEntryPath","isParent","lookingForAdmission","whatsappResponse","contactAvailability"];
const dateRangeKeys = ["addedFrom","addedTo","updatedFrom","updatedTo","referredFrom","referredTo","nextFollowupFrom","nextFollowupTo","reEnquiredFrom","reEnquiredTo"];
export const emptyAdvancedFilters = { ...Object.fromEntries([...multiKeys.map(key => [key,[]]),...["studentName","primaryPhone","alternatePhone","email","parentName","followupFrom","followupTo","scoreMin","scoreMax","isReferred",...dateRangeKeys].map(key => [key,""])]), dateType:"nextFollowup", isReferred:"no", pendingFollowupsOnly:false };
const legacyDateMap = { addedAt:["addedFrom","addedTo"], updatedAt:["updatedFrom","updatedTo"], referredAt:["referredFrom","referredTo"], nextFollowup:["nextFollowupFrom","nextFollowupTo"], reEnquiredAt:["reEnquiredFrom","reEnquiredTo"] };
export function normalizeFilters(filters={}) {
  const normalized = { ...emptyAdvancedFilters, ...filters, pendingFollowupsOnly:filters.pendingFollowupsOnly === true || filters.pendingFollowupsOnly === "true", ...Object.fromEntries(multiKeys.map(key => [key, Array.isArray(filters[key]) ? filters[key].map(String) : filters[key] ? [String(filters[key])] : []])) };
  if ((filters.followupFrom || filters.followupTo) && !dateRangeKeys.some(key => filters[key])) {
    const [fromKey,toKey] = legacyDateMap[filters.dateType || "nextFollowup"] || legacyDateMap.nextFollowup;
    normalized[fromKey] = filters.followupFrom || "";
    normalized[toKey] = filters.followupTo || "";
  }
  return normalized;
}

const sections = [
  ["lead", "Lead details"], ["academic", "Academic details"], ["communication", "Communication details"],
  ["marketing", "Marketing campaigns"],
  ["date", "Date filters"], ["range", "Range filters"],
];

const dateFilterRanges = [["Added","addedFrom","addedTo"],["Updated","updatedFrom","updatedTo"],["Referred","referredFrom","referredTo"],["Next Follow-up","nextFollowupFrom","nextFollowupTo"],["Re-Enquired","reEnquiredFrom","reEnquiredTo"]];

function localDateKey(date) {
  const value = new Date(date);
  value.setMinutes(value.getMinutes() - value.getTimezoneOffset());
  return value.toISOString().slice(0, 10);
}

function formatDateLabel(value) {
  if (!value) return "";
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { day:"2-digit", month:"short", year:"numeric" });
}

function formatRangeLabel(from, to) {
  if (from && to) return `${formatDateLabel(from)} - ${formatDateLabel(to)}`;
  if (from) return `From ${formatDateLabel(from)}`;
  if (to) return `Till ${formatDateLabel(to)}`;
  return "All dates";
}

function FilterCalendarMonth({ month, from, to, onSelect, previous, next, move }) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const blanks = first.getDay();
  const label = month.toLocaleDateString("en-IN", { month:"long", year:"numeric" });
  return <div className="range-calendar-month">
    <header>
      {previous ? <button type="button" aria-label="Previous month" onClick={() => move(-1)}><ChevronLeft/></button> : <span/>}
      <strong>{label}</strong>
      {next ? <button type="button" aria-label="Next month" onClick={() => move(1)}><ChevronRight/></button> : <span/>}
    </header>
    <div className="range-weekdays">{["Su","Mo","Tu","We","Th","Fr","Sa"].map(day => <span key={day}>{day}</span>)}</div>
    <div className="range-days">
      {Array.from({ length:blanks }).map((_, index) => <span key={`blank-${index}`}/>)}
      {Array.from({ length:days }).map((_, index) => {
        const key = localDateKey(new Date(month.getFullYear(), month.getMonth(), index + 1));
        const selected = key === from || key === to;
        const inRange = from && to && key > from && key < to;
        return <button type="button" key={key} className={`${selected ? "selected" : ""} ${inRange ? "in-range" : ""}`} onClick={() => onSelect(key)}>{index + 1}</button>;
      })}
    </div>
  </div>;
}

export function DateRangeFilterControl({ label, from, to, onChange, includeFuturePresets = true }) {
  const root = useRef(null);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => new Date());
  const [popoverStyle, setPopoverStyle] = useState({});
  const nextMonth = new Date(month.getFullYear(), month.getMonth() + 1, 1);

  useEffect(() => {
    if (!open) return undefined;
    function close(event) { if (!root.current?.contains(event.target)) setOpen(false); }
    function escape(event) { if (event.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", close, true);
    document.addEventListener("touchstart", close, true);
    document.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("mousedown", close, true); document.removeEventListener("touchstart", close, true); document.removeEventListener("keydown", escape, true); };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    function position() {
      const rect = root.current?.getBoundingClientRect();
      const width = Math.min(720, window.innerWidth - 24);
      const estimatedHeight = Math.min(560, window.innerHeight - 24);
      const left = Math.min(window.innerWidth - width - 12, Math.max(12, rect?.left ?? 12));
      const belowTop = (rect?.bottom ?? 80) + 8;
      const top = belowTop + estimatedHeight <= window.innerHeight - 12 ? belowTop : Math.max(12, window.innerHeight - estimatedHeight - 12);
      setPopoverStyle({ position:"fixed", width, left, top, zIndex:240 });
    }
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => { window.removeEventListener("resize", position); window.removeEventListener("scroll", position, true); };
  }, [open]);

  function setRange(nextFrom, nextTo) { onChange(nextFrom || "", nextTo || ""); }
  function select(key) {
    if (!from || to) setRange(key, "");
    else if (key < from) setRange(key, from);
    else setRange(from, key);
  }
  function preset(type, days = 0) {
    const today = new Date();
    if (type === "today") setRange(localDateKey(today), localDateKey(today));
    if (type === "tillToday") setRange("", localDateKey(today));
    if (type === "yesterday") { const d = new Date(); d.setDate(d.getDate() - 1); setRange(localDateKey(d), localDateKey(d)); }
    if (type === "till") { const d = new Date(); d.setDate(d.getDate() - 1); setRange("", localDateKey(d)); }
    if (type === "next") { const d = new Date(); d.setDate(d.getDate() + days); setRange(localDateKey(today), localDateKey(d)); }
  }

  return <div className="date-range-filter-control" ref={root}>
    <button type="button" className={`date-range-filter-trigger ${from || to ? "active" : ""}`} onClick={() => setOpen(value => !value)}><CalendarRange size={16}/><div><small>{label}</small><strong>{formatRangeLabel(from, to)}</strong></div><ChevronDown size={14}/></button>
    {open && <div className="followup-range-popover filter-workspace-date-popover" style={popoverStyle}>
      <div className="followup-range-title"><CalendarRange size={18}/><div><strong>{label}</strong><small>Select the {label.toLowerCase()} range</small></div></div>
      <div className="range-calendar-panel">
        <aside><strong>Choose a period</strong><button type="button" onClick={() => preset("today")}>Today</button><button type="button" onClick={() => preset("yesterday")}>Yesterday</button><button type="button" onClick={() => preset("tillToday")}>Till today</button><button type="button" onClick={() => preset("till")}>Till yesterday</button>{includeFuturePresets && <><button type="button" onClick={() => preset("next", 1)}>Next day</button><button type="button" onClick={() => preset("next", 7)}>Next 7 days</button><button type="button" onClick={() => preset("next", 30)}>Next 30 days</button></>}</aside>
        <div className="range-calendar-months"><FilterCalendarMonth month={month} from={from} to={to} onSelect={select} previous move={amount => setMonth(new Date(month.getFullYear(), month.getMonth() + amount, 1))}/><FilterCalendarMonth month={nextMonth} from={from} to={to} onSelect={select} next move={amount => setMonth(new Date(month.getFullYear(), month.getMonth() + amount, 1))}/></div>
      </div>
      <div className="followup-range-footer"><button type="button" className="range-clear" onClick={() => setRange("", "")}>Clear</button><button type="button" className="range-apply" onClick={() => setOpen(false)}>Apply dates</button></div>
    </div>}
  </div>;
}

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
    function escape(event) { if (event.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", close, true);
    document.addEventListener("touchstart", close, true);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("mousedown", close, true);
      document.removeEventListener("touchstart", close, true);
      document.removeEventListener("keydown", escape, true);
    };
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
  useEffect(()=>{function close(event){if(!root.current?.contains(event.target))setOpen(false)}function escape(event){if(event.key==="Escape")setOpen(false)}document.addEventListener("mousedown",close,true);document.addEventListener("touchstart",close,true);document.addEventListener("keydown",escape,true);return()=>{document.removeEventListener("mousedown",close,true);document.removeEventListener("touchstart",close,true);document.removeEventListener("keydown",escape,true)}},[]);
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

export default function FilterWorkspace({
  mode="filter", meta, initialFilters, onApply, onClose, onSaved,
  // "Is referred" answers a counsellor's question about their own desk, so it
  // is only offered where it means something. Off by default: a caller that
  // does not know about it should not surface it.
  showReferredFilter=false,
}) {
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
  function setRange(fromKey, toKey, from, to) { setFilters(current => ({ ...current, [fromKey]: from, [toKey]: to })); }
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

  const savedType = mode === "funnel" ? "funnel" : "filter";
  const savedOptions = [
    { value:"", label:mode === "funnel" ? "Select a saved view" : "Select a saved filter" },
    ...saved.filter(item => item.type === savedType).map(item => ({ value:String(item.id), label:item.name })),
  ];

  return <div className="filter-workspace" role="dialog" aria-modal="true" aria-label="Filter leads">
    <header className="filter-workspace-head"><div className="filter-title"><Filter/><h2>{mode === "funnel" ? "Create lead view" : "Filter leads"}</h2></div><div className="saved-filter-loader"><SearchSelect label={mode === "funnel" ? "Load saved view" : "Load saved filter"} value={selectedSaved} options={savedOptions} onChange={loadSaved}/></div><button className="filter-close" onClick={onClose}><X/></button></header>
    <div className="filter-chip-row"><span>Lead details <b>{Object.values(filters).filter(value=>Array.isArray(value)?value.length:Boolean(value)).length}</b></span>{notice && <em>{notice}</em>}</div>
    <div className="filter-workspace-body">
      <aside className="filter-sections">{sections.map(([key,label]) => <button key={key} className={activeSection === key ? "active" : ""} onClick={() => setActiveSection(key)}><i/>{label}</button>)}</aside>
      <main className="filter-fields"><div className="field-search"><Search/><input value={fieldSearch} onChange={event => setFieldSearch(event.target.value)} placeholder="Search filter fields"/></div>
        {activeSection === "lead" && <div className="filter-grid">
          <Field label="Touch status" searchText={fieldSearch}><select value={filters.touchStatus} onChange={event => set("touchStatus",event.target.value)}><option value="">Any touch status</option><option value="touched">Is touched</option><option value="untouched">Untouched</option></select></Field>
          <Field label="Lead added via" searchText={fieldSearch}><MultiSearchSelect label="Lead added via" value={filters.leadEntryPath} onChange={value => set("leadEntryPath",value)} options={[{value:"manual",label:"Manually added"},{value:"bulk_upload",label:"Bulk upload"},{value:"google_sheets",label:"Google Sheets"},{value:"integration",label:"Integration (Facebook and others)"},{value:"website_form",label:"Website enquiry form"}]}/></Field>
          <Field label="Branch" searchText={fieldSearch}><select value={filters.branchId} onChange={event => {set("branchId",event.target.value);set("ownerEmployeeId","");}}><option value="">All branches</option>{meta.branches.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
          <Field label="Current stage" searchText={fieldSearch}><select value={filters.stage} onChange={event => {set("stage",event.target.value);set("substageId","");}}><option value="">All stages</option>{meta.stages.map(item => <option key={item.id}>{item.displayName}</option>)}</select></Field>
          <Field label="Sub-stage" searchText={fieldSearch}><select value={filters.substageId} onChange={event => set("substageId",event.target.value)}><option value="">All sub-stages</option>{meta.substages.filter(item => !filters.stage.length || filters.stage.includes(String(meta.stages.find(stage => String(stage.id) === String(item.stageId))?.displayName))).map(item => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></Field>
          <Field label="Lead source" searchText={fieldSearch}><select value={filters.sourceId} onChange={event => set("sourceId",event.target.value)}><option value="">All sources</option>{meta.sources.map(item => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></Field>
          <Field label="Counsellor referred to" searchText={fieldSearch}><select value={filters.ownerEmployeeId} onChange={event => set("ownerEmployeeId",event.target.value)}><option value="">All counsellors</option>{employees.map(item => <option key={`${item.id}-${item.branchId}`} value={item.id}>{item.name} · {item.branchName}</option>)}</select></Field>
          <Field label="Campaign category" searchText={fieldSearch}><select value={filters.campaignCategory} onChange={event => {set("campaignCategory",event.target.value);set("campaignId","");}}><option value="">All campaign categories</option>{[...new Set(meta.campaigns.map(item => item.category))].map(item => <option key={item}>{item}</option>)}</select></Field>
          <Field label="Campaign name" searchText={fieldSearch}><select value={filters.campaignId} onChange={event => set("campaignId",event.target.value)}><option value="">All campaigns</option>{meta.campaigns.filter(item => !filters.campaignCategory.length || filters.campaignCategory.includes(item.category)).map(item => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></Field>
          <Field label="Channel category" searchText={fieldSearch}><select value={filters.channelCategory} onChange={event => {set("channelCategory",event.target.value);set("channelId","");}}><option value="">All channel categories</option><option>Primary</option><option>Secondary</option></select></Field>
          <Field label="Channel" searchText={fieldSearch}><select value={filters.channelId} onChange={event => set("channelId",event.target.value)}><option value="">All channels</option>{meta.channels.filter(item => !filters.channelCategory.length || filters.channelCategory.includes(item.category)).map(item => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></Field>
        </div>}
        {activeSection === "academic" && <div className="filter-grid">
          <Field label="Class" searchText={fieldSearch}><select value={filters.classId} onChange={event => set("classId",event.target.value)}><option value="">All classes</option>{meta.classes.map(item => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></Field>
          <Field label="Curriculum" searchText={fieldSearch}><select value={filters.curriculumId} onChange={event => set("curriculumId",event.target.value)}><option value="">All curricula</option>{meta.curricula.map(item => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></Field>
          <Field label="Admission type" searchText={fieldSearch}><select value={filters.admissionTypeId} onChange={event => set("admissionTypeId",event.target.value)}><option value="">All admission types</option>{meta.admissionTypes.map(item => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></Field>
          <Field label="Referred from" searchText={fieldSearch}><select value={filters.referredByEmployeeId} onChange={event => set("referredByEmployeeId",event.target.value)}><option value="">Anyone</option>{meta.employees.map(item => <option key={`${item.id}-${item.branchId}`} value={item.id}>{item.name} · {item.branchName}</option>)}</select></Field>
        </div>}
        {activeSection === "communication" && <div className="filter-grid">
          <Field label="Student name" searchText={fieldSearch}><input value={filters.studentName} onChange={event => set("studentName",event.target.value)} placeholder="Search student name"/></Field>
          <Field label="Primary phone" searchText={fieldSearch}><input value={filters.primaryPhone} onChange={event => set("primaryPhone",event.target.value.replace(/\D/g,""))} placeholder="Search primary phone"/></Field>
          <Field label="Alternate phone" searchText={fieldSearch}><input value={filters.alternatePhone} onChange={event => set("alternatePhone",event.target.value.replace(/\D/g,""))} placeholder="Search alternate phone"/></Field>
          <Field label="Email" searchText={fieldSearch}><input value={filters.email} onChange={event => set("email",event.target.value)} placeholder="Search email"/></Field>
          <Field label="Parent name" searchText={fieldSearch}><input value={filters.parentName} onChange={event => set("parentName",event.target.value)} placeholder="Search parent name"/></Field>
          <Field label="Contact availability" searchText={fieldSearch}><select value={filters.contactAvailability} onChange={event => set("contactAvailability",event.target.value)}><option value="">Any contact details</option><option value="email">Has email address</option><option value="phone">Has phone number</option><option value="alternatePhone">Has alternate phone</option></select></Field>
        </div>}
        {activeSection === "marketing" && <div className="filter-grid marketing-filter-grid">
          <div className="marketing-filter-intro"><span>WhatsApp campaigns</span><strong>Find leads by bulk campaign and delivery outcome</strong><small>Campaign filters work together with all lead, academic and date filters.</small></div>
          <Field label="Bulk marketing campaign" searchText={fieldSearch}><select value={filters.marketingCampaignId} onChange={event => set("marketingCampaignId",event.target.value)}><option value="">All bulk campaigns</option>{(meta.marketingCampaigns||[]).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
          <Field label="WhatsApp delivery status" searchText={fieldSearch}><select value={filters.marketingDeliveryStatus} onChange={event => set("marketingDeliveryStatus",event.target.value)}><option value="">Any delivery status</option>{["PENDING","RUNNING","QUEUED","SENT","DELIVERED","READ","FAILED","CANCELLED"].map(status => <option key={status} value={status}>{status.charAt(0)+status.slice(1).toLowerCase()}</option>)}</select></Field>
        </div>}
        {activeSection === "date" && <div className="filter-grid date-range-filter-grid">
          {dateFilterRanges.filter(([label]) => !fieldSearch || label.toLowerCase().includes(fieldSearch.toLowerCase())).map(([label,fromKey,toKey]) => <section className="date-range-filter-card" key={fromKey}>
            <h3>{label}</h3>
            <DateRangeFilterControl label={label} from={filters[fromKey]} to={filters[toKey]} onChange={(from, to) => setRange(fromKey, toKey, from, to)}/>
          </section>)}
        </div>}
        {activeSection === "range" && <div className="filter-grid">{showReferredFilter && <Field label="Is referred" searchText={fieldSearch}><select value={filters.isReferred ?? "no"} onChange={event => set("isReferred",event.target.value)}><option value="no">No · with me</option><option value="yes">Yes · referred by me</option><option value="">Any</option></select></Field>}<Field label="Minimum lead score" searchText={fieldSearch}><input type="number" min="0" max="100" value={filters.scoreMin} onChange={event => set("scoreMin",event.target.value)}/></Field><Field label="Maximum lead score" searchText={fieldSearch}><input type="number" min="0" max="100" value={filters.scoreMax} onChange={event => set("scoreMax",event.target.value)}/></Field></div>}
      </main>
    </div>
    <footer className="filter-workspace-footer"><div className={`filter-name-control ${nameError ? "invalid" : ""}`}><input className="filter-save-name" aria-invalid={Boolean(nameError)} aria-describedby="filter-name-error" value={name} onChange={event => {setName(event.target.value);if(event.target.value.trim())setNameError("");}} placeholder="Name this filter or view"/>{nameError && <span id="filter-name-error">{nameError}</span>}</div><button className="filter-secondary" onClick={() => {setFilters(emptyAdvancedFilters);setName("");setNameError("");setNotice("");}}><RotateCcw/> Reset</button><button className="filter-secondary" disabled={saving} onClick={() => save("filter")}><Save/> Save filter</button><button className="filter-secondary" disabled={saving} onClick={() => save("funnel")}><ListFilter/> Save view</button><button className="filter-apply" onClick={() => onApply(filters)}>Apply filter</button></footer>
  </div>;
}
