import { useEffect,useState } from 'react';
import { Activity,PhoneCall,Plus,RefreshCw,Save,Trash2 } from 'lucide-react';
import { api } from '../api.js';
import './CallerDeskSettings.css';

const blankDid=()=>({didNumber:'',label:'',channelId:'1',inboundEnabled:true,outboundEnabled:true,isActive:true,primaryBranchId:null,branches:[]});

export default function BonvoiceSettings({onMessage}){
  const [form,setForm]=useState({accountName:'BonVoice',username:'',password:'',token:'',defaultDid:'',defaultChannelId:'1',ringStrategy:'ringall',recordCalls:true,isActive:true});
  const [dids,setDids]=useState([]),[branches,setBranches]=useState([]),[draft,setDraft]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const notify=(text,type='success')=>{setError(type==='error'?text:'');onMessage?.({type,text});};
  async function load(){const result=await api('/bonvoice/config');setForm(current=>({...current,...result.data,username:'',password:'',token:''}));if(result.data.configured){const inventory=await api('/bonvoice/dids');setDids(inventory.data||[]);setBranches(inventory.branches||[]);}}
  useEffect(()=>{load().catch(e=>setError(e.message));},[]);
  async function save(e){e.preventDefault();setBusy(true);try{const result=await api.put('/bonvoice/config',form);notify(result.message);await load();}catch(e){notify(e.message,'error');}finally{setBusy(false);}}
  async function test(){setBusy(true);try{const result=await api.post('/bonvoice/test',{});notify(result.message);}catch(e){notify(e.message,'error');}finally{setBusy(false);}}
  const updateDid=(id,changes)=>setDids(items=>items.map(item=>item.id===id?{...item,...changes}:item));
  const toggleBranch=(item,branchId,selected)=>{const links=selected?[...(item.branches||[]),{branchId,isPrimaryOutbound:false}]:(item.branches||[]).filter(link=>link.branchId!==branchId);const primaryBranchId=links.some(link=>link.branchId===Number(item.primaryBranchId))?item.primaryBranchId:null;return {...item,branches:links,primaryBranchId};};
  async function saveDid(item){setBusy(true);try{await (item.id?api.put(`/bonvoice/dids/${item.id}`,item):api.post('/bonvoice/dids',item));notify(`DID ${item.didNumber} saved`);setDraft(null);await load();}catch(e){notify(e.message,'error');}finally{setBusy(false);}}
  async function removeDid(item){if(!window.confirm(`Remove DID ${item.didNumber}? Existing call history will be retained.`))return;setBusy(true);try{await api.delete(`/bonvoice/dids/${item.id}`);notify(`DID ${item.didNumber} removed`);await load();}catch(e){notify(e.message,'error');}finally{setBusy(false);}}
  const renderDid=item=>{
    const set=changes=>item.id?updateDid(item.id,changes):setDraft(current=>({...current,...changes}));
    const shared=(item.branches||[]).length>1;
    return <article className="bonvoice-did-card" key={item.id||'new'}>
      <div className="bonvoice-did-fields">
        <label>DID number<input inputMode="tel" value={item.didNumber||''} onChange={e=>set({didNumber:e.target.value})} placeholder="e.g. 8045678901"/></label>
        <label>Label<input value={item.label||''} onChange={e=>set({label:e.target.value})} placeholder="Admissions main line"/></label>
        <label>Channel ID<input value={item.channelId||'1'} onChange={e=>set({channelId:e.target.value})}/></label>
        <label className="did-enabled"><input type="checkbox" checked={item.isActive!==false} onChange={e=>set({isActive:e.target.checked})}/>Active</label>
      </div>
      <div className="bonvoice-directions"><label><input type="checkbox" checked={item.inboundEnabled!==false} onChange={e=>set({inboundEnabled:e.target.checked})}/>Inbound</label><label><input type="checkbox" checked={item.outboundEnabled!==false} onChange={e=>set({outboundEnabled:e.target.checked})}/>Outbound</label></div>
      <div className="bonvoice-branch-grid">{branches.map(branch=>{const link=(item.branches||[]).find(value=>value.branchId===branch.id);return <div key={branch.id} className={link?'selected':''}>
        <label><input type="checkbox" checked={Boolean(link)} onChange={e=>{const next=toggleBranch(item,branch.id,e.target.checked);set({branches:next.branches,primaryBranchId:next.primaryBranchId});}}/>{branch.name}</label>
        {link&&item.outboundEnabled!==false&&<label className="sub-option"><input type="checkbox" checked={Boolean(link.isPrimaryOutbound)} onChange={e=>set({branches:item.branches.map(value=>value.branchId===branch.id?{...value,isPrimaryOutbound:e.target.checked}:value)})}/>Default outbound</label>}
      </div>;})}</div>
      {item.inboundEnabled!==false&&<label className="bonvoice-primary">Inbound fallback branch {shared&&<b>required for a shared DID</b>}<select value={item.primaryBranchId||''} onChange={e=>set({primaryBranchId:Number(e.target.value)||null})}><option value="">{shared?'Select primary branch':'Automatic for one branch'}</option>{(item.branches||[]).map(link=>{const branch=branches.find(value=>value.id===link.branchId);return branch?<option key={branch.id} value={branch.id}>{branch.name}</option>:null;})}</select></label>}
      {shared&&item.inboundEnabled!==false&&!item.primaryBranchId&&<div className="callerdesk-hint">Incoming calls that do not match an existing lead need a primary branch.</div>}
      <div className="bonvoice-did-actions"><button type="button" className="primary" disabled={busy} onClick={()=>saveDid(item)}><Save size={15}/>Save DID</button>{item.id?<button type="button" className="danger" disabled={busy} onClick={()=>removeDid(item)}><Trash2 size={15}/>Remove</button>:<button type="button" disabled={busy} onClick={()=>setDraft(null)}>Cancel</button>}</div>
    </article>;
  };
  return <div className="callerdesk-settings">{error&&<div className="callerdesk-error">{error}</div>}
    <section className="callerdesk-guide"><strong>Configuration guide</strong><span><b>1</b>Save credentials</span><span><b>2</b>Add account DIDs</span><span><b>3</b>Map branches</span><span><b>4</b>Configure callbacks</span></section>
    <section className="callerdesk-card"><div className="section-title"><PhoneCall/><div><h2>BonVoice IVR account</h2><p>Credentials are encrypted. Calls use BonVoice two-leg bridging and recordings are captured from hangup callbacks.</p></div>{form.configured&&<span className="connected">Connected</span>}</div>
      <form className="callerdesk-grid" onSubmit={save}>
        <label>Account name<input value={form.accountName||''} onChange={e=>setForm({...form,accountName:e.target.value})}/></label><label>Username<small>Leave blank to keep the saved username</small><input value={form.username||''} onChange={e=>setForm({...form,username:e.target.value})}/></label><label>Password<small>Leave blank to keep the saved password</small><input type="password" value={form.password||''} onChange={e=>setForm({...form,password:e.target.value})}/></label><label>API token<small>Optional alternative to username/password</small><input type="password" value={form.token||''} onChange={e=>setForm({...form,token:e.target.value})}/></label>
        <label>Fallback DID *<small>Used when a lead's branch has no mapped outbound DID</small><input inputMode="tel" required value={form.defaultDid||''} onChange={e=>setForm({...form,defaultDid:e.target.value})}/></label><label>Fallback channel ID<input value={form.defaultChannelId||'1'} onChange={e=>setForm({...form,defaultChannelId:e.target.value})}/></label><label>Ring strategy<select value={form.ringStrategy||'ringall'} onChange={e=>setForm({...form,ringStrategy:e.target.value})}><option value="ringall">Ring all</option></select></label>
        <label className="wide check-option"><input type="checkbox" checked={form.recordCalls!==false} onChange={e=>setForm({...form,recordCalls:e.target.checked})}/>Capture call recordings in CRM<small>Stores ResourceURL received in BonVoice hangup events.</small></label>
        <div className="wide actions"><button type="button" className="secondary" disabled={!form.configured||busy} onClick={test}><Activity size={16}/>Test connection</button><button className="primary" disabled={busy}><Save size={16}/>{busy?'Saving…':'Save configuration'}</button></div>
      </form>{form.webhookPath&&<div className="webhook"><strong>Call notification and hangup callback</strong><code>{location.origin.replace(/:\d+$/,':3001')}{form.webhookPath}</code><small>Configure this URL in BonVoice for both JSON or x-www-form-urlencoded lifecycle callbacks.</small></div>}
    </section>
    {form.configured&&<section className="callerdesk-card"><div className="section-title"><PhoneCall/><div><h2>DID inventory and branch routing</h2><p>A DID can serve one or several branches. Shared incoming numbers use lead matching, then the selected fallback branch.</p></div><button type="button" onClick={()=>load().catch(e=>setError(e.message))}><RefreshCw size={15}/>Refresh</button><button type="button" className="primary" disabled={Boolean(draft)} onClick={()=>setDraft(blankDid())}><Plus size={15}/>Add DID</button></div>
      {!dids.length&&!draft&&<div className="callerdesk-hint">No DID inventory yet. Add a DID and select the branches it serves.</div>}<div className="bonvoice-did-list">{draft&&renderDid(draft)}{dids.map(renderDid)}</div>
    </section>}
  </div>;
}
