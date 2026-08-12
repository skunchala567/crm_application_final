import { useState } from "react";
import { Pencil, Power, Trash2, UserCog, X } from "lucide-react";
import { MultiSearchSelect } from "./FilterWorkspace.jsx";

function blankForm() {
  return { name: "", branchIds: [], sourceIds: [], employeeIds: [] };
}

function idOptions(items, labelKey = "name") {
  return items.map((item) => ({ value: String(item.id), label: item[labelKey] || item.name }));
}

function namesFor(ids, items, labelKey = "name") {
  const byId = new Map(items.map((item) => [String(item.id), item[labelKey] || item.name]));
  return ids.map((id) => byId.get(String(id)) || `#${id}`);
}

function AssignmentRuleModal({ meta, editingRule, onCancel, onSubmit }) {
  const [form, setForm] = useState(
    editingRule
      ? {
          name: editingRule.name,
          branchIds: editingRule.branchIds.map(String),
          sourceIds: editingRule.sourceIds.map(String),
          employeeIds: editingRule.employeeIds.map(String),
        }
      : blankForm(),
  );
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  async function submit(event) {
    event.preventDefault();
    if (!form.name.trim()) return setNotice("Enter a rule name");
    if (!form.branchIds.length) return setNotice("Select at least one branch");
    if (!form.sourceIds.length) return setNotice("Select at least one source");
    if (!form.employeeIds.length) return setNotice("Select at least one user to assign leads to");
    setSaving(true);
    try {
      await onSubmit({
        name: form.name.trim(),
        branchIds: form.branchIds.map(Number),
        sourceIds: form.sourceIds.map(Number),
        employeeIds: form.employeeIds.map(Number),
      });
    } catch (error) {
      setNotice(error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="assignment-rule-overlay" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <section className="assignment-rule-modal" role="dialog" aria-modal="true" aria-labelledby="assignment-rule-title">
        <header className="modal-header">
          <h2 id="assignment-rule-title">{editingRule ? "Edit assignment rule" : "Add assignment rule"}</h2>
          <button type="button" onClick={onCancel} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <form onSubmit={submit}>
          <label>
            Rule name
            <input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="e.g. Mumbai · Website leads"
              autoFocus
            />
          </label>
          <label>
            Branch
            <MultiSearchSelect
              label="Branch"
              value={form.branchIds}
              onChange={(branchIds) => setForm({ ...form, branchIds })}
              options={idOptions(meta.branches)}
            />
          </label>
          <label>
            Source
            <MultiSearchSelect
              label="Source"
              value={form.sourceIds}
              onChange={(sourceIds) => setForm({ ...form, sourceIds })}
              options={idOptions(meta.sources, "displayName")}
            />
          </label>
          <label>
            Assign to users
            <MultiSearchSelect
              label="Assign to users"
              value={form.employeeIds}
              onChange={(employeeIds) => setForm({ ...form, employeeIds })}
              options={idOptions(meta.employees)}
            />
          </label>
          {notice && <div className="notice error">{notice}</div>}
          <div className="modal-footer">
            <button type="button" className="secondary" onClick={onCancel} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={saving}>
              {saving ? "Saving…" : editingRule ? "Save changes" : "Add rule"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function AssignmentRuleList({ rules, meta, modal, onOpenEdit, onCloseModal, onCreate, onUpdate, onToggleStatus, onDelete }) {
  function remove(rule) {
    if (!confirm(`Delete assignment rule “${rule.name}”?`)) return;
    onDelete(rule);
  }

  return (
    <article className="panel">
      <div className="table-tools">
        <span>{rules.length} rule{rules.length === 1 ? "" : "s"}</span>
      </div>
      <div className="table-wrap">
        {rules.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Rule name</th>
                <th>Created on</th>
                <th>Branch</th>
                <th>Source</th>
                <th>Assigned counselors</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id}>
                  <td>
                    <strong>{rule.name}</strong>
                  </td>
                  <td>
                    {new Date(rule.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                  </td>
                  <td>{namesFor(rule.branchIds, meta.branches).join(", ")}</td>
                  <td>{namesFor(rule.sourceIds, meta.sources, "displayName").join(", ")}</td>
                  <td>{namesFor(rule.employeeIds, meta.employees).join(", ")}</td>
                  <td>
                    <span className={`assignment-rule-status ${rule.isActive ? "active" : "inactive"}`}>
                      {rule.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td>
                    <div className="automation-row-actions">
                      <button className="icon-btn" onClick={() => onOpenEdit(rule)} title="Edit rule">
                        <Pencil />
                      </button>
                      <button
                        className={`icon-btn status-action ${rule.isActive ? "deactivate" : "activate"}`}
                        onClick={() => onToggleStatus(rule)}
                        title={rule.isActive ? "Disable rule" : "Enable rule"}
                      >
                        <Power />
                      </button>
                      <button className="icon-btn danger" onClick={() => remove(rule)} title="Delete rule">
                        <Trash2 />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!rules.length && (
          <div className="empty">
            <UserCog />
            <strong>No assignment rules yet</strong>
            <span>Add a rule to route new leads to the right counsellors automatically.</span>
          </div>
        )}
      </div>
      {modal && (
        <AssignmentRuleModal
          meta={meta}
          editingRule={modal.editingRule}
          onCancel={onCloseModal}
          onSubmit={async (payload) => {
            if (modal.editingRule) await onUpdate(modal.editingRule, payload);
            else await onCreate(payload);
            onCloseModal();
          }}
        />
      )}
    </article>
  );
}
