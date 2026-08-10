import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Building2, ChevronDown, GraduationCap } from 'lucide-react';
import { api } from './api';
import { applyBrandTheme, DEFAULT_BRAND_COLOR } from './brand-theme.js';

const BusinessUnitContext = createContext(null);

export function BusinessUnitProvider({ children }) {
  const [units,setUnits]=useState([]);
  const [loading,setLoading]=useState(true);
  const [selectedId,setSelectedId]=useState(()=>Number(localStorage.getItem('crm_business_unit_id'))||null);

  const refresh=async()=>{
    try{
      const result=await api('/platform/business-units');
      const available=result.data||[];
      setUnits(available);
      const selected=available.find(unit=>unit.id===selectedId)
        || available.find(unit=>unit.isDefault)
        || available[0];
      if(selected){
        setSelectedId(selected.id);
        localStorage.setItem('crm_business_unit_id',String(selected.id));
      }
    }finally{setLoading(false);}
  };
  useEffect(()=>{refresh();},[]);

  const selectUnit=id=>{
    const numeric=Number(id);
    setSelectedId(numeric);
    localStorage.setItem('crm_business_unit_id',String(numeric));
    window.dispatchEvent(new CustomEvent('crm:business-unit-changed',{detail:{businessUnitId:numeric}}));
  };
  const selectedUnit=units.find(unit=>unit.id===selectedId)||null;

  // The unit's colour drives the whole design system, not just its own badge:
  // applyBrandTheme regenerates --brand-*, --ink-* and the surface tokens that
  // every sheet reads. Falling back to the default keeps a unit with no colour
  // set from inheriting the previous unit's palette.
  useEffect(()=>{
    if(loading&&!selectedUnit)return;
    applyBrandTheme(selectedUnit?.color||DEFAULT_BRAND_COLOR);
  },[selectedUnit?.color,loading]);

  const value=useMemo(()=>({units,selectedUnit,selectedId,selectUnit,refresh,loading}),[units,selectedUnit,selectedId,loading]);
  return <BusinessUnitContext.Provider value={value}>{children}</BusinessUnitContext.Provider>;
}

export function useBusinessUnit(){
  const value=useContext(BusinessUnitContext);
  if(!value)throw new Error('useBusinessUnit must be used inside BusinessUnitProvider');
  return value;
}

export function BusinessUnitSelector({ compact=false }){
  const {units,selectedId,selectUnit,loading}=useBusinessUnit();
  const selected=units.find(unit=>unit.id===selectedId);
  // Nothing to choose between: a picker offering one option, or none, is a
  // control that cannot do anything. Hidden rather than disabled so the
  // sidebar does not carry a dead row.
  if(!loading && units.length<=1) return null;
  const Icon=selected?.compatibilityMode==='legacy_school'?GraduationCap:Building2;
  return (
    <label className={`business-unit-selector ${compact?'compact':''}`} title="Active business unit">
      <Icon size={17}/>
      <span>{loading?'Loading…':selected?.name||'Business unit'}</span>
      <select value={selectedId||''} onChange={event=>selectUnit(event.target.value)} aria-label="Select business unit">
        {units.map(unit=><option key={unit.id} value={unit.id}>{unit.name}</option>)}
      </select>
      <ChevronDown size={14}/>
    </label>
  );
}
