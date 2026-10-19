import React, { useEffect, useId, useRef, useState } from 'react';

/**
 * Text input with a live suggestion list (combobox pattern, keyboard accessible).
 * The caller owns the text value; suggestions come from `fetchOptions(query)`.
 */
export default function Autocomplete({
  value,
  onChange,
  onSelect,
  fetchOptions,
  renderOption,
  getKey,
  placeholder,
  className = '',
  id,
  required = false,
  minChars = 2,
  maxLength,
  emptyText = 'No matches in the catalogue',
  footer = null,
}) {
  const [options, setOptions] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const wrapRef = useRef(null);
  const fetchRef = useRef(fetchOptions);
  const listId = useId();
  fetchRef.current = fetchOptions;

  useEffect(() => {
    const query = String(value || '').trim();
    if (!open || query.length < minChars) { setOptions([]); setSearched(false); return undefined; }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const result = await fetchRef.current(query);
        if (!cancelled) { setOptions(result || []); setActive(-1); setSearched(true); }
      } catch {
        if (!cancelled) { setOptions([]); setSearched(true); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [value, open, minChars]);

  useEffect(() => {
    const close = (event) => { if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const choose = (option) => { setOpen(false); setActive(-1); onSelect(option); };

  const onKeyDown = (event) => {
    if (event.key === 'Escape') { setOpen(false); return; }
    if (!open || !options.length) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((i) => (i + 1) % options.length); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((i) => (i <= 0 ? options.length - 1 : i - 1)); }
    else if (event.key === 'Enter' && active >= 0) { event.preventDefault(); choose(options[active]); }
  };

  const showList = open && String(value || '').trim().length >= minChars && (loading ? options.length > 0 : searched);

  return (
    <div className="relative" ref={wrapRef}>
      <input
        id={id}
        type="text"
        required={required}
        maxLength={maxLength}
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        placeholder={placeholder}
        className={className}
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {showList && (
        <ul id={listId} role="listbox" className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-auto rounded border border-stone-300 bg-white shadow-lg text-left">
          {options.length === 0 ? (
            <li className="px-3 py-2.5 text-xs text-stone-500">{emptyText}</li>
          ) : options.map((option, index) => (
            <li
              key={getKey(option)}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(option)}
              onMouseEnter={() => setActive(index)}
              className={`cursor-pointer px-3 py-2 text-xs border-b border-stone-100 last:border-b-0 ${index === active ? 'bg-stone-100' : 'bg-white'}`}
            >
              {renderOption(option)}
            </li>
          ))}
          {footer && options.length === 0 && <li className="px-3 pb-2.5 text-[11px] text-stone-400">{footer}</li>}
        </ul>
      )}
    </div>
  );
}
