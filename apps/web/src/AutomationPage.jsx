import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Filter, Pencil, Play, Megaphone, Plus, Save, Trash2, Workflow, Zap } from "lucide-react";
import { api } from "./api";
import { useBusinessUnit } from "./BusinessUnitContext.jsx";
import { MultiSearchSelect, SearchSelect } from "./FilterWorkspace.jsx";
import { MarketingCampaignList } from "./MarketingCampaigns.jsx";

const categories = [
  {
    id: "attribute",
    title: "Update attributes, fields or add milestones",
    lines: [
      "Update priority, stage, owner or other lead fields",
      "Add time delay or update immediately",
    ],
  },
  {
    id: "immediate",
    title: "Send immediate communication",
    lines: [
      "Send a single email, SMS or WhatsApp message",
      "No dependent actions are added",
    ],
  },
  {
    id: "timed",
    title: "Nurture with time based workflow",
    lines: [
      "Send multiple communications with delays",
      "Add dependent actions and update fields",
    ],
  },
  {
    id: "outcome",
    title: "Nurture with action or outcome based workflow",
    lines: [
      "Branch based on delivery, response or outcome",
      "Add delays and dependent actions",
    ],
  },
];
const blankCondition = () => ({
  field: "stage",
  operator: "includes",
  values: [],
  subgroup: false,
  joinWith: "and",
  dateMode: "relative",
  duration: "",
  durationUnit: "days",
  dateFrom: "",
  dateTo: "",
});
const blankAction = () => ({
  type: "update",
  field: "stage",
  value: "",
  delay: "immediate",
  integrationId: "",
  templateId: "",
  templateName: "",
  templateBody: "",
  templateLanguage: "en",
  templateParams: [],
});
function currentIndiaSchedule() {
  const value = new Date()
    .toLocaleString("sv-SE", {
      timeZone: "Asia/Kolkata",
      hour12: false,
    })
    .replace(" ", "T");
  return {
    startDate: value.slice(0, 10),
    startTime: value.slice(11, 16),
  };
}

export default function AutomationPage() {
  const { selectedId } = useBusinessUnit();
  const [view, setView] = useState("list"),
    [items, setItems] = useState([]),
    [campaigns, setCampaigns] = useState([]),
    [meta, setMeta] = useState(null),
    [whatsappIntegrations, setWhatsappIntegrations] = useState([]),
    [whatsappTemplates, setWhatsappTemplates] = useState({}),
    [loadingTemplates, setLoadingTemplates] = useState(""),
    [query, setQuery] = useState(""),
    [notice, setNotice] = useState(""),
    [editingId, setEditingId] = useState(null);
  const [automationTab, setAutomationTab] = useState("workflows");
  const [activeStep, setActiveStep] = useState("if");
  const [form, setForm] = useState({
    name: "",
    category: "",
    startDate: "",
    startTime: "",
    conditions: [blankCondition()],
    logic: "and",
    actions: [blankAction()],
    noRecheckAfterDelay: false,
  });
  async function load() {
    const [workflows, leadMeta, integrations, campaignResult] =
      await Promise.all([
      api("/automations"),
      api("/leads/meta"),
      api("/whatsapp/integrations?provider=SMARTPING"),
      api("/marketing-campaigns"),
    ]);
    setItems(workflows.data);
    setMeta(leadMeta);
    setCampaigns(campaignResult.data || []);
    setWhatsappIntegrations(
      (integrations.data || []).filter(
        (item) =>
          item.has_credentials &&
          !["INACTIVE", "FAILED", "DISCONNECTED"].includes(
            String(item.status || "").toUpperCase(),
          ),
      ),
    );
  }
  useEffect(() => {
    setItems([]);
    setCampaigns([]);
    setMeta(null);
    setWhatsappTemplates({});
    setView("list");
    setEditingId(null);
    load().catch((error) => setNotice(error.message));
  }, [selectedId]);
  const visible = useMemo(
    () =>
      items.filter(
        (item) =>
          !query ||
          `${item.name} ${item.category} ${item.createdBy}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [items, query],
  );
  const fieldOptions = {
    stage: meta?.stages || [],
    substage: meta?.substages || [],
    branch: meta?.branches || [],
    source: meta?.sources || [],
    channel: meta?.channels || [],
    campaign: meta?.campaigns || [],
    class: meta?.classes || [],
    curriculum: meta?.curricula || [],
    owner: meta?.employees || [],
    addedDate: [],
    modifiedDate: [],
  };
  const searchOptions = (items, placeholder) => [
    { value: "", label: placeholder },
    ...items.map((item) => ({
      value: String(item.id),
      label:
        item.displayName || item.name || item.employeeName || String(item.id),
    })),
  ];
  function begin(category) {
    const schedule = currentIndiaSchedule();
    setEditingId(null);
    setActiveStep("if");
    setForm({
      name: "",
      category,
      startDate: schedule.startDate,
      startTime: schedule.startTime,
      conditions: [blankCondition()],
      logic: "and",
      actions: [blankAction()],
      noRecheckAfterDelay: false,
    });
    setView("builder");
  }
  function editWorkflow(item) {
    const definition = item.definition || {};
    const scheduled = item.startAt ? new Date(item.startAt) : null;
    const localSchedule = scheduled
      ? scheduled
          .toLocaleString("sv-SE", {
            timeZone: "Asia/Kolkata",
            hour12: false,
          })
          .replace(" ", "T")
      : "";
    const actions = (definition.actions || [blankAction()]).map((action) => ({
      ...blankAction(),
      ...action,
      integrationId: action.integrationId
        ? String(action.integrationId)
        : "",
      templateId: action.templateId ? String(action.templateId) : "",
      templateParams: Array.isArray(action.templateParams)
        ? action.templateParams
        : [],
    }));
    setEditingId(item.id);
    setActiveStep("if");
    setForm({
      name: item.name,
      category: item.category,
      startDate: localSchedule.slice(0, 10),
      startTime: localSchedule.slice(11, 16),
      conditions:
        definition.conditions?.length > 0
          ? definition.conditions
          : [blankCondition()],
      logic: definition.logic || "and",
      actions,
      noRecheckAfterDelay: Boolean(definition.noRecheckAfterDelay),
    });
    actions
      .filter((action) => action.type === "whatsapp" && action.integrationId)
      .forEach((action) => {
        loadWhatsappTemplates(action.integrationId).catch((error) =>
          setNotice(error.message),
        );
      });
    setNotice("");
    setView("builder");
  }
  function changeCondition(index, key, value) {
    setForm((current) => ({
      ...current,
      conditions: current.conditions.map((item, i) =>
        i === index
          ? {
              ...item,
              [key]: value,
              ...(key === "field"
                ? {
                    values: [],
                    operator: ["addedDate", "modifiedDate"].includes(value)
                      ? "within_last"
                      : "includes",
                  }
                : null),
            }
          : item,
      ),
    }));
  }
  const conditionGroups = form.conditions.reduce((groups, condition, index) => {
    if (!condition.subgroup || !groups.length)
      groups.push({ condition, index, subgroups: [] });
    else groups[groups.length - 1].subgroups.push({ condition, index });
    return groups;
  }, []);
  function addSubgroup(parentIndex) {
    const next = [...form.conditions];
    let insertAt = parentIndex + 1;
    while (insertAt < next.length && next[insertAt].subgroup) insertAt += 1;
    next.splice(insertAt, 0, { ...blankCondition(), subgroup: true });
    setForm({ ...form, conditions: next });
  }
  function removeCondition(index) {
    const removingParent = !form.conditions[index]?.subgroup;
    setForm({
      ...form,
      conditions: form.conditions.filter((item, itemIndex) => {
        if (itemIndex === index) return false;
        if (!removingParent || itemIndex < index) return true;
        const firstFollowingParent = form.conditions.findIndex(
          (candidate, candidateIndex) =>
            candidateIndex > index && !candidate.subgroup,
        );
        return firstFollowingParent !== -1 && itemIndex >= firstFollowingParent;
      }),
    });
  }
  function conditionEditor(condition, index) {
    const dateField = ["addedDate", "modifiedDate"].includes(condition.field);
    return (
      <div className={`condition-row ${dateField ? "date-condition-row" : ""}`}>
        <SearchSelect
          label="Condition field"
          value={condition.field}
          onChange={(value) => changeCondition(index, "field", value)}
          options={Object.keys(fieldOptions).map((key) => ({
            value: key,
            label:
              key === "addedDate"
                ? "Added date"
                : key === "modifiedDate"
                  ? "Modified date"
                  : key[0].toUpperCase() + key.slice(1),
          }))}
        />
        {dateField ? (
          <>
            <select
              value={condition.operator}
              onChange={(event) =>
                changeCondition(index, "operator", event.target.value)
              }
            >
              <option value="within_last">is within last</option>
              <option value="not_within_last">is not within last</option>
              <option value="on">is on</option>
              <option value="before">is before</option>
              <option value="after">is after</option>
              <option value="between">is between</option>
            </select>
            <div className="date-condition-value">
              <select
                value={condition.dateMode}
                onChange={(event) =>
                  changeCondition(index, "dateMode", event.target.value)
                }
              >
                <option value="relative">Flexible (relative)</option>
                <option value="absolute">Fixed date</option>
              </select>
              {condition.dateMode === "relative" ? (
                <div>
                  <input
                    type="number"
                    min="1"
                    value={condition.duration}
                    onChange={(event) =>
                      changeCondition(index, "duration", event.target.value)
                    }
                    placeholder="Duration"
                  />
                  <select
                    value={condition.durationUnit}
                    onChange={(event) =>
                      changeCondition(index, "durationUnit", event.target.value)
                    }
                  >
                    <option value="minutes">Minutes</option>
                    <option value="hours">Hours</option>
                    <option value="days">Days</option>
                    <option value="weeks">Weeks</option>
                    <option value="months">Months</option>
                  </select>
                </div>
              ) : (
                <div>
                  <input
                    type="date"
                    value={condition.dateFrom}
                    onChange={(event) =>
                      changeCondition(index, "dateFrom", event.target.value)
                    }
                  />
                  {condition.operator === "between" && (
                    <input
                      type="date"
                      value={condition.dateTo}
                      onChange={(event) =>
                        changeCondition(index, "dateTo", event.target.value)
                      }
                    />
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <select
              value={condition.operator}
              onChange={(event) =>
                changeCondition(index, "operator", event.target.value)
              }
            >
              <option value="includes">includes</option>
              <option value="excludes">excludes</option>
              <option value="equals">equals</option>
              <option value="not_equals">does not equal</option>
              <option value="is_empty">is empty</option>
              <option value="not_empty">is not empty</option>
            </select>
            {["is_empty", "not_empty"].includes(condition.operator) ? (
              <div className="condition-value-disabled">No value required</div>
            ) : (
              <MultiSearchSelect
                label={`${condition.field} values`}
                value={condition.values}
                onChange={(values) => changeCondition(index, "values", values)}
                options={searchOptions(
                  fieldOptions[condition.field],
                  `Select ${condition.field} values`,
                )}
              />
            )}
          </>
        )}
        <button onClick={() => removeCondition(index)}>
          <Trash2 />
        </button>
      </div>
    );
  }
  function conditionConnector(conditionIndex, label) {
    const condition = form.conditions[conditionIndex];
    return (
      <div className="condition-connector" aria-label={label}>
        <button
          className={condition?.joinWith !== "or" ? "active" : ""}
          onClick={() => changeCondition(conditionIndex, "joinWith", "and")}
        >
          AND
        </button>
        <button
          className={condition?.joinWith === "or" ? "active" : ""}
          onClick={() => changeCondition(conditionIndex, "joinWith", "or")}
        >
          OR
        </button>
      </div>
    );
  }
  function changeAction(index, key, value) {
    setForm((current) => ({
      ...current,
      actions: current.actions.map((item, i) =>
        i === index ? { ...item, [key]: value } : item,
      ),
    }));
  }
  function changeActionType(index, type) {
    setForm((current) => ({
      ...current,
      actions: current.actions.map((item, i) =>
        i === index ? { ...blankAction(), type, delay: item.delay } : item,
      ),
    }));
  }
  async function loadWhatsappTemplates(integrationId) {
    if (!integrationId || whatsappTemplates[integrationId]) return;
    setLoadingTemplates(String(integrationId));
    try {
      const result = await api(
        `/whatsapp/integrations/${integrationId}/templates?limit=1000`,
      );
      setWhatsappTemplates((current) => ({
        ...current,
        [integrationId]: (result.data || []).filter(
          (item) => String(item.status).toUpperCase() === "APPROVED",
        ),
      }));
    } finally {
      setLoadingTemplates("");
    }
  }
  function chooseWhatsappAccount(index, integrationId) {
    setForm((current) => ({
      ...current,
      actions: current.actions.map((item, i) =>
        i === index
          ? {
              ...item,
              integrationId,
              templateId: "",
              templateName: "",
              templateBody: "",
              templateLanguage: "en",
              templateParams: [],
            }
          : item,
      ),
    }));
    loadWhatsappTemplates(integrationId).catch((error) =>
      setNotice(error.message),
    );
  }
  function chooseWhatsappTemplate(index, templateId) {
    setForm((current) => ({
      ...current,
      actions: current.actions.map((item, i) => {
        if (i !== index) return item;
        const template = (whatsappTemplates[item.integrationId] || []).find(
          (candidate) => String(candidate.id) === String(templateId),
        );
        const body = template?.body || "";
        const parameterCount = Math.max(
          Number(template?.total_parameters || 0),
          ...[...body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((match) =>
            Number(match[1]),
          ),
          0,
        );
        return {
          ...item,
          templateId,
          templateName: template?.template_name || "",
          templateBody: body,
          templateLanguage: template?.language || "en",
          templateParams: Array.from({ length: parameterCount }, () => ""),
        };
      }),
    }));
  }
  function changeTemplateParameter(actionIndex, parameterIndex, value) {
    setForm((current) => ({
      ...current,
      actions: current.actions.map((item, index) => {
        if (index !== actionIndex) return item;
        const templateParams = [...item.templateParams];
        templateParams[parameterIndex] = value;
        return { ...item, templateParams };
      }),
    }));
  }
  async function save() {
    if (!form.name.trim() || !form.startDate || !form.startTime) {
      setNotice("Enter the automation name, start date and start time");
      return;
    }
    const incompleteAction = form.actions.find((action) => {
      if (action.type === "update") return !action.field || action.value === "";
      if (action.type === "whatsapp")
        return (
          !action.integrationId ||
          !action.templateId ||
          action.templateParams.some((value) => !String(value).trim())
        );
      return true;
    });
    if (incompleteAction) {
      setNotice(
        incompleteAction.type === "whatsapp"
          ? "Select a WhatsApp account, approved template, and all fixed parameter values"
          : "Complete every THEN action before saving",
      );
      return;
    }
    await api(editingId ? `/automations/${editingId}` : "/automations", {
      method: editingId ? "PUT" : "POST",
      body: JSON.stringify({
        name: form.name,
        category: form.category,
        startAt: `${form.startDate}T${form.startTime}`,
        definition: {
          conditions: form.conditions,
          logic: form.logic,
          actions: form.actions,
          noRecheckAfterDelay: form.noRecheckAfterDelay,
        },
      }),
    });
    setNotice(
      editingId
        ? "Automation workflow updated"
        : "Automation workflow saved",
    );
    await load();
    setEditingId(null);
    setView("list");
  }
  async function status(item) {
    await api(`/automations/${item.id}/status`, {
      method: "PUT",
      body: JSON.stringify({ isActive: !item.isActive }),
    });
    await load();
  }
  async function runNow(item) {
    const result = await api(`/automations/${item.id}/run`, {
      method: "POST",
    });
    setNotice(result.message);
    await load();
  }
  async function remove(item) {
    if (!confirm(`Delete automation “${item.name}”?`)) return;
    await api(`/automations/${item.id}`, { method: "DELETE" });
    await load();
  }
  async function updateCampaignStatus(campaign, statusValue) {
    const result = await api(`/marketing-campaigns/${campaign.id}/status`, {
      method: "PUT",
      body: JSON.stringify({ status: statusValue }),
    });
    setNotice(result.message);
    await load();
  }
  if (view === "builder")
    return (
      <main className="page automation-page">
        <button
          className="automation-back"
          onClick={() => {
            setEditingId(null);
            setView("list");
          }}
        >
          <ArrowLeft />{" "}
          {editingId ? "Edit automation workflow" : "Add automation workflow"}
        </button>
        <div className="automation-builder">
          <aside>
            <div
              className={`flow-card ${activeStep === "if" ? "active" : ""}`}
              role="button"
              tabIndex="0"
              onClick={() => setActiveStep("if")}
              onKeyDown={(event) =>
                event.key === "Enter" && setActiveStep("if")
              }
            >
              <Filter /> <strong>IF</strong>
              <small>Choose lead conditions</small>
              <b>{form.conditions.length} conditions applied</b>
            </div>
            <span className="flow-arrow">↓</span>
            <div
              className={`flow-card ${activeStep === "then" ? "active" : ""}`}
              role="button"
              tabIndex="0"
              onClick={() => setActiveStep("then")}
              onKeyDown={(event) =>
                event.key === "Enter" && setActiveStep("then")
              }
            >
              <Zap /> <strong>THEN</strong>
              <small>Add updates or communications</small>
              <b>{form.actions.length} actions</b>
            </div>
          </aside>
          <section className="builder-canvas">
            {activeStep === "if" && (
              <>
                <h3>Conditions</h3>
                {conditionGroups.map((group, groupIndex) => (
                  <div className="automation-condition-card" key={group.index}>
                    <h4>Condition {groupIndex + 1}</h4>
                    {conditionEditor(group.condition, group.index)}
                    {group.subgroups.map((entry, subIndex) => (
                      <div className="automation-subgroup" key={entry.index}>
                        {conditionConnector(
                          subIndex === 0
                            ? group.index
                            : group.subgroups[subIndex - 1].index,
                          `Connector in condition ${groupIndex + 1}`,
                        )}
                        {conditionEditor(entry.condition, entry.index)}
                      </div>
                    ))}
                    <button
                      className="add-subgroup"
                      onClick={() => addSubgroup(group.index)}
                    >
                      <Plus /> Add subgroup
                    </button>
                    {groupIndex < conditionGroups.length - 1 &&
                      conditionConnector(
                        group.subgroups.at(-1)?.index ?? group.index,
                        `Connector after condition ${groupIndex + 1}`,
                      )}
                  </div>
                ))}
                <button
                  className="automation-add"
                  onClick={() =>
                    setForm({
                      ...form,
                      conditions: [...form.conditions, blankCondition()],
                    })
                  }
                >
                  <Plus /> New condition
                </button>
                <label className="no-recheck">
                  <input
                    type="checkbox"
                    checked={form.noRecheckAfterDelay}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        noRecheckAfterDelay: event.target.checked,
                      })
                    }
                  />{" "}
                  Do not recheck the IF conditions when a time delay is selected
                  in the THEN section
                </label>
              </>
            )}
            {activeStep === "then" && (
              <>
                <h3>Actions</h3>
                {form.actions.map((action, index) => (
                  <div className="action-row" key={index}>
                    <select
                      value={action.type}
                      onChange={(e) =>
                        changeActionType(index, e.target.value)
                      }
                    >
                      <option value="update">Update attribute</option>
                      <option value="email">Send email</option>
                      <option value="sms">Send SMS</option>
                      <option value="whatsapp">Send WhatsApp</option>
                      <option value="task">Create task</option>
                    </select>
                    {action.type === "update" ? (
                      <>
                        <select
                          value={action.field}
                          onChange={(e) =>
                            changeAction(index, "field", e.target.value)
                          }
                        >
                          <option value="stage">Stage</option>
                          <option value="substage">Sub-stage</option>
                          <option value="owner">Owner</option>
                          <option value="score">Lead score</option>
                        </select>
                        {fieldOptions[action.field] ? (
                          <SearchSelect
                            label={`${action.field} value`}
                            value={action.value}
                            onChange={(value) =>
                              changeAction(index, "value", value)
                            }
                            options={searchOptions(
                              fieldOptions[action.field],
                              `Select ${action.field}`,
                            )}
                          />
                        ) : (
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={action.value}
                            onChange={(e) =>
                              changeAction(index, "value", e.target.value)
                            }
                            placeholder="Lead score"
                          />
                        )}
                      </>
                    ) : action.type === "whatsapp" ? (
                      <>
                        <select
                          value={action.integrationId}
                          onChange={(event) =>
                            chooseWhatsappAccount(index, event.target.value)
                          }
                        >
                          <option value="">Select WhatsApp account</option>
                          {whatsappIntegrations.map((integration) => (
                            <option key={integration.id} value={integration.id}>
                              {integration.integration_name ||
                                integration.name}
                            </option>
                          ))}
                        </select>
                        <select
                          value={action.templateId}
                          disabled={
                            !action.integrationId ||
                            loadingTemplates === String(action.integrationId)
                          }
                          onChange={(event) =>
                            chooseWhatsappTemplate(index, event.target.value)
                          }
                        >
                          <option value="">
                            {loadingTemplates === String(action.integrationId)
                              ? "Loading templates..."
                              : "Select approved template"}
                          </option>
                          {(whatsappTemplates[action.integrationId] || []).map(
                            (template) => (
                              <option key={template.id} value={template.id}>
                                {template.template_name}
                              </option>
                            ),
                          )}
                        </select>
                      </>
                    ) : (
                      <>
                        <div className="condition-value-disabled">
                          Configuration for this action is not available yet
                        </div>
                        <div />
                      </>
                    )}
                    <select
                      value={action.delay}
                      onChange={(e) =>
                        changeAction(index, "delay", e.target.value)
                      }
                    >
                      <option value="immediate">Immediate</option>
                      <option value="1h">After 1 hour</option>
                      <option value="1d">After 1 day</option>
                      <option value="3d">After 3 days</option>
                    </select>
                    <button
                      onClick={() =>
                        setForm({
                          ...form,
                          actions: form.actions.filter((_, i) => i !== index),
                        })
                      }
                    >
                      <Trash2 />
                    </button>
                    {action.type === "whatsapp" &&
                      action.templateId && (
                        <div className="automation-whatsapp-template">
                          <span>Approved template content</span>
                          <p>{action.templateBody}</p>
                          {action.templateParams.length > 0 && (
                            <div className="automation-template-params">
                              {action.templateParams.map((value, paramIndex) => (
                                <label key={paramIndex}>
                                  {`{{${paramIndex + 1}}}`} fixed value *
                                  <input
                                    value={value}
                                    onChange={(event) =>
                                      changeTemplateParameter(
                                        index,
                                        paramIndex,
                                        event.target.value,
                                      )
                                    }
                                    placeholder={`Value for {{${paramIndex + 1}}}`}
                                  />
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                  </div>
                ))}
                <button
                  className="automation-add"
                  onClick={() =>
                    setForm({
                      ...form,
                      actions: [...form.actions, blankAction()],
                    })
                  }
                >
                  <Plus /> Add action
                </button>
              </>
            )}
          </section>
        </div>
        <div className="automation-submit-bar">
          <div className="automation-basics">
            <label>
              Automation name *
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Automation name"
              />
            </label>
            <label>
              Start date *
              <input
                type="date"
                value={form.startDate}
                onChange={(e) =>
                  setForm({ ...form, startDate: e.target.value })
                }
              />
            </label>
            <label>
              Start time *
              <input
                type="time"
                value={form.startTime}
                onChange={(e) =>
                  setForm({ ...form, startTime: e.target.value })
                }
              />
            </label>
          </div>
          <footer className="automation-footer">
            <button
              className="secondary"
              onClick={() => {
                setEditingId(null);
                setView("list");
              }}
            >
              Cancel
            </button>
            <button
              className="primary"
              onClick={() => save().catch((error) => setNotice(error.message))}
            >
              <Save /> {editingId ? "Update workflow" : "Save workflow"}
            </button>
          </footer>
        </div>
        {notice && <div className="notice error">{notice}</div>}
      </main>
    );
  return (
    <main className="page automation-page">
      {/* Title removed with the page header; the action sits with the tabs. */}
      <div className="automation-tab-bar">
        <nav className="automation-module-tabs" aria-label="Automation sections">
        <button
          className={automationTab === "workflows" ? "active" : ""}
          onClick={() => setAutomationTab("workflows")}
        >
          <Workflow /> Workflows <span>{items.length}</span>
        </button>
        <button
          className={automationTab === "campaigns" ? "active" : ""}
          onClick={() => setAutomationTab("campaigns")}
        >
          <Megaphone /> Bulk campaigns <span>{campaigns.length}</span>
        </button>
        </nav>
        <button className="primary" onClick={() => begin("attribute")}>
          <Plus size={18} /> Add workflow
        </button>
      </div>
      {notice && <div className="notice success">{notice}</div>}
      {automationTab === "campaigns" ? (
        <MarketingCampaignList
          campaigns={campaigns}
          onStatus={(campaign, statusValue) =>
            updateCampaignStatus(campaign, statusValue).catch((error) =>
              setNotice(error.message),
            )
          }
        />
      ) : (
      <>
      <article className="panel">
        <div className="table-tools">
          <div className="local-search">
            <Filter />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search workflows"
            />
          </div>
          <span>{visible.length} workflows</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Workflow name</th>
                <th>Category</th>
                <th>Created by</th>
                <th>Created on</th>
                <th>Start time</th>
                <th>Execution</th>
                <th>Active</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.name}</strong>
                  </td>
                  <td>
                    {categories.find(
                      (category) => category.id === item.category,
                    )?.title || item.category}
                  </td>
                  <td>{item.createdBy}</td>
                  <td>
                    {new Date(item.createdAt).toLocaleString("en-IN", {
                      timeZone: "Asia/Kolkata",
                    })}
                  </td>
                  <td>
                    {item.startAt
                      ? new Date(item.startAt).toLocaleString("en-IN", {
                          timeZone: "Asia/Kolkata",
                        })
                      : "Not scheduled"}
                  </td>
                  <td>
                    <div className="automation-run-status">
                      <strong>
                        {item.lastStatus
                          ? item.lastStatus[0].toUpperCase() +
                            item.lastStatus.slice(1)
                          : "Not run"}
                      </strong>
                      <small>
                        {item.completedCount} completed
                        {item.failedCount
                          ? ` · ${item.failedCount} failed`
                          : ""}
                        {item.skippedCount
                          ? ` · ${item.skippedCount} skipped`
                          : ""}
                        {item.pendingCount
                          ? ` · ${item.pendingCount} pending`
                          : ""}
                      </small>
                    </div>
                  </td>
                  <td>
                    <button
                      className={`automation-toggle ${item.isActive ? "active" : ""}`}
                      onClick={() =>
                        status(item).catch((error) => setNotice(error.message))
                      }
                    >
                      <i />
                    </button>
                  </td>
                  <td>
                    <div className="automation-row-actions">
                      <button
                        className="icon-btn"
                        onClick={() =>
                          runNow(item).catch((error) =>
                            setNotice(error.message),
                          )
                        }
                        title="Run workflow now"
                        disabled={!item.isActive}
                      >
                        <Play />
                      </button>
                      <button
                        className="icon-btn"
                        onClick={() => editWorkflow(item)}
                        title="Edit workflow"
                      >
                        <Pencil />
                      </button>
                      <button
                        className="icon-btn danger"
                        onClick={() =>
                          remove(item).catch((error) =>
                            setNotice(error.message),
                          )
                        }
                        title="Delete workflow"
                      >
                        <Trash2 />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!visible.length && (
            <div className="empty">
              <Workflow />
              <strong>No automation workflows found</strong>
              <span>Create your first workflow to get started.</span>
            </div>
          )}
        </div>
      </article>
      </>
      )}
    </main>
  );
}
