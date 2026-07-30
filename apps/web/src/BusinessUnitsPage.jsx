import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Building2, CalendarRange, ChevronRight, Database, GitBranch, Layers3, Pencil, Plus, Settings2, Trash2, Waypoints, Workflow, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { api } from './api';
import { useBusinessUnit } from './BusinessUnitContext.jsx';
import AcademicConfigurationPage from './AcademicConfigurationPage.jsx';
import LeadConfiguration from './LeadConfiguration.jsx';
import './MetadataPlatform.css';

const emptyUnit={name:'',industryType:'General',description:'',color:'#4A4FB1'};
const emptyField={displayName:'',fieldType:'text',placeholder:'',options:'',isRequired:false,isFilterable:true,filterControl:'contains',isSearchable:false,isImportable:true,isImportRequired:false,importHeader:'',importSampleValue:'',showInList:true,columnWidth:180};
const filterControlOptions=(fieldType)=>{
  if(['date','datetime'].includes(fieldType))return [['date','Single date'],['date_range','Date range']];
  if(['number','decimal'].includes(fieldType))return [['exact','Exact value'],['number_range','Number range']];
  if(fieldType==='boolean')return [['boolean','Yes / No']];
  if(['single_select','multi_select','user'].includes(fieldType))return [['single_select','Single select'],['multi_select','Multi-select']];
  return [['contains','Contains text'],['exact','Exact match'],['single_select','Single select'],['multi_select','Multi-select']];
};

export default function BusinessUnitsPage({onMessage}){
  const context=useBusinessUnit();
  const [searchParams,setSearchParams]=useSearchParams();
  const [selectedId,setSelectedId]=useState(context.selectedId);
  const [config,setConfig]=useState(null);
  const requestedTab=searchParams.get('tab');
  const [tab,setTab]=useState(['academic','sources'].includes(requestedTab)?requestedTab:'overview');
  const [pipelineTab,setPipelineTab]=useState('stages');
  const [dialog,setDialog]=useState(null);
  const [unitForm,setUnitForm]=useState(emptyUnit);
  const [fieldForm,setFieldForm]=useState(emptyField);
  const [stageForm,setStageForm]=useState({displayName:'',stageType:'open',color:'#4A4FB1',requiresFollowup:false,isActive:true});
  const [substageForm,setSubstageForm]=useState({displayName:'',stageId:'',isActive:true});
  const [editingId,setEditingId]=useState(null);
  const [saving,setSaving]=useState(false);
  const selected=context.units.find(unit=>unit.id===selectedId);

  const notify=(type,text)=>onMessage?.({type,text});
  const loadConfig=async id=>{
    if(!id)return;
    try{setConfig(await api(`/platform/business-units/${id}/config`));}
    catch(error){notify('error',error.message);}
  };
  useEffect(()=>{if(!selectedId&&context.selectedId)setSelectedId(context.selectedId);},[context.selectedId]);
  useEffect(()=>{
    if(searchParams.get('tab')!=='academic')return;
    const school=context.units.find(unit=>unit.compatibilityMode==='legacy_school');
    if(school&&selectedId!==school.id)setSelectedId(school.id);
  },[context.units,searchParams,selectedId]);
  useEffect(()=>{loadConfig(selectedId);},[selectedId]);
  useEffect(()=>{if(selected&&selected.compatibilityMode!=='legacy_school'&&tab==='academic')setTab('overview');},[selected?.id,selected?.compatibilityMode,tab]);

  const changeTab=id=>{
    setTab(id);
    const next=new URLSearchParams(searchParams);
    if(['academic','sources'].includes(id))next.set('tab',id);else{next.delete('tab');next.delete('section');}
    setSearchParams(next,{replace:true});
  };

  const createUnit=async event=>{
    event.preventDefault();setSaving(true);
    try{
      const result=await api(editingId?`/platform/business-units/${editingId}`:'/platform/business-units',{method:editingId?'PUT':'POST',body:JSON.stringify(unitForm)});
      await context.refresh();setDialog(null);setUnitForm(emptyUnit);setEditingId(null);if(result.id)setSelectedId(result.id);await loadConfig(selectedId);notify('success',result.message);
    }catch(error){notify('error',error.message);}finally{setSaving(false);}
  };
  const addField=async event=>{
    event.preventDefault();setSaving(true);
    try{
      const payload={...fieldForm,options:fieldForm.options.split(',').map(item=>item.trim()).filter(Boolean)};
      const result=await api(editingId?`/platform/business-units/${selectedId}/fields/${editingId}`:`/platform/business-units/${selectedId}/fields`,{method:editingId?'PUT':'POST',body:JSON.stringify(payload)});
      await loadConfig(selectedId);setDialog(null);setEditingId(null);setFieldForm(emptyField);notify('success',result.message);
    }catch(error){notify('error',error.message);}finally{setSaving(false);}
  };
  const addPipelineStage=async event=>{
    event.preventDefault();setSaving(true);
    try{
      const pipeline=config.pipelines.find(item=>item.isDefault)||config.pipelines[0];
      const result=await api(editingId?`/platform/business-units/${selectedId}/pipeline-stages/${editingId}`:`/platform/business-units/${selectedId}/pipeline-stages`,{method:editingId?'PUT':'POST',body:JSON.stringify({...stageForm,pipelineId:pipeline.id})});
      await loadConfig(selectedId);setDialog(null);setEditingId(null);setStageForm({displayName:'',stageType:'open',color:'#4A4FB1',requiresFollowup:false,isActive:true});notify('success',result.message);
    }catch(error){notify('error',error.message);}finally{setSaving(false);}
  };
  const addPipelineSubstage=async event=>{
    event.preventDefault();setSaving(true);
    try{
      const result=await api(editingId?`/platform/business-units/${selectedId}/pipeline-substages/${editingId}`:`/platform/business-units/${selectedId}/pipeline-substages`,{method:editingId?'PUT':'POST',body:JSON.stringify(substageForm)});
      await loadConfig(selectedId);setDialog(null);setEditingId(null);setSubstageForm({displayName:'',stageId:'',isActive:true});notify('success',result.message);
    }catch(error){notify('error',error.message);}finally{setSaving(false);}
  };
  const removePipelineItem=async (type,item)=>{
    const label=type==='pipeline-stages'?'stage':'sub-stage';
    if(!window.confirm(`Delete ${item.title}? This action is only allowed when no leads are assigned to this ${label}.`))return;
    try{
      const result=await api(`/platform/business-units/${selectedId}/${type}/${item.id}`,{method:'DELETE'});
      notify('success',result.message);await loadConfig(selectedId);
    }catch(error){notify('error',error.message);}
  };
  const removeConfiguredItem=async (type,item,label)=>{
    if(!window.confirm(`Delete ${item.title}? The record will only be deleted when it is not linked to any lead or Tracker record.`))return;
    try{
      const result=await api(`/platform/business-units/${selectedId}/${type}/${item.id}`,{method:'DELETE'});
      notify('success',result.message);await loadConfig(selectedId);
    }catch(error){notify('error',error.message);}
  };
  const removeBusinessUnit=async ()=>{
    if(!selected||selected.isDefault)return;
    if(!window.confirm(`Delete ${selected.name}? All unused configuration belonging to this Business Unit will be removed.`))return;
    try{
      const result=await api(`/platform/business-units/${selected.id}`,{method:'DELETE'});
      notify('success',result.message);await context.refresh();
      const remaining=context.units.filter(unit=>unit.id!==selected.id);
      setSelectedId(remaining[0]?.id||null);
    }catch(error){notify('error',error.message);}
  };
  const addOperationStage=async event=>{
    event.preventDefault();setSaving(true);
    try{
      const workflow=config.workflows.find(item=>item.isDefault)||config.workflows[0];
      const result=await api(editingId?`/platform/business-units/${selectedId}/operation-stages/${editingId}`:`/platform/business-units/${selectedId}/operation-stages`,{method:editingId?'PUT':'POST',body:JSON.stringify({...stageForm,workflowId:workflow.id})});
      await loadConfig(selectedId);setDialog(null);setEditingId(null);setStageForm({displayName:'',stageType:'open',color:'#4A4FB1'});notify('success',result.message);
    }catch(error){notify('error',error.message);}finally{setSaving(false);}
  };
  const moveOperationStage=async(stage,direction)=>{
    try{
      const result=await api(`/platform/business-units/${selectedId}/operation-stages/${stage.id}/move`,{
        method:'PUT',body:JSON.stringify({direction}),
      });
      await loadConfig(selectedId);notify('success',result.message);
    }catch(error){notify('error',error.message);}
  };

  return (
    <main className="metadata-page business-units-page">
      <header className="metadata-page-header">
        <div><span className="eyebrow">Platform configuration</span><h1>Business Units</h1><p>Create CRM workspaces and configure their lead journey</p></div>
        <button className="primary" onClick={()=>{setEditingId(null);setUnitForm(emptyUnit);setDialog('unit')}}><Plus size={17}/> Add business unit</button>
      </header>
      <div className="business-unit-workspace">
        <aside className="business-unit-list">
          <div className="section-label"><span>Business units</span><b>{context.units.length}</b></div>
          {context.units.map(unit=>(
            <button key={unit.id} className={selectedId===unit.id?'active':''} onClick={()=>setSelectedId(unit.id)}>
              <i style={{background:unit.color}}><Building2 size={17}/></i>
              <span><strong>{unit.name}</strong><small>{unit.industryType} · {unit.leadCount} records</small></span>
              {unit.isDefault&&<em>Default</em>}<ChevronRight size={16}/>
            </button>
          ))}
        </aside>
        <section className="business-unit-config">
          {!selected||!config?<div className="empty big"><Database/><strong>Select a business unit</strong></div>:<>
            <div className="unit-config-title">
              <i style={{background:selected.color}}><Building2/></i>
              <div><span>{selected.industryType}</span><h2>{selected.name}</h2><p>{selected.description||'No description provided.'}</p></div>
              <span className="compatibility-badge metadata">Configured</span>
              <button className="icon-btn" title="Edit business unit" onClick={()=>{setEditingId(selected.id);setUnitForm({name:selected.name,industryType:selected.industryType,description:selected.description||'',color:selected.color});setDialog('unit')}}><Pencil size={16}/></button>
              {!selected.isDefault&&<button className="icon-btn danger" title="Delete business unit" onClick={removeBusinessUnit}><Trash2 size={16}/></button>}
            </div>
            <nav className="metadata-tabs">
              {[['overview',Layers3,'Overview'],['fields',Settings2,'Lead fields'],['pipeline',GitBranch,'Lead pipeline'],['sources',Waypoints,'Source configuration'],...(selected.compatibilityMode==='legacy_school'?[['academic',CalendarRange,'Academic configuration']]:[]),['operations',Workflow,'Tracker']].map(([id,Icon,label])=><button key={id} className={tab===id?'active':''} onClick={()=>changeTab(id)}><Icon size={16}/>{label}</button>)}
            </nav>
            {tab==='overview'&&<Overview config={config} selected={selected}/>}
            {tab==='fields'&&<MetadataList title="Lead fields" description="Configure forms, list columns, filters, search, and import templates for this business unit." action="Add field" onAdd={()=>{setEditingId(null);setFieldForm(emptyField);setDialog('field')}} onEdit={row=>{const field=config.fields.find(item=>item.id===row.id);setEditingId(field.id);setFieldForm({...emptyField,...field,options:(field.options||[]).join(', ')});setDialog('field')}} onDelete={row=>removeConfiguredItem('fields',row,'lead field')} rows={config.fields.map(field=>({id:field.id,title:field.displayName,subtitle:`${field.fieldType.replace('_',' ')} · ${field.fieldKey}`,badges:[field.isSystem?'System field':null,field.isRequired?'Form required':null,field.showInList?'List column':null,field.isFilterable?'Filter':null,field.isImportable?(field.isImportRequired?'Import required':'Import column'):null].filter(Boolean)}))}/>}
            {tab==='pipeline'&&<section className="pipeline-configuration">
              <nav className="pipeline-config-tabs">
                <button className={pipelineTab==='stages'?'active':''} onClick={()=>setPipelineTab('stages')}>Stages <span>{config.pipelineStages.length}</span></button>
                <button className={pipelineTab==='substages'?'active':''} onClick={()=>setPipelineTab('substages')}>Sub-stages <span>{(config.leadSubstages||[]).length}</span></button>
              </nav>
              {pipelineTab==='stages'&&<MetadataList title="Lead stages" description="Configure the stages used to qualify and progress leads in this business unit." action="Add stage" onAdd={()=>{setEditingId(null);setStageForm({displayName:'',stageType:'open',color:'#4A4FB1',requiresFollowup:false,isActive:true});setDialog('pipeline-stage')}} onEdit={row=>{const stage=config.pipelineStages.find(item=>item.id===row.id);setEditingId(stage.id);setStageForm({displayName:stage.displayName,stageType:stage.stageType,color:stage.color,isActive:stage.isActive,requiresFollowup:Boolean(stage.requiresFollowup)});setDialog('pipeline-stage')}} onDelete={row=>removePipelineItem('pipeline-stages',row)} rows={config.pipelineStages.map(stage=>({id:stage.id,title:stage.displayName,subtitle:stage.requiresFollowup?'Follow-up required':'No required follow-up',badges:[`Position ${stage.position}`,stage.isActive?'Active':'Inactive'],color:stage.color}))}/>}
              {pipelineTab==='substages'&&<MetadataList title="Lead sub-stages" description="Configure the detailed progress options available under each stage for this business unit." action="Add sub-stage" onAdd={()=>{setEditingId(null);setSubstageForm({displayName:'',stageId:config.pipelineStages[0]?.id||'',isActive:true});setDialog('pipeline-substage')}} onEdit={row=>{const item=(config.leadSubstages||[]).find(entry=>entry.id===row.id);setEditingId(item.id);setSubstageForm({displayName:item.displayName,stageId:item.stageId,isActive:item.isActive});setDialog('pipeline-substage')}} onDelete={row=>removePipelineItem('pipeline-substages',row)} rows={(config.leadSubstages||[]).map(item=>({id:item.id,title:item.displayName,subtitle:config.pipelineStages.find(stage=>stage.id===item.stageId)?.displayName||'Unknown stage',badges:[`Position ${item.position}`,item.isActive?'Active':'Inactive']}))}/>}
            </section>}
            {tab==='sources'&&<section className="business-unit-source"><LeadConfiguration key={selectedId} embedded businessUnitId={selectedId} useBusinessUnitSources={selected.compatibilityMode==='metadata'} onMessage={message=>message&&notify(message.type,message.text)}/></section>}
            {tab==='academic'&&selected.compatibilityMode==='legacy_school'&&<section className="business-unit-academic"><AcademicConfigurationPage embedded onMessage={message=>message&&notify(message.type,message.text)}/></section>}
            {tab==='operations'&&<MetadataList title="Tracker statuses" description="Configure and order the progress statuses for MOM action items. New action items always start in the first status." action="Add status" onAdd={()=>{setEditingId(null);setStageForm({displayName:'',stageType:'open',color:'#4A4FB1'});setDialog('operation-stage')}} onEdit={row=>{const stage=config.operationStages.find(item=>item.id===row.id);setEditingId(stage.id);setStageForm({displayName:stage.displayName,stageType:stage.stageType,color:stage.color,isActive:stage.isActive});setDialog('operation-stage')}} onMove={moveOperationStage} onDelete={row=>removeConfiguredItem('operation-stages',row,'Tracker status')} rows={config.operationStages.map((stage,index)=>({id:stage.id,title:stage.displayName,subtitle:stage.stageType.replaceAll('_',' '),badges:[index===0?'Default starting status':`Order ${index+1}`],color:stage.color,canMoveUp:index>0,canMoveDown:index<config.operationStages.length-1}))}/>}
          </>}
        </section>
      </div>
      {dialog&&<><div className="drawer-backdrop" onClick={()=>setDialog(null)}/><section className="metadata-dialog" role="dialog" aria-modal="true">
        <header><div><span className="eyebrow">Configuration</span><h2>{editingId?'Edit ':dialog==='unit'?'Add business unit':dialog==='field'?'Add lead field':dialog==='pipeline-stage'?'Add pipeline stage':dialog==='pipeline-substage'?'Add pipeline sub-stage':'Add tracker status'}{editingId&&(dialog==='field'?'lead field':dialog==='pipeline-stage'?'pipeline stage':dialog==='pipeline-substage'?'pipeline sub-stage':'tracker status')}</h2></div><button className="icon-btn" onClick={()=>{setDialog(null);setEditingId(null)}}><X/></button></header>
        {dialog==='unit'&&<form onSubmit={createUnit}><label>Name *<input required value={unitForm.name} onChange={e=>setUnitForm({...unitForm,name:e.target.value})} placeholder="e.g. Real Estate"/></label><label>Industry type *<input required value={unitForm.industryType} onChange={e=>setUnitForm({...unitForm,industryType:e.target.value})} placeholder="e.g. Property Sales"/></label><label>Description<textarea rows="3" value={unitForm.description} onChange={e=>setUnitForm({...unitForm,description:e.target.value})}/></label><label>Theme colour<input type="color" value={unitForm.color} onChange={e=>setUnitForm({...unitForm,color:e.target.value})}/></label><DialogFooter saving={saving} onCancel={()=>setDialog(null)}/></form>}
        {dialog==='field'&&<form onSubmit={addField}><label>Field name *<input required value={fieldForm.displayName} onChange={e=>setFieldForm({...fieldForm,displayName:e.target.value,importHeader:!fieldForm.importHeader||fieldForm.importHeader===fieldForm.displayName?e.target.value:fieldForm.importHeader})}/></label><label>Field type *<select disabled={fieldForm.isSystem} value={fieldForm.fieldType} onChange={e=>{const fieldType=e.target.value;setFieldForm({...fieldForm,fieldType,filterControl:filterControlOptions(fieldType)[0][0]})}}>{['text','textarea','number','decimal','date','datetime','email','phone','boolean','single_select','multi_select','user','file'].map(type=><option key={type} value={type}>{type.replace('_',' ')}</option>)}</select></label>{['single_select','multi_select'].includes(fieldForm.fieldType)&&!fieldForm.isSystem&&<label>Options<input value={fieldForm.options} onChange={e=>setFieldForm({...fieldForm,options:e.target.value})} placeholder="Option 1, Option 2"/></label>}<label>Placeholder<input value={fieldForm.placeholder} onChange={e=>setFieldForm({...fieldForm,placeholder:e.target.value})}/></label><div className="check-grid"><label><input type="checkbox" checked={fieldForm.isRequired} onChange={e=>setFieldForm({...fieldForm,isRequired:e.target.checked})}/>Required on lead form</label><label><input type="checkbox" checked={fieldForm.showInList} onChange={e=>setFieldForm({...fieldForm,showInList:e.target.checked})}/>Show in list</label><label><input type="checkbox" checked={fieldForm.isFilterable} onChange={e=>setFieldForm({...fieldForm,isFilterable:e.target.checked})}/>Filterable</label><label><input type="checkbox" checked={fieldForm.isSearchable} onChange={e=>setFieldForm({...fieldForm,isSearchable:e.target.checked})}/>Searchable</label><label><input type="checkbox" checked={fieldForm.isImportable} onChange={e=>setFieldForm({...fieldForm,isImportable:e.target.checked,isImportRequired:e.target.checked?fieldForm.isImportRequired:false})}/>Include in import templates</label>{fieldForm.isImportable&&<label><input type="checkbox" checked={fieldForm.isImportRequired} onChange={e=>setFieldForm({...fieldForm,isImportRequired:e.target.checked})}/>Required during import</label>}</div>{fieldForm.isFilterable&&<label>Filter control *<select required value={fieldForm.filterControl||filterControlOptions(fieldForm.fieldType)[0][0]} onChange={e=>setFieldForm({...fieldForm,filterControl:e.target.value})}>{filterControlOptions(fieldForm.fieldType).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><small>Controls how this field appears in the Leads filter panel.</small></label>}{fieldForm.isImportable&&<div className="dynamic-form-grid"><label>Import column heading *<input required value={fieldForm.importHeader} onChange={e=>setFieldForm({...fieldForm,importHeader:e.target.value})} placeholder={fieldForm.displayName||'CSV / Google Sheet heading'}/></label><label>Example value<input value={fieldForm.importSampleValue||''} onChange={e=>setFieldForm({...fieldForm,importSampleValue:e.target.value})} placeholder="Shown in the downloaded template"/></label></div>}<DialogFooter saving={saving} onCancel={()=>setDialog(null)}/></form>}
        {['pipeline-stage','operation-stage'].includes(dialog)&&<form onSubmit={dialog==='pipeline-stage'?addPipelineStage:addOperationStage}><label>{dialog==='operation-stage'?'Status':'Stage'} name *<input required value={stageForm.displayName} onChange={e=>setStageForm({...stageForm,displayName:e.target.value})}/></label>{dialog==='operation-stage'&&<label>Status behaviour<select value={stageForm.stageType} onChange={e=>setStageForm({...stageForm,stageType:e.target.value})}><option value="open">Open / active</option><option value="on_hold">On hold</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></label>}<label>Colour<input type="color" value={stageForm.color} onChange={e=>setStageForm({...stageForm,color:e.target.value})}/></label>{dialog==='pipeline-stage'&&<label className="check-option"><input type="checkbox" checked={stageForm.requiresFollowup} onChange={e=>setStageForm({...stageForm,requiresFollowup:e.target.checked})}/>Next follow-up required</label>}{editingId&&<label className="check-option"><input type="checkbox" checked={stageForm.isActive!==false} onChange={e=>setStageForm({...stageForm,isActive:e.target.checked})}/>Active</label>}<DialogFooter saving={saving} onCancel={()=>setDialog(null)}/></form>}
        {dialog==='pipeline-substage'&&<form onSubmit={addPipelineSubstage}><label>Parent stage *<select required value={substageForm.stageId} onChange={e=>setSubstageForm({...substageForm,stageId:Number(e.target.value)})}><option value="">Select stage</option>{config.pipelineStages.map(stage=><option key={stage.id} value={stage.id}>{stage.displayName}</option>)}</select></label><label>Sub-stage name *<input required value={substageForm.displayName} onChange={e=>setSubstageForm({...substageForm,displayName:e.target.value})}/></label>{editingId&&<label className="check-option"><input type="checkbox" checked={substageForm.isActive!==false} onChange={e=>setSubstageForm({...substageForm,isActive:e.target.checked})}/>Active</label>}<DialogFooter saving={saving} onCancel={()=>setDialog(null)}/></form>}
      </section></>}
    </main>
  );
}

function Overview({config}){
  const cards=[['Modules',config.modules.length,Layers3],['Lead fields',config.fields.length,Settings2],['Pipeline stages',config.pipelineStages.length,GitBranch],['Tracker stages',config.operationStages.length,Workflow]];
  return <div className="metadata-overview"><div className="metadata-stat-grid">{cards.map(([label,value,Icon])=><article key={label}><Icon/><span>{label}</span><strong>{value}</strong></article>)}</div><section className="metadata-explanation"><h3>Business Unit configuration</h3><p>Manage this Business Unit’s fields, lead pipeline, source data, academic setup where applicable, and tracker workflow from the tabs above.</p></section></div>;
}
function MetadataList({title,description,action,onAdd,onEdit,onDelete,onMove,rows}){
  return <section className="metadata-list"><header><div><h3>{title}</h3><p>{description}</p></div>{onAdd&&<button className="primary" onClick={onAdd}><Plus size={16}/>{action}</button>}</header><div>{rows.map(row=><article key={row.id}><i style={{background:row.color||'#ECECFB',color:row.color?'#fff':'#4A4FB1'}}>{row.color?<GitBranch size={15}/>:<Settings2 size={15}/>}</i><span><strong>{row.title}</strong><small>{row.subtitle}</small></span><div className="metadata-row-badges">{row.badges.map(item=><em key={item}>{item}</em>)}</div>{(onEdit||onDelete||onMove)&&<div className="metadata-row-actions">{onMove&&<><button className="icon-btn reorder" disabled={!row.canMoveUp} title={`Move ${row.title} up`} onClick={()=>onMove(row,'up')}><ArrowUp size={15}/></button><button className="icon-btn reorder" disabled={!row.canMoveDown} title={`Move ${row.title} down`} onClick={()=>onMove(row,'down')}><ArrowDown size={15}/></button></>}{onEdit&&<button className="icon-btn" title="Edit configuration" onClick={()=>onEdit(row)}><Pencil size={15}/></button>}{onDelete&&row.canDelete!==false&&<button className="icon-btn danger" title={`Delete ${row.title}`} onClick={()=>onDelete(row)}><Trash2 size={15}/></button>}</div>}</article>)}{!rows.length&&<div className="empty"><Settings2/><strong>No configuration available</strong><span>{onAdd?`Use ${action.toLowerCase()} to get started.`:'Add configuration for this Business Unit to continue.'}</span></div>}</div></section>;
}
function DialogFooter({saving,onCancel}){return <footer><button type="button" className="secondary" onClick={onCancel}>Cancel</button><button className="primary" disabled={saving}>{saving?'Saving…':'Save configuration'}</button></footer>;}
