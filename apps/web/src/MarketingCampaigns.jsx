import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Ban,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  FileUp,
  Loader,
  MessageCircle,
  Pause,
  Play,
  Plus,
  Send,
} from "lucide-react";
import { api } from "./api";
import { MultiSearchSelect } from "./FilterWorkspace.jsx";
import "./MarketingCampaigns.css";

const weekdays = [
  ["0", "Sun"],
  ["1", "Mon"],
  ["2", "Tue"],
  ["3", "Wed"],
  ["4", "Thu"],
  ["5", "Fri"],
  ["6", "Sat"],
];

function currentSchedule() {
  return new Date()
    .toLocaleString("sv-SE", { timeZone: "Asia/Kolkata", hour12: false })
    .replace(" ", "T")
    .slice(0, 16);
}

function blankTouch() {
  return {
    templateId: "",
    templateBody: "",
    templateParams: [],
    mediaUrl: "",
    mediaFilename: "",
  };
}

export function MarketingCampaignBuilder({
  meta,
  onClose,
  onCreated,
  leadIds = null,
}) {
  const [form, setForm] = useState({
    name: "",
    ruleType: "days_gap",
    communicationCount: 1,
    firstCommunicationAt: currentSchedule(),
    gapDays: 1,
    weekdays: [],
    calendarDates: [currentSchedule()],
    integrationId: "",
    responseOwner: "sender",
    retryAttempts: 0,
    phoneTypes: ["primary"],
    audienceFilters: { branchIds: [], stageIds: [], sourceIds: [] },
    touches: [blankTouch()],
  });
  const [integrations, setIntegrations] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [saving, setSaving] = useState(false);
  const [uploadingTouch, setUploadingTouch] = useState(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    api("/whatsapp/integrations?provider=SMARTPING")
      .then((result) =>
        setIntegrations(
          (result.data || []).filter((item) => item.has_credentials),
        ),
      )
      .catch((error) => setNotice(error.message));
  }, []);

  useEffect(() => {
    if (!form.integrationId) {
      setTemplates([]);
      return;
    }
    api(
      `/whatsapp/integrations/${form.integrationId}/templates?limit=1000`,
    )
      .then((result) =>
        setTemplates(
          (result.data || []).filter(
            (item) => String(item.status).toUpperCase() === "APPROVED",
          ),
        ),
      )
      .catch((error) => setNotice(error.message));
  }, [form.integrationId]);

  function setCount(value) {
    const count = Math.max(1, Math.min(10, Number(value || 1)));
    setForm((current) => ({
      ...current,
      communicationCount: count,
      touches: Array.from(
        { length: count },
        (_, index) => current.touches[index] || blankTouch(),
      ),
      calendarDates: Array.from(
        { length: count },
        (_, index) =>
          current.calendarDates[index] || current.firstCommunicationAt,
      ),
    }));
  }

  function chooseTemplate(index, templateId) {
    const template = templates.find(
      (item) => String(item.id) === String(templateId),
    );
    const body = template?.body || "";
    const count = Math.max(
      Number(template?.total_parameters || 0),
      ...[...body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((match) =>
        Number(match[1]),
      ),
      0,
    );
    setForm((current) => ({
      ...current,
      touches: current.touches.map((touch, touchIndex) =>
        touchIndex === index
          ? {
              templateId,
              templateBody: body,
              templateParams: Array.from({ length: count }, () => ""),
              mediaUrl: "",
              mediaFilename: "",
            }
          : touch,
      ),
    }));
  }

  async function uploadTouchMedia(index, file) {
    const template = selectedTemplates[index];
    const templateType = String(
      template?.template_type ||
        template?.header_type ||
        template?.type ||
        "TEXT",
    ).toUpperCase();
    if (!file || !["IMAGE", "VIDEO", "DOCUMENT", "FILE"].includes(templateType))
      return;
    setUploadingTouch(index);
    setNotice("");
    try {
      const result = await api("/whatsapp/media-upload", {
        method: "POST",
        body: file,
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          "X-File-Name": encodeURIComponent(file.name),
          "X-Template-Type": templateType,
          "X-Integration-Id": form.integrationId,
        },
      });
      setForm((current) => ({
        ...current,
        touches: current.touches.map((touch, touchIndex) =>
          touchIndex === index
            ? {
                ...touch,
                mediaUrl: result.data.url,
                mediaFilename: result.data.filename || file.name,
              }
            : touch,
        ),
      }));
    } catch (error) {
      setNotice(error.message);
    } finally {
      setUploadingTouch(null);
    }
  }

  function updateParam(touchIndex, paramIndex, value) {
    setForm((current) => ({
      ...current,
      touches: current.touches.map((touch, index) => {
        if (index !== touchIndex) return touch;
        const templateParams = [...touch.templateParams];
        templateParams[paramIndex] = value;
        return { ...touch, templateParams };
      }),
    }));
  }

  function toggleArray(field, value) {
    setForm((current) => {
      const values = current[field];
      return {
        ...current,
        [field]: values.includes(value)
          ? values.filter((item) => item !== value)
          : [...values, value],
      };
    });
  }

  async function submit(event) {
    event.preventDefault();
    setNotice("");
    if (
      form.touches.some(
        (touch, index) =>
          !touch.templateId ||
          touch.templateParams.some((value) => !String(value).trim()) ||
          (["IMAGE", "VIDEO", "DOCUMENT", "FILE"].includes(
            String(
              selectedTemplates[index]?.template_type ||
                selectedTemplates[index]?.header_type ||
                selectedTemplates[index]?.type ||
                "TEXT",
            ).toUpperCase(),
          ) &&
            !touch.mediaUrl),
      )
    ) {
      setNotice(
        "Select every template, complete its fixed values and upload required attachments",
      );
      return;
    }
    setSaving(true);
    try {
      const result = await api("/marketing-campaigns", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          leadIds: Array.isArray(leadIds) ? leadIds : undefined,
        }),
      });
      onCreated(result.message);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setSaving(false);
    }
  }

  const option = (items, labelKey = "displayName") =>
    items.map((item) => ({
      value: String(item.id),
      label: item[labelKey] || item.name,
    }));
  const selectedTemplates = useMemo(
    () =>
      form.touches.map((touch) =>
        templates.find((item) => String(item.id) === String(touch.templateId)),
      ),
    [form.touches, templates],
  );

  return (
    <main className="page marketing-builder">
      <button className="automation-back" onClick={onClose}>
        <ArrowLeft /> Add bulk marketing campaign
      </button>
      <form onSubmit={submit}>
        <section className="marketing-step">
          <header>
            <span>1</span>
            <div>
              <h2>Campaign details</h2>
              <p>Name the campaign and define its communication schedule.</p>
            </div>
          </header>
          <div className="marketing-grid">
            <label>
              Campaign name *
              <input
                required
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
                placeholder="Enter campaign name"
              />
            </label>
            <label>
              Schedule rule *
              <select
                value={form.ruleType}
                onChange={(event) =>
                  setForm({ ...form, ruleType: event.target.value })
                }
              >
                <option value="days_gap">Based on number of days gap</option>
                <option value="calendar_dates">
                  Based on selected calendar dates
                </option>
                <option value="weekdays">Based on selected weekdays</option>
              </select>
            </label>
            <label>
              Number of communications *
              <input
                type="number"
                min="1"
                max="10"
                value={form.communicationCount}
                onChange={(event) => setCount(event.target.value)}
              />
            </label>
            <label>
              First communication *
              <input
                type="datetime-local"
                required
                value={form.firstCommunicationAt}
                onChange={(event) =>
                  setForm({
                    ...form,
                    firstCommunicationAt: event.target.value,
                  })
                }
              />
            </label>
            {form.ruleType === "days_gap" && (
              <label>
                Gap between communications (days) *
                <input
                  type="number"
                  min="1"
                  max="365"
                  value={form.gapDays}
                  onChange={(event) =>
                    setForm({ ...form, gapDays: event.target.value })
                  }
                />
              </label>
            )}
            {form.ruleType === "weekdays" && (
              <fieldset className="weekday-options">
                <legend>Communication weekdays *</legend>
                {weekdays.map(([value, label]) => (
                  <label key={value}>
                    <input
                      type="checkbox"
                      checked={form.weekdays.includes(value)}
                      onChange={() => toggleArray("weekdays", value)}
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
            )}
            {form.ruleType === "calendar_dates" && (
              <div className="calendar-date-grid">
                {form.calendarDates.map((value, index) => (
                  <label key={index}>
                    Communication {index + 1} *
                    <input
                      type="datetime-local"
                      value={value}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          calendarDates: current.calendarDates.map(
                            (date, dateIndex) =>
                              dateIndex === index ? event.target.value : date,
                          ),
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
            )}
          </div>
        </section>

        {!Array.isArray(leadIds) && (
          <section className="marketing-step">
            <header>
              <span>2</span>
              <div>
                <h2>Audience</h2>
                <p>Choose the leads and mobile fields that receive the campaign.</p>
              </div>
            </header>
            <div className="marketing-grid audience-grid">
            <MultiSearchSelect
              label="Branches"
              value={form.audienceFilters.branchIds}
              onChange={(branchIds) =>
                setForm({
                  ...form,
                  audienceFilters: { ...form.audienceFilters, branchIds },
                })
              }
              options={option(meta.branches, "name")}
            />
            <MultiSearchSelect
              label="Stages"
              value={form.audienceFilters.stageIds}
              onChange={(stageIds) =>
                setForm({
                  ...form,
                  audienceFilters: { ...form.audienceFilters, stageIds },
                })
              }
              options={option(meta.stages)}
            />
            <MultiSearchSelect
              label="Sources"
              value={form.audienceFilters.sourceIds}
              onChange={(sourceIds) =>
                setForm({
                  ...form,
                  audienceFilters: { ...form.audienceFilters, sourceIds },
                })
              }
              options={option(meta.sources)}
            />
            <fieldset className="phone-options">
              <legend>Send to *</legend>
              <label>
                <input
                  type="checkbox"
                  checked={form.phoneTypes.includes("primary")}
                  onChange={() => toggleArray("phoneTypes", "primary")}
                />
                Primary mobile
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={form.phoneTypes.includes("alternate")}
                  onChange={() => toggleArray("phoneTypes", "alternate")}
                />
                Alternate mobile
              </label>
            </fieldset>
            </div>
          </section>
        )}
        {Array.isArray(leadIds) && (
          <section className="marketing-selected-audience">
            <CheckCircle2 />
            <div>
              <strong>{leadIds.length} filtered leads selected</strong>
              <span>
                This campaign uses the filters applied on the Leads screen.
              </span>
            </div>
          </section>
        )}

        <section className="marketing-step">
          <header>
            <span>{Array.isArray(leadIds) ? 2 : 3}</span>
            <div>
              <h2>WhatsApp communications</h2>
              <p>Select the account and approved template for every touch.</p>
            </div>
          </header>
          <div className="marketing-grid">
            <label>
              WhatsApp account *
              <select
                required
                value={form.integrationId}
                onChange={(event) =>
                  setForm({
                    ...form,
                    integrationId: event.target.value,
                    touches: Array.from(
                      { length: form.communicationCount },
                      blankTouch,
                    ),
                  })
                }
              >
                <option value="">Select connected account</option>
                {integrations.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.integration_name || item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Student response owner *
              <select
                value={form.responseOwner}
                onChange={(event) =>
                  setForm({ ...form, responseOwner: event.target.value })
                }
              >
                <option value="sender">Sender</option>
                <option value="lead_owner">Lead owner</option>
              </select>
            </label>
            <label>
              WhatsApp retry attempts
              <input
                type="number"
                min="0"
                max="5"
                value={form.retryAttempts}
                onChange={(event) =>
                  setForm({ ...form, retryAttempts: event.target.value })
                }
              />
            </label>
          </div>
          <div className="marketing-touch-list">
            {form.touches.map((touch, index) => (
              <article key={index}>
                <div className="touch-number">{index + 1}</div>
                <label>
                  Approved WhatsApp template *
                  <select
                    required
                    disabled={!form.integrationId}
                    value={touch.templateId}
                    onChange={(event) =>
                      chooseTemplate(index, event.target.value)
                    }
                  >
                    <option value="">Select template</option>
                    {templates.map((template) => (
                      <option value={template.id} key={template.id}>
                        {template.template_name}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedTemplates[index] && (
                  <div className="touch-preview">
                    <MessageCircle />
                    <p>{touch.templateBody}</p>
                  </div>
                )}
                {selectedTemplates[index] &&
                  ["IMAGE", "VIDEO", "DOCUMENT", "FILE"].includes(
                    String(
                      selectedTemplates[index].template_type ||
                        selectedTemplates[index].header_type ||
                        selectedTemplates[index].type ||
                        "TEXT",
                    ).toUpperCase(),
                  ) && (
                    <label className="marketing-media-upload">
                      Required{" "}
                      {String(
                        selectedTemplates[index].template_type ||
                          selectedTemplates[index].header_type ||
                          selectedTemplates[index].type,
                      ).toLowerCase()}{" "}
                      attachment *
                      <span>
                        {uploadingTouch === index ? (
                          <Loader className="spinning" />
                        ) : (
                          <FileUp />
                        )}
                        <b>
                          {uploadingTouch === index
                            ? "Uploading…"
                            : touch.mediaFilename || "Choose file from system"}
                        </b>
                        <input
                          type="file"
                          required={!touch.mediaUrl}
                          disabled={uploadingTouch === index}
                          accept={
                            String(
                              selectedTemplates[index].template_type ||
                                selectedTemplates[index].header_type ||
                                selectedTemplates[index].type,
                            ).toUpperCase() === "IMAGE"
                              ? "image/jpeg,image/png,image/webp,image/gif"
                              : String(
                                    selectedTemplates[index].template_type ||
                                      selectedTemplates[index].header_type ||
                                      selectedTemplates[index].type,
                                  ).toUpperCase() === "VIDEO"
                                ? "video/mp4"
                                : ".pdf,.doc,.docx"
                          }
                          onChange={(event) =>
                            uploadTouchMedia(index, event.target.files?.[0])
                          }
                        />
                      </span>
                    </label>
                  )}
                {touch.templateParams.map((value, paramIndex) => (
                  <label key={paramIndex}>
                    {`{{${paramIndex + 1}}}`} fixed value *
                    <input
                      required
                      value={value}
                      onChange={(event) =>
                        updateParam(index, paramIndex, event.target.value)
                      }
                    />
                  </label>
                ))}
              </article>
            ))}
          </div>
        </section>
        {notice && <div className="notice error">{notice}</div>}
        <footer className="marketing-builder-footer">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={saving}>
            <Send /> {saving ? "Scheduling…" : "Add bulk campaign"}
          </button>
        </footer>
      </form>
    </main>
  );
}

function LegacyMarketingCampaignList({ campaigns, onStatus }) {
  return (
    <article className="panel marketing-campaign-panel">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Account</th>
              <th>Schedule</th>
              <th>Recipients</th>
              <th>Progress</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((campaign) => {
              const progress = campaign.totalDeliveries
                ? Math.round(
                    ((campaign.completedDeliveries +
                      campaign.failedDeliveries) /
                      campaign.totalDeliveries) *
                      100,
                  )
                : 0;
              return (
                <tr key={campaign.id}>
                  <td>
                    <strong>{campaign.name}</strong>
                    <small>{campaign.communicationCount} communications</small>
                  </td>
                  <td>{campaign.integrationName}</td>
                  <td>
                    <CalendarDays size={14} />{" "}
                    {new Date(campaign.firstCommunicationAt).toLocaleString(
                      "en-IN",
                      { timeZone: "Asia/Kolkata" },
                    )}
                  </td>
                  <td>{campaign.recipientCount}</td>
                  <td>
                    <div className="campaign-progress">
                      <span>
                        <i style={{ width: `${progress}%` }} />
                      </span>
                      <small>
                        {campaign.completedDeliveries}/
                        {campaign.totalDeliveries} · {progress}%
                        {campaign.failedDeliveries
                          ? ` · ${campaign.failedDeliveries} failed`
                          : ""}
                      </small>
                    </div>
                  </td>
                  <td>
                    <span
                      className={`campaign-status ${campaign.status.toLowerCase()}`}
                    >
                      {campaign.status === "COMPLETED" && <CheckCircle2 />}
                      {campaign.status}
                    </span>
                  </td>
                  <td>
                    <div className="automation-row-actions">
                      {campaign.status === "ACTIVE" ? (
                        <button
                          className="icon-btn"
                          title="Pause campaign"
                          onClick={() => onStatus(campaign, "PAUSED")}
                        >
                          <Pause />
                        </button>
                      ) : campaign.status === "PAUSED" ? (
                        <button
                          className="icon-btn"
                          title="Resume campaign"
                          onClick={() => onStatus(campaign, "ACTIVE")}
                        >
                          <Play />
                        </button>
                      ) : null}
                      {!["COMPLETED", "CANCELLED"].includes(
                        campaign.status,
                      ) && (
                        <button
                          className="icon-btn danger"
                          title="Cancel campaign"
                          onClick={() => onStatus(campaign, "CANCELLED")}
                        >
                          <Ban />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!campaigns.length && (
        <div className="empty">
          <MessageCircle />
          <strong>No bulk marketing campaigns</strong>
          <span>Add a campaign to schedule WhatsApp communications.</span>
        </div>
      )}
    </article>
  );
}

export function MarketingCampaignList({ campaigns, onStatus }) {
  const [expandedId, setExpandedId] = useState(null);
  const formatDate = (value) =>
    value
      ? new Date(value).toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
          dateStyle: "medium",
          timeStyle: "short",
        })
      : "—";
  const ruleLabel = (campaign) =>
    campaign.ruleType === "calendar_dates"
      ? "Selected calendar dates"
      : campaign.ruleType === "weekdays"
        ? "Selected weekdays"
        : `Every ${campaign.gapDays || 1} day${Number(campaign.gapDays || 1) === 1 ? "" : "s"}`;

  return (
    <article className="panel marketing-campaign-panel">
      <div className="campaign-record-list">
        {campaigns.map((campaign) => {
          const progress = campaign.totalDeliveries
            ? Math.round(
                ((campaign.completedDeliveries + campaign.failedDeliveries) /
                  campaign.totalDeliveries) *
                  100,
              )
            : 0;
          const expanded = expandedId === campaign.id;
          const statusAction = (event, status) => {
            event.stopPropagation();
            onStatus(campaign, status);
          };
          return (
            <section className={`campaign-record ${expanded ? "expanded" : ""}`} key={campaign.id}>
              <button type="button" className="campaign-record-summary" onClick={() => setExpandedId(expanded ? null : campaign.id)}>
                <span><small>Campaign name</small><strong>{campaign.name}</strong></span>
                <span><small>Status</small><b className={`campaign-status ${campaign.status.toLowerCase()}`}>{campaign.status === "COMPLETED" && <CheckCircle2 />}{campaign.status}</b></span>
                <span><small>Created on</small><b>{formatDate(campaign.createdAt)}</b></span>
                <span><small>Created by</small><b>{campaign.createdBy || "—"}</b></span>
                <span><small>Updated on</small><b>{formatDate(campaign.updatedAt)}</b></span>
                <span><small>Rule</small><b>{ruleLabel(campaign)}</b></span>
                <span className="campaign-summary-actions">
                  <small>Actions</small>
                  <span className="automation-row-actions">
                    {campaign.status === "ACTIVE" ? (
                      <button type="button" className="icon-btn" title="Pause campaign" onClick={(event) => statusAction(event, "PAUSED")}><Pause /></button>
                    ) : campaign.status === "PAUSED" ? (
                      <button type="button" className="icon-btn" title="Resume campaign" onClick={(event) => statusAction(event, "ACTIVE")}><Play /></button>
                    ) : null}
                    {!["COMPLETED", "CANCELLED"].includes(campaign.status) && (
                      <button type="button" className="icon-btn danger" title="Cancel campaign" onClick={(event) => statusAction(event, "CANCELLED")}><Ban /></button>
                    )}
                  </span>
                </span>
                <ChevronDown className="campaign-expand-icon" />
              </button>
              {expanded && (
                <div className="campaign-record-details">
                  <div className="campaign-detail-grid">
                    <span><small>WhatsApp account</small><strong>{campaign.integrationName}</strong></span>
                    <span><small>Lead recipients</small><strong>{campaign.recipientCount}</strong></span>
                    <span><small>Primary mobile numbers</small><strong>{campaign.primaryCount}</strong></span>
                    <span><small>Alternate mobile numbers</small><strong>{campaign.alternateCount}</strong></span>
                    <span><small>Communications</small><strong>{campaign.communicationCount}</strong></span>
                    <span><small>First communication</small><strong>{formatDate(campaign.firstCommunicationAt)}</strong></span>
                  </div>
                  <div className="campaign-processing-head">
                    <div><strong>Processing status</strong><small>WhatsApp delivery summary across all scheduled communications.</small></div>
                    <div className="campaign-progress"><span><i style={{ width: `${progress}%` }} /></span><small>{campaign.completedDeliveries}/{campaign.totalDeliveries} processed · {progress}%</small></div>
                  </div>
                  <div className="campaign-status-grid">
                    <span><small>Scheduled</small><strong>{campaign.totalDeliveries}</strong></span>
                    <span><small>Pending</small><strong>{campaign.pendingDeliveries}</strong></span>
                    <span><small>Queued</small><strong>{campaign.queuedDeliveries}</strong></span>
                    <span><small>Sent</small><strong>{campaign.sentDeliveries}</strong></span>
                    <span><small>Delivered</small><strong>{campaign.deliveredDeliveries}</strong></span>
                    <span><small>Read</small><strong>{campaign.readDeliveries}</strong></span>
                    <span className={campaign.failedDeliveries ? "failed" : ""}><small>Failed</small><strong>{campaign.failedDeliveries}</strong></span>
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </div>
      {!campaigns.length && (
        <div className="empty">
          <MessageCircle />
          <strong>No bulk marketing campaigns</strong>
          <span>Create one from the filtered Leads screen.</span>
        </div>
      )}
    </article>
  );
}
