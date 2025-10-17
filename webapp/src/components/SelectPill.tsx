import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../utils/cn';
import {
  dropdownEmptyOptionClass,
  dropdownOptionClass,
  dropdownPanelClass,
  pillButtonClass,
  labelClass,
  mutedTextClass,
  inputClass,
} from '../ui/primitives';

type Option = { value: string; label: string; meta?: string };

interface SelectPillProps {
  label: string;
  placeholder?: string;
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  searchable?: boolean;
  showLabelInside?: boolean;
}

export default function SelectPill({
  label,
  placeholder = 'Не выбрано',
  options,
  value,
  onChange,
  searchable,
  showLabelInside = true,
}: SelectPillProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement | null>(null);

  const currentLabel = useMemo(
    () => options.find((option) => option.value === value)?.label ?? placeholder,
    [options, value, placeholder],
  );

  const filtered = useMemo(() => {
    if (!searchable || !query.trim()) {
      return options;
    }
    const search = query.toLowerCase();
    return options.filter((option) => `${option.label}${option.value}${option.meta ?? ''}`.toLowerCase().includes(search));
  }, [query, options, searchable]);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className={cn(pillButtonClass, 'w-full justify-between text-left')}
        onClick={() => setOpen((state) => !state)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="flex flex-col text-left">
          {showLabelInside && <span className={cn(labelClass, 'text-xs uppercase tracking-wide')}>{label}</span>}
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{currentLabel}</span>
        </span>
        <span className={cn(mutedTextClass, 'text-base')}>▾</span>
      </button>
      {open && (
        <div className={cn(dropdownPanelClass, 'w-full sm:w-auto')} role="listbox">
          {searchable && (
            <input
              type="text"
              placeholder="Поиск..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className={cn(inputClass, 'mb-2')}
              autoFocus
            />
          )}
           <div className="space-y-1">
            {filtered.map((option) => (
              <button
                key={option.value}
                type="button"
                className={dropdownOptionClass}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                  setQuery('');
                }}
              >
                <span>{option.label}</span>
                {option.meta && <span className={cn(mutedTextClass, 'text-xs font-medium')}>{option.meta}</span>}
              </button>
            ))}
            {filtered.length === 0 && <div className={dropdownEmptyOptionClass}>Ничего не найдено</div>}
          </div>
        </div>
      )}
    </div>
  );
}