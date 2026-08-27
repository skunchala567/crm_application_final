import { useEffect,useState } from 'react';
import { Activity,PhoneCall,RefreshCw,Save } from 'lucide-react';
import { api } from '../api.js';
import './CallerDeskSettings.css';

export default function BonvoiceSettings({onMessage}){
  const [form,setForm]=useState({accountName:'BonVoice',username:'',password:'',token:'',defaultDid:'',defaultChannelId:'1',ringStrategy:'ringall',recordCalls:true,isActive:true});
  const [branches,setBranches]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const notify=(text,type='success')=>{setError(type==='error'?text:'');onMessage?.({type,text});};
  async function load(){const result=await api('/bonvoice/config');setForm(current=>({...current,...result.data,username:'',password:'',token:''}));if(result.data.configured){const mapped=await api('/bonvoice/branch-dids');setBranches(mapped.data||[]);}}
  useEffect(()=>{load().catch(e=>setError(e.message));},[]);
  async function save(e){e.preventDefault();setBusy(true);try{const result=await api.put('/bonvoice/config',form);notify(result.message);await load();}catch(e){notify(e.message,'error');}finally{setBusy(false);}}
  async function test(){setBusy(true);try{const result=await api.post('/bonvoice/test',{});notify(result.message);}catch(e){notify(e.message,'error');}finally{setBusy(false);}}
  async function saveBranch(branch){setBusy(true);try{await api.put(`/bonvoice/branch-dids/${branch.branchId}`,branch);notify(`${branch.branchName} mapping saved`);}catch(e){notify(e.message,'error');}finally{setBusy(false);}}
  return <div className="callerdesk-settings">{error&&<div className="callerdesk-error">{error}</div>}
    <section className="callerdesk-guide"><strong>Configuration guide</strong><span><b>1</b>Save credentials</span><span><b>2</b>Map the account DID</span><span><b>3</b>Configure BonVoice callbacks</span><span><b>4</b>Test a lead call</span></section>
    <section className="callerdesk-card"><div className="section-title"><PhoneCall/><div><h2>BonVoice IVR account</h2><p>Credentials are encrypted. Calls use BonVoice two-leg bridging and recordings are captured from hangup callbacks.</p></div>{form.configured&&<span className="connected">Connected</span>}</div>
      <form className="callerdesk-grid" onSubmit={save}>
        <label>Account name<input value={form.accountName||''} onChange={e=>setForm({...form,accountName:e.target.value})}/></label>
        <label>Username<small>Leave blank to keep the saved username</small><input value={form.username||''} onChange={e=>setForm({...form,username:e.target.value})}/></label>
        <label>Password<small>Leave blank to keep the saved password</small><input type="password" value={form.password||''} onChange={e=>setForm({...form,password:e.target.value})}/></label>
        <label>API token<small>Optional alternative to username/password</small><input type="password" value={form.token||''} onChange={e=>setForm({...form,token:e.target.value})}/></label>
        <label>Default DID *<input inputMode="tel" required value={form.defaultDid||''} onChange={e=>setForm({...form,defaultDid:e.target.value})}/></label>
        <label>Channel ID<input value={form.defaultChannelId||'1'} onChange={e=>setForm({...form,defaultChannelId:e.target.value})}/></label>
        <label>Ring strategy<select value={form.ringStrategy||'ringall'} onChange={e=>setForm({...form,ringStrategy:e.target.value})}><option value="ringall">Ring all</option></select></label>
        <label className="wide check-option"><input type="checkbox" checked={form.recordCalls!==false} onChange={e=>setForm({...form,recordCalls:e.target.checked})}/>Capture call recordings in CRM<small>Stores ResourceURL received in BonVoice hangup events.</small></label>
        <div className="wide actions"><button type="button" className="secondary" disabled={!form.configured||busy} onClick={test}><Activity size={16}/>Test connection</button><button className="primary" disabled={busy}><Save size={16}/>{busy?'Saving…':'Save configuration'}</button></div>
      </form>{form.webhookPath&&<div className="webhook"><strong>Call notification and hangup callback</strong><code>{location.origin.replace(/:\d+$/,':3001')}{form.webhookPath}</code><small>Configure this URL in BonVoice for both JSON or x-www-form-urlencoded lifecycle callbacks.</small></div>}
    </section>
    {form.configured&&<section className="callerdesk-card"><div className="section-title"><PhoneCall/><div><h2>Branch DID mapping</h2><p>Override the default DID and channel for individual branches.</p></div><button type="button" onClick={()=>load().catch(e=>setError(e.message))}><RefreshCw size={15}/>Refresh</button></div><div className="did-list"><div className="did-head"><span>Branch</span><span>DID</span><span>Channel</span><span>Directions</span><span/></div>{branches.map((branch,index)=><div className="did-row" key={branch.branchId}><strong>{branch.branchName}</strong><input value={branch.didNumber||''} onChange={e=>setBranches(rows=>rows.map((x,i)=>i===index?{...x,didNumber:e.target.value}:x))}/><input value={branch.channelId||'1'} onChange={e=>setBranches(rows=>rows.map((x,i)=>i===index?{...x,channelId:e.target.value}:x))}/><div className="did-switches"><label><input type="checkbox" checked={Boolean(branch.inboundEnabled)} onChange={e=>setBranches(rows=>rows.map((x,i)=>i===index?{...x,inboundEnabled:e.target.checked}:x))}/>Inbound</label><label><input type="checkbox" checked={Boolean(branch.outboundEnabled)} onChange={e=>setBranches(rows=>rows.map((x,i)=>i===index?{...x,outboundEnabled:e.target.checked}:x))}/>Outbound</label></div><button type="button" disabled={busy} onClick={()=>saveBranch(branch)}>Save</button></div>)}</div></section>}
  </div>;
}
