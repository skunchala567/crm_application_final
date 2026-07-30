import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Bold, CalendarClock, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, CirclePause, ClipboardCheck, Clock3,
  Columns3, FileText, IndentDecrease, IndentIncrease, List, ListChecks, ListOrdered, ListTree, Minus,
  Pencil, Plus, RefreshCw, Search, Send, Timer, Trash2, Underline, UserRound,
  Users, Workflow, X, XCircle,
} from 'lucide-react';
import { api } from './api';
import { useBusinessUnit } from './BusinessUnitContext.jsx';
import { MultiSearchSelect } from './FilterWorkspace.jsx';
import Toast from './Toast.jsx';
import './MetadataPlatform.css';

const emptyTask={title:'',description:'',workflowId:'',stageId:'',ownerEmployeeId:'',guestOwnerId:'',guestOwnerName:'',ownerCrmUserId:'',estimatedHours:'',estimateUnit:'hours',dueAt:'',minutesSpent:'',timeNote:'',approvalRequired:false,approverUserIds:[]};
const toLocal=value=>value?new Date(new Date(value).getTime()-new Date(value).getTimezoneOffset()*60000).toISOString().slice(0,16):'';
const duration=minutes=>`${Math.floor(Number(minutes||0)/60)}h ${Number(minutes||0)%60}m`;
const dateKey=value=>{
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return '';
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
};
const estimateInHours=(value,unit)=>{
  const multipliers={hours:1,days:24,weeks:24*7,months:24*30};
  return Number(value||0)*(multipliers[unit]||1);
};
const addEstimateToNow=(value,unit)=>{
  const amount=Number(value);
  if(!Number.isFinite(amount)||amount<=0)return '';
  const deadline=new Date();
  if(unit==='months')deadline.setMonth(deadline.getMonth()+amount);
  else if(unit==='weeks')deadline.setDate(deadline.getDate()+amount*7);
  else if(unit==='days')deadline.setDate(deadline.getDate()+amount);
  else deadline.setHours(deadline.getHours()+amount);
  return toLocal(deadline);
};
const richTextHasContent=value=>String(value||'').replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').trim().length>0;
const sanitizeRichText=value=>{
  if(typeof window==='undefined')return String(value||'');
  const documentValue=new DOMParser().parseFromString(String(value||''),'text/html');
  const allowed=new Set(['P','BR','STRONG','B','EM','I','U','UL','OL','LI','DIV']);
  const clean=node=>{
    [...node.children].forEach(child=>{
      clean(child);
      if(!allowed.has(child.tagName))child.replaceWith(...child.childNodes);
      else [...child.attributes].forEach(attribute=>child.removeAttribute(attribute.name));
    });
  };
  clean(documentValue.body);
  return documentValue.body.innerHTML;
};

function MomRichTextEditor({value,onChange}){
  const editorRef=useRef(null);
  const lastEmittedValueRef=useRef(null);
  const savedRangeRef=useRef(null);
  useEffect(()=>{
    const nextValue=sanitizeRichText(value);
    if(lastEmittedValueRef.current===nextValue){
      lastEmittedValueRef.current=null;
      return;
    }
    if(editorRef.current&&sanitizeRichText(editorRef.current.innerHTML)!==nextValue)editorRef.current.innerHTML=nextValue;
  },[value]);
  const emitChange=()=>{
    const nextValue=sanitizeRichText(editorRef.current?.innerHTML||'');
    lastEmittedValueRef.current=nextValue;
    onChange(nextValue);
  };
  const rememberSelection=()=>{
    const selection=window.getSelection();
    if(!selection?.rangeCount||!editorRef.current)return;
    const range=selection.getRangeAt(0);
    if(editorRef.current.contains(range.commonAncestorContainer))savedRangeRef.current=range.cloneRange();
  };
  const command=(name,argument=null)=>{
    if(!editorRef.current)return;
    editorRef.current.focus({preventScroll:true});
    if(savedRangeRef.current){
      const selection=window.getSelection();
      selection.removeAllRanges();
      selection.addRange(savedRangeRef.current);
    }
    document.execCommand(name,false,argument);
    rememberSelection();
    emitChange();
  };
  const tools=[
    ['bold',Bold,'Bold'],['underline',Underline,'Underline'],
    ['insertUnorderedList',List,'Bulleted list'],['insertOrderedList',ListOrdered,'Numbered list'],
    ['indent',IndentIncrease,'Sub-point'],['outdent',IndentDecrease,'Move point out'],
  ];
  return <div className="mom-rich-editor">
    <div className="mom-editor-toolbar">{tools.map(([name,Icon,label])=><button key={name} type="button" title={label} aria-label={label} onMouseDown={event=>{event.preventDefault();command(name)}}><Icon/></button>)}</div>
    <div ref={editorRef} className="mom-editor-content" contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" tabIndex={0} spellCheck data-placeholder="Write the complete meeting discussion, decisions, observations, and notes here…" onInput={()=>{rememberSelection();emitChange()}} onKeyUp={rememberSelection} onMouseUp={rememberSelection} onBlur={rememberSelection}/>
  </div>;
}

export default function OperationsPage(){
  const {selectedUnit,loading:businessUnitLoading}=useBusinessUnit();
  const [config,setConfig]=useState(null);
  const [records,setRecords]=useState([]);
  const [users,setUsers]=useState([]);
  const [guestOwners,setGuestOwners]=useState([]);
  const [approvals,setApprovals]=useState([]);
  const [momSessions,setMomSessions]=useState([]);
  const [tab,setTab]=useState('tasks');
  const [taskView,setTaskView]=useState('board');
  const [calendarCursor,setCalendarCursor]=useState(()=>new Date(new Date().getFullYear(),new Date().getMonth(),1));
  const [search,setSearch]=useState('');
  const [workflowId,setWorkflowId]=useState('');
  const [stageFilter,setStageFilter]=useState('');
  const [ownerFilter,setOwnerFilter]=useState('');
  const [dueFilter,setDueFilter]=useState('');
  const [approvalFilter,setApprovalFilter]=useState('');
  const [dialog,setDialog]=useState(null);
  const [form,setForm]=useState(emptyTask);
  const [selectedTask,setSelectedTask]=useState(null);
  const [timeForm,setTimeForm]=useState({minutesSpent:'',workNote:''});
  const [decisionForm,setDecisionForm]=useState({decision:'approved',remarks:'',documentReferences:''});
  const [message,setMessage]=useState(null);
  const [saving,setSaving]=useState(false);
  const [meetingItems,setMeetingItems]=useState([]);
  const [meetingNotes,setMeetingNotes]=useState('');
  const [activeMomSession,setActiveMomSession]=useState(null);
  useEffect(()=>{
    if(!selectedUnit?.id)return;
    setTaskView(localStorage.getItem(`crm_tracker_view_${selectedUnit.id}`)||'board');
  },[selectedUnit?.id]);
  const changeTaskView=view=>{
    setTaskView(view);
    if(selectedUnit?.id)localStorage.setItem(`crm_tracker_view_${selectedUnit.id}`,view);
  };

  const load=async()=>{
    if(!selectedUnit?.id)return;
    const [configuration,taskResult,userResult,guestResult,approvalResult,momResult]=await Promise.all([
      api(`/platform/business-units/${selectedUnit.id}/config`),
      api(`/platform/business-units/${selectedUnit.id}/operations`),
      api(`/platform/business-units/${selectedUnit.id}/tracker-users`),
      api(`/platform/business-units/${selectedUnit.id}/tracker-guest-owners`),
      api(`/platform/business-units/${selectedUnit.id}/tracker-approvals`),
      api(`/platform/business-units/${selectedUnit.id}/mom-sessions`),
    ]);
    setConfig(configuration);setRecords(taskResult.data||[]);setUsers(userResult.data||[]);setGuestOwners(guestResult.data||[]);setApprovals(approvalResult.data||[]);setMomSessions(momResult.data||[]);
    const defaultWorkflow=configuration.workflows.find(item=>item.isDefault)||configuration.workflows[0];
    setWorkflowId(current=>current||String(defaultWorkflow?.id||''));
  };
  useEffect(()=>{
    if(!selectedUnit?.id)return;
    setConfig(null);setRecords([]);setWorkflowId('');setStageFilter('');setOwnerFilter('');setDueFilter('');setApprovalFilter('');
    load().catch(error=>setMessage({type:'error',text:error.message}));
  },[selectedUnit?.id]);

  const workflows=config?.workflows||[];
  const stages=(config?.operationStages||[]).filter(stage=>!workflowId||String(stage.workflowId)===String(workflowId));
  const ownerOptions=useMemo(()=>[...new Set(records.map(record=>record.owner||'Unassigned'))].sort((a,b)=>a.localeCompare(b)),[records]);
  const visible=useMemo(()=>{
    const now=new Date(),today=dateKey(now);
    return records.filter(record=>{
      const dueDate=record.dueAt?new Date(record.dueAt):null;
      const dueMatches=!dueFilter||
        (dueFilter==='overdue'&&dueDate&&dueDate<now)||
        (dueFilter==='today'&&dueDate&&dateKey(dueDate)===today)||
        (dueFilter==='upcoming'&&dueDate&&dueDate>now&&dateKey(dueDate)!==today)||
        (dueFilter==='unscheduled'&&!dueDate);
      const approvalMatches=!approvalFilter||
        (approvalFilter==='required'&&record.approvalRequired)||
        (approvalFilter==='not_required'&&!record.approvalRequired)||
        (record.approvalRequired&&record.approvalStatus===approvalFilter);
      return (!workflowId||String(record.workflowId)===String(workflowId))&&
        (!stageFilter||String(record.stageId)===String(stageFilter))&&
        (!ownerFilter||(record.owner||'Unassigned')===ownerFilter)&&dueMatches&&approvalMatches&&
        (!search||`${record.title} ${record.recordNumber} ${record.owner} ${record.description||''}`.toLowerCase().includes(search.toLowerCase()));
    });
  },[records,workflowId,stageFilter,ownerFilter,dueFilter,approvalFilter,search]);
  const boardStages=stageFilter?stages.filter(stage=>String(stage.id)===String(stageFilter)):stages;
  const calendarDays=useMemo(()=>{
    const first=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth(),1);
    const start=new Date(first);
    start.setDate(first.getDate()-first.getDay());
    return Array.from({length:42},(_,index)=>{
      const date=new Date(start);
      date.setDate(start.getDate()+index);
      return date;
    });
  },[calendarCursor]);
  const calendarRecords=useMemo(()=>visible.reduce((groups,record)=>{
    const key=record.dueAt?dateKey(record.dueAt):'';
    if(key)(groups[key]||=[]).push(record);
    return groups;
  },{}),[visible]);
  const terminalStageIds=useMemo(()=>new Set(
    (config?.operationStages||[])
      .filter(stage=>['completed','cancelled'].includes(stage.stageType))
      .map(stage=>String(stage.id)),
  ),[config?.operationStages]);
  const overdueRecords=useMemo(()=>visible
    .filter(record=>record.dueAt&&new Date(record.dueAt)<new Date()&&!terminalStageIds.has(String(record.stageId)))
    .sort((left,right)=>new Date(left.dueAt)-new Date(right.dueAt)),[visible,terminalStageIds]);
  const overdue=overdueRecords.length;
  const pendingApprovals=approvals.filter(item=>item.decision==='pending').length;

  const openCreate=()=>{
    const workflow=workflows.find(item=>String(item.id)===String(workflowId))||workflows[0];
    const firstStage=(config?.operationStages||[]).find(stage=>String(stage.workflowId)===String(workflow?.id));
    setMeetingNotes('');setActiveMomSession(null);
    setMeetingItems([{...emptyTask,clientId:crypto.randomUUID(),workflowId:workflow?.id||'',stageId:firstStage?.id||''}]);setDialog('meeting');
  };
  const continueMomSession=session=>{
    const workflow=workflows.find(item=>item.isDefault)||workflows[0];
    const firstStage=(config?.operationStages||[]).find(stage=>String(stage.workflowId)===String(workflow?.id));
    setMeetingNotes(session.notes||'');setActiveMomSession(session);
    setMeetingItems([{...emptyTask,clientId:crypto.randomUUID(),workflowId:workflow?.id||'',stageId:firstStage?.id||''}]);
    setDialog('meeting');
  };
  const openEdit=record=>{
    setSelectedTask(record);
    setForm({...emptyTask,title:record.title,description:record.description||'',workflowId:record.workflowId,stageId:record.stageId,
      ownerEmployeeId:record.ownerEmployeeId||'',guestOwnerId:record.guestOwnerId||'',dueAt:toLocal(record.dueAt),approvalRequired:Boolean(record.approvalRequired)});
    setDialog('task');
  };
  const updateMeetingItem=(clientId,changes)=>setMeetingItems(items=>items.map(item=>item.clientId===clientId?{...item,...changes}:item));
  const updateEstimate=(clientId,nextValue,nextUnit)=>{
    const item=meetingItems.find(candidate=>candidate.clientId===clientId);
    const value=Math.max(0,Math.min(10000,Number(nextValue)||0));
    const unit=nextUnit||item?.estimateUnit||'hours';
    updateMeetingItem(clientId,{estimatedHours:value||'',estimateUnit:unit,dueAt:value?addEstimateToNow(value,unit):''});
  };
  const addMeetingItem=()=>{
    const previous=meetingItems.at(-1);
    const selectedWorkflow=workflows.find(item=>String(item.id)===String(previous?.workflowId||workflowId))||workflows[0];
    const firstStage=(config?.operationStages||[]).find(stage=>String(stage.workflowId)===String(selectedWorkflow?.id));
    setMeetingItems(items=>[...items,{...emptyTask,clientId:crypto.randomUUID(),workflowId:selectedWorkflow?.id||'',stageId:firstStage?.id||'',dueAt:previous?.dueAt||''}]);
  };
  const endMeeting=async()=>{
    if(!richTextHasContent(meetingNotes)){setMessage({type:'error',text:'Add the meeting notes before saving the MOM'});return;}
    const actionableItems=meetingItems.filter(item=>item.title.trim());
    const incomplete=actionableItems.findIndex(item=>(!item.ownerEmployeeId&&!item.guestOwnerId&&!item.guestOwnerName.trim())||!Number(item.estimatedHours)||!item.dueAt);
    if(incomplete>=0){setMessage({type:'error',text:`Select the owner, estimated duration, and deadline for action item ${incomplete+1}`});return;}
    setSaving(true);
    try{
      const result=await api(`/platform/business-units/${selectedUnit.id}/operations/batch`,{method:'POST',body:JSON.stringify({sessionId:activeMomSession?.id||null,momNotes:meetingNotes,items:actionableItems.map(({clientId,ownerCrmUserId,estimatedHours,estimateUnit,...item})=>({...item,workflowId:Number(item.workflowId),stageId:Number(item.stageId),ownerEmployeeId:Number(item.ownerEmployeeId)||null,guestOwnerId:Number(item.guestOwnerId)||null,minutesSpent:Number(item.minutesSpent||0),values:{...(item.values||{}),estimatedHours:estimateInHours(estimatedHours,estimateUnit),estimatedDuration:Number(estimatedHours)||null,estimatedDurationUnit:estimateUnit}}))})});
      setDialog(null);setMeetingItems([]);setMeetingNotes('');setActiveMomSession(null);setMessage({type:'success',text:result.message});await load();
    }catch(error){setMessage({type:'error',text:error.message});}finally{setSaving(false);}
  };
  const saveTask=async event=>{
    event.preventDefault();setSaving(true);
    try{
      const path=selectedTask?`/platform/business-units/${selectedUnit.id}/operations/${selectedTask.id}`:`/platform/business-units/${selectedUnit.id}/operations`;
      const result=await api(path,{method:selectedTask?'PUT':'POST',body:JSON.stringify({...form,workflowId:Number(form.workflowId),stageId:Number(form.stageId),ownerEmployeeId:Number(form.ownerEmployeeId),minutesSpent:Number(form.minutesSpent||0)})});
      setDialog(null);setSelectedTask(null);setMessage({type:'success',text:result.message});await load();
    }catch(error){setMessage({type:'error',text:error.message});}finally{setSaving(false);}
  };
  const move=async(record,nextStageId)=>{
    try{await api(`/platform/business-units/${selectedUnit.id}/operations/${record.id}/stage`,{method:'PUT',body:JSON.stringify({stageId:Number(nextStageId)})});await load();}
    catch(error){setMessage({type:'error',text:error.message});}
  };
  const openDetails=async record=>{
    try{const result=await api(`/platform/business-units/${selectedUnit.id}/operations/${record.id}`);setSelectedTask(result.data);setDialog('details');}
    catch(error){setMessage({type:'error',text:error.message});}
  };
  const logTime=async event=>{
    event.preventDefault();setSaving(true);
    try{
      const result=await api(`/platform/business-units/${selectedUnit.id}/operations/${selectedTask.id}/time-logs`,{method:'POST',body:JSON.stringify({...timeForm,minutesSpent:Number(timeForm.minutesSpent)})});
      setDialog(null);setSelectedTask(null);setTimeForm({minutesSpent:'',workNote:''});setMessage({type:'success',text:result.message});await load();
    }catch(error){setMessage({type:'error',text:error.message});}finally{setSaving(false);}
  };
  const decide=async event=>{
    event.preventDefault();setSaving(true);
    try{
      const result=await api(`/platform/business-units/${selectedUnit.id}/tracker-approvals/${selectedTask.id}/decision`,{
        method:'PUT',body:JSON.stringify({...decisionForm,documentReferences:decisionForm.documentReferences.split('\n').map(value=>value.trim()).filter(Boolean)}),
      });
      setDialog(null);setSelectedTask(null);setDecisionForm({decision:'approved',remarks:'',documentReferences:''});setMessage({type:'success',text:result.message});await load();
    }catch(error){setMessage({type:'error',text:error.message});}finally{setSaving(false);}
  };

  if(businessUnitLoading||!selectedUnit)return <div className="loading"><span/><p>Loading business unit…</p></div>;

  return <main className="metadata-page operations-page mom-tracker-page">
    <header className="dynamic-module-header">
      <div><span className="eyebrow">{selectedUnit.name}</span><h1>Progress &amp; MOM Tracker</h1><p>Assign action items, record effort, monitor deadlines, and route work for approval.</p></div>
      <div><button className="secondary" onClick={load}><RefreshCw size={16}/>Refresh</button><button className="primary" onClick={openCreate} disabled={!workflows.length}><Plus size={17}/>Start MOM session</button></div>
    </header>
    <Toast message={message} onClose={()=>setMessage(null)}/>
    <nav className="tracker-view-tabs">
      <button className={tab==='tasks'?'active':''} onClick={()=>setTab('tasks')}><ListChecks/>Action items <b>{records.length}</b></button>
      <button className={tab==='mom'?'active':''} onClick={()=>setTab('mom')}><FileText/>MOM records <b>{momSessions.length}</b></button>
      <button className={tab==='approvals'?'active':''} onClick={()=>setTab('approvals')}><ClipboardCheck/>My approvals <b className={pendingApprovals?'attention':''}>{pendingApprovals}</b></button>
    </nav>

    {tab==='tasks'?<>
      <section className="operations-summary tracker-summary">
        <article><Workflow/><span><small>Action items</small><strong>{visible.length}</strong></span></article>
        <article><Timer/><span><small>Time recorded</small><strong>{duration(visible.reduce((sum,item)=>sum+Number(item.minutesSpent||0),0))}</strong></span></article>
        <article className={overdue?'attention':''}><CalendarClock/><span><small>Overdue</small><strong>{overdue}</strong></span></article>
        <article><ClipboardCheck/><span><small>Pending approvals</small><strong>{records.filter(item=>item.approvalStatus==='pending').length}</strong></span></article>
      </section>
      <section className="operations-toolbar">
        <div className="dynamic-search"><Search size={17}/><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search action items…"/></div>
        {workflows.length>1&&<label className="operation-filter-field"><span>Tracker</span><select value={workflowId} onChange={event=>{setWorkflowId(event.target.value);setStageFilter('')}}>{workflows.map(workflow=><option key={workflow.id} value={workflow.id}>{workflow.displayName}</option>)}</select></label>}
        <label className="operation-filter-field"><span>Status</span><select value={stageFilter} onChange={event=>setStageFilter(event.target.value)}><option value="">All statuses</option>{stages.map(stage=><option key={stage.id} value={stage.id}>{stage.displayName}</option>)}</select></label>
        <label className="operation-filter-field"><span>Owner</span><select value={ownerFilter} onChange={event=>setOwnerFilter(event.target.value)}><option value="">All owners</option>{ownerOptions.map(owner=><option key={owner} value={owner}>{owner}</option>)}</select></label>
        <label className="operation-filter-field"><span>Deadline</span><select value={dueFilter} onChange={event=>setDueFilter(event.target.value)}><option value="">All deadlines</option><option value="overdue">Overdue</option><option value="today">Due today</option><option value="upcoming">Upcoming</option><option value="unscheduled">Unscheduled</option></select></label>
        <label className="operation-filter-field"><span>Approval</span><select value={approvalFilter} onChange={event=>setApprovalFilter(event.target.value)}><option value="">All approvals</option><option value="required">Approval required</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="not_required">Not required</option></select></label>
        <div className="tracker-layout-switch" role="group" aria-label="Tracker view">
          <button type="button" className={taskView==='board'?'active':''} onClick={()=>changeTaskView('board')} title="Board view"><Columns3/>Board</button>
          <button type="button" className={taskView==='list'?'active':''} onClick={()=>changeTaskView('list')} title="List view"><ListTree/>List</button>
          <button type="button" className={taskView==='calendar'?'active':''} onClick={()=>changeTaskView('calendar')} title="Calendar view"><CalendarDays/>Calendar</button>
        </div>
      </section>
      {taskView==='board'?<section className="operation-board">
        {boardStages.map(stage=>{
          const stageRecords=visible.filter(record=>record.stageId===stage.id);
          return <article className="operation-column" key={stage.id}>
            <header style={{borderTopColor:stage.color}}><div><strong>{stage.displayName}</strong><span>{stage.stageType.replaceAll('_',' ')}</span></div><b>{stageRecords.length}</b></header>
            <div>{stageRecords.map(record=><section className={`operation-card mom-task-card ${record.dueAt&&new Date(record.dueAt)<new Date()?'overdue':''}`} key={record.id}>
              <div><span>{record.recordNumber}</span><h3>{record.title}</h3><p>{record.description||'No description provided'}</p></div>
              <dl><dt><UserRound/>Owner</dt><dd>{record.owner}</dd><dt><CalendarClock/>Deadline</dt><dd>{record.dueAt?new Date(record.dueAt).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'}):'Not scheduled'}</dd><dt><Clock3/>Estimate</dt><dd>{record.customValues?.estimatedHours?`${record.customValues.estimatedHours}h`:'—'}</dd><dt><Timer/>Recorded</dt><dd>{duration(record.minutesSpent)}</dd></dl>
              {record.approvalRequired&&<span className={`approval-chip ${record.approvalStatus}`}><ClipboardCheck/>{record.approvalStatus.replaceAll('_',' ')}</span>}
              <select aria-label={`Change status for ${record.title}`} value={record.stageId} onChange={event=>move(record,event.target.value)}>{stages.map(item=><option key={item.id} value={item.id}>{item.displayName}</option>)}</select>
              <footer><button title="View details" onClick={()=>openDetails(record)}><FileText/></button><button title="Edit task" onClick={()=>openEdit(record)}><Pencil/></button><button title="Record minutes" onClick={()=>{setSelectedTask(record);setTimeForm({minutesSpent:'',workNote:''});setDialog('time')}}><Timer/></button></footer>
            </section>)}
            {!stageRecords.length&&<div className="operation-column-empty"><Workflow/><span>No action items</span></div>}</div>
          </article>;
        })}
        {!stages.length&&<div className="empty big operations-empty"><Workflow/><strong>No Tracker statuses configured</strong><span>Add statuses from Settings → Business Units → Tracker.</span></div>}
      </section>:taskView==='list'?<section className="tracker-list-view">
        <div className="tracker-list-scroll">
          <table>
            <colgroup><col className="action-item"/><col className="owner"/><col className="status"/><col className="estimate"/><col className="deadline"/><col className="recorded"/><col className="approval"/><col className="actions"/></colgroup>
            <thead><tr><th>Action item</th><th>Owner</th><th>Status</th><th>Estimate</th><th>Deadline</th><th>Recorded</th><th>Approval</th><th>Actions</th></tr></thead>
            <tbody>{visible.map(record=><tr className={record.dueAt&&new Date(record.dueAt)<new Date()?'overdue':''} key={record.id}>
              <td><div className="tracker-list-title"><strong>{record.title}</strong><span>{record.recordNumber}</span></div></td>
              <td>{record.owner}</td>
              <td><select aria-label={`Change status for ${record.title}`} value={record.stageId} onChange={event=>move(record,event.target.value)}>{stages.map(item=><option key={item.id} value={item.id}>{item.displayName}</option>)}</select></td>
              <td>{record.customValues?.estimatedHours?`${record.customValues.estimatedHours}h`:'—'}</td>
              <td>{record.dueAt?new Date(record.dueAt).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'}):'Not scheduled'}</td>
              <td>{duration(record.minutesSpent)}</td>
              <td>{record.approvalRequired?<span className={`approval-chip ${record.approvalStatus}`}><ClipboardCheck/>{record.approvalStatus.replaceAll('_',' ')}</span>:<span className="muted">Not required</span>}</td>
              <td><div className="tracker-list-actions"><button title="View details" onClick={()=>openDetails(record)}><FileText/></button><button title="Edit task" onClick={()=>openEdit(record)}><Pencil/></button><button title="Record minutes" onClick={()=>{setSelectedTask(record);setTimeForm({minutesSpent:'',workNote:''});setDialog('time')}}><Timer/></button></div></td>
            </tr>)}</tbody>
          </table>
          {!visible.length&&<div className="empty big"><ListTree/><strong>No action items found</strong><span>Adjust the search or status filter.</span></div>}
        </div>
      </section>:<section className="tracker-calendar-view">
        <header className="tracker-calendar-toolbar">
          <button type="button" className="secondary" onClick={()=>setCalendarCursor(new Date(new Date().getFullYear(),new Date().getMonth(),1))}>Today</button>
          <div><button type="button" aria-label="Previous month" onClick={()=>setCalendarCursor(date=>new Date(date.getFullYear(),date.getMonth()-1,1))}><ChevronLeft/></button><button type="button" aria-label="Next month" onClick={()=>setCalendarCursor(date=>new Date(date.getFullYear(),date.getMonth()+1,1))}><ChevronRight/></button></div>
          <h2>{calendarCursor.toLocaleDateString('en-IN',{month:'long',year:'numeric'})}</h2>
        </header>
        <div className="tracker-calendar-layout">
          <div className="tracker-calendar-grid">
            {['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map(day=><div className="calendar-weekday" key={day}>{day}</div>)}
            {calendarDays.map(day=>{
              const key=dateKey(day),items=calendarRecords[key]||[],outside=day.getMonth()!==calendarCursor.getMonth(),today=key===dateKey(new Date());
              return <article className={`calendar-day ${outside?'outside':''} ${today?'today':''}`} key={key}>
                <time>{day.getDate()}</time>
                <div>{items.slice(0,3).map(record=><button type="button" key={record.id} style={{'--task-color':stages.find(stage=>stage.id===record.stageId)?.color||'#555ab1'}} onClick={()=>openDetails(record)} title={`${record.title} · ${record.owner}`}><strong>{record.title}</strong><span>{new Date(record.dueAt).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}</span></button>)}{items.length>3&&<em>+{items.length-3} more</em>}</div>
              </article>;
            })}
          </div>
          <aside className="tracker-unscheduled tracker-overdue-panel">
            <header><div><h3>Overdue action items</h3><span>{overdueRecords.length} awaiting completion</span></div></header>
            <div>{overdueRecords.map(record=><button type="button" key={record.id} onClick={()=>openDetails(record)}><strong>{record.title}</strong><span>{record.owner||'Unassigned'}</span><small>Due {new Date(record.dueAt).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'})}</small></button>)}{!overdueRecords.length&&<div className="empty"><CheckCircle2/><strong>Nothing overdue</strong><span>All due action items are completed or still within deadline.</span></div>}</div>
          </aside>
        </div>
      </section>}
    </>:tab==='approvals'?<section className="approval-workspace">
      <header><div><h2>Approval requests</h2><p>Review action items assigned to you. A meaningful explanation is required for every decision.</p></div></header>
      <div className="approval-list">{approvals.map(item=><article className={item.decision==='pending'?'unread':''} key={item.id}>
        <div className="approval-state">{item.decision==='approved'?<CheckCircle2/>:item.decision==='rejected'?<XCircle/>:<CirclePause/>}</div>
        <div><span>{item.recordNumber}</span><h3>{item.title}</h3><p>Owner: {item.owner} · Requested by {item.requestedBy}</p></div>
        <time>{new Date(item.requestedAt).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'})}</time>
        <b className={`approval-chip ${item.decision}`}>{item.decision}</b>
        {item.decision==='pending'?<button className="primary" onClick={()=>{setSelectedTask(item);setDecisionForm({decision:'approved',remarks:'',documentReferences:''});setDialog('decision')}}>Review</button>:<button className="secondary" onClick={()=>{setSelectedTask(item);setDialog('approval-view')}}>View</button>}
      </article>)}{!approvals.length&&<div className="empty big"><ClipboardCheck/><strong>No approval requests</strong><span>Requests assigned to you will appear here.</span></div>}</div>
    </section>:<section className="mom-history-workspace">
      <header><div><h2>Minutes of meeting</h2><p>Discussion notes are retained here whether or not they created an action item.</p></div></header>
      <div className="mom-session-history">{momSessions.map((session,index)=><details key={session.id} open={index===0}>
        <summary><FileText/><span><b>{session.sessionNumber}</b><small>{new Date(session.endedAt).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'})} · {session.createdBy}</small></span><em>{session.points.length} points</em><em>{session.actionItemCount} actions</em></summary>
        <div><article className="mom-document-preview"><FileText/><div><b>Meeting notes</b><div className="mom-rich-preview" dangerouslySetInnerHTML={{__html:sanitizeRichText(session.notes||'No notes recorded')}}/></div></article>{session.points.filter(point=>point.actionItem).map(point=><article key={point.id}><i>{point.position}</i><div><section><b>{point.actionItem}</b><span>{point.owner} · {point.estimatedHours?`${point.estimatedHours}h · `:''}Due {new Date(point.dueAt).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'})}</span><em>{point.recordNumber}</em></section></div></article>)}<footer><button className="secondary" onClick={()=>continueMomSession(session)}><Pencil/>Continue MOM &amp; add actions</button></footer></div>
      </details>)}{!momSessions.length&&<div className="empty big"><FileText/><strong>No MOM records</strong><span>End a MOM session to retain its discussion points here.</span></div>}</div>
    </section>}

    {dialog&&<><div className={`drawer-backdrop ${dialog==='meeting'?'mom-session-backdrop':''}`} onClick={()=>{if(dialog!=='meeting'){setDialog(null);setSelectedTask(null)}}}/>
      {dialog==='meeting'&&<section className="mom-session-workspace">
        <header>
          <div><span className="eyebrow">{selectedUnit.name} · {activeMomSession?'Continuing MOM':'Live meeting'}</span><h2>{activeMomSession?'Continue meeting notes':'Capture MOM and action items'}</h2><p>Maintain one MOM document and add action items only when follow-up work is required.</p></div>
          <div className="mom-session-count"><ListChecks/><span><b>{meetingItems.filter(item=>item.title.trim()).length}</b> new action item{meetingItems.filter(item=>item.title.trim()).length===1?'':'s'}</span></div>
        </header>
        <main>
          <div className="mom-session-intro"><Users/><div><b>{activeMomSession?activeMomSession.sessionNumber:'Continuous capture mode'}</b><span>The MOM remains editable for this session. Saving again appends only the new action items below.</span></div></div>
          <div className="mom-session-notes"><span>Meeting notes / MOM *</span><MomRichTextEditor value={meetingNotes} onChange={setMeetingNotes}/></div>
          {activeMomSession?.points?.some(point=>point.actionItem)&&<section className="mom-existing-actions"><header><b>Already assigned</b><span>These action items will not be created again.</span></header><div>{activeMomSession.points.filter(point=>point.actionItem).map(point=><article key={point.id}><CheckCircle2/><span><b>{point.actionItem}</b><small>{point.owner} · {point.recordNumber}</small></span></article>)}</div></section>}
          <div className="mom-new-actions-title"><div><h3>New action items</h3><p>Add as many follow-up actions as required. Blank rows are ignored.</p></div><button className="secondary" onClick={addMeetingItem}><Plus/>Add action item</button></div>
          <div className="mom-draft-list">
            {meetingItems.map((item,index)=>{
              const ownerValue=item.ownerEmployeeId?`employee:${item.ownerEmployeeId}`:item.guestOwnerId?`guest:${item.guestOwnerId}`:item.ownerCrmUserId?`crm:${item.ownerCrmUserId}`:item.guestOwnerName?'new':'';
              const hasAction=Boolean(item.title.trim());
              return <article className="mom-draft-row" key={item.clientId}>
                <div className="mom-draft-number">{index+1}</div>
                <div className="mom-draft-fields">
                  <label className="mom-action-field">Action item<input value={item.title} onChange={event=>updateMeetingItem(item.clientId,{title:event.target.value})} placeholder="What must be completed? Leave blank to ignore this row"/></label>
                  {hasAction&&<><label>Owner *<select value={ownerValue} onChange={event=>{
                    const [type,id]=event.target.value.split(':'),crmUser=type==='crm'?users.find(user=>String(user.userId)===id):null;
                    updateMeetingItem(item.clientId,{ownerEmployeeId:type==='employee'?id:'',guestOwnerId:type==='guest'?id:'',ownerCrmUserId:type==='crm'?id:'',guestOwnerName:type==='new'?' ':crmUser?.name||''});
                  }}><option value="">Select owner</option><optgroup label="CRM users">{users.map(user=><option key={user.userId} value={user.employeeId?`employee:${user.employeeId}`:`crm:${user.userId}`}>{user.name}</option>)}</optgroup>{guestOwners.length&&<optgroup label="Other participants">{guestOwners.map(owner=><option key={owner.id} value={`guest:${owner.id}`}>{owner.name}</option>)}</optgroup>}<option value="new">+ Add a new owner name</option></select></label>
                  <label className="mom-estimate-field">Estimated duration *<div className="estimate-control"><div className="number-stepper"><button type="button" disabled={Number(item.estimatedHours||0)<=1} onClick={()=>updateEstimate(item.clientId,Number(item.estimatedHours||1)-1,item.estimateUnit)}><Minus/></button><input type="number" min="1" max="10000" step="1" value={item.estimatedHours} onChange={event=>updateEstimate(item.clientId,event.target.value,item.estimateUnit)} placeholder="1"/><button type="button" onClick={()=>updateEstimate(item.clientId,Number(item.estimatedHours||0)+1,item.estimateUnit)}><Plus/></button></div><select aria-label="Estimated duration unit" value={item.estimateUnit||'hours'} onChange={event=>updateEstimate(item.clientId,item.estimatedHours,event.target.value)}><option value="hours">Hours</option><option value="days">Days</option><option value="weeks">Weeks</option><option value="months">Months</option></select></div></label>
                  <label>Deadline *<input type="datetime-local" value={item.dueAt} onChange={event=>updateMeetingItem(item.clientId,{dueAt:event.target.value})}/></label>
                  {ownerValue==='new'&&<label className="mom-guest-name">New owner name *<input autoFocus value={item.guestOwnerName.trimStart()} onChange={event=>updateMeetingItem(item.clientId,{guestOwnerName:event.target.value})} placeholder="Enter name only"/></label>}
                  <div className="mom-more-fields mom-approval-config">
                    <label className="approval-toggle"><input type="checkbox" checked={item.approvalRequired} onChange={event=>updateMeetingItem(item.clientId,{approvalRequired:event.target.checked,approverUserIds:event.target.checked?item.approverUserIds:[]})}/><span><b>Approval needed</b><small>Request approval before this action is closed.</small></span></label>
                    {item.approvalRequired&&<div className="approver-select-field"><span>Approvers *</span><MultiSearchSelect label="Approvers" value={item.approverUserIds.map(String)} onChange={values=>updateMeetingItem(item.clientId,{approverUserIds:values.map(Number)})} options={users.map(user=>({value:String(user.userId),label:user.name}))}/><small>Search and add one or more CRM users.</small></div>}
                  </div></>}
                </div>
                <button className="mom-remove-draft" title="Remove point" disabled={meetingItems.length===1} onClick={()=>setMeetingItems(items=>items.filter(candidate=>candidate.clientId!==item.clientId))}><Trash2/></button>
              </article>;
            })}
          </div>
          <button className="mom-add-point" onClick={addMeetingItem}><Plus/>Add another action item</button>
        </main>
        <footer><button className="secondary" onClick={()=>{setDialog(null);setMeetingItems([]);setMeetingNotes('');setActiveMomSession(null)}}>{activeMomSession?'Close without saving':'Discard session'}</button><span>Only newly entered action items will be assigned.</span><button className="primary" disabled={saving} onClick={endMeeting}><Send/>{saving?'Saving MOM…':activeMomSession?'Update MOM & add actions':'End meeting & save MOM'}</button></footer>
      </section>}
      {dialog==='task'&&<section className="metadata-dialog tracker-task-dialog"><header><div><span className="eyebrow">{selectedUnit.name}</span><h2>{selectedTask?'Edit':'Add'} action item</h2></div><button className="icon-btn" onClick={()=>{setDialog(null);setSelectedTask(null)}}><X/></button></header>
        <form onSubmit={saveTask}><div className="tracker-form-grid">
          <label className="wide">Action item *<input required value={form.title} onChange={event=>setForm({...form,title:event.target.value})} placeholder="What must be completed?"/></label>
          <label className="wide">Description / MOM notes<textarea rows="4" value={form.description} onChange={event=>setForm({...form,description:event.target.value})} placeholder="Context, expected result, dependencies, or meeting decision…"/></label>
          <label>Tracker *<select required disabled={Boolean(selectedTask)} value={form.workflowId} onChange={event=>{const id=Number(event.target.value),first=(config.operationStages||[]).find(stage=>stage.workflowId===id);setForm({...form,workflowId:id,stageId:first?.id||''})}}>{workflows.map(item=><option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
          <label>Status *<select required value={form.stageId} onChange={event=>setForm({...form,stageId:Number(event.target.value)})}>{(config.operationStages||[]).filter(stage=>String(stage.workflowId)===String(form.workflowId)).map(item=><option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
          <label>Owner *<select required value={form.ownerEmployeeId?`employee:${form.ownerEmployeeId}`:form.guestOwnerId?`guest:${form.guestOwnerId}`:form.ownerCrmUserId?`crm:${form.ownerCrmUserId}`:form.guestOwnerName?'new':''} onChange={event=>{const [type,id]=event.target.value.split(':'),crmUser=type==='crm'?users.find(user=>String(user.userId)===id):null;setForm({...form,ownerEmployeeId:type==='employee'?id:'',guestOwnerId:type==='guest'?id:'',ownerCrmUserId:type==='crm'?id:'',guestOwnerName:type==='new'?' ':crmUser?.name||''})}}><option value="">Select owner</option><optgroup label="CRM users">{users.map(item=><option key={item.userId} value={item.employeeId?`employee:${item.employeeId}`:`crm:${item.userId}`}>{item.name}</option>)}</optgroup>{guestOwners.length&&<optgroup label="Other participants">{guestOwners.map(item=><option key={item.id} value={`guest:${item.id}`}>{item.name}</option>)}</optgroup>}<option value="new">+ Add a new owner name</option></select></label>
          {form.guestOwnerName&&!form.ownerCrmUserId&&<label>New owner name *<input required value={form.guestOwnerName.trimStart()} onChange={event=>setForm({...form,guestOwnerName:event.target.value})}/></label>}
          <label>Deadline *<input required type="datetime-local" value={form.dueAt} onChange={event=>setForm({...form,dueAt:event.target.value})}/></label>
          {!selectedTask&&<><label>Initial minutes<input min="0" type="number" value={form.minutesSpent} onChange={event=>setForm({...form,minutesSpent:event.target.value})}/></label><label>Initial work note<input value={form.timeNote} onChange={event=>setForm({...form,timeNote:event.target.value})} placeholder="Optional time-entry note"/></label></>}
          {!selectedTask&&<label className="wide approval-needed"><input type="checkbox" checked={form.approvalRequired} onChange={event=>setForm({...form,approvalRequired:event.target.checked,approverUserIds:event.target.checked?form.approverUserIds:[]})}/><span><b>Approval needed</b><small>Selected approvers will receive this action item in My approvals.</small></span></label>}
          {!selectedTask&&form.approvalRequired&&<div className="wide approver-select-field"><span>Approval required from *</span><MultiSearchSelect label="Approvers" value={form.approverUserIds.map(String)} onChange={values=>setForm({...form,approverUserIds:values.map(Number)})} options={users.map(item=>({value:String(item.userId),label:item.name}))}/><small>Search and add one or more CRM users.</small></div>}
        </div><footer><button type="button" className="secondary" onClick={()=>{setDialog(null);setSelectedTask(null)}}>Cancel</button><button className="primary" disabled={saving}>{saving?'Saving…':selectedTask?'Update action item':'Create action item'}</button></footer></form>
      </section>}
      {dialog==='time'&&<section className="metadata-dialog compact-dialog"><header><div><span className="eyebrow">Time log</span><h2>Record work minutes</h2><p>{selectedTask.title}</p></div><button className="icon-btn" onClick={()=>setDialog(null)}><X/></button></header><form onSubmit={logTime}><label>Minutes spent *<input autoFocus required min="1" type="number" value={timeForm.minutesSpent} onChange={event=>setTimeForm({...timeForm,minutesSpent:event.target.value})}/></label><label>Work completed *<textarea required minLength="3" rows="4" value={timeForm.workNote} onChange={event=>setTimeForm({...timeForm,workNote:event.target.value})} placeholder="Explain what was worked on…"/></label><footer><button type="button" className="secondary" onClick={()=>setDialog(null)}>Cancel</button><button className="primary" disabled={saving}><Timer/>Record time</button></footer></form></section>}
      {dialog==='details'&&<section className="metadata-dialog tracker-detail-dialog"><header><div><span className="eyebrow">{selectedTask.recordNumber}</span><h2>{selectedTask.title}</h2><p>{selectedTask.description||'No description'}</p></div><button className="icon-btn" onClick={()=>setDialog(null)}><X/></button></header><div className="tracker-detail-body">
        <div className="tracker-detail-stats"><article><UserRound/><span>Owner<b>{selectedTask.owner}</b></span></article><article><Clock3/><span>Estimated time<b>{selectedTask.values?.estimatedHours?`${selectedTask.values.estimatedHours} hours`:'—'}</b></span></article><article><Timer/><span>Time recorded<b>{duration(selectedTask.minutesSpent)}</b></span></article><article><CalendarClock/><span>Deadline<b>{selectedTask.due_at_utc?new Date(selectedTask.due_at_utc).toLocaleString('en-IN'):'—'}</b></span></article><article><ClipboardCheck/><span>Approval<b>{selectedTask.approvalStatus.replaceAll('_',' ')}</b></span></article></div>
        <section><h3>Time log</h3>{selectedTask.timeLogs.length?selectedTask.timeLogs.map(item=><article className="tracker-history-row" key={item.id}><Timer/><div><b>{item.minutesSpent} minutes · {item.loggedBy}</b><p>{item.workNote}</p></div><time>{new Date(item.createdAt).toLocaleString('en-IN')}</time></article>):<p className="muted">No time recorded.</p>}</section>
        {selectedTask.approvalRequired&&<section><h3>Approval trail</h3>{selectedTask.approvals.map(item=><article className="tracker-history-row" key={item.id}><ClipboardCheck/><div><b>{item.approver} · {item.decision}</b><p>{item.remarks||'Awaiting decision'}</p>{item.documentReferences.map(reference=><a key={reference} href={reference} target="_blank" rel="noreferrer">{reference}</a>)}</div><time>{item.decidedAt?new Date(item.decidedAt).toLocaleString('en-IN'):'Pending'}</time></article>)}</section>}
      </div></section>}
      {dialog==='decision'&&<section className="metadata-dialog compact-dialog"><header><div><span className="eyebrow">Approval decision</span><h2>{selectedTask.title}</h2><p>{selectedTask.recordNumber} · Owner {selectedTask.owner}</p></div><button className="icon-btn" onClick={()=>setDialog(null)}><X/></button></header><form onSubmit={decide}><label>Decision *<select value={decisionForm.decision} onChange={event=>setDecisionForm({...decisionForm,decision:event.target.value})}><option value="approved">Approve</option><option value="rejected">Reject</option></select></label><label>Explanation *<textarea autoFocus required minLength="10" rows="5" value={decisionForm.remarks} onChange={event=>setDecisionForm({...decisionForm,remarks:event.target.value})} placeholder="Explain the basis for this decision (minimum 10 characters)…"/></label><label>Document references<small>One public URL or document reference per line.</small><textarea rows="3" value={decisionForm.documentReferences} onChange={event=>setDecisionForm({...decisionForm,documentReferences:event.target.value})} placeholder="https://…&#10;Document ID / file path"/></label><footer><button type="button" className="secondary" onClick={()=>setDialog(null)}>Cancel</button><button className={decisionForm.decision==='approved'?'primary':'danger'} disabled={saving}>{decisionForm.decision==='approved'?<CheckCircle2/>:<XCircle/>}{saving?'Submitting…':decisionForm.decision==='approved'?'Approve':'Reject'}</button></footer></form></section>}
      {dialog==='approval-view'&&<section className="metadata-dialog compact-dialog"><header><div><span className="eyebrow">Approval record</span><h2>{selectedTask.title}</h2></div><button className="icon-btn" onClick={()=>setDialog(null)}><X/></button></header><div className="approval-readonly"><b className={`approval-chip ${selectedTask.decision}`}>{selectedTask.decision}</b><h3>Explanation</h3><p>{selectedTask.remarks}</p><h3>Document references</h3>{selectedTask.documentReferences?.length?selectedTask.documentReferences.map(item=><a key={item} href={item} target="_blank" rel="noreferrer">{item}</a>):<p>No documents referenced.</p>}</div></section>}
    </>}
  </main>;
}
