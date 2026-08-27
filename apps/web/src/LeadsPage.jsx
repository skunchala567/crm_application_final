import { useEffect, useMemo, useRef, useState } from "react";
import { Bookmark, BookmarkCheck, CalendarRange, ChevronDown, ChevronLeft, ChevronRight, Clock3, Columns3, Download, Filter, GripVertical, History, Megaphone, NotebookPen, MessageCircle, Mail, MoreVertical, PanelRightClose, PanelRightOpen, PhoneCall, Pencil, Plus, RotateCcw, Search, Trash2, Upload, UserRoundPlus, X, GitBranch, MessageSquare} from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { createPortal } from "react-dom";
import { api } from "./api";
import FilterWorkspace, { emptyAdvancedFilters, MultiSearchSelect, normalizeFilters } from "./FilterWorkspace.jsx";
import DownloadFieldsDialog from "./DownloadFieldsDialog.jsx";
import { BulkUploadModal } from "./BulkUpload.jsx";
import BulkMessageSend from "./components/BulkMessageSend.jsx";
import { useRegisterLeadQuickActions } from "./LeadQuickActionsContext.jsx";
import { usePermissions } from "./PermissionContext.jsx";
import { StageChangeDialog } from "./StageChangeDialog.jsx";
import { BulkStageChangeConfirm } from "./BulkStageChangeConfirm.jsx";
import Toast from "./Toast.jsx";
import { WhatsAppSendPanel } from "./components/WhatsAppSendPanel.jsx";
import EmailComposer from "./components/EmailComposer.jsx";
import { MarketingCampaignBuilder } from "./MarketingCampaigns.jsx";
import ActivityTimeline from "./components/ActivityTimeline.jsx";
import LeadTimeline from "./components/LeadTimeline.jsx";
import "./LeadsUnread.css";
import "./LeadsStickyLayout.css";
import "./ProjectPagination.css";

const emptyForm = {
  studentName: "",
  studentId: "",
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

/*
 * Whether the lead's application payment has actually been collected.
 *
 * Jodo reports several words for money that arrived -- paid on capture,
 * settled once it reaches the account -- and the screen must not treat a
 * settled payment as unpaid. Everything else, a started order or no order at
 * all, is not paid.
 */
/*
 * Every source a lead came through, oldest first.
 *
 * A lead that re-enquires through a second advertisement keeps its original
 * source on the lead row and gains a row in its source history. Filtering on
 * the lead row alone therefore could not find a lead by the source that
 * actually brought it back -- and the export had the same blind spot.
 *
 * The first entry is the primary source; everything after it is secondary,
 * which is what the history's own ordering already means.
 */
function leadSources(lead) {
  const ids = String(lead?.sourceIdList || "").split(",").map(part => part.trim()).filter(Boolean);
  const names = String(lead?.sourceNameList || "").split("||").map(part => part.trim());
  // A lead with no history row at all still has the source on its own row.
  if (!ids.length) return lead?.sourceId ? [{ id: String(lead.sourceId), name: lead.source || "" }] : [];
  return ids.map((id, index) => ({ id, name: names[index] || "" }));
}

const secondarySources = (lead) => leadSources(lead).slice(1);

const PAID_STATUSES = ["paid", "settled", "success", "completed", "captured"];
const isPaymentCollected = (lead) => PAID_STATUSES.includes(String(lead?.paymentStatus || "").toLowerCase());
const hasStudentId = (lead) => Boolean(String(lead?.studentId || "").trim());

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
  className = "",
}) {
  const selected = options.find(
    (option) => String(option.id) === String(value),
  );
  const [query, setQuery] = useState(selected?.label || "");
  const [open, setOpen] = useState(false);
  const filteredOptions = options.filter(option => option.label.toLowerCase().includes(query.trim().toLowerCase()));
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
    <label className={className}>
      {label}
      {required ? " *" : ""}
      <div className="suggestion-field">
        <Search size={15} />
        <input
          required={required}
          value={query}
          placeholder={placeholder}
          onChange={(event) => {
            update(event.target.value);
            setOpen(true);
            const exactMatch = options.some(option => option.label.toLowerCase() === event.target.value.trim().toLowerCase());
            event.target.setCustomValidity(event.target.value && !exactMatch ? `Select a configured ${label.toLowerCase()} from the list` : "");
          }}
          onBlur={(event) => {
            const exactMatch = options.find(option => option.label.toLowerCase() === event.target.value.trim().toLowerCase());
            if (!exactMatch) {
              setQuery("");
              onChange("");
              event.target.setCustomValidity("");
            }
            setOpen(false);
          }}
          onFocus={() => setOpen(true)}
          autoComplete="off"
        />
        {open&&<div className="suggestion-menu" role="listbox">
          {filteredOptions.length?filteredOptions.map(option=><button key={option.id} type="button" role="option" aria-selected={String(option.id)===String(value)} onMouseDown={event=>{event.preventDefault();setQuery(option.label);onChange(option.id);setOpen(false);}}>{option.label}</button>):<p>No matching options</p>}
        </div>}
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

// The Add-lead form presents the configured fields in these sections rather than
// one long list. Fields render in the order listed here, not by their configured
// position, so a section reads in a sensible order regardless of how the lead
// fields happen to be sorted in Business Unit settings.
const leadFieldGroups = [
  {title:"Lead name & contact details",keys:["student_name","name","phone","primary_phone","alternate_phone","email","parent_name","city"]},
  {title:"Academic requirements",keys:["academic_year","branch_id","admission_type_id","curriculum_id","class_id"]},
  {title:"Source details",keys:["channel_id","source_id","campaign_id"]},
  {title:"Follow-up details",keys:["stage_id","substage_id","owner_employee_id","next_followup_at_utc","followup_type","remarks","lead_score"]},
];
const groupedLeadFieldKeys = new Set(leadFieldGroups.flatMap(group => group.keys));

// Anything an admin adds that isn't in a group above lands in a trailing
// "Additional details" section, so a new custom field can never silently
// vanish from the form.
function groupLeadFields(fields = []) {
  const sections = leadFieldGroups.map(group => ({
    title: group.title,
    fields: group.keys.map(key => fields.find(field => field.fieldKey === key)).filter(Boolean),
  }));
  const ungrouped = fields.filter(field => !groupedLeadFieldKeys.has(field.fieldKey));
  if (ungrouped.length) sections.push({ title: "Additional details", fields: ungrouped });
  return sections.filter(section => section.fields.length);
}

/**
 * A stage's label, disambiguated by pipeline only when it has to be.
 *
 * A business unit can run several lead pipelines, and two of them may each
 * have a stage called "New". Where that happens the pipeline name is added so
 * the two can be told apart; where a name is unique the label is left alone,
 * so a single-pipeline unit reads exactly as it always did.
 *
 * Module scope on purpose: the add/edit form and the follow-up dialog are
 * separate components and both need it.
 */
function stageLabelFor(stage, stages = [], pipelines = []) {
  if (!stage) return "";
  /* Only a clash across pipelines is worth naming. Two stages with the same
     name inside one pipeline are not told apart by adding that pipeline's
     name to both -- it would put the same suffix on each and say nothing. */
  const clashesAcrossPipelines = stages.some(other => (
    other.id !== stage.id
    && other.displayName === stage.displayName
    && String(other.pipelineId) !== String(stage.pipelineId)
  ));
  if (!clashesAcrossPipelines) return stage.displayName;
  const pipeline = (pipelines || []).find(item => String(item.id) === String(stage.pipelineId));
  return pipeline ? `${stage.displayName} · ${pipeline.displayName}` : stage.displayName;
}

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
      admission_type_id:availableAdmissionTypes.map(item=>({id:item.id,label:item.displayName})),
      curriculum_id:availableCurricula.map(item=>({id:item.id,label:item.displayName})),
      channel_id:meta.channels.map(item=>({id:item.id,label:item.displayName})),
      source_id:sourcesForChannel(meta.sources,meta.sourceLinks,form.channelId).map(item=>({id:item.id,label:item.displayName})),
      campaign_id:meta.campaigns.map(item=>({id:item.id,label:item.displayName})),
      stage_id:meta.stages.map(item=>({id:item.id,label:stageLabelFor(item,meta.stages,meta.pipelines)})),
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
        const waitingForChannel=field.fieldKey==="source_id"&&!form.channelId;
        return <label key={field.id}>{label}<select required={required} disabled={waitingForChannel} value={value} onChange={event=>update(field,event.target.value)}><option value="">{waitingForChannel?"Select channel first":`${required?"Select":"Not specified"} ${field.displayName.toLowerCase()}`}</option>{options.map(option=><option key={option.id} value={option.id}>{option.label}</option>)}</select></label>;
      }
      if(field.fieldType==="boolean")return <label key={field.id} className="configured-checkbox"><input type="checkbox" checked={Boolean(value)} onChange={event=>update(field,event.target.checked)}/>{field.displayName}</label>;
      if(["textarea"].includes(field.fieldType))return <label key={field.id} className="wide">{label}<textarea required={required} rows="4" placeholder={field.placeholder||""} value={value} onChange={event=>update(field,event.target.value)}/></label>;
      const type={phone:"tel",email:"email",number:"number",decimal:"number",date:"date",datetime:"datetime-local",file:"file"}[field.fieldType]||"text";
      const isPhone=field.fieldType==="phone";
      return <label key={field.id}>{label}<input ref={["name","student_name"].includes(field.fieldKey)?inputRef:undefined} required={required} type={type} step={field.fieldType==="decimal"?"any":undefined} inputMode={isPhone?"numeric":undefined} maxLength={isPhone?10:undefined} pattern={isPhone?"[6-9][0-9]{9}":undefined} title={isPhone?"Enter a valid 10-digit Indian mobile number starting with 6-9":undefined} placeholder={field.placeholder||""} value={type==="file"?undefined:value} onChange={event=>update(field,type==="file"?event.target.files?.[0]?.name||"":isPhone?event.target.value.replace(/\D/g,"").slice(0,10):event.target.value)}/></label>;
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
    <header>{previous ? <button type="button" aria-label="Previous month" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onPrevious?.(); }}><ChevronLeft/></button> : <span/>}<strong>{month.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</strong>{next ? <button type="button" aria-label="Next month" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onNext?.(); }}><ChevronRight/></button> : <span/>}</header>
    <div className="range-weekdays">{["Su","Mo","Tu","We","Th","Fr","Sa"].map(day => <span key={day}>{day}</span>)}</div>
    <div className="range-days">{Array.from({ length: firstDay }, (_, index) => <span key={`blank-${index}`}/>)}{Array.from({ length: days }, (_, index) => { const key=localDateKey(new Date(year,monthIndex,index+1)); const selected=key===from||key===to; const within=from&&to&&key>from&&key<to; return <button type="button" key={key} className={`${selected?"selected ":""}${within?"in-range":""}`} onClick={() => onSelect(key)}>{index+1}</button>; })}</div>
  </section>;
}

function FollowupDateFilter({ from, to, onChange, dateType = "nextFollowup", onDateTypeChange }) {
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const rootRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = event => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
    const escape = event => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close, true);
    document.addEventListener("touchstart", close, true);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("mousedown", close, true);
      document.removeEventListener("touchstart", close, true);
      document.removeEventListener("keydown", escape, true);
    };
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
  function tillToday() {
    onChange("", localDateKey(new Date()));
  }
  const nextMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1);
  return <div className="inline-lead-filter followup-date-filter" ref={rootRef}>
    {/* Reflects the selected type: the control filters by whichever date is
        chosen, so a fixed "Follow-ups" label contradicted it. */}
    <span>{dateTypeLabels[dateType] || "Follow-ups"}</span>
    <button type="button" className={`followup-range-trigger ${from || to ? "active" : ""}`} aria-expanded={open} onClick={toggleOpen}><CalendarRange size={16}/><div style={{display:"flex",flexDirection:"column",alignItems:"flex-start",minWidth:0,flex:1}}><small style={{fontSize:"10px",color:"var(--ink-400)"}}>{dateTypeLabels[dateType]}</small><b>{label}</b></div><ChevronDown size={14}/></button>
    {open && <div className="followup-range-popover leads-date-range-popover">
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
        <aside><strong>Choose a period</strong><button type="button" onClick={() => preset(0)}>Today</button><button type="button" onClick={() => yesterday()}>Yesterday</button><button type="button" onClick={tillToday}>Till today</button><button type="button" onClick={() => yesterday(true)}>Till yesterday</button><button type="button" onClick={() => preset(1)}>Next day</button><button type="button" onClick={() => preset(7)}>Next 7 days</button><button type="button" onClick={() => preset(30)}>Next 30 days</button></aside>
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
  onClearFilters,
  onOpenFilters,
  parkedOnly,
  onToggleParked,
  parkedCount = 0,
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreMenuRef = useRef(null);

  useEffect(() => {
    if (!moreOpen) return undefined;
    const close = event => { if (!moreMenuRef.current?.contains(event.target)) setMoreOpen(false); };
    const escape = event => { if (event.key === "Escape") setMoreOpen(false); };
    document.addEventListener("mousedown", close, true);
    document.addEventListener("touchstart", close, true);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("mousedown", close, true);
      document.removeEventListener("touchstart", close, true);
      document.removeEventListener("keydown", escape, true);
    };
  }, [moreOpen]);

  return (
    <div className="funnel-strip">

      {/* Search lives in the universal topbar and drives this list via ?q= */}

      {/* Right Side */}
      <div className="funnel-header-actions">

        {funnels.length > 0 && (
          <div className="funnel-more-wrap" ref={moreMenuRef}>
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
          title="Add lead (Ctrl/Command + Q)"
          aria-keyshortcuts="Control+M Meta+M"
        >
          <Plus size={17} />
          Add lead
          <span className="add-lead-shortcut" aria-hidden="true"><kbd>Ctrl/⌘</kbd><kbd>M</kbd></span>
        </button>

        {/* Parked leads: a switch rather than another filter chip, because it
            answers a different question -- not "which leads match" but "show
            me the ones I put aside". The badge counts them whether the switch
            is on or off, so the shelf is visible without opening it. */}
        <button
          type="button"
          role="switch"
          aria-checked={Boolean(parkedOnly)}
          className={parkedOnly ? "parked-switch is-on" : "parked-switch"}
          onClick={onToggleParked}
          title={parkedOnly ? "Showing parked leads only. Click to show all leads." : "Show only parked leads"}
        >
          <Bookmark size={16} className="parked-switch-icon" />
          <span>Parked</span>
          {parkedCount > 0 && <span className="parked-switch-badge">{parkedCount > 99 ? "99+" : parkedCount}</span>}
        </button>

        <div className="lead-quick-actions funnel-filter-actions">
          <button title="Clear filters" aria-label="Clear filters" onClick={onClearFilters}>
            <RotateCcw />
          </button>
          <button title="Open filters" aria-label="Open filters" onClick={onOpenFilters}>
            <Filter />
          </button>
        </div>

        {/* The messages and notifications icons used to be repeated here.
            They are global, not per-screen, and the universal topbar already
            carries them -- two bells side by side showing different numbers
            (this one was hardcoded to 0) was worse than none. */}

      </div>

    </div>
  );
}

/**
 * Which advanced-filter fields each date type reads and writes.
 *
 * The inline date picker used to write into followupFrom/followupTo whatever
 * type was chosen, while the filter below evaluates each range against its
 * own field -- so picking "Added -> Till today" filtered on next follow-up
 * instead, and leads added earlier disappeared.
 */
const DATE_TYPE_FILTER_FIELDS = {
  addedAt: ["addedFrom", "addedTo"],
  updatedAt: ["updatedFrom", "updatedTo"],
  referredAt: ["referredFrom", "referredTo"],
  nextFollowup: ["nextFollowupFrom", "nextFollowupTo"],
  reEnquiredAt: ["reEnquiredFrom", "reEnquiredTo"],
};

/**
 * Write a range into the fields a date type owns.
 *
 * Next follow-up carries two pairs: nextFollowupFrom/To written by the filter
 * workspace, and the older followupFrom/To this inline picker used. The row
 * filter reads `nextFollowupFrom || followupFrom`, so clearing only one of
 * them would leave the other still filtering. Both move together.
 */
function withDateRange(filters, dateType, from, to) {
  const [fromKey, toKey] = DATE_TYPE_FILTER_FIELDS[dateType] || DATE_TYPE_FILTER_FIELDS.nextFollowup;
  const next = { ...filters, [fromKey]: from || "", [toKey]: to || "" };
  if (fromKey === "nextFollowupFrom") {
    next.followupFrom = from || "";
    next.followupTo = to || "";
  }
  return next;
}

/**
 * Counsellors available to receive a referral, as one searchable list.
 *
 * Referral used to be two fields -- pick a branch, then a counsellor in it --
 * which meant knowing the branch before you could look someone up. One list
 * labelled "Name - Branch" is searchable by either, because the datalist
 * matches anywhere in the label.
 *
 * The option key has to carry the branch. A counsellor with access to four
 * branches comes back as four rows sharing one employee id, so keying on the
 * employee alone would resolve "Taufeeq - NACHARAM" to whichever of his
 * branches happened to be listed first, and refer the lead to the wrong one.
 */
function referralChoices(employees = []) {
  return employees.map(employee => ({
    id: `${employee.branchId}:${employee.id}`,
    label: `${employee.name} - ${employee.branchName}`,
  }));
}

/** The composite key for a branch/counsellor pair, or "" when incomplete. */
function referralKey(branchId, employeeId) {
  return branchId && employeeId ? `${branchId}:${employeeId}` : "";
}

/** Split a composite key back into its two ids. */
function splitReferralKey(key) {
  const [branchId = "", employeeId = ""] = String(key || "").split(":");
  return { branchId, employeeId };
}

/**
 * Sources selectable under a channel.
 *
 * The mapping is configured on the source itself. Two rules:
 * A source is offered only when its configured channel matches the selected
 * channel. Until a channel is selected, no source is selectable.
 */
/** The active business unit, as the api layer reads it. */
const savedFunnelKey = () => `crm_saved_funnel_${localStorage.getItem("crm_business_unit_id") || "default"}`;

/*
 * Which columns the leads table shows, and in what order.
 *
 * The arrangement belongs to the person, on the pipeline they arranged it on:
 * a unit's pipelines can be different businesses -- Leads, Franchise, Eco
 * Bharath -- so the columns that suit one are the wrong ones for the next, and
 * the configured lead fields behind them differ per unit as well. It is stored
 * on the account (crm_lead_column_preferences); what is kept here is a cache,
 * so the right columns are painted before that request lands.
 *
 * A pipeline nobody has arranged -- a new business unit, a pipeline created
 * this morning -- has neither, and gets the default columns below.
 */
const leadColumnsKey = pipelineId => `crm_lead_columns_${localStorage.getItem("crm_business_unit_id") || "default"}_${pipelineId || "default"}`;
const DEFAULT_LEAD_COLUMN_IDS = ["core:student","core:academic","core:source","core:stage","core:payment","core:studentId","core:owner","core:nextFollowup","core:recentModified"];
/* null, not the defaults: the caller has to tell "nothing arranged here yet"
   from "arranged, and it happens to match the defaults". */
function readStoredLeadColumns(pipelineId) {
  try {
    const stored = JSON.parse(localStorage.getItem(leadColumnsKey(pipelineId)) || "null");
    return Array.isArray(stored) && stored.length ? stored : null;
  } catch { return null; }
}
function writeStoredLeadColumns(pipelineId, ids) {
  try { localStorage.setItem(leadColumnsKey(pipelineId), JSON.stringify(ids)); } catch { /* private mode */ }
}
const isDefaultLeadColumns = ids => ids.length === DEFAULT_LEAD_COLUMN_IDS.length
  && ids.every((id, index) => id === DEFAULT_LEAD_COLUMN_IDS[index]);

/* The export getters return strings, numbers, dates already formatted, and
   whatever a custom field happened to store -- all of which has to survive
   being put in a cell. */
function leadCellText(value) {
  if (value === null || value === undefined || value === "") return "\u2014";
  if (Array.isArray(value)) return value.join(", ") || "\u2014";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/* Catalogue fields that say exactly what a built-in column already says, so
   the picker does not offer the same value twice under two names. Fields that
   are only a *part* of a composite column -- branch, class, curriculum, the
   payment amount -- stay, because showing one alone is a real choice. */
const LEAD_COLUMN_DUPLICATE_FIELD_IDS = new Set(["studentName","primaryPhone","stage","owner","source","nextFollowup","paymentDone","studentIdGenerated"]);

function sourcesForChannel(sources = [], sourceLinks = [], channelId) {
  if (!channelId) return [];
  return sources.filter((source) => sourceLinks.some(
    (link) => String(link.channelId) === String(channelId)
      && String(link.sourceId) === String(source.id),
  ));
}

/**
 * "Is referred" -- whether a lead has been handed to someone else by me.
 *
 *   no  (default) leads sitting with me, that I did not refer away
 *   yes           leads I referred, now owned by someone else
 *   ""            no opinion; show everything
 *
 * Both sides are answered from the lead itself: referredByEmployeeId records
 * who passed it on, ownerEmployeeId who holds it now.
 */
function matchesReferredFilter(lead, mode, myEmployeeId) {
  if (!mode) return true;
  /* Without an employee record there is no "me" to compare against. Nothing
     can have been referred by such a user -- referrals are stamped with an
     employee id -- so "yes" is honestly empty, while the other modes show
     everything rather than nothing. */
  if (!myEmployeeId) return mode !== "yes";

  const referredByMe = String(lead.referredByEmployeeId || "") === String(myEmployeeId);
  const ownedByMe = String(lead.ownerEmployeeId || "") === String(myEmployeeId);

  if (mode === "yes") return referredByMe && !ownedByMe;
  return !referredByMe && ownedByMe;
}

function getDateFieldValue(lead, dateType) {
  const dateMap = {
    addedAt: lead.addedAt,
    updatedAt: lead.updatedAt,
    referredAt: lead.referredAt,
    nextFollowup: lead.nextFollowup,
    reEnquiredAt: lead.reEnquiredAt,
  };
  // A known type with no value on this lead must stay empty rather than
  // borrowing the follow-up date -- otherwise a lead that was never referred
  // would match a "referred between" range on its follow-up date instead.
  // Only an unrecognised type falls back, preserving the original default.
  return dateType in dateMap ? dateMap[dateType] : lead.nextFollowup;
}
function matchesDateRange(lead, field, from, to) {
  if (!from && !to) return true;
  const value = getDateFieldValue(lead, field);
  if (!value) return false;
  const key = istDateKey(value);
  return (!from || key >= from) && (!to || key <= to);
}
function containsFilter(value, search) {
  if (!search) return true;
  return String(value || "").toLowerCase().includes(String(search).trim().toLowerCase());
}
function phoneContainsFilter(value, search) {
  if (!search) return true;
  return String(value || "").replace(/\D/g,"").includes(String(search).replace(/\D/g,""));
}

function formatExportDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("en-IN", { timeZone:"Asia/Kolkata", dateStyle:"medium", timeStyle:"short" });
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

/**
 * The recent comments of one lead, as a single cell.
 *
 * One comment per line, newest first, each "Author: comment". Newlines
 * survive because csvCell quotes every value, and Excel shows a quoted
 * multi-line cell as multiple lines within the one cell.
 *
 * A comment containing its own line breaks is flattened to a single line, or
 * it would look like several comments once inside the cell.
 */
function formatCommentCell(comments) {
  if (!Array.isArray(comments) || !comments.length) return "";
  return comments
    .map(({ author, text }) => `${author || "CRM user"}: ${String(text || "").replace(/\s*\r?\n\s*/g, " ").trim()}`)
    .join("\n");
}

function buildLeadExportGroups(meta) {
  const base = [
    { id:"leadId", label:"Lead ID", group:"Lead details", defaultSelected:true, get:lead=>lead.leadId },
    { id:"studentName", label:"Student name", group:"Lead details", defaultSelected:true, get:lead=>lead.studentName },
    { id:"studentId", label:"Student ID", group:"Lead details", get:lead=>lead.studentId || "" },
    { id:"studentIdGenerated", label:"Student ID generated", group:"Lead details", defaultSelected:true, get:lead=>hasStudentId(lead) ? "Yes" : "No" },
    { id:"paymentDone", label:"Payment status", group:"Lead details", defaultSelected:true, get:lead=>isPaymentCollected(lead) ? "Yes" : "No" },
    { id:"paymentAmount", label:"Payment amount", group:"Lead details", get:lead=>isPaymentCollected(lead) ? Number(lead.paymentAmount || 0) : "" },
    { id:"primaryPhone", label:"Primary phone", group:"Communication details", defaultSelected:true, get:lead=>lead.phone },
    { id:"alternatePhone", label:"Alternate phone", group:"Communication details", get:lead=>lead.alternatePhone },
    { id:"email", label:"Email", group:"Communication details", get:lead=>lead.email },
    { id:"parentName", label:"Parent name", group:"Family & Address details", get:lead=>lead.parentName },
    { id:"city", label:"City", group:"Family & Address details", get:lead=>lead.city },
    { id:"branch", label:"Branch", group:"Academic details", defaultSelected:true, get:lead=>lead.branch },
    { id:"academicYear", label:"Academic year", group:"Academic details", get:lead=>lead.academicYear },
    { id:"class", label:"Class", group:"Academic details", defaultSelected:true, get:lead=>lead.applyingClass },
    { id:"curriculum", label:"Curriculum", group:"Academic details", defaultSelected:true, get:lead=>lead.curriculum },
    /* The lead list carries the id, not the name -- resolved here, like the
       sub-stage and channel above, so the column is not permanently blank. */
    { id:"admissionType", label:"Admission type", group:"Academic details", get:lead=>meta.admissionTypes.find(item=>String(item.id)===String(lead.admissionTypeId))?.displayName || lead.admissionType || "" },
    { id:"stage", label:"Stage", group:"Lead journey details", defaultSelected:true, get:lead=>lead.stage },
    { id:"substage", label:"Sub-stage", group:"Lead journey details", get:lead=>meta.substages.find(item=>String(item.id)===String(lead.substageId))?.displayName || "" },
    { id:"source", label:"Source", group:"Source details", get:lead=>leadSources(lead)[0]?.name || lead.source || "" },
    /* The export had the same blind spot as the filter: a lead found through
       a second advertisement exported as though it only ever had the first. */
    { id:"secondarySources", label:"Secondary sources", group:"Source details",
      get:lead=>secondarySources(lead).map(item=>item.name).filter(Boolean).join(", ") },
    { id:"allSources", label:"All sources", group:"Source details",
      get:lead=>leadSources(lead).map(item=>item.name).filter(Boolean).join(", ") },
    { id:"sourceCount", label:"Source count", group:"Source details", get:lead=>leadSources(lead).length },
    { id:"channel", label:"Channel", group:"Source details", get:lead=>meta.channels.find(item=>String(item.id)===String(lead.channelId))?.displayName || "" },
    { id:"campaign", label:"Campaign", group:"Source details", get:lead=>meta.campaigns.find(item=>String(item.id)===String(lead.campaignId))?.displayName || "" },
    { id:"owner", label:"Counsellor", group:"Lead ownership", defaultSelected:true, get:lead=>lead.owner },
    { id:"touchStatus", label:"Touch status", group:"Lead ownership", get:lead=>lead.touchStatus },
    { id:"score", label:"Lead score", group:"Lead ownership", get:lead=>lead.score },
    { id:"remarks", label:"Remarks", group:"Lead journey details", get:lead=>lead.remarks },
    { id:"addedAt", label:"Added on", group:"Date details", defaultSelected:true, get:lead=>formatExportDate(lead.addedAt) },
    { id:"updatedAt", label:"Updated on", group:"Date details", defaultSelected:true, get:lead=>formatExportDate(lead.updatedAt) },
    { id:"referredAt", label:"Referred on", group:"Date details", get:lead=>formatExportDate(lead.referredAt) },
    { id:"nextFollowup", label:"Next follow-up", group:"Date details", get:lead=>formatExportDate(lead.nextFollowup) },
    { id:"reEnquiredAt", label:"Re-enquired on", group:"Date details", get:lead=>formatExportDate(lead.reEnquiredAt) },
    /* One cell holding the last five comments, newest first, each as
       "Author: comment". The lead list does not carry comments, so the
       exporter fetches them for the selected rows and hangs them on the lead
       as recentComments before calling this. */
    { id:"recentComments", label:"Recent comments (last 5)", group:"Lead journey details",
      needsComments:true, get:lead=>formatCommentCell(lead.recentComments) },
  ];
  const standardKeys = new Set(["name","student_name","phone","primary_phone","alternate_phone","email","parent_name","city","academic_year","branch_id","admission_type_id","curriculum_id","class_id","channel_id","source_id","campaign_id","stage_id","substage_id","owner_employee_id","next_followup_at_utc"]);
  const custom = (meta.leadFields || [])
    .filter(field => field.fieldKey && !standardKeys.has(String(field.fieldKey)))
    .map(field => ({ id:`custom:${field.fieldKey}`, label:field.displayName, group:"Configured custom fields", get:lead=>lead.customValues?.[field.fieldKey] }));
  const byGroup = [...base, ...custom].reduce((acc, field) => {
    if (!acc[field.group]) acc[field.group] = [];
    if (!acc[field.group].some(existing => existing.label.toLowerCase() === field.label.toLowerCase())) acc[field.group].push(field);
    return acc;
  }, {});
  return Object.entries(byGroup).map(([name, fields]) => ({ name, fields }));
}

export default function LeadsPage() {
  /*
   * Which lead pipeline this screen shows.
   *
   * A business unit can run several, and each gets its own Leads screen at
   * /leads/pipeline/:pipelineId with the same features -- filters, bulk
   * actions, exports. The plain /leads route carries no id and shows the
   * unit's default pipeline, so a unit with one pipeline is unchanged.
   */
  const routePipelineId = Number(useParams().pipelineId) || null;
  const { can, roles, ready: permissionsReady } = usePermissions();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [leads, setLeads] = useState([]);
  const [totalLeads, setTotalLeads] = useState(0);
  const [stageCounts, setStageCounts] = useState({});
  const [followupsTillToday,setFollowupsTillToday]=useState(0);
  const [untouchedAssignedCount,setUntouchedAssignedCount]=useState(0);
  const [rawMeta, setMeta] = useState({
    stages: [],
    // The lead pipelines this business unit runs; stages belong to one each.
    pipelines: [],
    sources: [],
    classes: [],
    curricula: [],
    channels: [],
    sourceLinks: [],
    campaignLinks: [],
    campaigns: [],
    admissionTypes: [],
    substages: [],
    manualLeadDefaults: {},
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
  /* Which Meta audiences this lead is in. Loaded when the tab is opened --
     most drawer visits never ask. */
  const [leadAudiences,setLeadAudiences]=useState(null);
  useEffect(()=>{
    if(drawerTab!=="remarketing"||!drawer?.id||leadAudiences!==null)return;
    let cancelled=false;
    api(`/meta/leads/${drawer.id}/audiences`)
      .then(result=>{if(!cancelled)setLeadAudiences(result.data||[]);})
      .catch(()=>{if(!cancelled)setLeadAudiences([]);});
    return()=>{cancelled=true;};
  },[drawerTab,drawer?.id,leadAudiences]);
  const [secondarySource,setSecondarySource]=useState({academicYear:"",sourceId:"",channelId:"",campaignId:""});
  /* Set while a re-enquiry is being recorded: the counsellor asked to mark
     the lead as one and is now picking the source it came back through. The
     mark is written by that source's save, not before it. */
  const [reEnquiryPending,setReEnquiryPending]=useState(false);
  /* Closing the drawer, or moving to another lead, abandons the re-enquiry:
     nothing was written, so the next lead must not inherit the intent. */
  useEffect(()=>{setReEnquiryPending(false);},[drawer?.id]);

  /* The pipeline actually in force: the one named in the route, or the
     unit's default when the plain /leads route is open. */
  const activePipeline = useMemo(() => {
    const list = rawMeta.pipelines || [];
    return list.find(item => String(item.id) === String(routePipelineId))
      || list.find(item => item.isDefault) || list[0] || null;
  }, [rawMeta.pipelines, routePipelineId]);

  /*
   * Everything downstream reads `meta`, so narrowing the stage and sub-stage
   * lists here scopes the whole screen at once -- the tab strip, the filters,
   * the add/edit form, the bulk actions and the export all follow, and a
   * child component cannot accidentally offer another pipeline's stages.
   */
  const meta = useMemo(() => {
    if (!activePipeline) return rawMeta;
    const stages = rawMeta.stages.filter(stage => String(stage.pipelineId) === String(activePipeline.id));
    const stageIds = new Set(stages.map(stage => String(stage.id)));
    return {
      ...rawMeta,
      stages,
      substages: rawMeta.substages.filter(item => stageIds.has(String(item.stageId))),
      /* Branches narrowed the same way stages are. A branch carries no
         pipelines until somebody restricts it in Branches & payments, and an
         empty list means every pipeline -- so the default is that nothing is
         hidden, and only a branch explicitly tied elsewhere drops out. */
      branches: rawMeta.branches.filter(branch =>
        !branch.pipelineIds?.length
        || branch.pipelineIds.some(id => String(id) === String(activePipeline.id))),
    };
  }, [rawMeta, activePipeline]);


  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  /*
   * Leads set aside to come back to, and whether the list is showing only
   * them. Parking is a property of the lead, so it is written straight
   * through rather than held here -- this only tracks the rows in flight so
   * a second click cannot fire before the first has answered.
   */
  const [parkedOnly, setParkedOnly] = useState(false);
  const [parkingIds, setParkingIds] = useState([]);
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
  const [callProviderChoice,setCallProviderChoice]=useState(null);
  const [followupModal,setFollowupModal]=useState(null);
  const [activeCall,setActiveCall]=useState(null);
  const [callTimerNow,setCallTimerNow]=useState(Date.now());
  const [followupForm,setFollowupForm]=useState({stageId:"",substageId:"",comment:"",comments:[],nextFollowupAt:"",followupType:"",referralBranchId:"",referralEmployeeId:"",callActivityId:null,callDisposition:""});
  const [referBranchId,setReferBranchId]=useState("");
  const [referEmployeeId,setReferEmployeeId]=useState("");
  const [referralOptions,setReferralOptions]=useState({branches:[],employees:[],pipelines:[]});
  /* Which pipeline the referral moves the lead to. "" leaves it where it is,
     which is what every referral did before pipelines existed. */
  const [referPipelineId,setReferPipelineId]=useState("");
  // Keyed by business unit, like the dashboard layout and saved reports. The
  // unscoped key meant a view saved under one business unit was remembered
  // while working in another, where it does not exist.
  const [savedFunnel, setSavedFunnel] = useState(() => localStorage.getItem(savedFunnelKey()) || "");
  const [filterPanel, setFilterPanel] = useState(null);
  const [appliedFiltersExpanded, setAppliedFiltersExpanded] = useState(true);
  const [advancedFilters, setAdvancedFilters] = useState(emptyAdvancedFilters);
  const [followupDateType, setFollowupDateType] = useState("nextFollowup");
  // The signed-in user's employee record, which is what lead ownership and
  // referrals are keyed on. Read once: it cannot change within a session.
  const currentEmployeeId = useMemo(() => {
    try { return JSON.parse(localStorage.getItem("crm_user") || "{}").employeeId || null; }
    catch { return null; }
  }, []);
  /*
   * "Referred by me" answers what I passed on and no longer hold, and anyone
   * who can refer a lead can ask it -- it used to be shown to counsellors
   * alone, so for everybody else the filter simply was not there.
   *
   * What stays counsellor-only is the *default*. Their screen has always
   * opened on their own desk; a manager or admin works across everyone's
   * leads, so opening them on "only mine" would hide most of the pipeline for
   * a filter they never asked for.
   */
  const isCounsellor = roles.some((role) => role.normalizedName === "COUNSELLOR");
  const defaultAdvancedFilters = useMemo(
    () => ({ ...emptyAdvancedFilters, isReferred: isCounsellor ? "no" : "" }),
    [isCounsellor],
  );
  /* Roles arrive after the first render, so the counsellor default is applied
     once they are known -- and only while nobody has touched the filter. */
  const referredDefaultApplied = useRef(false);
  useEffect(() => {
    if (!permissionsReady || referredDefaultApplied.current) return;
    referredDefaultApplied.current = true;
    if (!isCounsellor) return;
    setAdvancedFilters(current => (current.isReferred ? current : { ...current, isReferred: "no" }));
  }, [permissionsReady, isCounsellor]);
  // The picker edits whichever pair of filter fields the chosen date type owns.
  const [dateFilterFromKey, dateFilterToKey] =
    DATE_TYPE_FILTER_FIELDS[followupDateType] || DATE_TYPE_FILTER_FIELDS.nextFollowup;

  /**
   * Switching the date type carries the range across rather than leaving it
   * behind on the previous field. The control shows one range, so leaving a
   * stale one applied to a type no longer on screen would silently filter the
   * list with something the user cannot see.
   */
  function changeDateFilterType(nextType) {
    if (nextType === followupDateType) return;
    setAdvancedFilters(current => {
      const carriedFrom = current[dateFilterFromKey];
      const carriedTo = current[dateFilterToKey];
      // Clear the old type's range first, then place it on the new one.
      const cleared = withDateRange(current, followupDateType, "", "");
      return withDateRange(cleared, nextType, carriedFrom, carriedTo);
    });
    setFollowupDateType(nextType);
  }
  const [funnels, setFunnels] = useState([]);
  const [bulkUploadOpen,setBulkUploadOpen]=useState(false);
  // 'sms' | 'email' | null -- which bulk message dialog is open.
  const [bulkChannel,setBulkChannel]=useState(null);
  const [stageChangeTarget, setStageChangeTarget] = useState(null);
  const [showStageChangeConfirm, setShowStageChangeConfirm] = useState(false);
  const [availableAdmissionTypes, setAvailableAdmissionTypes] = useState([]);
  const [availableCurricula, setAvailableCurricula] = useState([]);
  const [availableClasses, setAvailableClasses] = useState([]);
  const [pageSize, setPageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);
  const [whatsAppRecipients, setWhatsAppRecipients] = useState(null);
  const [emailLead, setEmailLead] = useState(null);
  const [marketingLeadIds, setMarketingLeadIds] = useState(null);
  const [whatsAppConversations, setWhatsAppConversations] = useState([]);
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
  const [columnDialogOpen, setColumnDialogOpen] = useState(false);
  /* The header being dragged, and the header the cursor is over: the second
     is what draws the drop marker. */
  const [draggedColumnId, setDraggedColumnId] = useState(null);
  const [dropColumnId, setDropColumnId] = useState(null);
  const [visibleColumnIds, setVisibleColumnIds] = useState(() => readStoredLeadColumns(routePipelineId) || DEFAULT_LEAD_COLUMN_IDS);
  /*
   * Load the arrangement for the screen being opened.
   *
   * Runs again on every pipeline this route reaches and on a business-unit
   * switch, because both change which screen -- and which catalogue of lead
   * fields -- is on show. The cached copy is painted first so the columns do
   * not visibly rearrange, and the account's copy replaces it when it lands.
   *
   * An account with nothing stored but a browser that has something is
   * somebody who arranged their columns before this moved off the browser:
   * their arrangement is sent up rather than discarded.
   */
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const cached = readStoredLeadColumns(routePipelineId);
      setVisibleColumnIds(cached || DEFAULT_LEAD_COLUMN_IDS);
      try {
        const { data } = await api(`/leads/column-preferences${routePipelineId ? `?pipelineId=${routePipelineId}` : ""}`);
        if (cancelled) return;
        const stored = Array.isArray(data?.columns) ? data.columns : [];
        if (stored.length) {
          setVisibleColumnIds(stored);
          writeStoredLeadColumns(routePipelineId, stored);
        } else if (cached && !isDefaultLeadColumns(cached)) {
          saveLeadColumns(cached);
        }
      } catch { /* the cached arrangement stands until the next load */ }
    };
    load();
    window.addEventListener("crm:business-unit-changed", load);
    return () => { cancelled = true; window.removeEventListener("crm:business-unit-changed", load); };
  }, [routePipelineId]);
  const studentNameInputRef = useRef(null);
  const stageTabsRef = useRef(null);
  const [stageTabScroll, setStageTabScroll] = useState({ left: false, right: false, overflow: false });

  useEffect(() => {
    const tabs = stageTabsRef.current;
    if (!tabs) return undefined;
    const update = () => {
      const max = Math.max(0, tabs.scrollWidth - tabs.clientWidth);
      setStageTabScroll({
        overflow: max > 2,
        left: tabs.scrollLeft > 2,
        right: tabs.scrollLeft < max - 2,
      });
    };
    update();
    tabs.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(tabs);
    Array.from(tabs.children).forEach(child => observer.observe(child));
    return () => {
      tabs.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [meta.stages.length]);

  function moveStageTabs(direction) {
    const tabs = stageTabsRef.current;
    if (!tabs) return;
    tabs.scrollBy({ left: direction * Math.max(220, tabs.clientWidth * .55), behavior: "smooth" });
  }

  /*
   * Which calling integrations this user may dial through.
   *
   * Both config endpoints used to be fetched on every click, so the
   * confirmation only appeared after two round trips -- the button looked
   * dead for as long as the slower one took. The answer is the same for the
   * whole session, so it is fetched once on mount and every click reads the
   * cached promise.
   */
  const callProvidersRef=useRef(null);
  function loadCallProviders({refresh=false}={}){
    if(refresh||!callProvidersRef.current){
      callProvidersRef.current=Promise.allSettled([api('/callerdesk/config'),api('/smartflo/config'),api('/bonvoice/config')])
        .then(([callerdeskResult,smartfloResult,bonvoiceResult])=>{
          const providers=[];
          if(callerdeskResult.status==='fulfilled'&&callerdeskResult.value.data?.configured&&callerdeskResult.value.data?.isActive!==false&&callerdeskResult.value.data?.userAssigned)providers.push({key:'callerdesk',label:'CallerDesk'});
          if(smartfloResult.status==='fulfilled'&&smartfloResult.value.data?.configured&&smartfloResult.value.data?.isActive!==false&&smartfloResult.value.data?.userAssigned)providers.push({key:'smartflo',label:'Tata Smartflo',callingMode:smartfloResult.value.data?.callingMode||'AGENT_FIRST'});
          if(bonvoiceResult.status==='fulfilled'&&bonvoiceResult.value.data?.configured&&bonvoiceResult.value.data?.isActive!==false&&bonvoiceResult.value.data?.userAssigned)providers.push({key:'bonvoice',label:'BonVoice IVR',callingMode:'TWO_LEG'});
          return providers;
        })
        .catch(error=>{callProvidersRef.current=null;throw error;});
    }
    return callProvidersRef.current;
  }

  useEffect(()=>{loadCallProviders().catch(()=>{});},[]);

  async function callLead(lead){
    setOpenActionId(null);
    try{
      let providers=await loadCallProviders();
      /* An empty cache may just predate an administrator mapping the user, so
         it is worth one live retry before telling them there is no route. */
      if(!providers.length)providers=await loadCallProviders({refresh:true});
      if(!providers.length)throw new Error('No calling integration is assigned to your user. Ask an administrator to map CallerDesk or Tata Smartflo in User Management.');
      if(providers.length>1){setCallProviderChoice({lead,providers});return;}
      await startLeadCall(lead,providers[0]);
    }catch(error){await openFailedCallFollowup(lead,error);}
  }

  async function openFailedCallFollowup(lead,error,selectedProvider=null){
    const endedAt=Date.now();
    const message=error?.message||'The call could not be started.';
    const callContext={
      isCallAttempt:true,leadId:lead.id,leadName:lead.studentName,
      provider:selectedProvider?.label||'Call',providerKey:selectedProvider?.key||null,
      callingMode:selectedProvider?.callingMode||null,callActivityId:null,
      startedAt:endedAt,endedAt,status:{status:'Failed',isLive:false,isTerminal:true},statusError:message,
    };
    setActiveCall(callContext);
    // No toast: the panel inside the dialog states the same failure, and two
    // copies of one message is one too many.
    await openFollowup(lead,callContext);
  }

  /*
   * Open the dialog, then dial.
   *
   * The provider request used to be awaited before anything appeared, so a
   * slow or retrying provider left the button looking dead -- Smartflo alone
   * can spend three attempts at a 25-second timeout before it answers. The
   * counsellor is going to sit on this screen either way, so it opens first
   * and the panel inside it reports the outcome when it arrives.
   */
  async function startLeadCall(lead,selectedProvider){
    setCallProviderChoice(null);
    const provider=selectedProvider.key,label=selectedProvider.label;
    const smartfloMode=selectedProvider.callingMode||'AGENT_FIRST';
    const flowDescription=provider!=='smartflo'?'Your mapped phone will ring first.':smartfloMode==='CUSTOMER_FIRST'?'The customer will ring first, followed by the destination configured for the Support API key.':'Your mapped Smartflo agent will ring first.';
    if(!window.confirm(`Start a ${label} call to ${lead.studentName} (${lead.phone})? ${flowDescription}`))return;

    const startedAt=Date.now();
    const pending={isCallAttempt:true,leadId:lead.id,leadName:lead.studentName,provider:label,providerKey:provider,
      callingMode:selectedProvider.callingMode||null,callingModeLabel:null,callActivityId:null,startedAt,
      status:{status:'Connecting…',isLive:false,isTerminal:false}};
    setActiveCall(pending);
    /*
     * The shell first, synchronously.
     *
     * openFollowup fetches the lead and the referral options before it renders
     * anything, which is another second of a dead-looking button. The dialog
     * is put on screen now and those details fill in behind it.
     *
     * Still awaited before dialling: openFollowup rewrites callActivityId from
     * the context it was handed, so letting it land after the provider replied
     * would wipe the id the disposition has to be saved against.
     */
    setOpenActionId(null);
    setFollowupForm({stageId:"",substageId:"",comment:"",comments:[],nextFollowupAt:"",followupType:"",
      referralBranchId:"",referralEmployeeId:"",callActivityId:null,callAttempt:true,callDisposition:""});
    setFollowupModal({id:lead.id,name:lead.studentName,callActivityId:null,callAttempt:true,pipelineId:null});
    await openFollowup(lead,pending);

    // Only ever update the call this function started: the counsellor may have
    // closed the dialog or moved to another lead while the provider was busy.
    const patchCall=changes=>setActiveCall(current=>
      current&&current.startedAt===startedAt&&String(current.leadId)===String(lead.id)?{...current,...changes}:current);

    try{
      const result=await api.post(`/${provider}/leads/${lead.id}/call`,provider==='callerdesk'?{mode:'member'}:{});
      const callActivityId=result.data?.callActivityId||null;
      patchCall({callingMode:result.data?.callingMode||selectedProvider.callingMode||null,
        callingModeLabel:result.data?.callingModeLabel||null,callActivityId,
        statusError:null,status:{status:'Initiated',isLive:false,isTerminal:false}});
      /* The dialog was opened before the call activity existed, and the
         disposition is saved against that id -- so it is threaded through now
         rather than being lost with the context it was opened from. */
      setFollowupForm(current=>({...current,callActivityId}));
      setFollowupModal(current=>current&&String(current.id)===String(lead.id)?{...current,callActivityId}:current);
    }catch(error){
      patchCall({endedAt:Date.now(),status:{status:'Failed',isLive:false,isTerminal:true},
        statusError:error?.message||'The call could not be started.'});
    }
  }

  useEffect(()=>{
    if(!activeCall)return undefined;
    setCallTimerNow(Date.now());
    if(activeCall.status?.isTerminal)return undefined;
    const timer=window.setInterval(()=>setCallTimerNow(Date.now()),1000);
    return ()=>window.clearInterval(timer);
  },[activeCall?.startedAt,activeCall?.status?.isTerminal]);

  useEffect(()=>{
    if(!['smartflo','bonvoice'].includes(activeCall?.providerKey)||!activeCall.callActivityId||activeCall.status?.isTerminal)return undefined;
    let cancelled=false;
    const refresh=async()=>{
      try{
        const result=await api(`/${activeCall.providerKey}/calls/${activeCall.callActivityId}/status`);
        if(cancelled)return;
        setActiveCall(current=>current?.callActivityId===activeCall.callActivityId?{...current,status:result.data,endedAt:result.data?.isTerminal?Date.now():current.endedAt}:current);
      }catch(error){
        if(!cancelled)setActiveCall(current=>{
          if(current?.callActivityId!==activeCall.callActivityId)return current;
          const providerInactive=/account is not active|account.*inactive|call is not active|already ended/i.test(error.message);
          return {...current,statusError:error.message,status:providerInactive?{...current.status,status:'Not active',isLive:false,isTerminal:true}:current.status,endedAt:providerInactive?Date.now():current.endedAt};
        });
      }
    };
    const first=window.setTimeout(refresh,1500);
    const timer=window.setInterval(refresh,5000);
    return ()=>{cancelled=true;window.clearTimeout(first);window.clearInterval(timer);};
  },[activeCall?.providerKey,activeCall?.callActivityId,activeCall?.status?.isTerminal]);

  const activeCallElapsed=activeCall?Math.max(0,Math.floor(((activeCall.endedAt||callTimerNow)-activeCall.startedAt)/1000)):0;
  const activeCallTime=activeCall?`${String(Math.floor(activeCallElapsed/60)).padStart(2,'0')}:${String(activeCallElapsed%60).padStart(2,'0')}`:'00:00';

  async function loadFunnels() {
    try {
      const result = await api("/saved-filters");
      setFunnels(result.data.filter((item) => item.type === "funnel"));
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    }
  }

  async function loadMeta() {
    // Marketing campaigns are supplementary. They used to share a Promise.all
    // with /leads/meta, so a failure there (RBAC, outage) rejected the pair and
    // setMeta never ran — leaving lead fields, stages, sources and branches at
    // their empty initial state and rendering an empty "Add new lead" form.
    // Degrade to an empty campaign list instead and keep the form usable.
    const [result, marketingResult] = await Promise.all([
      api("/leads/meta"),
      api("/marketing-campaigns").catch(() => ({ data: [] })),
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
      // includeReferred keeps the leads this user referred to someone else in
      // the result set. Ownership moves with a referral, so without it the
      // "Referred by me" filter below has nothing to match on.
      const pipelineQuery = activePipeline ? `&pipelineId=${activePipeline.id}` : "";
      const result = await api(`/leads?search=${encodeURIComponent(term)}&includeReferred=1${pipelineQuery}`);
      setLeads(result.data);
      setTotalLeads(Number(result.total||0));
      setStageCounts(result.stageCounts||{});
      setFollowupsTillToday(Number(result.followupsTillToday||0));
      setUntouchedAssignedCount(Number(result.untouchedAssignedCount||0));
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
  /*
   * Refetch once the pipeline is known, and again whenever it changes.
   *
   * The first load above runs before /leads/meta has answered, so it cannot
   * know which pipeline is in force; and moving between two pipelines' Leads
   * screens re-renders this component rather than remounting it. Both need
   * the list, the counts and the stage tabs to be fetched again.
   */
  const loadedPipelineRef = useRef(undefined);
  useEffect(() => {
    if (!activePipeline) return;
    if (loadedPipelineRef.current === activePipeline.id) return;
    loadedPipelineRef.current = activePipeline.id;
    setStageFilter("");
    setSelectedIds([]);
    loadLeads(search);
  }, [activePipeline?.id]);
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
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'm') {
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
          /* "yes"/"no" answer the Payment column; the remaining values are the
             Jodo statuses this filter has always offered. */
          (!advancedFilters.paymentStatus.length || advancedFilters.paymentStatus.some(value =>
            value === "yes" ? isPaymentCollected(lead)
              : value === "no" ? !isPaymentCollected(lead)
                : String(lead.paymentStatus || "").toLowerCase() === value)) &&
          (!advancedFilters.studentIdStatus.length || advancedFilters.studentIdStatus.some(value =>
            value === "yes" ? hasStudentId(lead) : !hasStudentId(lead))) &&
          /* The switch is a view, not a filter: on, it shows the shelf and
             nothing else; off, it says nothing about which leads appear. */
          (!parkedOnly || Boolean(lead.parkedAt)) &&
          /* Any of the lead's sources, primary or secondary. */
          (!advancedFilters.sourceId.length || leadSources(lead).some(item => advancedFilters.sourceId.includes(item.id))) &&
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
          (!advancedFilters.leadEntryPath.length || advancedFilters.leadEntryPath.includes(String(lead.leadEntryPath))) &&
          (!advancedFilters.pendingFollowupsOnly || Boolean(lead.pendingFollowupTillToday)) &&
          matchesReferredFilter(lead, advancedFilters.isReferred, currentEmployeeId) &&
          (!advancedFilters.isParent.length || advancedFilters.isParent.some(value => value === "yes" ? Boolean(lead.isParent) : !lead.isParent)) &&
          (!advancedFilters.lookingForAdmission.length || advancedFilters.lookingForAdmission.some(value => value === "yes" ? Boolean(lead.lookingForAdmission) : !lead.lookingForAdmission)) &&
          (!advancedFilters.whatsappResponse.length || advancedFilters.whatsappResponse.includes(String(lead.whatsappResponse))) &&
          containsFilter(lead.studentName, advancedFilters.studentName) &&
          phoneContainsFilter(lead.phone, advancedFilters.primaryPhone) &&
          phoneContainsFilter(lead.alternatePhone, advancedFilters.alternatePhone) &&
          containsFilter(lead.email, advancedFilters.email) &&
          containsFilter(lead.parentName, advancedFilters.parentName) &&
          (!advancedFilters.contactAvailability.length || advancedFilters.contactAvailability.some(value => value === "email" ? Boolean(lead.email) : value === "alternatePhone" ? Boolean(lead.alternatePhone) : Boolean(lead.phone))) &&
          (!advancedFilters.marketingCampaignId.length && !advancedFilters.marketingDeliveryStatus.length ||
            (lead.marketingDeliveries || []).some(delivery =>
              (!advancedFilters.marketingCampaignId.length || advancedFilters.marketingCampaignId.includes(String(delivery.campaignId))) &&
              (!advancedFilters.marketingDeliveryStatus.length || advancedFilters.marketingDeliveryStatus.includes(String(delivery.status)))
            )) &&
          (!advancedFilters.scoreMin || Number(lead.score) >= Number(advancedFilters.scoreMin)) &&
          (!advancedFilters.scoreMax || Number(lead.score) <= Number(advancedFilters.scoreMax)) &&
          matchesDateRange(lead, "addedAt", advancedFilters.addedFrom, advancedFilters.addedTo) &&
          matchesDateRange(lead, "updatedAt", advancedFilters.updatedFrom, advancedFilters.updatedTo) &&
          matchesDateRange(lead, "referredAt", advancedFilters.referredFrom, advancedFilters.referredTo) &&
          matchesDateRange(lead, "nextFollowup", advancedFilters.nextFollowupFrom || advancedFilters.followupFrom, advancedFilters.nextFollowupTo || advancedFilters.followupTo) &&
          matchesDateRange(lead, "reEnquiredAt", advancedFilters.reEnquiredFrom, advancedFilters.reEnquiredTo),
      ),
    [leads, branchFilter, advancedFilters, parkedOnly],
  );
  const parkedCount = useMemo(() => leads.filter(lead => lead.parkedAt).length, [leads]);
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

  const leadExportGroups = useMemo(() => buildLeadExportGroups(meta), [meta]);
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
    add(lead, "Lead added via", advancedFilters.leadEntryPath.map(value => ({manual:"Manually added",bulk_upload:"Bulk upload",google_sheets:"Google Sheets",integration:"Integration (Facebook and others)",website_form:"Website enquiry form"}[value] || value)));
    add(lead, "Payment status", advancedFilters.paymentStatus.map(value => ({yes:"Paid",no:"Not paid",order_created:"Order created",unpaid:"Unpaid",expired:"Expired",failed:"Failed"}[value] || value)));
    add(lead, "Student ID generated", advancedFilters.studentIdStatus.map(value => value === "yes" ? "Generated" : "Not generated"));
    add(lead, "Pending follow-ups", advancedFilters.pendingFollowupsOnly ? "Due through today" : "");
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
    add(communication, "Student name", advancedFilters.studentName);
    add(communication, "Primary phone", advancedFilters.primaryPhone);
    add(communication, "Alternate phone", advancedFilters.alternatePhone);
    add(communication, "Email", advancedFilters.email);
    add(communication, "Parent name", advancedFilters.parentName);
    add(communication, "Looking for admissions", advancedFilters.lookingForAdmission.map(value => value === "yes" ? "Yes" : "No"));
    add(communication, "WhatsApp response", advancedFilters.whatsappResponse);
    add(communication, "Contact availability", advancedFilters.contactAvailability.map(value => value === "email" ? "Has email address" : value === "alternatePhone" ? "Has alternate phone" : "Has phone number"));
    add(marketing, "Bulk campaign", findLabels(advancedFilters.marketingCampaignId, meta.marketingCampaigns || []));
    add(marketing, "Delivery status", advancedFilters.marketingDeliveryStatus);
    [["Added",advancedFilters.addedFrom,advancedFilters.addedTo],["Updated",advancedFilters.updatedFrom,advancedFilters.updatedTo],["Referred",advancedFilters.referredFrom,advancedFilters.referredTo],["Next Follow-up",advancedFilters.nextFollowupFrom || advancedFilters.followupFrom,advancedFilters.nextFollowupTo || advancedFilters.followupTo],["Re-Enquired",advancedFilters.reEnquiredFrom,advancedFilters.reEnquiredTo]].forEach(([label,from,to]) => {
      add(dates, `${label} from`, from);
      add(dates, `${label} to`, to);
    });
    /* Shown like any other applied filter: it hides leads, so leaving it out
       of this panel made a short list look like a missing one. */
    add(ranges, "Referred by me", advancedFilters.isReferred === "yes" ? "Referred away by me"
      : advancedFilters.isReferred === "no" ? "With me, not referred away" : "");
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
  const showAppliedFiltersPanel = hasAppliedFilters && !advancedFilters.pendingFollowupsOnly;
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
    setAdvancedFilters(defaultAdvancedFilters);
    setFollowupDateType("nextFollowup");
    setMessage({ type: "success", text: "Filters cleared — showing all accessible branches" });
  }

  function applyFunnel(funnel) {
    applyAdvancedFilters({ ...defaultAdvancedFilters, ...funnel.filters });
    setMessage({ type: "success", text: `View "${funnel.name}" applied` });
  }

  function selectStage(stage) {
    setStageFilter(stage);
    setAppliedFiltersExpanded(false);
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

  /**
   * Park or unpark one lead.
   *
   * The row updates as soon as the server confirms, without reloading the
   * list: a parked lead stays where it is so the next one is still under the
   * pointer, which is the whole point of setting several aside in a row.
   */
  async function toggleParked(lead) {
    if (parkingIds.includes(lead.id)) return;
    const next = !lead.parkedAt;
    setParkingIds(current => [...current, lead.id]);
    try {
      await api(`/leads/${lead.id}/park`, { method: "POST", body: JSON.stringify({ parked: next }) });
      setLeads(current => current.map(item => (
        item.id === lead.id ? { ...item, parkedAt: next ? new Date().toISOString() : null } : item
      )));
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setParkingIds(current => current.filter(id => id !== lead.id));
    }
  }

  async function exportLeads(fields) {
    const selectedFields = fields?.length ? fields : leadExportGroups.flatMap(group => group.fields).filter(field => field.defaultSelected);
    const header = selectedFields.map(field => field.label);

    /* Comments are not part of the lead list, so they are collected only when
       a field that needs them was ticked -- one request for the whole export
       rather than one per row. A failure here leaves those cells empty rather
       than losing the download the user asked for. */
    let commentsByLead = {};
    if (selectedFields.some(field => field.needsComments) && filtered.length) {
      try {
        const result = await api(`/leads/comments/recent?limit=5&leadIds=${filtered.map(lead => lead.id).join(",")}`);
        commentsByLead = result.data || {};
      } catch (error) {
        setMessage({ type:"error", text:`Comments could not be loaded, so those cells are empty: ${error.message}` });
      }
    }

    const rows = filtered.map(lead => {
      const withComments = { ...lead, recentComments: commentsByLead[lead.id] || [] };
      return selectedFields.map(field => field.get(withComments));
    });
    const csv = [header, ...rows].map(row => row.map(csvCell).join(",")).join("\n");
    const fileName = `crm-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    link.download = fileName;
    link.click(); URL.revokeObjectURL(link.href);
    try {
      await api('/bulk-operations/data-export',{method:'POST',body:JSON.stringify({totalRecords:rows.length,fileName,leadIds:filtered.map(lead=>lead.id)})});
      setMessage({ type:"success", text:`Downloaded ${rows.length} lead${rows.length === 1 ? "" : "s"} with ${header.length} field${header.length === 1 ? "" : "s"}` });
    } catch (error) {
      setMessage({type:'error',text:`Export downloaded, but its audit entry could not be saved: ${error.message}`});
    } finally {
      setDownloadDialogOpen(false);
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

  function openSelectedMarketingCampaign() {
    const selectedVisibleIds = selectedIds.filter(id => filtered.some(lead => lead.id === id));
    if (!selectedVisibleIds.length) {
      setMessage({
        type: "error",
        text: "Select at least one lead for the campaign",
      });
      return;
    }
    setMarketingLeadIds(selectedVisibleIds);
  }

  function openCreate() {
    const storedUser = localStorage.getItem("crm_user");
    const currentUser = storedUser ? JSON.parse(storedUser) : null;
    const defaultAcademicYear = meta.academicYears?.[0]?.academicYear || emptyForm.academicYear;
    const defaults=meta.manualLeadDefaults||{};
    const defaultStageId=meta.stages.some(item=>String(item.id)===String(defaults.stageId))?defaults.stageId:(meta.stages[0]?.id||"");
    const defaultSubstageId=meta.substages.some(item=>String(item.id)===String(defaults.substageId)&&String(item.stageId)===String(defaultStageId))
      ? defaults.substageId
      : (meta.substages.find(item=>String(item.stageId)===String(defaultStageId))?.id||"");
    setForm({
      ...emptyForm,
      academicYear: defaultAcademicYear,
      branchId: meta.branches[0]?.id || "",
      channelId: meta.channels.some(item=>String(item.id)===String(defaults.channelId))?defaults.channelId:"",
      sourceId: meta.sources.some(item=>String(item.id)===String(defaults.sourceId))?defaults.sourceId:"",
      campaignId: meta.campaigns.some(item=>String(item.id)===String(defaults.campaignId))?defaults.campaignId:"",
      stageId: defaultStageId,
      substageId: defaultSubstageId,
      classId: meta.classes[0]?.id || "",
      curriculumId: meta.curricula[0]?.id || "",
      admissionTypeId: meta.admissionTypes[0]?.id || "",
      ownerEmployeeId: currentUser?.employeeId || "",
    });
    setDrawer({ mode: "create", title: "Add new lead" });
    setDrawerTab("student");
    setLeadAudiences(null);
  }

  async function openLead(id, mode, options={}) {
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
      const reEnquiryDefaults=options.reEnquiry?(meta.reEnquiryDefaults||{}):{};
      setSecondarySource({
        academicYear:data.academicYear||"",
        channelId:meta.channels.some(item=>String(item.id)===String(reEnquiryDefaults.channelId))?reEnquiryDefaults.channelId:"",
        sourceId:meta.sources.some(item=>String(item.id)===String(reEnquiryDefaults.sourceId))?reEnquiryDefaults.sourceId:"",
        campaignId:meta.campaigns.some(item=>String(item.id)===String(reEnquiryDefaults.campaignId))?reEnquiryDefaults.campaignId:"",
      });
      setReEnquiryPending(Boolean(options.reEnquiry));
      setDrawer({
        mode,
        id,
        title: mode === "view" ? data.studentName : `Edit ${data.studentName}`,
        activities: data.activities || [],
      });
      setDrawerTab(options.tab||"student");
    setLeadAudiences(null);
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    }
  }

  async function openLeadHistory(){
    setDrawerTab("history");
    if(!drawer?.id)return;
    try{
      await api(`/smartflo/leads/${drawer.id}/sync`,{method:"POST",body:"{}"});
      const {data}=await api(`/leads/${drawer.id}`);
      setDrawer(current=>current&&current.id===drawer.id?{...current,activities:data.activities||[]}:current);
    }catch(error){
      // History already stored in CRM remains usable if Smartflo is temporarily
      // unavailable; surface the reconciliation failure without hiding it.
      setMessage({type:"error",text:`Could not refresh Smartflo call history: ${error.message}`});
    }
  }

  async function openFollowup(lead,callContext=null) {
    setOpenActionId(null);
    try {
      const [{ data },options] = await Promise.all([api(`/leads/${lead.id}`),api('/leads/referral-options/all')]);
      setReferralOptions(options);
      const defaultBranchId=String(data.referredToBranchId||data.branchId||"");
      const selfOption=options.employees.find(employee=>String(employee.id)===String(options.currentEmployeeId)&&String(employee.branchId)===defaultBranchId);
      const currentOwnerOption=options.employees.find(employee=>String(employee.id)===String(data.ownerEmployeeId)&&String(employee.branchId)===defaultBranchId);
      const defaultOption=selfOption||currentOwnerOption;
      const callAttempt=Boolean(callContext?.isCallAttempt);
      setFollowupForm({stageId:callAttempt?"":String(data.stageId||""),substageId:callAttempt?"":String(data.substageId||""),comment:"",comments:data.comments||[],nextFollowupAt:callAttempt?"":toLocalInput(data.nextFollowupAt),followupType:callAttempt?"":data.followupType||"",referralBranchId:defaultBranchId,referralEmployeeId:defaultOption?String(defaultOption.id):"",callActivityId:callContext?.callActivityId||null,callAttempt,callDisposition:""});
      const currentStage=meta.stages.find(stage=>String(stage.id)===String(data.stageId));
      setFollowupModal({id:lead.id,name:lead.studentName,callActivityId:callContext?.callActivityId||null,callAttempt,pipelineId:currentStage?.pipelineId||null});
    } catch (error) { setMessage({type:"error",text:error.message}); }
  }

  /*
   * History is a tab of the lead dialog, not a dialog of its own.
   *
   * Both were built on the same GET /leads/:id payload and showed the same
   * lead -- one its details, the other what had happened to it -- so opening
   * one to answer a question about the other meant closing it first. The
   * icon on the row still goes straight to the history, it just arrives
   * inside the dialog that already holds everything else.
   */
  async function openHistory(lead){
    setOpenActionId(null);
    await openLead(lead.id, "view");
    setDrawerTab("history");
  }

  async function saveFollowup(event) {
    event.preventDefault(); setSaving(true);
    try {
      const result=await api(`/leads/${followupModal.id}/followup-notes`,{method:"PUT",body:JSON.stringify({...followupForm,stageId:Number(followupForm.stageId),substageId:followupForm.substageId?Number(followupForm.substageId):null,referralBranchId:Number(followupForm.referralBranchId),referralEmployeeId:Number(followupForm.referralEmployeeId),nextFollowupAt:followupForm.nextFollowupAt?`${followupForm.nextFollowupAt}:00`:null})});
      if(activeCall&&String(activeCall.leadId)===String(followupModal.id))setActiveCall(null);
      setFollowupModal(null); setMessage({type:"success",text:result.message}); await loadLeads();
    } catch(error) { setMessage({type:"error",text:error.message}); }
    finally { setSaving(false); }
  }

  async function hangupActiveCall(){
    if(!activeCall?.callActivityId||!window.confirm(`End the Smartflo call with ${activeCall.leadName}?`))return;
    try{
      await api(`/smartflo/calls/${activeCall.callActivityId}/hangup`,{method:'POST',body:'{}'});
      setActiveCall(current=>current?{...current,status:{...current.status,status:'Hangup requested'}}:current);
    }catch(error){setMessage({type:'error',text:error.message});}
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
      const result=await api(`/leads/${drawer.id}/sources`,{method:"POST",body:JSON.stringify({academicYear:form.academicYear,...secondarySource,sourceId:Number(secondarySource.sourceId),channelId:Number(secondarySource.channelId),campaignId:Number(secondarySource.campaignId),markReEnquired:reEnquiryPending})});
      const {data}=await api(`/leads/${drawer.id}`);
      /* reEnquiredAt too: the re-enquiry mark is what the pending banner and
         the Re-enquired tab read, and it was just written by this save. */
      setForm(current=>({...current,sourceHistory:data.sourceHistory||[],reEnquiredAt:data.reEnquiredAt}));
      setSecondarySource({sourceId:"",channelId:"",campaignId:""});
      setReEnquiryPending(false);
      setMessage({type:"success",text:result.message});await loadLeads();
    }catch(error){setMessage({type:"error",text:error.message})}finally{setSaving(false)}
  }

  /*
   * Delete every selected lead.
   *
   * A soft delete: the rows leave the screen and stay in the database, with
   * who deleted them and when, so a mistake is recoverable and reporting on
   * past enquiries is not rewritten. Sent as a DELETE, which is what makes the
   * business unit's deletion password apply -- the same challenge as removing
   * one lead.
   */
  async function removeSelectedLeads() {
    setOpenActionId(null);
    const count = selectedIds.length;
    if (!count) return;
    if (!window.confirm(`Delete ${count} selected lead${count === 1 ? '' : 's'}? They are removed from this screen and kept in the database for reference, recorded against your name.`)) return;
    try {
      const result = await api('/leads/actions/bulk-delete', { method: 'DELETE', body: JSON.stringify({ leadIds: selectedIds }) });
      setSelectedIds([]);
      setMessage({ type: 'success', text: result.message });
      await loadLeads();
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    }
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
      setReferPipelineId("");
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
      setReferPipelineId("");
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
      const pipelineId = referPipelineId ? Number(referPipelineId) : undefined;
      const result = referLead.bulk
        ? await api('/leads/actions/bulk-refer',{method:"PUT",body:JSON.stringify({leadIds:referLead.ids,branchId:Number(referBranchId),employeeId:Number(referEmployeeId),pipelineId})})
        : await api(`/leads/${referLead.id}/refer`, { method: "PUT", body: JSON.stringify({ branchId: Number(referBranchId), employeeId: Number(referEmployeeId), pipelineId }) });
      setMessage({ type: "success", text: result.message });
      setReferLead(null);
      setReferBranchId("");
      setReferEmployeeId("");
      setReferPipelineId("");
      await loadLeads();
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setSaving(false);
    }
  }

  // These used to sit behind the expand arrow on the filter row; they now hang
  // off the topbar's lightning button instead. Same handlers, same enable
  // rules -- only the surface that launches them moved.
  //
  // Publishing nothing while the campaign builder is up keeps the button in
  // step with the old toolbar, which that view replaced outright.
  /*
   * The lightning menu is the bulk toolbar: every tile acts on the selected
   * or filtered leads, not on one record. So each tile needs the Bulk Actions
   * permission for its verb as well as the underlying capability -- revoking
   * Bulk Actions has to remove Change Stage, WhatsApp and Export, not just
   * Bulk Upload. `permissions` is an AND: all of them must be held.
   *
   * The API enforces the same keys, so a hidden tile is not the control.
   */
  useRegisterLeadQuickActions(marketingLeadIds ? [] : [
    { key: "bulk-upload", label: "Bulk Upload", icon: Upload,
      permissions: ["bulk_actions.toolbar.view", "bulk_actions.upload.import"],
      title: "Bulk Lead Upload",
      onSelect: () => setBulkUploadOpen(true) },
    { key: "stage", label: "Change Stage", icon: GitBranch,
      permissions: ["bulk_actions.toolbar.view", "bulk_actions.change_stage.edit"],
      title: `Change stage for ${selectedIds.length || "selected"} leads`,
      disabled: !selectedIds.length, onSelect: openBulkStageChange },
    { key: "refer", label: "Refer", icon: UserRoundPlus,
      permissions: ["bulk_actions.toolbar.view", "bulk_actions.refer.assign"],
      title: `Refer ${selectedIds.length || "selected"} leads`,
      disabled: !selectedIds.length, onSelect: openBulkRefer },
    { key: "campaign", label: "Campaign", icon: Megaphone,
      permissions: ["bulk_actions.toolbar.view", "bulk_actions.campaign.create"],
      title: `Add marketing campaign for ${selectedIds.length || "selected"} leads`,
      disabled: !selectedIds.length, onSelect: openSelectedMarketingCampaign },
    { key: "whatsapp", label: "WhatsApp", icon: MessageCircle,
      permissions: ["bulk_actions.toolbar.view", "bulk_actions.whatsapp.create"],
      title: `Send WhatsApp to ${selectedIds.length || "selected"} leads in this view`,
      disabled: !selectedIds.length, onSelect: openSelectedMessages },
    { key: "sms", label: "SMS", icon: MessageSquare,
      permissions: ["bulk_actions.toolbar.view", "bulk_actions.sms.create"],
      title: `Send SMS to ${selectedIds.length || "selected"} leads`,
      disabled: !selectedIds.length, onSelect: () => setBulkChannel("sms") },
    { key: "email", label: "Email", icon: Mail,
      permissions: ["bulk_actions.toolbar.view", "bulk_actions.email.create"],
      title: `Send email to ${selectedIds.length || "selected"} leads`,
      disabled: !selectedIds.length, onSelect: () => setBulkChannel("email") },
    { key: "export", label: "Export", icon: Download,
      permissions: ["bulk_actions.toolbar.view", "bulk_actions.export.export"],
      title: "Export visible leads",
      onSelect: () => setDownloadDialogOpen(true) },
    /* Last in the menu, and its own permission: deleting leads is not the
       same authority as changing their stage. */
    { key: "delete", label: "Delete", icon: Trash2,
      permissions: ["bulk_actions.toolbar.view", "bulk_actions.delete.delete"],
      title: `Delete ${selectedIds.length || "selected"} leads`,
      disabled: !selectedIds.length, onSelect: removeSelectedLeads },
  ].filter((action) => action.permissions.every((key) => can(key))));

  /*
   * Every column the table can show, and the nine it shows by default.
   *
   * The built-ins render composite cells -- a student with their avatar and
   * phone, a source with its extra-source badge and re-enquire button -- so
   * they are written out rather than derived. Everything after them is the
   * field catalogue the export already builds: every system field, plus the
   * lead fields configured for this business unit, each rendered as plain
   * text through its export getter.
   */
  const coreLeadColumns = [
    { id:"core:student", label:"Student", render:lead => (
      <div className="student">
        <button type="button" className={`avatar muted lead-view-avatar ${lead.touchStatus||"unassigned"}`} title={`${lead.studentName}${lead.touchStatus!=="unassigned"?` \u00b7 ${lead.touchStatus}`:""}`} aria-label={`View ${lead.studentName}${lead.touchStatus!=="unassigned"?`, ${lead.touchStatus}`:""}`} onClick={()=>openLead(lead.id,"view")}>
          {lead.studentName
            .split(" ")
            .map((name) => name[0])
            .slice(0, 2)
            .join("")}
        </button>
        <span>
          <span className="lead-name-line">
            <strong className="lead-view-name">{lead.studentName}</strong>
          </span>
          <small>{lead.phone}</small>
        </span>
      </div>
    ) },
    { id:"core:academic", label:"Class", render:lead => <div className="lead-academic"><strong>{[lead.curriculum,lead.applyingClass].filter(Boolean).join(" - ") || "\u2014"}</strong><small>{lead.branch || "\u2014"}</small></div> },
    { id:"core:source", label:"Source", render:lead => <div className="lead-source">
      <span className="lead-source-line">
        <span>{leadSources(lead)[0]?.name || lead.source || "\u2014"}</span>
        {/* Without this, a lead matched on a secondary source
            looks like it should not be in the results. */}
        {secondarySources(lead).length > 0 && (
          <em className="lead-source-more" title={`Also from: ${secondarySources(lead).map(item=>item.name).join(", ")}`}>
            +{secondarySources(lead).length}
          </em>
        )}
        <button type="button" className="source-reenquire-button" title={`Re-enquire ${lead.studentName}`} aria-label={`Re-enquire ${lead.studentName} from source details`} onClick={()=>openLead(lead.id,"edit",{tab:"source",reEnquiry:true})}><RotateCcw size={14}/></button>
      </span>
      <small>{lead.addedAt?new Date(lead.addedAt).toLocaleString("en-IN",{timeZone:"Asia/Kolkata",dateStyle:"medium",timeStyle:"short"}):"\u2014"}</small>
    </div> },
    { id:"core:stage", label:"Stage", render:lead => (
      <span className={`stage ${String(lead.stage).toLowerCase().replaceAll(" ", "-")}`}>
        {lead.stage}
      </span>
    ) },
    /* Yes only once the money is actually collected; an order that was
       created and never paid is still No. */
    { id:"core:payment", label:"Payment", render:lead => <>
      <span className={`lead-flag ${isPaymentCollected(lead) ? "is-yes" : "is-no"}`}>{isPaymentCollected(lead) ? "Yes" : "No"}</span>
      {isPaymentCollected(lead) && Number(lead.paymentAmount) > 0 && <small className="lead-flag-note">₹{Number(lead.paymentAmount).toLocaleString("en-IN")}</small>}
    </> },
    { id:"core:studentId", label:"Student ID", render:lead => <>
      <span className={`lead-flag ${hasStudentId(lead) ? "is-yes" : "is-no"}`}>{hasStudentId(lead) ? "Yes" : "No"}</span>
      {hasStudentId(lead) && <small className="lead-flag-note">{lead.studentId}</small>}
    </> },
    { id:"core:owner", label:"Owner", render:lead => lead.owner },
    { id:"core:nextFollowup", label:"Next follow-up", render:lead => lead.nextFollowup
      ? new Date(lead.nextFollowup).toLocaleString("en-IN", { timeZone:"Asia/Kolkata", dateStyle:"medium", timeStyle:"short" })
      : "Not scheduled" },
    { id:"core:recentModified", label:"Recent modified", render:lead => lead.recentModified ? new Date(lead.recentModified).toLocaleString("en-IN", {timeZone:"Asia/Kolkata",dateStyle:"medium",timeStyle:"short"}) : "\u2014" },
  ];
  /* Recent comments are fetched per row by the exporter, so that one field
     has nothing to show here and is left out. */
  const catalogueLeadColumns = leadExportGroups.flatMap(group => group.fields
    .filter(field => !field.needsComments && !LEAD_COLUMN_DUPLICATE_FIELD_IDS.has(field.id))
    .map(field => ({ id:`field:${field.id}`, label:field.label, group:group.name, render:lead => leadCellText(field.get(lead)) })));
  const leadColumnCatalogue = [...coreLeadColumns, ...catalogueLeadColumns];
  const leadColumnGroups = [
    { name:"Leads table", fields:coreLeadColumns.map(({ id, label }) => ({ id, label, defaultSelected:true })) },
    ...leadExportGroups
      .map(group => ({ name:group.name, fields:catalogueLeadColumns.filter(column => column.group === group.name).map(({ id, label }) => ({ id, label })) }))
      .filter(group => group.fields.length),
  ];
  /*
   * The stored list is walked in order, because that order is the column
   * order the counsellor arranged by dragging the headers -- reading the
   * catalogue instead would keep snapping the table back to its own order.
   *
   * Ids that no longer exist -- a deleted lead field, or a choice made in
   * another business unit -- drop out here, and a selection left with nothing
   * in it falls back to the default nine rather than a headless table.
   */
  const leadColumnsById = new Map(leadColumnCatalogue.map(column => [column.id, column]));
  const selectedLeadColumns = visibleColumnIds.map(id => leadColumnsById.get(id)).filter(Boolean);
  const leadColumns = selectedLeadColumns.length ? selectedLeadColumns : coreLeadColumns;

  function storeLeadColumns(ids) {
    setVisibleColumnIds(ids);
    writeStoredLeadColumns(routePipelineId, ids);
    saveLeadColumns(ids);
  }

  /*
   * Put the arrangement on the account.
   *
   * The default arrangement is stored as nothing at all: keeping a row that
   * spells out today's nine columns would freeze them onto the user, so a
   * later change to what the screen ships with would never reach anyone who
   * had once pressed Reset.
   *
   * Failing to save is worth saying, because the columns are already on
   * screen and would otherwise come back rearranged on the next device.
   */
  async function saveLeadColumns(ids) {
    try {
      await api.put("/leads/column-preferences", { pipelineId: routePipelineId || null, columns: isDefaultLeadColumns(ids) ? [] : ids });
    } catch (error) {
      setMessage({ type: "error", text: `Columns changed here, but could not be saved to your account: ${error.message}` });
    }
  }

  /* Ticking a column in the dialog must not rearrange the ones already
     placed: the arranged order is kept and anything newly ticked joins the
     end, where it is easy to find and drag from. */
  function applyLeadColumns(fields) {
    const chosen = fields.map(field => field.id);
    const chosenIds = new Set(chosen);
    storeLeadColumns([
      ...leadColumns.map(column => column.id).filter(id => chosenIds.has(id)),
      ...chosen.filter(id => !leadColumns.some(column => column.id === id)),
    ]);
    setColumnDialogOpen(false);
  }

  /* Dropping a column onto another puts it where that one was: dragging right
     lands after the target, dragging left lands before it, which is what the
     gap under the cursor looks like in both directions. */
  function moveLeadColumn(sourceId, targetId) {
    if (!sourceId || sourceId === targetId) return;
    const ids = leadColumns.map(column => column.id);
    const from = ids.indexOf(sourceId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1);
    ids.splice(from < to ? ids.indexOf(targetId) + 1 : ids.indexOf(targetId), 0, sourceId);
    storeLeadColumns(ids);
  }

  /* The keyboard route to the same thing, for anyone who cannot drag. */
  function shiftLeadColumn(columnId, direction) {
    const ids = leadColumns.map(column => column.id);
    const from = ids.indexOf(columnId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= ids.length) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    storeLeadColumns(ids);
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
    <main className={`page leads-page ${showAppliedFiltersPanel ? (appliedFiltersExpanded ? "applied-filters-open" : "applied-filters-collapsed") : ""}`}>
      <section className="lead-command-center">
        <div className="funnel-callout">
          <FunnelStrip funnels={funnels} onApply={applyFunnel} onDelete={deleteFunnel} onCreate={createFunnel} onAddLead={openCreate} onClearFilters={clearLeadFilters} onOpenFilters={() => setFilterPanel("filter")} parkedOnly={parkedOnly} onToggleParked={() => setParkedOnly(current => !current)} parkedCount={parkedCount}/>
        </div>
        <div className={`stage-tabs-shell ${stageTabScroll.overflow ? "has-overflow" : ""}`}>
          <button type="button" className="stage-scroll-button previous" aria-label="Show previous lead stages" disabled={!stageTabScroll.left} onClick={() => moveStageTabs(-1)}><ChevronLeft size={15}/></button>
          <div className="stage-tabs" role="tablist" ref={stageTabsRef}>
            <button className={`stage-tab ${!stageFilter ? "active" : ""}`} onClick={() => selectStage("")}><span className="stage-name">All</span> <span className="stage-count">{leadsMatchingActiveFilters.length}</span></button>
            {meta.stages.map(stage => <button key={stage.id} className={`stage-tab ${stageFilter === stage.displayName ? "active" : ""}`} onClick={() => selectStage(stage.displayName)}><span className="stage-name">{stage.displayName}</span> <span className="stage-count">{filteredStageCounts[stage.displayName] || 0}</span></button>)}
            <button className={`stage-tab ${stageFilter === "Re-enquired" ? "active" : ""}`} onClick={() => selectStage("Re-enquired")}><span className="stage-name">Re-enquired</span> <span className="stage-count">{filteredStageCounts["Re-enquired"] || 0}</span></button>
          </div>
          <button type="button" className="stage-scroll-button next" aria-label="Show more lead stages" disabled={!stageTabScroll.right} onClick={() => moveStageTabs(1)}><ChevronRight size={15}/></button>
        </div>
        <div className="lead-control-row">
          <div className="inline-lead-filter"><span>Branch</span><MultiSearchSelect label="Branch" value={branchFilter} onChange={setBranchFilter} options={[{value:"",label:"All branches"},...meta.branches.map(branch=>({value:String(branch.id),label:branch.name}))]}/></div>
          <div className="inline-lead-filter touch-status-filter"><span>Touch status</span><div className="touch-status-control"><MultiSearchSelect label="Touch status" value={advancedFilters.touchStatus} onChange={value=>setAdvancedFilters(current=>({...current,touchStatus:value}))} options={[{value:"",label:"Any touch status"},{value:"touched",label:"Is touched"},{value:"untouched",label:"Untouched"}]}/><span className={`touch-status-count-badge ${untouchedAssignedCount>0?"has-untouched":""}`} title={`${untouchedAssignedCount} untouched leads assigned to you`}>{untouchedAssignedCount>99?"99+":untouchedAssignedCount}</span></div></div>
          <div className="inline-lead-filter"><span>Sub-stage</span><MultiSearchSelect label="Sub-stage" value={advancedFilters.substageId} onChange={value=>setAdvancedFilters(current=>({...current,substageId:value}))} options={[{value:"",label:"All sub-stages"},...meta.substages.filter(item=>!stageFilter||String(item.stageId)===String(meta.stages.find(stage=>stage.displayName===stageFilter)?.id)).map(item=>({value:String(item.id),label:item.displayName}))]}/></div>
          <div className="inline-lead-filter"><span>Source</span><MultiSearchSelect label="Source" value={advancedFilters.sourceId} onChange={value=>setAdvancedFilters(current=>({...current,sourceId:value}))} options={[{value:"",label:"All sources"},...meta.sources.map(item=>({value:String(item.id),label:item.displayName}))]}/></div>
          <div className="inline-lead-filter"><span>Student ID</span><MultiSearchSelect label="Student ID" value={advancedFilters.studentIdStatus} onChange={value=>setAdvancedFilters(current=>({...current,studentIdStatus:value}))} options={[{value:"",label:"All leads"},{value:"yes",label:"Generated"},{value:"no",label:"Not generated"}]}/></div>
          <label className={`pending-followups-check ${advancedFilters.pendingFollowupsOnly?"active":""}`} data-tooltip="Show pending follow-ups due from the beginning through today">
            <input type="checkbox" checked={Boolean(advancedFilters.pendingFollowupsOnly)} onChange={event=>setAdvancedFilters(current=>({...current,pendingFollowupsOnly:event.target.checked}))}/>
            <span className="sr-only">Pending follow-ups due through today</span>
            <span className={`followup-due-badge ${followupsTillToday>0?"has-due":""}`} aria-hidden="true">{followupsTillToday>99?"99+":followupsTillToday}</span>
          </label>
          <FollowupDateFilter
            from={advancedFilters[dateFilterFromKey]}
            to={advancedFilters[dateFilterToKey]}
            dateType={followupDateType}
            onDateTypeChange={changeDateFilterType}
            onChange={(rangeFrom,rangeTo)=>setAdvancedFilters(current=>withDateRange(current,followupDateType,rangeFrom,rangeTo))}
          />
          {/* Which columns the table shows sits with the filters rather than
              over the table: both decide what the counsellor is looking at,
              and the table keeps its full height for rows. */}
          <button type="button" className="secondary columns-picker-trigger" title="Choose which columns this table shows" onClick={() => setColumnDialogOpen(true)}>
            <Columns3 size={15}/> Columns <b>{leadColumns.length}</b>
          </button>
        </div>
      </section>
      {downloadDialogOpen && <DownloadFieldsDialog title="Download Data" groups={leadExportGroups} onClose={() => setDownloadDialogOpen(false)} onDownload={exportLeads}/>}
      {columnDialogOpen && <DownloadFieldsDialog
        title="Table columns"
        headerIcon={<Columns3 size={18}/>}
        actionIcon={<Columns3 size={15}/>}
        actionLabel="Apply columns"
        note="Choose the columns shown on the leads screen. Every system field and every lead field configured for this business unit is listed."
        groups={leadColumnGroups}
        defaultSelected={DEFAULT_LEAD_COLUMN_IDS}
        selectedIds={leadColumns.map(column => column.id)}
        onClose={() => setColumnDialogOpen(false)}
        onDownload={applyLeadColumns}
      />}
      {bulkUploadOpen && <BulkUploadModal onClose={() => setBulkUploadOpen(false)}/>}
      {bulkChannel && (
        <BulkMessageSend
          channel={bulkChannel}
          leads={leads.filter(lead => selectedIds.includes(lead.id))}
          onClose={() => setBulkChannel(null)}
          onMessage={next => next && setMessage({ type: next.type, text: next.text })}
        />
      )}
      <Toast message={message} onClose={() => setMessage(null)} />
      <article className="panel leads-panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th><input type="checkbox" aria-label="Select all visible leads" checked={filtered.length > 0 && filtered.every(lead => selectedIds.includes(lead.id))} onChange={event => setSelectedIds(event.target.checked ? filtered.map(lead => lead.id) : [])}/></th>
                <th className="park-col"><span className="sr-only">Parked</span></th>
                {leadColumns.map(column => (
                  <th
                    key={column.id}
                    className={`lead-column-head${draggedColumnId===column.id?" is-dragging":""}${dropColumnId===column.id?" is-drop-target":""}`}
                    draggable
                    onDragStart={event => { setDraggedColumnId(column.id); event.dataTransfer.effectAllowed="move"; event.dataTransfer.setData("text/plain", column.id); }}
                    onDragOver={event => { if (!draggedColumnId || draggedColumnId===column.id) return; event.preventDefault(); event.dataTransfer.dropEffect="move"; setDropColumnId(column.id); }}
                    onDragLeave={() => setDropColumnId(current => current===column.id ? null : current)}
                    onDrop={event => { event.preventDefault(); moveLeadColumn(draggedColumnId || event.dataTransfer.getData("text/plain"), column.id); setDraggedColumnId(null); setDropColumnId(null); }}
                    onDragEnd={() => { setDraggedColumnId(null); setDropColumnId(null); }}
                  >
                    <span
                      className="lead-column-head-inner"
                      tabIndex={0}
                      role="button"
                      title={`${column.label} \u00b7 drag to reorder, or hold Alt and press the left and right arrow keys`}
                      aria-label={`${column.label} column, position ${leadColumns.indexOf(column)+1} of ${leadColumns.length}. Drag to reorder, or hold Alt and press the left and right arrow keys.`}
                      onKeyDown={event => {
                        if (!event.altKey || (event.key!=="ArrowLeft" && event.key!=="ArrowRight")) return;
                        event.preventDefault();
                        shiftLeadColumn(column.id, event.key==="ArrowLeft" ? -1 : 1);
                      }}
                    ><GripVertical size={11} aria-hidden="true"/>{column.label}</span>
                  </th>
                ))}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginatedLeads.map((lead) => (
                <tr key={lead.id}>
                  <td><input type="checkbox" aria-label={`Select ${lead.studentName}`} checked={selectedIds.includes(lead.id)} onChange={event => setSelectedIds(current => event.target.checked ? [...new Set([...current, lead.id])] : current.filter(id => id !== lead.id))}/></td>
                  {/* Distinct from the selection box beside it on purpose: a
                      tick selects a row for a bulk action and is forgotten on
                      reload, a filled pin is stored on the lead. */}
                  <td className="park-col">
                    <button
                      type="button"
                      className={lead.parkedAt ? "park-toggle is-parked" : "park-toggle"}
                      aria-pressed={Boolean(lead.parkedAt)}
                      disabled={parkingIds.includes(lead.id)}
                      title={lead.parkedAt ? `Parked · click to remove ${lead.studentName} from the parked list` : `Park ${lead.studentName} to follow up later`}
                      aria-label={lead.parkedAt ? `Remove ${lead.studentName} from the parked list` : `Park ${lead.studentName}`}
                      onClick={() => toggleParked(lead)}
                    >
                      {lead.parkedAt ? <BookmarkCheck size={17} /> : <Bookmark size={17} />}
                    </button>
                  </td>
                  {leadColumns.map(column => <td key={column.id}>{column.render(lead)}</td>)}
                  <td>
                    <div className="row-action-group">
                    <button className="row-followup-trigger" title="Call with connected telephony provider" aria-label={`Call ${lead.studentName}`} onClick={()=>callLead(lead)}><PhoneCall size={17}/></button>
                    <button className={`row-followup-trigger ${whatsAppConversations.some(item=>cleanPhone(item.mobile)===cleanPhone(lead.phone)&&Number(item.unread_count)>0)?"has-unread":""}`} title="Send WhatsApp message" aria-label={`Send WhatsApp message to ${lead.studentName}`} onClick={()=>openLeadMessage(lead)}><MessageCircle size={17}/>{(()=>{const count=whatsAppConversations.filter(item=>cleanPhone(item.mobile)===cleanPhone(lead.phone)).reduce((sum,item)=>sum+Number(item.unread_count||0),0);return count>0?<span className="lead-message-unread">{count>99?"99+":count}</span>:null})()}</button>
                    {can('email.messages.create')&&<button className="row-followup-trigger" title="Send email" aria-label={`Send email to ${lead.studentName}`} onClick={()=>setEmailLead(lead)}><Mail size={17}/></button>}
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
      {showAppliedFiltersPanel && (
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
              <button className="secondary" onClick={clearLeadFilters}><RotateCcw size={15}/>Reset</button>
              <button className="primary" onClick={() => setFilterPanel("filter")}><Pencil size={15}/>Edit filters</button>
            </footer>
          </>}
        </aside>
      )}
      {filterPanel && (
        <FilterWorkspace
          mode={filterPanel}
          meta={meta}
          initialFilters={{ ...advancedFilters, branchId: branchFilter, stage: stageFilter, dateType: followupDateType }}
          onApply={applyAdvancedFilters}
          onClose={() => setFilterPanel(null)}
          onSaved={({ name, type }) => {
            if (type === "funnel") {
              localStorage.setItem(savedFunnelKey(), name);
              setSavedFunnel(name);
              loadFunnels();
            }
            setMessage({ type: "success", text: `${type === "funnel" ? "View" : "Filter"} saved` });
          }}
        />
      )}
      {callProviderChoice&&<><div className="drawer-backdrop" onClick={()=>setCallProviderChoice(null)}/><section className="refer-dialog" role="dialog" aria-modal="true" aria-labelledby="call-provider-title">
        <div className="refer-dialog-head"><div><span className="eyebrow">Calling route</span><h2 id="call-provider-title">Select calling integration</h2><p>{callProviderChoice.lead.studentName} · {callProviderChoice.lead.phone}</p></div><button className="icon-btn" onClick={()=>setCallProviderChoice(null)}><X/></button></div>
        <div className="grid gap-3 p-5">{callProviderChoice.providers.map(provider=><button type="button" key={provider.key} className="secondary !justify-start !p-4 text-left" onClick={()=>startLeadCall(callProviderChoice.lead,provider)}><PhoneCall size={18}/><span><strong className="block">{provider.label}</strong>{provider.key==='smartflo'&&<small className="block text-secondary-500">{provider.callingMode==='CUSTOMER_FIRST'?'Customer First – Click to Call Support':'Agent First – Standard Click to Call'}</small>}</span></button>)}</div>
        <div className="refer-dialog-actions"><button type="button" className="secondary" onClick={()=>setCallProviderChoice(null)}>Cancel</button></div>
      </section></>}
      {referLead&&<><div className="drawer-backdrop" onClick={()=>setReferLead(null)}/><section className="refer-dialog" role="dialog" aria-modal="true" aria-labelledby="refer-title">
        <div className="refer-dialog-head"><div><span className="eyebrow">{referLead.bulk?"Bulk lead referral":"Lead referral"}</span><h2 id="refer-title">Refer {referLead.studentName}</h2><p>{referLead.bulk?`${referLead.leadId} will be reassigned.`:`${referLead.leadId} · ${referLead.branch}`}</p></div><button className="icon-btn" onClick={()=>setReferLead(null)}><X/></button></div>
        <form onSubmit={submitReferral}>
          {/* Pipeline first, and only when there is a choice to make: a unit
              running one pipeline has nothing to ask about, and the referral
              behaves exactly as it did before. */}
          {(referralOptions.pipelines||[]).length>1&&<label className="refer-pipeline">
            Pipeline
            <select value={referPipelineId} onChange={event=>setReferPipelineId(event.target.value)}>
              <option value="">Keep the current pipeline</option>
              {referralOptions.pipelines.map(pipeline=>(
                <option key={pipeline.id} value={pipeline.id}>{pipeline.displayName}{pipeline.isDefault?' (default)':''}</option>
              ))}
            </select>
          </label>}
          <SearchSuggestion label="Counsellor" required options={referralChoices(referralOptions.employees)} value={referralKey(referBranchId,referEmployeeId)} onChange={(key)=>{const {branchId,employeeId}=splitReferralKey(key);setReferBranchId(branchId);setReferEmployeeId(employeeId);}} placeholder="Search by counsellor or branch…"/>
          <small>
            Only users with active CRM access to this business unit are listed, and referring transfers the lead to that user's branch.
            {referPipelineId
              ? ` The ${referLead.bulk?'leads':'lead'} will also move to the first stage of ${referralOptions.pipelines.find(item=>String(item.id)===String(referPipelineId))?.displayName||'the chosen pipeline'}.`
              : ''}
          </small>
          <div className="refer-dialog-actions"><button type="button" className="secondary" onClick={()=>setReferLead(null)}>Cancel</button><button className="primary" disabled={saving||!referBranchId||!referEmployeeId}>{saving?"Referring…":referLead.bulk?`Refer ${referLead.ids.length} leads`:"Refer lead"}</button></div>
        </form>
      </section></>}
      {followupModal&&<><div className="drawer-backdrop" onClick={()=>setFollowupModal(null)}/><section className="followup-notes-dialog" role="dialog" aria-modal="true" aria-labelledby="followup-notes-title">
        <header><div><span className="eyebrow">Lead activity</span><h2 id="followup-notes-title">Follow-up and notes</h2><p>{followupModal.name}</p>{activeCall&&String(activeCall.leadId)===String(followupModal.id)&&<p className="mt-1 inline-flex items-center gap-1.5 font-semibold text-emerald-700"><Clock3 size={14}/> {activeCall.status?.isTerminal?'Call duration':'Call timer'} {activeCallTime} <small className="font-normal text-secondary-500">{activeCall.status?.isTerminal?'ended':'since dial request'}</small></p>}</div><div className="followup-header-actions"><button type="submit" form="followup-notes-form" className="primary" disabled={saving}>{saving?"Saving…":"Save follow-up"}</button><button type="button" className="icon-btn" aria-label="Close follow-up and notes" onClick={()=>setFollowupModal(null)}><X/></button></div></header>
        <form id="followup-notes-form" onSubmit={saveFollowup}><div className="form-grid">
          {followupModal.callAttempt&&<div className="wide rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <strong>{activeCall?.provider||'Call'} · {activeCall?.callingModeLabel||''}{activeCall?.callingModeLabel?' · ':''}{activeCall?.status?.live?.state||activeCall?.status?.status||'Initiated'}</strong>
              <div className="flex items-center gap-3"><span className="font-semibold text-emerald-700">{activeCallTime}</span>{activeCall?.providerKey==='smartflo'&&activeCall.callActivityId&&activeCall.status?.isLive&&!activeCall.status?.isTerminal&&<button type="button" className="secondary !px-3 !py-2" onClick={hangupActiveCall}>Hang up</button>}</div>
            </div>
            {activeCall?.statusError&&<p className="mt-1 text-sm text-red-700">{activeCall.statusError}</p>}
            {activeCall?.status?.live&&<p className="mt-1 text-sm text-secondary-600">{[activeCall.status.live.agentName,activeCall.status.live.queueState,activeCall.status.live.callTime].filter(Boolean).join(' · ')}</p>}
            {activeCall?.status?.hangup?.description&&<p className="mt-1 text-sm text-secondary-700">Hang-up: {activeCall.status.hangup.description}{activeCall.status.hangup.code!=null?` (Q.850 ${activeCall.status.hangup.code}${activeCall.status.hangup.key?` · ${activeCall.status.hangup.key}`:''})`:''}</p>}
            {activeCall?.status?.recordingUrl&&<audio className="mt-2 h-9 w-full max-w-md" controls preload="metadata" src={activeCall.status.recordingUrl}>Your browser cannot play this recording.</audio>}
          </div>}
          {followupModal.callAttempt&&<label className="wide">New comment *<textarea required rows="4" placeholder="Write a new comment…" value={followupForm.comment} onChange={e=>setFollowupForm({...followupForm,comment:e.target.value})}/></label>}
          {followupModal.callAttempt&&<SearchSuggestion label="Disposition" required options={meta.substages.filter(item=>{const parent=meta.stages.find(stage=>String(stage.id)===String(item.stageId));return !followupModal.pipelineId||String(parent?.pipelineId)===String(followupModal.pipelineId);}).map(item=>{const parent=meta.stages.find(stage=>String(stage.id)===String(item.stageId));return {id:item.id,label:`${item.displayName}${parent?` — ${parent.displayName}`:''}`};})} value={followupForm.substageId} onChange={substageId=>{const substage=meta.substages.find(item=>String(item.id)===String(substageId));setFollowupForm({...followupForm,substageId:substageId?String(substageId):"",stageId:substage?String(substage.stageId):"",callDisposition:substage?.displayName||"",nextFollowupAt:"",followupType:""});}} placeholder="Search disposition by sub-stage or stage…"/>}
          {!followupModal.callAttempt&&<><label>Stage *<select required value={followupForm.stageId} onChange={e=>setFollowupForm({...followupForm,stageId:e.target.value,substageId:"",nextFollowupAt:"",followupType:""})}><option value="">Select stage</option>{/* Only this lead's own pipeline: a follow-up moves a lead along its ladder, it does not move it to a different one. */}{meta.stages.filter(stage=>{const current=meta.stages.find(item=>String(item.id)===String(followupForm.stageId));return !current?.pipelineId||stage.pipelineId===current.pipelineId;}).map(stage=><option key={stage.id} value={stage.id}>{stageLabelFor(stage,meta.stages,meta.pipelines)}</option>)}</select></label>
          <label>Sub-stage *<select required value={followupForm.substageId} onChange={e=>setFollowupForm({...followupForm,substageId:e.target.value})}><option value="">Select sub-stage</option>{meta.substages.filter(item=>!followupForm.stageId||String(item.stageId)===String(followupForm.stageId)).map(item=><option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label></>}
          {followupModal.callAttempt&&<SearchSuggestion label="Counsellor" required options={referralChoices(referralOptions.employees)} value={referralKey(followupForm.referralBranchId,followupForm.referralEmployeeId)} onChange={(key)=>{const {branchId,employeeId}=splitReferralKey(key);setFollowupForm({...followupForm,referralBranchId:branchId,referralEmployeeId:employeeId});}} placeholder="Search by counsellor or branch…"/>}
          {modalFollowupRequired&&<label>Next follow-up *<input required type="datetime-local" min={minimumFollowupTime} value={followupForm.nextFollowupAt} onChange={e=>setFollowupForm({...followupForm,nextFollowupAt:e.target.value})}/></label>}
          {modalFollowupRequired&&<label>Follow-up type *<select required value={followupForm.followupType} onChange={e=>setFollowupForm({...followupForm,followupType:e.target.value})}><option value="">Select follow-up type</option><option>Call</option><option>WhatsApp</option><option>Email</option><option>Campus Visit</option></select></label>}
          {!followupModal.callAttempt&&<SearchSuggestion className="wide" label="Counsellor" required options={referralChoices(referralOptions.employees)} value={referralKey(followupForm.referralBranchId,followupForm.referralEmployeeId)} onChange={(key)=>{const {branchId,employeeId}=splitReferralKey(key);setFollowupForm({...followupForm,referralBranchId:branchId,referralEmployeeId:employeeId});}} placeholder="Search by counsellor or branch…"/>}
          <div className="wide previous-comments"><span>Previous comments</span><div className="comment-history">{followupForm.comments.length?followupForm.comments.map(item=><article key={item.id}><strong>{item.counsellorName}</strong><i>—</i><time>{item.createdAt?new Date(item.createdAt).toLocaleString("en-IN",{timeZone:"Asia/Kolkata",dateStyle:"medium",timeStyle:"short"}):"Earlier comment"}</time><i>—</i><p>{item.commentText}</p></article>):<p className="no-comments">No previous comments</p>}</div></div>
          {!followupModal.callAttempt&&<label className="wide">New comment *<textarea required rows="4" placeholder="Write a new comment…" value={followupForm.comment} onChange={e=>setFollowupForm({...followupForm,comment:e.target.value})}/></label>}
        </div></form>
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
              <div className="lead-header-actions">
                {drawer.mode === "view"&&<>
                  <button type="button" className="lead-header-action" title="Record a re-enquiry against a new source" disabled={saving} onClick={()=>{const defaults=meta.reEnquiryDefaults||{};setMessage(null);setReEnquiryPending(true);setSecondarySource({academicYear:form.academicYear||"",channelId:meta.channels.some(item=>String(item.id)===String(defaults.channelId))?defaults.channelId:"",sourceId:meta.sources.some(item=>String(item.id)===String(defaults.sourceId))?defaults.sourceId:"",campaignId:meta.campaigns.some(item=>String(item.id)===String(defaults.campaignId))?defaults.campaignId:""});setDrawerTab("source");setLeadAudiences(null);setDrawer({...drawer,mode:"edit",title:`Edit ${form.studentName}`});}}><RotateCcw size={15}/><span>Re-enquire</span></button>
                  <button type="button" className="lead-header-action primary-action" onClick={()=>{setDrawerTab("student");setLeadAudiences(null);setDrawer({...drawer,mode:"edit",title:`Edit ${form.studentName}`});}}><Pencil size={15}/><span>Edit lead</span></button>
                </>}
                {drawer.mode !== "view"&&<button type="submit" form="lead-drawer-form" className="lead-header-action primary-action" disabled={saving}>{drawer.mode==="create"?<Plus size={15}/>:<Pencil size={15}/>}<span>{saving?"Saving…":drawer.mode==="edit"?"Save changes":"Create lead"}</span></button>}
                <button type="button" className="lead-header-close" aria-label="Close lead" onClick={()=>setDrawer(null)}><X size={20}/></button>
              </div>
            </div>
            {drawer.mode !== "create"&&<nav className="lead-detail-tabs" aria-label="Lead detail categories">
              <button type="button" className={drawerTab==="student"?"active":""} onClick={()=>setDrawerTab("student")}>Student &amp; contact</button>
              <button type="button" className={drawerTab==="source"?"active":""} onClick={()=>setDrawerTab("source")}>Source details</button>
              <button type="button" className={drawerTab==="history"?"active":""} onClick={openLeadHistory}>History</button>
              <button type="button" className={drawerTab==="remarketing"?"active":""} onClick={()=>setDrawerTab("remarketing")}>Remarketing</button>
            </nav>}
            {drawer.mode!=="create"&&['paid','settled','success','completed','captured'].includes(String(form.paymentStatus||'').toLowerCase())&&<div className="mx-5 mt-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800"><strong>Payment collected · ₹{Number(form.paymentAmount||0).toLocaleString('en-IN')}</strong>{form.paymentAt&&<small className="block mt-1">{new Date(form.paymentAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})}</small>}</div>}
            <form id="lead-drawer-form" onSubmit={save}>
              <fieldset disabled={drawer.mode === "view"}>
                {drawer.mode==="create"&&((meta.leadFields||[]).length
                  ? groupLeadFields(meta.leadFields).map(section=><div className="form-section" key={section.title}>
                      <h3>{section.title}</h3>
                      <ConfiguredLeadFields fields={section.fields} form={form} setForm={setForm} meta={meta} availableAdmissionTypes={availableAdmissionTypes} availableCurricula={availableCurricula} availableClasses={availableClasses} inputRef={studentNameInputRef}/>
                    </div>)
                  : <div className="form-section">
                      <h3>Lead details</h3>
                      <p className="form-load-error">Lead fields could not be loaded, so this form is empty. Reload the page to try again — if it keeps happening, check that lead fields are configured under Settings → Business Units → Lead fields.</p>
                    </div>)}
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
                    {/* Filled in once the school issues one. Its presence is
                        what the Leads screen reports as "Student ID generated". */}
                    <label>
                      Student ID
                      <input
                        maxLength="60"
                        placeholder="Issued after admission"
                        value={form.studentId || ""}
                        onChange={(e) => setForm({ ...form, studentId: e.target.value })}
                      />
                    </label>
                    <label>
                      Phone *
                      <input
                        required
                        type="tel"
                        maxLength="10"
                        pattern="[6-9][0-9]{9}"
                        /* Stays locked on edit: this is the number duplicate
                           detection matches on, and the update statement does
                           not carry it -- a change here would look accepted
                           and quietly do nothing. */
                        disabled={drawer.mode === "edit"}
                        title={drawer.mode === "edit" ? "The number this lead was matched on cannot be changed" : "Enter a valid 10-digit Indian mobile number starting with 6-9"}
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
                        /* Editable after creation, unlike the primary phone.
                           The primary is what duplicate detection matches on;
                           an alternate number is usually learnt later, so
                           locking it left nowhere to record it. */
                        title="Enter a valid 10-digit Indian mobile number starting with 6-9"
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
                      {/* Editable: the year an enquiry is for is often wrong
                          or missing on intake, and the curriculum and class
                          pickers below cannot resolve without it. */}
                      <select required value={form.academicYear} onChange={(e) => setForm({...form,academicYear:e.target.value})}>
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
                        {availableAdmissionTypes.map(item => <option key={item.id} value={item.id}>{item.displayName}</option>)}
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
                        {sourcesForChannel(meta.sources, meta.sourceLinks, form.channelId).map((source) => (
                          <option key={source.id} value={source.id}>
                            {source.displayName}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>Campaign {drawer.mode==="edit"?"*":""}<select required={drawer.mode==="edit"} disabled={drawer.mode==="edit"} title={drawer.mode==="edit"?"Primary source details cannot be edited":undefined} value={form.campaignId || ""} onChange={(e) => setForm({...form,campaignId:e.target.value})}><option value="">Select campaign</option>{meta.campaigns.filter(campaign=>!form.sourceId||!meta.campaignLinks.some(link=>String(link.sourceId)===String(form.sourceId))||meta.campaignLinks.some(link=>String(link.sourceId)===String(form.sourceId)&&String(link.campaignId)===String(campaign.id))).map(item => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
                    {drawer.mode==="edit"&&<section className={`wide secondary-source-entry${reEnquiryPending?" awaiting-re-enquiry":""}`}><header><strong>{reEnquiryPending?"Source of this re-enquiry":"Add secondary source"}</strong><small>{reEnquiryPending?"Select where the lead came back from. The lead is marked as a re-enquiry when this source is added.":"The primary source above remains unchanged."}</small></header><div className="secondary-source-grid">
                      <label>Channel *<select value={secondarySource.channelId} onChange={e=>setSecondarySource({...secondarySource,channelId:e.target.value,sourceId:"",campaignId:""})}><option value="">Select channel</option>{meta.channels.map(item=><option key={item.id} value={item.id}>{item.displayName} · {item.category}</option>)}</select></label>
                      <label>Source *<select value={secondarySource.sourceId} onChange={e=>setSecondarySource({...secondarySource,sourceId:e.target.value,campaignId:""})}><option value="">Select source</option>{sourcesForChannel(meta.sources, meta.sourceLinks, secondarySource.channelId).map(item=><option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
                      <label>Campaign *<select value={secondarySource.campaignId} onChange={e=>setSecondarySource({...secondarySource,campaignId:e.target.value})}><option value="">Select campaign</option>{meta.campaigns.filter(campaign=>!secondarySource.sourceId||!meta.campaignLinks.some(link=>String(link.sourceId)===String(secondarySource.sourceId))||meta.campaignLinks.some(link=>String(link.sourceId)===String(secondarySource.sourceId)&&String(link.campaignId)===String(campaign.id))).map(item=><option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
                    </div><button type="button" className="primary add-secondary-source" disabled={saving||!secondarySource.sourceId||!secondarySource.channelId||!secondarySource.campaignId} onClick={addSecondarySource}><Plus size={15}/> {reEnquiryPending?"Add source & mark re-enquired":"Add source"}</button></section>}
                    {/* Only the sources the fields above do not already show.
                        The list used to repeat the primary as its first row,
                        so the same channel, source and campaign appeared
                        twice on one tab -- and every row had to carry a
                        PRIMARY/SECONDARY label to tell them apart. Everything
                        here is, by definition, a source added after the
                        first. */}
                    {drawer.mode!=="create"&&(()=>{
                      const extra=(form.sourceHistory||[]).filter(item=>!item.isPrimary);
                      return <div className="wide source-history">
                        <strong>Secondary sources</strong>
                        {extra.length
                          ? extra.map(item=><article key={item.id}>
                              <span>{[item.channel,item.source,item.campaign].filter(Boolean).join(" · ")}</span>
                              <small>{[item.academicYear,item.addedBy].filter(Boolean).join(" · ")} · {new Date(item.createdAt).toLocaleString("en-IN",{timeZone:"Asia/Kolkata",dateStyle:"medium",timeStyle:"short"})}</small>
                            </article>)
                          : <p>None. A source added after the first appears here.</p>}
                      </div>;
                    })()}
                  </div>

                  {/* What the lead actually answered.
                      Mapped answers fill CRM fields, but the question behind
                      them is lost there -- "hr" means nothing without the
                      question beside it. Every question and answer the form
                      collected is kept on the lead and shown here, so nothing
                      a lead told you disappears once it becomes a record. */}
                  {Array.isArray(form.customValues?.metaAnswers) && form.customValues.metaAnswers.length > 0 && (
                    <div className="lead-form-answers">
                      <strong>
                        Form responses
                        {form.customValues.metaFormName ? <em> · {form.customValues.metaFormName}</em> : null}
                        {form.customValues.metaPageName ? <em> · {form.customValues.metaPageName}</em> : null}
                      </strong>
                      <div className="table-wrap overflow-x-auto">
                        <table className="table">
                          <thead><tr><th>Question</th><th>Answer</th></tr></thead>
                          <tbody>
                            {form.customValues.metaAnswers.map((row, index) => (
                              <tr key={`${row.question}-${index}`}>
                                <td className="text-xs">{row.question}</td>
                                <td className="text-xs">{row.answer || <em>blank</em>}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
                {/* Which Meta Custom Audiences this lead is in, and whether
                    Meta has actually been told. A lead with neither an email
                    nor a phone can be in an audience and still be unmatchable,
                    so eligibility is shown rather than assumed. */}
                <div className={`form-section ${drawerTab!=="remarketing"?"tab-hidden":""}`}>
                  <h3>Meta remarketing</h3>
                  {leadAudiences===null?<p className="text-sm text-secondary-600">Loading…</p>
                    :leadAudiences.length===0?<p className="text-sm text-secondary-600">This lead is not in any Meta remarketing audience.</p>
                    :<div className="table-wrap overflow-x-auto">
                      <table className="table">
                        <thead><tr><th>Audience</th><th>Meta audience ID</th><th>Match keys</th><th>Sync status</th><th>Last synced</th></tr></thead>
                        <tbody>
                          {leadAudiences.map(row=>(
                            <tr key={row.audienceId}>
                              <td><div className="font-semibold">{row.name}</div><div className="text-xs text-secondary-500">{row.audienceStatus}</div></td>
                              <td className="text-xs font-mono">{row.metaAudienceId||"not created at Meta"}</td>
                              <td className="text-xs">{row.matchKeys||"—"}</td>
                              <td className="text-xs">{row.syncStatus}</td>
                              <td className="text-xs">{row.lastSyncedAt?new Date(row.lastSyncedAt).toLocaleString("en-IN",{dateStyle:"medium",timeStyle:"short"}):"—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>}
                </div>
                {/* Everything that was the separate Lead history dialog. It
                    keeps that dialog's classes, so it keeps its styling. */}
                <div className={`form-section ${drawerTab!=="history"?"tab-hidden":""}`}>
                  <h3>Lead history</h3>
                  <div className="history-current-grid">
                    <div><span>Current stage</span><strong>{form.stage||meta.stages.find(item=>String(item.id)===String(form.stageId))?.displayName||"—"}</strong></div>
                    <div><span>Current sub-stage</span><strong>{meta.substages.find(item=>String(item.id)===String(form.substageId))?.displayName||"Not specified"}</strong></div>
                    <div><span>Next follow-up</span><strong>{form.nextFollowupAt?new Date(form.nextFollowupAt).toLocaleString("en-IN",{timeZone:"Asia/Kolkata",dateStyle:"medium",timeStyle:"short"}):"Not scheduled"}</strong></div>
                    <div><span>Lead owner</span><strong>{form.owner||"Unassigned"}</strong></div>
                  </div>
                  <div className="history-body">
                    <section className="form-section lead-dates-section">
                      <h3>Lead timeline</h3>
                      <LeadTimeline lead={form} />
                    </section>
                    <section className="activity-section modal-activity">
                      <h3>Activity</h3>
                      <ActivityTimeline activities={drawer.activities || []} />
                    </section>
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
      <EmailComposer open={Boolean(emailLead)} lead={emailLead} onClose={()=>setEmailLead(null)} onSent={()=>{setMessage({type:'success',text:'Email sent successfully'});loadLeads();}}/>
    </main>
  );
}
