import { useEffect, useMemo, useRef, useState } from "react";

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
  const ref = useRef<HTMLDivElement | null>(null);

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
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <div ref={ref} style={{ position: "relative", ...style }}>
      <div
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
        <div className="menu" role="listbox">
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
