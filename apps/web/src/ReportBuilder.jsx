import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3, Calculator, CalendarRange, Check, ChevronDown, ChevronLeft, Columns3, Filter, Funnel, LayoutList,
  ChevronRight, MoreHorizontal, PieChart, Plus, Save, Search, Trash2, X,
} from "lucide-react";
import { useBusinessUnit } from "./BusinessUnitContext.jsx";
import "./ReportBuilder.css";

const TYPES = [
  { id: "table", label: "Table", icon: LayoutList },
  { id: "funnel", label: "Funnel", icon: Funnel },
  { id: "pie", label: "Pie chart", icon: PieChart },
  { id: "stacked-column", label: "Stacked column", icon: Columns3 },
  { id: "stacked-bar", label: "Stacked bar", icon: BarChart3 },
];
const PALETTE = ["#5b61c4", "#4e8bd8", "#e28a45", "#9b66c7", "#43a486", "#8d96a8", "#d85f70", "#555aaf"];
const FIELDS = [
  { id: "stage", label: "Lead Stage", type: "text" }, { id: "owner", label: "Lead Owner", type: "text" },
  { id: "source", label: "Lead Source", type: "text" }, { id: "campaign", label: "Campaign Name", type: "text" },
  { id: "city", label: "City", type: "text" }, { id: "class", label: "Applying Class", type: "text" },
  { id: "createdAt", label: "Creation Date", type: "date" }, { id: "followupAt", label: "Follow-up Date", type: "date" },
  { id: "leadId", label: "Lead ID", type: "number" }, { id: "score", label: "Lead Score", type: "number" },
];
const APPLICATION_FIELDS = [
  { id: "leadId", label: "Lead Number", type: "text" }, { id: "studentName", label: "Student Name", type: "text" },
  { id: "phone", label: "Primary Phone", type: "text" }, { id: "email", label: "Email", type: "text" },
  { id: "branch", label: "Branch Name", type: "text" }, { id: "applyingClass", label: "Applying Class", type: "text" },
  { id: "curriculum", label: "Curriculum", type: "text" }, { id: "stage", label: "Lead Stage", type: "text" },
  { id: "substageId", label: "Lead Sub-stage", type: "text" }, { id: "source", label: "Lead Source", type: "text" },
  { id: "channelCategory", label: "Channel", type: "text" }, { id: "campaignCategory", label: "Campaign", type: "text" },
  { id: "owner", label: "Lead Owner", type: "text" }, { id: "touchStatus", label: "Is Touched Status", type: "text" },
  { id: "whatsappResponse", label: "WhatsApp Response", type: "text" }, { id: "lookingForAdmission", label: "Looking for Admission", type: "boolean" },
  { id: "isParent", label: "Is Parent", type: "boolean" }, { id: "score", label: "Lead Score", type: "number" },
  { id: "remarksCount", label: "Remarks Count", type: "number" }, { id: "addedAt", label: "Added", type: "date" },
  { id: "updatedAt", label: "Updated", type: "date" }, { id: "recentModified", label: "Recently Modified", type: "date" },
  { id: "referredAt", label: "Referred", type: "date" }, { id: "nextFollowup", label: "Next Follow-up", type: "date" },
  { id: "reEnquiredAt", label: "Re-Enquired", type: "date" }, { id: "touchedAt", label: "Touched Date", type: "date" },
];
const AGGREGATIONS = ["Count", "Distinct count", "Sum", "Average", "Percentage"];
const LEAD_FIELD_KEYS = {
  stage: "stage", stage_id: "stage", owner: "owner", owner_employee_id: "owner", source: "source", source_id: "source",
  campaign: "campaignCategory", campaign_id: "campaignCategory", campaignId: "campaignCategory",
  channel_id: "channelCategory", channelId: "channelCategory", branch_id: "branch", branchId: "branch",
  branch_name: "branch", student_name: "studentName", class: "applyingClass", class_id: "applyingClass",
  curriculum_id: "curriculum", curriculumId: "curriculum", classId: "applyingClass", stageId: "stage",
  sourceId: "source", ownerEmployeeId: "owner", channel: "channelCategory", campaign_name: "campaignCategory",
  admission_type_id: "admissionTypeId", admissionType: "admissionTypeId", substage_id: "substageId",
  createdAt: "addedAt", created_at: "addedAt", added_at: "addedAt",
  followupAt: "nextFollowup", next_followup_at: "nextFollowup", leadId: "leadId", lead_id: "leadId",
  lead_number: "leadId", score: "score", lead_score: "score",
};
function reportFieldCatalog(report) { return report.fieldCatalog?.length ? report.fieldCatalog : FIELDS; }
function leadFieldValue(lead, fieldId) {
  if (!lead) return undefined;
  const mapped = LEAD_FIELD_KEYS[fieldId] || fieldId;
  if (Object.prototype.hasOwnProperty.call(lead, mapped)) return lead[mapped];
  if (Object.prototype.hasOwnProperty.call(lead, fieldId)) return lead[fieldId];
  if (lead.customValues && Object.prototype.hasOwnProperty.call(lead.customValues, fieldId)) return lead.customValues[fieldId];
  const camel = String(fieldId).replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  return lead[camel];
}
function normalizedFilterText(value) { return String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase(); }

function displayFieldValue(lead, fieldId, report, dateGrouping = "month") {
  const value = leadFieldValue(lead, fieldId);
  if (value === null || value === undefined || value === "") return "Blank";
  const fieldType = reportFieldCatalog(report || {}).find(field => field.id === fieldId)?.type;
  if (fieldType === "date" || fieldType === "datetime") {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Blank";
    return dateGrouping === "date"
      ? date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
      : date.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
  }
  return String(value);
}
function numericFieldValue(lead, fieldId, report) {
  const calculated = (report.calculatedFields || []).find(item => item.id === fieldId);
  if (!calculated) return Number(leadFieldValue(lead, fieldId)) || 0;
  const expression = calculated.formula.replace(/\[([^\]]+)\]/g, (_, label) => {
    const field = reportFieldCatalog(report).find(item => item.label.toLowerCase() === label.trim().toLowerCase());
    return String(field ? numericFieldValue(lead, field.id, report) : 0);
  });
  if (!/^[\d+\-*/().\s]+$/.test(expression)) return 0;
  try { return Number(Function(`"use strict";return (${expression})`)()) || 0; } catch { return 0; }
}
function aggregateLeads(items, measure, report, grandTotal) {
  const aggregation = measure?.aggregation || "Count";
  const field = measure?.field || "leadId";
  if (aggregation === "Count") return items.length;
  if (aggregation === "Distinct count") return new Set(items.map(item => displayFieldValue(item, field, report))).size;
  if (aggregation === "Percentage") return grandTotal ? items.length / grandTotal * 100 : 0;
  const numbers = items.map(item => numericFieldValue(item, field, report));
  if (aggregation === "Average") return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : 0;
  return numbers.reduce((sum, value) => sum + value, 0);
}
function buildPivotData(leads, report) {
  const rowFields = report.rows || [];
  const columnFields = report.columns || [];
  const measure = report.values?.[0] || { field: "leadId", aggregation: "Count" };
  const columnLabel = lead => columnFields.map((field, index) => displayFieldValue(lead, field, report, report.dateGroups?.[`columns:${index}`] || "month")).join(" / ");
  const columnNames = columnFields.length ? [...new Set(leads.map(columnLabel))] : ["Value"];
  const makeRow = (rowName, rowLeads, level, path, index) => {
    const cells = columnNames.map(columnName => aggregateLeads(columnFields.length ? rowLeads.filter(lead => columnLabel(lead) === columnName) : rowLeads, measure, report, leads.length));
    const nextField = rowFields[level + 1];
    const nextDateGrouping = report.dateGroups?.[`rows:${level + 1}`] || "month";
    const childNames = nextField ? [...new Set(rowLeads.map(lead => displayFieldValue(lead, nextField, report, nextDateGrouping)))] : [];
    return {
      label: rowName, level, path, cells, total: cells.reduce((sum, value) => sum + value, 0),
      color: PALETTE[index % PALETTE.length],
      children: childNames.map((childName, childIndex) => makeRow(childName, rowLeads.filter(lead => displayFieldValue(lead, nextField, report, nextDateGrouping) === childName), level + 1, `${path}/${childName}`, childIndex)),
    };
  };
  const firstField = rowFields[0];
  const firstDateGrouping = report.dateGroups?.["rows:0"] || "month";
  const rowNames = firstField ? [...new Set(leads.map(lead => displayFieldValue(lead, firstField, report, firstDateGrouping)))] : ["All leads"];
  const rows = rowNames.map((rowName, index) => makeRow(rowName, firstField ? leads.filter(lead => displayFieldValue(lead, firstField, report, firstDateGrouping) === rowName) : leads, 0, rowName, index));
  return {
    funnel: rows.map(row => ({ label: row.label, value: row.total, color: row.color })),
    pivot: { rowLabel: rowFields.map(id => reportFieldCatalog(report).find(field => field.id === id)?.label || id).join(" / ") || "Summary", columns: columnNames, rows, aggregation: measure.aggregation, valueLabel: reportFieldCatalog(report).find(field => field.id === measure.field)?.label || (report.calculatedFields || []).find(field => field.id === measure.field)?.name || measure.field },
  };
}
function filterReportLeads(leads, report) {
  const now = new Date();
  const cutoff = new Date(now);
  if (report.dateRange === "Last 7 days") cutoff.setDate(now.getDate() - 7);
  else if (report.dateRange === "Last 30 days") cutoff.setDate(now.getDate() - 30);
  else if (report.dateRange === "This quarter") cutoff.setMonth(Math.floor(now.getMonth() / 3) * 3, 1);
  else if (report.dateRange === "This academic year") cutoff.setFullYear(now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear(), 3, 1);
  else cutoff.setFullYear(1970, 0, 1);
  return leads.filter(lead => {
    const stageMatches = !report.stages?.length || report.stages.includes(lead.stage);
    const reportDateValue = lead?.[LEAD_FIELD_KEYS[report.dateField] || report.dateField || "addedAt"];
    const reportDate = new Date(reportDateValue);
    const explicitDateMatches = (!report.dateFrom || (!Number.isNaN(reportDate.getTime()) && String(reportDateValue).slice(0, 10) >= report.dateFrom)) && (!report.dateTo || (!Number.isNaN(reportDate.getTime()) && String(reportDateValue).slice(0, 10) <= report.dateTo));
    const created = new Date(lead.addedAt);
    const legacyDateMatches = Number.isNaN(created.getTime()) || created >= cutoff;
    const dateMatches = report.dateFrom || report.dateTo ? explicitDateMatches : legacyDateMatches;
    const dynamicMatches = (report.filters || []).every(filter => {
      const raw = leadFieldValue(lead, filter.field);
      const actual = raw === null || raw === undefined ? "" : raw;
      const expectedValues = Array.isArray(filter.value) ? filter.value : filter.value === "" || filter.value === undefined ? [] : [filter.value];
      const operator = String(filter.operator || "equals").toLowerCase().replace(/\s+/g, "_");
      const compare = expected => {
        if (operator === "contains") return normalizedFilterText(actual).includes(normalizedFilterText(expected));
        if (operator === "not_contains") return !normalizedFilterText(actual).includes(normalizedFilterText(expected));
        if (operator === "not_equals") return normalizedFilterText(actual) !== normalizedFilterText(expected);
        if (operator === "greater_than") return Number(actual) > Number(expected);
        if (operator === "less_than") return Number(actual) < Number(expected);
        if (operator === "before") return new Date(actual) < new Date(expected);
        if (operator === "after") return new Date(actual) > new Date(expected);
        if ((filter.type === "date" || filter.type === "datetime") && operator === "equals") return String(actual).slice(0, 10) === String(expected).slice(0, 10);
        return normalizedFilterText(actual) === normalizedFilterText(expected);
      };
      if (operator === "is_blank") return normalizedFilterText(actual) === "";
      if (operator === "is_not_blank") return normalizedFilterText(actual) !== "";
      if (!expectedValues.length) return true;
      return ["not_equals", "not_contains"].includes(operator) ? expectedValues.every(compare) : expectedValues.some(compare);
    });
    return stageMatches && dateMatches && dynamicMatches;
  });
}
function filterOperators(type) {
  if (type === "date" || type === "datetime") return [["equals", "On"], ["before", "Before"], ["after", "After"], ["is_blank", "Is blank"], ["is_not_blank", "Is not blank"]];
  if (type === "number") return [["equals", "Equals"], ["not_equals", "Does not equal"], ["greater_than", "Greater than"], ["less_than", "Less than"], ["is_blank", "Is blank"], ["is_not_blank", "Is not blank"]];
  return [["equals", "Equals"], ["not_equals", "Does not equal"], ["contains", "Contains"], ["not_contains", "Does not contain"], ["is_blank", "Is blank"], ["is_not_blank", "Is not blank"]];
}

export function savedReportsKey(unitId) { return `crm_saved_reports_${unitId}`; }
export function readSavedReports(unitId) {
  try {
    const reports = JSON.parse(localStorage.getItem(savedReportsKey(unitId)) || "[]");
    return Array.isArray(reports) ? reports.filter(report => report.generatedAt && report.generatedData) : [];
  } catch { return []; }
}
function writeSavedReports(unitId, reports) {
  localStorage.setItem(savedReportsKey(unitId), JSON.stringify(reports));
  window.dispatchEvent(new CustomEvent("crm:saved-reports-changed", { detail: { unitId } }));
}

export function ReportVisual({ report, data, compact = false }) {
  const stages = (data?.funnel || []).filter(item => !report?.stages?.length || report.stages.includes(item.label));
  const values = stages.map((item, index) => ({ ...item, value: Number(item.value || 0), color: report?.colors?.[index] || item.color || PALETTE[index % PALETTE.length] }));
  const total = values.reduce((sum, item) => sum + item.value, 0) || 1;
  if (!values.length) return <div className="report-empty">No data matches these filters.</div>;

  if (report.type === "table" && data?.pivot) return <PivotTableVisual pivot={data.pivot} />;
  if (report.type === "table") return (
    <div className="report-table-wrap"><table className="report-table"><thead><tr><th>Stage</th><th>Lead count</th><th>Share</th></tr></thead>
      <tbody>{values.map(item => <tr key={item.label}><td><i style={{ background: item.color }} />{item.label}</td><td>{item.value.toLocaleString()}</td><td>{Math.round(item.value / total * 100)}%</td></tr>)}</tbody></table></div>
  );
  if (report.type === "pie") {
    let cursor = 0;
    const gradient = values.map(item => { const start = cursor; cursor += item.value / total * 100; return `${item.color} ${start}% ${cursor}%`; }).join(",");
    return <div className={`pie-report ${compact ? "compact" : ""}`}><div className="pie-ring" style={{ background: `conic-gradient(${gradient})` }}><span>{total.toLocaleString()}<small>Leads</small></span></div><ChartLegend values={values} total={total} /></div>;
  }
  if (report.type === "funnel") {
    const segmentHeight = 48;
    const chartHeight = values.length * segmentHeight;
    const center = 250;
    const widest = 390;
    const narrowest = 62;
    const widthAt = index => widest - ((widest - narrowest) * index / Math.max(values.length, 1));
    return <div className={`true-funnel-report ${compact ? "compact" : ""}`}>
      <svg className="true-funnel" viewBox={`0 0 500 ${chartHeight}`} role="img" aria-label={`${report.title} funnel chart`}>
        {values.map((item, index) => {
          const topWidth = widthAt(index);
          const bottomWidth = widthAt(index + 1);
          const top = index * segmentHeight;
          const bottom = top + segmentHeight;
          const points = `${center - topWidth / 2},${top} ${center + topWidth / 2},${top} ${center + bottomWidth / 2},${bottom} ${center - bottomWidth / 2},${bottom}`;
          return <g key={item.label}>
            <polygon points={points} fill={item.color} />
            {report.showLabels !== false && <text x={center} y={top + segmentHeight / 2 + 5} textAnchor="middle">{item.value.toLocaleString()}</text>}
          </g>;
        })}
      </svg>
      <div className="funnel-legend">{values.map(item => <div key={item.label}><i style={{ background: item.color }} /><span>{item.label}: <strong>{item.value.toLocaleString()}</strong></span></div>)}</div>
    </div>;
  }
  if (report.type === "stacked-column") {
    const max = Math.max(...values.map(item => item.value), 1);
    return <div className="column-chart"><div className="column-plot">{values.map(item => <div className="column-item" key={item.label}><div className="column-value">{report.showLabels !== false && <b>{item.value}</b>}<i style={{ height: `${Math.max(4, item.value / max * 100)}%`, background: item.color }} /></div><span>{item.label}</span></div>)}</div></div>;
  }
  const max = Math.max(...values.map(item => item.value), 1);
  return <div className="bar-report">{values.map(item => <div className="bar-report-row" key={item.label}><span>{item.label}</span><div><i style={{ width: `${Math.max(2, item.value / max * 100)}%`, background: item.color }} /></div>{report.showLabels !== false && <strong>{item.value}</strong>}</div>)}</div>;
}

function PivotTableVisual({ pivot }) {
  const [expanded, setExpanded] = useState(() => new Set());
  const format = value => pivot.aggregation === "Percentage" ? `${value.toFixed(1)}%` : Number(value.toFixed(2)).toLocaleString();
  const toggle = path => setExpanded(current => {
    const next = new Set(current);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  });
  const renderRows = rows => rows.flatMap(row => {
    const hasChildren = Boolean(row.children?.length);
    const isExpanded = expanded.has(row.path);
    const rendered = [<tr key={row.path} className={`pivot-level-${row.level} ${hasChildren ? "pivot-parent" : ""}`}>
      <td><div className="pivot-row-label" style={{ paddingLeft: `${row.level * 22}px` }}>
        {hasChildren ? <button onClick={() => toggle(row.path)} aria-label={`${isExpanded ? "Collapse" : "Expand"} ${row.label}`}>{isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button> : <span className="pivot-indent" />}
        <i style={{ background: row.color }} /><span>{row.label}</span>{hasChildren && <small>({row.children.length})</small>}
      </div></td>
      {row.cells.map((cell, index) => <td key={index}>{format(cell)}</td>)}
      <td><strong>{format(row.total)}</strong></td>
    </tr>];
    if (hasChildren && isExpanded) rendered.push(...renderRows(row.children));
    return rendered;
  });
  return <div className="report-table-wrap"><table className="report-table pivot-result"><thead><tr><th>{pivot.rowLabel}</th>{pivot.columns.map(column => <th key={column}>{column}</th>)}<th>Total</th></tr></thead><tbody>{renderRows(pivot.rows)}</tbody></table></div>;
}

function ChartLegend({ values, total }) {
  return <div className="chart-legend">{values.map(item => <div key={item.label}><i style={{ background: item.color }} /><span>{item.label}</span><strong>{Math.round(item.value / total * 100)}%</strong></div>)}</div>;
}

function reportDateKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function ReportCalendarMonth({ month, from, to, onSelect, previous, next, move }) {
  const year = month.getFullYear(), monthIndex = month.getMonth(), firstDay = new Date(year, monthIndex, 1).getDay(), days = new Date(year, monthIndex + 1, 0).getDate();
  return <section className="range-calendar-month"><header>{previous ? <button onClick={() => move(-1)}><ChevronLeft /></button> : <span />}<strong>{month.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</strong>{next ? <button onClick={() => move(1)}><ChevronRight /></button> : <span />}</header><div className="range-weekdays">{["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map(day => <span key={day}>{day}</span>)}</div><div className="range-days">{Array.from({ length: firstDay }, (_, index) => <span key={`blank-${index}`} />)}{Array.from({ length: days }, (_, index) => { const key = reportDateKey(new Date(year, monthIndex, index + 1)); return <button key={key} className={`${key === from || key === to ? "selected " : ""}${from && to && key > from && key < to ? "in-range" : ""}`} onClick={() => onSelect(key)}>{index + 1}</button>; })}</div></section>;
}
function ReportDateRange({ report, patch }) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const root = useRef(null);
  useEffect(() => { if (!open) return undefined; const close = event => { if (!root.current?.contains(event.target)) setOpen(false); }; document.addEventListener("mousedown", close); return () => document.removeEventListener("mousedown", close); }, [open]);
  const labels = { addedAt: "Added", updatedAt: "Updated", referredAt: "Referred", nextFollowup: "Next Follow-up", reEnquiredAt: "Re-Enquired" };
  const label = report.dateFrom && report.dateTo ? `${report.dateFrom} – ${report.dateTo}` : report.dateFrom ? `${report.dateFrom} – select end` : report.dateTo ? `Till ${report.dateTo}` : "All dates";
  const select = key => { if (!report.dateFrom || report.dateTo) patch({ dateFrom: key, dateTo: "" }); else if (key < report.dateFrom) patch({ dateFrom: key, dateTo: report.dateFrom }); else patch({ dateTo: key }); };
  const preset = (kind, days = 0) => { const today = new Date(), end = new Date(today); if (kind === "yesterday") { today.setDate(today.getDate() - 1); return patch({ dateFrom: reportDateKey(today), dateTo: reportDateKey(today) }); } if (kind === "till") { end.setDate(end.getDate() - 1); return patch({ dateFrom: "", dateTo: reportDateKey(end) }); } end.setDate(end.getDate() + days); patch({ dateFrom: reportDateKey(today), dateTo: reportDateKey(end) }); };
  const nextMonth = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  return <div className="report-date-range" ref={root}><span>Date range</span><button className={`report-date-trigger ${report.dateFrom || report.dateTo ? "active" : ""}`} onClick={() => setOpen(value => !value)}><CalendarRange size={15} /><div><small>{labels[report.dateField] || "Added"}</small><strong>{label}</strong></div><ChevronDown size={13} /></button>{open && <div className="followup-range-popover report-date-popover"><div className="followup-range-header"><div className="followup-range-title"><CalendarRange size={18} /><div><strong>{labels[report.dateField] || "Added"}</strong><small>Select the report date range</small></div></div><select className="date-type-select-popover" value={report.dateField || "addedAt"} onChange={event => patch({ dateField: event.target.value })}>{Object.entries(labels).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></div><div className="range-calendar-panel"><aside><strong>Choose a period</strong><button onClick={() => preset("today", 0)}>Today</button><button onClick={() => preset("yesterday")}>Yesterday</button><button onClick={() => preset("till")}>Till yesterday</button><button onClick={() => preset("next", 1)}>Next day</button><button onClick={() => preset("next", 7)}>Next 7 days</button><button onClick={() => preset("next", 30)}>Next 30 days</button></aside><div className="range-calendar-months"><ReportCalendarMonth month={month} from={report.dateFrom} to={report.dateTo} onSelect={select} previous move={amount => setMonth(new Date(month.getFullYear(), month.getMonth() + amount, 1))} /><ReportCalendarMonth month={nextMonth} from={report.dateFrom} to={report.dateTo} onSelect={select} next move={amount => setMonth(new Date(month.getFullYear(), month.getMonth() + amount, 1))} /></div></div><div className="followup-range-footer"><button className="range-clear" onClick={() => patch({ dateFrom: "", dateTo: "" })}>Clear</button><button className="range-apply" onClick={() => setOpen(false)}>Apply dates</button></div></div>}</div>;
}

function FilterValueSelect({ field, value, leads, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const root = useRef(null);
  const selected = Array.isArray(value) ? value.map(String) : value === "" || value === undefined ? [] : [String(value)];
  const options = useMemo(() => {
    return [...new Set(leads.map(lead => leadFieldValue(lead, field.id)).filter(item => item !== null && item !== undefined && normalizedFilterText(item) !== "").map(item => String(item).trim()))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [field.id, leads]);
  useEffect(() => { if (!open) return undefined; const close = event => { if (!root.current?.contains(event.target)) setOpen(false); }; document.addEventListener("mousedown", close); return () => document.removeEventListener("mousedown", close); }, [open]);
  const label = raw => { if (field.type === "boolean") return raw === "true" || raw === "1" ? "Yes" : "No"; if (field.type === "date" || field.type === "datetime") { const date = new Date(raw); return Number.isNaN(date.getTime()) ? raw : date.toLocaleDateString("en-IN"); } return raw; };
  const toggle = option => onChange(selected.includes(option) ? selected.filter(item => item !== option) : [...selected, option]);
  return <div className="filter-value-select" ref={root}><button className={selected.length ? "active" : ""} onClick={() => setOpen(current => !current)}><span>{selected.length ? selected.length === 1 ? label(selected[0]) : `${selected.length} values selected` : "Select values"}</span><ChevronDown size={13} /></button>{open && <div className="filter-values-popover"><div><Search size={12} /><input autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder="Search values..." /></div><section>{options.filter(option => label(option).toLowerCase().includes(search.toLowerCase())).map(option => <button key={option} onClick={() => toggle(option)}><i>{selected.includes(option) && <Check size={11} />}</i><span>{label(option)}</span></button>)}{!options.length && <p>No values available</p>}</section>{selected.length > 0 && <footer><button onClick={() => onChange([])}>Clear selections</button><span>{selected.length} selected</span></footer>}</div>}</div>;
}

export default function ReportBuilder({ data, leads = [], leadFields = [] }) {
  const { selectedUnit } = useBusinessUnit();
  const configuredFields = useMemo(() => {
    const configured = leadFields.map(field => ({
      id: field.fieldKey,
      label: field.displayName,
      type: ["number", "decimal", "currency"].includes(String(field.fieldType).toLowerCase()) ? "number" : String(field.fieldType || "text").toLowerCase(),
    }));
    const knownIds = new Set(configured.map(field => field.id));
    const application = APPLICATION_FIELDS.filter(field => !knownIds.has(field.id));
    const catalog = [...configured, ...application];
    const catalogIds = new Set(catalog.map(field => field.id));
    const ignored = new Set(["marketingDeliveries", "marketingDeliveryPairs"]);
    const generated = Object.keys(leads[0] || {}).filter(key => !catalogIds.has(key) && !ignored.has(key) && typeof leads[0]?.[key] !== "object").map(key => ({
      id: key,
      label: key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/\b\w/g, letter => letter.toUpperCase()),
      type: typeof leads[0]?.[key] === "number" ? "number" : /(?:At|Date)$/i.test(key) ? "date" : "text",
    }));
    return [...catalog, ...generated];
  }, [leadFields, leads]);
  const defaultReport = { type: "", title: "Untitled report", description: "", dateRange: "All time", dateField: "addedAt", dateFrom: "", dateTo: "", stages: [], filters: [], rows: [], columns: [], values: [], dateGroups: {}, calculatedFields: [], fieldCatalog: configuredFields, showLabels: true, showLegend: true };
  const [report, setReport] = useState(defaultReport);
  const [saved, setSaved] = useState(() => readSavedReports(selectedUnit.id));
  const [notice, setNotice] = useState("");
  const [fieldPicker, setFieldPicker] = useState("");
  const [fieldSearch, setFieldSearch] = useState("");
  const [filterPickerOpen, setFilterPickerOpen] = useState(false);
  const [filterSearch, setFilterSearch] = useState("");
  const filterPickerRef = useRef(null);
  const [calculatedOpen, setCalculatedOpen] = useState(false);
  const [calculated, setCalculated] = useState({ name: "", formula: "" });
  const [generatedReport, setGeneratedReport] = useState(null);
  const [generatedData, setGeneratedData] = useState(null);
  const [generating, setGenerating] = useState(false);
  useEffect(() => {
    if (!filterPickerOpen) return undefined;
    const close = event => {
      if (!filterPickerRef.current?.contains(event.target)) {
        setFilterPickerOpen(false);
        setFilterSearch("");
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [filterPickerOpen]);
  const patch = values => {
    setReport(current => ({ ...current, ...values }));
    if (Object.keys(values).some(key => !["title", "description"].includes(key))) {
      setGeneratedReport(null);
      setGeneratedData(null);
    }
  };
  const save = () => {
    if (!generatedReport || !generatedData) return;
    const item = { ...generatedReport, id: report.id || generatedReport.id || `${Date.now()}`, title: report.title, description: report.description, generatedData, generatedAt: generatedReport.generatedAt, updatedAt: new Date().toISOString(), businessUnitId: selectedUnit.id };
    const next = [item, ...saved.filter(existing => existing.id !== item.id)];
    writeSavedReports(selectedUnit.id, next); setSaved(next); setReport(item); setNotice("Report saved to this business unit");
    setTimeout(() => setNotice(""), 2600);
  };
  const createNew = () => { setReport({ ...defaultReport }); setGeneratedReport(null); setGeneratedData(null); };
  const fieldLabel = id => [...configuredFields, ...(report.calculatedFields || []).map(item => ({ id: item.id, label: item.name }))].find(field => field.id === id)?.label || id;
  const addField = (shelf, field) => {
    if (!field) return;
    if (shelf === "values") patch({ values: [...(report.values || []), { field, aggregation: "Count" }] });
    else if (!(report[shelf] || []).includes(field)) patch({ [shelf]: [...(report[shelf] || []), field] });
    setFieldPicker(""); setFieldSearch("");
  };
  const removeField = (shelf, index) => {
    const nextItems = (report[shelf] || []).filter((_, itemIndex) => itemIndex !== index);
    const nextGroups = { ...(report.dateGroups || {}) };
    delete nextGroups[`${shelf}:${index}`];
    for (let itemIndex = index + 1; itemIndex <= nextItems.length; itemIndex += 1) {
      const previous = nextGroups[`${shelf}:${itemIndex}`];
      delete nextGroups[`${shelf}:${itemIndex}`];
      if (previous) nextGroups[`${shelf}:${itemIndex - 1}`] = previous;
    }
    patch({ [shelf]: nextItems, dateGroups: nextGroups });
  };
  const saveCalculated = () => {
    if (!calculated.name.trim() || !calculated.formula.trim()) return;
    const field = { id: `calc_${Date.now()}`, name: calculated.name.trim(), formula: calculated.formula.trim() };
    patch({ calculatedFields: [...(report.calculatedFields || []), field], values: [...(report.values || []), { field: field.id, aggregation: "Sum" }] });
    setCalculated({ name: "", formula: "" }); setCalculatedOpen(false);
  };
  const addFilter = field => {
    const definition = configuredFields.find(item => item.id === field);
    patch({ filters: [...(report.filters || []), { id: `${Date.now()}`, field, operator: "equals", value: [], type: definition?.type || "text" }] });
    setFilterPickerOpen(false); setFilterSearch("");
  };
  const updateFilter = (index, values) => patch({ filters: (report.filters || []).map((filter, filterIndex) => filterIndex === index ? { ...filter, ...values } : filter) });
  const generate = () => {
    setGenerating(true);
    window.setTimeout(() => {
      const snapshot = JSON.parse(JSON.stringify(report));
      if (!snapshot.type) snapshot.type = "table";
      snapshot.generatedAt = new Date().toISOString();
      setGeneratedReport(snapshot);
      const filteredLeads = filterReportLeads(leads, snapshot);
      setGeneratedData(leads.length ? buildPivotData(filteredLeads, snapshot) : data);
      setGenerating(false);
      setNotice(`Report generated from ${filteredLeads.length.toLocaleString()} leads`);
      setTimeout(() => setNotice(""), 2600);
    }, 180);
  };
  return <div className="report-studio">
    <aside className="report-library">
      <button className="primary full" onClick={createNew}><Plus size={16} /> New report</button>
      <div className="library-title"><span>Saved reports</span><b>{saved.length}</b></div>
      <div className="saved-report-list">{saved.map(item => { const TypeIcon = TYPES.find(type => type.id === item.type)?.icon || BarChart3; return <button key={item.id} className={item.id === report.id ? "active" : ""} onClick={() => { setReport(item); setGeneratedReport(item); setGeneratedData(item.generatedData); }}><TypeIcon size={16} /><span><strong>{item.title}</strong><small>{TYPES.find(type => type.id === item.type)?.label}</small></span><MoreHorizontal size={15} /></button>; })}{!saved.length && <p>No saved reports yet.<br />Build your first one.</p>}</div>
    </aside>
    <section className="report-canvas">
      <div className="report-canvas-head"><div><span className="report-kicker">Report builder</span><input value={report.title} onChange={event => patch({ title: event.target.value })} aria-label="Report title" /><input className="report-description" value={report.description} onChange={event => patch({ description: event.target.value })} placeholder="Add a description" aria-label="Report description" /></div><div>{notice && <span className="save-notice"><Check size={14} />{notice}</span>}<button className="secondary" onClick={createNew}><Plus size={16} />New</button><button className="primary" disabled={!generatedReport || !generatedData} onClick={save}><Save size={16} />Save report</button></div></div>
      <div className="pivot-shelves">
        {["rows", "columns", "values"].map(shelf => <div className="pivot-shelf" key={shelf}>
          <label>{shelf === "values" ? "Values / Measures" : shelf}</label>
          <div className="shelf-box">
            {(report[shelf] || []).map((item, index) => {
              const field = shelf === "values" ? item.field : item;
              const definition = configuredFields.find(candidate => candidate.id === field);
              const isDateDimension = shelf !== "values" && ["date", "datetime"].includes(definition?.type);
              return <div className="field-chip" key={`${field}-${index}`}><span>{fieldLabel(field)}</span>
                {shelf === "values" && <select value={item.aggregation} onChange={event => patch({ values: report.values.map((value, valueIndex) => valueIndex === index ? { ...value, aggregation: event.target.value } : value) })}>{AGGREGATIONS.map(option => <option key={option}>{option}</option>)}</select>}
                {isDateDimension && <select className="date-group-select" value={report.dateGroups?.[`${shelf}:${index}`] || "month"} onChange={event => patch({ dateGroups: { ...(report.dateGroups || {}), [`${shelf}:${index}`]: event.target.value } })} aria-label={`Group ${fieldLabel(field)}`}><option value="month">By month</option><option value="date">By date</option></select>}
                <button onClick={() => removeField(shelf, index)} aria-label={`Remove ${fieldLabel(field)}`}><X size={12} /></button>
              </div>;
            })}
            <button className="add-field" onClick={() => setFieldPicker(fieldPicker === shelf ? "" : shelf)}><Plus size={13} />Add field</button>
            {fieldPicker === shelf && <div className="field-picker"><div><Search size={13} /><input autoFocus value={fieldSearch} onChange={event => setFieldSearch(event.target.value)} placeholder="Search fields..." /></div>
              <section>{[...configuredFields, ...(report.calculatedFields || []).map(item => ({ id: item.id, label: item.name, type: "calculated" }))].filter(field => field.label.toLowerCase().includes(fieldSearch.toLowerCase())).map(field => <button key={field.id} onClick={() => addField(shelf, field.id)}><span>{field.label}</span><small>{field.type}</small></button>)}</section>
            </div>}
          </div>
        </div>)}
      </div>
      <div className="pivot-actions"><div><button className="secondary" onClick={() => setCalculatedOpen(true)}><Calculator size={15} />Calculated field</button><span>Add Values with either Rows or Columns. Without a chart selection, the report generates as a table.</span></div><button className="generate-report" onClick={generate} disabled={generating || !report.values?.length || (!report.rows?.length && !report.columns?.length)}>{generating ? "Generating…" : "Generate report"}<BarChart3 size={15} /></button></div>
      <div className="visual-picker">{TYPES.map(type => <button key={type.id} className={report.type === type.id ? "active" : ""} onClick={() => patch({ type: type.id })}><type.icon size={19} /><span>{type.label}</span></button>)}</div>
      <article className="report-preview panel">{generatedReport && generatedData ? <><div className="preview-heading"><div><h2>{generatedReport.title || "Untitled report"}</h2><p>{generatedReport.description}</p></div><span>Generated preview · {generatedReport.dateRange}</span></div><ReportVisual report={generatedReport} data={generatedData} /></> : <div className="blank-report-preview"><BarChart3 /><h3>Start creating your pivot report</h3><p>Select a chart type, add fields to Rows and Values, then click <strong>Generate report</strong>.</p></div>}</article>
    </section>
    <aside className="report-settings"><div className="settings-title"><Filter size={17} /><strong>Options & filters</strong></div>
      <ReportDateRange report={report} patch={patch} />
      <div className="dynamic-report-filters"><div className="filter-section-head"><span>Report filters</span><b>{(report.filters || []).length}</b></div>
        {(report.filters || []).map((filter, index) => {
          const definition = configuredFields.find(field => field.id === filter.field) || { label: filter.field, type: filter.type || "text" };
          const noValue = ["is_blank", "is_not_blank"].includes(filter.operator);
          return <div className="report-filter-card" key={filter.id || `${filter.field}-${index}`}><div><strong>{definition.label}</strong><button onClick={() => patch({ filters: report.filters.filter((_, filterIndex) => filterIndex !== index) })} aria-label={`Remove ${definition.label} filter`}><X size={13} /></button></div>
            <select value={filter.operator} onChange={event => updateFilter(index, { operator: event.target.value })}>{filterOperators(definition.type).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            {!noValue && <FilterValueSelect field={definition} value={filter.value} leads={leads} onChange={value => updateFilter(index, { value })} />}
          </div>;
        })}
        <div className="add-filter-wrap" ref={filterPickerRef}><button className="add-report-filter" onClick={() => setFilterPickerOpen(value => !value)}><Plus size={14} />Add filter</button>
          {filterPickerOpen && <div className="filter-field-picker"><div><Search size={13} /><input autoFocus value={filterSearch} onChange={event => setFilterSearch(event.target.value)} placeholder="Search fields..." /></div><section>{configuredFields.filter(field => field.label.toLowerCase().includes(filterSearch.toLowerCase())).map(field => <button key={field.id} onClick={() => addFilter(field.id)}><span>{field.label}</span><small>{field.type}</small></button>)}</section></div>}
        </div>
      </div>
      <div className="option-toggle"><span><strong>Data labels</strong><small>Show values on the visual</small></span><button className={report.showLabels ? "on" : ""} onClick={() => patch({ showLabels: !report.showLabels })}><i /></button></div>
      <button className="danger-link" disabled={!report.id} onClick={() => { const next = saved.filter(item => item.id !== report.id); writeSavedReports(selectedUnit.id, next); setSaved(next); createNew(); }}><Trash2 size={15} />Delete saved report</button>
    </aside>
    {calculatedOpen && <div className="calculated-backdrop" onMouseDown={() => setCalculatedOpen(false)}><div className="calculated-modal" onMouseDown={event => event.stopPropagation()}>
      <div className="calculated-head"><div><Calculator size={18} /><span><strong>Create calculated field</strong><small>Define a reusable value using report fields</small></span></div><button onClick={() => setCalculatedOpen(false)}><X size={17} /></button></div>
      <label>Field name<input value={calculated.name} onChange={event => setCalculated(current => ({ ...current, name: event.target.value }))} placeholder="e.g. Conversion rate" /></label>
      <label>Formula<textarea value={calculated.formula} onChange={event => setCalculated(current => ({ ...current, formula: event.target.value }))} placeholder="e.g. [Admission Done] / [Total Leads] * 100" /></label>
      <div className="formula-fields"><span>Available fields</span><div>{configuredFields.map(field => <button key={field.id} onClick={() => setCalculated(current => ({ ...current, formula: `${current.formula}${current.formula ? " " : ""}[${field.label}]` }))}>{field.label}</button>)}</div></div>
      <div className="calculated-footer"><button className="secondary" onClick={() => setCalculatedOpen(false)}>Cancel</button><button className="primary" disabled={!calculated.name.trim() || !calculated.formula.trim()} onClick={saveCalculated}>Create field</button></div>
    </div></div>}
  </div>;
}

export function SavedReportsDashboard({ data }) {
  const { selectedUnit } = useBusinessUnit();
  const [reports, setReports] = useState(() => readSavedReports(selectedUnit.id));
  useEffect(() => {
    const handler = () => setReports(readSavedReports(selectedUnit.id));
    window.addEventListener("crm:saved-reports-changed", handler);
    return () => window.removeEventListener("crm:saved-reports-changed", handler);
  }, [selectedUnit.id]);
  if (!reports.length) return <div className="saved-dashboard-empty"><BarChart3 /><h3>No saved reports yet</h3><p>Create a report from the Reports screen and it will appear here for {selectedUnit.name}.</p></div>;
  return <div className="saved-report-grid">{reports.map(report => <article className="panel saved-report-card" key={report.id}><div><span>{TYPES.find(type => type.id === report.type)?.label}</span><h3>{report.title}</h3>{report.description && <p>{report.description}</p>}<SavedReportFilters report={report} /></div><ReportVisual report={report} data={report.generatedData} compact /></article>)}</div>;
}

function SavedReportFilters({ report }) {
  const catalog = report.fieldCatalog || FIELDS;
  const fieldName = id => catalog.find(field => field.id === id)?.label || id;
  const operatorName = operator => ({ equals: "is", not_equals: "is not", contains: "contains", not_contains: "does not contain", greater_than: ">", less_than: "<", before: "before", after: "after", is_blank: "is blank", is_not_blank: "is not blank" }[operator] || operator);
  const chips = [];
  if (report.dateFrom || report.dateTo) {
    const dateName = fieldName(report.dateField || "addedAt");
    chips.push({ key: "date", text: `${dateName}: ${report.dateFrom || "Beginning"} – ${report.dateTo || "Today"}` });
  }
  (report.filters || []).forEach((filter, index) => {
    const values = Array.isArray(filter.value) ? filter.value : filter.value === "" || filter.value === undefined ? [] : [filter.value];
    const valueText = ["is_blank", "is_not_blank"].includes(filter.operator) ? "" : values.length > 2 ? `${values.slice(0, 2).join(", ")} +${values.length - 2}` : values.join(", ");
    chips.push({ key: filter.id || index, text: `${fieldName(filter.field)} ${operatorName(filter.operator)}${valueText ? ` ${valueText}` : ""}` });
  });
  if (!chips.length) return <div className="saved-filter-summary"><span>All records</span></div>;
  return <div className="saved-filter-summary" aria-label="Applied report filters"><strong><Filter size={10} />Applied filters</strong><div>{chips.map(chip => <span key={chip.key} title={chip.text}>{chip.text}</span>)}</div></div>;
}
