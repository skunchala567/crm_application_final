import { useEffect, useMemo, useState } from "react";
import {
  KeyRound,
  Pencil,
  Plus,
  Power,
  Search,
  ShieldCheck,
  UserCog,
  X,
} from "lucide-react";
import { api } from "./api";

const initialForm = {
  userType: "employee",
  employeeId: "",
  firstName: "",
  lastName: "",
  phone: "",
  email: "",
  roleName: "COUNSELLOR",
  branchIds: [],
  password: "",
  isActive: true,
};

function EmployeeSearch({ employees, value, onChange, disabled }) {
  const selected = employees.find(
    (employee) => String(employee.id) === String(value),
  );
  const [query, setQuery] = useState(
    selected ? `${selected.name} · ${selected.employeeNumber}` : "",
  );
  useEffect(() => {
    setQuery(selected ? `${selected.name} · ${selected.employeeNumber}` : "");
  }, [value, selected?.name]);
  const suggestions = useMemo(() => {
    const term = query.toLowerCase().trim();
    if (!term) return employees.slice(0, 30);
    return employees
      .filter((employee) =>
        `${employee.name} ${employee.employeeNumber} ${employee.employeeBranch || ""}`
          .toLowerCase()
          .includes(term),
      )
      .slice(0, 30);
  }, [employees, query]);
  return (
    <div className="employee-picker">
      <div className="suggestion-field">
        <Search size={15} />
        <input
          disabled={disabled}
          value={query}
          placeholder="Search employee name or number…"
          onChange={(event) => {
            setQuery(event.target.value);
            onChange("");
          }}
        />
      </div>
      {!disabled && query && !selected && (
        <div className="employee-results">
          {suggestions.map((employee) => (
            <button
              type="button"
              key={employee.id}
              onClick={() => {
                onChange(employee.id);
                setQuery(`${employee.name} · ${employee.employeeNumber}`);
              }}
            >
              <span className="avatar muted">
                {employee.name
                  .split(" ")
                  .map((name) => name[0])
                  .slice(0, 2)
                  .join("")}
              </span>
              <span>
                <strong>{employee.name}</strong>
                <small>
                  {employee.employeeNumber} ·{" "}
                  {employee.employeeBranch || "No employee branch"}
                </small>
              </span>
              {employee.userId && <em>Existing login</em>}
            </button>
          ))}
          {!suggestions.length && <p>No matching active employees</p>}
        </div>
      )}
    </div>
  );
}

export default function UserManagementPage() {
  const [users, setUsers] = useState([]);
  const [meta, setMeta] = useState({ employees: [], branches: [], roles: [] });
  const [search, setSearch] = useState("");
  const [drawer, setDrawer] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [userResult, metaResult] = await Promise.all([
        api("/admin/users"),
        api("/admin/users/meta"),
      ]);
      setUsers(userResult.data);
      setMeta(metaResult);
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  const filtered = users.filter((user) =>
    `${user.name} ${user.email} ${user.employeeNumber || ""} ${user.branchNames || ""} ${user.roles.join(" ")}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const selectedEmployee = meta.employees.find(
    (employee) => String(employee.id) === String(form.employeeId),
  );
  const isExistingLogin = Boolean(selectedEmployee?.userId);

  function createUser() {
    setForm(initialForm);
    setDrawer({ mode: "create", title: "Add CRM user" });
  }
  function editUser(user) {
    setForm({
      userType: user.employeeId ? "employee" : "external",
      employeeId: user.employeeId || "",
      firstName: user.firstName || "",
      lastName: user.lastName || "",
      phone: user.phone || "",
      email: user.email,
      roleName: user.roles.find((role) => role !== "ADMIN") || "CRM_ADMIN",
      branchIds: user.branchIds,
      password: "",
      isActive: user.isActive,
    });
    setDrawer({
      mode: "edit",
      id: user.id,
      title: `Configure ${user.name}`,
      isSystemAdmin: user.isSystemAdmin,
    });
  }
  function toggleBranch(id) {
    setForm((current) => ({
      ...current,
      branchIds: current.branchIds.includes(id)
        ? current.branchIds.filter((branchId) => branchId !== id)
        : [...current.branchIds, id],
    }));
  }
  function selectEmployee(employeeId) {
    const employee = meta.employees.find(
      (item) => String(item.id) === String(employeeId),
    );
    setForm((current) => ({
      ...current,
      employeeId,
      email: employee?.loginEmail || employee?.email || "",
      branchIds:
        employee?.employeeBranchId &&
        meta.branches.some(
          (branch) => String(branch.id) === String(employee.employeeBranchId),
        )
          ? [Number(employee.employeeBranchId)]
          : current.branchIds,
    }));
  }
  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const editing = drawer.mode === "edit";
      const result = await api(
        editing ? `/admin/users/${drawer.id}` : "/admin/users",
        { method: editing ? "PUT" : "POST", body: JSON.stringify(form) },
      );
      setDrawer(null);
      setMessage({ type: "success", text: result.message });
      await load();
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setSaving(false);
    }
  }
  async function toggleStatus(user) {
    try {
      const result = await api(`/admin/users/${user.id}/status`, {
        method: "PUT",
        body: JSON.stringify({isActive:!user.isActive}),
      });
      setMessage({ type: "success", text: result.message });
      await load();
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    }
  }

  return (
    <main className="page user-management-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">CRM administration</span>
          <h1>User management</h1>
          <p>
            Grant CRM access to existing employees or create standalone CRM
            users who are not available in the employee master.
          </p>
        </div>
        <button className="primary" onClick={createUser}>
          <Plus size={18} /> Add CRM user
        </button>
      </div>
      {message && (
        <div className={`notice ${message.type}`}>
          <span>{message.text}</span>
          <button onClick={() => setMessage(null)}>
            <X size={16} />
          </button>
        </div>
      )}
      <section className="user-stats">
        <article>
          <span className="stat-icon violet">
            <UserCog />
          </span>
          <div>
            <strong>{users.length}</strong>
            <small>CRM users</small>
          </div>
        </article>
        <article>
          <span className="stat-icon green">
            <ShieldCheck />
          </span>
          <div>
            <strong>{users.filter((user) => user.isActive).length}</strong>
            <small>Active accounts</small>
          </div>
        </article>
        <article>
          <span className="stat-icon orange">
            <KeyRound />
          </span>
          <div>
            <strong>
              {users.filter((user) => user.roles.includes("COUNSELLOR")).length}
            </strong>
            <small>Counsellors</small>
          </div>
        </article>
      </section>
      <article className="panel">
        <div className="table-tools">
          <div className="local-search">
            <Search size={18} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search users, roles, or branches"
            />
          </div>
          <span>{filtered.length} users</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>CRM role</th>
                <th>CRM branches</th>
                <th>Status</th>
                <th>Last login</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((user) => (
                <tr key={user.id}>
                  <td>
                    <div className="student">
                      <span className="avatar muted">
                        {user.name
                          .split(" ")
                          .map((name) => name[0])
                          .slice(0, 2)
                          .join("")}
                      </span>
                      <span>
                        <strong>{user.name}</strong>
                        <small>{user.email}</small>
                      </span>
                    </div>
                  </td>
                  <td>
                    <span className="role-badge">
                      {user.roles.join(", ") || "No dedicated role"}
                    </span>
                  </td>
                  <td className="branch-cell">
                    {user.branchNames ||
                      (user.isSystemAdmin
                        ? "Attendance admin scope"
                        : "Not assigned")}
                  </td>
                  <td>
                    <span
                      className={`status-pill ${user.isActive ? "active" : "inactive"}`}
                    >
                      {user.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td>
                    {user.lastLoginAt
                      ? new Date(user.lastLoginAt).toLocaleString("en-IN", {
                          dateStyle: "medium",
                          timeStyle: "short",
                          timeZone: "Asia/Kolkata",
                        })
                      : "Never"}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button title="Configure" onClick={() => editUser(user)}>
                        <Pencil size={15} />
                      </button>
                      {!user.isSystemAdmin && (
                        <button
                          className={user.isActive ? "status-action deactivate" : "status-action activate"}
                          title={user.isActive ? "Mark CRM user inactive" : "Mark CRM user active"}
                          onClick={() => toggleStatus(user)}
                        >
                          <Power size={15} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading && (
            <div className="loading">
              <span />
              <p>Loading CRM users…</p>
            </div>
          )}
          {!loading && !filtered.length && (
            <div className="empty">
              <UserCog />
              <strong>No CRM users found</strong>
              <span>Add an employee-linked or standalone CRM user to get started.</span>
            </div>
          )}
        </div>
      </article>
      {drawer && (
        <>
          <div className="drawer-backdrop" onClick={() => setDrawer(null)} />
          <aside className="lead-drawer user-drawer">
            <div className="drawer-head">
              <div>
                <span className="eyebrow">Access configuration</span>
                <h2>{drawer.title}</h2>
              </div>
              <button className="icon-btn" onClick={() => setDrawer(null)}>
                <X />
              </button>
            </div>
            <form onSubmit={save}>
              <div className="form-section">
                <h3>User identity and login</h3>
                <div className="form-grid">
                  <div className="wide account-origin-options">
                    <span className="field-label">User source</span>
                    <div className="crm-status-options">
                      <button type="button" disabled={drawer.mode==="edit"} className={form.userType==="employee"?"active":""} onClick={()=>setForm({...initialForm,userType:"employee"})}><i/>Existing employee<span>Select from the active employee master.</span></button>
                      <button type="button" disabled={drawer.mode==="edit"} className={form.userType==="external"?"active":""} onClick={()=>setForm({...initialForm,userType:"external"})}><i/>New external user<span>Create a CRM-only user not present in employees.</span></button>
                    </div>
                  </div>
                  {form.userType==="employee"?<label className="wide">
                      Employee *
                      <EmployeeSearch
                        employees={meta.employees}
                        value={form.employeeId}
                        onChange={selectEmployee}
                        disabled={drawer.mode === "edit"}
                      />
                    </label>:<>
                    <label>First name *<input required value={form.firstName} onChange={event=>setForm({...form,firstName:event.target.value})}/></label>
                    <label>Last name *<input required value={form.lastName} onChange={event=>setForm({...form,lastName:event.target.value})}/></label>
                    <label className="wide">Phone<input type="tel" value={form.phone} onChange={event=>setForm({...form,phone:event.target.value.replace(/[^0-9+()\-\s]/g,"").slice(0,30)})}/></label>
                  </>}
                  <label className="wide">
                    Login email *
                    <input
                      type="email"
                      required
                      value={form.email}
                      disabled={(form.userType==="employee"&&isExistingLogin) || drawer.mode === "edit"}
                      onChange={(event) =>
                        setForm({ ...form, email: event.target.value })
                      }
                    />
                  </label>
                  <label className="wide">
                    {(form.userType==="employee"&&isExistingLogin) || drawer.mode === "edit"
                      ? "New password (optional)"
                      : "Initial password *"}
                    <input
                      type="password"
                      required={drawer.mode === "create" && (form.userType==="external"||!isExistingLogin)}
                      minLength="8"
                      value={form.password}
                      onChange={(event) =>
                        setForm({ ...form, password: event.target.value })
                      }
                      placeholder={
                        (form.userType==="employee"&&isExistingLogin)
                          ? "Leave blank to keep current password"
                          : "Minimum 8 characters"
                      }
                    />
                  </label>
                  {form.userType==="external"&&<div className="account-note wide"><strong>Standalone CRM login</strong><span>This user is not added to the employee master. Their access is limited to the CRM role and branches configured below.</span></div>}
                  {form.userType==="employee"&&selectedEmployee && (
                    <div className="account-note wide">
                      <strong>
                        {isExistingLogin
                          ? "Existing Attendance login"
                          : "New shared login"}
                      </strong>
                      <span>
                        {isExistingLogin
                          ? "The current email and password remain unchanged unless a new password is entered."
                          : "A shared Attendance/CRM login will be created for this employee."}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <div className="form-section">
                <h3>CRM user status</h3>
                <div className="crm-status-options">
                  <button type="button" className={form.isActive?"active":""} onClick={()=>setForm({...form,isActive:true})}><i/> Active<span>User can sign in and access assigned CRM branches.</span></button>
                  <button type="button" className={!form.isActive?"inactive":""} onClick={()=>setForm({...form,isActive:false})}><i/> Inactive<span>CRM access is paused; assignments and Attendance access remain unchanged.</span></button>
                </div>
              </div>
              <div className="form-section">
                <h3>CRM role</h3>
                <div className="role-options">
                  {meta.roles.map((role) => (
                    <label
                      key={role.name}
                      className={form.roleName === role.name ? "selected" : ""}
                    >
                      <input
                        type="radio"
                        name="crm-role"
                        value={role.name}
                        checked={form.roleName === role.name}
                        onChange={() =>
                          setForm({ ...form, roleName: role.name })
                        }
                      />
                      <span>
                        <strong>{role.displayName}</strong>
                        <small>{role.description}</small>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="form-section">
                <h3>CRM branch access *</h3>
                <p className="section-help">
                  These assignments affect only CRM data access.
                </p>
                <div className="branch-options">
                  {meta.branches.map((branch) => (
                    <label
                      key={branch.id}
                      className={
                        form.branchIds.includes(Number(branch.id))
                          ? "selected"
                          : ""
                      }
                    >
                      <input
                        type="checkbox"
                        checked={form.branchIds.includes(Number(branch.id))}
                        onChange={() => toggleBranch(Number(branch.id))}
                      />
                      <span>
                        <strong>{branch.name}</strong>
                        <small>{branch.shortName}</small>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="drawer-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setDrawer(null)}
                >
                  Cancel
                </button>
                <button className="primary" disabled={saving}>
                  {saving
                    ? "Saving…"
                    : drawer.mode === "edit"
                      ? "Save access"
                      : "Add CRM user"}
                </button>
              </div>
            </form>
          </aside>
        </>
      )}
    </main>
  );
}
