import { useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Search, Settings2, X } from 'lucide-react';
import { api } from './api';

const types=[['stages','Stage'],['substages','Sub-stage'],['channelCategories','Channel category'],['channels','Channel'],['sources','Source'],['campaignCategories','Campaign category'],['campaigns','Campaign name']];
const parentTypes={substages:'stages',channels:'channelCategories',sources:'channels',campaigns:'campaignCategories'};
const emptyData=Object.fromEntries(types.map(([key])=>[key,[]]));

export default function LeadConfiguration({onMessage}){
  const [data,setData]=useState(emptyData);
  const [active,setActive]=useState('stages');
  const [search,setSearch]=useState('');
  const [name,setName]=useState('');
  const [parentId,setParentId]=useState('');
  const [requiresFollowup,setRequiresFollowup]=useState(false);
  const [editing,setEditing]=useState(null);
  const [saving,setSaving]=useState(false);

  async function load(){try{setData(await api('/admin/lead-config'));}catch(error){onMessage({type:'error',text:error.message});}}
  useEffect(()=>{load();},[]);
  useEffect(()=>{cancelEdit();setSearch('');},[active]);

  const definition=types.find(([key])=>key===active);
  const parentType=parentTypes[active];
  const parents=parentType?data[parentType].filter(item=>item.isActive||String(item.id)===String(parentId)):[];
  const records=useMemo(()=>data[active].filter(item=>`${item.displayName} ${item.code} ${item.parentName||''}`.toLowerCase().includes(search.toLowerCase())),[data,active,search]);

  function cancelEdit(){setEditing(null);setName('');setParentId('');setRequiresFollowup(false);}
  function startEdit(item){setEditing(item);setName(item.displayName);setParentId(item.parentId||'');setRequiresFollowup(Boolean(item.requiresFollowup));onMessage(null);}
  async function submit(event){
    event.preventDefault();if(!name.trim())return;setSaving(true);
    try{
      const url=editing?`/admin/lead-config/${active}/${editing.id}`:`/admin/lead-config/${active}`;
      const result=await api(url,{method:editing?'PUT':'POST',body:JSON.stringify({displayName:name.trim(),parentId:parentId||null,requiresFollowup})});
      cancelEdit();onMessage({type:'success',text:result.message});await load();
    }catch(error){onMessage({type:'error',text:error.message});}finally{setSaving(false);}
  }
  async function toggle(item){try{const result=await api(`/admin/lead-config/${active}/${item.id}/status`,{method:'PUT',body:JSON.stringify({isActive:!item.isActive})});onMessage({type:'success',text:result.message});await load();}catch(error){onMessage({type:'error',text:error.message});}}

  return <section className="lead-config-panel panel">
    <div className="lead-config-head"><div><span className="eyebrow">Lead master data</span><h2>Lead configuration</h2><p>Add, edit, or mark values inactive without affecting existing lead history.</p></div><Settings2/></div>
    <div className="config-tabs">{types.map(([key,label])=><button key={key} className={active===key?'active':''} onClick={()=>setActive(key)}>{label}<span>{data[key].filter(item=>item.isActive).length}</span></button>)}</div>
    <div className="config-content">
      <form className={`config-add ${editing?'editing':''}`} onSubmit={submit}>
        <div className="config-form-title"><h3>{editing?'Edit':'Add'} {definition[1].toLowerCase()}</h3>{editing&&<button type="button" title="Cancel editing" onClick={cancelEdit}><X size={15}/></button>}</div>
        {parentType&&<label>Parent *<select required value={parentId} onChange={event=>setParentId(event.target.value)}><option value="">Select parent</option>{parents.map(item=><option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>}
        <label>Name *<input required maxLength="150" value={name} onChange={event=>setName(event.target.value)} placeholder={`Enter ${definition[1].toLowerCase()} name`}/></label>
        {active==='stages'&&<label>Next follow-up required *<span className="config-yes-no"><button type="button" className={requiresFollowup?'active':''} onClick={()=>setRequiresFollowup(true)}>Yes</button><button type="button" className={!requiresFollowup?'active':''} onClick={()=>setRequiresFollowup(false)}>No</button></span></label>}
        <div className="config-form-actions"><button className="primary" disabled={saving}>{editing?<Pencil size={15}/>:<Plus size={16}/>} {saving?'Saving…':editing?'Save changes':'Add value'}</button>{editing&&<button type="button" className="secondary" onClick={cancelEdit}>Cancel</button>}</div>
      </form>
      <div className="config-list"><div className="config-list-tools"><div className="local-search"><Search size={16}/><input value={search} onChange={event=>setSearch(event.target.value)} placeholder={`Search ${definition[1].toLowerCase()}s`}/></div><span>{records.length} values</span></div>
        <div className="config-records">{records.map(item=><article className={editing?.id===item.id?'selected':''} key={item.id}><div><strong>{item.displayName}</strong><small>{item.parentName?`${item.parentName} · `:''}{item.code}{active==='stages'?` · Next follow-up: ${item.requiresFollowup?'Yes':'No'}`:''}</small></div><div className="config-record-actions"><button className="config-edit" title={`Edit ${item.displayName}`} onClick={()=>startEdit(item)}><Pencil size={14}/> Edit</button><button className={`config-status ${item.isActive?'active':'inactive'}`} onClick={()=>toggle(item)}><i/>{item.isActive?'Active':'Inactive'}</button></div></article>)}{!records.length&&<div className="empty"><Settings2/><strong>No values found</strong></div>}</div>
      </div>
    </div>
  </section>;
}
