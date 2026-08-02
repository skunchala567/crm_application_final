import express from 'express';

const parseJson = (value, fallback = {}) => {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
};
const slug = value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 80);
const text = (value, max = 255) => String(value || '').trim().slice(0, max) || null;
const richText = (value, max = 50000) => {
  const cleaned=String(value||'')
    .replace(/<!--[\s\S]*?-->/g,'')
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi,'')
    .replace(/<(?!\/?(?:p|br|strong|b|em|i|u|ul|ol|li|div)\b)[^>]*>/gi,'')
    .replace(/<(p|br|strong|b|em|i|u|ul|ol|li|div)\b[^>]*>/gi,'<$1>')
    .trim()
    .slice(0,max);
  return cleaned.replace(/<[^>]*>/g,'').replace(/&nbsp;/gi,' ').trim()?cleaned:null;
};
const isAdmin = user => (user.roles || []).some(role => ['ADMIN','CRM_ADMIN'].includes(String(role).toUpperCase()));

export function createBusinessPlatformRoutes(pool, authenticate, requireCrmAccess, requireUserAdmin) {
  const router = express.Router();
  router.use(authenticate, requireCrmAccess);

  async function accessibleUnit(req, unitId, manage = false) {
    if (isAdmin(req.user)) {
      const [[unit]] = await pool.execute(`SELECT * FROM crm_business_units WHERE id=? AND is_active=TRUE`, [unitId]);
      return unit;
    }
    const [[unit]] = await pool.execute(
      `SELECT bu.*,ubu.access_level AS accessLevel
       FROM crm_business_units bu
       JOIN crm_user_business_units ubu ON ubu.business_unit_id=bu.id AND ubu.user_id=?
       WHERE bu.id=? AND bu.is_active=TRUE`,
      [Number(req.user.id), unitId],
    );
    if (manage && !['admin','manage','contribute'].includes(unit?.accessLevel)) return null;
    return unit;
  }

  router.get('/business-units', async (req,res)=>{
    const admin=isAdmin(req.user);
    const [rows]=admin
      ? await pool.query(
        `SELECT bu.*,COUNT(DISTINCT dl.id) AS dynamicLeadCount,COUNT(DISTINCT l.id) AS legacyLeadCount
         FROM crm_business_units bu
         LEFT JOIN crm_dynamic_leads dl ON dl.business_unit_id=bu.id AND dl.deleted_at_utc IS NULL
         LEFT JOIN crm_leads l ON l.business_unit_id=bu.id AND l.deleted_at_utc IS NULL
         GROUP BY bu.id ORDER BY bu.is_default DESC,bu.display_name`,
      )
      : await pool.execute(
        `SELECT bu.*,ubu.access_level AS accessLevel,0 AS dynamicLeadCount,0 AS legacyLeadCount
         FROM crm_business_units bu JOIN crm_user_business_units ubu ON ubu.business_unit_id=bu.id
         WHERE ubu.user_id=? AND bu.is_active=TRUE ORDER BY ubu.is_default DESC,bu.is_default DESC,bu.display_name`,
        [Number(req.user.id)],
      );
    res.json({data:rows.map(row=>({
      id:Number(row.id),code:row.unit_code,name:row.display_name,industryType:row.industry_type,
      description:row.description,iconKey:row.icon_key,color:row.color_code,
      compatibilityMode:row.compatibility_mode,isDefault:Boolean(row.is_default),isActive:Boolean(row.is_active),
      accessLevel:row.accessLevel||'admin',leadCount:Number(row.dynamicLeadCount||0)+Number(row.legacyLeadCount||0),
    }))});
  });

  router.post('/business-units', requireUserAdmin, async (req,res)=>{
    const name=text(req.body.name,150),code=slug(req.body.code||name);
    if(!name||!code)return res.status(400).json({message:'Business unit name is required'});
    const connection=await pool.getConnection();
    try{
      await connection.beginTransaction();
      const [result]=await connection.execute(
        `INSERT INTO crm_business_units
         (unit_code,display_name,industry_type,description,icon_key,color_code,compatibility_mode,is_default,is_active,created_by_user_id)
         VALUES (?,?,?,?,?,?,'metadata',FALSE,TRUE,?)`,
        [code,name,text(req.body.industryType,80)||'General',text(req.body.description,500),text(req.body.iconKey,50)||'building',
         /^#[0-9a-f]{6}$/i.test(req.body.color||'')?req.body.color:'#4A4FB1',Number(req.user.id)],
      );
      const unitId=Number(result.insertId);
      await connection.execute(`INSERT INTO crm_user_business_units(user_id,business_unit_id,access_level,is_default) VALUES(?,?,'admin',FALSE)`,[Number(req.user.id),unitId]);
      await connection.execute(
        `INSERT INTO crm_business_modules(business_unit_id,module_key,display_name,module_type,description,position)
         VALUES (?,'leads','Lead Management','leads','Metadata-driven lead tracking',1),
                (?,'operations','Tracker','operations','Business-specific tracker workflows',2)`,
        [unitId,unitId],
      );
      const [channelCategoryResult]=await connection.execute(
        `INSERT INTO crm_business_channel_categories(business_unit_id,category_key,display_name) VALUES(?,'primary','Primary')`,[unitId],
      );
      const [channelResult]=await connection.execute(
        `INSERT INTO crm_business_channels(business_unit_id,category_id,channel_key,display_name) VALUES(?,?,'direct','Direct')`,
        [unitId,Number(channelCategoryResult.insertId)],
      );
      await connection.execute(
        `INSERT INTO crm_business_sources(business_unit_id,channel_id,source_key,display_name) VALUES(?,?,'direct','Direct')`,
        [unitId,Number(channelResult.insertId)],
      );
      const [campaignCategoryResult]=await connection.execute(
        `INSERT INTO crm_business_campaign_categories(business_unit_id,category_key,display_name) VALUES(?,'general','General')`,[unitId],
      );
      await connection.execute(
        `INSERT INTO crm_business_campaigns(business_unit_id,category_id,campaign_key,display_name) VALUES(?,?,'general','General enquiry')`,
        [unitId,Number(campaignCategoryResult.insertId)],
      );
      for(const [key,label,type,required,searchable,position,width] of [
        ['name','Name','text',1,1,1,220],['phone','Phone','phone',0,1,2,150],['email','Email','email',0,1,3,220],
        ['source','Source','single_select',0,0,4,160],['status','Status','single_select',0,0,5,130],
      ]) await connection.execute(
        `INSERT INTO crm_metadata_fields
         (business_unit_id,module_key,field_key,display_name,field_type,options_json,is_system,is_required,is_searchable,position,column_width)
         VALUES (?,'leads',?,?,?,?,TRUE,?,?,?,?)`,
        [unitId,key,label,type,type==='single_select'?JSON.stringify(type==='single_select'&&key==='status'?['Active','Inactive']:[]):null,required,searchable,position,width],
      );
      const [pipelineResult]=await connection.execute(
        `INSERT INTO crm_metadata_pipelines(business_unit_id,pipeline_key,display_name,is_default)
         VALUES (?,'default','Default Pipeline',TRUE)`,[unitId],
      );
      const pipelineId=Number(pipelineResult.insertId);
      for(const [key,label,type,color,position] of [
        ['new','New','open','#555AB1',1],['qualified','Qualified','open','#3B82F6',2],
        ['won','Won','won','#258268',3],['lost','Lost','lost','#B84848',4],
      ]){
        const [stageResult]=await connection.execute(
          `INSERT INTO crm_metadata_pipeline_stages(pipeline_id,stage_key,display_name,stage_type,color_code,position) VALUES(?,?,?,?,?,?)`,
          [pipelineId,key,label,type,color,position],
        );
        await connection.execute(
          `INSERT INTO crm_metadata_pipeline_substages(stage_id,substage_key,display_name,position) VALUES(?,'default',?,1)`,
          [Number(stageResult.insertId),label],
        );
        const [sharedStageResult]=await connection.execute(
          `INSERT INTO crm_lead_stages(business_unit_id,name,display_name,position,color_code,requires_followup)
           VALUES(?,?,?,?,?,FALSE)`,
          [unitId,`bu${unitId}__${key}`,label,position,color],
        );
        await connection.execute(
          `INSERT INTO crm_lead_substages(stage_id,substage_code,display_name,position)
           VALUES(?,?,?,1)`,
          [Number(sharedStageResult.insertId),`bu${unitId}__${key}_pending`,`${label} - Pending`],
        );
      }
      const [workflowResult]=await connection.execute(
        `INSERT INTO crm_operation_workflows(business_unit_id,workflow_key,display_name,entity_label,is_default)
         VALUES (?,'default','Progress & MOM Tracker','Action item',TRUE)`,[unitId],
      );
      const workflowId=Number(workflowResult.insertId);
      for(const [key,label,type,color,position] of [
        ['open','Open','open','#F04420',1],['in_progress','In progress','open','#3327EF',2],
        ['hold','Hold','on_hold','#4A4FB1',3],['completed','Completed','completed','#258268',4],
        ['cancelled','Cancelled','cancelled','#C8DD00',5],
      ]) await connection.execute(
        `INSERT INTO crm_operation_stages(workflow_id,stage_key,display_name,stage_type,color_code,position) VALUES(?,?,?,?,?,?)`,
        [workflowId,key,label,type,color,position],
      );
      await connection.commit();
      res.status(201).json({id:unitId,message:'Business unit created with starter lead and tracker metadata'});
    }catch(error){
      await connection.rollback();
      if(error.code==='ER_DUP_ENTRY')return res.status(409).json({message:'A business unit with this code already exists'});
      throw error;
    }finally{connection.release();}
  });

  router.put('/business-units/:id', requireUserAdmin, async (req,res)=>{
    const unitId=Number(req.params.id),name=text(req.body.name,150);
    if(!name)return res.status(400).json({message:'Business unit name is required'});
    const [result]=await pool.execute(
      `UPDATE crm_business_units SET display_name=?,industry_type=?,description=?,color_code=?,updated_by_user_id=? WHERE id=?`,
      [name,text(req.body.industryType,80)||'General',text(req.body.description,500),
       /^#[0-9a-f]{6}$/i.test(req.body.color||'')?req.body.color:'#4A4FB1',Number(req.user.id),unitId],
    );
    if(!result.affectedRows)return res.status(404).json({message:'Business unit not found'});
    res.json({message:'Business unit updated'});
  });

  router.put('/business-units/:id/status', requireUserAdmin, async (req,res)=>{
    const unitId=Number(req.params.id);
    const [[unit]]=await pool.execute(`SELECT is_default AS isDefault FROM crm_business_units WHERE id=?`,[unitId]);
    if(!unit)return res.status(404).json({message:'Business unit not found'});
    if(unit.isDefault&&!req.body.isActive)return res.status(400).json({message:'The default School Admissions unit cannot be deactivated'});
    await pool.execute(`UPDATE crm_business_units SET is_active=?,updated_by_user_id=? WHERE id=?`,[req.body.isActive?1:0,Number(req.user.id),unitId]);
    res.json({message:`Business unit marked ${req.body.isActive?'active':'inactive'}`});
  });

  router.delete('/business-units/:id', requireUserAdmin, async (req,res)=>{
    const unitId=Number(req.params.id);
    const [[unit]]=await pool.execute(`SELECT id,is_default AS isDefault,display_name AS displayName FROM crm_business_units WHERE id=?`,[unitId]);
    if(!unit)return res.status(404).json({message:'Business unit not found'});
    if(unit.isDefault)return res.status(409).json({message:'The default Business Unit cannot be deleted'});
    const [[usage]]=await pool.execute(
      `SELECT
         (SELECT COUNT(*) FROM crm_leads WHERE business_unit_id=?) AS leads,
         (SELECT COUNT(*) FROM crm_dynamic_leads WHERE business_unit_id=?) AS dynamicLeads,
         (SELECT COUNT(*) FROM crm_operation_records WHERE business_unit_id=?) AS trackerRecords`,
      [unitId,unitId,unitId],
    );
    const linked=Number(usage.leads)+Number(usage.dynamicLeads)+Number(usage.trackerRecords);
    if(linked)return res.status(409).json({message:`Cannot delete ${unit.displayName} because it is linked to ${linked} lead or Tracker record${linked===1?'':'s'}`});
    const connection=await pool.getConnection();
    try{
      await connection.beginTransaction();
      await connection.execute(`DELETE ss FROM crm_lead_substages ss JOIN crm_lead_stages s ON s.id=ss.stage_id WHERE s.business_unit_id=?`,[unitId]);
      await connection.execute(`DELETE FROM crm_lead_stages WHERE business_unit_id=?`,[unitId]);
      await connection.execute(`DELETE FROM crm_business_sources WHERE business_unit_id=?`,[unitId]);
      await connection.execute(`DELETE FROM crm_business_channels WHERE business_unit_id=?`,[unitId]);
      await connection.execute(`DELETE FROM crm_business_channel_categories WHERE business_unit_id=?`,[unitId]);
      await connection.execute(`DELETE FROM crm_business_campaigns WHERE business_unit_id=?`,[unitId]);
      await connection.execute(`DELETE FROM crm_business_campaign_categories WHERE business_unit_id=?`,[unitId]);
      await connection.execute(`DELETE FROM crm_business_units WHERE id=?`,[unitId]);
      await connection.commit();
      res.json({message:'Business unit and its unused configuration deleted'});
    }catch(error){
      await connection.rollback();
      if(error.code==='ER_ROW_IS_REFERENCED_2')return res.status(409).json({message:'This Business Unit still has linked application records and cannot be deleted'});
      throw error;
    }finally{connection.release();}
  });

  router.get('/business-units/:id/config', async (req,res)=>{
    const unitId=Number(req.params.id),unit=await accessibleUnit(req,unitId);
    if(!unit)return res.status(403).json({message:'Business unit access denied'});
    const [branchPaymentColumns]=await pool.execute(
      `SELECT column_name AS columnName FROM information_schema.columns
       WHERE table_schema=DATABASE() AND table_name='branches'
         AND column_name IN ('jodo_payment_enabled','jodo_collector_code','jodo_api_key','application_amount','application_stage_id','application_payment_component')`,
    );
    const hasBranchPaymentColumns=branchPaymentColumns.length>=6;
    const branchSelect=hasBranchPaymentColumns
      ? `SELECT id,branch_name AS name,short_name AS shortName,is_active AS isActive,
                jodo_payment_enabled AS jodoPaymentEnabled,jodo_collector_code AS jodoCollectorCode,
                jodo_api_key AS jodoApiKey,application_amount AS applicationAmount,
                application_stage_id AS applicationStageId,application_payment_component AS applicationPaymentComponent
         FROM branches WHERE is_active=TRUE ORDER BY branch_name`
      : `SELECT id,branch_name AS name,short_name AS shortName,is_active AS isActive,
                0 AS jodoPaymentEnabled,NULL AS jodoCollectorCode,NULL AS jodoApiKey,NULL AS applicationAmount,
                NULL AS applicationStageId,'Payable Amount' AS applicationPaymentComponent
         FROM branches WHERE is_active=TRUE ORDER BY branch_name`;
    const [[fields],[forms],[enquiryForms],[pipelines],[pipelineStages],[workflows],[operationStages],[modules],[branches],[sources],[channels],[campaigns],[employees],[academicYears]]=await Promise.all([
      pool.execute(`SELECT id,field_key AS fieldKey,display_name AS displayName,field_type AS fieldType,placeholder,help_text AS helpText,options_json AS options,validation_json AS validation,is_system AS isSystem,is_required AS isRequired,is_filterable AS isFilterable,filter_control AS filterControl,is_searchable AS isSearchable,is_importable AS isImportable,is_import_required AS isImportRequired,import_header AS importHeader,import_sample_value AS importSampleValue,show_in_list AS showInList,position,column_width AS columnWidth,is_active AS isActive FROM crm_metadata_fields WHERE business_unit_id=? ORDER BY module_key,position`,[unitId]),
      pool.execute(`SELECT id,form_key AS formKey,display_name AS displayName,form_type AS formType,sections_json AS sections,is_default AS isDefault,is_active AS isActive FROM crm_metadata_forms WHERE business_unit_id=? ORDER BY display_name`,[unitId]),
      pool.execute(`SELECT id,form_key AS formKey,display_name AS displayName,description,default_branch_id AS defaultBranchId,default_stage_id AS defaultStageId,default_substage_id AS defaultSubstageId,default_source_id AS defaultSourceId,default_channel_id AS defaultChannelId,default_campaign_id AS defaultCampaignId,default_owner_employee_id AS defaultOwnerEmployeeId,field_schema_json AS fieldSchema,settings_json AS settings,success_message AS successMessage,redirect_url AS redirectUrl,is_active AS isActive FROM crm_public_enquiry_forms WHERE business_unit_id=? ORDER BY display_name`,[unitId]),
      pool.execute(`SELECT id,pipeline_key AS pipelineKey,display_name AS displayName,description,entity_label_singular AS entityLabelSingular,entity_label_plural AS entityLabelPlural,is_default AS isDefault,is_active AS isActive FROM crm_metadata_pipelines WHERE business_unit_id=? ORDER BY is_default DESC,display_name`,[unitId]),
      pool.execute(`SELECT ps.id,ps.pipeline_id AS pipelineId,ps.stage_key AS stageKey,ps.display_name AS displayName,ps.stage_type AS stageType,ps.color_code AS color,ps.position,ps.is_active AS isActive FROM crm_metadata_pipeline_stages ps JOIN crm_metadata_pipelines p ON p.id=ps.pipeline_id WHERE p.business_unit_id=? ORDER BY ps.pipeline_id,ps.position`,[unitId]),
      pool.execute(`SELECT id,workflow_key AS workflowKey,display_name AS displayName,entity_label AS entityLabel,description,form_schema_json AS formSchema,is_default AS isDefault,is_active AS isActive FROM crm_operation_workflows WHERE business_unit_id=? ORDER BY is_default DESC,display_name`,[unitId]),
      pool.execute(`SELECT os.id,os.workflow_id AS workflowId,os.stage_key AS stageKey,os.display_name AS displayName,os.stage_type AS stageType,os.color_code AS color,os.position,os.checklist_json AS checklist,os.is_active AS isActive FROM crm_operation_stages os JOIN crm_operation_workflows ow ON ow.id=os.workflow_id WHERE ow.business_unit_id=? ORDER BY os.workflow_id,os.position`,[unitId]),
      pool.execute(`SELECT id,module_key AS moduleKey,display_name AS displayName,module_type AS moduleType,description,layout_json AS layout,settings_json AS settings,position,is_active AS isActive FROM crm_business_modules WHERE business_unit_id=? ORDER BY position`,[unitId]),
      pool.query(branchSelect),
      pool.query(`SELECT id,display_name AS displayName FROM crm_lead_sources WHERE is_active=TRUE ORDER BY display_name`),
      pool.query(`SELECT id,display_name AS displayName FROM crm_lead_channels WHERE is_active=TRUE ORDER BY display_name`),
      pool.query(`SELECT id,display_name AS displayName FROM crm_campaigns WHERE is_active=TRUE ORDER BY display_name`),
      pool.execute(
        `SELECT DISTINCT e.id, u.id AS userId,
                COALESCE(e.employee_name,CONCAT_WS(' ',p.first_name,p.last_name),u.email) AS name,
                u.email
         FROM app_users u
         JOIN employees e ON e.id=u.employee_id
         LEFT JOIN crm_user_profiles p ON p.user_id=u.id
         LEFT JOIN crm_user_business_units ubu ON ubu.user_id=u.id AND ubu.business_unit_id=?
         WHERE u.is_active=TRUE
           AND e.status='Active'
           AND (ubu.user_id IS NOT NULL OR EXISTS(
             SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id
             WHERE ur.user_id=u.id AND r.normalized_name IN ('ADMIN','CRM_ADMIN')
           ))
         ORDER BY name
         LIMIT 1000`,
        [unitId],
      ),
      pool.query(`SELECT academic_year AS academicYear,display_name AS displayName FROM crm_academic_years WHERE is_active=TRUE ORDER BY academic_year DESC`),
    ]);
    const normalize=rows=>rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[
      key,['options','sections','formSchema','fieldSchema','checklist','layout','settings','validation'].includes(key)?parseJson(value,key==='options'?[]:{}):value,
    ])));
    let resolvedPipelines=normalize(pipelines);
    let resolvedPipelineStages=normalize(pipelineStages);
    let leadSubstages=[];
    if(unit){
      const [[legacyStages],[legacySubstages]]=await Promise.all([
        pool.execute(`SELECT id,name AS stageKey,display_name AS displayName,'open' AS stageType,color_code AS color,position,is_active AS isActive,requires_followup AS requiresFollowup FROM crm_lead_stages WHERE business_unit_id=? ORDER BY position,display_name`,[unitId]),
        pool.execute(`SELECT ss.id,ss.stage_id AS stageId,ss.substage_code AS substageKey,ss.display_name AS displayName,ss.position,ss.is_active AS isActive FROM crm_lead_substages ss JOIN crm_lead_stages s ON s.id=ss.stage_id WHERE s.business_unit_id=? ORDER BY s.position,ss.position,ss.display_name`,[unitId]),
      ]);
      resolvedPipelines=[{id:0,pipelineKey:'school_admissions',displayName:'School Admissions',isDefault:true,isActive:true}];
      resolvedPipelineStages=legacyStages.map(row=>({...row,pipelineId:0}));
      leadSubstages=legacySubstages;
    }else{
      const [metadataSubstages]=await pool.execute(
        `SELECT ss.id,ss.stage_id AS stageId,ss.substage_key AS substageKey,ss.display_name AS displayName,ss.position,ss.is_active AS isActive
         FROM crm_metadata_pipeline_substages ss
         JOIN crm_metadata_pipeline_stages ps ON ps.id=ss.stage_id
         JOIN crm_metadata_pipelines p ON p.id=ps.pipeline_id
         WHERE p.business_unit_id=? ORDER BY ps.position,ss.position,ss.display_name`,[unitId],
      );
      leadSubstages=metadataSubstages;
    }
    res.json({unit:{
      id:Number(unit.id),code:unit.unit_code,name:unit.display_name,industryType:unit.industry_type,
      compatibilityMode:unit.compatibility_mode,color:unit.color_code,
    },fields:normalize(fields),forms:normalize(forms),pipelines:resolvedPipelines,pipelineStages:resolvedPipelineStages,
    leadSubstages:normalize(leadSubstages),enquiryForms:normalize(enquiryForms),branches:normalize(branches),sources:normalize(sources),channels:normalize(channels),campaigns:normalize(campaigns),employees:normalize(employees),academicYears:normalize(academicYears),workflows:normalize(workflows),operationStages:normalize(operationStages),modules:normalize(modules)});
  });

  router.get('/business-units/:id/database-tables', requireUserAdmin, async (req,res)=>{
    const unitId=Number(req.params.id),unit=await accessibleUnit(req,unitId,true);
    if(!unit)return res.status(403).json({message:'Business unit access denied'});
    const [tables]=await pool.execute(
      `SELECT c.table_name AS tableName
       FROM information_schema.columns c
       WHERE c.table_schema=DATABASE()
         AND c.column_name='business_unit_id'
         AND (c.table_name LIKE 'crm\\_%' OR c.table_name LIKE 'business\\_%')
       GROUP BY c.table_name
       ORDER BY c.table_name`,
    );
    const escapeIdentifier=name=>`\`${String(name).replace(/`/g,'``')}\``;
    const data=[];
    for(const table of tables){
      const tableName=table.tableName;
      const [columnRows]=await pool.execute(
        `SELECT column_name AS columnName
         FROM information_schema.columns
         WHERE table_schema=DATABASE() AND table_name=?
         ORDER BY ordinal_position`,
        [tableName],
      );
      const columns=columnRows.map(row=>row.columnName);
      const orderColumn=['created_at_utc','created_at','createdAt','created_on','inserted_at','updated_at_utc','updated_at','id'].find(column=>columns.includes(column))||columns[0];
      const [[countRow]]=await pool.query(`SELECT COUNT(*) AS count FROM ${escapeIdentifier(tableName)} WHERE business_unit_id=?`,[unitId]);
      const [rows]=await pool.query(`SELECT * FROM ${escapeIdentifier(tableName)} WHERE business_unit_id=? ORDER BY ${escapeIdentifier(orderColumn)} DESC LIMIT 5`,[unitId]);
      data.push({tableName,columns,rowCount:Number(countRow.count||0),rows});
    }
    res.json({businessUnit:{id:unitId,name:unit.display_name||unit.name},tables:data});
  });

  router.post('/business-units/:id/branches', requireUserAdmin, async (req,res)=>{
    const unitId=Number(req.params.id),unit=await accessibleUnit(req,unitId,true);
    if(!unit)return res.status(403).json({message:'Business unit management access required'});
    const [[schema]]=await pool.execute(`SELECT COUNT(*) AS count FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='branches' AND column_name='jodo_payment_enabled'`);
    if(!Number(schema.count))return res.status(400).json({message:'Run database migration 050_branch_jodo_payment_configuration.sql before configuring branch payments'});
    const name=text(req.body.name,150),shortName=text(req.body.shortName,50)||name;
    if(!name)return res.status(400).json({message:'Branch name is required'});
    try{
      const [result]=await pool.execute(
        `INSERT INTO branches
         (branch_name,short_name,is_active,jodo_payment_enabled,jodo_api_key,jodo_secret_key,jodo_collector_code,application_amount,application_stage_id,application_payment_component)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [name,shortName,req.body.isActive===false?0:1,req.body.jodoPaymentEnabled?1:0,text(req.body.jodoApiKey,255),text(req.body.jodoSecretKey,255),text(req.body.jodoCollectorCode,100),req.body.applicationAmount?Number(req.body.applicationAmount):null,req.body.applicationStageId?Number(req.body.applicationStageId):null,text(req.body.applicationPaymentComponent,120)||'Payable Amount'],
      );
      res.status(201).json({id:Number(result.insertId),message:'Branch created'});
    }catch(error){
      if(error.code==='ER_NO_DEFAULT_FOR_FIELD')return res.status(400).json({message:'This branch table has additional required columns. Please create the branch in the master branch setup, then configure payment details here.'});
      throw error;
    }
  });

  router.put('/business-units/:unitId/branches/:id', requireUserAdmin, async (req,res)=>{
    const unitId=Number(req.params.unitId),unit=await accessibleUnit(req,unitId,true);
    if(!unit)return res.status(403).json({message:'Business unit management access required'});
    const [[schema]]=await pool.execute(`SELECT COUNT(*) AS count FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='branches' AND column_name='jodo_payment_enabled'`);
    if(!Number(schema.count))return res.status(400).json({message:'Run database migration 050_branch_jodo_payment_configuration.sql before configuring branch payments'});
    const name=text(req.body.name,150);
    if(!name)return res.status(400).json({message:'Branch name is required'});
    const [result]=await pool.execute(
      `UPDATE branches
       SET branch_name=?,short_name=?,is_active=?,jodo_payment_enabled=?,jodo_api_key=COALESCE(?,jodo_api_key),
           jodo_secret_key=COALESCE(?,jodo_secret_key),jodo_collector_code=?,application_amount=?,
           application_stage_id=?,application_payment_component=?
       WHERE id=?`,
      [name,text(req.body.shortName,50)||name,req.body.isActive===false?0:1,req.body.jodoPaymentEnabled?1:0,text(req.body.jodoApiKey,255),text(req.body.jodoSecretKey,255),text(req.body.jodoCollectorCode,100),req.body.applicationAmount?Number(req.body.applicationAmount):null,req.body.applicationStageId?Number(req.body.applicationStageId):null,text(req.body.applicationPaymentComponent,120)||'Payable Amount',Number(req.params.id)],
    );
    if(!result.affectedRows)return res.status(404).json({message:'Branch not found'});
    res.json({message:'Branch/payment configuration updated'});
  });

  router.post('/business-units/:id/fields', requireUserAdmin, async (req,res)=>{
    const unitId=Number(req.params.id),displayName=text(req.body.displayName,150),fieldKey=slug(req.body.fieldKey||displayName);
    if(!displayName||!fieldKey)return res.status(400).json({message:'Field name is required'});
    const allowedTypes=['text','textarea','number','decimal','date','datetime','email','phone','boolean','single_select','multi_select','user','file'];
    const fieldType=allowedTypes.includes(req.body.fieldType)?req.body.fieldType:'text';
    const [[next]]=await pool.execute(`SELECT COALESCE(MAX(position),0)+1 AS position FROM crm_metadata_fields WHERE business_unit_id=? AND module_key='leads'`,[unitId]);
    try{
      const [result]=await pool.execute(
        `INSERT INTO crm_metadata_fields
         (business_unit_id,module_key,field_key,display_name,field_type,placeholder,help_text,options_json,validation_json,is_required,is_filterable,filter_control,is_searchable,is_importable,is_import_required,import_header,import_sample_value,show_in_list,position,column_width)
         VALUES (?,'leads',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [unitId,fieldKey,displayName,fieldType,text(req.body.placeholder,200),text(req.body.helpText,500),
         JSON.stringify(Array.isArray(req.body.options)?req.body.options:[]),JSON.stringify(req.body.validation&&typeof req.body.validation==='object'?req.body.validation:{}),req.body.isRequired?1:0,req.body.isFilterable===false?0:1,
         text(req.body.filterControl,40)||'contains',req.body.isSearchable?1:0,req.body.isImportable===false?0:1,req.body.isImportRequired?1:0,text(req.body.importHeader,160)||displayName,
         text(req.body.importSampleValue,255),req.body.showInList===false?0:1,Number(next.position),Math.max(100,Math.min(400,Number(req.body.columnWidth)||180))],
      );
      res.status(201).json({id:Number(result.insertId),message:'Custom field added'});
    }catch(error){if(error.code==='ER_DUP_ENTRY')return res.status(409).json({message:'This field key already exists'});throw error;}
  });

  router.put('/business-units/:unitId/fields/:id', requireUserAdmin, async (req,res)=>{
    const [result]=await pool.execute(
      `UPDATE crm_metadata_fields SET display_name=?,placeholder=?,help_text=?,options_json=?,validation_json=?,is_required=?,is_filterable=?,filter_control=?,is_searchable=?,is_importable=?,is_import_required=?,import_header=?,import_sample_value=?,show_in_list=?,column_width=?,is_active=?
       WHERE id=? AND business_unit_id=?`,
      [text(req.body.displayName,150),text(req.body.placeholder,200),text(req.body.helpText,500),JSON.stringify(Array.isArray(req.body.options)?req.body.options:[]),
       JSON.stringify(req.body.validation&&typeof req.body.validation==='object'?req.body.validation:{}),req.body.isRequired?1:0,req.body.isFilterable===false?0:1,text(req.body.filterControl,40)||'contains',req.body.isSearchable?1:0,req.body.isImportable===false?0:1,req.body.isImportRequired?1:0,
       text(req.body.importHeader,160)||text(req.body.displayName,150),text(req.body.importSampleValue,255),req.body.showInList===false?0:1,
       Math.max(100,Math.min(400,Number(req.body.columnWidth)||180)),req.body.isActive===false?0:1,Number(req.params.id),Number(req.params.unitId)],
    );
    if(!result.affectedRows)return res.status(404).json({message:'Field not found'});
    res.json({message:'Field updated'});
  });

  router.delete('/business-units/:unitId/fields/:id', requireUserAdmin, async (req,res)=>{
    const unitId=Number(req.params.unitId),fieldId=Number(req.params.id),unit=await accessibleUnit(req,unitId,true);
    if(!unit)return res.status(403).json({message:'Business unit management access required'});
    const [[field]]=await pool.execute(`SELECT id,field_key AS fieldKey,display_name AS displayName,is_system AS isSystem FROM crm_metadata_fields WHERE id=? AND business_unit_id=?`,[fieldId,unitId]);
    if(!field)return res.status(404).json({message:'Lead field not found'});
    const essentialFields=new Set(['name','student_name','phone','primary_phone','branch_id','stage_id']);
    if(essentialFields.has(field.fieldKey))return res.status(409).json({message:`${field.displayName} is a mandatory application field and cannot be deleted`});
    const jsonPath=`$."${String(field.fieldKey).replace(/["\\]/g,'')}"`;
    const [[dynamicUsage]]=await pool.execute(
      `SELECT COUNT(*) AS count FROM crm_dynamic_leads
       WHERE business_unit_id=? AND JSON_CONTAINS_PATH(custom_values_json,'one',?)`,
      [unitId,jsonPath],
    );
    const sharedColumns=new Map([
      ['alternate_phone','alternate_phone'],['email','email'],['parent_name','parent_name'],['city','city'],
      ['academic_year','academic_year'],['admission_type_id','admission_type_id'],['curriculum_id','curriculum_id'],
      ['class_id','class_id'],['channel_id','channel_id'],['source_id','source_id'],['campaign_id','campaign_id'],
      ['substage_id','substage_id'],['owner_employee_id','owner_employee_id'],['next_followup_at_utc','next_followup_at_utc'],
      ['remarks','remarks'],['lead_score','lead_score'],
    ]);
    let sharedCount=0;
    const column=sharedColumns.get(field.fieldKey);
    if(column){
      const [[usage]]=await pool.execute(
        `SELECT COUNT(*) AS count FROM crm_leads
         WHERE business_unit_id=? AND ${column} IS NOT NULL
           ${['alternate_phone','email','parent_name','city','academic_year','remarks'].includes(column)?`AND TRIM(${column})<>''`:''}`,
        [unitId],
      );
      sharedCount=Number(usage.count);
    }else if(field.fieldKey==='followup_type'){
      const [[usage]]=await pool.execute(
        `SELECT COUNT(*) AS count FROM crm_followups f JOIN crm_leads l ON l.id=f.lead_id WHERE l.business_unit_id=? AND f.followup_type IS NOT NULL`,[unitId],
      );
      sharedCount=Number(usage.count);
    }
    const linkedCount=Number(dynamicUsage.count)+sharedCount;
    if(linkedCount>0)return res.status(409).json({message:`Cannot delete ${field.displayName} because ${linkedCount} lead${linkedCount===1?' contains':'s contain'} a value for it`});
    const connection=await pool.getConnection();
    try{
      await connection.beginTransaction();
      const [forms]=await connection.execute(`SELECT id,sections_json AS sections FROM crm_metadata_forms WHERE business_unit_id=?`,[unitId]);
      const removeField=value=>{
        if(Array.isArray(value))return value.filter(item=>item!==field.fieldKey).map(removeField);
        if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key,val])=>key!==field.fieldKey&&val!==field.fieldKey).map(([key,val])=>[key,removeField(val)]));
        return value;
      };
      for(const form of forms){
        const sections=removeField(parseJson(form.sections,[]));
        await connection.execute(`UPDATE crm_metadata_forms SET sections_json=? WHERE id=?`,[JSON.stringify(sections),form.id]);
      }
      await connection.execute(`DELETE FROM crm_metadata_fields WHERE id=? AND business_unit_id=?`,[fieldId,unitId]);
      await connection.commit();
      res.json({message:'Lead field deleted from this Business Unit'});
    }catch(error){await connection.rollback();throw error;}finally{connection.release();}
  });

  const enquiryPayload=req=>{
    const fields=Array.isArray(req.body.fields)?req.body.fields.filter(field=>field&&field.fieldKey).map((field,index)=>({
      fieldKey:String(field.fieldKey).slice(0,80),
      label:text(field.label,150),
      required:Boolean(field.required),
      placeholder:text(field.placeholder,200),
      position:Number(field.position)||index+1,
    })):[];
    return {
      displayName:text(req.body.displayName,150),
      description:text(req.body.description,500),
      defaultBranchId:req.body.defaultBranchId?Number(req.body.defaultBranchId):null,
      defaultStageId:req.body.defaultStageId?Number(req.body.defaultStageId):null,
      defaultSubstageId:req.body.defaultSubstageId?Number(req.body.defaultSubstageId):null,
      defaultSourceId:req.body.defaultSourceId?Number(req.body.defaultSourceId):null,
      defaultChannelId:req.body.defaultChannelId?Number(req.body.defaultChannelId):null,
      defaultCampaignId:req.body.defaultCampaignId?Number(req.body.defaultCampaignId):null,
      defaultOwnerEmployeeId:req.body.defaultOwnerEmployeeId?Number(req.body.defaultOwnerEmployeeId):null,
      fields,
      settings:{...(req.body.settings&&typeof req.body.settings==='object'?req.body.settings:{}),defaultAcademicYear:text(req.body.settings?.defaultAcademicYear||req.body.defaultAcademicYear,20)},
      successMessage:text(req.body.successMessage,500)||'Thank you. Your enquiry has been submitted.',
      redirectUrl:text(req.body.redirectUrl,500),
      isActive:req.body.isActive!==false,
    };
  };

  router.post('/business-units/:id/enquiry-forms', requireUserAdmin, async (req,res)=>{
    const unitId=Number(req.params.id),unit=await accessibleUnit(req,unitId,true);
    if(!unit)return res.status(403).json({message:'Business unit management access required'});
    const payload=enquiryPayload(req);
    if(!payload.displayName)return res.status(400).json({message:'Form name is required'});
    if(!payload.defaultBranchId||!payload.defaultStageId)return res.status(400).json({message:'Default branch and stage are required'});
    if(!payload.settings.defaultAcademicYear)return res.status(400).json({message:'Academic year is required for enquiry forms'});
    if(!payload.fields.length)return res.status(400).json({message:'Select at least one field for the enquiry form'});
    const formKey=slug(req.body.formKey||`${unit.unit_code}_${payload.displayName}`)||`enquiry_${Date.now()}`;
    try{
      const [result]=await pool.execute(
        `INSERT INTO crm_public_enquiry_forms
         (business_unit_id,form_key,display_name,description,default_branch_id,default_stage_id,default_substage_id,default_source_id,default_channel_id,default_campaign_id,default_owner_employee_id,field_schema_json,settings_json,success_message,redirect_url,is_active,created_by_user_id,updated_by_user_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [unitId,formKey,payload.displayName,payload.description,payload.defaultBranchId,payload.defaultStageId,payload.defaultSubstageId,payload.defaultSourceId,payload.defaultChannelId,payload.defaultCampaignId,payload.defaultOwnerEmployeeId,JSON.stringify(payload.fields),JSON.stringify(payload.settings),payload.successMessage,payload.redirectUrl,payload.isActive?1:0,Number(req.user.id),Number(req.user.id)],
      );
      res.status(201).json({id:Number(result.insertId),formKey,message:'Enquiry form created'});
    }catch(error){if(error.code==='ER_DUP_ENTRY')return res.status(409).json({message:'This enquiry form key already exists'});throw error;}
  });

  router.put('/business-units/:unitId/enquiry-forms/:id', requireUserAdmin, async (req,res)=>{
    const unitId=Number(req.params.unitId),formId=Number(req.params.id),unit=await accessibleUnit(req,unitId,true);
    if(!unit)return res.status(403).json({message:'Business unit management access required'});
    const payload=enquiryPayload(req);
    if(!payload.displayName)return res.status(400).json({message:'Form name is required'});
    if(!payload.defaultBranchId||!payload.defaultStageId)return res.status(400).json({message:'Default branch and stage are required'});
    if(!payload.settings.defaultAcademicYear)return res.status(400).json({message:'Academic year is required for enquiry forms'});
    if(!payload.fields.length)return res.status(400).json({message:'Select at least one field for the enquiry form'});
    const [result]=await pool.execute(
      `UPDATE crm_public_enquiry_forms SET display_name=?,description=?,default_branch_id=?,default_stage_id=?,default_substage_id=?,default_source_id=?,default_channel_id=?,default_campaign_id=?,default_owner_employee_id=?,field_schema_json=?,settings_json=?,success_message=?,redirect_url=?,is_active=?,updated_by_user_id=?
       WHERE id=? AND business_unit_id=?`,
      [payload.displayName,payload.description,payload.defaultBranchId,payload.defaultStageId,payload.defaultSubstageId,payload.defaultSourceId,payload.defaultChannelId,payload.defaultCampaignId,payload.defaultOwnerEmployeeId,JSON.stringify(payload.fields),JSON.stringify(payload.settings),payload.successMessage,payload.redirectUrl,payload.isActive?1:0,Number(req.user.id),formId,unitId],
    );
    if(!result.affectedRows)return res.status(404).json({message:'Enquiry form not found'});
    res.json({message:'Enquiry form updated'});
  });

  router.delete('/business-units/:unitId/enquiry-forms/:id', requireUserAdmin, async (req,res)=>{
    const unitId=Number(req.params.unitId),formId=Number(req.params.id),unit=await accessibleUnit(req,unitId,true);
    if(!unit)return res.status(403).json({message:'Business unit management access required'});
    const [result]=await pool.execute(`DELETE FROM crm_public_enquiry_forms WHERE id=? AND business_unit_id=?`,[formId,unitId]);
    if(!result.affectedRows)return res.status(404).json({message:'Enquiry form not found'});
    res.json({message:'Enquiry form deleted'});
  });

  const sourceConfigDefinitions={
    channelCategories:{table:'crm_business_channel_categories',keyColumn:'category_key',label:'Channel category'},
    channels:{table:'crm_business_channels',keyColumn:'channel_key',parentColumn:'category_id',parentTable:'crm_business_channel_categories',label:'Channel'},
    sources:{table:'crm_business_sources',keyColumn:'source_key',parentColumn:'channel_id',parentTable:'crm_business_channels',label:'Source'},
    campaignCategories:{table:'crm_business_campaign_categories',keyColumn:'category_key',label:'Campaign category'},
    campaigns:{table:'crm_business_campaigns',keyColumn:'campaign_key',parentColumn:'category_id',parentTable:'crm_business_campaign_categories',label:'Campaign'},
  };

  router.get('/business-units/:id/source-config', async (req,res)=>{
    const unitId=Number(req.params.id),unit=await accessibleUnit(req,unitId);
    if(!unit)return res.status(403).json({message:'Business unit access denied'});
    if(unit.compatibility_mode==='legacy_school'){
      const [[sources],[campaignCategories],[campaigns],[channelCategories],[channels]]=await Promise.all([
        pool.query(`SELECT s.id,s.name code,s.display_name displayName,s.channel_id parentId,ch.display_name parentName,s.is_active isActive FROM crm_lead_sources s LEFT JOIN crm_lead_channels ch ON ch.id=s.channel_id ORDER BY s.display_name`),
        pool.query(`SELECT id,category_code code,display_name displayName,is_active isActive FROM crm_campaign_categories ORDER BY display_name`),
        pool.query(`SELECT c.id,c.campaign_code code,c.display_name displayName,c.category_id parentId,COALESCE(cc.display_name,c.category) parentName,c.is_active isActive FROM crm_campaigns c LEFT JOIN crm_campaign_categories cc ON cc.id=c.category_id ORDER BY parentName,c.display_name`),
        pool.query(`SELECT id,category_code code,display_name displayName,is_active isActive FROM crm_channel_categories ORDER BY display_name`),
        pool.query(`SELECT c.id,c.channel_code code,c.display_name displayName,c.category_id parentId,COALESCE(cc.display_name,c.category) parentName,c.is_active isActive FROM crm_lead_channels c LEFT JOIN crm_channel_categories cc ON cc.id=c.category_id ORDER BY parentName,c.display_name`),
      ]);
      return res.json({sources,campaignCategories,campaigns,channelCategories,channels});
    }
    const [[channelCategories],[channels],[sources],[campaignCategories],[campaigns]]=await Promise.all([
      pool.execute(`SELECT id,category_key code,display_name displayName,is_active isActive FROM crm_business_channel_categories WHERE business_unit_id=? ORDER BY display_name`,[unitId]),
      pool.execute(`SELECT c.id,c.channel_key code,c.display_name displayName,c.category_id parentId,cc.display_name parentName,c.is_active isActive FROM crm_business_channels c JOIN crm_business_channel_categories cc ON cc.id=c.category_id WHERE c.business_unit_id=? ORDER BY cc.display_name,c.display_name`,[unitId]),
      pool.execute(`SELECT s.id,s.source_key code,s.display_name displayName,s.channel_id parentId,c.display_name parentName,s.is_active isActive FROM crm_business_sources s JOIN crm_business_channels c ON c.id=s.channel_id WHERE s.business_unit_id=? ORDER BY c.display_name,s.display_name`,[unitId]),
      pool.execute(`SELECT id,category_key code,display_name displayName,is_active isActive FROM crm_business_campaign_categories WHERE business_unit_id=? ORDER BY display_name`,[unitId]),
      pool.execute(`SELECT c.id,c.campaign_key code,c.display_name displayName,c.category_id parentId,cc.display_name parentName,c.is_active isActive FROM crm_business_campaigns c JOIN crm_business_campaign_categories cc ON cc.id=c.category_id WHERE c.business_unit_id=? ORDER BY cc.display_name,c.display_name`,[unitId]),
    ]);
    res.json({sources,campaignCategories,campaigns,channelCategories,channels});
  });

  router.post('/business-units/:id/source-config/:type', requireUserAdmin, async (req,res)=>{
    const unitId=Number(req.params.id),unit=await accessibleUnit(req,unitId,true),definition=sourceConfigDefinitions[req.params.type];
    if(!unit)return res.status(403).json({message:'Business unit management access required'});
    if(!definition)return res.status(404).json({message:'Configuration type not found'});
    if(unit.compatibility_mode==='legacy_school')return res.status(400).json({message:'Use the School Admissions source configuration adapter'});
    const displayName=text(req.body.displayName,150),key=slug(req.body.code||displayName);
    if(!displayName||!key)return res.status(400).json({message:'Name is required'});
    const values=[unitId],columns=['business_unit_id'];
    if(definition.parentColumn){
      const parentId=Number(req.body.parentId);
      const [[parent]]=await pool.execute(`SELECT id FROM ${definition.parentTable} WHERE id=? AND business_unit_id=?`,[parentId,unitId]);
      if(!parent)return res.status(400).json({message:`${definition.label} parent is required`});
      columns.push(definition.parentColumn);values.push(parentId);
    }
    columns.push(definition.keyColumn,'display_name');values.push(key,displayName);
    try{
      const [result]=await pool.execute(`INSERT INTO ${definition.table}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`,values);
      res.status(201).json({id:Number(result.insertId),message:`${definition.label} added successfully`});
    }catch(error){if(error.code==='ER_DUP_ENTRY')return res.status(409).json({message:`A ${definition.label.toLowerCase()} with this name already exists`});throw error;}
  });

  router.put('/business-units/:unitId/source-config/:type/:id', requireUserAdmin, async (req,res)=>{
    const unitId=Number(req.params.unitId),unit=await accessibleUnit(req,unitId,true),definition=sourceConfigDefinitions[req.params.type];
    if(!unit)return res.status(403).json({message:'Business unit management access required'});
    if(!definition)return res.status(404).json({message:'Configuration type not found'});
    if(unit.compatibility_mode==='legacy_school')return res.status(400).json({message:'Use the School Admissions source configuration adapter'});
    const displayName=text(req.body.displayName,150);
    if(!displayName)return res.status(400).json({message:'Name is required'});
    const values=[displayName],sets=['display_name=?'];
    if(definition.parentColumn){
      const parentId=Number(req.body.parentId);
      const [[parent]]=await pool.execute(`SELECT id FROM ${definition.parentTable} WHERE id=? AND business_unit_id=?`,[parentId,unitId]);
      if(!parent)return res.status(400).json({message:`${definition.label} parent is required`});
      sets.push(`${definition.parentColumn}=?`);values.push(parentId);
    }
    values.push(Number(req.params.id),unitId);
    const [result]=await pool.execute(`UPDATE ${definition.table} SET ${sets.join(',')} WHERE id=? AND business_unit_id=?`,values);
    if(!result.affectedRows)return res.status(404).json({message:`${definition.label} not found`});
    res.json({message:`${definition.label} updated successfully`});
  });

  router.put('/business-units/:unitId/source-config/:type/:id/status', requireUserAdmin, async (req,res)=>{
    const unitId=Number(req.params.unitId),unit=await accessibleUnit(req,unitId,true),definition=sourceConfigDefinitions[req.params.type];
    if(!unit)return res.status(403).json({message:'Business unit management access required'});
    if(!definition)return res.status(404).json({message:'Configuration type not found'});
    if(unit.compatibility_mode==='legacy_school')return res.status(400).json({message:'Use the School Admissions source configuration adapter'});
    const [result]=await pool.execute(`UPDATE ${definition.table} SET is_active=? WHERE id=? AND business_unit_id=?`,[req.body.isActive?1:0,Number(req.params.id),unitId]);
    if(!result.affectedRows)return res.status(404).json({message:`${definition.label} not found`});
    res.json({message:`${definition.label} marked ${req.body.isActive?'active':'inactive'}`});
  });

  router.delete('/business-units/:unitId/source-config/:type/:id', requireUserAdmin, async (req,res)=>{
    const unitId=Number(req.params.unitId),id=Number(req.params.id),unit=await accessibleUnit(req,unitId,true),type=req.params.type,definition=sourceConfigDefinitions[type];
    if(!unit)return res.status(403).json({message:'Business unit management access required'});
    if(!definition)return res.status(404).json({message:'Configuration type not found'});
    if(unit.compatibility_mode==='legacy_school')return res.status(400).json({message:'Use the School Admissions source configuration adapter'});
    const connection=await pool.getConnection();
    try{
      await connection.beginTransaction();
      const sources=[];
      if(type==='sources')sources.push(id);
      if(type==='channels'){
        const [rows]=await connection.execute(`SELECT id FROM crm_business_sources WHERE channel_id=? AND business_unit_id=?`,[id,unitId]);
        sources.push(...rows.map(row=>Number(row.id)));
      }
      if(type==='channelCategories'){
        const [rows]=await connection.execute(
          `SELECT s.id FROM crm_business_sources s JOIN crm_business_channels c ON c.id=s.channel_id WHERE c.category_id=? AND c.business_unit_id=?`,[id,unitId],
        );
        sources.push(...rows.map(row=>Number(row.id)));
      }
      if(sources.length){
        const placeholders=sources.map(()=>'?').join(',');
        const [sourceRows]=await connection.execute(`SELECT source_key AS sourceKey FROM crm_business_sources WHERE id IN (${placeholders}) AND business_unit_id=?`,[...sources,unitId]);
        const keys=sourceRows.map(row=>row.sourceKey);
        if(keys.length){
          const keyPlaceholders=keys.map(()=>'?').join(',');
          const [[linked]]=await connection.execute(`SELECT COUNT(*) AS count FROM crm_dynamic_leads WHERE business_unit_id=? AND source_key IN (${keyPlaceholders})`,[unitId,...keys]);
          if(Number(linked.count)>0){await connection.rollback();return res.status(409).json({message:`Cannot delete this ${definition.label.toLowerCase()} because ${linked.count} lead${Number(linked.count)===1?' is':'s are'} linked to it`});}
        }
      }
      if(type==='channelCategories'){
        await connection.execute(`DELETE s FROM crm_business_sources s JOIN crm_business_channels c ON c.id=s.channel_id WHERE c.category_id=? AND c.business_unit_id=?`,[id,unitId]);
        await connection.execute(`DELETE FROM crm_business_channels WHERE category_id=? AND business_unit_id=?`,[id,unitId]);
      }else if(type==='channels')await connection.execute(`DELETE FROM crm_business_sources WHERE channel_id=? AND business_unit_id=?`,[id,unitId]);
      else if(type==='campaignCategories')await connection.execute(`DELETE FROM crm_business_campaigns WHERE category_id=? AND business_unit_id=?`,[id,unitId]);
      const [result]=await connection.execute(`DELETE FROM ${definition.table} WHERE id=? AND business_unit_id=?`,[id,unitId]);
      if(!result.affectedRows){await connection.rollback();return res.status(404).json({message:`${definition.label} not found`});}
      await connection.commit();
      res.json({message:`${definition.label} and its unused child configuration deleted`});
    }catch(error){
      await connection.rollback();
      if(error.code==='ER_ROW_IS_REFERENCED_2')return res.status(409).json({message:`This ${definition.label.toLowerCase()} is linked to application records and cannot be deleted`});
      throw error;
    }finally{connection.release();}
  });

  router.post('/business-units/:id/pipeline-stages', requireUserAdmin, async (req,res)=>{
    const unitId=Number(req.params.id),unit=await accessibleUnit(req,unitId,true),pipelineId=Number(req.body.pipelineId),displayName=text(req.body.displayName,150),stageKey=slug(req.body.stageKey||displayName);
    if(!unit)return res.status(403).json({message:'Business unit management access required'});
    if(unit){
      if(!displayName)return res.status(400).json({message:'Stage name is required'});
      const [[next]]=await pool.execute(`SELECT COALESCE(MAX(position),0)+1 AS position FROM crm_lead_stages WHERE business_unit_id=?`,[unitId]);
      const [result]=await pool.execute(
        `INSERT INTO crm_lead_stages(business_unit_id,name,display_name,position,color_code,requires_followup) VALUES(?,?,?,?,?,?)`,
        [unitId,`bu${unitId}__${stageKey}`,displayName,Number(next.position),/^#[0-9a-f]{6}$/i.test(req.body.color||'')?req.body.color:'#4A4FB1',req.body.requiresFollowup?1:0],
      );
      return res.status(201).json({id:Number(result.insertId),message:'Lead stage added'});
    }
    const [[pipeline]]=await pool.execute(`SELECT id FROM crm_metadata_pipelines WHERE id=? AND business_unit_id=?`,[pipelineId,unitId]);
    if(!pipeline||!displayName)return res.status(400).json({message:'Valid pipeline and stage name are required'});
    const [[next]]=await pool.execute(`SELECT COALESCE(MAX(position),0)+1 AS position FROM crm_metadata_pipeline_stages WHERE pipeline_id=?`,[pipelineId]);
    const [result]=await pool.execute(
      `INSERT INTO crm_metadata_pipeline_stages(pipeline_id,stage_key,display_name,stage_type,color_code,position) VALUES(?,?,?,?,?,?)`,
      [pipelineId,stageKey,displayName,['open','won','lost','on_hold'].includes(req.body.stageType)?req.body.stageType:'open',
       /^#[0-9a-f]{6}$/i.test(req.body.color||'')?req.body.color:'#4A4FB1',Number(next.position)],
    );
    res.status(201).json({id:Number(result.insertId),message:'Pipeline stage added'});
  });

  router.put('/business-units/:unitId/pipeline-stages/:id', requireUserAdmin, async (req,res)=>{
    const unitId=Number(req.params.unitId),unit=await accessibleUnit(req,unitId,true);
    if(!unit)return res.status(403).json({message:'Business unit management access required'});
    if(unit){
      const [result]=await pool.execute(
        `UPDATE crm_lead_stages SET display_name=?,color_code=?,requires_followup=?,is_active=? WHERE id=? AND business_unit_id=?`,
        [text(req.body.displayName,100),/^#[0-9a-f]{6}$/i.test(req.body.color||'')?req.body.color:'#4A4FB1',
         req.body.requiresFollowup?1:0,req.body.isActive===false?0:1,Number(req.params.id),unitId],
      );
      if(!result.affectedRows)return res.status(404).json({message:'Lead stage not found'});
      return res.json({message:'Lead stage updated'});
    }
    const [result]=await pool.execute(
      `UPDATE crm_metadata_pipeline_stages ps JOIN crm_metadata_pipelines p ON p.id=ps.pipeline_id
       SET ps.display_name=?,ps.stage_type=?,ps.color_code=?,ps.is_active=?
       WHERE ps.id=? AND p.business_unit_id=?`,
      [text(req.body.displayName,150),req.body.stageType||'open',/^#[0-9a-f]{6}$/i.test(req.body.color||'')?req.body.color:'#4A4FB1',
       req.body.isActive===false?0:1,Number(req.params.id),unitId],
    );
    if(!result.affectedRows)return res.status(404).json({message:'Pipeline stage not found'});
    res.json({message:'Pipeline stage updated'});
  });

  router.delete('/business-units/:unitId/pipeline-stages/:id', requireUserAdmin, async (req,res)=>{
    const unitId=Number(req.params.unitId),stageId=Number(req.params.id),unit=await accessibleUnit(req,unitId,true);
    if(!unit)return res.status(403).json({message:'Business unit management access required'});
    if(unit){
      const [[assigned]]=await pool.execute(
        `SELECT COUNT(*) AS count FROM crm_leads
         WHERE stage_id=? OR substage_id IN (SELECT id FROM crm_lead_substages WHERE stage_id=?)`,[stageId,stageId],
      );
      if(Number(assigned.count)>0)return res.status(409).json({message:`Cannot delete this stage because ${assigned.count} lead${Number(assigned.count)===1?' is':'s are'} assigned to it`});
      const connection=await pool.getConnection();
      try{
        await connection.beginTransaction();
        const [[stage]]=await connection.execute(`SELECT id FROM crm_lead_stages WHERE id=? AND business_unit_id=? FOR UPDATE`,[stageId,unitId]);
        if(!stage){await connection.rollback();return res.status(404).json({message:'Lead stage not found'});}
        await connection.execute(`DELETE FROM crm_lead_substages WHERE stage_id=?`,[stageId]);
        await connection.execute(`DELETE FROM crm_lead_stages WHERE id=? AND business_unit_id=?`,[stageId,unitId]);
        await connection.commit();
        return res.json({message:'Lead stage and its unused sub-stages deleted'});
      }catch(error){
        await connection.rollback();
        if(error.code==='ER_ROW_IS_REFERENCED_2')return res.status(409).json({message:'This stage is part of existing lead history and cannot be deleted; mark it inactive instead'});
        throw error;
      }finally{connection.release();}
    }
    const [[assigned]]=await pool.execute(
      `SELECT COUNT(*) AS count FROM crm_dynamic_leads dl
       JOIN crm_metadata_pipeline_stages ps ON ps.id=dl.stage_id
       JOIN crm_metadata_pipelines p ON p.id=ps.pipeline_id
       WHERE dl.stage_id=? AND p.business_unit_id=? AND dl.deleted_at_utc IS NULL`,[stageId,unitId],
    );
    if(Number(assigned.count)>0)return res.status(409).json({message:`Cannot delete this stage because ${assigned.count} lead${Number(assigned.count)===1?' is':'s are'} assigned to it`});
    try{
      const [result]=await pool.execute(
        `DELETE ps FROM crm_metadata_pipeline_stages ps JOIN crm_metadata_pipelines p ON p.id=ps.pipeline_id
         WHERE ps.id=? AND p.business_unit_id=?`,[stageId,unitId],
      );
      if(!result.affectedRows)return res.status(404).json({message:'Pipeline stage not found'});
      res.json({message:'Pipeline stage deleted'});
    }catch(error){
      if(error.code==='ER_ROW_IS_REFERENCED_2')return res.status(409).json({message:'This stage is used by existing records or workflow history and cannot be deleted; mark it inactive instead'});
      throw error;
    }
  });

  router.post('/business-units/:id/pipeline-substages', requireUserAdmin, async (req,res)=>{
    const unitId=Number(req.params.id),unit=await accessibleUnit(req,unitId,true);
    if(!unit)return res.status(403).json({message:'Business unit management access required'});
    const stageId=Number(req.body.stageId),displayName=text(req.body.displayName,150),substageKey=slug(req.body.substageKey||displayName);
    if(!stageId||!displayName)return res.status(400).json({message:'Parent stage and sub-stage name are required'});
    if(unit){
      const [[stage]]=await pool.execute(`SELECT id FROM crm_lead_stages WHERE id=? AND business_unit_id=?`,[stageId,unitId]);
      if(!stage)return res.status(400).json({message:'Select a valid lead stage'});
      const [[next]]=await pool.execute(`SELECT COALESCE(MAX(position),0)+1 AS position FROM crm_lead_substages WHERE stage_id=?`,[stageId]);
      const [result]=await pool.execute(
        `INSERT INTO crm_lead_substages(stage_id,substage_code,display_name,position) VALUES(?,?,?,?)`,
        [stageId,`bu${unitId}__${substageKey}`,displayName,Number(next.position)],
      );
      return res.status(201).json({id:Number(result.insertId),message:'Lead sub-stage added'});
    }
    const [[stage]]=await pool.execute(
      `SELECT ps.id FROM crm_metadata_pipeline_stages ps JOIN crm_metadata_pipelines p ON p.id=ps.pipeline_id WHERE ps.id=? AND p.business_unit_id=?`,
      [stageId,unitId],
    );
    if(!stage)return res.status(400).json({message:'Select a valid pipeline stage'});
    const [[next]]=await pool.execute(`SELECT COALESCE(MAX(position),0)+1 AS position FROM crm_metadata_pipeline_substages WHERE stage_id=?`,[stageId]);
    const [result]=await pool.execute(
      `INSERT INTO crm_metadata_pipeline_substages(stage_id,substage_key,display_name,position) VALUES(?,?,?,?)`,
      [stageId,substageKey,displayName,Number(next.position)],
    );
    res.status(201).json({id:Number(result.insertId),message:'Pipeline sub-stage added'});
  });

  router.put('/business-units/:unitId/pipeline-substages/:id', requireUserAdmin, async (req,res)=>{
    const unitId=Number(req.params.unitId),unit=await accessibleUnit(req,unitId,true);
    if(!unit)return res.status(403).json({message:'Business unit management access required'});
    const stageId=Number(req.body.stageId),displayName=text(req.body.displayName,150);
    if(!stageId||!displayName)return res.status(400).json({message:'Parent stage and sub-stage name are required'});
    if(unit){
      const [[stage]]=await pool.execute(`SELECT id FROM crm_lead_stages WHERE id=? AND business_unit_id=?`,[stageId,unitId]);
      if(!stage)return res.status(400).json({message:'Select a valid lead stage'});
      const [result]=await pool.execute(
        `UPDATE crm_lead_substages SET stage_id=?,display_name=?,is_active=? WHERE id=?`,
        [stageId,displayName,req.body.isActive===false?0:1,Number(req.params.id)],
      );
      if(!result.affectedRows)return res.status(404).json({message:'Lead sub-stage not found'});
      return res.json({message:'Lead sub-stage updated'});
    }
    const [[stage]]=await pool.execute(
      `SELECT ps.id FROM crm_metadata_pipeline_stages ps JOIN crm_metadata_pipelines p ON p.id=ps.pipeline_id WHERE ps.id=? AND p.business_unit_id=?`,
      [stageId,unitId],
    );
    if(!stage)return res.status(400).json({message:'Select a valid pipeline stage'});
    const [result]=await pool.execute(
      `UPDATE crm_metadata_pipeline_substages ss
       JOIN crm_metadata_pipeline_stages ps ON ps.id=ss.stage_id
       JOIN crm_metadata_pipelines p ON p.id=ps.pipeline_id
       SET ss.stage_id=?,ss.display_name=?,ss.is_active=?
       WHERE ss.id=? AND p.business_unit_id=?`,
      [stageId,displayName,req.body.isActive===false?0:1,Number(req.params.id),unitId],
    );
    if(!result.affectedRows)return res.status(404).json({message:'Pipeline sub-stage not found'});
    res.json({message:'Pipeline sub-stage updated'});
  });

  router.delete('/business-units/:unitId/pipeline-substages/:id', requireUserAdmin, async (req,res)=>{
    const unitId=Number(req.params.unitId),substageId=Number(req.params.id),unit=await accessibleUnit(req,unitId,true);
    if(!unit)return res.status(403).json({message:'Business unit management access required'});
    if(unit){
      const [[assigned]]=await pool.execute(
        `SELECT COUNT(*) AS count FROM crm_leads WHERE substage_id=?`,[substageId],
      );
      if(Number(assigned.count)>0)return res.status(409).json({message:`Cannot delete this sub-stage because ${assigned.count} lead${Number(assigned.count)===1?' is':'s are'} assigned to it`});
      try{
        const [result]=await pool.execute(`DELETE FROM crm_lead_substages WHERE id=?`,[substageId]);
        if(!result.affectedRows)return res.status(404).json({message:'Lead sub-stage not found'});
        return res.json({message:'Lead sub-stage deleted'});
      }catch(error){
        if(error.code==='ER_ROW_IS_REFERENCED_2')return res.status(409).json({message:'This sub-stage is part of existing lead history and cannot be deleted; mark it inactive instead'});
        throw error;
      }
    }
    const [result]=await pool.execute(
      `DELETE ss FROM crm_metadata_pipeline_substages ss
       JOIN crm_metadata_pipeline_stages ps ON ps.id=ss.stage_id
       JOIN crm_metadata_pipelines p ON p.id=ps.pipeline_id
       WHERE ss.id=? AND p.business_unit_id=?`,[substageId,unitId],
    );
    if(!result.affectedRows)return res.status(404).json({message:'Pipeline sub-stage not found'});
    res.json({message:'Pipeline sub-stage deleted'});
  });

  router.post('/business-units/:id/operation-stages', requireUserAdmin, async (req,res)=>{
    const unitId=Number(req.params.id),workflowId=Number(req.body.workflowId),displayName=text(req.body.displayName,150),stageKey=slug(req.body.stageKey||displayName);
    const [[workflow]]=await pool.execute(`SELECT id FROM crm_operation_workflows WHERE id=? AND business_unit_id=?`,[workflowId,unitId]);
    if(!workflow||!displayName)return res.status(400).json({message:'Valid workflow and stage name are required'});
    const [[next]]=await pool.execute(`SELECT COALESCE(MAX(position),0)+1 AS position FROM crm_operation_stages WHERE workflow_id=?`,[workflowId]);
    const [result]=await pool.execute(
      `INSERT INTO crm_operation_stages(workflow_id,stage_key,display_name,stage_type,color_code,position,checklist_json) VALUES(?,?,?,?,?,?,?)`,
      [workflowId,stageKey,displayName,['open','completed','cancelled','on_hold'].includes(req.body.stageType)?req.body.stageType:'open',
       /^#[0-9a-f]{6}$/i.test(req.body.color||'')?req.body.color:'#4A4FB1',Number(next.position),JSON.stringify(req.body.checklist||[])],
    );
    res.status(201).json({id:Number(result.insertId),message:'Tracker stage added'});
  });

  router.put('/business-units/:unitId/operation-stages/:id', requireUserAdmin, async (req,res)=>{
    const stageType=['open','completed','cancelled','on_hold'].includes(req.body.stageType)?req.body.stageType:'open';
    const [result]=await pool.execute(
      `UPDATE crm_operation_stages os JOIN crm_operation_workflows ow ON ow.id=os.workflow_id
       SET os.display_name=?,os.stage_type=?,os.color_code=?,os.checklist_json=?,os.is_active=?
       WHERE os.id=? AND ow.business_unit_id=?`,
      [text(req.body.displayName,150),stageType,/^#[0-9a-f]{6}$/i.test(req.body.color||'')?req.body.color:'#4A4FB1',
       JSON.stringify(req.body.checklist||[]),req.body.isActive===false?0:1,Number(req.params.id),Number(req.params.unitId)],
    );
    if(!result.affectedRows)return res.status(404).json({message:'Tracker stage not found'});
    res.json({message:'Tracker stage updated'});
  });

  router.put('/business-units/:unitId/operation-stages/:id/move', requireUserAdmin, async (req,res)=>{
    const unitId=Number(req.params.unitId),stageId=Number(req.params.id);
    const direction=req.body.direction==='up'?'up':req.body.direction==='down'?'down':null;
    if(!direction)return res.status(400).json({message:'Select a valid move direction'});
    const connection=await pool.getConnection();
    try{
      await connection.beginTransaction();
      const [[current]]=await connection.execute(
        `SELECT os.id,os.workflow_id AS workflowId,os.position
         FROM crm_operation_stages os JOIN crm_operation_workflows ow ON ow.id=os.workflow_id
         WHERE os.id=? AND ow.business_unit_id=? FOR UPDATE`,
        [stageId,unitId],
      );
      if(!current){await connection.rollback();return res.status(404).json({message:'Tracker status not found'});}
      const comparator=direction==='up'?'<':'>',order=direction==='up'?'DESC':'ASC';
      const [[adjacent]]=await connection.execute(
        `SELECT id,position FROM crm_operation_stages
         WHERE workflow_id=? AND position ${comparator} ?
         ORDER BY position ${order},id ${order} LIMIT 1 FOR UPDATE`,
        [Number(current.workflowId),Number(current.position)],
      );
      if(!adjacent){await connection.rollback();return res.json({message:`Tracker status is already ${direction==='up'?'first':'last'}`});}
      await connection.execute(`UPDATE crm_operation_stages SET position=? WHERE id=?`,[Number(adjacent.position),Number(current.id)]);
      await connection.execute(`UPDATE crm_operation_stages SET position=? WHERE id=?`,[Number(current.position),Number(adjacent.id)]);
      await connection.commit();
      res.json({message:`Tracker status moved ${direction}`});
    }catch(error){await connection.rollback();throw error;}finally{connection.release();}
  });

  router.delete('/business-units/:unitId/operation-stages/:id', requireUserAdmin, async (req,res)=>{
    const unitId=Number(req.params.unitId),stageId=Number(req.params.id),unit=await accessibleUnit(req,unitId,true);
    if(!unit)return res.status(403).json({message:'Business unit management access required'});
    const [[linked]]=await pool.execute(
      `SELECT COUNT(*) AS count FROM crm_operation_records opr
       JOIN crm_operation_workflows ow ON ow.id=opr.workflow_id
       WHERE opr.stage_id=? AND ow.business_unit_id=?`,[stageId,unitId],
    );
    if(Number(linked.count)>0)return res.status(409).json({message:`Cannot delete this Tracker stage because ${linked.count} record${Number(linked.count)===1?' is':'s are'} assigned to it`});
    const [result]=await pool.execute(
      `DELETE os FROM crm_operation_stages os JOIN crm_operation_workflows ow ON ow.id=os.workflow_id
       WHERE os.id=? AND ow.business_unit_id=?`,[stageId,unitId],
    );
    if(!result.affectedRows)return res.status(404).json({message:'Tracker stage not found'});
    res.json({message:'Tracker stage deleted'});
  });

  router.get('/business-units/:id/dynamic-leads', async (req,res)=>{
    const unitId=Number(req.params.id),unit=await accessibleUnit(req,unitId);
    if(!unit)return res.status(403).json({message:'Business unit access denied'});
    const search=text(req.query.search,100),pipelineId=Number(req.query.pipelineId)||null,stageId=Number(req.query.stageId)||null;
    const values=[unitId],where=['dl.business_unit_id=?','dl.deleted_at_utc IS NULL'];
    if(search){where.push(`(dl.display_name LIKE ? OR dl.primary_phone LIKE ? OR dl.primary_email LIKE ? OR dl.lead_number LIKE ?)`);values.push(...Array(4).fill(`%${search}%`));}
    if(pipelineId){where.push('dl.pipeline_id=?');values.push(pipelineId);}
    if(stageId){where.push('dl.stage_id=?');values.push(stageId);}
    const [rows]=await pool.execute(
      `SELECT dl.id,dl.lead_number AS leadNumber,dl.display_name AS displayName,dl.primary_phone AS phone,dl.primary_email AS email,
              dl.source_key AS source,dl.status_key AS status,dl.pipeline_id AS pipelineId,dl.stage_id AS stageId,
              ps.display_name AS stage,ps.color_code AS stageColor,COALESCE(e.employee_name,'Unassigned') AS owner,
              dl.custom_values_json AS customValues,dl.next_followup_at_utc AS nextFollowupAt,dl.created_at_utc AS createdAt
       FROM crm_dynamic_leads dl
       JOIN crm_metadata_pipeline_stages ps ON ps.id=dl.stage_id
       LEFT JOIN employees e ON e.id=dl.owner_employee_id
       WHERE ${where.join(' AND ')} ORDER BY dl.updated_at_utc DESC,dl.created_at_utc DESC LIMIT 500`,
      values,
    );
    res.json({data:rows.map(row=>({...row,id:Number(row.id),customValues:parseJson(row.customValues,{})}))});
  });

  router.post('/business-units/:id/dynamic-leads', async (req,res)=>{
    const unitId=Number(req.params.id),unit=await accessibleUnit(req,unitId,true);
    if(!unit)return res.status(403).json({message:'Business unit management access required'});
    const pipelineId=Number(req.body.pipelineId),stageId=Number(req.body.stageId),displayName=text(req.body.displayName,200);
    if(!displayName)return res.status(400).json({message:'Lead name is required'});
    const [[stage]]=await pool.execute(
      `SELECT ps.id FROM crm_metadata_pipeline_stages ps JOIN crm_metadata_pipelines p ON p.id=ps.pipeline_id
       WHERE ps.id=? AND p.id=? AND p.business_unit_id=? AND ps.is_active=TRUE`,[stageId,pipelineId,unitId],
    );
    if(!stage)return res.status(400).json({message:'Select a valid pipeline stage'});
    const temporary=`PENDING-${Date.now()}`;
    const [result]=await pool.execute(
      `INSERT INTO crm_dynamic_leads
       (business_unit_id,pipeline_id,stage_id,lead_number,display_name,primary_phone,primary_email,source_key,status_key,custom_values_json,created_by_user_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [unitId,pipelineId,stageId,temporary,displayName,text(req.body.phone,30),text(req.body.email,254),text(req.body.source,80),
       text(req.body.status,80)||'active',JSON.stringify(req.body.customValues||{}),Number(req.user.id)],
    );
    const leadNumber=`${String(unit.unit_code).slice(0,4).toUpperCase()}-${new Date().getFullYear()}-${String(result.insertId).padStart(6,'0')}`;
    await pool.execute(`UPDATE crm_dynamic_leads SET lead_number=? WHERE id=?`,[leadNumber,result.insertId]);
    res.status(201).json({id:Number(result.insertId),leadNumber,message:'Lead created'});
  });

  router.put('/business-units/:unitId/dynamic-leads/:id/stage', async (req,res)=>{
    const unitId=Number(req.params.unitId),unit=await accessibleUnit(req,unitId,true);
    if(!unit)return res.status(403).json({message:'Business unit management access required'});
    const stageId=Number(req.body.stageId);
    const [[stage]]=await pool.execute(
      `SELECT ps.id FROM crm_metadata_pipeline_stages ps JOIN crm_metadata_pipelines p ON p.id=ps.pipeline_id
       WHERE ps.id=? AND p.business_unit_id=? AND ps.is_active=TRUE`,[stageId,unitId],
    );
    if(!stage)return res.status(400).json({message:'Invalid pipeline stage'});
    const [result]=await pool.execute(
      `UPDATE crm_dynamic_leads SET stage_id=?,updated_by_user_id=?,updated_at_utc=CURRENT_TIMESTAMP(6) WHERE id=? AND business_unit_id=? AND deleted_at_utc IS NULL`,
      [stageId,Number(req.user.id),Number(req.params.id),unitId],
    );
    if(!result.affectedRows)return res.status(404).json({message:'Lead not found'});
    res.json({message:'Lead stage updated'});
  });

  async function resolveTrackerOwner(connection,unitId,body,userId){
    const ownerEmployeeId=Number(body.ownerEmployeeId)||null;
    const guestOwnerId=Number(body.guestOwnerId)||null;
    const guestOwnerName=text(body.guestOwnerName,200);
    if(ownerEmployeeId)return {ownerEmployeeId,guestOwnerId:null};
    if(guestOwnerId){
      const [[guest]]=await connection.execute(
        `SELECT id FROM crm_tracker_guest_owners WHERE id=? AND business_unit_id=? AND is_active=TRUE`,
        [guestOwnerId,unitId],
      );
      if(!guest)throw Object.assign(new Error('Selected task owner is not available'),{statusCode:400});
      return {ownerEmployeeId:null,guestOwnerId:Number(guest.id)};
    }
    if(guestOwnerName){
      const normalizedName=guestOwnerName.toLocaleUpperCase('en-IN');
      await connection.execute(
        `INSERT INTO crm_tracker_guest_owners
         (business_unit_id,display_name,normalized_name,created_by_user_id)
         VALUES (?,?,?,?)
         ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),is_active=TRUE`,
        [unitId,guestOwnerName,normalizedName,userId],
      );
      const [[guest]]=await connection.execute(
        `SELECT id FROM crm_tracker_guest_owners WHERE business_unit_id=? AND normalized_name=?`,
        [unitId,normalizedName],
      );
      return {ownerEmployeeId:null,guestOwnerId:Number(guest.id)};
    }
    throw Object.assign(new Error('Task owner is required'),{statusCode:400});
  }

  async function insertTrackerTask(connection,{unitId,unit,userId,body,index=null}){
    const workflowId=Number(body.workflowId),stageId=Number(body.stageId),title=text(body.title,200);
    const prefix=index==null?'':`Action item ${index + 1}: `;
    const [[stage]]=await connection.execute(
      `SELECT os.id FROM crm_operation_stages os JOIN crm_operation_workflows ow ON ow.id=os.workflow_id
       WHERE os.id=? AND ow.id=? AND ow.business_unit_id=?`,[stageId,workflowId,unitId],
    );
    if(!stage||!title)throw Object.assign(new Error(`${prefix}title, tracker, and status are required`),{statusCode:400});
    if(!body.dueAt)throw Object.assign(new Error(`${prefix}deadline is required`),{statusCode:400});
    const owner=await resolveTrackerOwner(connection,unitId,body,userId);
    const approverUserIds=[...new Set((body.approverUserIds||[]).map(Number).filter(Number.isInteger))];
    const approvalRequired=Boolean(body.approvalRequired);
    if(approvalRequired&&!approverUserIds.length)throw Object.assign(new Error(`${prefix}select at least one approver`),{statusCode:400});
    const temporary=`PENDING-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const [result]=await connection.execute(
      `INSERT INTO crm_operation_records
       (business_unit_id,workflow_id,stage_id,dynamic_lead_id,legacy_lead_id,record_number,title,description,
        owner_employee_id,guest_owner_id,values_json,minutes_spent,approval_required,approval_status,due_at_utc,created_by_user_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [unitId,workflowId,stageId,body.dynamicLeadId?Number(body.dynamicLeadId):null,body.legacyLeadId?Number(body.legacyLeadId):null,
       temporary,title,text(body.description,5000),owner.ownerEmployeeId,owner.guestOwnerId,JSON.stringify(body.values||{}),
       Number(body.minutesSpent)||0,approvalRequired,approvalRequired?'pending':'not_required',body.dueAt,userId],
    );
    const recordNumber=`MOM-${String(unit.unit_code).slice(0,4).toUpperCase()}-${String(result.insertId).padStart(6,'0')}`;
    await connection.execute(`UPDATE crm_operation_records SET record_number=? WHERE id=?`,[recordNumber,result.insertId]);
    for(const approverUserId of approverUserIds)await connection.execute(
      `INSERT INTO crm_operation_approvals(operation_record_id,approver_user_id,requested_by_user_id) VALUES(?,?,?)`,
      [Number(result.insertId),approverUserId,userId],
    );
    if(Number(body.minutesSpent)>0)await connection.execute(
      `INSERT INTO crm_operation_time_logs(operation_record_id,minutes_spent,work_note,logged_by_user_id) VALUES(?,?,?,?)`,
      [Number(result.insertId),Number(body.minutesSpent),text(body.timeNote,1000)||'Initial time recorded',userId],
    );
    return {id:Number(result.insertId),recordNumber};
  }

  router.get('/business-units/:id/operations', async (req,res)=>{
    const unitId=Number(req.params.id),unit=await accessibleUnit(req,unitId);
    if(!unit)return res.status(403).json({message:'Business unit access denied'});
    const [rows]=await pool.execute(
      `SELECT opr.id,opr.record_number AS recordNumber,opr.title,opr.workflow_id AS workflowId,opr.stage_id AS stageId,
              os.display_name AS stage,os.color_code AS stageColor,ow.display_name AS workflow,
              opr.description,opr.owner_employee_id AS ownerEmployeeId,opr.guest_owner_id AS guestOwnerId,
              COALESCE(e.employee_name,go.display_name,'Unassigned') AS owner,
              opr.values_json AS customValues,opr.minutes_spent AS minutesSpent,
              opr.approval_required AS approvalRequired,opr.approval_status AS approvalStatus,
              (SELECT COUNT(*) FROM crm_operation_approvals oa WHERE oa.operation_record_id=opr.id AND oa.decision='pending') AS pendingApprovals,
              opr.due_at_utc AS dueAt,opr.created_at_utc AS createdAt,opr.updated_at_utc AS updatedAt
       FROM crm_operation_records opr
       JOIN crm_operation_workflows ow ON ow.id=opr.workflow_id
       JOIN crm_operation_stages os ON os.id=opr.stage_id
       LEFT JOIN employees e ON e.id=opr.owner_employee_id
       LEFT JOIN crm_tracker_guest_owners go ON go.id=opr.guest_owner_id
       WHERE opr.business_unit_id=? ORDER BY opr.updated_at_utc DESC,opr.created_at_utc DESC LIMIT 500`,[unitId],
    );
    res.json({data:rows.map(row=>({...row,id:Number(row.id),customValues:parseJson(row.customValues,{})}))});
  });

  router.get('/business-units/:id/tracker-users', async (req,res)=>{
    const unitId=Number(req.params.id),unit=await accessibleUnit(req,unitId);
    if(!unit)return res.status(403).json({message:'Business unit access denied'});
    const [rows]=await pool.execute(
      `SELECT DISTINCT u.id AS userId,e.id AS employeeId,
              COALESCE(e.employee_name,CONCAT_WS(' ',p.first_name,p.last_name),u.email) AS name,u.email
       FROM app_users u
       LEFT JOIN employees e ON e.id=u.employee_id
       LEFT JOIN crm_user_profiles p ON p.user_id=u.id
       LEFT JOIN crm_user_business_units ubu ON ubu.user_id=u.id AND ubu.business_unit_id=?
       WHERE u.is_active=TRUE
         AND (ubu.user_id IS NOT NULL OR EXISTS(
           SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id
           WHERE ur.user_id=u.id AND r.normalized_name IN ('ADMIN','CRM_ADMIN')
         ))
       ORDER BY name`,
      [unitId],
    );
    res.json({data:rows.map(row=>({...row,userId:Number(row.userId),employeeId:row.employeeId?Number(row.employeeId):null}))});
  });

  router.get('/business-units/:id/tracker-guest-owners', async (req,res)=>{
    const unitId=Number(req.params.id),unit=await accessibleUnit(req,unitId);
    if(!unit)return res.status(403).json({message:'Business unit access denied'});
    const [rows]=await pool.execute(
      `SELECT id,display_name AS name FROM crm_tracker_guest_owners
       WHERE business_unit_id=? AND is_active=TRUE ORDER BY display_name`,
      [unitId],
    );
    res.json({data:rows.map(row=>({...row,id:Number(row.id)}))});
  });

  router.get('/business-units/:id/mom-sessions', async (req,res)=>{
    const unitId=Number(req.params.id),unit=await accessibleUnit(req,unitId);
    if(!unit)return res.status(403).json({message:'Business unit access denied'});
    const [sessions]=await pool.execute(
      `SELECT s.id,s.session_number AS sessionNumber,s.mom_notes AS notes,s.action_item_count AS actionItemCount,
              s.started_at_utc AS startedAt,s.ended_at_utc AS endedAt,
              COALESCE(e.employee_name,CONCAT_WS(' ',p.first_name,p.last_name),u.email) AS createdBy
       FROM crm_mom_sessions s
       JOIN app_users u ON u.id=s.created_by_user_id
       LEFT JOIN employees e ON e.id=u.employee_id
       LEFT JOIN crm_user_profiles p ON p.user_id=u.id
       WHERE s.business_unit_id=? ORDER BY s.ended_at_utc DESC LIMIT 100`,
      [unitId],
    );
    if(!sessions.length)return res.json({data:[]});
    const ids=sessions.map(item=>Number(item.id));
    const [points]=await pool.execute(
      `SELECT p.id,p.session_id AS sessionId,p.position,p.mom_notes AS notes,
              p.operation_record_id AS operationRecordId,opr.record_number AS recordNumber,
              opr.title AS actionItem,COALESCE(e.employee_name,go.display_name) AS owner,opr.due_at_utc AS dueAt,
              JSON_UNQUOTE(JSON_EXTRACT(opr.values_json,'$.estimatedHours')) AS estimatedHours
       FROM crm_mom_session_points p
       LEFT JOIN crm_operation_records opr ON opr.id=p.operation_record_id
       LEFT JOIN employees e ON e.id=opr.owner_employee_id
       LEFT JOIN crm_tracker_guest_owners go ON go.id=opr.guest_owner_id
       WHERE p.session_id IN (${ids.map(()=>'?').join(',')})
       ORDER BY p.session_id,p.position`,
      ids,
    );
    res.json({data:sessions.map(session=>{
      const sessionPoints=points.filter(point=>Number(point.sessionId)===Number(session.id)).map(point=>({
        ...point,id:Number(point.id),sessionId:Number(point.sessionId),
        operationRecordId:point.operationRecordId?Number(point.operationRecordId):null,
      }));
      return {...session,id:Number(session.id),actionItemCount:Number(session.actionItemCount),
        notes:session.notes||sessionPoints.map(point=>point.notes).filter(Boolean).join('\n\n'),points:sessionPoints};
    })});
  });

  router.get('/business-units/:id/tracker-approvals', async (req,res)=>{
    const unitId=Number(req.params.id),unit=await accessibleUnit(req,unitId);
    if(!unit)return res.status(403).json({message:'Business unit access denied'});
    const [rows]=await pool.execute(
      `SELECT oa.id,oa.operation_record_id AS recordId,opr.record_number AS recordNumber,opr.title,
              oa.decision,oa.decision_remarks AS remarks,oa.document_references_json AS documentReferences,
              oa.requested_at_utc AS requestedAt,oa.decided_at_utc AS decidedAt,
              COALESCE(owner.employee_name,guest_owner.display_name,'Unassigned') AS owner,
              COALESCE(requester_employee.employee_name,requester.email) AS requestedBy
       FROM crm_operation_approvals oa
       JOIN crm_operation_records opr ON opr.id=oa.operation_record_id AND opr.business_unit_id=?
       LEFT JOIN employees owner ON owner.id=opr.owner_employee_id
       LEFT JOIN crm_tracker_guest_owners guest_owner ON guest_owner.id=opr.guest_owner_id
       JOIN app_users requester ON requester.id=oa.requested_by_user_id
       LEFT JOIN employees requester_employee ON requester_employee.id=requester.employee_id
       WHERE oa.approver_user_id=?
       ORDER BY (oa.decision='pending') DESC,oa.requested_at_utc DESC`,
      [unitId,Number(req.user.id)],
    );
    res.json({data:rows.map(row=>({...row,id:Number(row.id),recordId:Number(row.recordId),documentReferences:parseJson(row.documentReferences,[])}))});
  });

  router.get('/business-units/:unitId/operations/:id', async (req,res)=>{
    const unitId=Number(req.params.unitId),unit=await accessibleUnit(req,unitId);
    if(!unit)return res.status(403).json({message:'Business unit access denied'});
    const [[record]]=await pool.execute(
      `SELECT opr.*,opr.record_number AS recordNumber,opr.workflow_id AS workflowId,opr.stage_id AS stageId,
              opr.owner_employee_id AS ownerEmployeeId,opr.guest_owner_id AS guestOwnerId,opr.minutes_spent AS minutesSpent,
              opr.approval_required AS approvalRequired,opr.approval_status AS approvalStatus,
              COALESCE(e.employee_name,go.display_name,'Unassigned') AS owner
       FROM crm_operation_records opr LEFT JOIN employees e ON e.id=opr.owner_employee_id
       LEFT JOIN crm_tracker_guest_owners go ON go.id=opr.guest_owner_id
       WHERE opr.id=? AND opr.business_unit_id=?`,
      [Number(req.params.id),unitId],
    );
    if(!record)return res.status(404).json({message:'Tracker task not found'});
    const [timeLogs]=await pool.execute(
      `SELECT tl.id,tl.minutes_spent AS minutesSpent,tl.work_note AS workNote,tl.created_at_utc AS createdAt,
              COALESCE(e.employee_name,u.email) AS loggedBy
       FROM crm_operation_time_logs tl JOIN app_users u ON u.id=tl.logged_by_user_id
       LEFT JOIN employees e ON e.id=u.employee_id
       WHERE tl.operation_record_id=? ORDER BY tl.created_at_utc DESC`,[Number(req.params.id)],
    );
    const [approvals]=await pool.execute(
      `SELECT oa.id,oa.approver_user_id AS approverUserId,oa.decision,oa.decision_remarks AS remarks,
              oa.document_references_json AS documentReferences,oa.requested_at_utc AS requestedAt,oa.decided_at_utc AS decidedAt,
              COALESCE(e.employee_name,u.email) AS approver
       FROM crm_operation_approvals oa JOIN app_users u ON u.id=oa.approver_user_id
       LEFT JOIN employees e ON e.id=u.employee_id
       WHERE oa.operation_record_id=? ORDER BY oa.requested_at_utc`,[Number(req.params.id)],
    );
    res.json({data:{...record,id:Number(record.id),values:parseJson(record.values_json,{}),
      timeLogs,approvals:approvals.map(item=>({...item,documentReferences:parseJson(item.documentReferences,[])}))}});
  });

  router.post('/business-units/:id/operations', async (req,res)=>{
    const unitId=Number(req.params.id),unit=await accessibleUnit(req,unitId,true);
    if(!unit)return res.status(403).json({message:'Business unit management access required'});
    const connection=await pool.getConnection();
    try{
      await connection.beginTransaction();
      const created=await insertTrackerTask(connection,{unitId,unit,userId:Number(req.user.id),body:req.body});
      await connection.commit();
      res.status(201).json({...created,message:'Tracker task created'});
    }catch(error){await connection.rollback();if(error.statusCode)return res.status(error.statusCode).json({message:error.message});throw error;}finally{connection.release();}
  });

  router.post('/business-units/:id/operations/batch', async (req,res)=>{
    const unitId=Number(req.params.id),unit=await accessibleUnit(req,unitId,true);
    if(!unit)return res.status(403).json({message:'Business unit management access required'});
    const items=(Array.isArray(req.body.items)?req.body.items:[]).filter(item=>text(item.title,200));
    const momNotes=richText(req.body.momNotes,50000);
    if(!momNotes)return res.status(400).json({message:'MOM notes are required'});
    if(items.length>100)return res.status(400).json({message:'A meeting session can contain up to 100 action items'});
    const connection=await pool.getConnection();
    try{
      await connection.beginTransaction();
      const [[defaults]]=await connection.execute(
        `SELECT ow.id AS workflowId,os.id AS stageId
         FROM crm_operation_workflows ow
         JOIN crm_operation_stages os ON os.workflow_id=ow.id
         WHERE ow.business_unit_id=? AND ow.is_active=TRUE
         ORDER BY ow.is_default DESC,ow.id,os.position,os.id LIMIT 1`,
        [unitId],
      );
      if(!defaults)throw Object.assign(new Error('Configure at least one Tracker status before starting a MOM session'),{statusCode:400});
      const requestedSessionId=Number(req.body.sessionId)||null;
      let sessionId,sessionNumber,existingActionCount=0,nextPosition=1;
      if(requestedSessionId){
        const [[existingSession]]=await connection.execute(
          `SELECT id,session_number AS sessionNumber,action_item_count AS actionItemCount
           FROM crm_mom_sessions WHERE id=? AND business_unit_id=? FOR UPDATE`,
          [requestedSessionId,unitId],
        );
        if(!existingSession)throw Object.assign(new Error('MOM session not found'),{statusCode:404});
        sessionId=Number(existingSession.id);sessionNumber=existingSession.sessionNumber;existingActionCount=Number(existingSession.actionItemCount||0);
        const [[position]]=await connection.execute(`SELECT COALESCE(MAX(position),0)+1 AS nextPosition FROM crm_mom_session_points WHERE session_id=?`,[sessionId]);
        nextPosition=Number(position.nextPosition);
        await connection.execute(`UPDATE crm_mom_sessions SET mom_notes=?,ended_at_utc=CURRENT_TIMESTAMP(6) WHERE id=?`,[momNotes,sessionId]);
      }else{
        sessionNumber=`MOM-SESSION-${String(unit.unit_code).slice(0,4).toUpperCase()}-${Date.now()}`;
        const [sessionResult]=await connection.execute(
          `INSERT INTO crm_mom_sessions(business_unit_id,session_number,mom_notes,created_by_user_id)
           VALUES(?,?,?,?)`,
          [unitId,sessionNumber,momNotes,Number(req.user.id)],
        );
        sessionId=Number(sessionResult.insertId);
      }
      const created=[];
      for(let index=0;index<items.length;index+=1){
        const item=items[index];
        const estimatedHours=Number(item.values?.estimatedHours);
        if(!Number.isFinite(estimatedHours)||estimatedHours<=0)throw Object.assign(new Error(`Action item ${index+1}: estimated duration is required`),{statusCode:400});
        const calculatedDueAt=new Date(Date.now()+estimatedHours*60*60*1000);
        const operation=await insertTrackerTask(connection,{
          unitId,unit,userId:Number(req.user.id),index,
          body:{...item,dueAt:item.dueAt||calculatedDueAt,workflowId:Number(defaults.workflowId),stageId:Number(defaults.stageId)},
        });
        created.push(operation);
        await connection.execute(
          `INSERT INTO crm_mom_session_points(session_id,position,mom_notes,operation_record_id)
           VALUES(?,?,?,?)`,
          [sessionId,nextPosition+index,text(item.description,10000)||text(item.title,200),operation.id],
        );
      }
      await connection.execute(
        `UPDATE crm_mom_sessions SET mom_notes=?,action_item_count=?,ended_at_utc=CURRENT_TIMESTAMP(6) WHERE id=?`,
        [momNotes,existingActionCount+created.length,sessionId],
      );
      await connection.commit();
      res.status(201).json({
        sessionId,sessionNumber,data:created,count:created.length,
        message:`MOM ${requestedSessionId?'updated':'saved'}${created.length?` and ${created.length} new action item${created.length===1?' was':'s were'} assigned`:''}`,
      });
    }catch(error){await connection.rollback();if(error.statusCode)return res.status(error.statusCode).json({message:error.message});throw error;}finally{connection.release();}
  });

  router.put('/business-units/:unitId/operations/:id', async (req,res)=>{
    const unitId=Number(req.params.unitId),unit=await accessibleUnit(req,unitId,true);
    if(!unit)return res.status(403).json({message:'Business unit management access required'});
    const stageId=Number(req.body.stageId);
    if(!text(req.body.title,200)||!stageId||!req.body.dueAt)return res.status(400).json({message:'Title, status, owner, and deadline are required'});
    const connection=await pool.getConnection();
    try{
      await connection.beginTransaction();
      const owner=await resolveTrackerOwner(connection,unitId,req.body,Number(req.user.id));
      const [result]=await connection.execute(
        `UPDATE crm_operation_records SET title=?,description=?,stage_id=?,owner_employee_id=?,guest_owner_id=?,due_at_utc=?,
                updated_by_user_id=?,updated_at_utc=CURRENT_TIMESTAMP(6)
         WHERE id=? AND business_unit_id=?`,
        [text(req.body.title,200),text(req.body.description,5000),stageId,owner.ownerEmployeeId,owner.guestOwnerId,req.body.dueAt,
         Number(req.user.id),Number(req.params.id),unitId],
      );
      if(!result.affectedRows){await connection.rollback();return res.status(404).json({message:'Tracker task not found'});}
      await connection.commit();res.json({message:'Tracker task updated'});
    }catch(error){await connection.rollback();if(error.statusCode)return res.status(error.statusCode).json({message:error.message});throw error;}finally{connection.release();}
  });

  router.post('/business-units/:unitId/operations/:id/time-logs', async (req,res)=>{
    const unitId=Number(req.params.unitId),unit=await accessibleUnit(req,unitId,true),minutes=Number(req.body.minutesSpent);
    if(!unit)return res.status(403).json({message:'Business unit management access required'});
    if(!Number.isInteger(minutes)||minutes<=0||!text(req.body.workNote,1000))return res.status(400).json({message:'Positive minutes and a work note are required'});
    const connection=await pool.getConnection();
    try{
      await connection.beginTransaction();
      const [updated]=await connection.execute(`UPDATE crm_operation_records SET minutes_spent=minutes_spent+?,updated_by_user_id=? WHERE id=? AND business_unit_id=?`,[minutes,Number(req.user.id),Number(req.params.id),unitId]);
      if(!updated.affectedRows){await connection.rollback();return res.status(404).json({message:'Tracker task not found'});}
      await connection.execute(`INSERT INTO crm_operation_time_logs(operation_record_id,minutes_spent,work_note,logged_by_user_id) VALUES(?,?,?,?)`,[Number(req.params.id),minutes,text(req.body.workNote,1000),Number(req.user.id)]);
      await connection.commit();res.status(201).json({message:'Work minutes recorded'});
    }catch(error){await connection.rollback();throw error;}finally{connection.release();}
  });

  router.put('/business-units/:unitId/tracker-approvals/:id/decision', async (req,res)=>{
    const unitId=Number(req.params.unitId),unit=await accessibleUnit(req,unitId),decision=String(req.body.decision||'').toLowerCase();
    if(!unit)return res.status(403).json({message:'Business unit access denied'});
    const remarks=text(req.body.remarks,5000);
    if(!['approved','rejected'].includes(decision))return res.status(400).json({message:'Select approve or reject'});
    if(!remarks||remarks.length<10)return res.status(400).json({message:'Provide a clear explanation of at least 10 characters'});
    const connection=await pool.getConnection();
    try{
      await connection.beginTransaction();
      const [result]=await connection.execute(
        `UPDATE crm_operation_approvals oa JOIN crm_operation_records opr ON opr.id=oa.operation_record_id
         SET oa.decision=?,oa.decision_remarks=?,oa.document_references_json=?,oa.decided_at_utc=CURRENT_TIMESTAMP(6)
         WHERE oa.id=? AND oa.approver_user_id=? AND opr.business_unit_id=? AND oa.decision='pending'`,
        [decision,remarks,JSON.stringify((req.body.documentReferences||[]).filter(Boolean)),Number(req.params.id),Number(req.user.id),unitId],
      );
      if(!result.affectedRows){await connection.rollback();return res.status(404).json({message:'Pending approval request not found'});}
      const [[approval]]=await connection.execute(`SELECT operation_record_id AS recordId FROM crm_operation_approvals WHERE id=?`,[Number(req.params.id)]);
      const [[summary]]=await connection.execute(
        `SELECT SUM(decision='rejected') rejected,SUM(decision='pending') pending FROM crm_operation_approvals WHERE operation_record_id=?`,[Number(approval.recordId)],
      );
      const overall=Number(summary.rejected)>0?'rejected':Number(summary.pending)>0?'pending':'approved';
      await connection.execute(`UPDATE crm_operation_records SET approval_status=?,updated_at_utc=CURRENT_TIMESTAMP(6) WHERE id=?`,[overall,Number(approval.recordId)]);
      await connection.commit();res.json({message:`Task ${decision}`});
    }catch(error){await connection.rollback();throw error;}finally{connection.release();}
  });

  router.put('/business-units/:unitId/operations/:id/stage', async (req,res)=>{
    const unitId=Number(req.params.unitId),unit=await accessibleUnit(req,unitId,true);
    if(!unit)return res.status(403).json({message:'Business unit management access required'});
    const stageId=Number(req.body.stageId);
    const [[stage]]=await pool.execute(
      `SELECT os.id FROM crm_operation_stages os JOIN crm_operation_workflows ow ON ow.id=os.workflow_id
       WHERE os.id=? AND ow.business_unit_id=?`,[stageId,unitId],
    );
    if(!stage)return res.status(400).json({message:'Invalid tracker stage'});
    const [result]=await pool.execute(
      `UPDATE crm_operation_records SET stage_id=?,updated_by_user_id=?,updated_at_utc=CURRENT_TIMESTAMP(6) WHERE id=? AND business_unit_id=?`,
      [stageId,Number(req.user.id),Number(req.params.id),unitId],
    );
    if(!result.affectedRows)return res.status(404).json({message:'Tracker record not found'});
    res.json({message:'Tracker stage updated'});
  });

  return router;
}
