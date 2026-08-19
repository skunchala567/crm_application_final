import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Building2, CalendarRange, Check, ChevronDown, ChevronRight, Copy, CreditCard, Database, ExternalLink, GitBranch, Layers3, Pencil, Plus, Search, Settings2, Trash2, Waypoints, Workflow, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { api } from './api';
import { useBusinessUnit } from './BusinessUnitContext.jsx';
import { applyBrandTheme, DEFAULT_BRAND_COLOR } from './brand-theme.js';
import AcademicConfigurationPage from './AcademicConfigurationPage.jsx';
import BusinessConfigurationPage from './BusinessConfigurationPage.jsx';
import LeadConfiguration from './LeadConfiguration.jsx';
import ScrollableTabStrip from './components/ScrollableTabStrip.jsx';
import './MetadataPlatform.css';

const emptyUnit={name:'',brandTitle:'',brandSubtitle:'',brandLogo:'',helpUrl:'',helpTitle:'',helpSubtitle:'',industryType:'General',description:'',color:'#0b7a4f',deletionPassword:''};

const DEFAULT_COLOUR='#0b7a4f';
// Accepts what people actually paste from a design tool or brand guide: with or
// without the leading #, 3-digit shorthand, any case. Returns '' when the text
// isn't a complete colour yet, so a half-typed value is never committed.
function normaliseHex(input){
  const raw=String(input??'').trim().replace(/^#/,'');
  if(/^[0-9a-f]{3}$/i.test(raw))return `#${raw.split('').map(char=>char+char).join('')}`.toLowerCase();
  if(/^[0-9a-f]{6}$/i.test(raw))return `#${raw}`.toLowerCase();
  return '';
}

// Swatch + hex box, kept in step: picking from the swatch rewrites the hex, and
// pasting a hex moves the swatch. The text keeps its own state while being typed
// so an incomplete value ("#0b7a") isn't clobbered on every keystroke.
function ColourField({label,value,onChange}){
  const [text,setText]=useState(value||DEFAULT_COLOUR);
  useEffect(()=>{
    if(normaliseHex(text)!==String(value||'').toLowerCase())setText(value||'');
  },[value]);
  const swatch=normaliseHex(text)||normaliseHex(value)||DEFAULT_COLOUR;
  // While typing, only a full 6-digit hex commits. Expanding 3-digit shorthand
  // on every keystroke would make "#0b7a4f" flash through #00bb77 as the third
  // character lands; shorthand is instead expanded on blur, so a pasted "#0a0"
  // still applies when focus leaves the field.
  const typed=next=>{
    setText(next);
    const hex=normaliseHex(next);
    if(hex&&next.trim().replace(/^#/,'').length===6)onChange(hex);
  };
  return <label className="colour-field">{label}
    <span className="colour-field-row">
      <input type="color" value={swatch} onChange={event=>{setText(event.target.value);onChange(event.target.value);}} aria-label={`${label} swatch`}/>
      <input type="text" value={text} onChange={event=>typed(event.target.value)} onBlur={()=>{const hex=normaliseHex(text);if(hex)onChange(hex);setText(hex||normaliseHex(value)||DEFAULT_COLOUR);}} placeholder={DEFAULT_COLOUR} maxLength={7} spellCheck="false" autoComplete="off" aria-label={`${label} hex code`}/>
    </span>
  </label>;
}
const emptyField={displayName:'',fieldType:'text',placeholder:'',options:'',optionsSectionId:'',optionsSectionLevel:'parent',isRequired:false,isFilterable:true,filterControl:'contains',isSearchable:false,isImportable:true,isImportRequired:false,importHeader:'',importSampleValue:'',showInList:true,columnWidth:180,useInLeadForm:true,useInQuickCreate:false,useInLeadDetails:true,useInReports:true,useInAutomations:false};
export const emptyEnquiryForm={displayName:'',description:'',paymentRequired:false,paymentAmount:'',defaultBranchId:'',defaultStageId:'',defaultSubstageId:'',defaultSourceId:'',defaultChannelId:'',defaultCampaignId:'',defaultOwnerEmployeeId:'',settings:{defaultAcademicYear:''},successMessage:'Thank you. Your enquiry has been submitted.',redirectUrl:'',isActive:true,fields:[]};
/**
 * What a masked field shows.
 *
 * The stored value never reaches the browser, so "Leave blank to keep existing
 * key" was the only clue that anything was saved -- and it read the same
 * whether or not it was. Dots say a value is there; typing replaces it.
 */
const secretPlaceholder=(isSet,emptyLabel)=>isSet?'••••••••••••  (saved — type to replace)':emptyLabel;

const emptyBranchForm={name:'',shortName:'',isActive:true,jodoPaymentEnabled:false,jodoApiKey:'',jodoSecretKey:'',jodoCollectorCode:'',jodoBaseUrl:'https://ext.jodo.in',jodoAuthHeader:'',callerdeskDidId:'',callerdeskDidNumber:'',callerdeskCallGroup:'',callerdeskInboundEnabled:true,callerdeskOutboundEnabled:true,smartfloDidId:'',smartfloDidNumber:'',smartfloIvrId:'',smartfloIvrName:'',smartfloDepartmentId:'',smartfloInboundEnabled:true,smartfloOutboundEnabled:true};
const optionArray=value=>{if(Array.isArray(value))return value;if(!value||typeof value!=='object')return[];for(const key of ['data','list','result','records','deskphone_list','deskphones','ivr_list','ivrs','group_list','groups','departments','numbers']){const nested=value[key];if(Array.isArray(nested))return nested;if(nested&&typeof nested==='object'){const found=optionArray(nested);if(found.length)return found;}}return[];};
const fieldUsageKeys=['useInLeadForm','useInQuickCreate','useInLeadDetails','useInReports','useInAutomations'];
const fieldUsageFromValidation=field=>{
  const usage=field?.validation?.usage||{};
  return {
    useInLeadForm:usage.leadForm!==false,
    useInQuickCreate:Boolean(usage.quickCreate),
    useInLeadDetails:usage.leadDetails!==false,
    useInReports:usage.reports!==false,
    useInAutomations:Boolean(usage.automations),
  };
};
const fieldPayload=fieldForm=>{
  const usage={
    leadForm:fieldForm.useInLeadForm!==false,
    quickCreate:Boolean(fieldForm.useInQuickCreate),
    leadDetails:fieldForm.useInLeadDetails!==false,
    reports:fieldForm.useInReports!==false,
    automations:Boolean(fieldForm.useInAutomations),
    list:Boolean(fieldForm.showInList),
    filters:Boolean(fieldForm.isFilterable),
    search:Boolean(fieldForm.isSearchable),
    importTemplates:Boolean(fieldForm.isImportable),
  };
  const validation={...(fieldForm.validation||{}),usage,requiredOnLeadForm:Boolean(fieldForm.isRequired)};
  const cleaned={
    ...fieldForm,
    validation,
    options:fieldForm.options.split(',').map(item=>item.trim()).filter(Boolean),
    optionsSectionId:fieldForm.optionsSectionId?Number(fieldForm.optionsSectionId):null,
    optionsSectionLevel:fieldForm.optionsSectionLevel==='child'?'child':'parent',
  };
  fieldUsageKeys.forEach(key=>delete cleaned[key]);
  return cleaned;
};
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
  // The configuration sections this unit defines, so a select field can take
  // its options from one instead of a list retyped into the dialog.
  const [configSections,setConfigSections]=useState([]);
  // Standard fields this unit has not taken yet -- branch, stage, sub-stage,
  // next follow-up and the rest that the default unit was seeded with.
  const [fieldCatalogue,setFieldCatalogue]=useState([]);
  const requestedTab=searchParams.get('tab');
  const [tab,setTab]=useState(['academic','sources'].includes(requestedTab)?requestedTab:'overview');
  const [pipelineTab,setPipelineTab]=useState('stages');
  const [dialog,setDialog]=useState(null);
  const [unitForm,setUnitForm]=useState(emptyUnit);

  // Preview the theme colour live while the unit dialog is open — the colour
  // drives the whole UI, so a swatch alone tells you very little about how it
  // will actually read. Closing the dialog puts the saved colour back, so an
  // abandoned edit leaves nothing behind. The colour is tracked in a ref
  // because the restore runs on close, by which point a successful save has
  // already moved it on; a value captured when the dialog opened would undo it.
  const savedUnitColour=useRef(DEFAULT_BRAND_COLOR);
  useEffect(()=>{savedUnitColour.current=context.selectedUnit?.color||DEFAULT_BRAND_COLOR;},[context.selectedUnit?.color]);
  useEffect(()=>{
    if(dialog!=='unit')return undefined;
    return ()=>applyBrandTheme(savedUnitColour.current);
  },[dialog]);
  useEffect(()=>{if(dialog==='unit')applyBrandTheme(unitForm.color);},[dialog,unitForm.color]);

  const [fieldForm,setFieldForm]=useState(emptyField);
  const [branchForm,setBranchForm]=useState(emptyBranchForm);
  const [callingOptions,setCallingOptions]=useState({dids:[],groups:[],smartfloDids:[],smartfloDepartments:[],smartfloIvrs:[]});
  const [stageForm,setStageForm]=useState({displayName:'',stageType:'open',color:'#0b7a4f',requiresFollowup:false,isActive:true});
  const [substageForm,setSubstageForm]=useState({displayName:'',stageId:'',isActive:true});
  const [editingId,setEditingId]=useState(null);
  const [saving,setSaving]=useState(false);
  const [unitPickerOpen,setUnitPickerOpen]=useState(false);
  const [unitSearch,setUnitSearch]=useState('');
  const unitPickerRef=useRef(null);
  const selected=context.units.find(unit=>unit.id===selectedId);
  const filteredUnits=context.units.filter(unit=>`${unit.name} ${unit.industryType} ${unit.description||''}`.toLowerCase().includes(unitSearch.toLowerCase().trim()));

  const notify=(type,text)=>onMessage?.({type,text});
  const addStandardField=async (key,form)=>{
    try{
      const result=await api(`/platform/business-units/${selectedId}/field-catalogue`,{method:'POST',body:JSON.stringify({key,...fieldPayload(form||emptyField)})});
      notify('success',result.message);
      setDialog(null);
      await loadConfig(selectedId);
    }catch(error){notify('error',error.message);}
  };
  const loadConfig=async id=>{
    if(!id)return;
    try{setConfig(await api(`/platform/business-units/${id}/config`));}
    catch(error){notify('error',error.message);}
    try{
      const sections=await api('/business-config/sections',{headers:{'X-Business-Unit-Id':String(id)}});
      setConfigSections(sections.data||[]);
    }catch{setConfigSections([]);}
    try{setFieldCatalogue((await api(`/platform/business-units/${id}/field-catalogue`)).data||[]);}
    catch{setFieldCatalogue([]);}
  };
  useEffect(()=>{if(!selectedId&&context.selectedId)setSelectedId(context.selectedId);},[context.selectedId]);
  useEffect(()=>{
    if(searchParams.get('tab')!=='academic')return;
    const school=context.units.find(unit=>unit.compatibilityMode==='legacy_school');
    if(school&&selectedId!==school.id)setSelectedId(school.id);
  },[context.units,searchParams,selectedId]);
  useEffect(()=>{loadConfig(selectedId);},[selectedId]);
  useEffect(()=>{
    let ignore=false;
    api('/callerdesk/config').then(result=>result.data?.configured?Promise.allSettled([api('/callerdesk/deskphones'),api('/callerdesk/groups')]):null).then(results=>{
      if(ignore||!results)return;
      const dids=results[0].status==='fulfilled'?optionArray(results[0].value.data).map(item=>({id:String(item.did_id??item.deskphone_id??item.id??''),number:String(item.did_number??item.deskphone??item.ivr_number??item.number??item.virtual_number??'')})).filter(item=>item.number):[];
      const groups=results[1].status==='fulfilled'?optionArray(results[1].value.data).map(item=>({id:String(item.group_id??item.id??item.group_name??''),name:String(item.group_name??item.name??'')})).filter(item=>item.name):[];
      setCallingOptions(current=>({...current,dids,groups}));
    }).catch(()=>{if(!ignore)setCallingOptions(current=>({...current,dids:[],groups:[]}));});
    api('/smartflo/config').then(result=>result.data?.configured?Promise.allSettled([api('/smartflo/numbers'),api('/smartflo/departments'),api('/smartflo/ivrs')]):null).then(results=>{
      if(ignore||!results)return;
      const smartfloDids=results[0].status==='fulfilled'?optionArray(results[0].value.data).map(item=>({id:String(item.id??item.did_id??''),number:String(item.did??item.number??item.did_number??item.phone_number??'')})).filter(item=>item.number):[];
      const smartfloDepartments=results[1].status==='fulfilled'?optionArray(results[1].value.data).map(item=>({id:String(item.id??item.department_id??''),name:String(item.name??item.department_name??'')})).filter(item=>item.id&&item.name):[];
      const smartfloIvrs=results[2].status==='fulfilled'?optionArray(results[2].value.data).map(item=>({id:String(item.id??item.ivr_id??''),name:String(item.name??item.ivr_name??'')})).filter(item=>item.id&&item.name):[];
      setCallingOptions(current=>({...current,smartfloDids,smartfloDepartments,smartfloIvrs}));
    }).catch(()=>{if(!ignore)setCallingOptions(current=>({...current,smartfloDids:[],smartfloDepartments:[],smartfloIvrs:[]}));});
    return()=>{ignore=true;};
  },[]);
  // Each profile owns one of these two tabs, so switching to a unit that does
  // not have the open one would otherwise leave an empty panel on screen.
  // Enquiry forms moved to Payments; an old link carrying ?tab=enquiry would
  // otherwise show an empty panel.
  useEffect(()=>{if(tab==='enquiry')setTab('overview');},[tab]);
  useEffect(()=>{if(selected&&selected.compatibilityMode!=='legacy_school'&&tab==='academic')setTab('overview');},[selected?.id,selected?.compatibilityMode,tab]);
  useEffect(()=>{if(selected&&selected.compatibilityMode==='legacy_school'&&tab==='configuration')setTab('overview');},[selected?.id,selected?.compatibilityMode,tab]);
  useEffect(()=>{
    if(!unitPickerOpen)return undefined;
    const close=event=>{if(!unitPickerRef.current?.contains(event.target))setUnitPickerOpen(false);};
    const escape=event=>{if(event.key==='Escape')setUnitPickerOpen(false);};
    document.addEventListener('mousedown',close,true);
    document.addEventListener('touchstart',close,true);
    document.addEventListener('keydown',escape,true);
    return()=>{document.removeEventListener('mousedown',close,true);document.removeEventListener('touchstart',close,true);document.removeEventListener('keydown',escape,true);};
  },[unitPickerOpen]);

  const changeTab=id=>{
    setTab(id);
    const next=new URLSearchParams(searchParams);
    if(['academic','sources'].includes(id))next.set('tab',id);else{next.delete('tab');next.delete('section');}
    setSearchParams(next,{replace:true});
  };

  // Logos are stored inline as data URIs: no upload endpoint or static file
  // serving is involved, so the value travels with the business unit row.
  const pickLogo=event=>{
    const file=event.target.files?.[0];
    if(!file)return;
    if(file.size>1024*1024){notify('error','Logo must be 1 MB or smaller');event.target.value='';return;}
    const reader=new FileReader();
    reader.onload=()=>setUnitForm(current=>({...current,brandLogo:String(reader.result||'')}));
    reader.onerror=()=>notify('error','Could not read that image');
    reader.readAsDataURL(file);
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
      const payload=fieldPayload(fieldForm);
      const result=await api(editingId?`/platform/business-units/${selectedId}/fields/${editingId}`:`/platform/business-units/${selectedId}/fields`,{method:editingId?'PUT':'POST',body:JSON.stringify(payload)});
      await loadConfig(selectedId);setDialog(null);setEditingId(null);setFieldForm(emptyField);notify('success',result.message);
    }catch(error){notify('error',error.message);}finally{setSaving(false);}
  };
  const saveBranch=async event=>{
    event.preventDefault();setSaving(true);
    try{
      const result=await api(editingId?`/platform/business-units/${selectedId}/branches/${editingId}`:`/platform/business-units/${selectedId}/branches`,{method:editingId?'PUT':'POST',body:JSON.stringify(branchForm)});
      const branchId=editingId||result.id;
      if(branchForm.smartfloDidId&&branchForm.smartfloIvrId)await api(`/smartflo/branches/${branchId}/route-ivr`,{method:'PUT',body:'{}'});
      await loadConfig(selectedId);setDialog(null);setEditingId(null);setBranchForm(emptyBranchForm);notify('success',result.message);
    }catch(error){notify('error',error.message);}finally{setSaving(false);}
  };
  const addPipelineStage=async event=>{
    event.preventDefault();setSaving(true);
    try{
      const pipeline=config.pipelines.find(item=>item.isDefault)||config.pipelines[0];
      const result=await api(editingId?`/platform/business-units/${selectedId}/pipeline-stages/${editingId}`:`/platform/business-units/${selectedId}/pipeline-stages`,{method:editingId?'PUT':'POST',body:JSON.stringify({...stageForm,pipelineId:pipeline.id})});
      await loadConfig(selectedId);setDialog(null);setEditingId(null);setStageForm({displayName:'',stageType:'open',color:'#0b7a4f',requiresFollowup:false,isActive:true});notify('success',result.message);
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
  const savePipelineDefaults=async values=>{
    setSaving(true);
    try{
      const result=await api(`/platform/business-units/${selectedId}/manual-lead-defaults`,{method:'PUT',body:JSON.stringify(values)});
      notify('success',result.message);await loadConfig(selectedId);
    }catch(error){notify('error',error.message);}finally{setSaving(false);}
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
      await loadConfig(selectedId);setDialog(null);setEditingId(null);setStageForm({displayName:'',stageType:'open',color:'#0b7a4f'});notify('success',result.message);
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
        <div className="business-unit-header-actions">
          <div className="business-unit-top-picker" ref={unitPickerRef}>
            <button type="button" onClick={()=>setUnitPickerOpen(value=>!value)}>
              <i style={{background:selected?.color||'var(--brand-600)'}}><Building2 size={17}/></i>
              <span><small>Selected business unit</small><strong>{selected?.name||'Select business unit'}</strong></span>
              <b>{context.units.length}</b>
              <ChevronDown size={16}/>
            </button>
            {unitPickerOpen&&<div className="business-unit-picker-menu">
              <label><Search size={14}/><input autoFocus value={unitSearch} onChange={event=>setUnitSearch(event.target.value)} placeholder="Search business units..."/></label>
              <section>
                {filteredUnits.map(unit=><button key={unit.id} type="button" className={selectedId===unit.id?'active':''} onClick={()=>{setSelectedId(unit.id);setUnitPickerOpen(false);setUnitSearch('');}}>
                  <i style={{background:unit.color}}><Building2 size={15}/></i>
                  <span><strong>{unit.name}</strong><small>{unit.industryType} · {unit.leadCount} records</small></span>
                  {unit.isDefault&&<em>Default</em>}
                </button>)}
                {!filteredUnits.length&&<p>No business units found</p>}
              </section>
            </div>}
          </div>
          <button className="primary" onClick={()=>{setEditingId(null);setUnitForm(emptyUnit);setDialog('unit')}}><Plus size={17}/> Add business unit</button>
        </div>
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
            <div className="unit-config-sticky">
            <div className="unit-config-title">
              <i style={{background:selected.color}}><Building2/></i>
              <div><span>{selected.industryType}</span><h2>{selected.name}</h2><p>{selected.description||'No description provided.'}</p></div>
              <span className="compatibility-badge metadata">Configured</span>
              <button className="icon-btn" title="Edit business unit" onClick={()=>{setEditingId(selected.id);setUnitForm({name:selected.name,brandTitle:selected.brandTitle||'',brandSubtitle:selected.brandSubtitle||'',brandLogo:selected.brandLogo||'',helpUrl:selected.helpUrl||'',helpTitle:selected.helpTitle||'',helpSubtitle:selected.helpSubtitle||'',industryType:selected.industryType,description:selected.description||'',color:selected.color,deletionPassword:''});setDialog('unit')}}><Pencil size={16}/></button>
              {!selected.isDefault&&<button className="icon-btn danger" title="Delete business unit" onClick={removeBusinessUnit}><Trash2 size={16}/></button>}
            </div>
            {/* Title and tabs travel together as one sticky block, so only the
                page header's height has to be accounted for rather than the
                title's as well -- its height changes with the description. */}
            <ScrollableTabStrip as="nav" className="metadata-tabs" label="configuration tabs">
              {[['overview',Layers3,'Overview'],['branches',CreditCard,'Branches & payments'],['fields',Settings2,'Lead fields'],['pipeline',GitBranch,'Lead pipeline'],['sources',Waypoints,'Source configuration'],...(selected.compatibilityMode==='legacy_school'?[['academic',CalendarRange,'Academic configuration']]:[['configuration',CalendarRange,'Configuration']]),['operations',Workflow,'Tracker'],['database',Database,'Database tables']].map(([id,Icon,label])=><button key={id} className={tab===id?'active':''} onClick={()=>changeTab(id)}><Icon size={16}/>{label}</button>)}
            </ScrollableTabStrip>
            </div>
            {tab==='overview'&&<Overview config={config} selected={selected}/>}
            {tab==='branches'&&<BranchesPaymentPanel config={config} onAdd={()=>{setEditingId(null);setBranchForm(emptyBranchForm);setDialog('branch')}} onEdit={branch=>{const{applicationAmount,applicationStageId,applicationPaymentComponent,...rest}=branch;setEditingId(branch.id);setBranchForm({...emptyBranchForm,...rest,jodoApiKey:'',jodoSecretKey:'',jodoAuthHeader:'',jodoBaseUrl:branch.jodoBaseUrl||'https://ext.jodo.in'});setDialog('branch')}}/>}
            {tab==='fields'&&<MetadataList title="Lead fields" description="Configure forms, list columns, filters, search, and import templates for this business unit." action="Add field" onAdd={()=>{setEditingId(null);setFieldForm(emptyField);setDialog('field')}} onEdit={row=>{const field=config.fields.find(item=>item.id===row.id);setEditingId(field.id);setFieldForm({...emptyField,...field,...fieldUsageFromValidation(field),options:(field.options||[]).join(', '),optionsSectionId:field.optionsSectionId?String(field.optionsSectionId):'',optionsSectionLevel:field.optionsSectionLevel||'parent'});setDialog('field')}} onDelete={row=>removeConfiguredItem('fields',row,'lead field')} rows={config.fields.map(field=>({id:field.id,title:field.displayName,subtitle:`${field.fieldType.replace('_',' ')} · ${field.fieldKey}`,badges:[field.isSystem?'System field':null,field.isRequired?'Lead form mandatory':null,field.showInList?'List column':null,field.isFilterable?'Filter':null,field.isSearchable?'Search':null,field.validation?.usage?.reports!==false?'Reports':null,field.isImportable?(field.isImportRequired?'Import required':'Import column'):null].filter(Boolean)}))}/>}
            {tab==='pipeline'&&<section className="pipeline-configuration">
              <PipelineDefaults config={config} saving={saving} onSave={savePipelineDefaults}/>
              <nav className="pipeline-config-tabs">
                <button className={pipelineTab==='stages'?'active':''} onClick={()=>setPipelineTab('stages')}>Stages <span>{config.pipelineStages.length}</span></button>
                <button className={pipelineTab==='substages'?'active':''} onClick={()=>setPipelineTab('substages')}>Sub-stages <span>{(config.leadSubstages||[]).length}</span></button>
              </nav>
              {pipelineTab==='stages'&&<MetadataList title="Lead stages" description="Configure the stages used to qualify and progress leads in this business unit." action="Add stage" onAdd={()=>{setEditingId(null);setStageForm({displayName:'',stageType:'open',color:'#0b7a4f',requiresFollowup:false,isActive:true});setDialog('pipeline-stage')}} onEdit={row=>{const stage=config.pipelineStages.find(item=>item.id===row.id);setEditingId(stage.id);setStageForm({displayName:stage.displayName,stageType:stage.stageType,color:stage.color,isActive:stage.isActive,requiresFollowup:Boolean(stage.requiresFollowup)});setDialog('pipeline-stage')}} onDelete={row=>removePipelineItem('pipeline-stages',row)} rows={config.pipelineStages.map(stage=>({id:stage.id,title:stage.displayName,subtitle:stage.requiresFollowup?'Follow-up required':'No required follow-up',badges:[`Position ${stage.position}`,stage.isActive?'Active':'Inactive'],color:stage.color}))}/>}
              {pipelineTab==='substages'&&<MetadataList title="Lead sub-stages" description="Configure the detailed progress options available under each stage for this business unit." action="Add sub-stage" onAdd={()=>{setEditingId(null);setSubstageForm({displayName:'',stageId:config.pipelineStages[0]?.id||'',isActive:true});setDialog('pipeline-substage')}} onEdit={row=>{const item=(config.leadSubstages||[]).find(entry=>entry.id===row.id);setEditingId(item.id);setSubstageForm({displayName:item.displayName,stageId:item.stageId,isActive:item.isActive});setDialog('pipeline-substage')}} onDelete={row=>removePipelineItem('pipeline-substages',row)} rows={(config.leadSubstages||[]).map(item=>({id:item.id,title:item.displayName,subtitle:config.pipelineStages.find(stage=>stage.id===item.stageId)?.displayName||'Unknown stage',badges:[`Position ${item.position}`,item.isActive?'Active':'Inactive']}))}/>}
            </section>}
            {tab==='sources'&&<section className="business-unit-source"><LeadConfiguration key={selectedId} embedded businessUnitId={selectedId} useBusinessUnitSources={selected.compatibilityMode==='metadata'} onMessage={message=>message&&notify(message.type,message.text)}/></section>}
            {tab==='academic'&&selected.compatibilityMode==='legacy_school'&&<section className="business-unit-academic"><AcademicConfigurationPage embedded onMessage={message=>message&&notify(message.type,message.text)}/></section>}
            {tab==='configuration'&&selected.compatibilityMode!=='legacy_school'&&<section className="business-unit-academic"><BusinessConfigurationPage key={selectedId} embedded businessUnitId={selectedId} onMessage={message=>message&&notify(message.type,message.text)}/></section>}
            {tab==='operations'&&<MetadataList title="Tracker statuses" description="Configure and order the progress statuses for MOM action items. New action items always start in the first status." action="Add status" onAdd={()=>{setEditingId(null);setStageForm({displayName:'',stageType:'open',color:'#0b7a4f'});setDialog('operation-stage')}} onEdit={row=>{const stage=config.operationStages.find(item=>item.id===row.id);setEditingId(stage.id);setStageForm({displayName:stage.displayName,stageType:stage.stageType,color:stage.color,isActive:stage.isActive});setDialog('operation-stage')}} onMove={moveOperationStage} onDelete={row=>removeConfiguredItem('operation-stages',row,'Tracker status')} rows={config.operationStages.map((stage,index)=>({id:stage.id,title:stage.displayName,subtitle:stage.stageType.replaceAll('_',' '),badges:[index===0?'Default starting status':`Order ${index+1}`],color:stage.color,canMoveUp:index>0,canMoveDown:index<config.operationStages.length-1}))}/>}
            {tab==='database'&&<BusinessUnitDatabaseTables selected={selected}/>}
          </>}
        </section>
      </div>
      {dialog&&<><div className="drawer-backdrop" onClick={()=>setDialog(null)}/><section className="metadata-dialog" role="dialog" aria-modal="true">
        <header><div><span className="eyebrow">Configuration</span><h2>{editingId?'Edit ':dialog==='unit'?'Add business unit':dialog==='field'?'Add lead field':dialog==='branch'?'Add branch':dialog==='pipeline-stage'?'Add pipeline stage':dialog==='pipeline-substage'?'Add pipeline sub-stage':'Add tracker status'}{editingId&&(dialog==='field'?'lead field':dialog==='branch'?'branch':dialog==='pipeline-stage'?'pipeline stage':dialog==='pipeline-substage'?'pipeline sub-stage':'tracker status')}</h2></div><button className="icon-btn" onClick={()=>{setDialog(null);setEditingId(null)}}><X/></button></header>
        {dialog==='unit'&&<form onSubmit={createUnit}><label>Name *<input required value={unitForm.name} onChange={e=>setUnitForm({...unitForm,name:e.target.value})} placeholder="e.g. Real Estate"/></label><label>Industry type *<input required value={unitForm.industryType} onChange={e=>setUnitForm({...unitForm,industryType:e.target.value})} placeholder="e.g. Property Sales"/></label><label>Description<textarea rows="3" value={unitForm.description} onChange={e=>setUnitForm({...unitForm,description:e.target.value})}/></label><fieldset className="unit-branding"><legend>Sidebar branding</legend><label>Title<input value={unitForm.brandTitle} onChange={e=>setUnitForm({...unitForm,brandTitle:e.target.value})} placeholder="Orbit" maxLength={80}/></label><label>Sub title<input value={unitForm.brandSubtitle} onChange={e=>setUnitForm({...unitForm,brandSubtitle:e.target.value})} placeholder="Admissions CRM" maxLength={120}/></label><label>Logo<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={pickLogo}/><small>PNG, JPG, GIF or WebP up to 1 MB. Leave blank to keep the default mark.</small></label>{unitForm.brandLogo&&<div className="unit-branding-preview"><img src={unitForm.brandLogo} alt="Sidebar logo preview"/><button type="button" className="secondary" onClick={()=>setUnitForm({...unitForm,brandLogo:''})}>Remove logo</button></div>}</fieldset><fieldset className="unit-branding"><legend>Support card</legend><label>Link<input type="url" value={unitForm.helpUrl} onChange={e=>setUnitForm({...unitForm,helpUrl:e.target.value})} placeholder="https://wa.me/919000000000" maxLength={1000}/><small>Where the sidebar help card sends people: a WhatsApp chat, a Zoom room, a help desk, or a mailto: / tel: link. Must start with https://, mailto: or tel:. Leave blank to show the card without a link.</small></label><label>Title<input value={unitForm.helpTitle} onChange={e=>setUnitForm({...unitForm,helpTitle:e.target.value})} placeholder="Need a hand?" maxLength={80}/></label><label>Sub title<input value={unitForm.helpSubtitle} onChange={e=>setUnitForm({...unitForm,helpSubtitle:e.target.value})} placeholder="Visit the help centre" maxLength={160}/></label></fieldset><ColourField label="Theme colour" value={unitForm.color} onChange={color=>setUnitForm({...unitForm,color})}/><label>Deletion password<input type="password" value={unitForm.deletionPassword||''} onChange={e=>setUnitForm({...unitForm,deletionPassword:e.target.value})} maxLength={200} autoComplete="new-password" placeholder="No password required"/><small>Applied to every deletion in this Business Unit. Leave blank to allow deletion without a password.</small></label><DialogFooter saving={saving} onCancel={()=>setDialog(null)}/></form>}
        {dialog==='field'&&<FieldConfigurationForm fieldForm={fieldForm} setFieldForm={setFieldForm} sections={configSections} catalogue={editingId?[]:fieldCatalogue} onAddStandard={addStandardField} saving={saving} onCancel={()=>setDialog(null)} onSubmit={addField}/>}
        {dialog==='branch'&&<BranchPaymentForm form={branchForm} setForm={setBranchForm} callingOptions={callingOptions} saving={saving} onCancel={()=>setDialog(null)} onSubmit={saveBranch}/>}
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
function PipelineDefaults({config,saving,onSave}){
  const [values,setValues]=useState({stageId:'',substageId:''});
  useEffect(()=>setValues({stageId:config.manualLeadDefaults?.stageId||'',substageId:config.manualLeadDefaults?.substageId||''}),[config.manualLeadDefaults]);
  const substages=(config.leadSubstages||[]).filter(item=>!values.stageId||String(item.stageId)===String(values.stageId));
  return <form className="pipeline-defaults-panel" onSubmit={event=>{event.preventDefault();onSave(values);}}>
    <div><strong>Manual Add Lead defaults</strong><small>Preselected on new manual leads and editable before saving.</small></div>
    <label>Stage<select value={values.stageId} onChange={event=>setValues({stageId:event.target.value,substageId:''})}><option value="">No default</option>{(config.pipelineStages||[]).filter(item=>item.isActive!==false).map(item=><option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
    <label>Sub-stage<select value={values.substageId} onChange={event=>setValues(current=>({...current,substageId:event.target.value}))}><option value="">No default</option>{substages.filter(item=>item.isActive!==false).map(item=><option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
    <button className="primary" disabled={saving}>{saving?'Saving…':'Save defaults'}</button>
  </form>;
}
function BranchesPaymentPanel({config,onAdd,onEdit}){
  const branches=config.branches||[];
  return <section className="metadata-list"><header><div><h3>Branches & online application payments</h3><p>Configure branch-wise calling routes and Jodo payment credentials. Amounts, payment components and paid-application stages are set on the payment form or public enquiry form.</p></div><button className="primary" onClick={onAdd}><Plus size={16}/>Add branch</button></header>
    <div>{branches.map(branch=><article key={branch.id}><i style={{background:'var(--brand-50)',color:'var(--brand-600)'}}><CreditCard size={15}/></i><span><strong>{branch.name}</strong><small>{branch.shortName||'No short name'} · {branch.jodoCollectorCode?'Payment credentials set':'No payment credentials'}</small></span><div className="metadata-row-badges"><em>{branch.callerdeskDidNumber?`DID ${branch.callerdeskDidNumber}`:'No calling DID'}</em><em>{branch.smartfloDidNumber?`Smartflo ${branch.smartfloDidNumber}`:'No Smartflo DID'}</em><em>{branch.jodoCollectorCode||'No collector code'}</em><em>{branch.isActive===false?'Inactive':'Active'}</em></div><div className="metadata-row-actions"><button className="icon-btn" title="Edit branch configuration" onClick={()=>onEdit(branch)}><Pencil size={15}/></button></div></article>)}{!branches.length&&<div className="empty"><CreditCard/><strong>No branches available</strong><span>Add a branch or configure existing branches.</span></div>}</div>
  </section>;
}

function BranchPaymentForm({form,setForm,callingOptions,saving,onCancel,onSubmit}){
  const patch=changes=>setForm({...form,...changes});
  return <form className="branch-config-form" onSubmit={onSubmit}>
    <fieldset>
      <legend>Branch</legend>
      <div className="branch-field-grid">
        <label>Branch name *<input required value={form.name||''} onChange={e=>patch({name:e.target.value})} placeholder="e.g. Nacharam"/></label>
        <label>Short name / code<input value={form.shortName||''} onChange={e=>patch({shortName:e.target.value})} placeholder="NACHARAM"/></label>
      </div>
      <label className="check-option"><input type="checkbox" checked={form.isActive!==false} onChange={e=>patch({isActive:e.target.checked})}/>Active branch</label>
    </fieldset>

    <fieldset>
      <legend>CallerDesk calling</legend>
      <div className="branch-field-grid">
        <label>Branch DID<select value={form.callerdeskDidNumber||''} onChange={e=>{const selected=callingOptions.dids.find(item=>item.number===e.target.value);patch({callerdeskDidNumber:e.target.value,callerdeskDidId:selected?.id||''});}}><option value="">No DID assigned</option>{form.callerdeskDidNumber&&!callingOptions.dids.some(item=>item.number===form.callerdeskDidNumber)&&<option value={form.callerdeskDidNumber}>{form.callerdeskDidNumber} (saved)</option>}{callingOptions.dids.map(item=><option key={`${item.id}-${item.number}`} value={item.number}>{item.number}{item.id?` · DID ID ${item.id}`:''}</option>)}</select></label>
        <label>Call group<select value={form.callerdeskCallGroup||''} onChange={e=>patch({callerdeskCallGroup:e.target.value})}><option value="">Use account default group</option>{form.callerdeskCallGroup&&!callingOptions.groups.some(item=>item.name===form.callerdeskCallGroup)&&<option value={form.callerdeskCallGroup}>{form.callerdeskCallGroup} (saved)</option>}{callingOptions.groups.map(item=><option key={item.id||item.name} value={item.name}>{item.name}</option>)}</select></label>
      </div>
      <div className="branch-check-row">
        <label className="check-option"><input type="checkbox" checked={form.callerdeskInboundEnabled!==false} onChange={e=>patch({callerdeskInboundEnabled:e.target.checked})}/>Inbound calls</label>
        <label className="check-option"><input type="checkbox" checked={form.callerdeskOutboundEnabled!==false} onChange={e=>patch({callerdeskOutboundEnabled:e.target.checked})}/>Outbound calls</label>
      </div>
      <small>DID options load from the connected CallerDesk account. Calling and webhook routing read these values directly from the branch.</small>
    </fieldset>

    <fieldset>
      <legend>Tata Smartflo calling</legend>
      <div className="branch-field-grid">
        <label>Smartflo DID<select value={form.smartfloDidNumber||''} onChange={e=>{const selected=callingOptions.smartfloDids.find(item=>item.number===e.target.value);patch({smartfloDidNumber:e.target.value,smartfloDidId:selected?.id||''});}}><option value="">Use account default DID</option>{form.smartfloDidNumber&&!callingOptions.smartfloDids.some(item=>item.number===form.smartfloDidNumber)&&<option value={form.smartfloDidNumber}>{form.smartfloDidNumber} (saved)</option>}{callingOptions.smartfloDids.map(item=><option key={`${item.id}-${item.number}`} value={item.number}>{item.number}</option>)}</select></label>
        <label>Inbound IVR<select value={form.smartfloIvrId||''} onChange={e=>{const selected=callingOptions.smartfloIvrs.find(item=>item.id===e.target.value);patch({smartfloIvrId:e.target.value,smartfloIvrName:selected?.name||''});}}><option value="">Do not change Tata DID routing</option>{form.smartfloIvrId&&!callingOptions.smartfloIvrs.some(item=>item.id===String(form.smartfloIvrId))&&<option value={form.smartfloIvrId}>{form.smartfloIvrName||form.smartfloIvrId} (saved)</option>}{callingOptions.smartfloIvrs.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Smartflo department<select value={form.smartfloDepartmentId||''} onChange={e=>patch({smartfloDepartmentId:e.target.value})}><option value="">Use account default department</option>{form.smartfloDepartmentId&&!callingOptions.smartfloDepartments.some(item=>item.id===String(form.smartfloDepartmentId))&&<option value={form.smartfloDepartmentId}>{form.smartfloDepartmentId} (saved)</option>}{callingOptions.smartfloDepartments.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      </div>
      <div className="branch-check-row">
        <label className="check-option"><input type="checkbox" checked={form.smartfloInboundEnabled!==false} onChange={e=>patch({smartfloInboundEnabled:e.target.checked})}/>Inbound calls</label>
        <label className="check-option"><input type="checkbox" checked={form.smartfloOutboundEnabled!==false} onChange={e=>patch({smartfloOutboundEnabled:e.target.checked})}/>Outbound calls</label>
      </div>
      <small>DIDs and departments load from Tata Smartflo. Lead calls use this branch mapping before the account fallback.</small>
    </fieldset>

    <fieldset>
      <legend>Jodo payment credentials</legend>
      <div className="branch-field-grid">
        <label>API base URL<input value={form.jodoBaseUrl||''} onChange={e=>patch({jodoBaseUrl:e.target.value})} placeholder="https://ext.jodo.in"/></label>
        {/* Jodo issues its own Authorization value. Given one it is sent
            exactly as provided; left blank the CRM derives Basic from the key
            and secret, which is what every branch did before.

            A stored secret shows as dots rather than an empty box: the value
            itself is never sent to the browser, so an empty field could not be
            told apart from one that was never set. */}
        <label>Authorization header<input type="password" value={form.jodoAuthHeader||''} onChange={e=>patch({jodoAuthHeader:e.target.value})} placeholder={secretPlaceholder(form.jodoAuthHeaderSet,'Basic ....==')}/></label>
        <label>Collector code<input value={form.jodoCollectorCode||''} onChange={e=>patch({jodoCollectorCode:e.target.value})} placeholder="NACHARAM"/></label>
        <label>API key<input type="password" value={form.jodoApiKey||''} onChange={e=>patch({jodoApiKey:e.target.value})} placeholder={secretPlaceholder(form.jodoApiKeySet,'API key')}/></label>
        <label>Secret key<input type="password" value={form.jodoSecretKey||''} onChange={e=>patch({jodoSecretKey:e.target.value})} placeholder={secretPlaceholder(form.jodoSecretKeySet,'Secret key')}/></label>
      </div>
      <small>Base URL is https://ext.jodo.in for live. Paste the Authorization header Jodo issued; leave it blank to derive one from the API key and secret. Keys are stored on the branch record and are never shown on the public application form. Application amount, payment component and paid-application stage are configured on the payment form or public enquiry form.</small>
    </fieldset>
    <DialogFooter saving={saving} onCancel={onCancel}/>
  </form>;
}

function BusinessUnitDatabaseTables({selected}){
  const [state,setState]=useState({loading:true,error:'',tables:[]});
  useEffect(()=>{
    let ignore=false;
    setState({loading:true,error:'',tables:[]});
    api(`/platform/business-units/${selected.id}/database-tables`)
      .then(result=>{if(!ignore)setState({loading:false,error:'',tables:result.tables||[]});})
      .catch(error=>{if(!ignore)setState({loading:false,error:error.message,tables:[]});});
    return()=>{ignore=true;};
  },[selected.id]);
  const format=value=>{
    if(value==null)return 'NULL';
    if(typeof value==='object')return JSON.stringify(value);
    const text=String(value);
    return text.length>120?`${text.slice(0,120)}…`:text;
  };
  if(state.loading)return <div className="database-tables-panel"><div className="empty"><Database/><strong>Loading database tables…</strong></div></div>;
  if(state.error)return <div className="database-tables-panel"><div className="empty"><Database/><strong>Could not load tables</strong><span>{state.error}</span></div></div>;
  return <section className="database-tables-panel">
    <header><div><h3>Database tables for {selected.name}</h3><p>Read-only preview of tables containing records scoped to this Business Unit. Showing top 5 rows per table.</p></div><b>{state.tables.length} tables</b></header>
    {state.tables.map(table=><article className="database-table-card" key={table.tableName}>
      <div><strong>{table.tableName}</strong><span>{table.rowCount.toLocaleString()} row{table.rowCount===1?'':'s'} for this business unit</span></div>
      <div className="database-table-wrap">
        <table><thead><tr>{table.columns.map(column=><th key={column}>{column}</th>)}</tr></thead><tbody>{table.rows.length?table.rows.map((row,index)=><tr key={index}>{table.columns.map(column=><td key={column} title={format(row[column])}>{format(row[column])}</td>)}</tr>):<tr><td colSpan={Math.max(1,table.columns.length)}>No rows for this business unit</td></tr>}</tbody></table>
      </div>
    </article>)}
    {!state.tables.length&&<div className="empty"><Database/><strong>No scoped tables found</strong><span>No tables with business_unit_id were found in this database.</span></div>}
  </section>;
}

export function defaultEnquiryFields(fields=[]){
  const preferred=['student_name','phone','email','parent_name','class_id','curriculum_id','city','remarks'];
  const byKey=new Map(fields.map(field=>[field.fieldKey,field]));
  return preferred.filter(key=>byKey.has(key)).map((key,index)=>{
    const field=byKey.get(key);
    return {fieldKey:key,label:field.displayName,required:['student_name','phone'].includes(key),placeholder:field.placeholder||'',position:index+1};
  });
}

function publicFormUrl(formKey){return `${window.location.origin}/public/enquiry/${formKey}`;}
function iframeCode(formKey){return `<iframe src="${publicFormUrl(formKey)}" style="width:100%;min-height:680px;border:0;" loading="lazy"></iframe>`;}

export function EnquiryFormsPanel({config,selected,onAdd,onEdit,onDelete,onMessage}){
  const forms=config.enquiryForms||[];
  const copy=async text=>{
    try{await navigator.clipboard.writeText(text);onMessage?.('success','Copied to clipboard');}
    catch{onMessage?.('error','Copy failed. Please copy it manually.');}
  };
  return <section className="metadata-list enquiry-form-list"><header><div><h3>Website enquiry forms</h3><p>Create public forms for {selected.name}. Copy the link or iframe code and place it on your website.</p></div><button className="primary" onClick={onAdd}><Plus size={16}/>Add enquiry form</button></header>
    <div>{forms.map(form=><article key={form.id} className="enquiry-form-card"><i style={{background:'var(--brand-50)',color:'var(--brand-600)'}}><ExternalLink size={15}/></i><span><strong>{form.displayName}</strong><small>{form.formKey} · {(form.fieldSchema||[]).length} fields</small></span><div className="metadata-row-badges"><em>{form.isActive?'Active':'Inactive'}</em><em>{form.defaultBranchId?'Branch mapped':'No branch'}</em><em>{form.defaultStageId?'Stage mapped':'No stage'}</em></div><div className="metadata-row-actions"><button className="icon-btn" title="Copy public link" onClick={()=>copy(publicFormUrl(form.formKey))}><Copy size={15}/></button><button className="icon-btn" title="Copy iframe embed code" onClick={()=>copy(iframeCode(form.formKey))}><ExternalLink size={15}/></button><button className="icon-btn" title="Edit enquiry form" onClick={()=>onEdit(form)}><Pencil size={15}/></button><button className="icon-btn danger" title={`Delete ${form.displayName}`} onClick={()=>onDelete({id:form.id,title:form.displayName})}><Trash2 size={15}/></button></div></article>)}{!forms.length&&<div className="empty"><ExternalLink/><strong>No enquiry forms yet</strong><span>Add a form, choose the fields, then copy the embed code to your website.</span></div>}</div></section>;
}

/**
 * Sources selectable under a channel.
 *
 * Mirrors the rule the Add/Edit lead screens use, so a form configured here
 * offers the same sources a counsellor would see. The mapping lives on the
 * source itself (crm_lead_sources.channel_id):
 * Only sources explicitly mapped to the selected channel are available.
 */
function sourcesForChannel(sources=[],channelId){
  if(!channelId) return [];
  return sources.filter(source=>String(source.channelId||'')===String(channelId));
}

export function EnquiryFormEditor({form,setForm,config,saving,onCancel,onSubmit}){
  const patch=changes=>setForm({...form,...changes});
  const patchSettings=changes=>patch({settings:{...(form.settings||{}),...changes}});
  const fields=config.fields||[];
  const selectedKeys=new Set((form.fields||[]).map(field=>field.fieldKey));
  const addField=field=>patch({fields:[...(form.fields||[]),{fieldKey:field.fieldKey,label:field.displayName,required:Boolean(field.isRequired),placeholder:field.placeholder||'',position:(form.fields||[]).length+1}]});
  const updateField=(index,changes)=>patch({fields:(form.fields||[]).map((field,fieldIndex)=>fieldIndex===index?{...field,...changes}:field)});
  const removeField=index=>patch({fields:(form.fields||[]).filter((_,fieldIndex)=>fieldIndex!==index).map((field,fieldIndex)=>({...field,position:fieldIndex+1}))});
  /* This list is the order visitors see -- the public form renders the schema
     as it is stored. Until now it could only be appended to, so putting Email
     above Parent name meant deleting both and adding them back in order. */
  const moveField=(index,offset)=>{
    const next=[...(form.fields||[])];
    const target=index+offset;
    if(target<0||target>=next.length) return;
    [next[index],next[target]]=[next[target],next[index]];
    patch({fields:next.map((field,fieldIndex)=>({...field,position:fieldIndex+1}))});
  };
  return <form onSubmit={onSubmit} className="enquiry-editor-form">
    <label>Form name *<input required value={form.displayName} onChange={e=>patch({displayName:e.target.value})} placeholder="e.g. Main website enquiry"/></label>
    <label>Status<select value={form.isActive?'active':'inactive'} onChange={e=>patch({isActive:e.target.value==='active'})}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
    <label className="wide">Description<textarea rows="2" value={form.description||''} onChange={e=>patch({description:e.target.value})} placeholder="Shown below the form title"/></label>
    <label>Default branch *<select required value={form.defaultBranchId||''} onChange={e=>patch({defaultBranchId:e.target.value})}><option value="">Select branch</option>{(config.branches||[]).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label>Academic year *<select required value={form.settings?.defaultAcademicYear||''} onChange={e=>patchSettings({defaultAcademicYear:e.target.value})}><option value="">Select academic year</option>{(config.academicYears||[]).map(item=><option key={item.academicYear} value={item.academicYear}>{item.displayName||item.academicYear}</option>)}</select><small>Used automatically for leads created from this website form.</small></label>
    <label>Default stage *<select required value={form.defaultStageId||''} onChange={e=>patch({defaultStageId:e.target.value,defaultSubstageId:''})}><option value="">Select stage</option>{(config.pipelineStages||[]).map(item=><option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
    <label>Default sub-stage<select value={form.defaultSubstageId||''} onChange={e=>patch({defaultSubstageId:e.target.value})}><option value="">No sub-stage</option>{(config.leadSubstages||[]).filter(item=>!form.defaultStageId||String(item.stageId)===String(form.defaultStageId)).map(item=><option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
    {/* Channel before source, and source before campaign: each narrows the
        one after it, so filling them left-to-right now matches the order they
        depend on each other. Source used to sit above channel, which asked
        for the answer before the question. */}
    <label>Default channel<select value={form.defaultChannelId||''} onChange={e=>patch({defaultChannelId:e.target.value,defaultSourceId:''})}><option value="">No channel</option>{(config.channels||[]).map(item=><option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
    <label>Default source<select value={form.defaultSourceId||''} onChange={e=>patch({defaultSourceId:e.target.value})}><option value="">No source</option>{sourcesForChannel(config.sources,form.defaultChannelId).map(item=><option key={item.id} value={item.id}>{item.displayName}</option>)}</select>{form.defaultChannelId&&<small>Sources mapped to the selected channel.</small>}</label>
    <label>Default campaign<select value={form.defaultCampaignId||''} onChange={e=>patch({defaultCampaignId:e.target.value})}><option value="">No campaign</option>{(config.campaigns||[]).map(item=><option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
    <label>Assign owner<OwnerSearchSelect value={form.defaultOwnerEmployeeId||''} options={config.employees||[]} onChange={value=>patch({defaultOwnerEmployeeId:value})}/></label>
    <section className="enquiry-field-builder"><div><strong>Fields shown on website</strong><select value="" onChange={e=>{const field=fields.find(item=>item.fieldKey===e.target.value);if(field)addField(field);}}><option value="">Add field</option>{fields.filter(field=>!selectedKeys.has(field.fieldKey)&&field.validation?.usage?.leadForm!==false).map(field=><option key={field.id} value={field.fieldKey}>{field.displayName}</option>)}</select></div>
      {(form.fields||[]).map((field,index)=><div className="enquiry-field-row" key={`${field.fieldKey}-${index}`}><input value={field.label||''} onChange={e=>updateField(index,{label:e.target.value})} placeholder="Label"/><input value={field.placeholder||''} onChange={e=>updateField(index,{placeholder:e.target.value})} placeholder="Placeholder"/><label><input type="checkbox" checked={Boolean(field.required)} onChange={e=>updateField(index,{required:e.target.checked})}/>Required</label><button type="button" className="icon-btn" title="Move up" aria-label={`Move ${field.label||field.fieldKey} up`} disabled={index===0} onClick={()=>moveField(index,-1)}><ArrowUp size={14}/></button><button type="button" className="icon-btn" title="Move down" aria-label={`Move ${field.label||field.fieldKey} down`} disabled={index===(form.fields||[]).length-1} onClick={()=>moveField(index,1)}><ArrowDown size={14}/></button><button type="button" className="icon-btn danger" title="Remove field" aria-label={`Remove ${field.label||field.fieldKey}`} onClick={()=>removeField(index)}><X size={14}/></button></div>)}
      {!form.fields?.length&&<p>Select the fields you want visitors to fill on your website.</p>}
    </section>
    <fieldset className="enquiry-payment wide">
      <legend>Application payment</legend>
      <label className="check-option"><input type="checkbox" checked={Boolean(form.paymentRequired)} onChange={e=>patch({paymentRequired:e.target.checked})}/>Collect an application payment on this form</label>
      {form.paymentRequired&&<>
        <label>Amount to collect<input type="number" min="1" step="0.01" value={form.paymentAmount??''} onChange={e=>patch({paymentAmount:e.target.value})} placeholder="Leave blank to use the branch amount"/></label>
        <label>Jodo component<input value={form.settings?.paymentComponentType||''} onChange={e=>patchSettings({paymentComponentType:e.target.value})} placeholder="Leave blank to use the branch component" maxLength={120}/><small>What this form&apos;s payments settle against in Jodo, which is how they are told apart there. Must match a component configured on the branch&apos;s Jodo collector.</small></label>
        <small>Jodo API key, secret and collector code come from the selected branch in Branches &amp; payments. Without them the form cannot take payment.</small>
      </>}
    </fieldset>
    <label className="wide">Success message<textarea rows="2" value={form.successMessage||''} onChange={e=>patch({successMessage:e.target.value})}/></label>
    <label className="wide">Redirect URL<input value={form.redirectUrl||''} onChange={e=>patch({redirectUrl:e.target.value})} placeholder="Optional: https://yourwebsite.com/thank-you"/></label>
    <DialogFooter saving={saving} onCancel={onCancel}/>
  </form>;
}

function OwnerSearchSelect({ value, options, onChange }) {
  const [open,setOpen]=useState(false);
  const [search,setSearch]=useState('');
  const selected=options.find(item=>String(item.id)===String(value));
  const filtered=options.filter(item=>`${item.name||''} ${item.email||''}`.toLowerCase().includes(search.toLowerCase())).slice(0,80);
  useEffect(()=>{
    if(!open)return undefined;
    const close=event=>{if(!event.target.closest('.owner-search-select'))setOpen(false);};
    const escape=event=>{if(event.key==='Escape')setOpen(false);};
    document.addEventListener('mousedown',close,true);
    document.addEventListener('touchstart',close,true);
    document.addEventListener('keydown',escape,true);
    return()=>{document.removeEventListener('mousedown',close,true);document.removeEventListener('touchstart',close,true);document.removeEventListener('keydown',escape,true);};
  },[open]);
  return <div className="owner-search-select">
    <button type="button" className={value?'selected':''} onClick={()=>setOpen(current=>!current)}><span>{selected?selected.name:'Unassigned'}</span><ChevronDown size={15}/></button>
    {open&&<div className="owner-search-menu">
      <div><Search size={14}/><input autoFocus value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search CRM users..."/></div>
      <section>
        <button type="button" className={!value?'active':''} onClick={()=>{onChange('');setOpen(false);}}><i>{!value&&<Check size={12}/>}</i><span><strong>Unassigned</strong><small>No default owner</small></span></button>
        {filtered.map(item=><button type="button" key={`${item.id}-${item.userId||''}`} className={String(item.id)===String(value)?'active':''} onClick={()=>{onChange(String(item.id));setOpen(false);setSearch('');}}><i>{String(item.id)===String(value)&&<Check size={12}/>}</i><span><strong>{item.name}</strong><small>{item.email||'CRM user'}</small></span></button>)}
        {!filtered.length&&<p>No CRM users found</p>}
      </section>
    </div>}
  </div>;
}

function MetadataList({title,description,action,onAdd,onEdit,onDelete,onMove,rows}){
  return <section className="metadata-list"><header><div><h3>{title}</h3><p>{description}</p></div>{onAdd&&<button className="primary" onClick={onAdd}><Plus size={16}/>{action}</button>}</header><div>{rows.map(row=><article key={row.id}><i style={{background:row.color||'var(--brand-50)',color:row.color?'#fff':'var(--brand-600)'}}>{row.color?<GitBranch size={15}/>:<Settings2 size={15}/>}</i><span><strong>{row.title}</strong><small>{row.subtitle}</small></span><div className="metadata-row-badges">{row.badges.map(item=><em key={item}>{item}</em>)}</div>{(onEdit||onDelete||onMove)&&<div className="metadata-row-actions">{onMove&&<><button className="icon-btn reorder" disabled={!row.canMoveUp} title={`Move ${row.title} up`} onClick={()=>onMove(row,'up')}><ArrowUp size={15}/></button><button className="icon-btn reorder" disabled={!row.canMoveDown} title={`Move ${row.title} down`} onClick={()=>onMove(row,'down')}><ArrowDown size={15}/></button></>}{onEdit&&<button className="icon-btn" title="Edit configuration" onClick={()=>onEdit(row)}><Pencil size={15}/></button>}{onDelete&&row.canDelete!==false&&<button className="icon-btn danger" title={`Delete ${row.title}`} onClick={()=>onDelete(row)}><Trash2 size={15}/></button>}</div>}</article>)}{!rows.length&&<div className="empty"><Settings2/><strong>No configuration available</strong><span>{onAdd?`Use ${action.toLowerCase()} to get started.`:'Add configuration for this Business Unit to continue.'}</span></div>}</div></section>;
}

function FieldConfigurationForm({fieldForm,setFieldForm,sections=[],catalogue=[],onAddStandard,saving,onCancel,onSubmit}){
  // Two ways in: take a standard field the CRM already understands, or define
  // one of your own. Both then configure the same things -- where the field
  // appears, whether it is mandatory, how it filters and imports -- because
  // that is just as relevant to a standard field as to a custom one.
  const [mode,setMode]=useState(catalogue.length?'standard':'new');
  const [standardKey,setStandardKey]=useState('');
  const patch=changes=>setFieldForm({...fieldForm,...changes});
  const grouped=catalogue.reduce((groups,entry)=>{(groups[entry.group]=groups[entry.group]||[]).push(entry);return groups;},{});
  const chosen=catalogue.find(entry=>entry.key===standardKey);
  const standard=mode==='standard'&&catalogue.length>0;

  /** Picking a standard field seeds the form with that field's own defaults. */
  const chooseStandard=key=>{
    setStandardKey(key);
    const entry=catalogue.find(item=>item.key===key);
    if(!entry)return;
    setFieldForm({
      ...emptyField,
      displayName:entry.label,
      fieldType:entry.type,
      importHeader:entry.label,
      columnWidth:entry.width||180,
      isSearchable:Boolean(entry.searchable),
      filterControl:entry.filterControl||filterControlOptions(entry.type)[0][0],
    });
  };

  const usageOptions=[
    ['useInLeadForm','Lead form','Field is available while creating or editing a lead'],
    ['useInQuickCreate','Quick lead form','Field can appear in compact lead capture flows'],
    ['useInLeadDetails','Lead details','Field is visible in the lead profile/details screen'],
    ['showInList','Lead list column','Field can be shown as a column in lead lists'],
    ['isFilterable','Lead filters','Field is available in filter panels'],
    ['isSearchable','Global/search','Field can be included in search matching'],
    ['useInReports','Reports and pivots','Field is available for rows, columns, values, and report filters'],
    ['useInAutomations','Automations','Field can be used by workflow conditions later'],
    ['isImportable','Import templates','Field is included in CSV/Google Sheet import templates'],
  ];

  // Shared by both modes, so a standard field is as configurable as a custom one.
  const configuration=<>
    <label>Lead form requirement *<select value={fieldForm.isRequired?'mandatory':'optional'} onChange={e=>patch({isRequired:e.target.value==='mandatory',useInLeadForm:true})}><option value="optional">Optional on lead form</option><option value="mandatory">Mandatory on lead form</option></select><small>Mandatory fields must be filled before a lead can be saved.</small></label>
    <section className="field-usage-panel">
      <div><strong>Where this field can be used</strong><span>Select all areas where this field should be available.</span></div>
      <div className="check-grid field-usage-grid">{usageOptions.map(([key,label,description])=><label key={key}><input type="checkbox" checked={Boolean(fieldForm[key])} onChange={e=>patch({[key]:e.target.checked,...(key==='isImportable'&&!e.target.checked?{isImportRequired:false}:{}),...(key==='useInLeadForm'&&!e.target.checked?{isRequired:false}: {})})}/><span><b>{label}</b><small>{description}</small></span></label>)}</div>
    </section>
    {fieldForm.isImportable&&<label className="check-option"><input type="checkbox" checked={fieldForm.isImportRequired} onChange={e=>patch({isImportRequired:e.target.checked})}/>Required during import</label>}
    {fieldForm.isFilterable&&<label>Filter control *<select required value={fieldForm.filterControl||filterControlOptions(fieldForm.fieldType)[0][0]} onChange={e=>patch({filterControl:e.target.value})}>{filterControlOptions(fieldForm.fieldType).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><small>Controls how this field appears in the Leads filter panel.</small></label>}
    {fieldForm.isImportable&&<div className="dynamic-form-grid"><label>Import column heading *<input required value={fieldForm.importHeader} onChange={e=>patch({importHeader:e.target.value})} placeholder={fieldForm.displayName||'CSV / Google Sheet heading'}/></label><label>Example value<input value={fieldForm.importSampleValue||''} onChange={e=>patch({importSampleValue:e.target.value})} placeholder="Shown in the downloaded template"/></label></div>}
  </>;

  const modeSwitch=Boolean(catalogue.length)&&<div className="field-mode-switch">
    <button type="button" className={standard?'active':''} onClick={()=>{setMode('standard');setStandardKey('');}}>Standard field</button>
    <button type="button" className={standard?'':'active'} onClick={()=>{setMode('new');setFieldForm(emptyField);}}>New custom field</button>
  </div>;

  if(standard)return <form onSubmit={event=>{event.preventDefault();if(standardKey)onAddStandard(standardKey,fieldForm);}}>
    {modeSwitch}
    <div className="dynamic-form-grid">
      <label>Standard field *<select required value={standardKey} onChange={e=>chooseStandard(e.target.value)}>
        <option value="">Select a field</option>
        {Object.entries(grouped).map(([group,entries])=><optgroup key={group} label={group}>
          {entries.map(entry=><option key={entry.key} value={entry.key}>{entry.label}</option>)}
        </optgroup>)}
      </select><small>{chosen
        ? `${chosen.type.replace('_',' ')} · values from ${chosen.sourceLabel.toLowerCase()}`
        : 'Fields the CRM already understands, with their values wired up.'}</small></label>
      <label>Field name *<input required value={fieldForm.displayName} disabled={!standardKey} onChange={e=>patch({displayName:e.target.value,importHeader:e.target.value})} placeholder="Shown on the lead form"/></label>
    </div>
    {Boolean(standardKey)&&<>
      <label>Placeholder<input value={fieldForm.placeholder} onChange={e=>patch({placeholder:e.target.value})}/></label>
      {configuration}
    </>}
    {!standardKey&&<p className="config-hint">Choose a field above to set where it appears and how it behaves.</p>}
    <DialogFooter saving={saving} onCancel={onCancel} label="Add field" disabled={!standardKey}/>
  </form>;

  return <form onSubmit={onSubmit}>
    {modeSwitch}
    <div className="dynamic-form-grid">
      <label>Field name *<input required value={fieldForm.displayName} onChange={e=>patch({displayName:e.target.value,importHeader:!fieldForm.importHeader||fieldForm.importHeader===fieldForm.displayName?e.target.value:fieldForm.importHeader})}/></label>
      <label>Field type *<select disabled={fieldForm.isSystem} value={fieldForm.fieldType} onChange={e=>{const fieldType=e.target.value;patch({fieldType,filterControl:filterControlOptions(fieldType)[0][0]})}}>{['text','textarea','number','decimal','date','datetime','email','phone','boolean','single_select','multi_select','user','file'].map(type=><option key={type} value={type}>{type.replace('_',' ')}</option>)}</select>
        {Boolean(sections.length)&&!['single_select','multi_select'].includes(fieldForm.fieldType)&&
          <small>Choose <b>single select</b> or <b>multi select</b> to take the options from {sections.filter(section=>section.isActive).map(section=>section.displayName).join(', ')}.</small>}
      </label>
    </div>
    {['single_select','multi_select'].includes(fieldForm.fieldType)&&!fieldForm.isSystem&&<>
      <label>Options from *<select value={fieldForm.optionsSectionId?`${fieldForm.optionsSectionId}:${fieldForm.optionsSectionLevel||'parent'}`:''} onChange={e=>{
        const [sectionId,level]=e.target.value.split(':');
        patch({optionsSectionId:sectionId||'',optionsSectionLevel:level||'parent'});
      }}>
        <option value="">A list typed here</option>
        {sections.filter(section=>section.isActive).flatMap(section=>section.sectionType==='hierarchy'
          ?[<option key={`${section.id}:parent`} value={`${section.id}:parent`}>{section.displayName}</option>,
            <option key={`${section.id}:child`} value={`${section.id}:child`}>{section.displayName} &rarr; {section.childLabel||'sub-values'}</option>]
          :[<option key={`${section.id}:parent`} value={`${section.id}:parent`}>{section.displayName}</option>])}
      </select><small>{fieldForm.optionsSectionId
        ?'Options are read from that section, so adding a value there updates this field everywhere.'
        :sections.length?'Or point this field at a section configured for this business unit.':'No configuration sections defined for this business unit yet.'}</small></label>
      {!fieldForm.optionsSectionId&&<label>Options<input value={fieldForm.options} onChange={e=>patch({options:e.target.value})} placeholder="Option 1, Option 2"/></label>}
      {Boolean(fieldForm.optionsSectionId)&&<label>Current values<input readOnly value={(()=>{
        const [id,level]=[String(fieldForm.optionsSectionId),fieldForm.optionsSectionLevel||'parent'];
        const section=sections.find(item=>String(item.id)===id);
        if(!section)return '';
        const values=level==='child'?section.values.flatMap(parent=>parent.children):section.values;
        return values.filter(value=>value.isActive).map(value=>value.displayName).join(', ');
      })()} placeholder="This section has no values yet"/></label>}
    </>}
    <label>Placeholder<input value={fieldForm.placeholder} onChange={e=>patch({placeholder:e.target.value})}/></label>
    {configuration}
    <DialogFooter saving={saving} onCancel={onCancel}/>
  </form>;
}

function DialogFooter({saving,onCancel,label,disabled}){return <footer><button type="button" className="secondary" onClick={onCancel}>Cancel</button><button className="primary" disabled={saving||disabled}>{saving?'Saving…':label||'Save configuration'}</button></footer>;}
