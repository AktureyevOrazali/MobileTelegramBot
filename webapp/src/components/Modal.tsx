import { ReactNode, useEffect } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}

export default function Modal({ open, onClose, children, className }: ModalProps) {
  useEffect(()=>{
    if(!open) return;
    const onKey=(e:KeyboardEvent)=>{ if(e.key==='Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return ()=>document.removeEventListener('keydown', onKey);
  },[open,onClose]);

  if(!open) return null;
  const contentClass = className ? `modal ${className}` : 'modal';
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={contentClass} onClick={e=>e.stopPropagation()}>{children}</div>
    </div>
  );
}
