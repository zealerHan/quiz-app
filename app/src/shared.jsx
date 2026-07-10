// ─── Shared API Helpers ───────────────────────────────────────────────────────
export const api = (path, opts={}) => fetch(path, { headers:{"Content-Type":"application/json",...opts.headers}, ...opts });
export const apiJson = async (path, opts={}) => { const r = await api(path, opts); return r.json(); };
export const adminHeaders = pwd => ({ "x-admin-password": pwd });

// ─── Shared Micro UI ─────────────────────────────────────────────────────────
export function AppModal({ icon, title, body, buttons }) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",backdropFilter:"blur(8px)",WebkitBackdropFilter:"blur(8px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200,padding:"0 32px"}}>
      <div style={{background:"rgba(28,32,48,0.96)",borderRadius:18,width:"100%",maxWidth:320,overflow:"hidden",boxShadow:"0 24px 60px rgba(0,0,0,0.6)",border:"1px solid rgba(255,255,255,0.08)"}}>
        <div style={{padding:"24px 20px 16px",textAlign:"center"}}>
          {icon&&<div style={{fontSize:32,marginBottom:10}}>{icon}</div>}
          <div style={{fontSize:17,fontWeight:700,color:"white",marginBottom:8,letterSpacing:0.3}}>{title}</div>
          {body&&<div style={{fontSize:13,color:"rgba(255,255,255,0.5)",lineHeight:1.7,whiteSpace:"pre-line"}}>{body}</div>}
        </div>
        <div style={{borderTop:"1px solid rgba(255,255,255,0.08)",display:"flex"}}>
          {buttons.map((btn,i)=>(
            <button key={i} onClick={btn.onClick} style={{flex:1,padding:"15px 0",background:"none",border:"none",borderRight:i<buttons.length-1?"1px solid rgba(255,255,255,0.08)":"none",color:btn.danger?"#ef4444":btn.primary?"#3b82f6":"rgba(255,255,255,0.45)",fontSize:16,cursor:"pointer",fontFamily:"inherit",fontWeight:btn.primary||btn.danger?600:400,letterSpacing:0.2}}>
              {btn.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ScoreRing({ score, size=80 }) {
  const r=size*.38, c=2*Math.PI*r, dash=(score/100)*c;
  const col=score>=85?"#22c55e":score>=60?"#f59e0b":"#ef4444";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#1e293b" strokeWidth={size*.1}/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={col} strokeWidth={size*.1}
        strokeDasharray={`${dash} ${c}`} strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`} style={{transition:"stroke-dasharray 1s"}}/>
      <text x={size/2} y={size/2+size*.08} textAnchor="middle" fill="white" fontSize={size*.22} fontWeight="700">{score}</text>
    </svg>
  );
}

export function MiniBar({ label, value, max=100 }) {
  const col=value>=85?"#22c55e":value>=70?"#f59e0b":"#ef4444";
  return (
    <div style={{marginBottom:9}}>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:3}}>
        <span style={{color:"#94a3b8"}}>{label}</span>
        <span style={{color:col,fontWeight:700}}>{value}</span>
      </div>
      <div style={{height:5,background:"#1e293b",borderRadius:3,overflow:"hidden"}}>
        <div style={{height:"100%",width:`${(value/max)*100}%`,background:`linear-gradient(90deg,${col}88,${col})`,borderRadius:3,transition:"width 1s ease"}}/>
      </div>
    </div>
  );
}

export function MiniTrend({ data }) {
  if(!data?.length) return null;
  const w=140,h=36,max=Math.max(...data),min=Math.min(...data)-4;
  const pts=data.map((v,i)=>`${i*(w/(data.length-1))},${h-((v-min)/(max-min||1))*h}`).join(" ");
  return (
    <svg width={w} height={h}>
      <polyline points={pts} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinejoin="round"/>
      {data.map((v,i)=><circle key={i} cx={i*(w/(data.length-1))} cy={h-((v-min)/(max-min||1))*h} r={i===data.length-1?4:2} fill={i===data.length-1?"#3b82f6":"#1e3a5f"} stroke="#3b82f6" strokeWidth="1"/>)}
    </svg>
  );
}

export function Badge({ label, color="#3b82f6" }) {
  return <span style={{background:`${color}22`,border:`1px solid ${color}55`,color,borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:600}}>{label}</span>;
}

export function Chip({ label, value, unit="" }) {
  return (
    <div style={{flex:1,textAlign:"center",background:"#0d1e35",border:"1px solid #1b3255",borderRadius:10,padding:"10px 6px"}}>
      <div style={{fontSize:20,fontWeight:900,color:"white"}}>{value}<span style={{fontSize:11,color:"#64748b"}}>{unit}</span></div>
      <div style={{fontSize:10,color:"#64748b",marginTop:2}}>{label}</div>
    </div>
  );
}
