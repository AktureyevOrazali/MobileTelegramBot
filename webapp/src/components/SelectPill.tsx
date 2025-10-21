import { CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

type Option = { value: string; label: string; meta?: string };

export default function SelectPill({
  label,
  placeholder = "Не выбрано",
  options,
  value,
  onChange,
  searchable,
  style,
  showLabelInside = true,
}: {
  label: string;
  placeholder?: string;
  options: Option[];
  value: string;
  onChange: (v: string) => void;
  searchable?: boolean;
  style?: React.CSSProperties;
  showLabelInside?: boolean; // NEW
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | undefined>();

  const currentLabel = useMemo(
    () => options.find((o) => o.value === value)?.label ?? placeholder,
    [options, value, placeholder]
  );

  const filtered = useMemo(() => {
    if (!searchable || !q.trim()) return options;
    const s = q.toLowerCase();
    return options.filter((o) =>
      (o.label + o.value + (o.meta || "")).toLowerCase().includes(s)
    );
  }, [q, options, searchable]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
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
      position: "fixed",
      top,
      left,
      width,
      minWidth: width,
      maxHeight: maxHeight > 0 ? maxHeight : undefined,
      overflowY: "auto",
      zIndex: 1000,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setMenuStyle(undefined);
      return;
    }

    updateMenuPosition();

    const handleScroll = () => updateMenuPosition();
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleScroll);

    return () => {
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleScroll);
    };
  }, [open, updateMenuPosition, currentLabel]);

  return (
    <div ref={containerRef} style={{ position: "relative", ...style }}>
      <div
        ref={triggerRef}
        className="pill"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {showLabelInside && <span className="label">{label}</span>}
        <span className="value">{currentLabel}</span>
        <span className="caret">▾</span>
      </div>
      {open && (
        <div className="menu" role="listbox" style={menuStyle}>
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
                setOpen(false);
              }}
            >
              <span>{o.label}</span>
              {o.meta && <span className="meta">{o.meta}</span>}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="opt" style={{ opacity: 0.6, cursor: "default" }}>
              Ничего не найдено
            </div>
          )}
        </div>
      )}
    </div>
  );
}