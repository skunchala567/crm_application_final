import React, { useState } from 'react';
import { Search, Filter, RotateCcw, ChevronDown } from 'lucide-react';

export default function PremiumToolbar({
  onSearch,
  onFilter,
  onRefresh,
  onBulkAction,
  filters = [],
  selectedCount = 0,
  loading = false,
}) {
  const [searchValue, setSearchValue] = useState('');
  const [activeFilters, setActiveFilters] = useState({});
  const [showFilters, setShowFilters] = useState(false);

  const handleSearch = (value) => {
    setSearchValue(value);
    onSearch?.(value);
  };

  const handleFilterChange = (key, value) => {
    const newFilters = { ...activeFilters, [key]: value };
    setActiveFilters(newFilters);
    onFilter?.(newFilters);
  };

  const activeFilterCount = Object.values(activeFilters).filter(Boolean).length;

  return (
    <div className="premium-toolbar">
      <div className="toolbar-left">
        <div className="search-box">
          <Search size={18} className="search-icon" />
          <input
            type="text"
            placeholder="Search integrations..."
            value={searchValue}
            onChange={(e) => handleSearch(e.target.value)}
            className="search-input"
          />
          {searchValue && (
            <button
              className="search-clear"
              onClick={() => handleSearch('')}
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        <div className="toolbar-divider" />

        <div className="filter-section">
          <button
            className={`filter-button ${showFilters ? 'active' : ''}`}
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter size={18} />
            Filters
            {activeFilterCount > 0 && (
              <span className="filter-badge">{activeFilterCount}</span>
            )}
          </button>

          {showFilters && (
            <div className="filter-panel">
              {filters.map((filter) => (
                <div key={filter.key} className="filter-group">
                  <label>{filter.label}</label>
                  <select
                    value={activeFilters[filter.key] || ''}
                    onChange={(e) => handleFilterChange(filter.key, e.target.value)}
                    className="filter-select"
                  >
                    <option value="">All</option>
                    {filter.options.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="toolbar-right">
        {selectedCount > 0 && (
          <div className="selection-info">
            <span>{selectedCount} selected</span>
            <button className="bulk-action-btn" onClick={() => onBulkAction?.('delete')}>
              Delete
            </button>
          </div>
        )}

        <button
          className="toolbar-button secondary"
          onClick={onRefresh}
          disabled={loading}
          aria-label="Refresh"
        >
          <RotateCcw size={18} className={loading ? 'spinning' : ''} />
          Refresh
        </button>
      </div>
    </div>
  );
}
