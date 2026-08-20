SET NAMES utf8mb4;

-- Every existing Business Unit receives the same Tracker module used by future units.
INSERT INTO crm_business_modules
  (business_unit_id,module_key,display_name,module_type,description,position,is_active)
SELECT bu.id,'operations','Tracker','operations',
       'Progress, MOM, action items, deadlines, effort, and approvals',2,TRUE
FROM crm_business_units bu
WHERE NOT EXISTS (
  SELECT 1
  FROM crm_business_modules bm
  WHERE bm.business_unit_id=bu.id AND bm.module_key='operations'
);

-- Preserve configured workflows and only create one where a Business Unit has none.
INSERT INTO crm_operation_workflows
  (business_unit_id,workflow_key,display_name,entity_label,description,is_default,is_active)
SELECT bu.id,'default','Progress & MOM Tracker','Action item',
       'Meeting minutes, assigned action items, deadlines, effort, and approvals',TRUE,TRUE
FROM crm_business_units bu
WHERE NOT EXISTS (
  SELECT 1
  FROM crm_operation_workflows ow
  WHERE ow.business_unit_id=bu.id
);

-- Seed the complete default status flow only for empty workflows. Existing customized
-- status configurations remain unchanged.
INSERT INTO crm_operation_stages
  (workflow_id,stage_key,display_name,stage_type,color_code,position,is_active)
SELECT ow.id,seed.stage_key,seed.display_name,seed.stage_type,seed.color_code,seed.position,TRUE
FROM crm_operation_workflows ow
JOIN (
  SELECT 'open' AS stage_key,'Open' AS display_name,'open' AS stage_type,'#F04420' AS color_code,1 AS position
  UNION ALL SELECT 'in_progress','In progress','open','#3327EF',2
  UNION ALL SELECT 'hold','Hold','on_hold','#4A4FB1',3
  UNION ALL SELECT 'completed','Completed','completed','#258268',4
  UNION ALL SELECT 'cancelled','Cancelled','cancelled','#C8DD00',5
) seed
WHERE ow.is_default=TRUE
  AND NOT EXISTS (
    SELECT 1 FROM crm_operation_stages existing
    WHERE existing.workflow_id=ow.id
  );

-- Units created by the earlier four-status bootstrap receive the missing terminal
-- status without disturbing their current ordering or renamed statuses.
INSERT INTO crm_operation_stages
  (workflow_id,stage_key,display_name,stage_type,color_code,position,is_active)
SELECT ow.id,'cancelled','Cancelled','cancelled','#C8DD00',
       COALESCE((SELECT MAX(os.position)+1 FROM crm_operation_stages os WHERE os.workflow_id=ow.id),1),TRUE
FROM crm_operation_workflows ow
WHERE ow.workflow_key='default'
  AND NOT EXISTS (
    SELECT 1 FROM crm_operation_stages existing
    WHERE existing.workflow_id=ow.id
      AND (existing.stage_key='cancelled' OR existing.stage_type='cancelled')
  );
