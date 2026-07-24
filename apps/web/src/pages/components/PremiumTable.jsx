import React, { useState } from 'react';
import { ChevronDown, MoreHorizontal } from 'lucide-react';

export default function PremiumTable({
  columns,
  data,
  onRowClick,
  onAction,
  loading = false,
  sortable = true,
  selectable = false,
}) {
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
  const [selectedRows, setSelectedRows] = useState(new Set());

  const handleSort = (key) => {
    if (!sortable) return;
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const toggleRow = (id) => {
    const newSelected = new Set(selectedRows);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedRows(newSelected);
  };

  const toggleAll = () => {
    if (selectedRows.size === data.length) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(data.map((_, i) => i)));
    }
  };

  return (
    <div className="premium-table-wrapper">
      <table className="premium-table">
        <thead>
          <tr>
            {selectable && (
              <th className="checkbox-column">
                <input
                  type="checkbox"
                  checked={selectedRows.size === data.length && data.length > 0}
                  onChange={toggleAll}
                  className="table-checkbox"
                />
              </th>
            )}
            {columns.map((col) => (
              <th
                key={col.key}
                onClick={() => handleSort(col.key)}
                className={sortable && col.sortable ? 'sortable' : ''}
              >
                <div className="th-content">
                  {col.label}
                  {sortable && col.sortable && (
                    <ChevronDown
                      size={16}
                      className={`sort-icon ${
                        sortConfig.key === col.key ? `rotate-${sortConfig.direction}` : ''
                      }`}
                    />
                  )}
                </div>
              </th>
            ))}
            {onAction && <th className="actions-column">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={columns.length + (selectable ? 1 : 0) + (onAction ? 1 : 0)} className="loading-row">
              <div className="skeleton-row"></div>
            </td></tr>
          ) : data.length === 0 ? (
            <tr><td colSpan={columns.length + (selectable ? 1 : 0) + (onAction ? 1 : 0)} className="empty-row">
              No data available
            </td></tr>
          ) : (
            data.map((row, idx) => (
              <tr
                key={idx}
                className={`table-row ${selectedRows.has(idx) ? 'selected' : ''}`}
                onClick={() => onRowClick?.(row, idx)}
              >
                {selectable && (
                  <td className="checkbox-column" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedRows.has(idx)}
                      onChange={() => toggleRow(idx)}
                      className="table-checkbox"
                    />
                  </td>
                )}
                {columns.map((col) => (
                  <td key={col.key} className={`td-${col.key}`}>
                    {typeof col.render === 'function'
                      ? col.render(row[col.key], row)
                      : row[col.key]}
                  </td>
                ))}
                {onAction && (
                  <td className="actions-column" onClick={(e) => e.stopPropagation()}>
                    <button className="action-trigger" onClick={(e) => {
                      e.stopPropagation();
                      onAction(row, idx);
                    }}>
                      <MoreHorizontal size={18} />
                    </button>
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
