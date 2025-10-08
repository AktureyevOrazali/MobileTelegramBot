import { ReactNode, useEffect } from "react";
export default function Modal({ open, onClose, children }:{ open:boolean; onClose:()=>void; children:ReactNode }){
  useEffect(()=>{
    if(!open) return;
    const onKey=(e:KeyboardEvent)=>{ if(e.key==='Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return ()=>document.removeEventListener('keydown', onKey);
  },[open,onClose]);

  if(!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()}>{children}</div>
    </div>
  );
}
