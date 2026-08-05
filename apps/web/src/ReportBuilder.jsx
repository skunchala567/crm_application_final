import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown, ArrowLeft, ArrowUp, BarChart3, Calculator, CalendarRange, ChartLine, Check, ChevronDown, ChevronLeft, Columns3, Donut, Filter, Funnel, GripVertical, LayoutGrid, LayoutList,
  ChevronRight, Edit3, MapPinned, Maximize2, MoreHorizontal, PanelLeftClose, PanelLeftOpen, PieChart, Plus, Save, Search, Trash2, X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "./api";
import { useBusinessUnit } from "./BusinessUnitContext.jsx";
import "./ReportBuilder.css";

const TYPES = [
  { id: "cards", label: "Cards", icon: LayoutGrid },
  { id: "table", label: "Table", icon: LayoutList },
  { id: "funnel", label: "Funnel", icon: Funnel },
  { id: "pie", label: "Pie chart", icon: PieChart },
  { id: "donut", label: "Donut chart", icon: Donut },
  { id: "line", label: "Line graph", icon: ChartLine },
  { id: "stacked-column", label: "Stacked column", icon: Columns3 },
  { id: "stacked-bar", label: "Stacked bar", icon: BarChart3 },
  { id: "map", label: "Map", icon: MapPinned },
];
const PALETTE = ["#5b61c4", "#4e8bd8", "#e28a45", "#9b66c7", "#43a486", "#8d96a8", "#d85f70", "#555aaf"];
const SAMPLE_REPORT_DATA = {
  leads: [
    { leadId: "S1", branch: "Nacharam", city: "Hyderabad", latitude: 17.4326, longitude: 78.5583 },
    { leadId: "S2", branch: "Aero City", city: "Hyderabad", latitude: 17.2403, longitude: 78.4294 },
    { leadId: "S3", branch: "Mahendra Hills", city: "Secunderabad", latitude: 17.4603, longitude: 78.5117 },
  ],
  funnel: [
    { label: "New", value: 42, color: PALETTE[0] },
    { label: "Contacted", value: 28, color: PALETTE[1] },
    { label: "Counselling", value: 18, color: PALETTE[2] },
    { label: "Campus Visit", value: 9, color: PALETTE[3] },
  ],
};
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
  { id: "latitude", label: "Latitude", type: "number" }, { id: "longitude", label: "Longitude", type: "number" },
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
function canonicalReportFieldId(id) { return LEAD_FIELD_KEYS[id] || id; }
function uniqueReportFields(fields) {
  const seen = new Set();
  return fields.filter(field => {
    const canonical = canonicalReportFieldId(field.id);
    if (seen.has(canonical)) return false;
    seen.add(canonical);
    field.id = canonical;
    return true;
  });
}
function reportFieldCatalog(report) { return uniqueReportFields([...(report.fieldCatalog?.length ? report.fieldCatalog : FIELDS)]); }
function leadFieldValue(lead, fieldId) {
  if (!lead) return undefined;
  if (["latitude", "longitude"].includes(fieldId)) {
    const location = lead.customValues?.websiteAttribution?.location;
    const direct = lead[fieldId] ?? lead.customValues?.[fieldId] ?? location?.[fieldId];
    if (direct !== null && direct !== undefined && direct !== "") return direct;
  }
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
  const columnParts = lead => columnFields.map((field, index) => displayFieldValue(lead, field, report, report.dateGroups?.[`columns:${index}`] || "month"));
  const columnLabel = lead => columnParts(lead).join(" / ");
  const columnPaths = columnFields.length ? [...new Map(leads.map(lead => [columnLabel(lead), columnParts(lead)])).values()] : [["Value"]];
  const columnNames = columnPaths.map(path => path.join(" / "));
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
    leads,
    funnel: rows.map(row => ({ label: row.label, value: row.total, color: row.color })),
    pivot: { rowLabel: rowFields.map(id => reportFieldCatalog(report).find(field => field.id === id)?.label || id).join(" / ") || "Summary", columns: columnNames, columnPaths, columnLabels: columnFields.map(id => reportFieldCatalog(report).find(field => field.id === id)?.label || id), rows, aggregation: measure.aggregation, showRowTotals: report.showRowTotals !== false, showColumnTotals: report.showColumnTotals === true, valueLabel: reportFieldCatalog(report).find(field => field.id === measure.field)?.label || (report.calculatedFields || []).find(field => field.id === measure.field)?.name || measure.field },
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
function currentCrmUser() {
  try { return JSON.parse(localStorage.getItem("crm_user") || "null"); } catch { return null; }
}
export function canViewSavedReport(report, user = currentCrmUser()) {
  if (!user?.id) return true;
  const createdBy = report.createdByUserId ?? report.ownerUserId;
  const visibleTo = Array.isArray(report.visibleToUserIds) ? report.visibleToUserIds.map(String) : [];
  if (!visibleTo.length && !createdBy) return true;
  return String(createdBy) === String(user.id) || visibleTo.includes(String(user.id));
}
export function readSavedReports(unitId) {
  try {
    const reports = JSON.parse(localStorage.getItem(savedReportsKey(unitId)) || "[]");
    return Array.isArray(reports) ? reports.filter(report => report.generatedAt && report.generatedData) : [];
  } catch { return []; }
}
export function writeSavedReports(unitId, reports) {
  localStorage.setItem(savedReportsKey(unitId), JSON.stringify(reports));
  window.dispatchEvent(new CustomEvent("crm:saved-reports-changed", { detail: { unitId } }));
}

export function buildLiveReportData(report, leads = []) {
  return buildPivotData(filterReportLeads(Array.isArray(leads) ? leads : [], report), report);
}

export function ReportVisual({ report, data, compact = false }) {
  const stages = (data?.funnel || []).filter(item => !report?.stages?.length || report.stages.includes(item.label));
  const values = stages.map((item, index) => ({ ...item, value: Number(item.value || 0), color: report?.colors?.[index] || item.color || PALETTE[index % PALETTE.length] }));
  const total = values.reduce((sum, item) => sum + item.value, 0) || 1;
  if (!values.length) return <div className="report-empty">No data matches these filters.</div>;

  const cardColumns = Math.min(4, Math.max(1, Number(report.cardColumns || (compact ? 2 : 4))));
  if (report.type === "cards") return <div className={`report-cards-visual ${compact ? "compact" : ""}`} style={{ "--report-card-columns": cardColumns }}>
    <article><span>Total</span><strong>{total.toLocaleString()}</strong><small>{report.values?.[0]?.aggregation || "Count"}</small></article>
    {values.slice(0, compact ? 3 : 7).map(item => <article key={item.label}><i style={{ background: item.color }} /><span>{item.label}</span><strong>{item.value.toLocaleString()}</strong><small>{Math.round(item.value / total * 100)}% share</small></article>)}
  </div>;
  if (report.type === "table" && data?.pivot) return <PivotTableVisual pivot={data.pivot} />;
  if (report.type === "table") return (
    <ResizableReportTable
      headers={["Stage", "Lead count", "Share"]}
      rows={values.map(item => [
        <><i style={{ background: item.color }} />{item.label}</>,
        item.value.toLocaleString(),
        `${Math.round(item.value / total * 100)}%`,
      ])}
    />
  );
  if (report.type === "pie" || report.type === "donut") {
    let cursor = 0;
    const gradient = values.map(item => { const start = cursor; cursor += item.value / total * 100; return `${item.color} ${start}% ${cursor}%`; }).join(",");
    return <div className={`pie-report ${report.type === "donut" ? "donut-report" : ""} ${compact ? "compact" : ""}`}><div className="pie-ring" style={{ background: `conic-gradient(${gradient})` }}><span>{total.toLocaleString()}<small>Leads</small></span></div><ChartLegend values={values} total={total} /></div>;
  }
  if (report.type === "line") return <LineReport values={values} compact={compact} showLabels={report.showLabels !== false} />;
  if (report.type === "map") return <MapReport report={report} leads={data?.leads || []} values={values} compact={compact} />;
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
    return <StackedColumnReport pivot={data?.pivot} fallbackValues={values} showLabels={report.showLabels !== false} />;
  }
  if (report.type === "stacked-bar") return <StackedBarReport pivot={data?.pivot} fallbackValues={values} showLabels={report.showLabels !== false} />;
  const max = Math.max(...values.map(item => item.value), 1);
  return <div className="bar-report">{values.map(item => <div className="bar-report-row" key={item.label}><span>{item.label}</span><div><i style={{ width: `${Math.max(2, item.value / max * 100)}%`, background: item.color }} /></div>{report.showLabels !== false && <strong>{item.value}</strong>}</div>)}</div>;
}

function buildStackedMatrix(pivot) {
  if (!pivot?.rows?.length || !pivot?.columns?.length) return null;
  const columns = pivot.columns.map(column => String(column || "Blank"));
  const hasRealColumns = columns.length > 1 || columns[0] !== "Value";
  if (!hasRealColumns) return null;
  const rows = pivot.rows.map((row, rowIndex) => {
    const cells = columns.map((_, index) => Number(row.cells?.[index] || 0));
    const total = Number(row.total || cells.reduce((sum, value) => sum + value, 0));
    return {
      label: row.label || "Blank",
      color: row.color || PALETTE[rowIndex % PALETTE.length],
      cells,
      total,
    };
  });
  return { columns, rows, max: Math.max(...rows.map(row => row.total), 1) };
}

function StackedLegend({ columns }) {
  return <div className="stacked-legend">
    {columns.map((column, index) => <span key={`${column}-${index}`}><i style={{ background: PALETTE[index % PALETTE.length] }} />{column}</span>)}
  </div>;
}

function StackedBarReport({ pivot, fallbackValues, showLabels = true }) {
  const matrix = buildStackedMatrix(pivot);
  if (!matrix) {
    const total = fallbackValues.reduce((sum, item) => sum + item.value, 0) || 1;
    return <div className="stacked-bar-report">
      {fallbackValues.map(item => <div className="stacked-bar-row" key={item.label}>
        <span>{item.label}</span>
        <div className="stacked-bar-track"><i className="stacked-bar-single" style={{ width: `${Math.max(4, item.value / total * 100)}%`, background: item.color }} />{showLabels && <b className="stacked-bar-value">{item.value.toLocaleString()}</b>}</div>
        <small>{Math.round(item.value / total * 100)}%</small>
      </div>)}
    </div>;
  }
  return <div className="stacked-bar-report matrix-stacked-bar">
    <StackedLegend columns={matrix.columns} />
    {matrix.rows.map(row => <div className="stacked-bar-row" key={row.label}>
      <span>{row.label}</span>
      <div className="stacked-bar-track stacked-bar-track-matrix">
        {row.cells.map((value, index) => value > 0 ? <i
          className="stacked-bar-segment"
          key={`${row.label}-${matrix.columns[index]}`}
          title={`${matrix.columns[index]}: ${value.toLocaleString()}`}
          style={{ width: `${Math.max(2, value / Math.max(row.total, 1) * 100)}%`, background: PALETTE[index % PALETTE.length] }}
        >{showLabels && value / Math.max(row.total, 1) >= 0.14 ? <b>{value.toLocaleString()}</b> : null}</i> : null)}
      </div>
      <small>{row.total.toLocaleString()}</small>
    </div>)}
  </div>;
}

function StackedColumnReport({ pivot, fallbackValues, showLabels = true }) {
  const matrix = buildStackedMatrix(pivot);
  if (!matrix) {
    const max = Math.max(...fallbackValues.map(item => item.value), 1);
    return <div className="column-chart"><div className="column-plot">{fallbackValues.map(item => <div className="column-item" key={item.label}><div className="column-value">{showLabels && <b>{item.value}</b>}<i style={{ height: `${Math.max(4, item.value / max * 100)}%`, background: item.color }} /></div><span>{item.label}</span></div>)}</div></div>;
  }
  return <div className="stacked-column-chart">
    <StackedLegend columns={matrix.columns} />
    <div className="stacked-column-plot">
      {matrix.rows.map(row => <div className="stacked-column-item" key={row.label}>
        {showLabels && <b className="stacked-column-total">{row.total.toLocaleString()}</b>}
        <div className="stacked-column-shell">
          <div className="stacked-column-stack" style={{ height: `${Math.max(4, row.total / matrix.max * 100)}%` }}>
            {row.cells.map((value, index) => value > 0 ? <i
              className="stacked-column-segment"
              key={`${row.label}-${matrix.columns[index]}`}
              title={`${matrix.columns[index]}: ${value.toLocaleString()}`}
              style={{ height: `${Math.max(3, value / Math.max(row.total, 1) * 100)}%`, background: PALETTE[index % PALETTE.length] }}
            /> : null)}
          </div>
        </div>
        <span className="stacked-column-label">{row.label}</span>
      </div>)}
    </div>
  </div>;
}

function LineReport({ values, compact = false, showLabels = true }) {
  const width = 620;
  const height = compact ? 210 : 280;
  const pad = 34;
  const max = Math.max(...values.map(item => item.value), 1);
  const points = values.map((item, index) => {
    const x = values.length === 1 ? width / 2 : pad + index * ((width - pad * 2) / (values.length - 1));
    const y = height - pad - (item.value / max) * (height - pad * 2);
    return { ...item, x, y };
  });
  const path = points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
  return <div className={`line-report ${compact ? "compact" : ""}`}>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Line graph report">
      <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} />
      <line x1={pad} y1={pad} x2={pad} y2={height - pad} />
      <path d={path} />
      {points.map(point => <g key={point.label}>
        <circle cx={point.x} cy={point.y} r="5" fill={point.color} />
        {showLabels && <text x={point.x} y={point.y - 10} textAnchor="middle">{point.value.toLocaleString()}</text>}
        <text className="axis-label" x={point.x} y={height - 10} textAnchor="middle">{point.label}</text>
      </g>)}
    </svg>
  </div>;
}

function MapReport({ report, leads = [], values, compact = false }) {
  const [slicers, setSlicers] = useState({});
  const numberValue = (...valuesToCheck) => {
    for (const value of valuesToCheck) {
      if (value !== null && value !== undefined && value !== "" && !Number.isNaN(Number(value))) return Number(value);
    }
    return null;
  };
  const autoValue = (lead, keys) => {
    const custom = lead.customValues || {};
    for (const key of keys) {
      const value = leadFieldValue(lead, key);
      if (value !== null && value !== undefined && value !== "") return value;
      if (custom[key] !== null && custom[key] !== undefined && custom[key] !== "") return custom[key];
    }
    return null;
  };
  const rowFields = report.rows || [];
  const slicerOptions = rowFields.map((field, fieldIndex) => ({
    field,
    label: reportFieldCatalog(report).find(item => item.id === field)?.label || field,
    values: [...new Set(leads.map(lead => displayFieldValue(lead, field, report, report.dateGroups?.[`rows:${fieldIndex}`] || "month")))].filter(value => value !== "Blank").sort(),
  })).filter(item => item.values.length);
  const filteredLeads = leads.filter(lead => rowFields.every((field, fieldIndex) => {
    const selected = slicers[field] || "";
    if (!selected) return true;
    return displayFieldValue(lead, field, report, report.dateGroups?.[`rows:${fieldIndex}`] || "month") === selected;
  }));
  const clearSlicers = () => setSlicers({});
  const points = filteredLeads.map(lead => {
    const custom = lead.customValues || {};
    const latitude = report.mapLatitudeField
      ? numberValue(leadFieldValue(lead, report.mapLatitudeField), custom[report.mapLatitudeField])
      : numberValue(autoValue(lead, ["latitude", "lat", "geoLatitude", "geo_latitude", "location_latitude"]), lead.latitude, lead.lat, lead.geoLatitude, custom.latitude, custom.lat, custom.location_latitude);
    const longitude = report.mapLongitudeField
      ? numberValue(leadFieldValue(lead, report.mapLongitudeField), custom[report.mapLongitudeField])
      : numberValue(autoValue(lead, ["longitude", "lng", "lon", "geoLongitude", "geo_longitude", "location_longitude"]), lead.longitude, lead.lng, lead.lon, lead.geoLongitude, custom.longitude, custom.lng, custom.location_longitude);
    const label = rowFields[0] ? displayFieldValue(lead, rowFields[0], report, report.dateGroups?.["rows:0"] || "month") : (lead.city || lead.branch || lead.studentName || "Captured lead");
    return latitude !== null && longitude !== null ? { latitude, longitude, label } : null;
  }).filter(Boolean);
  const locationValues = points.length ? points.reduce((groups, point) => {
    const key = point.label || `${point.latitude.toFixed(3)}, ${point.longitude.toFixed(3)}`;
    groups[key] = (groups[key] || 0) + 1;
    return groups;
  }, {}) : Object.fromEntries(values.map(item => [item.label, item.value]));
  const rows = Object.entries(locationValues).sort((a, b) => b[1] - a[1]).slice(0, compact ? 5 : 10);
  return <div className={`map-report ${compact ? "compact" : ""}`}>
    {!!slicerOptions.length && <div className="map-slicer-bar">
      {slicerOptions.map(item => <label key={item.field}><span>{item.label}</span><select value={slicers[item.field] || ""} onChange={event => setSlicers(current => ({ ...current, [item.field]: event.target.value }))}><option value="">All {item.label}</option>{item.values.map(value => <option key={value} value={value}>{value}</option>)}</select></label>)}
      {Object.values(slicers).some(Boolean) && <button type="button" onClick={clearSlicers}>Clear slicers</button>}
    </div>}
    {points.length ? <RealMapCanvas points={points} /> : <div className="map-canvas map-empty-canvas">
      {rows.map(([label, count], index) => <span key={label} className="map-pin" style={{ left: `${18 + (index * 17) % 68}%`, top: `${22 + (index * 23) % 55}%`, background: PALETTE[index % PALETTE.length] }} title={`${label}: ${count}`}>
        <i>{count}</i>
      </span>)}
      <strong>Location summary</strong>
      <small>No latitude/longitude found. Select latitude and longitude fields in Options & filters.</small>
    </div>}
    <div className="map-location-list">{rows.map(([label, count], index) => <div key={label}><i style={{ background: PALETTE[index % PALETTE.length] }} /><span>{label}</span><strong>{Number(count).toLocaleString()}</strong></div>)}</div>
  </div>;
}

function RealMapCanvas({ points }) {
  const tileSize = 256;
  const [zoom, setZoom] = useState(() => points.length > 1 ? 10 : 12);
  useEffect(() => setZoom(points.length > 1 ? 10 : 12), [points.length]);
  const changeZoom = direction => setZoom(current => Math.max(4, Math.min(18, current + direction)));
  const latToRad = lat => {
    const sine = Math.sin(lat * Math.PI / 180);
    return Math.log((1 + sine) / (1 - sine)) / 2;
  };
  const project = ({ latitude, longitude }) => {
    const scale = tileSize * 2 ** zoom;
    return {
      x: (longitude + 180) / 360 * scale,
      y: (0.5 - latToRad(Math.max(-85, Math.min(85, latitude))) / (2 * Math.PI)) * scale,
    };
  };
  const center = points.reduce((sum, point) => ({ latitude: sum.latitude + point.latitude / points.length, longitude: sum.longitude + point.longitude / points.length }), { latitude: 0, longitude: 0 });
  const centerPx = project(center);
  const tiles = [-1, 0, 1].flatMap(dx => [-1, 0, 1].map(dy => ({ x: Math.floor(centerPx.x / tileSize) + dx, y: Math.floor(centerPx.y / tileSize) + dy })));
  const viewport = { width: 760, height: 320 };
  const origin = { x: centerPx.x - viewport.width / 2, y: centerPx.y - viewport.height / 2 };
  const pointKey = point => `${point.latitude.toFixed(4)},${point.longitude.toFixed(4)}`;
  const grouped = Object.values(points.reduce((map, point) => {
    const key = pointKey(point);
    map[key] = map[key] || { ...point, count: 0 };
    map[key].count += 1;
    return map;
  }, {}));
  return <div className="map-canvas real-map-canvas" onWheel={event => { event.preventDefault(); changeZoom(event.deltaY < 0 ? 1 : -1); }}>
    <div className="map-zoom-controls"><button type="button" onClick={() => changeZoom(1)} aria-label="Zoom in">+</button><button type="button" onClick={() => changeZoom(-1)} aria-label="Zoom out">−</button></div>
    {tiles.map(tile => <img key={`${tile.x}-${tile.y}`} src={`https://tile.openstreetmap.org/${zoom}/${tile.x}/${tile.y}.png`} style={{ left: `${tile.x * tileSize - origin.x}px`, top: `${tile.y * tileSize - origin.y}px` }} alt="" draggable="false" />)}
    {grouped.map((point, index) => {
      const projected = project(point);
      return <span key={pointKey(point)} className="map-pin" style={{ left: `${projected.x - origin.x}px`, top: `${projected.y - origin.y}px`, background: PALETTE[index % PALETTE.length] }} title={`${point.label}: ${point.count}`}>
        <i>{point.count}</i>
      </span>;
    })}
    <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a>
  </div>;
}

function ResizableReportTable({ headers, rows, className = "" }) {
  const [widths, setWidths] = useState(() => headers.map((_, index) => index === 0 ? 220 : 135));
  useEffect(() => setWidths(headers.map((_, index) => index === 0 ? 220 : 135)), [headers.join("|")]);
  const startResize = (event, index) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = widths[index] || 135;
    const onMove = moveEvent => {
      const nextWidth = Math.max(70, startWidth + moveEvent.clientX - startX);
      setWidths(current => current.map((width, widthIndex) => widthIndex === index ? nextWidth : width));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.classList.remove("resizing-report-column");
    };
    document.body.classList.add("resizing-report-column");
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };
  const normalizedRows = rows.map((row, index) => Array.isArray(row) ? { key: index, cells: row } : row);
  return <div className="report-table-wrap"><table className={`report-table pivot-result resizable-report-table ${className}`}>
    <colgroup>{headers.map((header, index) => <col key={header || index} style={{ width: `${widths[index] || 135}px` }} />)}</colgroup>
    <thead><tr>{headers.map((header, index) => <th key={header || index}><span>{header}</span><button type="button" className="column-resizer" aria-label={`Resize ${header} column`} onMouseDown={event => startResize(event, index)} /></th>)}</tr></thead>
    <tbody>{normalizedRows.map((row, rowIndex) => <tr key={row.key || rowIndex} className={row.className || ""}>{row.cells.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody>
  </table></div>;
}

function PivotTableVisual({ pivot }) {
  const [expanded, setExpanded] = useState(() => new Set());
  const [expandedColumns, setExpandedColumns] = useState(() => new Set());
  const [groupedWidths, setGroupedWidths] = useState([]);
  const format = value => pivot.aggregation === "Percentage" ? `${value.toFixed(1)}%` : Number(value.toFixed(2)).toLocaleString();
  const startGroupedResize = (event, index) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = groupedWidths[index] || (index === 0 ? 220 : 135);
    const onMove = moveEvent => setGroupedWidths(current => {
      const next = [...current];
      next[index] = Math.max(70, startWidth + moveEvent.clientX - startX);
      return next;
    });
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.classList.remove("resizing-report-column");
    };
    document.body.classList.add("resizing-report-column");
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };
  const toggle = path => setExpanded(current => {
    const next = new Set(current);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  });
  const toggleColumn = path => setExpandedColumns(current => {
    const next = new Set(current);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  });
  const rowGroupPaths = rows => rows.flatMap(row => row.children?.length ? [row.path, ...rowGroupPaths(row.children)] : []);
  const renderRows = rows => rows.flatMap(row => {
    const hasChildren = Boolean(row.children?.length);
    const isExpanded = expanded.has(row.path);
    const rendered = [{
      key: row.path,
      className: `pivot-level-${row.level} ${hasChildren ? "pivot-parent" : ""}`,
      cells: [
        <div className="pivot-row-label" style={{ paddingLeft: `${row.level * 22}px` }}>
          {hasChildren ? <button onClick={() => toggle(row.path)} aria-label={`${isExpanded ? "Collapse" : "Expand"} ${row.label}`}>{isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button> : <span className="pivot-indent" />}
          <i style={{ background: row.color }} /><span>{row.label}</span>{hasChildren && <small>({row.children.length})</small>}
        </div>,
        ...row.cells.map(cell => format(cell)),
        ...(pivot.showRowTotals ? [<strong>{format(row.total)}</strong>] : []),
      ],
    }];
    if (hasChildren && isExpanded) rendered.push(...renderRows(row.children));
    return rendered;
  });
  const leafRows = renderRows(pivot.rows);
  const headers = [pivot.rowLabel, ...pivot.columns, ...(pivot.showRowTotals ? ["Total"] : [])];
  if ((pivot.columnPaths || []).some(path => path.length > 1)) {
    const columnPaths = (pivot.columnPaths || pivot.columns.map(column => [column]))
      .map((path, originalIndex) => ({ path, originalIndex }))
      .sort((a, b) => a.path.join("||").localeCompare(b.path.join("||"), undefined, { numeric: true }));
    const topColumnKeys = [...new Set(columnPaths.map(column => column.path[0] || ""))];
    const allRowGroupPaths = rowGroupPaths(pivot.rows);
    const hasRowGroups = allRowGroupPaths.length > 0;
    const hasColumnGroups = topColumnKeys.length > 0;
    const allRowsExpanded = allRowGroupPaths.length > 0 && allRowGroupPaths.every(path => expanded.has(path));
    const allColumnsExpanded = topColumnKeys.length > 0 && topColumnKeys.every(key => expandedColumns.has(key));
    const visibleColumns = [];
    for (let index = 0; index < columnPaths.length; index += 1) {
      const top = columnPaths[index].path[0] || "";
      const isExpanded = expandedColumns.has(top);
      if (!isExpanded) {
        const indices = [];
        while (index < columnPaths.length && (columnPaths[index].path[0] || "") === top) { indices.push(columnPaths[index].originalIndex); index += 1; }
        visibleColumns.push({ path: [top], label: top, indices, collapsed: true });
        index -= 1;
      } else visibleColumns.push({ path: columnPaths[index].path, label: columnPaths[index].path.join(" / "), indices: [columnPaths[index].originalIndex], collapsed: false });
    }
    const maxDepth = Math.max(...visibleColumns.map(column => column.path.length), 1);
    const headerRows = Array.from({ length: maxDepth }, (_, level) => {
      const cells = [];
      for (let index = 0; index < visibleColumns.length; index += 1) {
        const label = visibleColumns[index].path[level] || "";
        let span = 1;
        while (index + span < visibleColumns.length && (visibleColumns[index + span].path[level] || "") === label && visibleColumns[index + span].path.slice(0, level).join("||") === visibleColumns[index].path.slice(0, level).join("||")) span += 1;
        cells.push({ label, span, level, groupKey: level === 0 ? visibleColumns[index].path[0] : "" });
        index += span - 1;
      }
      return cells;
    });
    const visibleRows = leafRows.map(row => ({ ...row, cells: [row.cells[0], ...visibleColumns.map(column => format(column.indices.reduce((sum, cellIndex) => sum + Number(pivot.rows.length ? 0 : 0), 0) || column.indices.reduce((sum, cellIndex) => sum + Number(row.cells[cellIndex + 1] || 0), 0))), ...(pivot.showRowTotals ? [row.cells[row.cells.length - 1]] : [])] }));
    const grandCells = visibleColumns.map(column => format(column.indices.reduce((sum, cellIndex) => sum + pivot.rows.reduce((rowSum, row) => rowSum + Number(row.cells[cellIndex] || 0), 0), 0)));
    const totalColumnIndex = visibleColumns.length + 1;
    return <div className="report-table-wrap"><table className="report-table pivot-result grouped-pivot-table">
      <colgroup><col style={{ width: `${groupedWidths[0] || 220}px` }} />{visibleColumns.map((_, index) => <col key={index} style={{ width: `${groupedWidths[index + 1] || 135}px` }} />)}{pivot.showRowTotals && <col style={{ width: `${groupedWidths[totalColumnIndex] || 110}px` }} />}</colgroup>
      <thead>
        {headerRows.map((row, level) => <tr key={level}>{level === 0 && <th rowSpan={maxDepth}><div className="pivot-row-header-cell"><span>{pivot.rowLabel}</span><div className="pivot-table-tools">{hasRowGroups && <button title={allRowsExpanded ? "Collapse all rows" : "Expand all rows"} aria-label={allRowsExpanded ? "Collapse all rows" : "Expand all rows"} onClick={() => setExpanded(allRowsExpanded ? new Set() : new Set(allRowGroupPaths))}>{allRowsExpanded ? <ChevronRight size={15} /> : <ChevronDown size={15} />}</button>}{hasColumnGroups && <button title={allColumnsExpanded ? "Collapse all columns" : "Expand all columns"} aria-label={allColumnsExpanded ? "Collapse all columns" : "Expand all columns"} onClick={() => setExpandedColumns(allColumnsExpanded ? new Set() : new Set(topColumnKeys))}><Columns3 size={15} />{allColumnsExpanded ? <ChevronRight size={11} /> : <ChevronDown size={11} />}</button>}</div></div><button type="button" className="column-resizer" aria-label="Resize row labels column" onMouseDown={event => startGroupedResize(event, 0)} /></th>}{row.map((cell, index) => <th key={`${level}-${index}`} colSpan={cell.span}>{level === 0 ? <button className="pivot-column-toggle" onClick={() => toggleColumn(cell.groupKey)}>{expandedColumns.has(cell.groupKey) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}{cell.label}</button> : cell.label}{level === maxDepth - 1 && cell.span === 1 && <button type="button" className="column-resizer" aria-label={`Resize ${cell.label} column`} onMouseDown={event => startGroupedResize(event, index + 1)} />}</th>)}{level === 0 && pivot.showRowTotals && <th rowSpan={maxDepth}>Total<button type="button" className="column-resizer" aria-label="Resize total column" onMouseDown={event => startGroupedResize(event, totalColumnIndex)} /></th>}</tr>)}
      </thead>
      <tbody>{visibleRows.map((row, rowIndex) => <tr key={row.key || rowIndex} className={row.className || ""}>{row.cells.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}{pivot.showColumnTotals && <tr className="pivot-grand-total"><td>Grand Total</td>{grandCells.map((cell, index) => <td key={index}>{cell}</td>)}{pivot.showRowTotals && <td>{format(pivot.rows.reduce((sum, row) => sum + row.total, 0))}</td>}</tr>}</tbody>
    </table></div>;
  }
  const simpleRows = leafRows;
  if (pivot.showColumnTotals) {
    simpleRows.push({
      key: "grand-total",
      className: "pivot-grand-total",
      cells: [
        "Grand Total",
        ...pivot.columns.map((_, index) => format(pivot.rows.reduce((sum, row) => sum + Number(row.cells[index] || 0), 0))),
        ...(pivot.showRowTotals ? [format(pivot.rows.reduce((sum, row) => sum + row.total, 0))] : []),
      ],
    });
  }
  return <ResizableReportTable headers={headers} className="pivot-hierarchy-table" rows={simpleRows} />;
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
  const [popoverStyle, setPopoverStyle] = useState({});
  const root = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const positionPopover = () => {
      const rect = root.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(760, window.innerWidth - 32);
      const estimatedHeight = Math.min(500, window.innerHeight - 24);
      const left = Math.max(16, Math.min(rect.right - width, window.innerWidth - width - 16));
      const top = rect.bottom + estimatedHeight + 8 > window.innerHeight ? Math.max(12, rect.top - estimatedHeight - 8) : rect.bottom + 8;
      setPopoverStyle({ width: `${width}px`, left: `${left}px`, top: `${top}px` });
    };
    const close = event => { if (!root.current?.contains(event.target)) setOpen(false); };
    const escape = event => { if (event.key === "Escape") setOpen(false); };
    positionPopover();
    document.addEventListener("mousedown", close, true);
    document.addEventListener("touchstart", close, true);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("resize", positionPopover);
    window.addEventListener("scroll", positionPopover, true);
    return () => {
      document.removeEventListener("mousedown", close, true);
      document.removeEventListener("touchstart", close, true);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", positionPopover);
      window.removeEventListener("scroll", positionPopover, true);
    };
  }, [open]);
  const labels = { addedAt: "Added", updatedAt: "Updated", referredAt: "Referred", nextFollowup: "Next Follow-up", reEnquiredAt: "Re-Enquired" };
  const label = report.dateFrom && report.dateTo ? `${report.dateFrom} â€“ ${report.dateTo}` : report.dateFrom ? `${report.dateFrom} â€“ select end` : report.dateTo ? `Till ${report.dateTo}` : "All dates";
  const select = key => { if (!report.dateFrom || report.dateTo) patch({ dateFrom: key, dateTo: "" }); else if (key < report.dateFrom) patch({ dateFrom: key, dateTo: report.dateFrom }); else patch({ dateTo: key }); };
  const preset = (kind, days = 0) => { const today = new Date(), end = new Date(today); if (kind === "yesterday") { today.setDate(today.getDate() - 1); return patch({ dateFrom: reportDateKey(today), dateTo: reportDateKey(today) }); } if (kind === "till") { end.setDate(end.getDate() - 1); return patch({ dateFrom: "", dateTo: reportDateKey(end) }); } end.setDate(end.getDate() + days); patch({ dateFrom: reportDateKey(today), dateTo: reportDateKey(end) }); };
  const nextMonth = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  return <div className="report-date-range" ref={root}><span>Date range</span><button className={`report-date-trigger ${report.dateFrom || report.dateTo ? "active" : ""}`} onClick={() => setOpen(value => !value)}><CalendarRange size={15} /><div><small>{labels[report.dateField] || "Added"}</small><strong>{label}</strong></div><ChevronDown size={13} /></button>{open && <div className="followup-range-popover report-date-popover" style={popoverStyle}><div className="followup-range-header"><div className="followup-range-title"><CalendarRange size={18} /><div><strong>{labels[report.dateField] || "Added"}</strong><small>Select the report date range</small></div></div><select className="date-type-select-popover" value={report.dateField || "addedAt"} onChange={event => patch({ dateField: event.target.value })}>{Object.entries(labels).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></div><div className="range-calendar-panel"><aside><strong>Choose a period</strong><button onClick={() => preset("today", 0)}>Today</button><button onClick={() => preset("yesterday")}>Yesterday</button><button onClick={() => preset("till")}>Till yesterday</button><button onClick={() => preset("next", 1)}>Next day</button><button onClick={() => preset("next", 7)}>Next 7 days</button><button onClick={() => preset("next", 30)}>Next 30 days</button></aside><div className="range-calendar-months"><ReportCalendarMonth month={month} from={report.dateFrom} to={report.dateTo} onSelect={select} previous move={amount => setMonth(new Date(month.getFullYear(), month.getMonth() + amount, 1))} /><ReportCalendarMonth month={nextMonth} from={report.dateFrom} to={report.dateTo} onSelect={select} next move={amount => setMonth(new Date(month.getFullYear(), month.getMonth() + amount, 1))} /></div></div><div className="followup-range-footer"><button className="range-clear" onClick={() => patch({ dateFrom: "", dateTo: "" })}>Clear</button><button className="range-apply" onClick={() => setOpen(false)}>Apply dates</button></div></div>}</div>;
}

function FilterValueSelect({ field, value, leads, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [popoverStyle, setPopoverStyle] = useState({});
  const root = useRef(null);
  const selected = Array.isArray(value) ? value.map(String) : value === "" || value === undefined ? [] : [String(value)];
  const options = useMemo(() => {
    return [...new Set(leads.map(lead => leadFieldValue(lead, field.id)).filter(item => item !== null && item !== undefined && normalizedFilterText(item) !== "").map(item => String(item).trim()))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [field.id, leads]);
  useEffect(() => {
    if (!open) return undefined;
    const positionPopover = () => {
      const rect = root.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(320, window.innerWidth - 24);
      const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
      const maxHeight = Math.max(180, window.innerHeight - rect.bottom - 18);
      setPopoverStyle({ width: `${width}px`, left: `${left}px`, top: `${rect.bottom + 4}px`, maxHeight: `${maxHeight}px` });
    };
    const close = event => { if (!root.current?.contains(event.target) && !event.target.closest(".filter-values-popover")) setOpen(false); };
    const escape = event => { if (event.key === "Escape") setOpen(false); };
    positionPopover();
    document.addEventListener("mousedown", close, true);
    document.addEventListener("touchstart", close, true);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("resize", positionPopover);
    window.addEventListener("scroll", positionPopover, true);
    return () => {
      document.removeEventListener("mousedown", close, true);
      document.removeEventListener("touchstart", close, true);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", positionPopover);
      window.removeEventListener("scroll", positionPopover, true);
    };
  }, [open]);
  const label = raw => { if (field.type === "boolean") return raw === "true" || raw === "1" ? "Yes" : "No"; if (field.type === "date" || field.type === "datetime") { const date = new Date(raw); return Number.isNaN(date.getTime()) ? raw : date.toLocaleDateString("en-IN"); } return raw; };
  const toggle = option => onChange(selected.includes(option) ? selected.filter(item => item !== option) : [...selected, option]);
  return <div className="filter-value-select" ref={root}><button className={selected.length ? "active" : ""} onClick={() => setOpen(current => !current)}><span>{selected.length ? selected.length === 1 ? label(selected[0]) : `${selected.length} values selected` : "Select values"}</span><ChevronDown size={13} /></button>{open && <div className="filter-values-popover" style={popoverStyle}><div><Search size={12} /><input autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder="Search values..." /></div><section>{options.filter(option => label(option).toLowerCase().includes(search.toLowerCase())).map(option => <button key={option} onClick={() => toggle(option)}><i>{selected.includes(option) && <Check size={11} />}</i><span>{label(option)}</span></button>)}{!options.length && <p>No values available</p>}</section>{selected.length > 0 && <footer><button onClick={() => onChange([])}>Clear selections</button><span>{selected.length} selected</span></footer>}</div>}</div>;
}

export default function ReportBuilder({ data, leads = [], leadFields = [], onModeChange, createNewSignal, returnTo }) {
  const { selectedUnit } = useBusinessUnit();
  const navigate = useNavigate();
  const configuredFields = useMemo(() => {
    const configured = leadFields.map(field => ({
      id: canonicalReportFieldId(field.fieldKey),
      label: field.displayName,
      type: ["number", "decimal", "currency"].includes(String(field.fieldType).toLowerCase()) ? "number" : String(field.fieldType || "text").toLowerCase(),
    }));
    const uniqueConfigured = uniqueReportFields(configured);
    const knownIds = new Set(uniqueConfigured.map(field => canonicalReportFieldId(field.id)));
    const application = APPLICATION_FIELDS.filter(field => !knownIds.has(field.id));
    const catalog = uniqueReportFields([...uniqueConfigured, ...application]);
    const catalogIds = new Set(catalog.map(field => canonicalReportFieldId(field.id)));
    const ignored = new Set(["marketingDeliveries", "marketingDeliveryPairs"]);
    const generated = Object.keys(leads[0] || {}).filter(key => !catalogIds.has(canonicalReportFieldId(key)) && !ignored.has(key) && typeof leads[0]?.[key] !== "object").map(key => ({
      id: canonicalReportFieldId(key),
      label: key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/\b\w/g, letter => letter.toUpperCase()),
      type: typeof leads[0]?.[key] === "number" ? "number" : /(?:At|Date)$/i.test(key) ? "date" : "text",
    }));
    return uniqueReportFields([...catalog, ...generated]);
  }, [leadFields, leads]);
  const defaultReport = { type: "", title: "Untitled report", description: "", dateRange: "All time", dateField: "addedAt", dateFrom: "", dateTo: "", stages: [], filters: [], rows: [], columns: [], values: [], dateGroups: {}, calculatedFields: [], fieldCatalog: configuredFields, cardColumns: 4, showLabels: true, showLegend: true, showRowTotals: true, showColumnTotals: false };
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
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);
  const [viewMode, setViewMode] = useState("list");
  const [reportSearch, setReportSearch] = useState("");
  const [draggedField, setDraggedField] = useState(null);
  const [visibilityOpen, setVisibilityOpen] = useState(false);
  const [visibilityUserIds, setVisibilityUserIds] = useState([]);
  const [visibilityUsers, setVisibilityUsers] = useState([]);
  const [pendingSaveItem, setPendingSaveItem] = useState(null);
  useEffect(() => { onModeChange?.(viewMode === "builder"); }, [onModeChange, viewMode]);
  useEffect(() => {
    let ignore = false;
    api("/admin/users")
      .then(result => {
        if (ignore) return;
        const activeUsers = (result.data || []).filter(user => user.isActive !== false);
        setVisibilityUsers(activeUsers);
      })
      .catch(() => {
        const user = currentCrmUser();
        setVisibilityUsers(user ? [{ id: user.id, name: user.name, email: user.email, role: user.role, isActive: true }] : []);
      });
    return () => { ignore = true; };
  }, []);
  useEffect(() => {
    if (!fieldPicker) return undefined;
    const close = event => {
      if (!event.target.closest(".field-picker") && !event.target.closest(".add-field")) {
        setFieldPicker("");
        setFieldSearch("");
      }
    };
    const escape = event => { if (event.key === "Escape") { setFieldPicker(""); setFieldSearch(""); } };
    document.addEventListener("mousedown", close, true);
    document.addEventListener("touchstart", close, true);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("mousedown", close, true);
      document.removeEventListener("touchstart", close, true);
      document.removeEventListener("keydown", escape, true);
    };
  }, [fieldPicker]);
  useEffect(() => {
    if (!filterPickerOpen) return undefined;
    const close = event => {
      if (!filterPickerRef.current?.contains(event.target)) {
        setFilterPickerOpen(false);
        setFilterSearch("");
      }
    };
    const escape = event => { if (event.key === "Escape") { setFilterPickerOpen(false); setFilterSearch(""); } };
    document.addEventListener("mousedown", close, true);
    document.addEventListener("touchstart", close, true);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("mousedown", close, true);
      document.removeEventListener("touchstart", close, true);
      document.removeEventListener("keydown", escape, true);
    };
  }, [filterPickerOpen]);
  const patch = values => {
    setReport(current => ({ ...current, ...values }));
    if (Object.keys(values).some(key => !["title", "description"].includes(key))) {
      setGeneratedReport(null);
      setGeneratedData(null);
    }
  };
  const persistSavedReport = item => {
    const existingIndex = saved.findIndex(existing => existing.id === item.id);
    const next = existingIndex >= 0
      ? saved.map(existing => existing.id === item.id ? item : existing)
      : [item, ...saved];
    writeSavedReports(selectedUnit.id, next); setSaved(next); setReport(item); setNotice("Report saved to this business unit");
    window.dispatchEvent(new Event("crm:saved-reports-changed"));
    setTimeout(() => setNotice(""), 2600);
  };
  const save = () => {
    if (!generatedReport || !generatedData) return;
    const currentUser = currentCrmUser();
    const existingVisibility = Array.isArray(report.visibleToUserIds) ? report.visibleToUserIds : currentUser?.id ? [currentUser.id] : [];
    const item = { ...generatedReport, id: report.id || generatedReport.id || `${Date.now()}`, title: report.title, description: report.description, generatedData, generatedAt: generatedReport.generatedAt, updatedAt: new Date().toISOString(), businessUnitId: selectedUnit.id, createdByUserId: report.createdByUserId || currentUser?.id || null, createdByName: report.createdByName || currentUser?.name || "", visibleToUserIds: returnTo === "dashboard-saved" ? (currentUser?.id ? [currentUser.id] : []) : existingVisibility };
    if (returnTo === "dashboard-saved") {
      persistSavedReport(item);
      return;
    }
    setPendingSaveItem(item);
    setVisibilityUserIds(item.visibleToUserIds.map(String));
    setVisibilityOpen(true);
  };
  const confirmVisibilitySave = () => {
    if (!pendingSaveItem) return;
    const currentUser = currentCrmUser();
    const selected = [...new Set([...(currentUser?.id ? [String(currentUser.id)] : []), ...visibilityUserIds.map(String)])];
    persistSavedReport({ ...pendingSaveItem, visibleToUserIds: selected });
    setVisibilityOpen(false);
    setPendingSaveItem(null);
  };
  const createNew = () => { setReport({ ...defaultReport }); setGeneratedReport(null); setGeneratedData(null); setViewMode("builder"); };
  useEffect(() => {
    if (!createNewSignal) return;
    createNew();
  }, [createNewSignal]);
  const editSavedReport = item => {
    setReport(item);
    setGeneratedReport(item);
    setGeneratedData(buildLiveReportData(item, leads));
    setViewMode("builder");
  };
  const deleteSavedReport = item => {
    if (!window.confirm(`Delete saved report "${item.title || "Untitled report"}"?`)) return;
    const next = saved.filter(reportItem => reportItem.id !== item.id);
    writeSavedReports(selectedUnit.id, next);
    setSaved(next);
    if (report.id === item.id) {
      setReport({ ...defaultReport });
      setGeneratedReport(null);
      setGeneratedData(null);
    }
  };
  const moveSavedReport = (item, direction) => {
    const fromIndex = saved.findIndex(reportItem => reportItem.id === item.id);
    const toIndex = fromIndex + direction;
    if (fromIndex < 0 || toIndex < 0 || toIndex >= saved.length) return;
    const next = [...saved];
    [next[fromIndex], next[toIndex]] = [next[toIndex], next[fromIndex]];
    writeSavedReports(selectedUnit.id, next);
    setSaved(next);
  };
  const fieldLabel = id => [...configuredFields, ...(report.calculatedFields || []).map(item => ({ id: item.id, label: item.name }))].find(field => field.id === canonicalReportFieldId(id))?.label || id;
  const addField = (shelf, field) => {
    if (!field) return;
    field = canonicalReportFieldId(field);
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
  const moveField = (shelf, fromIndex, toIndex) => {
    const currentItems = [...(report[shelf] || [])];
    if (toIndex < 0 || toIndex >= currentItems.length || fromIndex === toIndex) return;
    const [item] = currentItems.splice(fromIndex, 1);
    currentItems.splice(toIndex, 0, item);
    const nextGroups = Object.fromEntries(Object.entries(report.dateGroups || {}).filter(([key]) => !key.startsWith(`${shelf}:`)));
    currentItems.forEach((_, nextIndex) => {
      const previousIndex = nextIndex === toIndex ? fromIndex
        : fromIndex < toIndex && nextIndex >= fromIndex && nextIndex < toIndex ? nextIndex + 1
        : fromIndex > toIndex && nextIndex > toIndex && nextIndex <= fromIndex ? nextIndex - 1
        : nextIndex;
      const value = report.dateGroups?.[`${shelf}:${previousIndex}`];
      if (value) nextGroups[`${shelf}:${nextIndex}`] = value;
    });
    patch({ [shelf]: currentItems, dateGroups: nextGroups });
  };
  const dropField = (shelf, toIndex) => {
    if (!draggedField || draggedField.shelf !== shelf) return;
    moveField(shelf, draggedField.index, toIndex);
    setDraggedField(null);
  };
  const saveCalculated = () => {
    if (!calculated.name.trim() || !calculated.formula.trim()) return;
    const field = { id: `calc_${Date.now()}`, name: calculated.name.trim(), formula: calculated.formula.trim() };
    patch({ calculatedFields: [...(report.calculatedFields || []), field], values: [...(report.values || []), { field: field.id, aggregation: "Sum" }] });
    setCalculated({ name: "", formula: "" }); setCalculatedOpen(false);
  };
  const addFilter = field => {
    field = canonicalReportFieldId(field);
    const definition = configuredFields.find(item => item.id === canonicalReportFieldId(field));
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
  const liveSavedReports = saved
    .filter(item => `${item.title || ""} ${item.description || ""}`.toLowerCase().includes(reportSearch.toLowerCase().trim()))
    .map(item => ({ ...item, liveData: buildLiveReportData(item, leads) }));
  if (viewMode === "list") return <section className="reports-home">
    <div className="reports-home-head">
      <label className="report-search"><Search size={15} /><input value={reportSearch} onChange={event => setReportSearch(event.target.value)} placeholder="Search reports..." /></label>
      <button className="primary" onClick={createNew}><Plus size={16} />New report</button>
    </div>
    {liveSavedReports.length ? <div className="saved-report-grid reports-library-grid">{liveSavedReports.map(item => {
      const savedIndex = saved.findIndex(reportItem => reportItem.id === item.id);
      return <article className="panel saved-report-card reports-library-card" key={item.id}>
      <div className="saved-card-head">
        <div><span>{TYPES.find(type => type.id === item.type)?.label || "Report"}</span><h3>{item.title || "Untitled report"}</h3>{item.description && <p>{item.description}</p>}<SavedReportFilters report={item} /></div>
        <div className="report-card-actions">
          <button type="button" onClick={() => moveSavedReport(item, -1)} disabled={savedIndex <= 0} title="Move report up" aria-label={`Move ${item.title || "saved report"} up`}><ArrowUp size={14} /></button>
          <button type="button" onClick={() => moveSavedReport(item, 1)} disabled={savedIndex < 0 || savedIndex >= saved.length - 1} title="Move report down" aria-label={`Move ${item.title || "saved report"} down`}><ArrowDown size={14} /></button>
          <button type="button" onClick={() => editSavedReport(item)} title="Edit report" aria-label={`Edit ${item.title || "saved report"}`}><Edit3 size={14} /></button>
          <button type="button" className="danger" onClick={() => deleteSavedReport(item)} title="Delete report" aria-label={`Delete ${item.title || "saved report"}`}><Trash2 size={14} /></button>
        </div>
      </div>
      <ReportVisual report={item} data={item.liveData} compact />
    </article>;
    })}</div> : <div className="saved-dashboard-empty reports-home-empty"><BarChart3 /><h3>{saved.length ? "No reports match your search" : "No saved reports yet"}</h3><p>{saved.length ? "Try searching another report name or description." : `Create your first custom report for ${selectedUnit.name}.`}</p>{!saved.length && <button className="primary" onClick={createNew}><Plus size={16} />New report</button>}</div>}
  </section>;
  const backToPrevious = () => {
    if (returnTo === "dashboard-saved") {
      navigate("/", { replace: true, state: { dashboardTab: "saved" } });
      return;
    }
    setViewMode("list");
  };
  const selectedType = TYPES.find(type => type.id === report.type);
  const SelectedPreviewIcon = selectedType?.icon || BarChart3;
  const previewReport = selectedType ? { ...defaultReport, ...report, type: report.type, title: `${selectedType.label} preview`, rows: report.rows?.length ? report.rows : ["branch"], values: report.values?.length ? report.values : [{ field: "leadId", aggregation: "Count" }], showLabels: true } : null;
  return <div className="report-studio builder-focus">
    <aside className="report-library">
      <button className="panel-collapse-btn library-toggle" type="button" onClick={() => setLibraryCollapsed(value => !value)} aria-label={libraryCollapsed ? "Expand saved reports" : "Collapse saved reports"} title={libraryCollapsed ? "Expand saved reports" : "Collapse saved reports"}>{libraryCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}</button>
      <button className="primary full" onClick={createNew}><Plus size={16} /> New report</button>
      <button className="secondary full library-back" onClick={() => setViewMode("list")}><LayoutList size={15} /> Saved reports</button>
      <div className="library-title"><span>Saved reports</span><b>{saved.length}</b></div>
      <div className="saved-report-list">{saved.map(item => { const TypeIcon = TYPES.find(type => type.id === item.type)?.icon || BarChart3; return <button key={item.id} className={item.id === report.id ? "active" : ""} onClick={() => editSavedReport(item)}><TypeIcon size={16} /><span><strong>{item.title}</strong><small>{TYPES.find(type => type.id === item.type)?.label}</small></span><MoreHorizontal size={15} /></button>; })}{!saved.length && <p>No saved reports yet.<br />Build your first one.</p>}</div>
    </aside>
    <section className="report-canvas">
      <div className="report-canvas-head">
        <div><button className="builder-back-btn" type="button" onClick={backToPrevious}><ArrowLeft size={15} />{returnTo === "dashboard-saved" ? "Back to saved reports" : "Back to reports"}</button><span className="report-kicker">Report builder</span><input value={report.title} onChange={event => patch({ title: event.target.value })} aria-label="Report title" /><input className="report-description" value={report.description} onChange={event => patch({ description: event.target.value })} placeholder="Add a description" aria-label="Report description" /></div>
        <div>{notice && <span className="save-notice"><Check size={14} />{notice}</span>}<div className="visual-picker action-visual-picker">{TYPES.map(type => <button key={type.id} className={report.type === type.id ? "active" : ""} onClick={() => patch({ type: type.id })} title={type.label} aria-label={type.label}><type.icon size={18} /><span>{type.label}</span></button>)}</div><button className="generate-report" onClick={generate} disabled={generating || !report.values?.length || (!report.rows?.length && !report.columns?.length)}>{generating ? "Generating…" : "Generate report"}<BarChart3 size={15} /></button><button className="primary" disabled={!generatedReport || !generatedData} onClick={save}><Save size={16} />Save report</button></div>
      </div>
      <article className="report-preview panel">{generatedReport && generatedData ? <><div className="preview-heading"><div><h2>{generatedReport.title || "Untitled report"}</h2><p>{generatedReport.description}</p></div><span>Generated preview · {generatedReport.dateRange}</span></div><ReportVisual report={generatedReport} data={generatedData} /></> : selectedType ? <div className="blank-report-preview chart-type-preview"><div className="sample-preview-heading"><SelectedPreviewIcon size={18} /><span><strong>{selectedType.label} preview</strong><small>Sample view only. Add fields and click Generate report to see live data.</small></span></div><ReportVisual report={previewReport} data={SAMPLE_REPORT_DATA} compact={false} /></div> : <div className="blank-report-preview"><BarChart3 /><h3>Start creating your pivot report</h3><p>Select a chart type, add fields to Rows and Values, then click <strong>Generate report</strong>.</p></div>}</article>
    </section>
    <aside className="report-settings"><div className="settings-title"><Filter size={17} /><strong>Options & filters</strong></div>
      <div className="pivot-shelves settings-pivot-shelves">
        {["rows", "columns", "values"].map(shelf => <div className="pivot-shelf" key={shelf}>
          <label>{shelf === "values" ? "Values / Measures" : shelf}</label>
          <div className="shelf-box">
            {(report[shelf] || []).map((item, index) => {
              const field = shelf === "values" ? item.field : item;
              const definition = configuredFields.find(candidate => candidate.id === canonicalReportFieldId(field));
              const isDateDimension = shelf !== "values" && ["date", "datetime"].includes(definition?.type);
              return <div className={`field-chip ${draggedField?.shelf === shelf && draggedField.index === index ? "dragging" : ""}`} key={`${field}-${index}`} draggable onDragStart={() => setDraggedField({ shelf, index })} onDragOver={event => event.preventDefault()} onDrop={() => dropField(shelf, index)} onDragEnd={() => setDraggedField(null)}><GripVertical className="field-drag-handle" size={13} /><span>{fieldLabel(field)}</span>
                {shelf === "values" && <select value={item.aggregation} onChange={event => patch({ values: report.values.map((value, valueIndex) => valueIndex === index ? { ...value, aggregation: event.target.value } : value) })}>{AGGREGATIONS.map(option => <option key={option}>{option}</option>)}</select>}
                {isDateDimension && <select className="date-group-select" value={report.dateGroups?.[`${shelf}:${index}`] || "month"} onChange={event => patch({ dateGroups: { ...(report.dateGroups || {}), [`${shelf}:${index}`]: event.target.value } })} aria-label={`Group ${fieldLabel(field)}`}><option value="month">By month</option><option value="date">By date</option></select>}
                <button className="field-move-btn" disabled={index === 0} onClick={() => moveField(shelf, index, index - 1)} aria-label={`Move ${fieldLabel(field)} up`}><ArrowUp size={11} /></button>
                <button className="field-move-btn" disabled={index === (report[shelf] || []).length - 1} onClick={() => moveField(shelf, index, index + 1)} aria-label={`Move ${fieldLabel(field)} down`}><ArrowDown size={11} /></button>
                <button onClick={() => removeField(shelf, index)} aria-label={`Remove ${fieldLabel(field)}`}><X size={12} /></button>
              </div>;
            })}
            <button className="add-field" onClick={() => setFieldPicker(fieldPicker === shelf ? "" : shelf)}><Plus size={13} />Add field</button>
            {shelf === "values" && <button className="calculated-icon-btn" onClick={() => setCalculatedOpen(true)} title="Calculated field" aria-label="Calculated field"><Calculator size={14} /></button>}
            {fieldPicker === shelf && <div className="field-picker"><div><Search size={13} /><input autoFocus value={fieldSearch} onChange={event => setFieldSearch(event.target.value)} placeholder="Search fields..." /></div>
              <section>{[...configuredFields, ...(report.calculatedFields || []).map(item => ({ id: item.id, label: item.name, type: "calculated" }))].filter(field => field.label.toLowerCase().includes(fieldSearch.toLowerCase())).map(field => <button key={field.id} onClick={() => addField(shelf, field.id)}><span>{field.label}</span><small>{field.type}</small></button>)}</section>
            </div>}
          </div>
        </div>)}
      </div>
      <p className="settings-builder-note">Choose Rows, Columns and Values, then generate the report.</p>
      {report.type === "cards" && <label className="report-card-columns-setting">Cards per row<select value={report.cardColumns || 4} onChange={event => patch({ cardColumns: Number(event.target.value) })}><option value="1">1 per row</option><option value="2">2 per row</option><option value="3">3 per row</option><option value="4">4 per row</option></select></label>}
      {report.type === "map" && <div className="map-field-options">
        <label>Latitude field<select value={report.mapLatitudeField || ""} onChange={event => patch({ mapLatitudeField: event.target.value })}><option value="">Auto detect latitude</option>{configuredFields.map(field => <option key={field.id} value={field.id}>{field.label}</option>)}</select></label>
        <label>Longitude field<select value={report.mapLongitudeField || ""} onChange={event => patch({ mapLongitudeField: event.target.value })}><option value="">Auto detect longitude</option>{configuredFields.map(field => <option key={field.id} value={field.id}>{field.label}</option>)}</select></label>
      </div>}
      <ReportDateRange report={report} patch={patch} />
      <div className="dynamic-report-filters"><div className="filter-section-head"><span>Report filters</span><b>{(report.filters || []).length}</b></div>
        {(report.filters || []).map((filter, index) => {
          const definition = configuredFields.find(field => field.id === canonicalReportFieldId(filter.field)) || { label: filter.field, type: filter.type || "text" };
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
      <div className="option-toggle"><span><strong>Row totals</strong><small>Show total column on table reports</small></span><button className={report.showRowTotals !== false ? "on" : ""} onClick={() => patch({ showRowTotals: report.showRowTotals === false })}><i /></button></div>
      <div className="option-toggle"><span><strong>Column totals</strong><small>Show grand total row on table reports</small></span><button className={report.showColumnTotals ? "on" : ""} onClick={() => patch({ showColumnTotals: !report.showColumnTotals })}><i /></button></div>
      <button className="danger-link" disabled={!report.id} onClick={() => deleteSavedReport(report)}><Trash2 size={15} />Delete saved report</button>
    </aside>
    {calculatedOpen && <div className="calculated-backdrop" onMouseDown={() => setCalculatedOpen(false)}><div className="calculated-modal" onMouseDown={event => event.stopPropagation()}>
      <div className="calculated-head"><div><Calculator size={18} /><span><strong>Create calculated field</strong><small>Define a reusable value using report fields</small></span></div><button onClick={() => setCalculatedOpen(false)}><X size={17} /></button></div>
      <label>Field name<input value={calculated.name} onChange={event => setCalculated(current => ({ ...current, name: event.target.value }))} placeholder="e.g. Conversion rate" /></label>
      <label>Formula<textarea value={calculated.formula} onChange={event => setCalculated(current => ({ ...current, formula: event.target.value }))} placeholder="e.g. [Admission Done] / [Total Leads] * 100" /></label>
      <div className="formula-fields"><span>Available fields</span><div>{configuredFields.map(field => <button key={field.id} onClick={() => setCalculated(current => ({ ...current, formula: `${current.formula}${current.formula ? " " : ""}[${field.label}]` }))}>{field.label}</button>)}</div></div>
      <div className="calculated-footer"><button className="secondary" onClick={() => setCalculatedOpen(false)}>Cancel</button><button className="primary" disabled={!calculated.name.trim() || !calculated.formula.trim()} onClick={saveCalculated}>Create field</button></div>
    </div></div>}
    {visibilityOpen && <div className="calculated-backdrop" onMouseDown={() => setVisibilityOpen(false)}><div className="calculated-modal report-visibility-modal" onMouseDown={event => event.stopPropagation()}>
      <div className="calculated-head"><div><Filter size={18} /><span><strong>Saved report visibility</strong><small>Select who can view this report in Dashboard Saved Reports</small></span></div><button onClick={() => setVisibilityOpen(false)}><X size={17} /></button></div>
      <div className="visibility-user-list">
        {visibilityUsers.map(user => {
          const currentUser = currentCrmUser();
          const isCreator = String(user.id) === String(currentUser?.id);
          const checked = isCreator || visibilityUserIds.map(String).includes(String(user.id));
          return <button type="button" key={user.id} className={checked ? "selected" : ""} onClick={() => {
            if (isCreator) return;
            const id = String(user.id);
            setVisibilityUserIds(current => current.map(String).includes(id) ? current.filter(item => String(item) !== id) : [...current, id]);
          }}>
            <i>{checked && <Check size={12} />}</i>
            <span><strong>{user.name || user.email}</strong><small>{[user.email, user.role || user.roles?.join(", ")].filter(Boolean).join(" · ")}</small></span>
            {isCreator && <b>Creator</b>}
          </button>;
        })}
        {!visibilityUsers.length && <p>No users found. This report will be visible only to you.</p>}
      </div>
      <div className="calculated-footer"><button className="secondary" onClick={() => setVisibilityOpen(false)}>Cancel</button><button className="primary" onClick={confirmVisibilitySave}>Save visibility</button></div>
    </div></div>}
  </div>;
}

export function SavedReportsDashboard({ data, leads = [], onCreateNew }) {
  const { selectedUnit } = useBusinessUnit();
  const [reports, setReports] = useState(() => readSavedReports(selectedUnit.id));
  const [expandedReport, setExpandedReport] = useState(null);
  const [dashboardReportSearch, setDashboardReportSearch] = useState("");
  const liveReports = useMemo(() => reports
    .filter(report => canViewSavedReport(report))
    .filter(report => `${report.title || ""} ${report.description || ""}`.toLowerCase().includes(dashboardReportSearch.toLowerCase().trim()))
    .map(report => ({ ...report, liveData: buildLiveReportData(report, leads) })), [reports, leads, dashboardReportSearch]);
  const expandedLiveReport = expandedReport ? liveReports.find(report => report.id === expandedReport.id) || { ...expandedReport, liveData: buildLiveReportData(expandedReport, leads) } : null;
  useEffect(() => {
    const handler = () => setReports(readSavedReports(selectedUnit.id));
    window.addEventListener("crm:saved-reports-changed", handler);
    return () => window.removeEventListener("crm:saved-reports-changed", handler);
  }, [selectedUnit.id]);
  useEffect(() => {
    if (!expandedReport) return undefined;
    const onKeyDown = event => {
      if (event.key === "Escape") setExpandedReport(null);
    };
    document.body.classList.add("report-expanded-open");
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.classList.remove("report-expanded-open");
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [expandedReport]);
  if (!reports.length) return <div className="saved-dashboard-empty"><BarChart3 /><h3>No saved reports yet</h3><p>Create a report from the Reports screen and it will appear here for {selectedUnit.name}.</p>{onCreateNew && <button className="primary" onClick={onCreateNew}><Plus size={16} />New report</button>}</div>;
  return <>
    <div className="saved-dashboard-toolbar">
      {onCreateNew && <button className="primary" onClick={onCreateNew}><Plus size={16} />New report</button>}
      <label className="report-search"><Search size={15} /><input value={dashboardReportSearch} onChange={event => setDashboardReportSearch(event.target.value)} placeholder="Search saved reports..." /></label>
    </div>
    {!liveReports.length && <div className="saved-dashboard-empty"><BarChart3 /><h3>No reports match your search</h3><p>Try another report name or description.</p></div>}
    <div className="saved-report-grid">{liveReports.map(report => <article className="panel saved-report-card" key={report.id}>
      <div className="saved-card-head">
        <div><span>{TYPES.find(type => type.id === report.type)?.label}</span><h3>{report.title}</h3>{report.description && <p>{report.description}</p>}<SavedReportFilters report={report} /></div>
        <button className="saved-expand-btn" type="button" onClick={() => setExpandedReport(report)} aria-label={`Expand ${report.title || "saved report"}`} title="Expand report"><Maximize2 size={15} /></button>
      </div>
      <ReportVisual report={report} data={report.liveData} compact />
    </article>)}</div>
    {expandedLiveReport && <div className="report-fullscreen-backdrop" role="dialog" aria-modal="true" aria-label={`${expandedLiveReport.title || "Saved report"} expanded view`}>
      <section className="report-fullscreen-panel">
        <header className="report-fullscreen-head">
          <div>
            <span>{TYPES.find(type => type.id === expandedLiveReport.type)?.label}</span>
            <h2>{expandedLiveReport.title || "Untitled report"}</h2>
            {expandedLiveReport.description && <p>{expandedLiveReport.description}</p>}
          </div>
          <div className="report-fullscreen-tools">
            <SavedReportFilters report={expandedLiveReport} align="right" />
            <button className="saved-expand-btn close" type="button" onClick={() => setExpandedReport(null)} aria-label="Close expanded report" title="Close"><X size={17} /></button>
          </div>
        </header>
        <div className="report-fullscreen-body saved-report-viewer-body">
          <div className="saved-report-viewer-visual">
            <ReportVisual report={expandedLiveReport} data={expandedLiveReport.liveData} />
          </div>
          <ReadOnlyReportOptions report={expandedLiveReport} />
        </div>
      </section>
    </div>}
  </>;
}

function ReadOnlyReportOptions({ report }) {
  const catalog = reportFieldCatalog(report);
  const fieldName = id => catalog.find(field => field.id === id)?.label || (report.calculatedFields || []).find(field => field.id === id)?.name || id;
  const dateLabels = Object.fromEntries(catalog.filter(field => ["date", "datetime"].includes(field.type)).map(field => [field.id, field.label]));
  const dateSummary = report.dateFrom || report.dateTo ? `${report.dateFrom || "Beginning"} - ${report.dateTo || "Today"}` : "All dates";
  const renderShelf = (title, items, type) => <section className="readonly-report-section">
    <h4>{title}</h4>
    {items?.length ? <div className="readonly-chip-list">{items.map((item, index) => {
      const field = type === "values" ? item.field : item;
      const dateGroup = report.dateGroups?.[`${type}:${index}`];
      return <span key={`${field}-${index}`} className="readonly-report-chip">
        <strong>{fieldName(field)}</strong>
        {type === "values" && <small>{item.aggregation || "Count"}</small>}
        {dateGroup && <small>{dateGroup === "date" ? "By date" : "By month"}</small>}
      </span>;
    })}</div> : <p>Not selected</p>}
  </section>;
  return <aside className="readonly-report-options" aria-label="Saved report options and filters">
    <div className="settings-title"><Filter size={17} /><strong>Options & filters</strong></div>
    {renderShelf("Rows", report.rows || [], "rows")}
    {renderShelf("Columns", report.columns || [], "columns")}
    {renderShelf("Values / Measures", report.values || [], "values")}
    <section className="readonly-report-section">
      <h4>Date range</h4>
      <div className="readonly-date-card"><CalendarRange size={15} /><span><small>{dateLabels[report.dateField] || fieldName(report.dateField || "addedAt")}</small><strong>{dateSummary}</strong></span></div>
    </section>
    <section className="readonly-report-section">
      <h4>Report filters</h4>
      <SavedReportFilters report={report} />
    </section>
    <div className="readonly-option-row"><span>Data labels</span><b>{report.showLabels === false ? "Off" : "On"}</b></div>
    {report.type === "table" && <><div className="readonly-option-row"><span>Row totals</span><b>{report.showRowTotals === false ? "Off" : "On"}</b></div><div className="readonly-option-row"><span>Column totals</span><b>{report.showColumnTotals ? "On" : "Off"}</b></div></>}
    <p className="readonly-note">View only. Changes can be made from the Reports builder.</p>
  </aside>;
}

function SavedReportFilters({ report, align = "left" }) {
  const catalog = report.fieldCatalog || FIELDS;
  const fieldName = id => catalog.find(field => field.id === id)?.label || id;
  const operatorName = operator => ({ equals: "is", not_equals: "is not", contains: "contains", not_contains: "does not contain", greater_than: ">", less_than: "<", before: "before", after: "after", is_blank: "is blank", is_not_blank: "is not blank" }[operator] || operator);
  const chips = [];
  if (report.dateFrom || report.dateTo) {
    const dateName = fieldName(report.dateField || "addedAt");
    chips.push({ key: "date", text: `${dateName}: ${report.dateFrom || "Beginning"} â€“ ${report.dateTo || "Today"}` });
  }
  (report.filters || []).forEach((filter, index) => {
    const values = Array.isArray(filter.value) ? filter.value : filter.value === "" || filter.value === undefined ? [] : [filter.value];
    const valueText = ["is_blank", "is_not_blank"].includes(filter.operator) ? "" : values.length > 2 ? `${values.slice(0, 2).join(", ")} +${values.length - 2}` : values.join(", ");
    chips.push({ key: filter.id || index, text: `${fieldName(filter.field)} ${operatorName(filter.operator)}${valueText ? ` ${valueText}` : ""}` });
  });
  if (!chips.length) return <div className={`saved-filter-summary ${align === "right" ? "right" : ""}`}><span>All records</span></div>;
  return <div className={`saved-filter-summary ${align === "right" ? "right" : ""}`} aria-label="Applied report filters"><strong><Filter size={10} />Applied filters</strong><div>{chips.map(chip => <span key={chip.key} title={chip.text}>{chip.text}</span>)}</div></div>;
}
