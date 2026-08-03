import { useEffect, useState } from 'react';
import { Activity, CheckCircle2, PhoneCall, RefreshCw, Save } from 'lucide-react';
import { api } from '../api.js';
import './CallerDeskSettings.css';

function firstArray(value){
  if(Array.isArray(value))return value;
  if(!value||typeof value!=='object')return [];
  for(const key of ['data','list','result','records','member_list','members','group_list','groups','deskphone_list','deskphones','ivr_list']){
    const found=value[key]; if(Array.isArray(found))return found; if(found&&typeof found==='object'){const nested=firstArray(found);if(nested.length)return nested;}
  }
  return [];
}
const didOption=item=>({id:String(item.did_id??item.deskphone_id??item.id??''),number:String(item.did_number??item.deskphone??item.ivr_number??item.number??item.virtual_number??'')});
const groupOption=item=>({id:String(item.group_id??item.id??item.group_name??''),name:String(item.group_name??item.name??'')});

export default function CallerDeskSettings({ onMessage }) {
  const [config,setConfig]=useState({accountName:'CallerDesk',apiKey:'',apiSecret:'',integrationKey:'',defaultDeskphone:'',defaultGroupName:'',recordCalls:true,isActive:true});
  const [deskphones,setDeskphones]=useState([]); const [groups,setGroups]=useState([]);
  const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  const notify=(text,type='success')=>{setError(type==='error'?text:'');onMessage?.({type,text});};
  async function load(){
    const result=await api('/callerdesk/config'); setConfig(current=>({...current,...result.data,apiKey:'',apiSecret:'',integrationKey:''}));
    if(result.data.configured){
      const [didResult,groupResult]=await Promise.allSettled([api('/callerdesk/deskphones'),api('/callerdesk/groups')]);
      setDeskphones(didResult.status==='fulfilled'?firstArray(didResult.value.data).map(didOption).filter(item=>item.number):[]);
      setGroups(groupResult.status==='fulfilled'?firstArray(groupResult.value.data).map(groupOption).filter(item=>item.name):[]);
    }
  }
  useEffect(()=>{load().catch(e=>setError(e.message));},[]);
  async function save(e){e.preventDefault();setBusy(true);try{await api.put('/callerdesk/config',config);notify('CallerDesk configuration saved');await load();}catch(e){notify(e.message,'error');}finally{setBusy(false);}}
  async function test(){setBusy(true);try{await api.post('/callerdesk/test',{});notify('CallerDesk connection is working');}catch(e){notify(e.message,'error');}finally{setBusy(false);}}
  return <div className="callerdesk-settings">
    <header><div><span className="eyebrow">Calling integration</span><h1>CallerDesk</h1><p>Call leads securely, capture outcomes and recordings, and manage opt-in dialling queues.</p></div><button className="secondary" onClick={()=>load().catch(e=>setError(e.message))}><RefreshCw size={16}/> Refresh</button></header>
    {error&&<div className="callerdesk-error">{error}</div>}
    <section className="callerdesk-guide"><strong>Configuration guide</strong><span><b>1</b> Save API credentials</span><span><b>2</b> Test connection</span><span><b>3</b> Configure branch DIDs in Business Units</span><span><b>4</b> Map members in User Management</span></section>
    <section className="callerdesk-card"><div className="section-title"><PhoneCall/><div><h2>Account setup</h2><p>The authcode is encrypted and never returned to the browser.</p></div>{config.configured&&<span className="connected"><CheckCircle2/> Connected</span>}</div>
      <form className="callerdesk-grid" onSubmit={save}>
        <label>Account name <small>Friendly name used inside CRM</small><input value={config.accountName||''} onChange={e=>setConfig({...config,accountName:e.target.value})}/></label>
        <label>API key / authcode <small>API & Integration → API Key</small><input type="password" placeholder={config.configured?'Leave blank to keep current API key':'Paste CallerDesk API key'} value={config.apiKey||''} onChange={e=>setConfig({...config,apiKey:e.target.value})}/></label>
        <label>Secret key <small>Used with the API key as Basic Auth</small><input type="password" placeholder={config.hasApiSecret?'Leave blank to keep current secret':'Paste CallerDesk secret key'} value={config.apiSecret||''} onChange={e=>setConfig({...config,apiSecret:e.target.value})}/></label>
        <label>Integration key <small>Shown beside the API and secret keys</small><input type="password" placeholder={config.hasIntegrationKey?'Leave blank to keep current integration key':'Paste CallerDesk integration key'} value={config.integrationKey||''} onChange={e=>setConfig({...config,integrationKey:e.target.value})}/></label>
        <label>Default deskphone / DID <small>Fallback when a branch has no DID</small><select value={config.defaultDeskphone||''} onChange={e=>setConfig({...config,defaultDeskphone:e.target.value})}><option value="">Select from CallerDesk</option>{config.defaultDeskphone&&!deskphones.some(item=>item.number===config.defaultDeskphone)&&<option value={config.defaultDeskphone}>{config.defaultDeskphone} (saved)</option>}{deskphones.map(item=><option key={`${item.id}-${item.number}`} value={item.number}>{item.number}{item.id?` · DID ID ${item.id}`:''}</option>)}</select></label>
        <label>Default call group <small>Fallback routing group</small><select value={config.defaultGroupName||''} onChange={e=>setConfig({...config,defaultGroupName:e.target.value})}><option value="">No default group</option>{config.defaultGroupName&&!groups.some(item=>item.name===config.defaultGroupName)&&<option value={config.defaultGroupName}>{config.defaultGroupName} (saved)</option>}{groups.map(item=><option key={item.id||item.name} value={item.name}>{item.name}{item.id&&item.id!==item.name?` · ID ${item.id}`:''}</option>)}</select></label>
        <label className="wide check-option"><input type="checkbox" checked={config.recordCalls!==false} onChange={e=>setConfig({...config,recordCalls:e.target.checked})}/>Capture call recordings in CRM <small>Stores recording links returned by CallerDesk. Provider-side recording must be enabled in CallerDesk.</small></label>
        <div className="wide actions"><button type="button" className="secondary" disabled={!config.configured||busy} onClick={test}><Activity size={16}/> Test connection</button><button className="primary" disabled={busy}><Save size={16}/>{busy?'Saving…':'Save configuration'}</button></div>
      </form>{config.webhookPath&&<div className="webhook"><strong>Outcome webhook</strong><code>{location.origin.replace(/:\d+$/,':3001')}{config.webhookPath}</code><small>Add this URL in CallerDesk to receive status, duration, recordings, costs and call direction.</small></div>}
    </section>
  </div>;
}
