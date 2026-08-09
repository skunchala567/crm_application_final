import { useEffect, useState } from 'react';
import { Activity, CheckCircle2, PhoneCall, RefreshCw, Save } from 'lucide-react';
import { api } from '../api.js';
import './CallerDeskSettings.css';

const array=value=>Array.isArray(value)?value:Array.isArray(value?.data)?value.data:Array.isArray(value?.results)?value.results:[];
export default function SmartfloSettings({onMessage}){
  const [form,setForm]=useState({accountName:'Tata Smartflo',email:'',password:'',permanentToken:'',defaultDid:'',defaultDepartmentId:'',recordCalls:true,isActive:true});
  const [numbers,setNumbers]=useState([]),[departments,setDepartments]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const notify=(text,type='success')=>{setError(type==='error'?text:'');onMessage?.({type,text});};
  async function load(){const result=await api('/smartflo/config');setForm(current=>({...current,...result.data,password:'',permanentToken:''}));if(result.data.configured){const [numberResult,departmentResult]=await Promise.allSettled([api('/smartflo/numbers'),api('/smartflo/departments')]);setNumbers(numberResult.status==='fulfilled'?array(numberResult.value.data):[]);setDepartments(departmentResult.status==='fulfilled'?array(departmentResult.value.data):[]);}}
  useEffect(()=>{load().catch(e=>setError(e.message));},[]);
  async function save(e){e.preventDefault();setBusy(true);try{await api.put('/smartflo/config',form);notify('Smartflo configuration saved');await load();}catch(e){notify(e.message,'error');}finally{setBusy(false);}}
  async function test(){setBusy(true);try{await api.post('/smartflo/test',{});notify('Smartflo connection is working');await load();}catch(e){notify(e.message,'error');}finally{setBusy(false);}}
  return <div className="callerdesk-settings"><header className="page-action-row"><button className="secondary" onClick={()=>load().catch(e=>setError(e.message))}><RefreshCw size={16}/>Refresh</button></header>{error&&<div className="callerdesk-error">{error}</div>}
    <section className="callerdesk-guide"><strong>Configuration guide</strong><span><b>1</b>Save credentials/token</span><span><b>2</b>Test DID, IVR and user access</span><span><b>3</b>Map branch DIDs and IVRs</span><span><b>4</b>Map agents in User Management</span></section>
    <section className="callerdesk-card"><div className="section-title"><PhoneCall/><div><h2>Account setup</h2><p>Credentials and tokens are encrypted and never returned to the browser.</p></div>{form.configured&&<span className="connected"><CheckCircle2/>Connected</span>}</div><form className="callerdesk-grid" onSubmit={save}>
      <label>Account name<small>Friendly name inside CRM</small><input value={form.accountName||''} onChange={e=>setForm({...form,accountName:e.target.value})}/></label>
      <label>Smartflo login email<small>Use with password, or provide a permanent token instead</small><input type="email" value={form.email||''} onChange={e=>setForm({...form,email:e.target.value})}/></label>
      <label>Password<small>Creates a one-hour JWT token</small><input type="password" placeholder={form.hasPassword?'Leave blank to keep current password':'Smartflo password'} value={form.password||''} onChange={e=>setForm({...form,password:e.target.value})}/></label>
      <label>Permanent access token<small>Optional alternative supplied by Tata support</small><input type="password" placeholder={form.hasPermanentToken?'Leave blank to keep current token':'Optional permanent token'} value={form.permanentToken||''} onChange={e=>setForm({...form,permanentToken:e.target.value})}/></label>
      <label>Default DID<small>Fallback when a branch has no Smartflo DID</small><select value={form.defaultDid||''} onChange={e=>setForm({...form,defaultDid:e.target.value})}><option value="">Select My Number</option>{form.defaultDid&&!numbers.some(n=>String(n.did||n.number||n.did_number)===form.defaultDid)&&<option value={form.defaultDid}>{form.defaultDid} (saved)</option>}{numbers.map((n,i)=><option key={n.id||i} value={n.did||n.number||n.did_number}>{n.did||n.number||n.did_number||n.name}{n.destination_name?` · ${n.destination_name}`:''}</option>)}</select></label>
      <label>Default department<small>Fallback routing department</small><select value={form.defaultDepartmentId||''} onChange={e=>setForm({...form,defaultDepartmentId:e.target.value})}><option value="">No default department</option>{departments.map((d,i)=><option key={d.id||i} value={d.id}>{d.name||d.department_name}</option>)}</select></label>
      <label className="wide check-option"><input type="checkbox" checked={form.recordCalls!==false} onChange={e=>setForm({...form,recordCalls:e.target.checked})}/>Capture call recordings in CRM <small>Stores recording links returned by Tata. Provider-side recording must be enabled in Smartflo.</small></label>
      <div className="wide actions"><button type="button" className="secondary" disabled={!form.configured||busy} onClick={test}><Activity size={16}/>Test connection</button><button className="primary" disabled={busy}><Save size={16}/>{busy?'Saving…':'Save configuration'}</button></div>
    </form>{form.webhookPath&&<div className="webhook"><strong>Call-event webhook</strong><code>{location.origin.replace(/:\d+$/,':3001')}{form.webhookPath}</code><small>Configure this public HTTPS URL in Smartflo to capture outcomes, durations and recordings.</small></div>}</section>
  </div>;
}
