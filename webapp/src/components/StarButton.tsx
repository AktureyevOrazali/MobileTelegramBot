import { iconButtonClass } from '../ui/primitives';
import { cn } from '../utils/cn';

interface StarButtonProps {
  active: boolean;
  onToggle: () => void;
  title?: string;
}

export default function StarButton({ active, onToggle, title = 'Избранное' }: StarButtonProps) {  
  return (
    <button
      type="button"
      className={cn(
        iconButtonClass,
        active
          ? 'border-amber-400 bg-amber-100/60 text-amber-500 dark:border-amber-500/70 dark:bg-amber-500/10 dark:text-amber-300'
          : undefined,
      )}
      onClick={onToggle}
      aria-pressed={active}
      title={title}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18" className={active ? 'fill-current' : 'fill-slate-400'}>
        <path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
      </svg>
    </button>
  );
}
