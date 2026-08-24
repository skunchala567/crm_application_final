import { useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Search, Settings2, Trash2, X } from 'lucide-react';
import { api } from './api';

const types=[['channelCategories','Channel category'],['channels','Channel'],['sources','Source'],['campaignCategories','Campaign category'],['campaigns','Campaign name']];
const parentTypes={channels:'channelCategories',sources:'channels',campaigns:'campaignCategories'};
const emptyData=Object.fromEntries(types.map(([key])=>[key,[]]));

export default function LeadConfiguration({onMessage,embedded=false,businessUnitId=null,useBusinessUnitSources=false}){
  const [data,setData]=useState(emptyData);
  const [active,setActive]=useState('channelCategories');
  const [search,setSearch]=useState('');
  const [name,setName]=useState('');
  const [parentId,setParentId]=useState('');
  const [editing,setEditing]=useState(null);
  const [saving,setSaving]=useState(false);
  const [defaults,setDefaults]=useState({channelId:'',sourceId:'',campaignId:''});
  const [reEnquiryDefaults,setReEnquiryDefaults]=useState({channelId:'',sourceId:'',campaignId:''});
  const [savingDefaults,setSavingDefaults]=useState(false);

  const endpoint=useBusinessUnitSources&&businessUnitId?`/platform/business-units/${businessUnitId}/source-config`:'/admin/lead-config';
  async function load(){
    try{
      const result=await api(endpoint);
      // Legacy School Admissions values are managed through the adapter, while
      // the defaults themselves belong to the selected Business Unit.
      const defaultsResult=businessUnitId&&!result.manualLeadDefaults
        ? await api(`/platform/business-units/${businessUnitId}/source-config`)
        : result;
      setData(current=>({...current,...result}));
      setDefaults({
        channelId:defaultsResult.manualLeadDefaults?.channelId||'',
        sourceId:defaultsResult.manualLeadDefaults?.sourceId||'',
        campaignId:defaultsResult.manualLeadDefaults?.campaignId||'',
      });
      setReEnquiryDefaults({
        channelId:defaultsResult.reEnquiryDefaults?.channelId||'',
        sourceId:defaultsResult.reEnquiryDefaults?.sourceId||'',
        campaignId:defaultsResult.reEnquiryDefaults?.campaignId||'',
      });
    }catch(error){onMessage({type:'error',text:error.message});}
  }
  useEffect(()=>{load();},[endpoint]);
  useEffect(()=>{cancelEdit();setSearch('');},[active]);

  const definition=types.find(([key])=>key===active);
  const parentType=parentTypes[active];
  const parents=parentType?data[parentType].filter(item=>item.isActive||String(item.id)===String(parentId)):[];
  const records=useMemo(()=>data[active].filter(item=>`${item.displayName} ${item.code} ${item.parentName||''}`.toLowerCase().includes(search.toLowerCase())),[data,active,search]);

  function cancelEdit(){setEditing(null);setName('');setParentId('');}
  function startEdit(item){setEditing(item);setName(item.displayName);setParentId(item.parentId||'');onMessage(null);}
  async function submit(event){
    event.preventDefault();if(!name.trim())return;setSaving(true);
    try{
      const url=editing?`${endpoint}/${active}/${editing.id}`:`${endpoint}/${active}`;
      const result=await api(url,{method:editing?'PUT':'POST',body:JSON.stringify({displayName:name.trim(),parentId:parentId||null})});
      cancelEdit();onMessage({type:'success',text:result.message});await load();
    }catch(error){onMessage({type:'error',text:error.message});}finally{setSaving(false);}
  }
  async function toggle(item){try{const result=await api(`${endpoint}/${active}/${item.id}/status`,{method:'PUT',body:JSON.stringify({isActive:!item.isActive})});onMessage({type:'success',text:result.message});await load();}catch(error){onMessage({type:'error',text:error.message});}}
  async function remove(item){
    if(!window.confirm(`Delete ${item.displayName}? Child configuration will also be deleted only when none of it is linked to a lead.`))return;
    try{
      const result=await api(`${endpoint}/${active}/${item.id}`,{method:'DELETE'});
      if(editing?.id===item.id)cancelEdit();
      onMessage({type:'success',text:result.message});await load();
    }catch(error){onMessage({type:'error',text:error.message});}
  }
  async function saveDefaults(event,values=defaults,defaultsType='manual'){
    event.preventDefault();
    if(!businessUnitId)return;
    setSavingDefaults(true);
    try{
      const result=await api(`/platform/business-units/${businessUnitId}/manual-lead-defaults`,{method:'PUT',body:JSON.stringify({...values,defaultsType})});
      onMessage({type:'success',text:result.message});
      await load();
    }catch(error){onMessage({type:'error',text:error.message});}finally{setSavingDefaults(false);}
  }

  const defaultSources=data.sources.filter(item=>!defaults.channelId||String(item.parentId)===String(defaults.channelId));
  const reEnquirySources=data.sources.filter(item=>!reEnquiryDefaults.channelId||String(item.parentId)===String(reEnquiryDefaults.channelId));

  return <section className={`lead-config-panel panel ${embedded?'embedded':''}`}>
    {!embedded&&<div className="lead-config-head"><div><span className="eyebrow">Lead acquisition master data</span><h2>Source configuration</h2><p>Manage channel categories, channels, sources, and campaigns without affecting existing lead history.</p></div><Settings2/></div>}
    <div className="config-tabs">{types.map(([key,label])=><button key={key} className={active===key?'active':''} onClick={()=>setActive(key)}>{label}<span>{data[key].filter(item=>item.isActive).length}</span></button>)}</div>
    {businessUnitId&&<form className="manual-defaults-panel" onSubmit={saveDefaults}>
      <div><strong>Manual Add Lead defaults</strong><small>These values are preselected in Add Lead and can still be changed before saving.</small></div>
      <label>Channel<select value={defaults.channelId} onChange={event=>setDefaults(current=>({...current,channelId:event.target.value,sourceId:''}))}><option value="">No default</option>{data.channels.filter(item=>item.isActive).map(item=><option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
      <label>Source<select value={defaults.sourceId} onChange={event=>setDefaults(current=>({...current,sourceId:event.target.value}))}><option value="">No default</option>{defaultSources.filter(item=>item.isActive).map(item=><option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
      <label>Campaign<select value={defaults.campaignId} onChange={event=>setDefaults(current=>({...current,campaignId:event.target.value}))}><option value="">No default</option>{data.campaigns.filter(item=>item.isActive).map(item=><option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
      <button className="primary" disabled={savingDefaults}>{savingDefaults?'Saving…':'Save defaults'}</button>
    </form>}
    {businessUnitId&&<form className="manual-defaults-panel re-enquiry-defaults-panel" onSubmit={event=>saveDefaults(event,reEnquiryDefaults,'reEnquiry')}>
      <div><strong>Re-enquiry defaults</strong><small>Preselected when Re-enquire is opened and editable before saving.</small></div>
      <label>Channel<select value={reEnquiryDefaults.channelId} onChange={event=>setReEnquiryDefaults(current=>({...current,channelId:event.target.value,sourceId:''}))}><option value="">No default</option>{data.channels.filter(item=>item.isActive).map(item=><option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
      <label>Source<select value={reEnquiryDefaults.sourceId} onChange={event=>setReEnquiryDefaults(current=>({...current,sourceId:event.target.value}))}><option value="">No default</option>{reEnquirySources.filter(item=>item.isActive).map(item=><option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
      <label>Campaign<select value={reEnquiryDefaults.campaignId} onChange={event=>setReEnquiryDefaults(current=>({...current,campaignId:event.target.value}))}><option value="">No default</option>{data.campaigns.filter(item=>item.isActive).map(item=><option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
      <button className="primary" disabled={savingDefaults}>{savingDefaults?'Saving…':'Save defaults'}</button>
    </form>}
    <div className="config-content">
      <form className={`config-add ${editing?'editing':''}`} onSubmit={submit}>
        <div className="config-form-title"><h3>{editing?'Edit':'Add'} {definition[1].toLowerCase()}</h3>{editing&&<button type="button" title="Cancel editing" onClick={cancelEdit}><X size={15}/></button>}</div>
        {parentType&&<label>Parent *<select required value={parentId} onChange={event=>setParentId(event.target.value)}><option value="">Select parent</option>{parents.map(item=><option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>}
        <label>Name *<input required maxLength="150" value={name} onChange={event=>setName(event.target.value)} placeholder={`Enter ${definition[1].toLowerCase()} name`}/></label>
        <div className="config-form-actions"><button className="primary" disabled={saving}>{editing?<Pencil size={15}/>:<Plus size={16}/>} {saving?'Saving…':editing?'Save changes':'Add value'}</button>{editing&&<button type="button" className="secondary" onClick={cancelEdit}>Cancel</button>}</div>
      </form>
      <div className="config-list"><div className="config-list-tools"><div className="local-search"><Search size={16}/><input value={search} onChange={event=>setSearch(event.target.value)} placeholder={`Search ${definition[1].toLowerCase()}s`}/></div><span>{records.length} values</span></div>
        <div className="config-records">{records.map(item=><article className={editing?.id===item.id?'selected':''} key={item.id}><div><strong>{item.displayName}</strong><small>{item.parentName?`${item.parentName} · `:''}{item.code}</small></div><div className="config-record-actions"><button className="config-edit" title={`Edit ${item.displayName}`} onClick={()=>startEdit(item)}><Pencil size={14}/> Edit</button><button className={`config-status ${item.isActive?'active':'inactive'}`} onClick={()=>toggle(item)}><i/>{item.isActive?'Active':'Inactive'}</button><button className="icon-btn danger" title={`Delete ${item.displayName}`} onClick={()=>remove(item)}><Trash2 size={14}/></button></div></article>)}{!records.length&&<div className="empty"><Settings2/><strong>No values found</strong></div>}</div>
      </div>
    </div>
  </section>;
}
