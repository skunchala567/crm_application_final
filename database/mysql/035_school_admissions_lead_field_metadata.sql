-- Register existing School Admissions lead columns in the metadata layer.
-- Legacy crm_leads columns remain authoritative for backward compatibility.
USE attendance_biometric;
SET NAMES utf8mb4;

INSERT INTO crm_metadata_fields
  (business_unit_id,module_key,field_key,display_name,field_type,placeholder,help_text,
   options_json,is_system,is_required,is_filterable,is_searchable,show_in_list,position,column_width,is_active)
SELECT bu.id,'leads',seed.field_key,seed.display_name,seed.field_type,seed.placeholder,seed.help_text,
       NULL,TRUE,seed.is_required,seed.is_filterable,seed.is_searchable,seed.show_in_list,
       seed.position,seed.column_width,TRUE
FROM crm_business_units bu
JOIN (
  SELECT 'student_name' field_key,'Student name' display_name,'text' field_type,'Enter student name' placeholder,'Primary name used for the admission enquiry' help_text,TRUE is_required,TRUE is_filterable,TRUE is_searchable,TRUE show_in_list,1 position,220 column_width
  UNION ALL SELECT 'phone','Primary phone','phone','Enter mobile number','Primary contact number',TRUE,TRUE,TRUE,TRUE,2,150
  UNION ALL SELECT 'alternate_phone','Alternate phone','phone','Enter alternate number','Optional alternate contact number',FALSE,FALSE,TRUE,FALSE,3,150
  UNION ALL SELECT 'email','Email','email','Enter email address','Lead contact email',FALSE,FALSE,TRUE,FALSE,4,220
  UNION ALL SELECT 'parent_name','Parent name','text','Enter parent name','Parent or guardian name',FALSE,TRUE,TRUE,FALSE,5,200
  UNION ALL SELECT 'city','City','text','Enter city','Lead city',FALSE,TRUE,TRUE,FALSE,6,150
  UNION ALL SELECT 'academic_year','Academic year','single_select','Select academic year','Academic year for this enquiry',TRUE,TRUE,FALSE,FALSE,7,150
  UNION ALL SELECT 'branch_id','Branch','single_select','Select branch','Destination school branch',TRUE,TRUE,FALSE,TRUE,8,170
  UNION ALL SELECT 'admission_type_id','Admission type','single_select','Select admission type','Configured admission type',FALSE,TRUE,FALSE,FALSE,9,170
  UNION ALL SELECT 'curriculum_id','Curriculum','single_select','Select curriculum','Configured curriculum',TRUE,TRUE,FALSE,FALSE,10,160
  UNION ALL SELECT 'class_id','Class','single_select','Select class','Applying class',TRUE,TRUE,FALSE,TRUE,11,170
  UNION ALL SELECT 'channel_id','Channel','single_select','Select channel','Lead acquisition channel',FALSE,TRUE,FALSE,FALSE,12,150
  UNION ALL SELECT 'source_id','Source','single_select','Select source','Lead acquisition source',FALSE,TRUE,FALSE,TRUE,13,160
  UNION ALL SELECT 'campaign_id','Campaign','single_select','Select campaign','Lead acquisition campaign',FALSE,TRUE,FALSE,FALSE,14,170
  UNION ALL SELECT 'stage_id','Stage','single_select','Select stage','Current lead pipeline stage',TRUE,TRUE,FALSE,TRUE,15,150
  UNION ALL SELECT 'substage_id','Sub-stage','single_select','Select sub-stage','Current lead pipeline sub-stage',TRUE,TRUE,FALSE,FALSE,16,160
  UNION ALL SELECT 'owner_employee_id','Lead owner','user','Select owner','Employee responsible for this lead',FALSE,TRUE,FALSE,TRUE,17,200
  UNION ALL SELECT 'next_followup_at_utc','Next follow-up','datetime','Select follow-up date','Next scheduled follow-up',FALSE,TRUE,FALSE,TRUE,18,190
  UNION ALL SELECT 'followup_type','Follow-up type','single_select','Select follow-up type','Planned follow-up communication type',FALSE,TRUE,FALSE,FALSE,19,160
  UNION ALL SELECT 'remarks','Remarks','textarea','Enter remarks','Admission enquiry notes',FALSE,TRUE,TRUE,FALSE,20,260
  UNION ALL SELECT 'lead_score','Lead score','number','Enter lead score','Lead qualification score',FALSE,TRUE,FALSE,FALSE,21,120
) seed
WHERE bu.unit_code='school_admissions'
ON DUPLICATE KEY UPDATE is_system=TRUE;
