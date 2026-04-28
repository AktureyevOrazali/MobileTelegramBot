import { CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { sanitizeUiText } from '../utils/text';

type Option = { value: string; label: string; meta?: string };

export default function SelectPill({
  label,
  placeholder = 'Не выбрано',
  options,
  value,
  onChange,
  searchable,
  style,
  showLabelInside = true,
  disabled = false,
}: {
  label: string;
  placeholder?: string;
  options: Option[];
  value: string;
  onChange: (v: string) => void;
  searchable?: boolean;
  style?: React.CSSProperties;
  showLabelInside?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | undefined>();

  const currentLabel = useMemo(
    () => sanitizeUiText(options.find((o) => o.value === value)?.label) ?? placeholder,
    [options, value, placeholder],
  );

  const normalizeText = useCallback((text: string | undefined | null) => (sanitizeUiText(text) ?? text ?? '').toLowerCase(), []);
  const extractDigits = useCallback((text: string | undefined | null) => (text ?? '').replace(/\D+/g, ''), []);

  const filtered = useMemo(() => {
    if (!searchable || !q.trim()) return options;
    const s = q.toLowerCase();
    const digitsQuery = extractDigits(q);
    return options.filter((o) => (
      o.value === ''
      || (
        digitsQuery
          ? [o.value, o.label, o.meta].some((candidate) => extractDigits(candidate).startsWith(digitsQuery))
          : (() => {
            const label = normalizeText(o.label);
            const meta = normalizeText(o.meta);
            const optionValue = normalizeText(o.value);
            if (label.startsWith(s) || meta.startsWith(s) || optionValue.startsWith(s)) {
              return true;
            }
            const tokens = `${label} ${meta} ${optionValue}`.split(/[\s,.;:()\-_/]+/).filter(Boolean);
            return tokens.some((token) => token.startsWith(s));
          })()
      )
    ));
  }, [extractDigits, normalizeText, q, options, searchable]);

  useEffect(() => {
    if (!open && q) {
      setQ('');
    }
  }, [open, q]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const updateMenuPosition = useCallback(() => {
    if (!triggerRef.current) return;

    const rect = triggerRef.current.getBoundingClientRect();
    const gap = 4;
    const viewportPadding = 12;
    const preferredWidth = Math.max(rect.width, 260);
    const availableWidth = Math.max(0, window.innerWidth - viewportPadding * 2);
    const width = availableWidth > 0 ? Math.min(preferredWidth, availableWidth) : preferredWidth;

    let left = rect.left;
    const maxLeft = window.innerWidth - viewportPadding - width;
    if (left > maxLeft) {
      left = Math.max(viewportPadding, maxLeft);
    }

    let top = rect.bottom + gap;
    const maxTop = window.innerHeight - viewportPadding;
    if (top > maxTop) {
      top = Math.max(viewportPadding, maxTop);
    }

    const maxHeight = window.innerHeight - viewportPadding - top;

    setMenuStyle({
      position: 'fixed',
      top,
      left,
      width,
      minWidth: width,
      maxHeight: maxHeight > 0 ? maxHeight : undefined,
      overflowY: 'auto',
      zIndex: 3500,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setMenuStyle(undefined);
      return;
    }

    updateMenuPosition();

    const handleScroll = () => updateMenuPosition();
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);

    return () => {
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
    };
  }, [open, updateMenuPosition, currentLabel]);

  return (
    <div ref={containerRef} style={{ position: 'relative', ...style }}>
      <div
        ref={triggerRef}
        className={`pill${disabled ? ' pill--disabled' : ''}`}
        onClick={() => {
          if (disabled) return;
          if (!open && q) {
            setQ('');
          }
          setOpen((v) => !v);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-disabled={disabled}
      >
        {showLabelInside && <span className="label">{label}</span>}
        <span className="value">{currentLabel}</span>
        <span className="caret" aria-hidden="true">
          <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="m5 7 5 6 5-6" />
          </svg>
        </span>
      </div>
      {open && !disabled && createPortal(
        <div
          className="menu"
          role="listbox"
          style={menuStyle}
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {searchable && (
            <input
              type="text"
              placeholder="Поиск..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          )}
          {filtered.map((o) => (
            <div
              key={o.value}
              className="opt"
              onClick={() => {
                onChange(o.value);
                setQ('');
                setOpen(false);
              }}
            >
              <span>{sanitizeUiText(o.label) ?? o.label}</span>
              {o.meta && <span className="meta">{sanitizeUiText(o.meta) ?? o.meta}</span>}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="opt" style={{ opacity: 0.6, cursor: 'default' }}>
              Ничего не найдено
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}


