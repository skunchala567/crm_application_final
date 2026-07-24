// =====================================================
// Data Transformer
// Transforms data between Google Sheets and CRM formats
// =====================================================

export function transformRow(rowData, mappings) {
  const transformed = {};
  const errors = [];

  const mappingMap = mappings || {};

  for (const [sheetKey, crmField] of Object.entries(mappingMap)) {
    if (!crmField) continue;
    const value = getValueFromRow(rowData, sheetKey);
    if (value) {
      transformed[crmField] = value;
    }
  }

  const hasContact = transformed.phone || transformed.email;
  if (!hasContact) {
    errors.push('Missing required contact information (phone or email)');
  }

  return {
    data: transformed,
    isValid: errors.length === 0,
    errors
  };
}

function getValueFromRow(rowData, sheetKey) {
  const match = sheetKey.match(/sheet_(\d+)/);
  if (!match) return null;

  const index = parseInt(match[1]);

  if (Array.isArray(rowData)) {
    return rowData[index] || null;
  } else if (typeof rowData === 'object') {
    const values = Object.values(rowData);
    return values[index] || null;
  }

  return null;
}

export function transformCrmData(lead, mappings) {
  const transformed = {};

  mappings.forEach(mapping => {
    const crmField = mapping.crm_field || mapping.crmField;
    const externalField = mapping.external_field || mapping.sheetColumn;

    const value = lead[crmField];
    if (value !== undefined && value !== null) {
      transformed[externalField] = String(value).trim();
    }
  });

  return transformed;
}

export function extractFieldMappings(config) {
  return config?.fieldMappings || {};
}
