export default function StarButton({ active, onToggle, title="Избранное" }:{ active:boolean; onToggle:()=>void; title?:string }){
  return (
    <button className={`star ${active ? "active":""}`} onClick={onToggle} aria-pressed={active} title={title} style={{display:'grid',placeItems:'center'}}>
      <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16">
        <path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
      </svg>
    </button>
  );
}
