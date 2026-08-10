import { useEffect, useMemo, useState } from "react";
import { KeyRound, Pencil, Plus, Power, Search, ShieldCheck, UserCog, X } from "lucide-react";
import { api } from "./api";
import AccessControlPanel from "./components/AccessControlPanel.jsx";
import { Can } from "./components/Can.jsx";
import { usePermissions } from "./PermissionContext.jsx";

const initialForm = {
  userType: "employee",
  employeeId: "",
  firstName: "",
  lastName: "",
  phone: "",
  email: "",
  roleName: "COUNSELLOR",
  branchIds: [],
  businessUnitIds: [],
  password: "",
  isActive: true,
  callerdeskEnabled: false,
  callerdeskMemberId: "",
  callerdeskMemberName: "",
  callerdeskMemberNumber: "",
  callerdeskCallGroup: "",
  smartfloEnabled: false,
  smartfloUserId: "",
  smartfloAgentId: "",
  smartfloAgentName: "",
  smartfloAgentNumber: "",
  smartfloDepartmentId: "",
};

function firstOptionArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const key of ["data","list","result","records","member_list","members","group_list","groups","users","departments"]) {
    const nested=value[key]; if(Array.isArray(nested))return nested;
    const found=firstOptionArray(nested); if(found.length)return found;
  }
  return [];
}

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

/** Tabs across the top of User Management. */
function UserManagementTabs({ activeTab, onChange, canSeeAccess }) {
  const tabs = [
    { key: 'users', label: 'Users', icon: UserCog },
    ...(canSeeAccess ? [{ key: 'access', label: 'Access Control', icon: ShieldCheck }] : []),
  ];
  if (tabs.length < 2) return null;
  return (
    <div className="ui-tabs flex items-center mb-4" role="tablist">
      {tabs.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          role="tab"
          aria-selected={activeTab === key}
          data-state={activeTab === key ? 'active' : 'inactive'}
          onClick={() => onChange(key)}
          className="ui-tab"
        >
          <Icon size={15} /> {label}
        </button>
      ))}
    </div>
  );
}

export default function UserManagementPage() {
  const { can } = usePermissions();
  const canSeeAccess = can('settings.access_control.view');
  const [activeTab, setActiveTab] = useState('users');
  const [users, setUsers] = useState([]);
  const [meta, setMeta] = useState({ employees: [], branches: [], roles: [] });
  const [search, setSearch] = useState("");
  const [drawer, setDrawer] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [callingOptions,setCallingOptions]=useState({configured:false,members:[],groups:[]});
  const [smartfloOptions,setSmartfloOptions]=useState({configured:false,users:[],departments:[]});

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
    api('/callerdesk/config').then(result=>result.data?.configured?Promise.allSettled([api('/callerdesk/members'),api('/callerdesk/groups')]):null).then(results=>{
      if(!results)return;
      setCallingOptions({configured:true,members:results[0].status==='fulfilled'?firstOptionArray(results[0].value.data):[],groups:results[1].status==='fulfilled'?firstOptionArray(results[1].value.data):[]});
    }).catch(()=>setCallingOptions({configured:false,members:[],groups:[]}));
    api('/smartflo/config').then(result=>result.data?.configured?Promise.allSettled([api('/smartflo/users'),api('/smartflo/departments')]):null).then(results=>{
      if(!results)return;
      setSmartfloOptions({configured:true,users:results[0].status==='fulfilled'?firstOptionArray(results[0].value.data):[],departments:results[1].status==='fulfilled'?firstOptionArray(results[1].value.data):[]});
    }).catch(()=>setSmartfloOptions({configured:false,users:[],departments:[]}));
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
      branchIds: user.branchIds || [],
      // Was missing entirely, so form.businessUnitIds came back undefined and
      // the business unit picker threw on .includes -- taking the whole app
      // down with it. Invisible until a second business unit existed, because
      // that section only renders when there is more than one to choose from.
      businessUnitIds: user.businessUnitIds || [],
      password: "",
      isActive: user.isActive,
      callerdeskEnabled: user.callerdeskEnabled,
      callerdeskMemberId: user.callerdeskMemberId || "",
      callerdeskMemberName: user.callerdeskMemberName || "",
      callerdeskMemberNumber: user.callerdeskMemberNumber || "",
      callerdeskCallGroup: user.callerdeskCallGroup || "",
      smartfloEnabled: user.smartfloEnabled,
      smartfloUserId: user.smartfloUserId || "",
      smartfloAgentId: user.smartfloAgentId || "",
      smartfloAgentName: user.smartfloAgentName || "",
      smartfloAgentNumber: user.smartfloAgentNumber || "",
      smartfloDepartmentId: user.smartfloDepartmentId || "",
    });
    setDrawer({
      mode: "edit",
      id: user.id,
      title: `Configure ${user.name}`,
    });
  }
  /* Both pickers read through this rather than the form field directly. A
     user record that arrives without one of these lists is a data problem,
     not a reason for the screen to stop existing. */
  const selectedIds = (key) => (Array.isArray(form[key]) ? form[key] : []);

  function toggleBusinessUnit(id) {
    setForm((current) => {
      const chosen = Array.isArray(current.businessUnitIds) ? current.businessUnitIds : [];
      return {
        ...current,
        businessUnitIds: chosen.includes(id) ? chosen.filter((value) => value !== id) : [...chosen, id],
      };
    });
  }
  function toggleBranch(id) {
    setForm((current) => {
      const chosen = Array.isArray(current.branchIds) ? current.branchIds : [];
      return {
        ...current,
        branchIds: chosen.includes(id) ? chosen.filter((branchId) => branchId !== id) : [...chosen, id],
      };
    });
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
  function selectCallerDeskMember(memberId){
    const member=callingOptions.members.find(item=>String(item.member_id??item.id)===String(memberId));
    setForm(current=>({...current,callerdeskMemberId:memberId,callerdeskMemberName:member?.member_name||member?.name||'',callerdeskMemberNumber:String(member?.member_num||member?.number||'')}));
  }
  function selectSmartfloUser(userId){
    const user=smartfloOptions.users.find(item=>String(item.id??item.user_id)===String(userId));
    const agent=user?.agent||{};
    setForm(current=>({...current,smartfloUserId:userId,smartfloAgentId:String(agent.id??user?.agent_id??''),smartfloAgentName:agent.name??user?.agent_name??user?.name??'',smartfloAgentNumber:String(agent.follow_me_number??user?.agent_number??user?.phone??'')}));
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

  if (activeTab === "access") {
    return (
      <main className="page user-management-page">
        <UserManagementTabs activeTab={activeTab} onChange={setActiveTab} canSeeAccess={canSeeAccess} />
        <AccessControlPanel />
      </main>
    );
  }

  return (
    <main className="page user-management-page">
      <UserManagementTabs activeTab={activeTab} onChange={setActiveTab} canSeeAccess={canSeeAccess} />
      <div className="page-action-row">
        <Can do="settings.users.create">
          <button className="primary" onClick={createUser}>
            <Plus size={18} /> Add CRM user
          </button>
        </Can>
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
                    {user.branchNames || "Not assigned"}
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
                      {(
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
                    <label className="wide">Phone<input type="tel" inputMode="numeric" maxLength="10" pattern="[6-9][0-9]{9}" title="Enter a valid 10-digit Indian mobile number starting with 6-9" placeholder="10-digit mobile number" value={form.phone} onChange={event=>setForm({...form,phone:event.target.value.replace(/\D/g,"").slice(0,10)})}/></label>
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
                <h3>CallerDesk one-click calling</h3>
                <p className="section-help">Map this CRM user to a member returned by the connected CallerDesk account.</p>
                {!callingOptions.configured?<div className="account-note"><strong>CallerDesk is not configured</strong><span>Connect CallerDesk from Settings → Integrations before mapping members.</span></div>:<div className="form-grid">
                  <label className="check-option wide"><input type="checkbox" checked={form.callerdeskEnabled} onChange={event=>setForm({...form,callerdeskEnabled:event.target.checked})}/>Enable one-click calling for this user</label>
                  {form.callerdeskEnabled&&<>
                    <label className="wide">CallerDesk member *<select required value={form.callerdeskMemberId} onChange={event=>selectCallerDeskMember(event.target.value)}><option value="">Select member</option>{form.callerdeskMemberId&&!callingOptions.members.some(item=>String(item.member_id??item.id)===String(form.callerdeskMemberId))&&<option value={form.callerdeskMemberId}>{form.callerdeskMemberName||form.callerdeskMemberNumber} (saved)</option>}{callingOptions.members.map((member,index)=><option key={member.member_id||member.id||index} value={member.member_id||member.id}>{member.member_name||member.name||member.member_num} · {member.member_num||member.number||''}</option>)}</select></label>
                    <label>Member name<input readOnly value={form.callerdeskMemberName}/></label>
                    <label>Member number<input readOnly value={form.callerdeskMemberNumber}/></label>
                    <label className="wide">Call group<select value={form.callerdeskCallGroup} onChange={event=>setForm({...form,callerdeskCallGroup:event.target.value})}><option value="">Use branch/account default group</option>{form.callerdeskCallGroup&&!callingOptions.groups.some(item=>(item.group_name||item.name)===form.callerdeskCallGroup)&&<option value={form.callerdeskCallGroup}>{form.callerdeskCallGroup} (saved)</option>}{callingOptions.groups.map((group,index)=><option key={group.group_id||group.id||index} value={group.group_name||group.name}>{group.group_name||group.name}</option>)}</select></label>
                  </>}
                </div>}
              </div>
              <div className="form-section">
                <h3>Tata Smartflo one-click calling</h3>
                <p className="section-help">Map this CRM user to a user and agent returned by the connected Tata Smartflo account.</p>
                {!smartfloOptions.configured?<div className="account-note"><strong>Smartflo is not configured</strong><span>Connect Tata Smartflo from Settings → Integrations before mapping agents.</span></div>:<div className="form-grid">
                  <label className="check-option wide"><input type="checkbox" checked={form.smartfloEnabled} onChange={event=>setForm({...form,smartfloEnabled:event.target.checked})}/>Enable Smartflo one-click calling for this user</label>
                  {form.smartfloEnabled&&<>
                    <label className="wide">Smartflo user / agent *<select required value={form.smartfloUserId} onChange={event=>selectSmartfloUser(event.target.value)}><option value="">Select Smartflo user</option>{form.smartfloUserId&&!smartfloOptions.users.some(item=>String(item.id??item.user_id)===String(form.smartfloUserId))&&<option value={form.smartfloUserId}>{form.smartfloAgentName||form.smartfloAgentNumber} (saved)</option>}{smartfloOptions.users.map((user,index)=>{const agent=user.agent||{};return <option key={user.id||user.user_id||index} value={user.id||user.user_id}>{agent.name||user.name||user.login_id} · {agent.follow_me_number||user.phone||'No number'}</option>;})}</select></label>
                    <label>Agent name<input readOnly value={form.smartfloAgentName}/></label>
                    <label>Agent number<input readOnly value={form.smartfloAgentNumber}/></label>
                    <label className="wide">Department<select value={form.smartfloDepartmentId} onChange={event=>setForm({...form,smartfloDepartmentId:event.target.value})}><option value="">Use branch/account default department</option>{form.smartfloDepartmentId&&!smartfloOptions.departments.some(item=>String(item.id??item.department_id)===String(form.smartfloDepartmentId))&&<option value={form.smartfloDepartmentId}>{form.smartfloDepartmentId} (saved)</option>}{smartfloOptions.departments.map((department,index)=><option key={department.id||department.department_id||index} value={department.id||department.department_id}>{department.name||department.department_name}</option>)}</select></label>
                  </>}
                </div>}
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
              {/* Only shown when there is a choice to make. With a single
                  business unit configured, every CRM user belongs to it and
                  the control would be a checkbox that can never be unticked. */}
              {meta.businessUnits?.length > 1 && (
                <div className="form-section">
                  <h3>Business unit access</h3>
                  <p className="section-help">
                    Which businesses this user can work in. The first selected one
                    is where the CRM opens for them. Leave empty to keep the
                    current assignment.
                  </p>
                  <div className="branch-options">
                    {meta.businessUnits.map((unit) => (
                      <label
                        key={unit.id}
                        className={selectedIds("businessUnitIds").includes(Number(unit.id)) ? "selected" : ""}
                      >
                        <input
                          type="checkbox"
                          checked={selectedIds("businessUnitIds").includes(Number(unit.id))}
                          onChange={() => toggleBusinessUnit(Number(unit.id))}
                        />
                        <span><strong>{unit.name}</strong></span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
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
                        selectedIds("branchIds").includes(Number(branch.id))
                          ? "selected"
                          : ""
                      }
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds("branchIds").includes(Number(branch.id))}
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
