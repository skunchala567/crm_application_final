import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { api } from './api';
import './GlobalSearch.css';

export default function GlobalSearch() {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const searchCacheRef = useRef(new Map());
  const navigate = useNavigate();

  // Fetch results with debounce
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setActiveIndex(-1);
      return;
    }

    const timer = setTimeout(async () => {
      const cacheKey = query.toLowerCase();
      if (searchCacheRef.current.has(cacheKey)) {
        setResults(searchCacheRef.current.get(cacheKey));
        return;
      }

      setLoading(true);
      try {
        const response = await api(`/leads?search=${encodeURIComponent(query)}&limit=8`);
        setResults(response.data || []);
        searchCacheRef.current.set(cacheKey, response.data || []);
      } catch (error) {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  // Global keyboard shortcut: Ctrl+Shift+F
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
        e.preventDefault();
        setExpanded(true);
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Outside click to close
  useEffect(() => {
    const handleMouseDown = (e) => {
      if (loading) return; // Don't close while searching
      if (!rootRef.current?.contains(e.target)) {
        setExpanded(false);
      }
    };

    if (expanded) {
      document.addEventListener('mousedown', handleMouseDown);
      return () => document.removeEventListener('mousedown', handleMouseDown);
    }
  }, [expanded, loading]);

  // Handle keyboard nav (Arrow keys, Enter, Esc)
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      if (loading) return;
      setExpanded(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < results.length) {
        handleSelectResult(results[activeIndex]);
      } else if (query.trim()) {
        navigate(`/leads?q=${encodeURIComponent(query.trim())}`);
        setExpanded(false);
      }
    }
  };

  const handleSelectResult = (result) => {
    navigate(`/leads?openLead=${result.id}`);
    setExpanded(false);
    setQuery('');
  };

  // Helper to highlight matched text
  const highlightMatch = (text, query) => {
    if (!query.trim()) return text;
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);
    return parts.map((part, i) =>
      regex.test(part) ? (
        <mark key={i} className="global-search-highlight">
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  return (
    <div ref={rootRef} className={`global-search-container ${expanded ? 'expanded' : ''}`}>
      <button
        className="global-search-toggle"
        onClick={() => {
          setExpanded(!expanded);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        aria-label="Global search"
        title="Press Ctrl+Shift+F"
      >
        <Search size={20} />
      </button>

      {expanded && (
        <div className="global-search-panel">
          <div className="global-search-input-wrapper">
            <Search size={18} className="search-icon" />
            <input
              ref={inputRef}
              type="text"
              className="global-search-input"
              placeholder="Student, lead ID, phone or email"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIndex(-1);
              }}
              onKeyDown={handleKeyDown}
              autoComplete="off"
              spellCheck="false"
            />
            {query && (
              <button
                className="global-search-clear"
                onClick={() => {
                  setQuery('');
                  inputRef.current?.focus();
                }}
                aria-label="Clear search"
              >
                <X size={16} />
              </button>
            )}
          </div>

          {query.trim() && (
            <div className="global-search-results" role="listbox">
              {loading && (
                <div className="global-search-loading">
                  <span className="spinner" /> Searching...
                </div>
              )}

              {!loading && results.length === 0 && (
                <div className="global-search-empty">No results found</div>
              )}

              {!loading && results.length > 0 && (
                <>
                  {results.map((result, idx) => (
                    <button
                      key={result.id}
                      className={`global-search-result ${idx === activeIndex ? 'active' : ''}`}
                      onClick={() => handleSelectResult(result)}
                      role="option"
                      aria-selected={idx === activeIndex}
                    >
                      <div className="result-student">
                        <span className="result-avatar">{result.studentName?.charAt(0)?.toUpperCase()}</span>
                        <div className="result-info">
                          <span className="result-name">
                            {highlightMatch(result.studentName || '', query)}
                          </span>
                          <span className="result-phone">
                            {highlightMatch(result.phone || '', query)}
                          </span>
                        </div>
                      </div>
                      <span className={`result-stage`}>
                        {result.stage}
                      </span>
                    </button>
                  ))}

                  {results.length === 8 && (
                    <button
                      className="global-search-view-all"
                      onClick={() => {
                        navigate(`/leads?q=${encodeURIComponent(query.trim())}`);
                        setExpanded(false);
                      }}
                    >
                      View all results →
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
