import { Router } from 'express';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/;
const quoteIdentifier = value => {
  if (!IDENTIFIER.test(String(value || ''))) throw new Error('Invalid database identifier');
  return `\`${value}\``;
};
const fieldType = dataType => {
  const type = String(dataType || '').toLowerCase();
  if (['tinyint'].includes(type)) return 'boolean';
  if (['int', 'bigint', 'smallint', 'mediumint', 'decimal', 'numeric', 'float', 'double', 'real'].includes(type)) return 'number';
  if (type === 'date') return 'date';
  if (['datetime', 'timestamp'].includes(type)) return 'datetime';
  return 'text';
};
const labelFor = name => String(name).replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/\b\w/g, letter => letter.toUpperCase());

export function createReportDataSourceRoutes(pool, authenticate, requireCrmAccess, requireUserAdmin) {
  const router = Router();
  router.use(authenticate, requireCrmAccess);

  router.get('/', async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT id, display_name AS displayName, source_name AS sourceName, source_type AS sourceType,
              business_unit_column AS businessUnitColumn, owner_column AS ownerColumn, columns_json AS columnsJson
       FROM crm_report_data_sources WHERE business_unit_id=? AND is_active=TRUE ORDER BY display_name`,
      [req.businessUnit.id],
    );
    res.json({ data: rows.map(row => ({ ...row, fields: typeof row.columnsJson === 'string' ? JSON.parse(row.columnsJson) : row.columnsJson })) });
  });

  router.post('/', requireUserAdmin, async (req, res) => {
    const sourceName = String(req.body.sourceName || '').trim();
    if (!IDENTIFIER.test(sourceName)) return res.status(400).json({ message: 'Enter a valid table or view name' });
    const [objects] = await pool.execute(
      `SELECT TABLE_NAME AS sourceName, TABLE_TYPE AS tableType FROM information_schema.tables
       WHERE table_schema=DATABASE() AND table_name=? LIMIT 1`,
      [sourceName],
    );
    if (!objects[0]) return res.status(404).json({ message: 'Table or view was not found in the configured database' });
    const [columns] = await pool.execute(
      `SELECT COLUMN_NAME AS columnName, DATA_TYPE AS dataType, IS_NULLABLE AS isNullable, ORDINAL_POSITION AS ordinalPosition
       FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? ORDER BY ORDINAL_POSITION`,
      [sourceName],
    );
    const names = new Set(columns.map(column => column.columnName));
    const businessUnitColumn = ['business_unit_id', 'businessUnitId'].find(name => names.has(name));
    if (!businessUnitColumn) return res.status(400).json({ message: 'The source must expose a business_unit_id column so report data cannot cross business units' });
    const ownerColumn = ['owner_employee_id', 'ownerEmployeeId', 'employee_id', 'employeeId'].find(name => names.has(name)) || null;
    const fields = columns.map(column => ({ id: column.columnName, label: labelFor(column.columnName), type: fieldType(column.dataType), databaseType: column.dataType, nullable: column.isNullable === 'YES' }));
    const sourceType = objects[0].tableType === 'VIEW' ? 'VIEW' : 'TABLE';
    const displayName = String(req.body.displayName || labelFor(sourceName)).trim().slice(0, 160);
    await pool.execute(
      `INSERT INTO crm_report_data_sources
       (business_unit_id,display_name,source_name,source_type,business_unit_column,owner_column,columns_json,created_by_user_id)
       VALUES (?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),source_type=VALUES(source_type),business_unit_column=VALUES(business_unit_column),owner_column=VALUES(owner_column),columns_json=VALUES(columns_json),is_active=TRUE`,
      [req.businessUnit.id, displayName, sourceName, sourceType, businessUnitColumn, ownerColumn, JSON.stringify(fields), Number(req.user.id) || null],
    );
    res.status(201).json({ message: `${sourceType === 'VIEW' ? 'View' : 'Table'} added to report sources`, data: { displayName, sourceName, sourceType, fields } });
  });

  router.get('/:id/rows', async (req, res) => {
    const [[source]] = await pool.execute(
      `SELECT * FROM crm_report_data_sources WHERE id=? AND business_unit_id=? AND is_active=TRUE LIMIT 1`,
      [Number(req.params.id), req.businessUnit.id],
    );
    if (!source) return res.status(404).json({ message: 'Report data source not found' });
    const fields = typeof source.columns_json === 'string' ? JSON.parse(source.columns_json) : source.columns_json;
    const limit = Math.min(Math.max(Number(req.query.limit) || 2000, 1), 5000);
    const selectedColumns = fields.map(field => quoteIdentifier(field.id)).join(',');
    const predicates = [`${quoteIdentifier(source.business_unit_column)}=?`];
    const params = [req.businessUnit.id];
    const isAdmin = req.user.roles?.some(role => ['CRM_ADMIN', 'SUPER_ADMIN'].includes(String(role).toUpperCase()));
    if (!isAdmin && req.user.rbacScope !== 'all') {
      if (!source.owner_column) return res.status(403).json({ message: 'This source has no owner column and cannot safely enforce your record-level access' });
      predicates.push(`${quoteIdentifier(source.owner_column)}=?`);
      params.push(Number(req.user.employeeId) || 0);
    }
    const [rows] = await pool.execute(
      `SELECT ${selectedColumns} FROM ${quoteIdentifier(source.source_name)} WHERE ${predicates.join(' AND ')} LIMIT ${limit}`,
      params,
    );
    res.json({ data: rows, fields, source: { id: source.id, displayName: source.display_name, sourceName: source.source_name }, limit, truncated: rows.length === limit });
  });

  return router;
}
