import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { api } from './api';
import './GlobalSearch.css';

/**
 * Global search.
 *
 * Rendered as a field inside the universal topbar. On the Leads screen it
 * drives that list's filter through the `q` URL param — which is why Leads no
 * longer carries a search box of its own.
 */
export default function GlobalSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const searchCacheRef = useRef(new Map());
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  // On Leads the list itself is the result set, so the typeahead stands down.
  const filtersLeads = location.pathname === '/leads';

  // Adopt a deep-linked ?q= so the field reflects what the list is showing.
  useEffect(() => {
    if (!filtersLeads) return;
    const current = searchParams.get('q') || '';
    setQuery((value) => (value === current ? value : current));
    // Only when the route changes; typing must not be overwritten mid-keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersLeads]);

  // Push the query into the URL; LeadsPage reads `q` and debounces its fetch.
  useEffect(() => {
    if (!filtersLeads) return undefined;
    const timer = setTimeout(() => {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        const trimmed = query.trim();
        if (trimmed) next.set('q', trimmed);
        else next.delete('q');
        return next;
      }, { replace: true });
    }, 250);
    return () => clearTimeout(timer);
  }, [query, filtersLeads, setSearchParams]);

  // Fetch results with debounce
  useEffect(() => {
    if (filtersLeads) return;
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
  }, [query, filtersLeads]);

  // Global keyboard shortcut: Ctrl/Command+Shift+F
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
        e.preventDefault();
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  /** Close the suggestion list without touching what was typed. */
  const dismissSuggestions = () => {
    setResults([]);
    setActiveIndex(-1);
  };

  // Handle keyboard nav (Arrow keys, Enter, Esc)
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      if (loading) return;
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
        dismissSuggestions();
      }
    }
  };

  const handleSelectResult = (result) => {
    const selectedSearch = result.phone || result.leadId || result.studentName || query.trim();
    const params = new URLSearchParams({
      q: selectedSearch,
      openLead: String(result.id)
    });
    navigate(`/leads?${params.toString()}`);
    dismissSuggestions();
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
      <div ref={rootRef} className="global-search-inline">
        <Search size={16} className="global-search-inline-icon" />
        <input
          ref={inputRef}
          type="text"
          placeholder={filtersLeads
            ? 'Search by name, phone, or lead number…'
            : 'Search students, leads, phone or email…'}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(-1);
          }}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          spellCheck="false"
          aria-label="Search"
          aria-keyshortcuts="Control+Shift+F Meta+Shift+F"
        />
        {query ? (
          <button
            className="global-search-inline-clear"
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
          >
            <X size={14} />
          </button>
        ) : (
          <span className="global-search-inline-kbd" aria-hidden="true">
            <kbd>Ctrl/⌘</kbd><kbd>⇧</kbd><kbd>F</kbd>
          </span>
        )}

        {/* Typeahead is suppressed on Leads, where the table is the result. */}
        {!filtersLeads && query.trim() && (
          <div className="global-search-inline-results" role="listbox">
            {loading && <div className="global-search-loading">Searching…</div>}
            {!loading && !results.length && (
              <div className="global-search-empty">No matches for “{query}”</div>
            )}
            {!loading && results.map((result, index) => (
              <button
                key={result.id}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={`global-search-inline-item ${index === activeIndex ? 'active' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => handleSelectResult(result)}
              >
                <strong>{highlightMatch(String(result.studentName || 'Unnamed lead'), query)}</strong>
                <small>
                  {[result.leadId, result.phone, result.stage].filter(Boolean).join(' · ')}
                </small>
              </button>
            ))}
          </div>
        )}
    </div>
  );
}
