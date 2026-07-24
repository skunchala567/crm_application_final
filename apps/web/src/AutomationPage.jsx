import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ChevronRight,
  Filter,
  MoreVertical,
  Plus,
  Save,
  Trash2,
  Workflow,
  Zap,
} from "lucide-react";
import { api } from "./api";
import { MultiSearchSelect, SearchSelect } from "./FilterWorkspace.jsx";

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
});

export default function AutomationPage() {
  const [view, setView] = useState("list"),
    [items, setItems] = useState([]),
    [meta, setMeta] = useState(null),
    [query, setQuery] = useState(""),
    [notice, setNotice] = useState("");
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
    const [workflows, leadMeta] = await Promise.all([
      api("/automations"),
      api("/leads/meta"),
    ]);
    setItems(workflows.data);
    setMeta(leadMeta);
  }
  useEffect(() => {
    load().catch((error) => setNotice(error.message));
  }, []);
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
    setActiveStep("if");
    setForm({
      name: "",
      category,
      startDate: "",
      startTime: "",
      conditions: [blankCondition()],
      logic: "and",
      actions: [blankAction()],
      noRecheckAfterDelay: false,
    });
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
  async function save() {
    if (!form.name.trim() || !form.startDate || !form.startTime) {
      setNotice("Enter the automation name, start date and start time");
      return;
    }
    await api("/automations", {
      method: "POST",
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
    setNotice("Automation workflow saved");
    await load();
    setView("list");
  }
  async function status(item) {
    await api(`/automations/${item.id}/status`, {
      method: "PUT",
      body: JSON.stringify({ isActive: !item.isActive }),
    });
    await load();
  }
  async function remove(item) {
    if (!confirm(`Delete automation “${item.name}”?`)) return;
    await api(`/automations/${item.id}`, { method: "DELETE" });
    await load();
  }
  if (view === "categories")
    return (
      <main className="page automation-page">
        <button className="automation-back" onClick={() => setView("list")}>
          <ArrowLeft /> Create a new automation workflow
        </button>
        <p className="automation-intro">
          Select the category best suited to create your workflow:
        </p>
        <div className="automation-categories">
          {categories.map((category) => (
            <button
              key={category.id}
              className="automation-category"
              onClick={() => begin(category.id)}
            >
              <span className="workflow-mini">
                <Filter />
                <i>IF</i>
                <ChevronRight />
                <Zap />
                <i>THEN</i>
              </span>
              <span>
                <strong>{category.title}</strong>
                {category.lines.map((line) => (
                  <small key={line}>• {line}</small>
                ))}
              </span>
            </button>
          ))}
        </div>
      </main>
    );
  if (view === "builder")
    return (
      <main className="page automation-page">
        <button
          className="automation-back"
          onClick={() => setView("categories")}
        >
          <ArrowLeft />{" "}
          {categories.find((item) => item.id === form.category)?.title}
        </button>
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
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            />
          </label>
          <label>
            Start time *
            <input
              type="time"
              value={form.startTime}
              onChange={(e) => setForm({ ...form, startTime: e.target.value })}
            />
          </label>
        </div>
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
                        changeAction(index, "type", e.target.value)
                      }
                    >
                      <option value="update">Update attribute</option>
                      <option value="email">Send email</option>
                      <option value="sms">Send SMS</option>
                      <option value="whatsapp">Send WhatsApp</option>
                      <option value="task">Create task</option>
                    </select>
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
                    {action.type === "update" && fieldOptions[action.field] ? (
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
                        value={action.value}
                        onChange={(e) =>
                          changeAction(index, "value", e.target.value)
                        }
                        placeholder="Value or template"
                      />
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
        <footer className="automation-footer">
          <button className="secondary" onClick={() => setView("list")}>
            Cancel
          </button>
          <button
            className="primary"
            onClick={() => save().catch((error) => setNotice(error.message))}
          >
            <Save /> Save workflow
          </button>
        </footer>
        {notice && <div className="notice error">{notice}</div>}
      </main>
    );
  return (
    <main className="page automation-page">
      <div className="automation-heading">
        <div>
          <span className="eyebrow">Engagement automation</span>
          <h1>Automation workflows</h1>
          <p>
            Create rules that respond to lead activity and keep follow-ups
            moving.
          </p>
        </div>
        <button className="primary" onClick={() => setView("categories")}>
          <Plus /> New workflow
        </button>
      </div>
      <div className="automation-toolbar">
        <div className="local-search">
          <Filter />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter workflows"
          />
        </div>
        <span>{visible.length} workflows</span>
      </div>
      {notice && <div className="notice success">{notice}</div>}
      <article className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Workflow name</th>
                <th>Category</th>
                <th>Created by</th>
                <th>Created on</th>
                <th>Start time</th>
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
                    <button
                      className="icon-btn"
                      onClick={() =>
                        remove(item).catch((error) => setNotice(error.message))
                      }
                      title="Delete workflow"
                    >
                      <MoreVertical />
                    </button>
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
    </main>
  );
}
