import { Search, Filter, RefreshCw } from 'lucide-react';

export default function ActionToolbar({
  searchValue,
  onSearchChange,
  filterValue,
  onFilterChange,
  onRefresh,
  filters = []
}) {
  return (
    <div className="action-toolbar">
      <div className="toolbar-left">
        <div className="search-box">
          <Search size={18} />
          <input
            type="text"
            placeholder="Search integrations..."
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            className="search-input"
          />
        </div>

        {filters.length > 0 && (
          <select
            value={filterValue}
            onChange={(e) => onFilterChange(e.target.value)}
            className="filter-select"
          >
            <option value="">All Status</option>
            {filters.map((filter) => (
              <option key={filter.value} value={filter.value}>
                {filter.label}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="toolbar-right">
        <button
          className="btn btn-secondary"
          onClick={onRefresh}
          title="Refresh"
        >
          <RefreshCw size={18} />
          Refresh
        </button>
      </div>
    </div>
  );
}
