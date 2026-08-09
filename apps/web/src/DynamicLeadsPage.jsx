import { useEffect, useState } from 'react';
import { Filter, Plus, RefreshCw, Search, SlidersHorizontal, X } from 'lucide-react';
import { api } from './api';
import { useBusinessUnit } from './BusinessUnitContext.jsx';
import LeadsPage from './LeadsPage.jsx';
import './MetadataPlatform.css';

export default function BusinessUnitLeadRouter(){
  const {selectedUnit,loading}=useBusinessUnit();
  if(loading||!selectedUnit)return <div className="loading"><span/><p>Loading business unit…</p></div>;
  return <LeadsPage/>;
}

function DynamicLeadsPage(){
  const {selectedUnit}=useBusinessUnit();
  const [config,setConfig]=useState(null);
  const [leads,setLeads]=useState([]);
  const [search,setSearch]=useState('');
  const [stageId,setStageId]=useState('');
  const [filters,setFilters]=useState({});
  const [filterOpen,setFilterOpen]=useState(false);
  const [drawer,setDrawer]=useState(false);
  const [form,setForm]=useState({});
  const [saving,setSaving]=useState(false);
  const [message,setMessage]=useState(null);

  const load=async()=>{
    const [configuration,result]=await Promise.all([
      api(`/platform/business-units/${selectedUnit.id}/config`),
      api(`/platform/business-units/${selectedUnit.id}/dynamic-leads?search=${encodeURIComponent(search)}`),
    ]);
    setConfig(configuration);setLeads(result.data||[]);
  };
  useEffect(()=>{setConfig(null);setLeads([]);setSearch('');setStageId('');setFilters({});setFilterOpen(false);load().catch(error=>setMessage({type:'error',text:error.message}));},[selectedUnit.id]);
  useEffect(()=>{const timer=setTimeout(()=>load().catch(error=>setMessage({type:'error',text:error.message})),250);return()=>clearTimeout(timer);},[search,stageId]);

  const pipeline=config?.pipelines.find(item=>item.isDefault)||config?.pipelines[0];
  const stages=(config?.pipelineStages||[]).filter(stage=>stage.pipelineId===pipeline?.id&&stage.isActive);
  const listFields=(config?.fields||[]).filter(field=>field.isActive&&field.showInList);
  const filterFields=(config?.fields||[]).filter(field=>field.isActive&&field.isFilterable);
  const activeFilterCount=Object.values(filters).filter(hasFilterValue).length;
  const metadataFilteredLeads=leads.filter(lead=>filterFields.every(field=>matchesFilter(leadFieldValue(lead,field),filters[field.fieldKey],field)));
  const visibleLeads=stageId?metadataFilteredLeads.filter(lead=>String(lead.stageId)===String(stageId)):metadataFilteredLeads;
  const openCreate=()=>{
    const initial={pipelineId:pipeline?.id,stageId:stages[0]?.id,displayName:'',phone:'',email:'',source:'',status:'active',customValues:{}};
    setForm(initial);setDrawer(true);
  };
  const submit=async event=>{
    event.preventDefault();setSaving(true);
    try{
      const result=await api(`/platform/business-units/${selectedUnit.id}/dynamic-leads`,{method:'POST',body:JSON.stringify(form)});
      setDrawer(false);setMessage({type:'success',text:result.message});await load();
    }catch(error){setMessage({type:'error',text:error.message});}finally{setSaving(false);}
  };
  const changeStage=async(lead,nextStageId)=>{
    try{
      await api(`/platform/business-units/${selectedUnit.id}/dynamic-leads/${lead.id}/stage`,{method:'PUT',body:JSON.stringify({stageId:Number(nextStageId)})});
      await load();
    }catch(error){setMessage({type:'error',text:error.message});}
  };
  return <main className="metadata-page dynamic-leads-page">
    <header className="dynamic-module-header">
      <div><span className="eyebrow">{selectedUnit.name}</span><h1>Lead Management</h1><p>Metadata-driven leads, forms, columns, and pipeline progression.</p></div>
      <div><button className="secondary" onClick={load}><RefreshCw size={16}/>Refresh</button><button className="primary" onClick={openCreate}><Plus size={17}/>Add lead</button></div>
    </header>
    {message&&<div className={`notice ${message.type}`}><span>{message.text}</span><button onClick={()=>setMessage(null)}><X size={15}/></button></div>}
    <section className="dynamic-lead-command">
      <div className="dynamic-search"><Search size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder={`Search ${pipeline?.entityLabelPlural||'leads'}…`}/></div>
      <button className={`secondary ${filterOpen||activeFilterCount?'active':''}`} onClick={()=>setFilterOpen(value=>!value)}><Filter size={16}/>Filters{activeFilterCount>0&&<b className="filter-count">{activeFilterCount}</b>}</button><button className="secondary"><SlidersHorizontal size={16}/>Columns</button>
    </section>
    {filterOpen&&<section className="dynamic-filter-panel">
      <header><div><h3>Filter leads</h3><p>Fields shown here are enabled as filterable in this Business Unit.</p></div>{activeFilterCount>0&&<button className="secondary" onClick={()=>setFilters({})}>Reset filters</button>}</header>
      <div className="dynamic-filter-grid">{filterFields.map(field=><DynamicFilterField key={field.id} field={field} value={filters[field.fieldKey]??''} onChange={value=>setFilters(current=>({...current,[field.fieldKey]:value}))}/>)}</div>
      {!filterFields.length&&<div className="empty"><Filter/><strong>No filter fields configured</strong><span>Enable Filterable on Lead Fields in Business Unit settings.</span></div>}
    </section>}
    <nav className="dynamic-stage-tabs">
      <button className={!stageId?'active':''} onClick={()=>setStageId('')}>All <b>{metadataFilteredLeads.length}</b></button>
      {stages.map(stage=><button key={stage.id} className={Number(stageId)===stage.id?'active':''} style={{'--stage-color':stage.color}} onClick={()=>setStageId(String(stage.id))}>{stage.displayName}<b>{metadataFilteredLeads.filter(lead=>lead.stageId===stage.id).length}</b></button>)}
    </nav>
    <section className="dynamic-table-wrap">
      <table><thead><tr><th>Lead #</th>{listFields.map(field=><th key={field.id} style={{width:field.columnWidth}}>{field.displayName}</th>)}<th>Pipeline stage</th><th>Owner</th><th>Created</th></tr></thead>
      <tbody>{visibleLeads.map(lead=><tr key={lead.id}><td><strong>{lead.leadNumber}</strong></td>{listFields.map(field=><td key={field.id} title={String(leadFieldValue(lead,field)||'')}>{formatValue(leadFieldValue(lead,field),field.fieldType)}</td>)}<td><select className="stage-inline-select" value={lead.stageId} onChange={e=>changeStage(lead,e.target.value)} style={{borderColor:lead.stageColor,color:lead.stageColor}}>{stages.map(stage=><option key={stage.id} value={stage.id}>{stage.displayName}</option>)}</select></td><td>{lead.owner}</td><td>{new Date(lead.createdAt).toLocaleDateString('en-IN')}</td></tr>)}</tbody></table>
      {!visibleLeads.length&&<div className="empty big"><Search/><strong>No leads found</strong><span>Create the first lead or adjust the current filters.</span></div>}
    </section>
    {drawer&&<><div className="drawer-backdrop" onClick={()=>setDrawer(false)}/><section className="dynamic-form-drawer"><header><div><span className="eyebrow">{selectedUnit.name}</span><h2>Add lead</h2><p>This form is generated from the active field metadata.</p></div><button className="icon-btn" onClick={()=>setDrawer(false)}><X/></button></header><form onSubmit={submit}><div className="dynamic-form-grid">{(config?.fields||[]).filter(field=>field.isActive).map(field=><DynamicField key={field.id} field={field} value={field.fieldKey==='name'?form.displayName:field.fieldKey==='phone'?form.phone:field.fieldKey==='email'?form.email:field.fieldKey==='source'?form.source:field.fieldKey==='status'?form.status:form.customValues?.[field.fieldKey]} onChange={value=>{
      if(field.fieldKey==='name')setForm({...form,displayName:value});else if(['phone','email','source','status'].includes(field.fieldKey))setForm({...form,[field.fieldKey]:value});else setForm({...form,customValues:{...form.customValues,[field.fieldKey]:value}});
    }}/>)}
      <label>Initial stage *<select required value={form.stageId||''} onChange={e=>setForm({...form,stageId:Number(e.target.value)})}>{stages.map(stage=><option key={stage.id} value={stage.id}>{stage.displayName}</option>)}</select></label></div><footer><button type="button" className="secondary" onClick={()=>setDrawer(false)}>Cancel</button><button className="primary" disabled={saving}>{saving?'Creating…':'Create lead'}</button></footer></form></section></>}
  </main>;
}

function DynamicFilterField({field,value,onChange}){
  const label=<span>{field.displayName}</span>;
  const control=field.filterControl||({date:'date_range',datetime:'date_range',number:'number_range',decimal:'number_range',boolean:'boolean',single_select:'single_select',multi_select:'multi_select'}[field.fieldType]||'contains');
  if(['date_range','number_range'].includes(control)){
    const type=control==='date_range'?'date':'number';
    return <label>{label}<div className="dynamic-filter-range"><input type={type} value={value?.from||''} onChange={event=>onChange({...value,from:event.target.value})} placeholder="From"/><span>to</span><input type={type} value={value?.to||''} onChange={event=>onChange({...value,to:event.target.value})} placeholder="To"/></div></label>;
  }
  if(['single_select','multi_select','boolean'].includes(control)){
    const options=control==='boolean'?['Yes','No']:(field.options||[]);
    if(control==='multi_select')return <label>{label}<select multiple value={Array.isArray(value)?value:[]} onChange={event=>onChange(Array.from(event.target.selectedOptions,option=>option.value))}>{options.map(option=><option key={String(option)} value={String(option)}>{String(option)}</option>)}</select><small>Use Ctrl/Cmd to select more than one.</small></label>;
    return <label>{label}<select value={value} onChange={event=>onChange(event.target.value)}><option value="">All {field.displayName.toLowerCase()}</option>{options.map(option=><option key={String(option)} value={String(option)}>{String(option)}</option>)}</select></label>;
  }
  const type=control==='date'?'date':(['number','decimal'].includes(field.fieldType)?'number':'text');
  return <label>{label}<input type={type} value={value} onChange={event=>onChange(event.target.value)} placeholder={`Filter by ${field.displayName.toLowerCase()}`}/></label>;
}

function leadFieldValue(lead,field){
  if(field.fieldKey==='name')return lead.displayName;
  if(field.fieldKey==='phone')return lead.phone;
  if(field.fieldKey==='email')return lead.email;
  if(field.fieldKey==='source')return lead.source;
  if(field.fieldKey==='status')return lead.status;
  return lead.customValues?.[field.fieldKey];
}
function hasFilterValue(value){
  if(value==null||value==='')return false;
  if(Array.isArray(value))return value.length>0;
  if(typeof value==='object')return Boolean(value.from||value.to);
  return true;
}
function matchesFilter(actual,expected,field){
  if(!hasFilterValue(expected))return true;
  const control=field.filterControl||'contains';
  if(control==='boolean')return Boolean(actual)===(String(expected).toLowerCase()==='yes');
  if(['date_range','number_range'].includes(control)){
    const comparable=control==='number_range'?Number(actual):new Date(actual).getTime();
    const from=expected.from?(control==='number_range'?Number(expected.from):new Date(expected.from).getTime()):null;
    const to=expected.to?(control==='number_range'?Number(expected.to):new Date(expected.to).getTime()+86399999):null;
    return Number.isFinite(comparable)&&(from==null||comparable>=from)&&(to==null||comparable<=to);
  }
  if(control==='multi_select'){
    const actualValues=Array.isArray(actual)?actual.map(String):[String(actual??'')];
    return expected.some(value=>actualValues.some(item=>item.toLowerCase()===String(value).toLowerCase()));
  }
  if(control==='exact'||['single_select','date'].includes(control))return String(actual??'').toLowerCase()===String(expected).toLowerCase();
  if(Array.isArray(actual))return actual.some(value=>String(value).toLowerCase().includes(String(expected).toLowerCase()));
  return String(actual??'').toLowerCase().includes(String(expected).toLowerCase());
}

function DynamicField({field,value,onChange}){
  const common={required:Boolean(field.isRequired),value:value??'',placeholder:field.placeholder||'',onChange:event=>onChange(field.fieldType==='boolean'?event.target.checked:event.target.value)};
  if(field.fieldType==='textarea')return <label>{field.displayName}{field.isRequired?' *':''}<textarea rows="3" {...common}/><small>{field.helpText}</small></label>;
  if(['single_select','multi_select'].includes(field.fieldType))return <label>{field.displayName}{field.isRequired?' *':''}<select {...common} multiple={field.fieldType==='multi_select'}><option value="">Select {field.displayName.toLowerCase()}</option>{(field.options||[]).map(option=><option key={String(option)} value={option}>{String(option)}</option>)}</select></label>;
  if(field.fieldType==='boolean')return <label className="dynamic-checkbox"><input type="checkbox" checked={Boolean(value)} onChange={common.onChange}/>{field.displayName}</label>;
  const type={number:'number',decimal:'number',date:'date',datetime:'datetime-local',email:'email',phone:'tel'}[field.fieldType]||'text';
  return <label>{field.displayName}{field.isRequired?' *':''}<input type={type} step={field.fieldType==='decimal'?'any':undefined} {...common}/><small>{field.helpText}</small></label>;
}
function formatValue(value,type){
  if(value==null||value==='')return '—';
  if(Array.isArray(value))return value.join(', ');
  if(type==='boolean')return value?'Yes':'No';
  return String(value);
}
