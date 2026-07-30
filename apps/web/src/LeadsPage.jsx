import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  CalendarRange,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  History,
  Megaphone,
  NotebookPen,
  MessageSquare,
  MessageCircle,
  MoreVertical,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  UserRoundPlus,
  X,
  GitBranch,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { createPortal } from "react-dom";
import { api } from "./api";
import FilterWorkspace, { emptyAdvancedFilters, MultiSearchSelect, normalizeFilters } from "./FilterWorkspace.jsx";
import { BulkUploadButton } from "./BulkUpload.jsx";
import { StageChangeDialog } from "./StageChangeDialog.jsx";
import { BulkStageChangeConfirm } from "./BulkStageChangeConfirm.jsx";
import Toast from "./Toast.jsx";
import { WhatsAppSendPanel } from "./components/WhatsAppSendPanel.jsx";
import { MarketingCampaignBuilder } from "./MarketingCampaigns.jsx";
import "./LeadsUnread.css";
import "./LeadsStickyLayout.css";
import "./ProjectPagination.css";

const emptyForm = {
  studentName: "",
  phone: "",
  alternatePhone: "",
  email: "",
  parentName: "",
  classId: "",
  curriculumId: "",
  academicYear: "2026-27",
  city: "",
  branchId: "",
  stageId: "",
  sourceId: "",
  channelId: "",
  campaignId: "",
  admissionTypeId: "",
  substageId: "",
  ownerEmployeeId: "",
  leadScore: 50,
  nextFollowupAt: "",
  followupType: "",
  remarks: "",
  status: "Active",
  customValues: {},
  sourceHistory: [],
};

const cleanPhone = (value) => String(value || "").replace(/\D/g, "").slice(-10);

function toLocalInput(value) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function serialize(form) {
  return {
    ...form,
    branchId: Number(form.branchId),
    classId: form.classId ? Number(form.classId) : null,
    curriculumId: form.curriculumId ? Number(form.curriculumId) : null,
    stageId: Number(form.stageId),
    sourceId: form.sourceId ? Number(form.sourceId) : null,
    channelId: form.channelId ? Number(form.channelId) : null,
    campaignId: form.campaignId ? Number(form.campaignId) : null,
    admissionTypeId: form.admissionTypeId ? Number(form.admissionTypeId) : null,
    substageId: form.substageId ? Number(form.substageId) : null,
    ownerEmployeeId: form.ownerEmployeeId ? Number(form.ownerEmployeeId) : null,
    leadScore: Number(form.leadScore || 0),
    nextFollowupAt: form.nextFollowupAt ? `${form.nextFollowupAt}:00` : null,
  };
}

function SearchSuggestion({
  label,
  options,
  value,
  onChange,
  required = false,
  placeholder = "Search or select…",
}) {
  const listId = `suggest-${label.toLowerCase().replaceAll(" ", "-")}`;
  const selected = options.find(
    (option) => String(option.id) === String(value),
  );
  const [query, setQuery] = useState(selected?.label || "");
  useEffect(() => {
    setQuery(selected?.label || "");
  }, [value, selected?.label]);
  function update(text) {
    setQuery(text);
    const match = options.find(
      (option) => option.label.toLowerCase() === text.trim().toLowerCase(),
    );
    onChange(match?.id || "");
  }
  return (
    <label>
      {label}
      {required ? " *" : ""}
      <div className="suggestion-field">
        <Search size={15} />
        <input
          required={required}
          list={listId}
          value={query}
          placeholder={placeholder}
          onChange={(event) => update(event.target.value)}
          autoComplete="off"
        />
        <datalist id={listId}>
          {options.map((option) => (
            <option key={option.id} value={option.label} />
          ))}
        </datalist>
      </div>
    </label>
  );
}

const configuredFieldProperties = {
  name:"studentName",student_name:"studentName",phone:"phone",primary_phone:"phone",
  alternate_phone:"alternatePhone",email:"email",parent_name:"parentName",city:"city",
  academic_year:"academicYear",branch_id:"branchId",admission_type_id:"admissionTypeId",
  curriculum_id:"curriculumId",class_id:"classId",channel_id:"channelId",source_id:"sourceId",
  campaign_id:"campaignId",stage_id:"stageId",substage_id:"substageId",
  owner_employee_id:"ownerEmployeeId",next_followup_at_utc:"nextFollowupAt",
  followup_type:"followupType",remarks:"remarks",lead_score:"leadScore",
};

function ConfiguredLeadFields({fields,form,setForm,meta,availableAdmissionTypes,availableCurricula,availableClasses,inputRef}){
  const update=(field,value)=>{
    const property=configuredFieldProperties[field.fieldKey];
    if(property){
      const resets={};
      if(property==="branchId")resets.ownerEmployeeId="";
      if(property==="admissionTypeId")Object.assign(resets,{curriculumId:"",classId:""});
      if(property==="curriculumId")resets.classId="";
      if(property==="channelId")Object.assign(resets,{sourceId:"",campaignId:""});
      if(property==="sourceId")resets.campaignId="";
      if(property==="stageId")Object.assign(resets,{substageId:"",nextFollowupAt:"",followupType:""});
      setForm(current=>({...current,...resets,[property]:value}));
    }else setForm(current=>({...current,customValues:{...(current.customValues||{}),[field.fieldKey]:value}}));
  };
  const valueOf=field=>{
    const property=configuredFieldProperties[field.fieldKey];
    return property?form[property]??"":form.customValues?.[field.fieldKey]??"";
  };
  const optionsFor=field=>{
    const map={
      academic_year:meta.academicYears.map(item=>({id:item.academicYear,label:item.displayName||item.academicYear})),
      branch_id:meta.branches.map(item=>({id:item.id,label:item.name})),
      admission_type_id:(availableAdmissionTypes.length?availableAdmissionTypes:meta.admissionTypes).map(item=>({id:item.id,label:item.displayName})),
      curriculum_id:(availableCurricula.length?availableCurricula:meta.curricula).map(item=>({id:item.id,label:item.displayName})),
      channel_id:meta.channels.map(item=>({id:item.id,label:item.displayName})),
      source_id:meta.sources.map(item=>({id:item.id,label:item.displayName})),
      campaign_id:meta.campaigns.map(item=>({id:item.id,label:item.displayName})),
      stage_id:meta.stages.map(item=>({id:item.id,label:item.displayName})),
      substage_id:meta.substages.filter(item=>!form.stageId||String(item.stageId)===String(form.stageId)).map(item=>({id:item.id,label:item.displayName})),
      owner_employee_id:meta.employees.filter(item=>!form.branchId||String(item.branchId)===String(form.branchId)).map(item=>({id:item.id,label:item.name})),
      followup_type:["Call","WhatsApp","Email","Visit"].map(item=>({id:item,label:item})),
    };
    return map[field.fieldKey]||(field.options||[]).map(item=>({id:item,label:item}));
  };
  return <div className="form-grid configured-lead-fields">
    {fields.map(field=>{
      const value=valueOf(field),required=Boolean(field.isRequired),label=<>{field.displayName}{required?" *":""}</>;
      if(field.fieldKey==="class_id")return <SearchSuggestion key={field.id} label={field.displayName} required={required} options={availableClasses.map(item=>({id:item.id,label:item.displayName}))} value={value} onChange={next=>update(field,next)} placeholder={availableClasses.length?"Search class…":"No classes available"}/>;
      const options=optionsFor(field);
      if(options.length||["single_select","multi_select","user"].includes(field.fieldType)){
        if(field.fieldType==="multi_select")return <label key={field.id}>{label}<select multiple required={required} value={Array.isArray(value)?value:[]} onChange={event=>update(field,Array.from(event.target.selectedOptions,option=>option.value))}>{options.map(option=><option key={option.id} value={option.id}>{option.label}</option>)}</select></label>;
        return <label key={field.id}>{label}<select required={required} value={value} onChange={event=>update(field,event.target.value)}><option value="">{required?"Select":"Not specified"} {field.displayName.toLowerCase()}</option>{options.map(option=><option key={option.id} value={option.id}>{option.label}</option>)}</select></label>;
      }
      if(field.fieldType==="boolean")return <label key={field.id} className="configured-checkbox"><input type="checkbox" checked={Boolean(value)} onChange={event=>update(field,event.target.checked)}/>{field.displayName}</label>;
      if(["textarea"].includes(field.fieldType))return <label key={field.id} className="wide">{label}<textarea required={required} rows="4" placeholder={field.placeholder||""} value={value} onChange={event=>update(field,event.target.value)}/></label>;
      const type={phone:"tel",email:"email",number:"number",decimal:"number",date:"date",datetime:"datetime-local",file:"file"}[field.fieldType]||"text";
      return <label key={field.id}>{label}<input ref={["name","student_name"].includes(field.fieldKey)?inputRef:undefined} required={required} type={type} step={field.fieldType==="decimal"?"any":undefined} placeholder={field.placeholder||""} value={type==="file"?undefined:value} onChange={event=>update(field,type==="file"?event.target.files?.[0]?.name||"":field.fieldType==="phone"?event.target.value.replace(/\D/g,"").slice(0,15):event.target.value)}/></label>;
    })}
  </div>;
}

function formatRangeDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T00:00:00`));
}

function istDateKey(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const item = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${item.year}-${item.month}-${item.day}`;
}

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function RangeCalendarMonth({ month, from, to, onSelect, onPrevious, onNext, previous, next }) {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstDay = new Date(year, monthIndex, 1).getDay();
  const days = new Date(year, monthIndex + 1, 0).getDate();
  return <section className="range-calendar-month">
    <header>{previous ? <button type="button" aria-label="Previous month" onClick={onPrevious}><ChevronLeft/></button> : <span/>}<strong>{month.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</strong>{next ? <button type="button" aria-label="Next month" onClick={onNext}><ChevronRight/></button> : <span/>}</header>
    <div className="range-weekdays">{["Su","Mo","Tu","We","Th","Fr","Sa"].map(day => <span key={day}>{day}</span>)}</div>
    <div className="range-days">{Array.from({ length: firstDay }, (_, index) => <span key={`blank-${index}`}/>)}{Array.from({ length: days }, (_, index) => { const key=localDateKey(new Date(year,monthIndex,index+1)); const selected=key===from||key===to; const within=from&&to&&key>from&&key<to; return <button type="button" key={key} className={`${selected?"selected ":""}${within?"in-range":""}`} onClick={() => onSelect(key)}>{index+1}</button>; })}</div>
  </section>;
}

function FollowupDateFilter({ from, to, onChange, dueCount = 0, dateType = "nextFollowup", onDateTypeChange }) {
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const rootRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = event => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const dateTypeLabels = {
    addedAt: "Added",
    updatedAt: "Updated",
    referredAt: "Referred",
    nextFollowup: "Next Follow-up",
    reEnquiredAt: "Re-Enquired"
  };
  const label = from && to ? `${formatRangeDate(from)} – ${formatRangeDate(to)}` : from ? `${formatRangeDate(from)} – select end` : to ? `Till ${formatRangeDate(to)}` : "All dates";
  function selectDate(key) {
    if (!from || to) onChange(key, "");
    else if (key < from) onChange(key, from);
    else onChange(from, key);
  }
  function preset(days) {
    const start = new Date();
    const end = new Date(start);
    end.setDate(end.getDate() + days);
    const key = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    onChange(key(start), key(end));
  }
  function toggleOpen() {
    const initial = from ? new Date(`${from}T00:00:00`) : new Date();
    setVisibleMonth(new Date(initial.getFullYear(), initial.getMonth(), 1));
    setOpen(value => !value);
  }
  function yesterday(till = false) {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    const key = localDateKey(date);
    onChange(till ? "" : key, key);
  }
  const nextMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1);
  return <div className="inline-lead-filter followup-date-filter" ref={rootRef}>
    <span>Follow-ups</span>
    <button type="button" className={`followup-range-trigger ${from || to ? "active" : ""}`} aria-expanded={open} onClick={toggleOpen}><CalendarRange size={16}/><div style={{display:"flex",flexDirection:"column",alignItems:"flex-start",minWidth:0,flex:1}}><small style={{fontSize:"10px",color:"#999"}}>{dateTypeLabels[dateType]}</small><b>{label}</b></div><ChevronDown size={14}/><span className={`followup-due-badge ${dueCount>0?"has-due":""}`} title={`${dueCount} follow-ups due through today`}>{dueCount>99?"99+":dueCount}</span></button>
    {open && <div className="followup-range-popover">
      <div className="followup-range-header">
        <div className="followup-range-title"><CalendarRange size={18}/><div><strong>{dateTypeLabels[dateType]}</strong><small>Select the {dateTypeLabels[dateType].toLowerCase()} range</small></div></div>
        <select value={dateType} onChange={(e) => onDateTypeChange(e.target.value)} className="date-type-select-popover" title="Select date type to filter by">
          <option value="addedAt">Added</option>
          <option value="updatedAt">Updated</option>
          <option value="referredAt">Referred</option>
          <option value="nextFollowup">Next Follow-up</option>
          <option value="reEnquiredAt">Re-Enquired</option>
        </select>
      </div>
      <div className="range-calendar-panel">
        <aside><strong>Choose a period</strong><button type="button" onClick={() => preset(0)}>Today</button><button type="button" onClick={() => yesterday()}>Yesterday</button><button type="button" onClick={() => yesterday(true)}>Till yesterday</button><button type="button" onClick={() => preset(1)}>Next day</button><button type="button" onClick={() => preset(7)}>Next 7 days</button><button type="button" onClick={() => preset(30)}>Next 30 days</button></aside>
        <div className="range-calendar-months"><RangeCalendarMonth month={visibleMonth} from={from} to={to} onSelect={selectDate} onPrevious={() => setVisibleMonth(new Date(visibleMonth.getFullYear(),visibleMonth.getMonth()-1,1))} previous/><RangeCalendarMonth month={nextMonth} from={from} to={to} onSelect={selectDate} onNext={() => setVisibleMonth(new Date(visibleMonth.getFullYear(),visibleMonth.getMonth()+1,1))} next/></div>
      </div>
      <div className="followup-range-footer"><button type="button" className="range-clear" onClick={() => onChange("", "")}>Clear</button><button type="button" className="range-apply" onClick={() => setOpen(false)}>Apply dates</button></div>
    </div>}
  </div>;
}

function FunnelStrip({
  funnels,
  onApply,
  onDelete,
  onCreate,
  onAddLead,
  onSearch,
  onMessages,
  unreadCount = 0,
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const searchInputRef = useRef(null);

  return (
    <div className="funnel-strip">

      {/* Left Side - Search */}
      <div className="global-search-box-inline">
        <input
          ref={searchInputRef}
          type="text"
          placeholder="Search by name, phone, or lead number..."
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const value = e.target.value.trim();
              if (value) {
                onSearch(value);
              }
            }
          }}
        />
      </div>

      {/* Right Side */}
      <div className="funnel-header-actions">

        {funnels.length > 0 && (
          <div className="funnel-more-wrap">
            <button
              className="funnel-more"
              onClick={() => setMoreOpen(!moreOpen)}
            >
              More +{funnels.length}
              <ChevronDown size={14} />
            </button>

            {moreOpen && (
              <div className="funnel-more-menu">
                {funnels.map((funnel) => (
                  <div className="funnel-more-item" key={funnel.id}>
                    <button
                      onClick={() => {
                        onApply(funnel);
                        setMoreOpen(false);
                      }}
                    >
                      {funnel.name}
                    </button>

                    <button
                      className="funnel-delete"
                      title={`Delete ${funnel.name}`}
                      onClick={() => onDelete(funnel)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <button className="create-funnel" onClick={onCreate}>
          <Plus size={17} />
          Create view
        </button>

        <button
          className="create-funnel add-lead-header"
          onClick={onAddLead}
        >
          <Plus size={17} />
          Add lead
        </button>

        <button className="header-action-icon" title={`${unreadCount} unread WhatsApp messages`} onClick={onMessages}>
          <MessageCircle size={18} />
          <i className={unreadCount ? "green has-count" : "green"}>{unreadCount > 99 ? "99+" : unreadCount}</i>
        </button>

        <button className="header-action-icon" title="Notifications">
          <Bell size={18} />
          <i>0</i>
        </button>

      </div>

    </div>
  );
}

function getDateFieldValue(lead, dateType) {
  const dateMap = {
    addedAt: lead.addedAt,
    updatedAt: lead.updatedAt,
    referredAt: lead.referredAt,
    nextFollowup: lead.nextFollowup,
    reEnquiredAt: lead.reEnquiredAt,
  };
  return dateMap[dateType] || lead.nextFollowup;
}

export default function LeadsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [leads, setLeads] = useState([]);
  const [totalLeads, setTotalLeads] = useState(0);
  const [stageCounts, setStageCounts] = useState({});
  const [followupsTillToday,setFollowupsTillToday]=useState(0);
  const [meta, setMeta] = useState({
    stages: [],
    sources: [],
    classes: [],
    curricula: [],
    channels: [],
    sourceLinks: [],
    campaignLinks: [],
    campaigns: [],
    admissionTypes: [],
    substages: [],
    branches: [],
    employees: [],
    academicYears: [],
    leadFields: [],
    marketingCampaigns: [],
  });
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [branchFilter, setBranchFilter] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState(null);
  const [drawerTab,setDrawerTab]=useState("student");
  const [secondarySource,setSecondarySource]=useState({academicYear:"",sourceId:"",channelId:"",campaignId:""});
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [openActionId,setOpenActionId]=useState(null);
  useEffect(() => {
    if (!openActionId) return undefined;
    const closeOnOutsideInteraction = (event) => {
      if (
        event.target.closest?.("[data-lead-action-trigger]") ||
        event.target.closest?.("[data-lead-action-menu]")
      )
        return;
      setOpenActionId(null);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setOpenActionId(null);
    };
    const closeMenu = () => setOpenActionId(null);
    document.addEventListener("pointerdown", closeOnOutsideInteraction);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideInteraction);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [openActionId]);
  const [referLead,setReferLead]=useState(null);
  const [followupModal,setFollowupModal]=useState(null);
  const [historyModal,setHistoryModal]=useState(null);
  const [followupForm,setFollowupForm]=useState({stageId:"",substageId:"",comment:"",comments:[],nextFollowupAt:"",followupType:"",referralBranchId:"",referralEmployeeId:""});
  const [referBranchId,setReferBranchId]=useState("");
  const [referEmployeeId,setReferEmployeeId]=useState("");
  const [referralOptions,setReferralOptions]=useState({branches:[],employees:[]});
  const [savedFunnel, setSavedFunnel] = useState(() => localStorage.getItem("crm_saved_funnel") || "");
  const [filterPanel, setFilterPanel] = useState(null);
  const [appliedFiltersExpanded, setAppliedFiltersExpanded] = useState(true);
  const [advancedFilters, setAdvancedFilters] = useState(emptyAdvancedFilters);
  const [followupDateType, setFollowupDateType] = useState("nextFollowup");
  const [funnels, setFunnels] = useState([]);
  const [quickActionsExpanded,setQuickActionsExpanded]=useState(false);
  const [stageChangeTarget, setStageChangeTarget] = useState(null);
  const [showStageChangeConfirm, setShowStageChangeConfirm] = useState(false);
  const [availableAdmissionTypes, setAvailableAdmissionTypes] = useState([]);
  const [availableCurricula, setAvailableCurricula] = useState([]);
  const [availableClasses, setAvailableClasses] = useState([]);
  const [pageSize, setPageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);
  const [whatsAppRecipients, setWhatsAppRecipients] = useState(null);
  const [marketingLeadIds, setMarketingLeadIds] = useState(null);
  const [whatsAppConversations, setWhatsAppConversations] = useState([]);
  const studentNameInputRef = useRef(null);
  function toggleQuickActions(){setQuickActionsExpanded(current=>!current)}

  async function loadFunnels() {
    try {
      const result = await api("/saved-filters");
      setFunnels(result.data.filter((item) => item.type === "funnel"));
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    }
  }

  async function loadMeta() {
    const [result, marketingResult] = await Promise.all([
      api("/leads/meta"),
      api("/marketing-campaigns"),
    ]);
    const combined = {
      ...result,
      marketingCampaigns: marketingResult.data || [],
    };
    setMeta(combined);
    return combined;
  }

  async function loadLeads(term = search) {
    setLoading(true);
    try {
      const result = await api(`/leads?search=${encodeURIComponent(term)}`);
      setLeads(result.data);
      setTotalLeads(Number(result.total||0));
      setStageCounts(result.stageCounts||{});
      setFollowupsTillToday(Number(result.followupsTillToday||0));
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setLoading(false);
    }
  }

  async function loadWhatsAppUnread() {
    try {
      const result = await api("/hub/smartping/conversations?limit=100&incomingOnly=1");
      setWhatsAppConversations(result.data || []);
    } catch {
      setWhatsAppConversations([]);
    }
  }

  useEffect(() => {
    Promise.all([loadMeta(), loadLeads(""), loadFunnels(), loadWhatsAppUnread()]).catch((error) =>
      setMessage({ type: "error", text: error.message }),
    );
  }, []);
  useEffect(() => {
    const refresh = () => loadWhatsAppUnread();
    const timer = window.setInterval(refresh, 10000);
    window.addEventListener("crm:whatsapp-read", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("crm:whatsapp-read", refresh);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'q') {
        event.preventDefault();
        openCreate();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [meta]);

  useEffect(() => {
    if (drawer?.mode === "create") {
      setTimeout(() => {
        studentNameInputRef.current?.focus();
      }, 100);
    }
  }, [drawer]);
  useEffect(() => {
    const timer = setTimeout(() => loadLeads(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, stageFilter, branchFilter, advancedFilters]);
  useEffect(() => {
    const query = searchParams.get("q");
    if (query !== null) setSearch(query);
  }, [searchParams]);
  useEffect(() => {
    if (searchParams.get("new") === "1" && meta.stages.length) {
      openCreate();
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.delete("new");
        return next;
      }, { replace: true });
    }
  }, [searchParams, meta.stages.length]);

  useEffect(() => {
    async function fetchAvailableAdmissionTypes() {
      if (form.academicYear && form.branchId) {
        try {
          const result = await api(`/available-admission-types?academicYear=${encodeURIComponent(form.academicYear)}&branchId=${form.branchId}`);
          setAvailableAdmissionTypes(result.admissionTypes || []);
          const firstAvailableType = result.admissionTypes?.[0];
          if (firstAvailableType && !form.admissionTypeId) {
            setForm(prev => ({ ...prev, admissionTypeId: String(firstAvailableType.id), curriculumId: '', classId: '' }));
          } else if (!result.admissionTypes?.some(at => String(at.id) === String(form.admissionTypeId))) {
            setForm(prev => ({ ...prev, admissionTypeId: '', curriculumId: '', classId: '' }));
          }
        } catch (error) {
          setAvailableAdmissionTypes([]);
        }
      } else {
        setAvailableAdmissionTypes([]);
        if (form.admissionTypeId || form.curriculumId || form.classId) {
          setForm(prev => ({ ...prev, admissionTypeId: '', curriculumId: '', classId: '' }));
        }
      }
    }
    fetchAvailableAdmissionTypes();
  }, [form.academicYear, form.branchId]);

  useEffect(() => {
    async function fetchAvailableCurricula() {
      if (form.academicYear && form.branchId && form.admissionTypeId) {
        try {
          const result = await api(`/available-curricula?academicYear=${encodeURIComponent(form.academicYear)}&branchId=${form.branchId}&admissionTypeId=${form.admissionTypeId}`);
          setAvailableCurricula(result.curricula || []);
          if (!result.curricula?.some(c => String(c.id) === String(form.curriculumId))) {
            setForm(prev => ({ ...prev, curriculumId: '', classId: '' }));
          }
        } catch (error) {
          setAvailableCurricula([]);
        }
      } else {
        setAvailableCurricula([]);
        if (form.curriculumId || form.classId) {
          setForm(prev => ({ ...prev, curriculumId: '', classId: '' }));
        }
      }
    }
    fetchAvailableCurricula();
  }, [form.academicYear, form.branchId, form.admissionTypeId]);

  useEffect(() => {
    async function fetchAvailableClasses() {
      if (form.academicYear && form.branchId && form.curriculumId && form.admissionTypeId) {
        try {
          const result = await api(`/available-classes?academicYear=${encodeURIComponent(form.academicYear)}&branchId=${form.branchId}&curriculumId=${form.curriculumId}&admissionTypeId=${form.admissionTypeId}`);
          setAvailableClasses(result.classes || []);
          if (!result.classes?.some(c => String(c.id) === String(form.classId))) {
            setForm(prev => ({ ...prev, classId: '' }));
          }
        } catch (error) {
          setAvailableClasses([]);
        }
      } else {
        setAvailableClasses([]);
        if (form.classId) {
          setForm(prev => ({ ...prev, classId: '' }));
        }
      }
    }
    fetchAvailableClasses();
  }, [form.academicYear, form.branchId, form.curriculumId, form.admissionTypeId]);

  useEffect(() => {
    const id = searchParams.get("openLead");
    if (id && meta.stages.length) {
      openLead(Number(id), "view");
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.delete("openLead");
        return next;
      }, { replace: true });
    }
  }, [searchParams, meta.stages.length]);

  const leadsMatchingActiveFilters = useMemo(
    () =>
      leads.filter(
        (lead) =>
          (!branchFilter.length || branchFilter.includes(String(lead.branchId))) &&
          (!advancedFilters.sourceId.length || advancedFilters.sourceId.includes(String(lead.sourceId))) &&
          (!advancedFilters.ownerEmployeeId.length || advancedFilters.ownerEmployeeId.includes(String(lead.ownerEmployeeId))) &&
          (!advancedFilters.classId.length || advancedFilters.classId.includes(String(lead.classId))) &&
          (!advancedFilters.curriculumId.length || advancedFilters.curriculumId.includes(String(lead.curriculumId))) &&
          (!advancedFilters.substageId.length || advancedFilters.substageId.includes(String(lead.substageId))) &&
          (!advancedFilters.channelId.length || advancedFilters.channelId.includes(String(lead.channelId))) &&
          (!advancedFilters.channelCategory.length || advancedFilters.channelCategory.includes(String(lead.channelCategory))) &&
          (!advancedFilters.campaignId.length || advancedFilters.campaignId.includes(String(lead.campaignId))) &&
          (!advancedFilters.campaignCategory.length || advancedFilters.campaignCategory.includes(String(lead.campaignCategory))) &&
          (!advancedFilters.admissionTypeId.length || advancedFilters.admissionTypeId.includes(String(lead.admissionTypeId))) &&
          (!advancedFilters.referredByEmployeeId.length || advancedFilters.referredByEmployeeId.includes(String(lead.referredByEmployeeId))) &&
          (!advancedFilters.touchStatus.length || advancedFilters.touchStatus.includes(String(lead.touchStatus))) &&
          (!advancedFilters.isParent.length || advancedFilters.isParent.some(value => value === "yes" ? Boolean(lead.isParent) : !lead.isParent)) &&
          (!advancedFilters.lookingForAdmission.length || advancedFilters.lookingForAdmission.some(value => value === "yes" ? Boolean(lead.lookingForAdmission) : !lead.lookingForAdmission)) &&
          (!advancedFilters.whatsappResponse.length || advancedFilters.whatsappResponse.includes(String(lead.whatsappResponse))) &&
          (!advancedFilters.contactAvailability.length || advancedFilters.contactAvailability.some(value => value === "email" ? Boolean(lead.email) : Boolean(lead.phone))) &&
          (!advancedFilters.marketingCampaignId.length && !advancedFilters.marketingDeliveryStatus.length ||
            (lead.marketingDeliveries || []).some(delivery =>
              (!advancedFilters.marketingCampaignId.length || advancedFilters.marketingCampaignId.includes(String(delivery.campaignId))) &&
              (!advancedFilters.marketingDeliveryStatus.length || advancedFilters.marketingDeliveryStatus.includes(String(delivery.status)))
            )) &&
          (!advancedFilters.scoreMin || Number(lead.score) >= Number(advancedFilters.scoreMin)) &&
          (!advancedFilters.scoreMax || Number(lead.score) <= Number(advancedFilters.scoreMax)) &&
          (!advancedFilters.followupFrom || (getDateFieldValue(lead, followupDateType) && istDateKey(getDateFieldValue(lead, followupDateType)) >= advancedFilters.followupFrom)) &&
          (!advancedFilters.followupTo || (getDateFieldValue(lead, followupDateType) && istDateKey(getDateFieldValue(lead, followupDateType)) <= advancedFilters.followupTo)),
      ),
    [leads, branchFilter, advancedFilters, followupDateType],
  );
  const filtered = useMemo(
    () => leadsMatchingActiveFilters.filter(
      lead =>
        (!stageFilter || stageFilter === "Re-enquired" || lead.stage === stageFilter) &&
        (stageFilter !== "Re-enquired" || Boolean(lead.reEnquiredAt)),
    ),
    [leadsMatchingActiveFilters, stageFilter],
  );
  const filteredStageCounts = useMemo(() => {
    const counts = Object.fromEntries(meta.stages.map(stage => [stage.displayName, 0]));
    for (const lead of leadsMatchingActiveFilters) {
      if (lead.stage) counts[lead.stage] = Number(counts[lead.stage] || 0) + 1;
    }
    counts["Re-enquired"] = leadsMatchingActiveFilters.filter(lead => Boolean(lead.reEnquiredAt)).length;
    return counts;
  }, [leadsMatchingActiveFilters, meta.stages]);
  const appliedFilterGroups = useMemo(() => {
    const findLabels = (values, options) => (values || [])
      .map(value => options.find(option => String(option.id ?? option.value ?? option.displayName) === String(value))?.displayName
        || options.find(option => String(option.id ?? option.value ?? option.name) === String(value))?.name
        || options.find(option => String(option.id ?? option.value ?? option.label) === String(value))?.label
        || String(value))
      .filter(Boolean);
    const add = (target, label, values) => {
      const list = Array.isArray(values) ? values.filter(Boolean) : values ? [values] : [];
      if (list.length) target.push({ label, values:list });
    };
    const lead = [], academic = [], communication = [], marketing = [], dates = [], ranges = [];
    add(lead, "Search", search);
    add(lead, "Branch", findLabels(branchFilter, meta.branches));
    add(lead, "Touch status", advancedFilters.touchStatus.map(value => value === "touched" ? "Is touched" : value === "untouched" ? "Untouched" : value));
    add(lead, "Current stage", stageFilter || advancedFilters.stage);
    add(lead, "Sub-stage", findLabels(advancedFilters.substageId, meta.substages));
    add(lead, "Lead source", findLabels(advancedFilters.sourceId, meta.sources));
    add(lead, "Counsellor", findLabels(advancedFilters.ownerEmployeeId, meta.employees));
    add(lead, "Channel category", advancedFilters.channelCategory);
    add(lead, "Channel", findLabels(advancedFilters.channelId, meta.channels));
    add(lead, "Campaign category", advancedFilters.campaignCategory);
    add(lead, "Campaign", findLabels(advancedFilters.campaignId, meta.campaigns));
    add(academic, "Class", findLabels(advancedFilters.classId, meta.classes));
    add(academic, "Curriculum", findLabels(advancedFilters.curriculumId, meta.curricula));
    add(academic, "Admission type", findLabels(advancedFilters.admissionTypeId, meta.admissionTypes));
    add(academic, "Referred from", findLabels(advancedFilters.referredByEmployeeId, meta.employees));
    add(communication, "Parent", advancedFilters.isParent.map(value => value === "yes" ? "Yes" : "No"));
    add(communication, "Looking for admissions", advancedFilters.lookingForAdmission.map(value => value === "yes" ? "Yes" : "No"));
    add(communication, "WhatsApp response", advancedFilters.whatsappResponse);
    add(communication, "Contact availability", advancedFilters.contactAvailability.map(value => value === "email" ? "Has email address" : "Has phone number"));
    add(marketing, "Bulk campaign", findLabels(advancedFilters.marketingCampaignId, meta.marketingCampaigns || []));
    add(marketing, "Delivery status", advancedFilters.marketingDeliveryStatus);
    add(dates, `${followupDateType === "addedDate" ? "Added date" : followupDateType === "modifiedDate" ? "Modified date" : "Follow-up"} from`, advancedFilters.followupFrom);
    add(dates, `${followupDateType === "addedDate" ? "Added date" : followupDateType === "modifiedDate" ? "Modified date" : "Follow-up"} to`, advancedFilters.followupTo);
    add(ranges, "Minimum lead score", advancedFilters.scoreMin);
    add(ranges, "Maximum lead score", advancedFilters.scoreMax);
    return [
      ["Lead details", lead],
      ["Academic details", academic],
      ["Communication details", communication],
      ["Marketing campaigns", marketing],
      ["Date filters", dates],
      ["Range filters", ranges],
    ].filter(([,items]) => items.length);
  }, [search, branchFilter, stageFilter, advancedFilters, followupDateType, meta]);
  const hasAppliedFilters = appliedFilterGroups.length > 0;
  const totalRecords = filtered.length;
  const totalPages = Math.ceil(totalRecords / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalRecords);
  const paginatedLeads = filtered.slice(startIndex, endIndex);

  const selectedStage = meta.stages.find(stage => String(stage.id) === String(form.stageId));
  const followupRequired = Boolean(selectedStage?.requiresFollowup);
  const modalStage = meta.stages.find(stage => String(stage.id) === String(followupForm.stageId));
  const modalFollowupRequired = Boolean(modalStage?.requiresFollowup);
  const minimumFollowupTime = toLocalInput(new Date(Date.now() + 60000).toISOString());

  function createFunnel() {
    setFilterPanel("funnel");
    return; /*
    setMessage({ type: "success", text: `View "${name.trim()}" saved with the current filters` });
  }

  */ }

  function applyAdvancedFilters(filters) {
    const normalized=normalizeFilters(filters); setAdvancedFilters(normalized);
    setBranchFilter(normalized.branchId);
    setStageFilter(normalized.stage.length===1?normalized.stage[0]:"");
    setAppliedFiltersExpanded(true);
    setFilterPanel(null);
    setMessage({ type: "success", text: "Lead filters applied" });
  }

  function clearLeadFilters() {
    setSearch("");
    setStageFilter("");
    setBranchFilter([]);
    setAdvancedFilters(emptyAdvancedFilters);
    setMessage({ type: "success", text: "Filters cleared — showing all accessible branches" });
  }

  function applyFunnel(funnel) {
    applyAdvancedFilters({ ...emptyAdvancedFilters, ...funnel.filters });
    setMessage({ type: "success", text: `View "${funnel.name}" applied` });
  }

  async function deleteFunnel(funnel) {
    if (!window.confirm(`Delete view "${funnel.name}"?`)) return;
    try {
      const result = await api(`/saved-filters/${funnel.id}`, { method: "DELETE" });
      await loadFunnels();
      setMessage({ type: "success", text: result.message });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    }
  }

  async function exportLeads() {
    const header = ["Lead ID", "Student", "Phone", "Branch", "Class", "Curriculum", "Stage", "Counsellor"];
    const rows = filtered.map(lead => [lead.leadId, lead.studentName, lead.phone, lead.branch, lead.applyingClass, lead.curriculum, lead.stage, lead.owner]);
    const csv = [header, ...rows].map(row => row.map(value => `"${String(value || "").replaceAll('"', '""')}"`).join(",")).join("\n");
    const fileName = `crm-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    link.download = fileName;
    link.click(); URL.revokeObjectURL(link.href);
    try {
      await api('/bulk-operations/data-export',{method:'POST',body:JSON.stringify({totalRecords:rows.length,fileName,leadIds:filtered.map(lead=>lead.id)})});
    } catch (error) {
      setMessage({type:'error',text:`Export downloaded, but its audit entry could not be saved: ${error.message}`});
    }
  }

  function bulkNotice(action) {
    setMessage({ type: selectedIds.length ? "success" : "error", text: selectedIds.length ? `${action} prepared for ${selectedIds.length} selected lead${selectedIds.length === 1 ? "" : "s"}` : "Select at least one lead first" });
  }

  function openLeadMessage(lead) {
    setOpenActionId(null);
    setWhatsAppRecipients([{
      leadId: lead.id,
      phoneNumber: lead.phone,
      name: lead.studentName,
      branch: lead.branch,
      className: lead.applyingClass,
      source: lead.source
    }]);
  }

  function openSelectedMessages() {
    const recipients = filtered
      .filter(lead => selectedIds.includes(lead.id))
      .map(lead => ({
        leadId: lead.id,
        phoneNumber: lead.phone,
        name: lead.studentName,
        branch: lead.branch,
        className: lead.applyingClass,
        source: lead.source
      }));
    if (!recipients.length) {
      setMessage({ type: "error", text: "Select at least one lead from the current filtered view" });
      return;
    }
    setWhatsAppRecipients(recipients);
  }

  function openFilteredMarketingCampaign() {
    if (!filtered.length) {
      setMessage({
        type: "error",
        text: "No leads match the currently applied filters",
      });
      return;
    }
    setMarketingLeadIds(filtered.map((lead) => lead.id));
  }

  function openCreate() {
    const storedUser = localStorage.getItem("crm_user");
    const currentUser = storedUser ? JSON.parse(storedUser) : null;
    const defaultAcademicYear = meta.academicYears?.[0]?.academicYear || emptyForm.academicYear;
    setForm({
      ...emptyForm,
      academicYear: defaultAcademicYear,
      branchId: meta.branches[0]?.id || "",
      stageId: meta.stages[0]?.id || "",
      substageId: meta.substages.find(item=>String(item.stageId)===String(meta.stages[0]?.id))?.id || "",
      classId: meta.classes[0]?.id || "",
      curriculumId: meta.curricula[0]?.id || "",
      admissionTypeId: meta.admissionTypes[0]?.id || "",
      ownerEmployeeId: currentUser?.employeeId || "",
    });
    setDrawer({ mode: "create", title: "Add new lead" });
    setDrawerTab("student");
  }

  async function openLead(id, mode) {
    try {
      const { data } = await api(`/leads/${id}`);
      setForm({
        ...emptyForm,
        ...data,
        branchId: data.branchId || "",
        classId: data.classId || "",
        curriculumId: data.curriculumId || "",
        stageId: data.stageId || "",
        sourceId: data.sourceId || "",
        channelId: data.channelId || "",
        campaignId: data.campaignId || "",
        admissionTypeId: data.admissionTypeId || "",
        substageId: data.substageId || "",
        ownerEmployeeId: data.ownerEmployeeId || "",
        leadScore: data.leadScore ?? 0,
        nextFollowupAt: toLocalInput(data.nextFollowupAt),
      });
      setSecondarySource({academicYear:data.academicYear||"",sourceId:"",channelId:"",campaignId:""});
      setDrawer({
        mode,
        id,
        title: mode === "view" ? data.studentName : `Edit ${data.studentName}`,
        activities: data.activities || [],
      });
      setDrawerTab("student");
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    }
  }

  async function openFollowup(lead) {
    setOpenActionId(null);
    try {
      const [{ data },options] = await Promise.all([api(`/leads/${lead.id}`),api('/leads/referral-options/all')]);
      setReferralOptions(options);
      const defaultBranchId=String(data.referredToBranchId||data.branchId||"");
      const selfOption=options.employees.find(employee=>String(employee.id)===String(options.currentEmployeeId)&&String(employee.branchId)===defaultBranchId);
      const currentOwnerOption=options.employees.find(employee=>String(employee.id)===String(data.ownerEmployeeId)&&String(employee.branchId)===defaultBranchId);
      const defaultOption=selfOption||currentOwnerOption;
      setFollowupForm({stageId:String(data.stageId||""),substageId:String(data.substageId||""),comment:"",comments:data.comments||[],nextFollowupAt:toLocalInput(data.nextFollowupAt),followupType:data.followupType||"",referralBranchId:defaultBranchId,referralEmployeeId:defaultOption?String(defaultOption.id):""});
      setFollowupModal({id:lead.id,name:lead.studentName});
    } catch (error) { setMessage({type:"error",text:error.message}); }
  }

  async function openHistory(lead){
    setOpenActionId(null);
    try{const {data}=await api(`/leads/${lead.id}`);setHistoryModal(data)}catch(error){setMessage({type:"error",text:error.message})}
  }

  async function saveFollowup(event) {
    event.preventDefault(); setSaving(true);
    try {
      const result=await api(`/leads/${followupModal.id}/followup-notes`,{method:"PUT",body:JSON.stringify({...followupForm,stageId:Number(followupForm.stageId),substageId:followupForm.substageId?Number(followupForm.substageId):null,referralBranchId:Number(followupForm.referralBranchId),referralEmployeeId:Number(followupForm.referralEmployeeId),nextFollowupAt:followupForm.nextFollowupAt?`${followupForm.nextFollowupAt}:00`:null})});
      setFollowupModal(null); setMessage({type:"success",text:result.message}); await loadLeads();
    } catch(error) { setMessage({type:"error",text:error.message}); }
    finally { setSaving(false); }
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const editing = drawer.mode === "edit";
      const result = await api(editing ? `/leads/${drawer.id}` : "/leads", {
        method: editing ? "PUT" : "POST",
        body: JSON.stringify(serialize(form)),
      });
      setDrawer(null);
      setMessage({ type: "success", text: result.message });
      await loadLeads();
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setSaving(false);
    }
  }

  async function addSecondarySource(event){
    event.preventDefault();setSaving(true);
    try{
      const result=await api(`/leads/${drawer.id}/sources`,{method:"POST",body:JSON.stringify({academicYear:form.academicYear,...secondarySource,sourceId:Number(secondarySource.sourceId),channelId:Number(secondarySource.channelId),campaignId:Number(secondarySource.campaignId)})});
      const {data}=await api(`/leads/${drawer.id}`);
      setForm(current=>({...current,sourceHistory:data.sourceHistory||[]}));
      setSecondarySource({sourceId:"",channelId:"",campaignId:""});
      setMessage({type:"success",text:result.message});await loadLeads();
    }catch(error){setMessage({type:"error",text:error.message})}finally{setSaving(false)}
  }

  async function remove(lead) {
    if (
      !window.confirm(
        `Remove ${lead.studentName} (${lead.leadId})? This can be restored from the database.`,
      )
    )
      return;
    try {
      const result = await api(`/leads/${lead.id}`, { method: "DELETE" });
      setMessage({ type: "success", text: result.message });
      await loadLeads();
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    }
  }

  async function openRefer(lead) {
    setOpenActionId(null);
    try {
      const options = await api('/leads/referral-options/all');
      setReferralOptions(options);
      setReferLead(lead);
      const currentReferralBranch = lead.referredToBranchId || "";
      setReferBranchId(String(currentReferralBranch));
      const currentlyTagged = options.employees.some(employee=>String(employee.id)===String(lead.ownerEmployeeId)&&String(employee.branchId)===String(currentReferralBranch));
      setReferEmployeeId(currentlyTagged ? String(lead.ownerEmployeeId) : "");
    } catch (error) {
      setMessage({type:'error',text:error.message});
    }
  }

  function openStageChange(lead) {
    setOpenActionId(null);
    setStageChangeTarget(lead);
  }

  function openBulkStageChange() {
    if (!selectedIds.length) return setMessage({type:"error",text:"Select at least one lead first"});
    setShowStageChangeConfirm(true);
  }

  async function openBulkRefer() {
    const selectedVisibleIds=selectedIds.filter(id=>filtered.some(lead=>lead.id===id));
    if (!selectedVisibleIds.length) return setMessage({type:"error",text:"Select at least one lead to refer"});
    try {
      const options=await api('/leads/referral-options/all');
      setReferralOptions(options);
      const selfOption=options.employees.find(employee=>String(employee.id)===String(options.currentEmployeeId)&&String(employee.branchId)===String(options.currentBranchId))||options.employees.find(employee=>String(employee.id)===String(options.currentEmployeeId));
      setReferLead({
        bulk:true,
        ids:selectedVisibleIds,
        studentName:`${selectedVisibleIds.length} selected lead${selectedVisibleIds.length===1?"":"s"}`,
        leadId:selectedVisibleIds.length===filtered.length?"All leads in current filtered view":"Selected leads",
        branch:"",
      });
      setReferBranchId(selfOption?String(selfOption.branchId):"");
      setReferEmployeeId(selfOption?String(selfOption.id):"");
    } catch(error) { setMessage({type:"error",text:error.message}); }
  }

  async function submitReferral(event) {
    event.preventDefault();
    if (!referLead || !referEmployeeId) return;
    setSaving(true);
    try {
      const result = referLead.bulk
        ? await api('/leads/actions/bulk-refer',{method:"PUT",body:JSON.stringify({leadIds:referLead.ids,branchId:Number(referBranchId),employeeId:Number(referEmployeeId)})})
        : await api(`/leads/${referLead.id}/refer`, { method: "PUT", body: JSON.stringify({ branchId: Number(referBranchId), employeeId: Number(referEmployeeId) }) });
      setMessage({ type: "success", text: result.message });
      setReferLead(null);
      setReferBranchId("");
      setReferEmployeeId("");
      await loadLeads();
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setSaving(false);
    }
  }

  if (marketingLeadIds) {
    return (
      <MarketingCampaignBuilder
        meta={meta}
        leadIds={marketingLeadIds}
        onClose={() => setMarketingLeadIds(null)}
        onCreated={(text) => {
          setMarketingLeadIds(null);
          setMessage({ type: "success", text });
        }}
      />
    );
  }

  return (
    <main className={`page leads-page ${hasAppliedFilters ? (appliedFiltersExpanded ? "applied-filters-open" : "applied-filters-collapsed") : ""}`}>
      <section className="lead-command-center">
        <div className="funnel-callout">
          <FunnelStrip funnels={funnels} onApply={applyFunnel} onDelete={deleteFunnel} onCreate={createFunnel} onAddLead={openCreate} onSearch={(query) => setSearch(query)} onMessages={() => navigate("/whatsapp-inbox")} unreadCount={whatsAppConversations.reduce((sum,item)=>sum+Number(item.unread_count||0),0)}/>
        </div>
        <div className="stage-tabs" role="tablist">
          <button className={`stage-tab ${!stageFilter ? "active" : ""}`} onClick={() => setStageFilter("")}><span className="stage-name">All</span> <span className="stage-count">{leadsMatchingActiveFilters.length}</span></button>
          {meta.stages.map(stage => <button key={stage.id} className={`stage-tab ${stageFilter === stage.displayName ? "active" : ""}`} onClick={() => setStageFilter(stage.displayName)}><span className="stage-name">{stage.displayName}</span> <span className="stage-count">{filteredStageCounts[stage.displayName] || 0}</span></button>)}
          <button className={`stage-tab ${stageFilter === "Re-enquired" ? "active" : ""}`} onClick={() => setStageFilter("Re-enquired")}><span className="stage-name">Re-enquired</span> <span className="stage-count">{filteredStageCounts["Re-enquired"] || 0}</span></button>
        </div>
        <div className="lead-control-row">
          <div className="inline-lead-filter"><span>Branch</span><MultiSearchSelect label="Branch" value={branchFilter} onChange={setBranchFilter} options={[{value:"",label:"All branches"},...meta.branches.map(branch=>({value:String(branch.id),label:branch.name}))]}/></div>
          <div className="inline-lead-filter"><span>Touch status</span><MultiSearchSelect label="Touch status" value={advancedFilters.touchStatus} onChange={value=>setAdvancedFilters(current=>({...current,touchStatus:value}))} options={[{value:"",label:"Any touch status"},{value:"touched",label:"Is touched"},{value:"untouched",label:"Untouched"}]}/></div>
          <div className="inline-lead-filter"><span>Sub-stage</span><MultiSearchSelect label="Sub-stage" value={advancedFilters.substageId} onChange={value=>setAdvancedFilters(current=>({...current,substageId:value}))} options={[{value:"",label:"All sub-stages"},...meta.substages.filter(item=>!stageFilter||String(item.stageId)===String(meta.stages.find(stage=>stage.displayName===stageFilter)?.id)).map(item=>({value:String(item.id),label:item.displayName}))]}/></div>
          <div className="inline-lead-filter"><span>Source</span><MultiSearchSelect label="Source" value={advancedFilters.sourceId} onChange={value=>setAdvancedFilters(current=>({...current,sourceId:value}))} options={[{value:"",label:"All sources"},...meta.sources.map(item=>({value:String(item.id),label:item.displayName}))]}/></div>
          <FollowupDateFilter from={advancedFilters.followupFrom} to={advancedFilters.followupTo} dueCount={followupsTillToday} dateType={followupDateType} onDateTypeChange={setFollowupDateType} onChange={(followupFrom,followupTo)=>setAdvancedFilters(current=>({...current,followupFrom,followupTo}))}/>
          <div className="lead-actions-wrap"><div className={`lead-quick-actions ${quickActionsExpanded?"expanded":"collapsed"}`}>
            {quickActionsExpanded&&<>
            <BulkUploadButton/>
            <button title={`Change stage for ${selectedIds.length || "selected"} leads`} aria-label={`Change stage for selected leads`} onClick={openBulkStageChange} disabled={!selectedIds.length}><GitBranch/></button>
            <button title={`Refer ${selectedIds.length || "selected"} leads`} aria-label="Refer selected leads" onClick={openBulkRefer} disabled={!selectedIds.length}><UserRoundPlus/></button>
            <button title={`Add marketing campaign for ${filtered.length} filtered leads`} onClick={openFilteredMarketingCampaign} disabled={!filtered.length}><Megaphone/></button>
            <button title={`Send WhatsApp to ${selectedIds.length || "selected"} leads in this view`} onClick={openSelectedMessages} disabled={!selectedIds.length}><MessageCircle/></button>
            <button title="Export visible leads" onClick={exportLeads}><Download/></button>
            </>}
            <button className="quick-actions-toggle" title={quickActionsExpanded?"Collapse lead actions":"Expand lead actions"} aria-label={quickActionsExpanded?"Collapse lead actions":"Expand lead actions"} onClick={toggleQuickActions}>{quickActionsExpanded?<PanelRightClose/>:<PanelRightOpen/>}</button>
            <button title="Clear filters" aria-label="Clear filters" onClick={clearLeadFilters}><RefreshCw/></button>
            <button title="Open filters" onClick={() => setFilterPanel("filter")}><Filter/></button>
          </div></div>
        </div>
      </section>
      <Toast message={message} onClose={() => setMessage(null)} />
      <article className="panel leads-panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th><input type="checkbox" aria-label="Select all visible leads" checked={filtered.length > 0 && filtered.every(lead => selectedIds.includes(lead.id))} onChange={event => setSelectedIds(event.target.checked ? filtered.map(lead => lead.id) : [])}/></th>
                <th>Student</th>
                <th>Class</th>
                <th>Source</th>
                <th>Stage</th>
                <th>Owner</th>
                <th>Next follow-up</th>
                <th>Recent modified</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginatedLeads.map((lead) => (
                <tr key={lead.id}>
                  <td><input type="checkbox" aria-label={`Select ${lead.studentName}`} checked={selectedIds.includes(lead.id)} onChange={event => setSelectedIds(current => event.target.checked ? [...new Set([...current, lead.id])] : current.filter(id => id !== lead.id))}/></td>
                  <td>
                    <div className="student">
                      <button type="button" className="avatar muted lead-view-avatar" title={`View ${lead.studentName}`} aria-label={`View ${lead.studentName}`} onClick={()=>openLead(lead.id,"view")}>
                        {lead.studentName
                          .split(" ")
                          .map((name) => name[0])
                          .slice(0, 2)
                          .join("")}
                      </button>
                      <span>
                        <span className="lead-name-line">
                          <strong className="lead-view-name">{lead.studentName}</strong>
                          {lead.touchStatus !== "unassigned" && (
                            <em className={`lead-touch-badge ${lead.touchStatus}`}>
                              {lead.touchStatus === "touched" ? "Touched" : "Untouched"}
                            </em>
                          )}
                        </span>
                        <small>{lead.phone}</small>
                      </span>
                    </div>
                  </td>
                  <td><div className="lead-academic"><strong>{[lead.curriculum,lead.applyingClass].filter(Boolean).join(" - ") || "—"}</strong><small>{lead.branch || "—"}</small></div></td>
                  <td>{lead.source || "—"}</td>
                  <td>
                    <span
                      className={`stage ${String(lead.stage).toLowerCase().replaceAll(" ", "-")}`}
                    >
                      {lead.stage}
                    </span>
                  </td>
                  <td>{lead.owner}</td>
                  <td>
                    {lead.nextFollowup
                      ? new Date(lead.nextFollowup).toLocaleString("en-IN", {
                          timeZone: "Asia/Kolkata",
                          dateStyle: "medium",
                          timeStyle: "short",
                        })
                      : "Not scheduled"}
                  </td>
                  <td>{lead.recentModified ? new Date(lead.recentModified).toLocaleString("en-IN", {timeZone:"Asia/Kolkata",dateStyle:"medium",timeStyle:"short"}) : "—"}</td>
                  <td>
                    <div className="row-action-group">
                    <button className={`row-followup-trigger ${whatsAppConversations.some(item=>cleanPhone(item.mobile)===cleanPhone(lead.phone)&&Number(item.unread_count)>0)?"has-unread":""}`} title="Send WhatsApp message" aria-label={`Send WhatsApp message to ${lead.studentName}`} onClick={()=>openLeadMessage(lead)}><MessageCircle size={17}/>{(()=>{const count=whatsAppConversations.filter(item=>cleanPhone(item.mobile)===cleanPhone(lead.phone)).reduce((sum,item)=>sum+Number(item.unread_count||0),0);return count>0?<span className="lead-message-unread">{count>99?"99+":count}</span>:null})()}</button>
                    <button className="row-followup-trigger remarks-count-trigger" title={`${Number(lead.remarksCount||0)} remarks · Lead history`} aria-label={`${Number(lead.remarksCount||0)} remarks for ${lead.studentName}. Open lead history`} onClick={()=>openHistory(lead)}><History size={17}/><span className="remarks-count-badge">{Number(lead.remarksCount||0)>99?"99+":Number(lead.remarksCount||0)}</span></button>
                    <button className="row-followup-trigger" title="Follow-up and notes" aria-label={`Follow-up and notes for ${lead.studentName}`} onClick={()=>openFollowup(lead)}><NotebookPen size={17}/></button>
                    <div className="row-more-actions">
                      <button data-lead-action-trigger className="row-more-trigger" title="More actions" aria-label={`More actions for ${lead.studentName}`} aria-expanded={openActionId?.id===lead.id} onClick={(event)=>{const rect=event.currentTarget.getBoundingClientRect();const menuHeight=151;const openAbove=rect.bottom+menuHeight+8>window.innerHeight;setOpenActionId(current=>current?.id===lead.id?null:{id:lead.id,top:openAbove?Math.max(8,rect.top-menuHeight-5):rect.bottom+5,left:Math.min(window.innerWidth-153,Math.max(8,rect.right-145))})}}><MoreVertical size={17}/></button>
                      {openActionId?.id===lead.id&&createPortal(<div data-lead-action-menu className="row-more-menu" style={{top:openActionId.top,left:openActionId.left}}>
                        <button onClick={()=>{setOpenActionId(null);openLead(lead.id,"edit")}}><Pencil size={15}/> Edit</button>
                        <button onClick={()=>{setOpenActionId(null);openStageChange(lead)}}><GitBranch size={15}/> Change Stage</button>
                        <button onClick={()=>{setOpenActionId(null);openRefer(lead)}}><UserRoundPlus size={15}/> Refer</button>
                        <button className="danger" onClick={()=>{setOpenActionId(null);remove(lead)}}><Trash2 size={15}/> Remove</button>
                      </div>,document.body)}
                    </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading && (
            <div className="loading">
              <span />
              <p>Loading leads…</p>
            </div>
          )}
          {!loading && !filtered.length && (
            <div className="empty">
              <Search />
              <strong>No leads found</strong>
              <span>Add the first enquiry or adjust the filters.</span>
            </div>
          )}
        </div>
        {!loading && filtered.length > 0 && (
          <div className="pagination-controls">
            <div className="page-size-selector">
              <label>Records per page:</label>
              <select value={pageSize} onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}>
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
            </div>
            <div className="pagination-info">
              Showing {startIndex + 1} to {endIndex} of {totalRecords} records
            </div>
            <div className="pagination-buttons">
              <button
                className="pagination-btn"
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
                title="First page"
              >
                &lsaquo;&lsaquo;
              </button>
              <button
                className="pagination-btn"
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                title="Previous page"
              >
                <ChevronLeft size={16} />
              </button>
              <div className="page-indicator">
                Page {currentPage} of {totalPages || 1}
              </div>
              <button
                className="pagination-btn"
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages || totalPages === 0}
                title="Next page"
              >
                <ChevronRight size={16} />
              </button>
              <button
                className="pagination-btn"
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages || totalPages === 0}
                title="Last page"
              >
                &rsaquo;&rsaquo;
              </button>
            </div>
          </div>
        )}
      </article>
      {hasAppliedFilters && (
        <aside className={`applied-filters-panel ${appliedFiltersExpanded ? "expanded" : "collapsed"}`} aria-label="Applied lead filters">
          <button
            className="applied-filter-toggle"
            title={appliedFiltersExpanded ? "Collapse applied filters" : "Expand applied filters"}
            aria-label={appliedFiltersExpanded ? "Collapse applied filters" : "Expand applied filters"}
            onClick={() => setAppliedFiltersExpanded(current => !current)}
          >
            {appliedFiltersExpanded ? <PanelRightClose size={17}/> : <PanelRightOpen size={17}/>}
          </button>
          {appliedFiltersExpanded && <>
            <header>
              <div><Filter size={17}/><span><strong>Applied filters</strong><small>{appliedFilterGroups.reduce((sum,[,items]) => sum + items.length, 0)} active</small></span></div>
            </header>
            <div className="applied-filter-sections">
              {appliedFilterGroups.map(([group,items]) => (
                <section key={group}>
                  <h3>{group}<b>{items.length}</b></h3>
                  <div>
                    {items.map(item => <article key={item.label}><span>{item.label}</span><p>{item.values.map(value => <em key={`${item.label}-${value}`}>{value}</em>)}</p></article>)}
                  </div>
                </section>
              ))}
            </div>
            <footer>
              <button className="secondary" onClick={clearLeadFilters}><RefreshCw size={15}/>Reset</button>
              <button className="primary" onClick={() => setFilterPanel("filter")}><Pencil size={15}/>Edit filters</button>
            </footer>
          </>}
        </aside>
      )}
      {filterPanel && (
        <FilterWorkspace
          mode={filterPanel}
          meta={meta}
          initialFilters={{ ...advancedFilters, branchId: branchFilter, stage: stageFilter }}
          onApply={applyAdvancedFilters}
          onClose={() => setFilterPanel(null)}
          onSaved={({ name, type }) => {
            if (type === "funnel") {
              localStorage.setItem("crm_saved_funnel", name);
              setSavedFunnel(name);
              loadFunnels();
            }
            setMessage({ type: "success", text: `${type === "funnel" ? "View" : "Filter"} saved` });
          }}
        />
      )}
      {referLead&&<><div className="drawer-backdrop" onClick={()=>setReferLead(null)}/><section className="refer-dialog" role="dialog" aria-modal="true" aria-labelledby="refer-title">
        <div className="refer-dialog-head"><div><span className="eyebrow">{referLead.bulk?"Bulk lead referral":"Lead referral"}</span><h2 id="refer-title">Refer {referLead.studentName}</h2><p>{referLead.bulk?`${referLead.leadId} will be reassigned.`:`${referLead.leadId} · ${referLead.branch}`}</p></div><button className="icon-btn" onClick={()=>setReferLead(null)}><X/></button></div>
        <form onSubmit={submitReferral}>
          <SearchSuggestion label="Referral branch" required options={referralOptions.branches.map(branch=>({id:branch.id,label:branch.name}))} value={referBranchId} onChange={(branchId)=>{setReferBranchId(String(branchId||""));setReferEmployeeId("")}} placeholder="Search and select branch…"/>
          <SearchSuggestion label="Counsellor" required options={referralOptions.employees.filter(employee=>String(employee.branchId)===String(referBranchId)).map(employee=>({id:employee.id,label:`${employee.name} · ${employee.branchName}`}))} value={referEmployeeId} onChange={setReferEmployeeId} placeholder={referBranchId?"Search counsellor…":"Select a branch first"}/>
          <small>Only counsellors with active CRM access to the selected branch are shown. Referring transfers the lead to that branch.</small>
          <div className="refer-dialog-actions"><button type="button" className="secondary" onClick={()=>setReferLead(null)}>Cancel</button><button className="primary" disabled={saving||!referBranchId||!referEmployeeId}>{saving?"Referring…":referLead.bulk?`Refer ${referLead.ids.length} leads`:"Refer lead"}</button></div>
        </form>
      </section></>}
      {followupModal&&<><div className="drawer-backdrop" onClick={()=>setFollowupModal(null)}/><section className="followup-notes-dialog" role="dialog" aria-modal="true" aria-labelledby="followup-notes-title">
        <header><div><span className="eyebrow">Lead activity</span><h2 id="followup-notes-title">Follow-up and notes</h2><p>{followupModal.name}</p></div><button type="button" className="icon-btn" onClick={()=>setFollowupModal(null)}><X/></button></header>
        <form onSubmit={saveFollowup}><div className="form-grid">
          <label>Stage *<select required value={followupForm.stageId} onChange={e=>setFollowupForm({...followupForm,stageId:e.target.value,substageId:"",nextFollowupAt:"",followupType:""})}><option value="">Select stage</option>{meta.stages.map(stage=><option key={stage.id} value={stage.id}>{stage.displayName}</option>)}</select></label>
          <label>Sub-stage *<select required value={followupForm.substageId} onChange={e=>setFollowupForm({...followupForm,substageId:e.target.value})}><option value="">Select sub-stage</option>{meta.substages.filter(item=>!followupForm.stageId||String(item.stageId)===String(followupForm.stageId)).map(item=><option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
          {modalFollowupRequired&&<label>Next follow-up *<input required type="datetime-local" min={minimumFollowupTime} value={followupForm.nextFollowupAt} onChange={e=>setFollowupForm({...followupForm,nextFollowupAt:e.target.value})}/></label>}
          {modalFollowupRequired&&<label>Follow-up type *<select required value={followupForm.followupType} onChange={e=>setFollowupForm({...followupForm,followupType:e.target.value})}><option value="">Select follow-up type</option><option>Call</option><option>WhatsApp</option><option>Email</option><option>Campus Visit</option></select></label>}
          <SearchSuggestion label="Referral branch" required options={referralOptions.branches.map(branch=>({id:branch.id,label:branch.name}))} value={followupForm.referralBranchId} onChange={(branchId)=>setFollowupForm({...followupForm,referralBranchId:String(branchId||""),referralEmployeeId:""})} placeholder="Search and select branch…"/>
          <SearchSuggestion label="Counsellor" required options={referralOptions.employees.filter(employee=>String(employee.branchId)===String(followupForm.referralBranchId)).map(employee=>({id:employee.id,label:employee.name}))} value={followupForm.referralEmployeeId} onChange={(employeeId)=>setFollowupForm({...followupForm,referralEmployeeId:String(employeeId||"")})} placeholder={followupForm.referralBranchId?"Search counsellor…":"Select a branch first"}/>
          <div className="wide previous-comments"><span>Previous comments</span><div className="comment-history">{followupForm.comments.length?followupForm.comments.map(item=><article key={item.id}><strong>{item.counsellorName}</strong><i>—</i><time>{item.createdAt?new Date(item.createdAt).toLocaleString("en-IN",{timeZone:"Asia/Kolkata",dateStyle:"medium",timeStyle:"short"}):"Earlier comment"}</time><i>—</i><p>{item.commentText}</p></article>):<p className="no-comments">No previous comments</p>}</div></div>
          <label className="wide">New comment *<textarea required rows="4" placeholder="Write a new comment…" value={followupForm.comment} onChange={e=>setFollowupForm({...followupForm,comment:e.target.value})}/></label>
        </div><footer><button type="button" className="secondary" onClick={()=>setFollowupModal(null)}>Cancel</button><button className="primary" disabled={saving}>{saving?"Saving…":"Save follow-up"}</button></footer></form>
      </section></>}
      {historyModal&&<><div className="drawer-backdrop" onClick={()=>setHistoryModal(null)}/><section className="lead-history-dialog" role="dialog" aria-modal="true" aria-labelledby="lead-history-title">
        <header><div><span className="eyebrow">Lead history</span><h2 id="lead-history-title">{historyModal.studentName}</h2><p>{historyModal.leadId}</p></div><button type="button" className="icon-btn" onClick={()=>setHistoryModal(null)}><X/></button></header>
        <div className="history-current-grid">
          <div><span>Current stage</span><strong>{historyModal.stage||"—"}</strong></div>
          <div><span>Current sub-stage</span><strong>{meta.substages.find(item=>String(item.id)===String(historyModal.substageId))?.displayName||"Not specified"}</strong></div>
          <div><span>Next follow-up</span><strong>{historyModal.nextFollowupAt?new Date(historyModal.nextFollowupAt).toLocaleString("en-IN",{timeZone:"Asia/Kolkata",dateStyle:"medium",timeStyle:"short"}):"Not scheduled"}</strong></div>
          <div><span>Lead owner</span><strong>{historyModal.owner||"Unassigned"}</strong></div>
        </div>
        <section className="history-comments"><h3>Previous comments</h3><div className="comment-history">{historyModal.comments?.length?historyModal.comments.map(item=><article key={item.id}><strong>{item.counsellorName}</strong><i>—</i><time>{item.createdAt?new Date(item.createdAt).toLocaleString("en-IN",{timeZone:"Asia/Kolkata",dateStyle:"medium",timeStyle:"short"}):"Earlier comment"}</time><i>—</i><p>{item.commentText}</p></article>):<p className="no-comments">No previous comments</p>}</div></section>
        <footer><button type="button" className="primary" onClick={()=>setHistoryModal(null)}>Close</button></footer>
      </section></>}
      {drawer && (
        <>
          <div className="drawer-backdrop" onClick={() => setDrawer(null)} />
          <aside className={`lead-drawer ${drawer.mode !== "create" ? "lead-modal" : ""}`} role={drawer.mode !== "create" ? "dialog" : undefined} aria-modal={drawer.mode !== "create" ? "true" : undefined}>
            <div className="drawer-head">
              <div>
                <span className="eyebrow">
                  {drawer.mode === "create" ? "New enquiry" : form.leadId}
                </span>
                <h2>{drawer.title}</h2>
              </div>
              <button className="icon-btn" onClick={() => setDrawer(null)}>
                <X />
              </button>
            </div>
            {drawer.mode !== "create"&&<nav className="lead-detail-tabs" aria-label="Lead detail categories">
              <button type="button" className={drawerTab==="student"?"active":""} onClick={()=>setDrawerTab("student")}>Student &amp; contact</button>
              <button type="button" className={drawerTab==="source"?"active":""} onClick={()=>setDrawerTab("source")}>Source details</button>
              {drawer.mode==="view"&&<button type="button" className={drawerTab==="activity"?"active":""} onClick={()=>setDrawerTab("activity")}>Activity</button>}
            </nav>}
            <form onSubmit={save}>
              <fieldset disabled={drawer.mode === "view"}>
                {drawer.mode==="create"&&<div className="form-section">
                  <h3>Lead details</h3>
                  <ConfiguredLeadFields fields={meta.leadFields||[]} form={form} setForm={setForm} meta={meta} availableAdmissionTypes={availableAdmissionTypes} availableCurricula={availableCurricula} availableClasses={availableClasses} inputRef={studentNameInputRef}/>
                </div>}
                {drawer.mode!=="create"&&<>
                <div className={`form-section ${drawerTab!=="student"?"tab-hidden":""}`}>
                  <h3>Student and contact</h3>
                  <div className="form-grid">
                    <label>
                      Student name *
                      <input
                        ref={studentNameInputRef}
                        required
                        value={form.studentName}
                        onChange={(e) =>
                          setForm({ ...form, studentName: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Phone *
                      <input
                        required
                        type="tel"
                        maxLength="10"
                        pattern="[6-9][0-9]{9}"
                        disabled={drawer.mode === "edit"}
                        title={drawer.mode === "edit" ? "Contact information cannot be edited" : "Enter a valid 10-digit Indian mobile number starting with 6-9"}
                        placeholder="10-digit mobile number"
                        value={form.phone}
                        onChange={(e) => {
                          const value = e.target.value.replace(/\D/g, '').slice(0, 10);
                          setForm({ ...form, phone: value });
                        }}
                      />
                    </label>
                    <label>
                      Alternate phone
                      <input
                        type="tel"
                        maxLength="10"
                        pattern="[6-9][0-9]{9}"
                        disabled={drawer.mode === "edit"}
                        title={drawer.mode === "edit" ? "Contact information cannot be edited" : "Enter a valid 10-digit Indian mobile number starting with 6-9"}
                        placeholder="10-digit mobile number"
                        value={form.alternatePhone || ""}
                        onChange={(e) => {
                          const value = e.target.value.replace(/\D/g, '').slice(0, 10);
                          setForm({ ...form, alternatePhone: value });
                        }}
                      />
                    </label>
                    <label>
                      Email
                      <input
                        type="email"
                        disabled={drawer.mode === "edit"}
                        title={drawer.mode === "edit" ? "Contact information cannot be edited" : undefined}
                        value={form.email || ""}
                        onChange={(e) =>
                          setForm({ ...form, email: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Parent name
                      <input
                        value={form.parentName || ""}
                        onChange={(e) =>
                          setForm({ ...form, parentName: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      City
                      <input
                        value={form.city || ""}
                        onChange={(e) =>
                          setForm({ ...form, city: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Academic year *
                      <select required disabled={drawer.mode === "edit"} title={drawer.mode === "edit" ? "Primary source details cannot be edited" : undefined} value={form.academicYear} onChange={(e) => setForm({...form,academicYear:e.target.value})}>
                        <option value="">Select academic year</option>
                        {meta.academicYears.map((year) => <option key={year.id} value={year.academicYear}>{year.academicYear}</option>)}
                      </select>
                    </label>
                    <label>
                      Branch *
                      <select required disabled={drawer.mode==="edit"} title={drawer.mode==="edit"?"The branch selected when the lead was created cannot be changed":undefined} value={form.branchId} onChange={(e) => setForm({...form,branchId:e.target.value,ownerEmployeeId:""})}>
                        <option value="">Select branch</option>
                        {meta.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                      </select>
                    </label>
                    <label>
                      Admission type
                      <select value={form.admissionTypeId || ""} onChange={(e) => setForm({...form,admissionTypeId:e.target.value,curriculumId:"",classId:""})}>
                        <option value="">Not specified</option>
                        {(availableAdmissionTypes.length > 0 ? availableAdmissionTypes : meta.admissionTypes).map(item => <option key={item.id} value={item.id}>{item.displayName}</option>)}
                      </select>
                    </label>
                    <label>
                      Curriculum *
                      <select required value={form.curriculumId} onChange={(e) => setForm({...form,curriculumId:e.target.value,classId:""})}>
                        <option value="">Select curriculum</option>
                        {availableCurricula.map(item => <option key={item.id} value={item.id}>{item.displayName}</option>)}
                      </select>
                    </label>
                    <SearchSuggestion
                      label="Class"
                      required
                      options={availableClasses.map(item=>({id:item.id,label:item.displayName}))}
                      value={form.classId}
                      onChange={(classId)=>setForm({...form,classId})}
                      placeholder={form.academicYear && form.branchId && form.admissionTypeId && form.curriculumId ? (availableClasses.length > 0 ? "Search class…" : "No classes available for this combination") : "Select all fields above first"}
                    />
                  </div>
                </div>
                <div className={`form-section ${drawerTab!=="source"?"tab-hidden":""}`}>
                  <h3>Source details</h3>
                  <div className="form-grid source-layout">
                    <section className="source-primary"><div className="source-primary-grid">
                    <label>Channel {drawer.mode==="edit"?"*":""}<select required={drawer.mode==="edit"} disabled={drawer.mode==="edit"} title={drawer.mode==="edit"?"Primary source details cannot be edited":undefined} value={form.channelId || ""} onChange={(e) => setForm({...form,channelId:e.target.value,sourceId:"",campaignId:""})}><option value="">Select channel</option>{meta.channels.map(item => <option key={item.id} value={item.id}>{item.displayName} · {item.category}</option>)}</select></label>
                    <label>
                      Source {drawer.mode==="edit"?"*":""}
                      <select required={drawer.mode==="edit"} disabled={drawer.mode === "edit"} title={drawer.mode === "edit" ? "Primary source details cannot be edited" : undefined}
                        value={form.sourceId || ""}
                        onChange={(e) =>
                          setForm({ ...form, sourceId: e.target.value, campaignId:"" })
                        }
                      >
                        <option value="">Select source</option>
                        {meta.sources.filter(source=>!form.channelId||!meta.sourceLinks.some(link=>String(link.channelId)===String(form.channelId))||meta.sourceLinks.some(link=>String(link.channelId)===String(form.channelId)&&String(link.sourceId)===String(source.id))).map((source) => (
                          <option key={source.id} value={source.id}>
                            {source.displayName}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>Campaign {drawer.mode==="edit"?"*":""}<select required={drawer.mode==="edit"} disabled={drawer.mode==="edit"} title={drawer.mode==="edit"?"Primary source details cannot be edited":undefined} value={form.campaignId || ""} onChange={(e) => setForm({...form,campaignId:e.target.value})}><option value="">Select campaign</option>{meta.campaigns.filter(campaign=>!form.sourceId||!meta.campaignLinks.some(link=>String(link.sourceId)===String(form.sourceId))||meta.campaignLinks.some(link=>String(link.sourceId)===String(form.sourceId)&&String(link.campaignId)===String(campaign.id))).map(item => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
                    </div></section>
                    {drawer.mode==="edit"&&<section className="wide secondary-source-entry"><header><strong>Add secondary source</strong><small>The primary source above remains unchanged.</small></header><div className="secondary-source-grid">
                      <label>Channel *<select value={secondarySource.channelId} onChange={e=>setSecondarySource({...secondarySource,channelId:e.target.value,sourceId:"",campaignId:""})}><option value="">Select channel</option>{meta.channels.map(item=><option key={item.id} value={item.id}>{item.displayName} · {item.category}</option>)}</select></label>
                      <label>Source *<select value={secondarySource.sourceId} onChange={e=>setSecondarySource({...secondarySource,sourceId:e.target.value,campaignId:""})}><option value="">Select source</option>{meta.sources.filter(source=>!secondarySource.channelId||!meta.sourceLinks.some(link=>String(link.channelId)===String(secondarySource.channelId))||meta.sourceLinks.some(link=>String(link.channelId)===String(secondarySource.channelId)&&String(link.sourceId)===String(source.id))).map(item=><option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
                      <label>Campaign *<select value={secondarySource.campaignId} onChange={e=>setSecondarySource({...secondarySource,campaignId:e.target.value})}><option value="">Select campaign</option>{meta.campaigns.filter(campaign=>!secondarySource.sourceId||!meta.campaignLinks.some(link=>String(link.sourceId)===String(secondarySource.sourceId))||meta.campaignLinks.some(link=>String(link.sourceId)===String(secondarySource.sourceId)&&String(link.campaignId)===String(campaign.id))).map(item=><option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
                    </div><button type="button" className="primary add-secondary-source" disabled={saving||!secondarySource.sourceId||!secondarySource.channelId||!secondarySource.campaignId} onClick={addSecondarySource}><Plus size={15}/> Add source</button></section>}
                    {drawer.mode!=="create"&&<div className="wide source-history"><strong>Source history</strong>{form.sourceHistory?.length?form.sourceHistory.map(item=><article key={item.id}><b>{item.isPrimary?"Primary":"Secondary"}</b><span>{item.academicYear} · {item.channel} · {item.source} · {item.campaign}</span><small>{item.addedBy} · {new Date(item.createdAt).toLocaleString("en-IN",{timeZone:"Asia/Kolkata",dateStyle:"medium",timeStyle:"short"})}</small></article>):<p>No source history available</p>}</div>}
                  </div>
                </div>
                </>}
                {false && drawer.mode === "create" && <div className="form-section">
                  <h3>Follow-up and notes</h3>
                  <div className="form-grid">
                    <label>
                      Stage *
                      <select required value={form.stageId} onChange={(e) => setForm({...form,stageId:e.target.value,substageId:"",nextFollowupAt:"",followupType:""})}>
                        <option value="">Select stage</option>
                        {meta.stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.displayName}</option>)}
                      </select>
                    </label>
                    <label>
                      Sub-stage *
                      <select required value={form.substageId || ""} onChange={(e) => setForm({...form,substageId:e.target.value})}>
                        <option value="">Select sub-stage</option>
                        {meta.substages.filter(item => !form.stageId || String(item.stageId) === String(form.stageId)).map(item => <option key={item.id} value={item.id}>{item.displayName}</option>)}
                      </select>
                    </label>
                    {followupRequired&&<label>
                      Next follow-up
                      <input
                        required
                        type="datetime-local"
                        min={minimumFollowupTime}
                        value={form.nextFollowupAt || ""}
                        onChange={(e) =>
                          setForm({ ...form, nextFollowupAt: e.target.value })
                        }
                      />
                    </label>}
                    {followupRequired&&<label>
                      Follow-up type
                      <select
                        required
                        value={form.followupType}
                        onChange={(e) =>
                          setForm({ ...form, followupType: e.target.value })
                        }
                      >
                        <option value="">Select follow-up type</option>
                        <option>Call</option>
                        <option>WhatsApp</option>
                        <option>Email</option>
                        <option>Campus Visit</option>
                      </select>
                    </label>}
                    <label>
                      Remarks
                      <textarea
                        rows="4"
                        value={form.remarks || ""}
                        onChange={(e) =>
                          setForm({ ...form, remarks: e.target.value })
                        }
                      />
                    </label>
                  </div>
                </div>}
              </fieldset>
              {drawer.mode === "view" && (
                <div className="form-section lead-dates-section">
                  <h3>Lead timeline</h3>
                  <div className="dates-grid">
                    <div className="date-item">
                      <span className="date-label">Added</span>
                      <strong>{form.addedAt ? new Date(form.addedAt).toLocaleString("en-IN", {timeZone:"Asia/Kolkata",dateStyle:"medium",timeStyle:"short"}) : "—"}</strong>
                    </div>
                    <div className="date-item">
                      <span className="date-label">Updated</span>
                      <strong>{form.updatedAt ? new Date(form.updatedAt).toLocaleString("en-IN", {timeZone:"Asia/Kolkata",dateStyle:"medium",timeStyle:"short"}) : "—"}</strong>
                    </div>
                    <div className="date-item">
                      <span className="date-label">Referred</span>
                      <strong>{form.referredAt ? new Date(form.referredAt).toLocaleString("en-IN", {timeZone:"Asia/Kolkata",dateStyle:"medium",timeStyle:"short"}) : "—"}</strong>
                    </div>
                    <div className="date-item">
                      <span className="date-label">Next Follow-up</span>
                      <strong>{form.nextFollowup ? new Date(form.nextFollowup).toLocaleString("en-IN", {timeZone:"Asia/Kolkata",dateStyle:"medium",timeStyle:"short"}) : "Not scheduled"}</strong>
                    </div>
                    <div className="date-item">
                      <span className="date-label">Re-enquired</span>
                      <strong>{form.reEnquiredAt ? new Date(form.reEnquiredAt).toLocaleString("en-IN", {timeZone:"Asia/Kolkata",dateStyle:"medium",timeStyle:"short"}) : "—"}</strong>
                    </div>
                  </div>
                </div>
              )}
              {drawer.mode === "view" && drawerTab === "activity" && (
                <div className="activity-section modal-activity">
                  <h3>Activity</h3>
                  {drawer.activities?.length ? (
                    drawer.activities.map((item) => (
                      <div className="activity" key={item.id}>
                        <i />
                        <div>
                          <strong>{item.summary}</strong>
                          <span>{item.actorName} · {new Date(item.occurredAt).toLocaleString("en-IN", {timeZone:"Asia/Kolkata",dateStyle:"medium",timeStyle:"short"})}</span>
                          {item.commentText&&<p className="activity-comment">{item.commentText}</p>}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p>No activity recorded.</p>
                  )}
                </div>
              )}
              <div className="drawer-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setDrawer(null)}
                >
                  Close
                </button>
                {drawer.mode === "view" && (
                  <>
                    <button
                      type="button"
                      className="secondary"
                      title="Mark this lead as a re-enquiry"
                      disabled={saving}
                      onClick={async () => {
                        try {
                          setMessage(null);
                          await api(`/leads/${drawer.id}/mark-re-enquired`, {method:"PUT",body:JSON.stringify({})});
                          const {data}=await api(`/leads/${drawer.id}`);
                          setForm(data);
                          loadLeads();
                          setMessage({ type: 'success', text: 'Lead marked as re-enquiry' });
                        } catch (error) {
                          setMessage({ type: 'error', text: error.message });
                        }
                      }}
                    >
                      Mark re-enquired
                    </button>
                    <button
                      type="button"
                      className="primary"
                      onClick={() => {
                        setDrawerTab("student");
                        setDrawer({
                          ...drawer,
                          mode: "edit",
                          title: `Edit ${form.studentName}`,
                        });
                      }}
                    >
                      <Pencil size={16} /> Edit lead
                    </button>
                  </>
                )}
                {drawer.mode !== "view" && (
                  <button className="primary" disabled={saving}>
                    {saving
                      ? "Saving…"
                      : drawer.mode === "edit"
                        ? "Save changes"
                        : "Create lead"}
                  </button>
                )}
              </div>
            </form>
          </aside>
        </>
      )}
      {showStageChangeConfirm && (
        <BulkStageChangeConfirm
          count={selectedIds.length}
          onCancel={() => setShowStageChangeConfirm(false)}
          onContinue={() => {
            setShowStageChangeConfirm(false);
            setStageChangeTarget(selectedIds);
          }}
        />
      )}
      {stageChangeTarget && (
        <StageChangeDialog
          leads={stageChangeTarget}
          meta={meta}
          onClose={() => setStageChangeTarget(null)}
          onSuccess={(result) => {
            setMessage({ type: "success", text: result.message });
            loadLeads();
            setSelectedIds([]);
          }}
          onError={(error) => {
            setMessage({ type: "error", text: error.message });
          }}
        />
      )}
      <WhatsAppSendPanel
        open={Boolean(whatsAppRecipients)}
        initialRecipients={whatsAppRecipients || []}
        initialMode="selected"
        presentation="drawer"
        onClose={() => setWhatsAppRecipients(null)}
        onSent={() => setMessage({ type: "success", text: "WhatsApp message request completed" })}
      />
    </main>
  );
}
