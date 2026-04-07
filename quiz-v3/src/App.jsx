import { useState, useEffect, useRef, useCallback, useMemo } from "react";

// ─── Assets ────────────────────────────────────────────────────────────────
const IMG_ELEVATED = "/img-elevated.jpeg";
const IMG_TUNNEL = "/img-tunnel.jpeg";
const IMG_MASCOT = "/img-mascot.jpeg";

// ─── Helpers ───────────────────────────────────────────────────────────────
const api = (path, opts={}) => fetch(path, { headers:{"Content-Type":"application/json",...opts.headers}, ...opts });
const apiJson = async (path, opts={}) => { const r = await api(path, opts); return r.json(); };
const adminHeaders = pwd => ({ "x-admin-password": pwd });

// ─── Shared Micro UI ───────────────────────────────────────────────────────
function AppModal({ icon, title, body, buttons }) {
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

function ScoreRing({ score, size=80 }) {
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

function MiniBar({ label, value, max=100 }) {
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

function MiniTrend({ data }) {
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

function Badge({ label, color="#3b82f6" }) {
  return <span style={{background:`${color}22`,border:`1px solid ${color}55`,color,borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:600}}>{label}</span>;
}

function Chip({ label, value, unit="" }) {
  return (
    <div style={{flex:1,textAlign:"center",background:"#0d1e35",border:"1px solid #1b3255",borderRadius:10,padding:"10px 6px"}}>
      <div style={{fontSize:20,fontWeight:900,color:"white"}}>{value}<span style={{fontSize:11,color:"#64748b"}}>{unit}</span></div>
      <div style={{fontSize:10,color:"#64748b",marginTop:2}}>{label}</div>
    </div>
  );
}

// ─── NEW: Login Screen ─────────────────────────────────────────────────────
const LOGIN_STORAGE_KEY = 'quiz_last_login';
function LoginScreen({ onLogin, onAdmin }) {
  const getSaved = () => { try { return JSON.parse(localStorage.getItem(LOGIN_STORAGE_KEY)||'null'); } catch { return null; } };
  const [saved,setSaved]=useState(getSaved);
  const [id,setId]=useState(()=>getSaved()?.staffId||"");
  const [phone,setPhone]=useState(()=>getSaved()?.phoneTail||"");
  const [err,setErr]=useState(""), [loading,setLoading]=useState(false);

  const clearSaved=()=>{ localStorage.removeItem(LOGIN_STORAGE_KEY); setSaved(null); setId(""); setPhone(""); };

  const submit=async e=>{
    e.preventDefault();
    if(!/^\d{3,8}$/.test(id)){setErr("工号格式不正确");return;}
    if(!/^\d{4}$/.test(phone)){setErr("请输入手机号后4位");return;}
    setLoading(true);
    try{
      const r = await api("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({staffId:id.trim(),phoneTail:phone.trim()})});
      const d = await r.json();
      if(!r.ok){ setErr(d.error||"登录失败"); return; }
      localStorage.setItem(LOGIN_STORAGE_KEY, JSON.stringify({staffId:id.trim(),phoneTail:phone.trim()}));
      onLogin({staffId:d.staffId, name:d.realName||d.staffId, isExempt:!!d.isExempt, isTester:!!d.isTester});
    }catch(e){ setErr("连接服务器失败"); }
    finally{setLoading(false);}
  };
  return (
    <div style={{position:"relative",width:"100%",height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden",background:"#080a0c"}}>
      {/* 背景：高架封闭段 */}
      <div style={{position:"absolute",inset:0,backgroundImage:`url(${IMG_ELEVATED})`,backgroundSize:"cover",backgroundPosition:"center",filter:"brightness(0.42) saturate(0.8)",animation:"bgZoom 18s ease-in-out infinite alternate"}}/>
      <div style={{position:"absolute",inset:0,background:"linear-gradient(180deg,rgba(0,0,0,0.5) 0%,rgba(0,0,0,0.15) 40%,rgba(200,57,75,0.12) 70%,rgba(0,0,0,0.75) 100%)"}}/>
      {/* 轨道光线 */}
      <div style={{position:"absolute",bottom:0,left:"50%",transform:"translateX(-50%)",width:3,height:"55%",background:"linear-gradient(to bottom,transparent,rgba(200,57,75,0.8))",filter:"blur(7px)",animation:"glowPulse 3s ease-in-out infinite"}}/>

      {/* 登录卡片 */}
      <div style={{position:"relative",zIndex:10,width:"100%",maxWidth:340,margin:"0 20px",padding:"36px 30px 28px",background:"rgba(8,10,12,0.8)",backdropFilter:"blur(24px)",WebkitBackdropFilter:"blur(24px)",border:"1px solid rgba(255,255,255,0.1)",borderTop:"2px solid #c8394b",borderRadius:6,boxShadow:"0 24px 80px rgba(0,0,0,0.7),0 0 40px rgba(200,57,75,0.1)",animation:"cardIn 0.7s cubic-bezier(0.16,1,0.3,1) both"}}>
        {/* Logo */}
        <div style={{textAlign:"center",marginBottom:28}}>
          <div style={{display:"inline-flex",alignItems:"center",gap:8,marginBottom:14}}>
            <div style={{width:8,height:8,borderRadius:"50%",background:"#c8394b",boxShadow:"0 0 12px rgba(200,57,75,0.6)",animation:"liveDot 2s ease-in-out infinite"}}/>
            <span style={{fontSize:10,fontWeight:600,letterSpacing:3,color:"#c8394b"}}>培训系统</span>
            <div style={{width:8,height:8,borderRadius:"50%",background:"#c8394b",boxShadow:"0 0 12px rgba(200,57,75,0.6)",animation:"liveDot 2s ease-in-out infinite"}}/>
          </div>
          <div style={{fontSize:20,fontWeight:700,letterSpacing:5,color:"white",marginBottom:5}}>乘务培训系统</div>
          <div style={{fontSize:10,fontWeight:300,color:"rgba(255,255,255,0.5)",letterSpacing:2}}>OPERATIONS TRAINING SYSTEM</div>
        </div>

        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:22}}>
          <div style={{flex:1,height:1,background:"linear-gradient(90deg,transparent,rgba(200,57,75,0.45))"}}/>
          <div style={{width:5,height:5,background:"#c8394b",transform:"rotate(45deg)"}}/>
          <div style={{flex:1,height:1,background:"linear-gradient(270deg,transparent,rgba(200,57,75,0.45))"}}/>
        </div>

        {saved&&(
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,padding:"7px 10px",background:"rgba(34,197,94,0.07)",border:"1px solid rgba(34,197,94,0.22)",borderRadius:4}}>
            <span style={{fontSize:10,color:"rgba(34,197,94,0.9)",letterSpacing:0.5}}>✓ 已记住账号 Y{saved.staffId}</span>
            <button type="button" onClick={clearSaved} style={{background:"none",border:"none",color:"rgba(255,255,255,0.3)",cursor:"pointer",fontSize:14,lineHeight:1,padding:"0 2px"}}>×</button>
          </div>
        )}
        <form onSubmit={submit}>
          <div style={{marginBottom:14}}>
            <label style={{display:"block",fontSize:9,fontWeight:600,letterSpacing:2.5,color:"rgba(255,255,255,0.5)",marginBottom:7}}>工　　号</label>
            <div style={{display:"flex",alignItems:"center",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:4,height:44,paddingLeft:14,gap:2}}
              onFocus={e=>{e.currentTarget.style.borderColor="#c8394b";e.currentTarget.style.background="rgba(200,57,75,0.07)";e.currentTarget.style.boxShadow="0 0 0 3px rgba(200,57,75,0.1)"}}
              onBlur={e=>{e.currentTarget.style.borderColor="rgba(255,255,255,0.1)";e.currentTarget.style.background="rgba(255,255,255,0.06)";e.currentTarget.style.boxShadow="none"}}>
                <span style={{color:"white",fontSize:14,fontWeight:700,userSelect:"none",letterSpacing:0.5,opacity:0.9}}>Y</span>
                <input value={id} onChange={e=>setId(e.target.value.replace(/[^0-9]/g,""))} placeholder="输入工号数字" maxLength={8} inputMode="numeric"
              style={{flex:1,height:"100%",background:"transparent",border:"none",padding:"0 4px",fontFamily:"inherit",fontSize:14,color:"white",outline:"none",letterSpacing:0.5}}/>
              </div>
          </div>
          <div style={{marginBottom:14}}>
            <label style={{display:"block",fontSize:9,fontWeight:600,letterSpacing:2.5,color:"rgba(255,255,255,0.5)",marginBottom:7}}>手机尾号</label>
            <input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="请输入手机后4位" maxLength={4} inputMode="numeric"
              style={{width:"100%",height:44,background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:4,padding:"0 14px",fontFamily:"inherit",fontSize:14,color:"white",outline:"none",letterSpacing:0.5}}
              onFocus={e=>{e.target.style.borderColor="#c8394b";e.target.style.background="rgba(200,57,75,0.07)";e.target.style.boxShadow="0 0 0 3px rgba(200,57,75,0.1)";}}
              onBlur={e=>{e.target.style.borderColor="rgba(255,255,255,0.1)";e.target.style.background="rgba(255,255,255,0.06)";e.target.style.boxShadow="none";}}/>
          </div>
          {err&&<div style={{color:"#ef4444",fontSize:12,marginBottom:8}}>⚠ {err}</div>}
          <button type="submit" disabled={loading}
            style={{width:"100%",height:46,marginTop:6,background:loading?"#555":"#c8394b",border:"none",borderRadius:4,fontFamily:"inherit",fontSize:13,fontWeight:600,letterSpacing:5,color:"white",cursor:loading?"not-allowed":"pointer",transition:"all 0.2s"}}>
            {loading?"登录中…":"开始答题"}
          </button>
        </form>
        <button onClick={onAdmin} style={{width:"100%",marginTop:12,background:"none",border:"none",color:"rgba(255,255,255,0.2)",fontSize:11,cursor:"pointer",fontFamily:"inherit",letterSpacing:1}}>管理员入口</button>
        <div style={{marginTop:16,textAlign:"center",fontSize:10,color:"rgba(255,255,255,0.15)",letterSpacing:1}}>武汉地铁5号线乘务四组内训专用</div>
      </div>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function splitToItems(text) {
  if (!text?.trim()) return [];
  // ① 分号分隔的编号步骤："1.xxx；2.xxx"
  if (/[；;]/.test(text)) {
    const segs = text.split(/[；;]/).map(s=>s.replace(/^\d{1,2}[.、。]\s*/,'').trim()).filter(Boolean);
    if (segs.length > 1) return segs.slice(0,10);
  }
  // ② 内联编号分割："1.xxx2.xxx" 或 "①xxx②xxx"
  const numParts = text.split(/(?=\d{1,2}[.、]|[①②③④⑤⑥⑦⑧⑨⑩])/u)
    .map(s=>s.replace(/^\d{1,2}[.、]|^[①②③④⑤⑥⑦⑧⑨⑩]/,'').trim()).filter(Boolean);
  if (numParts.length > 1) return numParts.slice(0,10);
  // ③ 按句末标点拆，再按逗号拆超长段
  const sentenceParts = text.split(/[。！？\n]+/).map(s=>s.trim()).filter(Boolean);
  const result = [];
  for (const part of sentenceParts) {
    if (part.length <= 50) { result.push(part); continue; }
    const subs = part.split(/[，,]+/).map(s=>s.trim()).filter(Boolean);
    let buf = '';
    for (const sub of subs) {
      if (!buf) { buf = sub; }
      else if (buf.length + sub.length + 1 <= 50) { buf += '，' + sub; }
      else { result.push(buf); buf = sub; }
    }
    if (buf) result.push(buf);
  }
  return result.filter(s=>s.length>0);
}
const CIRCLE_NUMS = ['①','②','③','④','⑤','⑥','⑦','⑧','⑨','⑩'];
// 判断 item 是否包含 points 中任意关键词（取前4字匹配）
function hasOverlap(item, points) {
  if (!points?.length || !item) return false;
  return points.some(p => {
    const key = p.replace(/[，。！？、\s]/g,'').slice(0,4);
    return key.length >= 2 && item.includes(key);
  });
}

// ─── NEW: Quiz Screen ──────────────────────────────────────────────────────
function QuizScreen({ user, onDone, onBack, mode='normal' }) {
  const [questions,setQuestions]=useState([]);
  const [sessionId,setSessionId]=useState(null);
  const [qi,setQi]=useState(0);
  const [phase,setPhase]=useState("loading");
  const [editMode,setEditMode]=useState(false);
  const [transcript,setTranscript]=useState("");
  const [transcriptItems,setTranscriptItems]=useState([]);
  const [editingIdx,setEditingIdx]=useState(-1);
  const [isRec,setIsRec]=useState(false);
  const [aiRes,setAiRes]=useState(null);
  const [isRecognizing,setIsRecognizing]=useState(false);
  const [countdown,setCountdown]=useState(null);
  const countdownRef=useRef(null);
  const [results,setResults]=useState([]);
  const [displayText,setDisplayText]=useState("");
  const [isSpeaking,setIsSpeaking]=useState(false);
  const [muted,setMuted]=useState(true); // 默认静音
  const [showSubmitConfirm,setShowSubmitConfirm]=useState(false);
  const [showBackConfirm,setShowBackConfirm]=useState(false);
  const [tabSwitchCount,setTabSwitchCount]=useState(0);
  const [showTabWarn,setShowTabWarn]=useState(false);
  const tabSwitchRef=useRef(0);
  const recRef=useRef(),typeRef=useRef(),pendingSubmitRef=useRef(false),submitRef=useRef(null),scoreCacheRef=useRef(null),audioStreamRef=useRef(null),recognizeTimeoutRef=useRef(null);

  const isPractice = mode !== 'normal';

  useEffect(()=>{
    const qUrl = mode==='practice_random' ? '/api/practice/questions?mode=random&count=3'
               : mode==='practice_sequential' ? '/api/practice/questions?mode=sequential'
               : '/api/questions';
    Promise.all([
      apiJson(qUrl),
      apiJson("/api/session/start",{method:"POST",body:JSON.stringify({staffId:user.staffId,staffName:user.name,isPractice})})
    ]).then(([qData,sData])=>{
      setQuestions(qData.questions||[]);
      setSessionId(sData.sessionId);
      setPhase("intro");
      if (mode==='normal') {
        const today=new Date().toISOString().slice(0,10);
        localStorage.setItem('quiz_inprogress',JSON.stringify({staffId:user.staffId,date:today,answered:0,total:(qData.questions||[]).length}));
      }
    }).catch(()=>setPhase("error"));
    navigator.mediaDevices?.getUserMedia({audio:{sampleRate:16000,channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}})
      .then(s=>{audioStreamRef.current=s;})
      .catch(()=>{});
    return()=>{
      audioStreamRef.current?.getTracks().forEach(t=>t.stop());
    };
  },[]);

  useEffect(()=>{
    const handler=()=>{
      if(document.hidden){
        tabSwitchRef.current+=1;
        setTabSwitchCount(tabSwitchRef.current);
      } else if(tabSwitchRef.current>0){
        setShowTabWarn(true);
      }
    };
    document.addEventListener('visibilitychange',handler);
    return()=>document.removeEventListener('visibilitychange',handler);
  },[]);

  const typeText = useCallback((text, onDone) => {
    clearInterval(typeRef.current);
    setDisplayText("");
    setIsSpeaking(true);
    let i = 0;
    typeRef.current = setInterval(() => {
      if (i < text.length) {
        setDisplayText(text.slice(0, i+1));
        i++;
      } else {
        clearInterval(typeRef.current);
        setIsSpeaking(false);
        onDone?.();
      }
    }, 40);
  }, []);

  const speak = useCallback((text, onEnd) => {
    if (!text) { onEnd?.(); return; }
    if (muted) { onEnd?.(); return; } // 静音模式直接跳过
    fetch('/api/tts', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({text})})
      .then(r => r.blob())
      .then(blob => {
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.onended = () => { URL.revokeObjectURL(url); onEnd?.(); };
        audio.onerror = () => { URL.revokeObjectURL(url); onEnd?.(); };
        audio.play().catch(() => onEnd?.());
      })
      .catch(() => onEnd?.());
  }, [muted]);

  const q = questions[qi];

  useEffect(() => {
    if (phase !== "intro" || !q) return;
    const introText = `${user.name}，第${qi+1}题，共${questions.length}题。${q.text}`;
    setTimeout(() => {
      typeText(q.text, () => {
        setPhase("ready");
        // 启动60秒倒计时
        setCountdown(120);
        countdownRef.current = setInterval(() => {
          setCountdown(prev => {
            if(prev<=1){
              clearInterval(countdownRef.current);
              countdownRef.current=null;
              setCountdown(null);
              // 超时自动跳题
              setQi(i=>i+1); setTranscript(""); setTranscriptItems([]); setEditingIdx(-1); setAiRes(null); setPhase("intro"); setDisplayText(""); setEditMode(false); scoreCacheRef.current=null;
              return null;
            }
            return prev-1;
          });
        }, 1000);
      });
      speak(introText, () => {});
    }, 400);
  }, [phase, qi, q]);

  const startRec = async () => {
    navigator.vibrate?.(50);
    if(countdownRef.current){clearInterval(countdownRef.current);countdownRef.current=null;setCountdown(null);}
    try {
      const stream = (audioStreamRef.current?.active)
        ? audioStreamRef.current
        : await navigator.mediaDevices.getUserMedia({audio:{sampleRate:16000,channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
      if(recRef.current === "aborted"){
        recRef.current = null;
        stream.getTracks().forEach(t=>t.stop());
        return;
      }

      // 拿到麦克风权限后立即变红，不等 WebSocket 握手
      setIsRec(true);

      // 建立WebSocket连接到后端代理
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const wsUrl = `${proto}://${location.host}/ws/ali-asr`;
      const ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';

      const audioCtx = new (window.AudioContext||window.webkitAudioContext)({sampleRate:16000});
      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(4096,1,1);

      ws.onopen = () => {
        processor.onaudioprocess = (e) => {
          if(ws.readyState !== WebSocket.OPEN) return;
          const f32 = e.inputBuffer.getChannelData(0);
          const i16 = new Int16Array(f32.length);
          for(let i=0;i<f32.length;i++) i16[i]=Math.max(-32768,Math.min(32767,Math.round(f32[i]*32767)));
          ws.send(i16.buffer);
        };
        source.connect(processor);
        processor.connect(audioCtx.destination);
      };

      const clearRecognizeTimeout = () => {
        if (recognizeTimeoutRef.current) { clearTimeout(recognizeTimeoutRef.current); recognizeTimeoutRef.current = null; }
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if(msg.type === 'partial') {
            setTranscript(msg.text);
            window._streamingTranscript = msg.text;
          } else if(msg.type === 'final') {
            clearRecognizeTimeout();
            setTranscript(msg.text);
            setTranscriptItems(splitToItems(msg.text));
            window._streamingTranscript = msg.text;
            setIsRecognizing(false);
            // 预热评分：识别完成后立即后台请求，结果缓存供提交时直接使用
            const preText = msg.text;
            const preQid = questions[qi]?.id;
            if (preText && preQid) {
              const promise = apiJson("/api/score",{method:"POST",body:JSON.stringify({questionId:preQid,answer:preText})}).catch(()=>null);
              scoreCacheRef.current = { promise, transcript: preText, result: null };
              promise.then(r=>{ if(scoreCacheRef.current?.transcript===preText) scoreCacheRef.current.result=r; });
            }
            if(pendingSubmitRef.current){
              pendingSubmitRef.current = false;
              setTimeout(()=>submitRef.current?.(), 50);
            }
          } else if(msg.type === 'error') {
            clearRecognizeTimeout();
            setTranscript(msg.text);
            window._streamingTranscript = '';
            setIsRecognizing(false);
            pendingSubmitRef.current = false;
          }
        } catch(err){}
      };

      ws.onerror = () => {
        clearRecognizeTimeout();
        setTranscript('连接识别服务失败，请纠正模式手动输入');
        setIsRec(false);
        setIsRecognizing(false);
      };

      ws.onclose = () => {
        clearRecognizeTimeout();
        setIsRecognizing(false);
      };

      recRef.current = {
        stop: () => {
          processor.disconnect(); source.disconnect();
          if (stream !== audioStreamRef.current) stream.getTracks().forEach(t=>t.stop());
          audioCtx.close();
          setIsRec(false);
          setIsRecognizing(true);
          if(ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({type:'stop'}));
          }
          // 超时保护：15秒内未收到 final/error，强制解除识别状态
          recognizeTimeoutRef.current = setTimeout(() => {
            recognizeTimeoutRef.current = null;
            setIsRecognizing(false);
            pendingSubmitRef.current = false;
            try { ws.close(); } catch {}
          }, 15000);
        },
        ws
      };

    } catch(err){
      recRef.current = null;
      setIsRec(false);
      setIsRecognizing(false);
      if(err.name !== "NotAllowedError") alert("无法访问麦克风: "+err.message);
    }
  };

  const stopRec = () => {
    navigator.vibrate?.([30, 50, 30]);
    if(recRef.current && recRef.current !== 'aborted') {
      recRef.current.stop();
      recRef.current = null;
    } else {
      recRef.current = 'aborted';
    }
  };

  const submitWithConfirm = () => {
    setShowSubmitConfirm(true);
  };
  const submit = async () => {
    // 识别还在进行中：挂起提交，等 final 结果回来后自动触发
    if (isRecognizing) {
      pendingSubmitRef.current = true;
      setShowSubmitConfirm(false);
      return;
    }
    const finalTranscript = transcript || window._streamingTranscript;
    window._streamingTranscript = null;
    if (!finalTranscript.trim() || finalTranscript.includes('录音完成')) return;
    setPhase("processing");
    let result;
    const cache = scoreCacheRef.current;
    scoreCacheRef.current = null;
    if (cache && cache.transcript === finalTranscript) {
      // 取预热缓存，若还未返回则等待 promise
      try { result = cache.result ?? await cache.promise; } catch {}
    }
    if (!result) {
      try { result = await apiJson("/api/score",{method:"POST",body:JSON.stringify({questionId:q.id,answer:finalTranscript})}); }
      catch {}
    }
    if (!result) result={score:0,level:"需加强",summary:"评分服务异常",correct_points:[],missing_points:[],suggestion:"请重试",encouragement:"继续加油！",score_method:"error"};
    result.transcript = finalTranscript || result.transcript || transcript;
    setAiRes(result);
    try { await api(`/api/session/${sessionId}/answer`,{method:"POST",body:JSON.stringify({staffId:user.staffId,staffName:user.name,questionId:q.id,questionText:q.text,category:q.category,answerText:finalTranscript||transcript,score:result.score,level:result.level,summary:result.summary,correctPoints:result.correct_points,missingPoints:result.missing_points,suggestion:result.suggestion,scoreMethod:result.score_method})}); } catch {}
    const nr = [...results,{...result,questionText:q.text,category:q.category,qNum:qi+1}];
    setResults(nr);
    speak(`${result.summary}本题${result.score}分。${result.encouragement}`,()=>{});
    setPhase("feedback");
  };
  submitRef.current = submit;


  const next = async () => {
    if (qi+1 >= questions.length) {
      localStorage.removeItem('quiz_inprogress');

      const avg = Math.round(results.reduce((s,r)=>s+r.score,0)/results.length);
      try { const pts = await apiJson(`/api/session/${sessionId}/finish`,{method:"POST",body:JSON.stringify({totalScore:avg,tabSwitchCount:tabSwitchRef.current})}); onDone(results,pts?.points,mode); }
      catch { onDone(results,null,mode); }
    } else { if(countdownRef.current){clearInterval(countdownRef.current);countdownRef.current=null;} setCountdown(null); setQi(i=>i+1); setTranscript(""); setTranscriptItems([]); setEditingIdx(-1); setAiRes(null); setPhase("intro"); setDisplayText(""); setEditMode(false); scoreCacheRef.current=null; }
  };

  const goBack = async () => {
    if (q && sessionId) {
      try {
        await api(`/api/session/${sessionId}/answer`,{method:"POST",body:JSON.stringify({staffId:user.staffId,staffName:user.name,questionId:q.id,questionText:q.text,category:q.category,answerText:'',score:0,level:'需加强',summary:'未作答',correctPoints:[],missingPoints:[],suggestion:'请认真参与',scoreMethod:'skip'})});
        await api(`/api/session/${sessionId}/finish`,{method:"POST",body:JSON.stringify({totalScore:0,tabSwitchCount:tabSwitchRef.current})});
      } catch {}
    }
    // 保留进度标记（带已答题数），主页据此显示「继续作答」而非「已完成」
    if (mode === 'normal') {
      const today = new Date().toISOString().slice(0, 10);
      localStorage.setItem('quiz_inprogress', JSON.stringify({staffId:user.staffId, date:today, answered:qi, total:questions.length}));
    }
    onBack?.();
  };

  if (phase==="loading"||phase==="error") return (
    <div style={{position:"relative",width:"100%",height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12,background:"#080a0c"}}>
      <div style={{position:"absolute",inset:0,backgroundImage:`url(${IMG_TUNNEL})`,backgroundSize:"cover",backgroundPosition:"center",filter:"brightness(0.3)",pointerEvents:"none"}}/>
      <div style={{position:"relative",zIndex:1,textAlign:"center"}}>
        {phase==="error"?<><div style={{fontSize:30}}>⚠</div><div style={{color:"#ef4444",marginTop:8}}>加载失败，请检查服务器</div></>:<><div className="spinner"/><div style={{color:"rgba(255,255,255,0.5)",marginTop:12,fontSize:14}}>加载题目中…</div></>}
      </div>
    </div>
  );
  if (!q) return null;

  const pct = (qi / questions.length) * 100;

  return (
    <div onContextMenu={e=>e.preventDefault()} style={{position:"relative",width:"100%",height:"100vh",display:"flex",flexDirection:"column",overflow:"hidden",background:"#080a0c",height:"100svh"}}>
      {/* 背景：地下隧道 */}
      <div style={{position:"absolute",inset:0,backgroundImage:`url(${IMG_TUNNEL})`,backgroundSize:"cover",backgroundPosition:"center",filter:"brightness(0.32) saturate(0.65)",pointerEvents:"none"}}/>
      <div style={{position:"absolute",inset:0,background:"linear-gradient(180deg,rgba(0,0,0,0.6) 0%,rgba(0,0,0,0.1) 40%,rgba(0,0,0,0.55) 75%,rgba(0,0,0,0.92) 100%)",pointerEvents:"none"}}/>

      {/* 内容 */}
      <div style={{position:"relative",zIndex:10,flex:1,display:"flex",flexDirection:"column",maxWidth:440,margin:"0 auto",width:"100%",overflowY:"auto",WebkitOverflowScrolling:"touch"}}>

        {/* 顶部状态栏 */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 20px 6px"}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <button onClick={()=>setShowBackConfirm(true)} title="返回主页" style={{background:"none",border:"none",color:"rgba(255,255,255,0.45)",fontSize:22,cursor:"pointer",padding:"0 4px 0 0",lineHeight:1,fontWeight:300}}>‹</button>
            <div style={{width:7,height:7,borderRadius:"50%",background:"#c8394b",boxShadow:"0 0 8px rgba(200,57,75,0.7)",animation:"liveDot 2s ease-in-out infinite"}}/>
            <span style={{fontSize:12,fontWeight:500,letterSpacing:1.5,color:"rgba(255,255,255,0.8)"}}>第 {qi+1} 题 / 共 {questions.length} 题</span>
            {isPractice&&<span style={{fontSize:10,fontWeight:700,color:"#f59e0b",background:"rgba(245,158,11,0.15)",border:"1px solid rgba(245,158,11,0.35)",borderRadius:8,padding:"1px 7px",letterSpacing:1}}>练习</span>}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            {tabSwitchCount>0&&<span style={{fontSize:10,fontWeight:700,color:"#ef4444",background:"rgba(239,68,68,0.15)",border:"1px solid rgba(239,68,68,0.3)",borderRadius:8,padding:"1px 6px",letterSpacing:0.5}}>切屏×{tabSwitchCount}</span>}
            {countdown!==null && <span style={{fontSize:13,fontWeight:700,color:countdown<=10?"#ef4444":"#f59e0b",letterSpacing:1}}>{countdown}s</span>}
            <button onClick={()=>setMuted(m=>!m)} title={muted?"点击开启朗读":"点击静音"}
              style={{background:muted?"rgba(255,255,255,0.08)":"rgba(200,57,75,0.2)",border:`1px solid ${muted?"rgba(255,255,255,0.15)":"rgba(200,57,75,0.5)"}`,borderRadius:20,padding:"4px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:5,color:muted?"rgba(255,255,255,0.45)":"#c8394b",fontSize:11,fontWeight:600,transition:"all 0.2s"}}>
              <span style={{fontSize:14}}>{muted?"🔇":"🔊"}</span>
              <span>{muted?"静音":"朗读"}</span>
            </button>
          </div>
        </div>

        {/* 进度条 */}
        <div style={{height:2,background:"rgba(255,255,255,0.08)",margin:"0 20px",borderRadius:2,overflow:"hidden"}}>
          <div style={{height:"100%",width:`${pct}%`,background:"#c8394b",boxShadow:"0 0 8px rgba(200,57,75,0.5)",borderRadius:2,transition:"width 0.6s ease"}}/>
        </div>

        {/* 鱼快快 + 题目区 */}
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",padding:"6px 20px 0"}}>

          {/* 姓名提示 */}
          <div style={{width:"100%",padding:"10px 0 4px",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
            <div style={{width:36,height:36,borderRadius:18,background:"linear-gradient(135deg,#c8394b,#9e2a39)",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,color:"white",fontSize:15,flexShrink:0,boxShadow:"0 4px 12px rgba(200,57,75,0.35)"}}>{user.name?.[0]||"?"}</div>
            <div>
              <div style={{fontSize:15,fontWeight:700,color:"white",letterSpacing:1}}>{user.name}</div>
              <div style={{fontSize:10,color:"rgba(255,255,255,0.4)",letterSpacing:2}}>请回答：</div>
            </div>
            {isSpeaking && (
              <div style={{display:"flex",gap:2.5,alignItems:"flex-end",height:18,marginLeft:4}}>
                {[5,9,13,7,11].map((h,i)=><div key={i} style={{width:3,height:h,background:"#c8394b",borderRadius:2,animation:`barDance 0.5s ease-in-out ${i*0.1}s infinite alternate`}}/>)}
              </div>
            )}
          </div>

          {/* 题目气泡 */}
          <div style={{width:"100%",background:"rgba(8,10,14,0.85)",backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",border:"1px solid rgba(255,255,255,0.1)",borderTop:"none",borderRadius:"0 0 16px 16px",padding:"16px 18px 18px",position:"relative"}}>
            <div style={{position:"absolute",top:-1,left:"50%",transform:"translateX(-50%)",width:36,height:1,background:"rgba(200,57,75,0.7)",boxShadow:"0 0 8px rgba(200,57,75,0.4)"}}/>



            {/* 题目文字 */}
            <div style={{fontSize:18,lineHeight:1.75,color:"rgba(255,255,255,0.85)",letterSpacing:0.3,minHeight:72}}>
              {displayText || (phase==="ready" ? q.text : "")}
              {isSpeaking && <span style={{display:"inline-block",width:2,height:16,background:"#c8394b",marginLeft:2,verticalAlign:"middle",animation:"blink 0.8s step-end infinite"}}/>}
            </div>
          </div>
        </div>

        {/* ── 底部操作区 ── */}
        {phase !== "feedback" ? (
          <div style={{padding:"10px 16px 16px",display:"flex",flexDirection:"column",gap:10}}>
            {/* 录音/识别/结果区 */}
            <div style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:10,padding:"10px 14px",minHeight:90,display:"flex",flexDirection:"column",justifyContent:"center"}}>
              {isRec ? (
                <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:8,padding:"10px 0"}}>
                  <div style={{display:"flex",gap:3,alignItems:"flex-end",height:40}}>
                    {[10,22,34,28,40,32,18,36,26,14].map((h,i)=>(
                      <div key={i} style={{width:4,borderRadius:3,background:"#22c55e",animation:`wave 0.5s ease-in-out ${i*0.07}s infinite alternate`,height:h}}/>
                    ))}
                  </div>
                  <span style={{fontSize:11,color:"#22c55e",letterSpacing:1.5,fontWeight:600}}>录音中，请自然说话…</span>
                </div>
              ) : isRecognizing ? (
                <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:8,padding:"10px 0"}}>
                  <div className="spinner" style={{width:22,height:22}}/>
                  <span style={{fontSize:11,color:"#f59e0b",letterSpacing:1.5,fontWeight:600}}>正在识别…</span>
                </div>
              ) : transcriptItems.length > 0 ? (
                <div>
                  <div style={{fontSize:9,color:"rgba(255,255,255,0.35)",letterSpacing:2,marginBottom:4}}>语音识别结果（仅供参考）</div>
                  <div style={{fontSize:10,color:"rgba(34,197,94,0.7)",marginBottom:7,lineHeight:1.4}}>✓ AI按语义理解评分，识别有误差属正常，不影响最终得分</div>
                  {transcriptItems.map((item,idx)=>(
                    <div key={idx} style={{display:"flex",alignItems:"flex-start",gap:7,padding:"5px 0",borderBottom:idx<transcriptItems.length-1?"1px solid rgba(255,255,255,0.06)":"none"}}>
                      <span style={{fontSize:15,color:"#e8c97a",flexShrink:0,lineHeight:1.55,userSelect:"none"}}>{CIRCLE_NUMS[idx]||`${idx+1}.`}</span>
                      {editingIdx===idx ? (
                        <textarea
                          autoFocus
                          defaultValue={item}
                          onBlur={e=>{
                            const val=e.target.value.trim();
                            const ni=[...transcriptItems]; ni[idx]=val||item;
                            const newT=ni.join('');
                            setTranscriptItems(ni); setTranscript(newT); setEditingIdx(-1);
                            // 文本变了则重新预热
                            if(newT!==scoreCacheRef.current?.transcript && q?.id) {
                              const p2=apiJson("/api/score",{method:"POST",body:JSON.stringify({questionId:q.id,answer:newT})}).catch(()=>null);
                              scoreCacheRef.current={promise:p2,transcript:newT,result:null};
                              p2.then(r=>{if(scoreCacheRef.current?.transcript===newT)scoreCacheRef.current.result=r;});
                            }
                          }}
                          onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();e.target.blur();}}}
                          onCopy={e=>e.preventDefault()}
                          onPaste={e=>e.preventDefault()}
                          onCut={e=>e.preventDefault()}
                          style={{flex:1,background:"rgba(59,130,246,0.1)",border:"1px solid rgba(59,130,246,0.4)",borderRadius:4,color:"rgba(255,255,255,0.9)",fontSize:14,lineHeight:1.6,padding:"2px 6px",fontFamily:"inherit",resize:"none",outline:"none",minHeight:36,WebkitAppearance:"none"}}
                        />
                      ) : (
                        <span
                          onClick={()=>setEditingIdx(idx)}
                          style={{flex:1,fontSize:14,color:"rgba(255,255,255,0.82)",lineHeight:1.6,cursor:"pointer",borderRadius:4,padding:"1px 4px"}}
                        >{item}</span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{display:"flex",flexDirection:"column",gap:6,padding:"6px 0"}}>
                  <div style={{color:"rgba(255,255,255,0.2)",fontSize:14,textAlign:"center"}}>
                    {phase==="intro"?"题目朗读中，稍候…":"点击下方录音按钮开始作答"}
                  </div>
                  {phase!=="intro"&&<div style={{display:"flex",flexDirection:"column",gap:4,background:"rgba(34,197,94,0.05)",border:"1px solid rgba(34,197,94,0.15)",borderRadius:8,padding:"8px 12px"}}>
                    {[
                      ["🎙️","手机靠近嘴巴 20–30cm，声音清晰"],
                      ["🔇","尽量减少周围噪音，背对风口"],
                      ["🗣️","语速放慢，说完整句子再停顿"],
                    ].map(([icon,tip])=>(
                      <div key={tip} style={{display:"flex",gap:7,alignItems:"center"}}>
                        <span style={{fontSize:13,flexShrink:0}}>{icon}</span>
                        <span style={{fontSize:11,color:"rgba(255,255,255,0.4)",lineHeight:1.4}}>{tip}</span>
                      </div>
                    ))}
                  </div>}
                </div>
              )}
            </div>

            {/* ★ 三角按钮区：纠正 / PTT / 提交 */}
            <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",padding:"0 8px",gap:12}}>
              {/* 左：重录 */}
              <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:5,flex:1}}>
                <button
                  onClick={()=>{
                    if(isRec) stopRec();
                    setTranscript(""); setTranscriptItems([]); setEditingIdx(-1);
                    window._streamingTranscript=null; scoreCacheRef.current=null;
                  }}
                  disabled={(!transcript&&transcriptItems.length===0)||isRecognizing||phase==="intro"||phase==="processing"}
                  style={{width:64,height:64,borderRadius:"50%",background:"rgba(255,255,255,0.06)",border:"2px solid rgba(255,255,255,0.15)",cursor:(transcript||transcriptItems.length>0)&&!isRecognizing&&phase!=="intro"&&phase!=="processing"?"pointer":"not-allowed",display:"flex",alignItems:"center",justifyContent:"center",opacity:(transcript||transcriptItems.length>0)&&!isRecognizing?1:0.3,transition:"all 0.2s"}}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.96"/></svg>
                </button>
                <span style={{fontSize:12,fontWeight:600,color:"rgba(255,255,255,0.35)",letterSpacing:1}}>重录</span>
              </div>

              {/* 中：PTT 主按钮 */}
              <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:5}}>
                <button
                  onClick={e=>{
                    e.preventDefault();
                    e.stopPropagation();
                    if(phase==="intro"||phase==="processing"||isRecognizing) return;
                    if(isRec){ stopRec(); } else { startRec(); }
                  }}
                  disabled={phase==="intro"||phase==="processing"}
                  style={{width:96,height:96,borderRadius:"50%",background:isRec?"linear-gradient(135deg,#c8394b,#9e2a39)":isRecognizing?"#374151":"linear-gradient(135deg,#166534,#22c55e)",border:isRec?"3px solid rgba(200,57,75,0.5)":isRecognizing?"3px solid rgba(255,255,255,0.1)":"3px solid rgba(34,197,94,0.4)",cursor:(phase==="intro"||phase==="processing")?"not-allowed":"pointer",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:3,boxShadow:isRec?"0 0 0 10px rgba(200,57,75,0.15),0 0 0 20px rgba(200,57,75,0.07),0 8px 24px rgba(200,57,75,0.4)":"0 0 0 8px rgba(34,197,94,0.08),0 6px 20px rgba(34,197,94,0.25)",transition:"all 0.15s",userSelect:"none",WebkitUserSelect:"none",animation:isRec?"micPulse 1.5s ease-out infinite":"none",touchAction:"none",WebkitTouchCallout:"none"}}>
                  {isRecognizing
                    ? <div style={{width:8,height:8,borderRadius:"50%",background:"#f59e0b",animation:"blink 0.8s step-end infinite"}}/>
                    : isRec
                    ? <svg width="26" height="26" viewBox="0 0 24 24" fill="white"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>
                    : <svg width="26" height="26" viewBox="0 0 24 24" fill="white"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
                  }
                  <span style={{fontSize:13,fontWeight:700,color:"rgba(255,255,255,0.95)",letterSpacing:1,lineHeight:1,maxWidth:68,textAlign:"center",display:"block"}}>{isRec?"点击停止":isRecognizing?"识别中":"点击录音"}</span>
                </button>
                <span style={{fontSize:12,fontWeight:600,color:isRec?"#c8394b":isRecognizing?"#f59e0b":"rgba(255,255,255,0.35)",letterSpacing:1.5}}>{isRec?"录音中…":isRecognizing?"识别中…":"语音输入"}</span>
              </div>

              {/* 右：提交 */}
              <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:5,flex:1}}>
                <button
                  onClick={submitWithConfirm}
                  disabled={transcriptItems.length===0||isRec||isRecognizing||phase==="processing"||phase==="intro"}
                  style={{width:64,height:64,borderRadius:"50%",background:(transcriptItems.length>0&&!isRec&&!isRecognizing&&phase!=="processing"&&phase!=="intro")?"linear-gradient(135deg,#1e3a5f,#3b82f6)":"rgba(255,255,255,0.06)",border:`2px solid ${(transcriptItems.length>0&&!isRec&&!isRecognizing&&phase!=="processing"&&phase!=="intro")?"rgba(59,130,246,0.6)":"rgba(255,255,255,0.1)"}`,cursor:(transcriptItems.length>0&&!isRec&&!isRecognizing&&phase!=="processing"&&phase!=="intro")?"pointer":"not-allowed",display:"flex",alignItems:"center",justifyContent:"center",opacity:(transcriptItems.length>0&&!isRec&&!isRecognizing&&phase!=="processing"&&phase!=="intro")?1:0.3,transition:"all 0.2s",boxShadow:(transcriptItems.length>0&&!isRec&&!isRecognizing&&phase!=="processing"&&phase!=="intro")?"0 4px 16px rgba(59,130,246,0.3)":"none"}}>
                  {phase==="processing"
                    ? <div style={{width:8,height:8,borderRadius:"50%",background:"white",animation:"blink 0.8s step-end infinite"}}/>
                    : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  }
                </button>
                <span style={{fontSize:12,fontWeight:600,color:(transcriptItems.length>0&&!isRec&&!isRecognizing&&phase!=="processing"&&phase!=="intro")?"rgba(255,255,255,0.5)":"rgba(255,255,255,0.2)",letterSpacing:1}}>{phase==="processing"?"分析中":"提交"}</span>
              </div>
            </div>

                        {/* 积分条 */}
            <div style={{display:"flex",justifyContent:"space-around",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:10,padding:"10px 0"}}>
              {[["本题分值","+10"],["今日积分","--"],["班组排名","--"]].map(([lbl,val],i)=>(
                <div key={i} style={{textAlign:"center",flex:1,borderRight:i<2?"1px solid rgba(255,255,255,0.08)":"none"}}>
                  <div style={{fontSize:18,fontWeight:700,color:"#e8c97a",lineHeight:1,marginBottom:3}}>{val}</div>
                  <div style={{fontSize:9,color:"rgba(255,255,255,0.4)",letterSpacing:1.5}}>{lbl}</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          // 反馈页
          aiRes && (
            <div style={{padding:"12px 20px 20px",animation:"slideUp 0.3s ease"}}>
              <div style={{background:"rgba(8,10,14,0.9)",backdropFilter:"blur(16px)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:12,padding:"16px"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                  <div style={{fontSize:36,fontWeight:900,color:"white"}}>{aiRes.score}<span style={{fontSize:13,color:"rgba(255,255,255,0.4)",fontWeight:400}}> 分</span></div>
                  <Badge label={aiRes.level} color={aiRes.level==="优秀"?"#22c55e":aiRes.level==="合格"?"#f59e0b":"#ef4444"}/>
                </div>
                <p style={{fontSize:13,color:"rgba(255,255,255,0.75)",marginBottom:10,lineHeight:1.7}}>{aiRes.summary}</p>
                {/* 标准答案 — 列表化 */}
                {(()=>{const refItems=splitToItems(q.reference||'');return(
                <div style={{marginBottom:10,padding:"10px 12px",background:"rgba(34,197,94,0.08)",border:"1px solid rgba(34,197,94,0.25)",borderRadius:6}}>
                  <div style={{fontSize:11,color:"#22c55e",letterSpacing:1,marginBottom:7,fontWeight:600}}>📋 标准答案</div>
                  {refItems.length>0?refItems.map((item,i)=>(
                    <div key={i} style={{display:"flex",alignItems:"flex-start",gap:8,padding:"4px 0",borderBottom:i<refItems.length-1?"1px solid rgba(34,197,94,0.1)":"none"}}>
                      <span style={{fontSize:14,fontWeight:700,color:"#22c55e",flexShrink:0,minWidth:22,lineHeight:1.6}}>{i+1}.</span>
                      <span style={{fontSize:14,color:"rgba(255,255,255,0.88)",lineHeight:1.6}}>{item}</span>
                    </div>
                  )):<div style={{fontSize:14,color:"rgba(255,255,255,0.7)"}}>{q.reference}</div>}
                </div>
                );})()}
                {/* 用户作答 — 列表化 + 染色 */}
                {(()=>{
                  const uItems=splitToItems(aiRes.transcript||transcript||'');
                  const cp=aiRes.correct_points||[], op=aiRes.order_errors||[], mp=aiRes.missing_points||[];
                  return(
                  <div style={{marginBottom:10,padding:"10px 12px",background:"rgba(59,130,246,0.08)",border:"1px solid rgba(59,130,246,0.25)",borderRadius:6}}>
                    <div style={{fontSize:11,color:"#3b82f6",letterSpacing:1,marginBottom:7,fontWeight:600}}>🎙 您的作答</div>
                    {uItems.length===0&&<div style={{fontSize:14,color:"rgba(255,255,255,0.35)"}}>（未识别到内容）</div>}
                    {uItems.map((item,i)=>{
                      const isCorrect=hasOverlap(item,cp);
                      const isOrder=!isCorrect&&hasOverlap(item,op);
                      const clr=isCorrect?"#22c55e":isOrder?"#f59e0b":"rgba(255,255,255,0.78)";
                      return(
                        <div key={i} style={{display:"flex",alignItems:"flex-start",gap:8,padding:"4px 0",borderBottom:i<uItems.length-1?"1px solid rgba(59,130,246,0.1)":"none"}}>
                          <span style={{fontSize:14,fontWeight:700,color:clr,flexShrink:0,minWidth:22,lineHeight:1.6}}>{CIRCLE_NUMS[i]||`${i+1}.`}</span>
                          <span style={{flex:1,fontSize:14,color:clr,lineHeight:1.6}}>
                            {item}
                            {isOrder&&<span style={{fontSize:11,color:"#f59e0b",marginLeft:6,opacity:0.85}}>→ 顺序有误</span>}
                          </span>
                        </div>
                      );
                    })}
                    {mp.map((p,i)=>(
                      <div key={`m${i}`} style={{display:"flex",alignItems:"flex-start",gap:8,padding:"5px 4px",marginTop:3,background:"rgba(239,68,68,0.08)",borderRadius:4}}>
                        <span style={{fontSize:14,color:"#ef4444",flexShrink:0,lineHeight:1.6}}>✗</span>
                        <span style={{fontSize:14,color:"rgba(239,68,68,0.85)",lineHeight:1.6}}>未提及：{p}</span>
                      </div>
                    ))}
                  </div>
                  );
                })()}
                <div style={{fontSize:12,color:"rgba(255,255,255,0.5)",lineHeight:1.6,marginBottom:6}}>{aiRes.suggestion}</div>
                <div style={{fontSize:12,color:"#e8c97a",fontStyle:"italic",marginBottom:14}}>「{aiRes.encouragement}」</div>
                <div style={{height:16}}></div>
                <button onClick={next} style={{width:"100%",padding:"15px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#c8394b,#9e2a39)",color:"white",fontFamily:"inherit",fontSize:14,fontWeight:700,letterSpacing:2,cursor:"pointer",boxShadow:"0 4px 16px rgba(200,57,75,0.35)",marginBottom:24}}>
                  {qi+1>=questions.length?"查看总结 →":"下一题 →"}
                </button>
              </div>
            </div>
          )
        )}
      </div>

      {phase==="processing"&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",zIndex:100}}><div className="spinner"/><div style={{color:"rgba(255,255,255,0.5)",marginTop:12,fontSize:14}}>AI 分析中…</div></div>}

      {showSubmitConfirm&&<AppModal icon="📝" title="准备提交" body={"确认提交当前语音作答？\nAI将按语义理解评分，\n识别文字有偏差不影响得分。"} buttons={[{label:"再想想",onClick:()=>setShowSubmitConfirm(false)},{label:"提交",onClick:()=>{setShowSubmitConfirm(false);submit();},primary:true}]}/>}
      {showBackConfirm&&<AppModal icon="⚠️" title="确认返回？" body={"本题尚未完成作答，\n返回将记零分并结束本次答题。"} buttons={[{label:"继续答题",onClick:()=>setShowBackConfirm(false)},{label:"记零分返回",onClick:()=>{setShowBackConfirm(false);goBack();},danger:true}]}/>}
      {showTabWarn&&<AppModal icon="👀" title={`检测到切屏 ${tabSwitchCount} 次`} body="请专注答题，切屏次数已被记录。" buttons={[{label:"我知道了",onClick:()=>setShowTabWarn(false),primary:true}]}/>}
    </div>
  );
}

// ─── 答题历史 ────────────────────────────────────────────────────────────────
function HistoryScreen({ user, onBack }) {
  const [records,setRecords]=useState([]);
  const [loading,setLoading]=useState(true);
  useEffect(()=>{
    apiJson(`/api/me/${user.staffId}/answers`).then(d=>{
      setRecords(d||[]);
      setLoading(false);
    }).catch(()=>setLoading(false));
  },[]);
  return (
    <div className="screen" style={{padding:'16px'}}>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16}}>
        <button onClick={onBack} style={{background:'none',border:'none',color:'#3b82f6',fontSize:22,cursor:'pointer',padding:'0 4px'}}>←</button>
        <span style={{fontSize:15,fontWeight:700,color:'white'}}>我的答题历史</span>
      </div>
      {loading&&<div style={{color:'#64748b',textAlign:'center',marginTop:40}}>加载中…</div>}
      {!loading&&records.length===0&&<div style={{color:'#475569',textAlign:'center',marginTop:40,fontSize:13}}>暂无答题记录</div>}
      {records.map((r,i)=>(
        <div key={i} className="card" style={{marginBottom:10,padding:'12px 14px'}}>
          <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
            <span style={{fontSize:12,color:'#64748b'}}>{r.created_at?new Date(r.created_at).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'--'}</span>
            <span style={{fontWeight:700,color:r.score>=80?'#22c55e':r.score>=60?'#f59e0b':'#ef4444',fontSize:14}}>{r.score??'--'} 分</span>
          </div>
          <div style={{fontSize:13,color:'#cbd5e1',marginBottom:4,lineHeight:1.5}}>{r.question_text||'（无题目记录）'}</div>
          <div style={{fontSize:11,color:'#475569',marginBottom:r.level?4:0}}>答：{r.answer_text||'--'}</div>
          {r.level&&<Badge label={r.level} color={r.level==='优秀'?'#22c55e':r.level==='合格'?'#f59e0b':'#ef4444'}/>}
        </div>
      ))}
    </div>
  );
}

// ─── 题库预览 ────────────────────────────────────────────────────────────────
function BanksPreviewScreen({ onBack }) {
  const [banks,setBanks]=useState([]);
  const [questions,setQuestions]=useState([]);
  const [selBank,setSelBank]=useState(null);
  const [loading,setLoading]=useState(false);
  useEffect(()=>{
    apiJson('/api/banks').then(b=>{
      setBanks(b);
      const active=b.find(x=>x.is_active);
      if(active){setSelBank(active.id);fetchQ(active.id);}
    }).catch(()=>{});
  },[]);
  const fetchQ=(bankId)=>{
    setLoading(true);
    apiJson(`/api/questions?bank_id=${bankId}&limit=100`).then(d=>{
      setQuestions(d||[]);
      setLoading(false);
    }).catch(()=>setLoading(false));
  };
  return (
    <div className="screen" style={{padding:'16px'}}>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16}}>
        <button onClick={onBack} style={{background:'none',border:'none',color:'#3b82f6',fontSize:22,cursor:'pointer',padding:'0 4px'}}>←</button>
        <span style={{fontSize:15,fontWeight:700,color:'white'}}>题库预览</span>
      </div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:14}}>
        {banks.map(b=>(
          <button key={b.id} onClick={()=>{setSelBank(b.id);fetchQ(b.id);}}
            style={{padding:'6px 14px',borderRadius:20,border:'none',background:selBank===b.id?'#3b82f6':'#1b3255',color:'white',fontSize:12,cursor:'pointer',fontWeight:selBank===b.id?700:400}}>
            {b.name}{b.is_active?' ✓':''}
          </button>
        ))}
      </div>
      {loading&&<div style={{color:'#64748b',textAlign:'center',marginTop:40}}>加载中…</div>}
      {!loading&&questions.length===0&&<div style={{color:'#475569',textAlign:'center',marginTop:40,fontSize:13}}>该题库暂无题目</div>}
      {questions.map((q,i)=>(
        <div key={i} className="card" style={{marginBottom:10,padding:'12px 14px'}}>
          <div style={{display:'flex',gap:8,marginBottom:6}}>
            <span style={{fontSize:10,color:'#64748b',background:'#1b3255',padding:'2px 8px',borderRadius:10}}>{q.category||'--'}</span>
            <span style={{fontSize:10,color:'#64748b'}}>难度 {q.difficulty||'--'}</span>
          </div>
          <div style={{fontSize:13,color:'#cbd5e1',lineHeight:1.6,marginBottom:6}}>{q.text||q.question_text}</div>
          {q.reference&&<div style={{fontSize:11,color:'#475569',lineHeight:1.5}}>参考：{q.reference}</div>}
        </div>
      ))}
    </div>
  );
}

// HOME
function HomeScreen({ user, nav }) {
  const [me, setMe] = useState(null);
  const [lbCycle, setLbCycle] = useState([]);
  const [lbTotal, setLbTotal] = useState([]);
  const [lbCycleFull, setLbCycleFull] = useState([]);
  const [lbTotalFull, setLbTotalFull] = useState([]);
  const [cycleInfo, setCycleInfo] = useState(null);
  const [lbModal, setLbModal] = useState(null);
  const [lbDetail, setLbDetail] = useState(null);
  const [lbDetailLoading, setLbDetailLoading] = useState(false);
  const [showAllCycle, setShowAllCycle] = useState(false);
  const [showAllTotal, setShowAllTotal] = useState(false);
  const [periodDone, setPeriodDone] = useState(0);
  const [periodTotal, setPeriodTotal] = useState(0);
  const [activeBank, setActiveBank] = useState(null);
  const [pinnedInfo, setPinnedInfo] = useState(null);
  const [taskDone, setTaskDone] = useState(false);
  const [isExempt, setIsExempt] = useState(false);
  const [quizInProgress, setQuizInProgress] = useState(null); // null or {answered, total}

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    try {
      const ip = JSON.parse(localStorage.getItem('quiz_inprogress') || 'null');
      if (ip && ip.staffId === user.staffId && ip.date === today) {
        setQuizInProgress({ answered: ip.answered ?? 0, total: ip.total ?? 3 });
      }
    } catch {}

    apiJson(`/api/me/${user.staffId}`).then(d => {
      setMe(d);
      const exempt = !!(d.staff && d.staff.is_exempt);
      const isTester = !!(d.staff && d.staff.is_tester);
      setIsExempt(exempt);
      if (!exempt && !isTester) {
        const today2 = new Date().toISOString().slice(0, 10);
        const doneToday = (d.recent || []).some(r => r.created_at && r.created_at.slice(0, 10) === today2);
        setTaskDone(doneToday);
      }
    }).catch(() => {});

    apiJson('/api/leaderboard/cycle').then(d => {
      const rows = d.rows || [];
      setLbCycle(rows.slice(0, 3));
      setLbCycleFull(rows);
      setCycleInfo(d.cycle || null);
    }).catch(() => {});
    apiJson('/api/leaderboard/alltime').then(d => {
      const rows = Array.isArray(d) ? d : (d.rows || []);
      setLbTotal(rows.slice(0, 3));
      setLbTotalFull(rows);
    }).catch(() => {});

    fetch('/api/admin/members', { headers: { 'x-admin-password': 'admin888' } })
      .then(r => r.json()).then(members => {
        const nonExempt = members.filter(m => !m.is_exempt);
        setPeriodTotal(nonExempt.length);
        setPeriodDone(nonExempt.filter(m => m.answer_days >= 1).length);
      }).catch(() => {});

    apiJson('/api/banks').then(banks => {
      setActiveBank(banks.find(b => b.is_default) || banks.find(b => b.is_active) || banks[0]);
    }).catch(() => {});

    fetch('/api/admin/pinned-questions', { headers: { 'x-admin-password': 'admin888' } })
      .then(r => r.json()).then(p => {
        const todayStr = new Date().toISOString().slice(0, 10);
        const active = p.ids?.length > 0 && (
          (p.scope === 'today' && p.created_date === todayStr) || p.scope === 'shift'
        );
        setPinnedInfo(active ? p : null);
      }).catch(() => {});
  }, [user.staffId]);

  const getShiftDeadline = () => {
    const now = new Date();
    const base = new Date('2026-03-22');
    const diff = Math.floor((now - base) / 86400000);
    const phaseDay = ((diff % 4) + 4) % 4;
    const startD = new Date(now); startD.setDate(startD.getDate() - phaseDay);
    const endD = new Date(startD); endD.setDate(endD.getDate() + 2);
    const fmt = d => `${d.getMonth()+1}月${d.getDate()}日`;
    return `${fmt(startD)} — ${fmt(endD)} 09:00 截止`;
  };

  const getMonthRange = () => {
    const now = new Date();
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return `${now.getMonth()+1}月1日 — ${now.getMonth()+1}月${last.getDate()}日`;
  };

  const rankIcon = i => ['🥇','🥈','🥉'][i] || (i+1);
  const rankCls  = i => ['r1','r2','r3'][i] || 'rn';

  const myPoints = me?.stats?.total_points ?? 0;
  const myAvg    = Math.round(me?.stats?.avg_score ?? 0);
  const quizPts  = Math.max(0, myPoints - (myPoints > 0 ? 10 : 0));
  const bonusPts = myPoints > 0 ? 10 : 0;

  const SectionCard = ({ children, style }) => (
    <div style={{
      margin: '0 12px 14px',
      background: 'var(--card)',
      border: '1px solid var(--border)',
      borderRadius: 16,
      overflow: 'hidden',
      ...style
    }}>{children}</div>
  );

  const SecHeader = ({ title }) => (
    <div style={{
      padding: '10px 14px 8px',
      borderBottom: '1px solid var(--border)',
      fontSize: 10,
      color: 'var(--muted)',
      letterSpacing: '2.5px',
      textTransform: 'uppercase',
      fontWeight: 600,
    }}>{title}</div>
  );

  const HalfDivider = () => (
    <div style={{ width: 1, background: 'var(--border)', borderLeft: '1px dashed #2a4060', alignSelf: 'stretch' }} />
  );

  const lbEmpty = <div style={{ fontSize:11, color:'var(--muted)', textAlign:'center', padding:'14px 0' }}>暂无数据</div>;

  return (
    <div className="screen" style={{ background:'var(--bg)', paddingBottom:28 }}>

      {/* ── 顶部欢迎 ── */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'18px 16px 6px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          {me?.staff?.avatar
            ? <img src={me.staff.avatar} style={{width:38,height:38,borderRadius:'50%',objectFit:'cover',border:'2px solid rgba(200,168,75,.5)',flexShrink:0}}/>
            : <div style={{width:38,height:38,borderRadius:'50%',background:'linear-gradient(135deg,var(--blue),#0ea5e9)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:15,fontWeight:700,color:'white',flexShrink:0}}>{(user.name||user.staffId)?.[0]}</div>
          }
          <div style={{ fontSize:16, fontWeight:700, color:'var(--text)' }}>
            你好，<span style={{ color:'var(--gold)' }}>{user.name || user.staffId}</span>
            {isExempt && <span style={{ marginLeft:6, fontSize:10, color:'var(--muted)', fontWeight:400, verticalAlign:'middle' }}>班组长</span>}
          </div>
        </div>
        <div style={{
          background:'rgba(200,168,75,.12)', border:'1px solid rgba(200,168,75,.35)',
          borderRadius:20, padding:'4px 13px', fontSize:11, color:'var(--gold)', fontWeight:700
        }}>本期 {periodDone}/{periodTotal} 已完成</div>
      </div>

      {/* ══ 板块一：任务中心 ══ */}
      <SectionCard style={{ marginTop:14 }}>
        <SecHeader title="任务中心" />
        <div style={{ display:'flex' }}>

          {/* 左：班组任务 */}
          <div style={{ flex:1, padding:'12px 14px', display:'flex', flexDirection:'column', gap:8 }}>
            <div>
              <div style={{ fontSize:12, fontWeight:700, color:'var(--text)' }}>班组任务</div>
              <div style={{ fontSize:9, color:'var(--muted)', marginTop:2 }}>{getShiftDeadline()}</div>
            </div>
            <div style={{
              flex:1, background:'#081828', border:'1px solid var(--border)',
              borderRadius:8, padding:'9px 10px', fontSize:11, color:'var(--text)', lineHeight:1.6, minHeight:48
            }}>
              {pinnedInfo && pinnedInfo.questions?.length > 0
                ? (() => {
                    const catMap = {};
                    pinnedInfo.questions.forEach(q => {
                      const c = q.category || '业务知识';
                      catMap[c] = (catMap[c] || 0) + 1;
                    });
                    const summary = Object.entries(catMap).map(([c, n]) => `${n}个${c}`).join('，');
                    return (
                      <div style={{display:'flex',flexDirection:'column',gap:4}}>
                        <div style={{color:'#22c55e',fontWeight:700,fontSize:10}}>📌 今日指定题目</div>
                        <div style={{color:'#e2e8f0',fontSize:12,fontWeight:600,lineHeight:1.5}}>{summary}</div>
                      </div>
                    );
                  })()
                : activeBank ? activeBank.name : '加载中…'}
            </div>
            {quizInProgress
              ? <button onClick={() => { localStorage.removeItem('quiz_inprogress'); setQuizInProgress(null); nav('quiz'); }} style={{ width:'100%', padding:'9px', borderRadius:8, border:'1px solid rgba(200,57,75,.5)', cursor:'pointer', background:'linear-gradient(135deg,#7a1a24,#c8394b)', color:'white', fontSize:11, fontWeight:800, fontFamily:'var(--font)', letterSpacing:'0.5px' }}>已完成 {quizInProgress.answered}/{quizInProgress.total}，继续作答 ›</button>
              : taskDone
              ? <button className="btn-done" style={{ width:'100%', padding:'9px', borderRadius:8, border:'1px solid rgba(34,197,94,.4)', background:'rgba(34,197,94,.08)', color:'var(--green)', fontSize:11, fontWeight:700, fontFamily:'var(--font)' }}>✓ 今日已完成</button>
              : <button onClick={() => nav('quiz')} style={{ width:'100%', padding:'9px', borderRadius:8, border:'none', cursor:'pointer', background:'linear-gradient(135deg,#9a6f10,#c8a84b)', color:'#07101f', fontSize:12, fontWeight:800, fontFamily:'var(--font)', letterSpacing:'1px' }}>开始抽问</button>
            }
          </div>

          <HalfDivider />

          {/* 右：车间任务 */}
          <div style={{ flex:1, padding:'12px 14px', display:'flex', flexDirection:'column', gap:8 }}>
            <div>
              <div style={{ fontSize:12, fontWeight:700, color:'var(--text)' }}>车间任务</div>
              <div style={{ fontSize:9, color:'var(--muted)', marginTop:2 }}>{getMonthRange()}</div>
            </div>
            <div style={{
              flex:1, background:'#081828', border:'1px solid var(--border)',
              borderRadius:8, padding:'9px 10px', fontSize:10, color:'var(--muted)', lineHeight:1.8, minHeight:48
            }}>月度实操巩固练习</div>
            <button onClick={() => alert('待开发，敬请期待')} style={{
              width:'100%', padding:'9px', borderRadius:8,
              border:'1px dashed rgba(100,116,139,.4)', background:'transparent',
              color:'var(--muted)', fontSize:11, fontFamily:'var(--font)', cursor:'pointer'
            }}>开始提前巩固</button>
          </div>

        </div>
      </SectionCard>

      {/* ══ 板块二：个人中心 ══ */}
      <SectionCard>
        <SecHeader title="个人中心" />
        <div style={{ display:'flex' }}>

          {/* 左：积分详情 */}
          <div style={{ flex:1, padding:'14px 14px 14px' }}>
            <div style={{ fontSize:36, fontWeight:900, color:'var(--gold)', lineHeight:1, letterSpacing:-1 }}>
              {myPoints}<span style={{ fontSize:11, color:'var(--muted)', marginLeft:2, fontWeight:400 }}>分</span>
            </div>
            <div style={{ fontSize:9, color:'var(--muted)', marginTop:3, marginBottom:12 }}>本期累计积分</div>
            <div style={{ borderTop:'1px solid var(--border)', paddingTop:10, display:'flex', flexDirection:'column', gap:7 }}>
              {[
                ['抽问得分', quizPts, 'var(--gold)'],
                ['巩固附加分', `+${bonusPts}`, 'var(--green)'],
                ['平均分', myAvg, 'var(--text)'],
              ].map(([label, val, color]) => (
                <div key={label} style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span style={{ fontSize:11, color:'var(--muted)' }}>{label}</span>
                  <span style={{ fontSize:12, fontWeight:700, color }}>{val}</span>
                </div>
              ))}
            </div>
          </div>

          <HalfDivider />

          {/* 右：功能入口 */}
          <div style={{ flex:1, padding:'14px 14px', display:'flex', flexDirection:'column', gap:7 }}>
            {[
              { label:'答题历史', val: null,     action: () => nav('history'), dev: false },
              { label:'我的分析', val: null,     action: () => nav('profile'), dev: false  },
              { label:'练习强化', val: null,     action: () => nav('practice'), dev: false },
            ].map(({ label, val, action, dev }) => (
              <div key={label} onClick={action} style={{
                flex:1, display:'flex', alignItems:'center', justifyContent:'space-between',
                padding:'0 11px', background:'#081828', borderRadius:9,
                border:'1px solid transparent', cursor: dev ? 'default' : 'pointer',
                opacity: dev ? 0.6 : 1, transition:'border-color .2s', minHeight:40,
              }}
                onMouseEnter={e => { if (!dev) e.currentTarget.style.borderColor='rgba(59,130,246,.4)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor='transparent' }}
              >
                <span style={{ fontSize:12, color:'var(--text)' }}>{label}</span>
                {dev
                  ? <span style={{ fontSize:9, color:'var(--muted)' }}>待开发</span>
                  : val !== null
                    ? <span style={{ fontSize:12, fontWeight:700, color:'var(--gold)' }}>{val}</span>
                    : <span style={{ fontSize:11, color:'var(--muted)' }}>›</span>
                }
              </div>
            ))}
          </div>

        </div>
      </SectionCard>

      {/* ══ 板块三：积分榜 ══ */}
      {lbModal && (
        <div onClick={()=>{setLbModal(null);setLbDetail(null);}} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',zIndex:200,display:'flex',alignItems:'flex-end',justifyContent:'center'}}>
          <div onClick={e=>e.stopPropagation()} style={{width:'100%',maxWidth:440,background:'#0d1e35',border:'1px solid rgba(59,130,246,0.3)',borderRadius:'16px 16px 0 0',padding:'20px 16px 32px',maxHeight:'75vh',overflowY:'auto'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:14}}>
              <div style={{display:'flex',gap:10,alignItems:'flex-start'}}>
                {lbDetail?.sessions?.[0]?.avatar
                  ? <img src={lbDetail.sessions[0].avatar} style={{width:44,height:44,borderRadius:'50%',objectFit:'cover',flexShrink:0,border:'2px solid rgba(59,130,246,0.4)'}}/>
                  : <div style={{width:44,height:44,borderRadius:'50%',background:'linear-gradient(135deg,#1e3a5f,#3b82f6)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,fontWeight:700,color:'white',flexShrink:0}}>{lbModal.staffName?.[0]}</div>
                }
                <div>
                  <div style={{fontSize:15,fontWeight:700,color:'white'}}>{lbModal.staffName}</div>
                  <div style={{fontSize:10,color:'#64748b',marginTop:2}}>{lbModal.type==='cycle'?'轮班答题记录':'本月答题记录'}</div>
                </div>
              </div>
              <button onClick={()=>{setLbModal(null);setLbDetail(null);}} style={{background:'none',border:'1px solid #1b3255',color:'#64748b',borderRadius:6,padding:'4px 10px',cursor:'pointer',fontSize:12,flexShrink:0}}>关闭</button>
            </div>
            {lbDetailLoading&&<div style={{textAlign:'center',padding:'20px 0'}}><div className="spinner" style={{margin:'0 auto'}}/></div>}
            {!lbDetailLoading&&lbDetail&&lbDetail.sessions?.length===0&&<div style={{color:'#475569',fontSize:13,textAlign:'center',padding:'20px 0'}}>暂无答题记录</div>}
            {!lbDetailLoading&&lbDetail?.sessions?.map((s,si)=>(
              <div key={si} style={{marginBottom:12,background:'rgba(15,38,66,0.6)',border:'1px solid #1b3255',borderRadius:10,padding:'12px 14px'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                  <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                    <span style={{fontSize:11,color:'#64748b'}}>{s.created_at?.slice(5,10)}{s.cycle_label?` · ${s.cycle_label}`:''}</span>
                    {s.tab_switch_count>0&&<span style={{fontSize:10,color:'#ef4444',background:'rgba(239,68,68,0.12)',border:'1px solid rgba(239,68,68,0.3)',borderRadius:4,padding:'0 5px',fontWeight:700}}>切屏×{s.tab_switch_count}</span>}
                  </div>
                  <div style={{display:'flex',gap:8,alignItems:'center'}}>
                    <span style={{fontSize:12,fontWeight:700,color:'white'}}>{s.total_score}分</span>
                    <span style={{fontSize:11,color:'#c8a84b'}}>+{s.total_points}积分</span>
                  </div>
                </div>
                {s.answers?.map((a,ai)=>(
                  <div key={ai} style={{padding:'6px 0',borderTop:'1px solid rgba(27,50,85,0.5)',display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
                    <span style={{fontSize:11,color:'rgba(255,255,255,0.7)',flex:1,lineHeight:1.5}}>{a.question_text}</span>
                    <span style={{fontSize:12,fontWeight:700,flexShrink:0,color:a.score>=99?'#22c55e':a.score>=67?'#f59e0b':'#ef4444'}}>{Math.round(a.score*33/100)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
      <SectionCard>
        <SecHeader title="积分榜" />
        <div style={{ display:'flex' }}>
          <div style={{ flex:1, padding:'12px 14px' }}>
            <div style={{ fontSize:11, fontWeight:700, color:'var(--text)', marginBottom:2 }}>轮班榜</div>
            <div style={{ fontSize:9, color:'var(--muted)', marginBottom:8 }}>
              {cycleInfo?.label || ''}
            </div>
            {lbCycleFull.length === 0 ? lbEmpty : (showAllCycle ? lbCycleFull : lbCycleFull.slice(0,3)).map((r, i) => (
              <div key={r.staff_id} onClick={async()=>{
                setLbModal({type:'cycle',staffId:r.staff_id,staffName:r.staff_name});
                setLbDetail(null); setLbDetailLoading(true);
                const d = await apiJson(`/api/leaderboard/cycle/member/${r.staff_id}`).catch(()=>null);
                setLbDetail(d); setLbDetailLoading(false);
              }} style={{ display:'flex', alignItems:'center', gap:7, padding:'6px 0', borderBottom: i < lbCycleFull.length-1 ? '1px solid rgba(27,50,85,.7)' : 'none', cursor:'pointer' }}>
                <span style={{ width:18, fontSize: i < 3 ? 13 : 11, textAlign:'center', flexShrink:0,
                  color: ['#ffd700','#b0b8c8','#cd7f32'][i] || 'var(--muted)' }}>{rankIcon(i)}</span>
                {r.avatar
                  ? <img src={r.avatar} style={{width:20,height:20,borderRadius:'50%',objectFit:'cover',flexShrink:0}}/>
                  : <div style={{width:20,height:20,borderRadius:'50%',background:'linear-gradient(135deg,#1e3a5f,#3b82f6)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,fontWeight:700,color:'white',flexShrink:0}}>{r.staff_name?.[0]}</div>
                }
                <span style={{ flex:1, fontSize:11, color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.staff_name}</span>
                <span style={{ fontSize:11, fontWeight:700, color:'var(--gold)', flexShrink:0 }}>{r.total_points}</span>
              </div>
            ))}
            {lbCycleFull.length > 3 && (
              <div onClick={()=>setShowAllCycle(v=>!v)} style={{textAlign:'center',marginTop:8,fontSize:13,color:'#60a5fa',cursor:'pointer',fontWeight:600,letterSpacing:0.5}}>
                {showAllCycle ? '收起 ▲' : `查看全部 ${lbCycleFull.length} 人 ▼`}
              </div>
            )}
          </div>
          <HalfDivider />
          <div style={{ flex:1, padding:'12px 14px' }}>
            <div style={{ fontSize:11, fontWeight:700, color:'var(--text)', marginBottom:10 }}>总积分榜</div>
            {lbTotalFull.length === 0 ? lbEmpty : (showAllTotal ? lbTotalFull : lbTotalFull.slice(0,3)).map((r, i) => (
              <div key={r.staff_id} onClick={async()=>{
                setLbModal({type:'total',staffId:r.staff_id,staffName:r.staff_name});
                setLbDetail(null); setLbDetailLoading(true);
                const d = await apiJson(`/api/leaderboard/alltime/member/${r.staff_id}`).catch(()=>null);
                setLbDetail(d); setLbDetailLoading(false);
              }} style={{ display:'flex', alignItems:'center', gap:7, padding:'6px 0', borderBottom: i < lbTotalFull.length-1 ? '1px solid rgba(27,50,85,.7)' : 'none', cursor:'pointer' }}>
                <span style={{ width:18, fontSize: i < 3 ? 13 : 11, textAlign:'center', flexShrink:0,
                  color: ['#ffd700','#b0b8c8','#cd7f32'][i] || 'var(--muted)' }}>{rankIcon(i)}</span>
                {r.avatar
                  ? <img src={r.avatar} style={{width:20,height:20,borderRadius:'50%',objectFit:'cover',flexShrink:0}}/>
                  : <div style={{width:20,height:20,borderRadius:'50%',background:'linear-gradient(135deg,#1e3a5f,#3b82f6)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,fontWeight:700,color:'white',flexShrink:0}}>{r.staff_name?.[0]}</div>
                }
                <span style={{ flex:1, fontSize:11, color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.staff_name}</span>
                <span style={{ fontSize:11, fontWeight:700, color:'var(--gold)', flexShrink:0 }}>{r.total_points}</span>
              </div>
            ))}
            {lbTotalFull.length > 3 && (
              <div onClick={()=>setShowAllTotal(v=>!v)} style={{textAlign:'center',marginTop:8,fontSize:13,color:'#60a5fa',cursor:'pointer',fontWeight:600,letterSpacing:0.5}}>
                {showAllTotal ? '收起 ▲' : `查看全部 ${lbTotalFull.length} 人 ▼`}
              </div>
            )}
          </div>
        </div>
      </SectionCard>

      <div style={{ textAlign:'center' }}>
        <button onClick={() => nav('admin')} style={{ background:'none', border:'none', color:'var(--muted)', fontSize:11, cursor:'pointer', textDecoration:'underline', fontFamily:'var(--font)' }}>管理员后台</button>
      </div>

    </div>
  );
}

function ResultScreen({ user, results, points, onHome, mode='normal', onContinuePractice }) {
  const avg=results.length?Math.min(100,Math.round(results.reduce((s,r)=>s+r.score,0)/results.length)):0;
  const col=avg>=85?'#22c55e':avg>=60?'#f59e0b':'#ef4444';
  const isPractice = mode !== 'normal';
  return(
    <div className="screen" style={{padding:'32px 16px',alignItems:'center'}}>
      <div style={{fontSize:36,marginBottom:8}}>{isPractice?'📝':'🎯'}</div>
      <div style={{fontSize:20,fontWeight:700,color:'white',marginBottom:4}}>{isPractice?'练习完成！':'答题完成！'}</div>
      <div style={{fontSize:12,color:'#64748b',marginBottom:24}}>{user.name} · {results.length}题 · {new Date().toLocaleDateString('zh-CN')}</div>
      <ScoreRing score={avg} size={110}/>
      <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginTop:4,letterSpacing:1}}>{results.length}题综合均分</div>
      {isPractice&&points&&(
        <div style={{margin:'20px 0',padding:'12px 20px',background:'rgba(245,158,11,0.08)',border:'1px solid rgba(245,158,11,0.25)',borderRadius:12,textAlign:'center'}}>
          {points.practiceBonus>0
            ? <><div style={{fontSize:14,fontWeight:700,color:'#f59e0b'}}>+1 练习加分已获得</div>
                <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginTop:4}}>本月已用 {points.practiceUsed} / {points.practiceMax} 次加分机会</div></>
            : <><div style={{fontSize:14,fontWeight:600,color:'rgba(255,255,255,0.5)'}}>本月练习加分已用完</div>
                <div style={{fontSize:11,color:'rgba(255,255,255,0.3)',marginTop:4}}>下月继续加油（每月最多 +3 分）</div></>
          }
        </div>
      )}
      {!isPractice&&points&&(
        <div style={{display:'flex',gap:12,margin:'20px 0',padding:'14px 20px',background:'#0d1e35',border:'1px solid #1b3255',borderRadius:12}}>
          <div style={{textAlign:'center'}}><div style={{fontSize:18,fontWeight:700,color:'white'}}>{points.base}</div><div style={{fontSize:11,color:'#64748b'}}>基础积分</div></div>
          <div style={{fontSize:18,color:'#1b3255',alignSelf:'center'}}>+</div>
          <div style={{textAlign:'center'}}><div style={{fontSize:18,fontWeight:700,color:'#c8a84b'}}>{points.bonus}</div><div style={{fontSize:11,color:'#64748b'}}>优秀加分</div></div>
          <div style={{fontSize:18,color:'#1b3255',alignSelf:'center'}}>=</div>
          <div style={{textAlign:'center'}}><div style={{fontSize:22,fontWeight:900,color:'#22c55e'}}>{points.total}</div><div style={{fontSize:11,color:'#64748b'}}>本次积分</div></div>
        </div>
      )}
      <div style={{width:'100%',maxWidth:380,marginBottom:24}}>
        {results.map((r,i)=>(
          <div key={i} style={{background:'#0f2642',border:'1px solid #1b3255',borderRadius:10,padding:'12px 14px',marginBottom:8}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:5}}>
              <span style={{fontSize:11,color:'#64748b'}}>第{r.qNum}题 · {r.category}</span>
              <div style={{display:'flex',gap:6,alignItems:'center'}}><Badge label={r.level} color={r.level==='优秀'?'#22c55e':r.level==='合格'?'#f59e0b':'#ef4444'}/><span style={{fontWeight:700,color:r.score>=99?'#22c55e':r.score>=67?'#f59e0b':'#ef4444'}}>{Math.round(r.score*33/100)}<span style={{fontSize:10,color:'rgba(255,255,255,0.4)',fontWeight:400}}>/33分</span></span></div>
            </div>
            <div style={{fontSize:12,color:'#94a3b8'}}>{r.questionText}</div>
            {r.missing_points?.length>0&&<div style={{fontSize:11,color:'#ef4444',marginTop:5}}>遗漏：{r.missing_points.join('、')}</div>}
          </div>
        ))}
      </div>
      {isPractice?(
        <div style={{width:'100%',maxWidth:380,display:'flex',flexDirection:'column',gap:10}}>
          <button className="btn-primary" onClick={onContinuePractice} style={{background:'linear-gradient(135deg,#92400e,#f59e0b)'}}>继续练习</button>
          <button onClick={onHome} style={{padding:'13px',borderRadius:10,border:'1px solid #1b3255',background:'none',color:'rgba(255,255,255,0.45)',fontSize:14,cursor:'pointer',fontFamily:'var(--font)'}}>返回首页</button>
        </div>
      ):(
        <button className="btn-primary" style={{maxWidth:380}} onClick={onHome}>返回首页</button>
      )}
    </div>
  );
}

// ─── 练习强化 ────────────────────────────────────────────────────────────────
function PracticeScreen({ user, onBack, onStart }) {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    apiJson(`/api/practice/monthly-status/${user.staffId}`).then(setStatus).catch(()=>{});
  }, []);

  const bonusLeft = status ? status.max - status.used : null;

  return (
    <div className="screen" style={{padding:'16px'}}>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:20}}>
        <button onClick={onBack} style={{background:'none',border:'none',color:'#3b82f6',fontSize:22,cursor:'pointer',padding:'0 4px'}}>←</button>
        <span style={{fontSize:16,fontWeight:700,color:'white'}}>练习强化</span>
      </div>

      {/* 月度加分状态 */}
      <div style={{background:'rgba(245,158,11,0.08)',border:'1px solid rgba(245,158,11,0.2)',borderRadius:14,padding:'14px 16px',marginBottom:16,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <div>
          <div style={{fontSize:12,color:'rgba(255,255,255,0.5)',marginBottom:4}}>本月练习加分</div>
          <div style={{fontSize:11,color:'rgba(255,255,255,0.35)'}}>每完成一次练习 +1 分，每月最多 +3 分</div>
        </div>
        <div style={{textAlign:'center',minWidth:52}}>
          {status
            ? <><div style={{fontSize:26,fontWeight:900,color:'#f59e0b',lineHeight:1}}>{status.used}</div>
                <div style={{fontSize:10,color:'rgba(255,255,255,0.3)',marginTop:2}}>/ 3 分</div></>
            : <div style={{width:28,height:28,border:'2px solid rgba(245,158,11,0.3)',borderTop:'2px solid #f59e0b',borderRadius:'50%',animation:'spin 0.8s linear infinite',margin:'0 auto'}}/>
          }
        </div>
      </div>

      {/* 应急抽问 */}
      <div onClick={()=>onStart('practice_random')} style={{background:'linear-gradient(135deg,#0d2d5a,#1a4a8a)',border:'1px solid rgba(59,130,246,0.4)',borderRadius:14,padding:'18px',marginBottom:12,cursor:'pointer',transition:'transform .15s'}}
        onMouseEnter={e=>e.currentTarget.style.transform='translateY(-2px)'}
        onMouseLeave={e=>e.currentTarget.style.transform='none'}>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <div style={{width:44,height:44,borderRadius:12,background:'rgba(59,130,246,0.2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,flexShrink:0}}>🎯</div>
          <div style={{flex:1}}>
            <div style={{fontSize:15,fontWeight:700,color:'white',marginBottom:4}}>应急抽问</div>
            <div style={{fontSize:12,color:'rgba(255,255,255,0.45)',lineHeight:1.5}}>随机抽取 3 题，快速热身练习<br/>完成后可继续下一轮</div>
          </div>
          <span style={{fontSize:20,color:'rgba(255,255,255,0.3)'}}>›</span>
        </div>
      </div>

      {/* 顺序练习 */}
      <div onClick={()=>onStart('practice_sequential')} style={{background:'linear-gradient(135deg,#0d2d1a,#1a4a2a)',border:'1px solid rgba(34,197,94,0.3)',borderRadius:14,padding:'18px',cursor:'pointer',transition:'transform .15s'}}
        onMouseEnter={e=>e.currentTarget.style.transform='translateY(-2px)'}
        onMouseLeave={e=>e.currentTarget.style.transform='none'}>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <div style={{width:44,height:44,borderRadius:12,background:'rgba(34,197,94,0.15)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,flexShrink:0}}>📚</div>
          <div style={{flex:1}}>
            <div style={{fontSize:15,fontWeight:700,color:'white',marginBottom:4}}>顺序练习</div>
            <div style={{fontSize:12,color:'rgba(255,255,255,0.45)',lineHeight:1.5}}>按题库顺序逐题过一遍<br/>全面巩固每一个知识点</div>
          </div>
          <span style={{fontSize:20,color:'rgba(255,255,255,0.3)'}}>›</span>
        </div>
      </div>

      <div style={{marginTop:20,padding:'12px 14px',background:'rgba(255,255,255,0.03)',borderRadius:10,border:'1px solid rgba(255,255,255,0.06)'}}>
        <div style={{fontSize:11,color:'rgba(255,255,255,0.3)',lineHeight:1.7}}>
          · 练习分数不计入积分榜排名<br/>
          · 每完成一次练习，总榜积分 +1（每月上限 3 次）<br/>
          · 加分与正式答题积分合并计入排行榜
        </div>
      </div>
    </div>
  );
}

// LEADERBOARD
function LeaderboardScreen({ user, onBack }) {
  const [tab,setTab]=useState('cycle');
  const [data,setData]=useState([]);
  const [lbModal,setLbModal]=useState(null);
  const [lbDetail,setLbDetail]=useState(null);
  const [lbDetailLoading,setLbDetailLoading]=useState(false);
  useEffect(()=>{
    const ep=tab==='cycle'?'/api/leaderboard/cycle':tab==='today'?'/api/leaderboard/today':'/api/leaderboard/monthly';
    apiJson(ep).then(d=>setData(Array.isArray(d)?d:d.rows||[])).catch(()=>{});
  },[tab]);
  const openMember=async(staffId,staffName)=>{
    const type=tab==='monthly'?'monthly':'cycle';
    setLbModal({staffId,staffName,type});
    setLbDetail(null); setLbDetailLoading(true);
    const ep=type==='monthly'?`/api/leaderboard/alltime/member/${staffId}`:`/api/leaderboard/cycle/member/${staffId}`;
    const d=await apiJson(ep).catch(()=>null);
    setLbDetail(d); setLbDetailLoading(false);
  };
  const medal=['🥇','🥈','🥉'];
  return(
    <div className="screen">
      <div className="page-header"><button className="back-btn" onClick={onBack}>←</button><h2>排行榜</h2><div/></div>
      <div className="tab-row">
        {[['cycle','本轮班组'],['today','今日'],['monthly','本月总榜']].map(([k,v])=>(
          <button key={k} className={`tab${tab===k?' active':''}`} onClick={()=>setTab(k)}>{v}</button>
        ))}
      </div>
      {/* Podium */}
      {data.length>=3&&(
        <div style={{display:'flex',alignItems:'flex-end',justifyContent:'center',gap:10,padding:'20px 16px 0'}}>
          {[data[1],data[0],data[2]].map((p,i)=>p&&(
            <div key={i} onClick={()=>openMember(p.staff_id,p.staff_name)} style={{display:'flex',flexDirection:'column',alignItems:'center',width:90,transform:i===1?'translateY(-10px)':'none',cursor:'pointer'}}>
              <div style={{fontSize:18,height:22}}>{medal[[1,0,2][i]]||''}</div>
              <div style={{width:46,height:46,borderRadius:23,background:i===1?'linear-gradient(135deg,#c8a84b,#e8c96a)':i===0?'#94a3b8':'#cd7f32',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,fontWeight:700,color:'white',marginBottom:4}}>{p.staff_name[0]}</div>
              <div style={{fontSize:11,color:p.staff_id===user.staffId?'#c8a84b':'#e2e8f0',fontWeight:p.staff_id===user.staffId?700:400,textAlign:'center'}}>{p.staff_name}</div>
              <div style={{fontSize:14,fontWeight:900,color:'white'}}>{p.total_points}</div>
              {p.attempts>1&&<div style={{fontSize:9,color:'#f59e0b',marginTop:1}}>答了{p.attempts}次</div>}
              {p.cycle_count>0&&<div style={{fontSize:9,color:'#60a5fa',marginTop:1}}>{p.cycle_count}轮</div>}
              <div style={{width:90,background:'#0f2642',border:'1px solid #1b3255',borderRadius:'4px 4px 0 0',textAlign:'center',color:'#64748b',fontSize:12,padding:`${[32,44,24][i]}px 0 6px`,marginTop:6}}>#{[2,1,3][i]}</div>
            </div>
          ))}
        </div>
      )}
      <div style={{padding:'8px 14px 24px'}}>
        {data.slice(3).map((r,i)=>(
          <div key={i} onClick={()=>openMember(r.staff_id,r.staff_name)} style={{display:'flex',alignItems:'center',gap:10,padding:'11px 13px',background:'#0f2642',border:`1px solid ${r.staff_id===user.staffId?'#c8a84b':'#1b3255'}`,borderRadius:10,marginBottom:7,cursor:'pointer'}}>
            <span style={{width:22,color:'#64748b',fontWeight:700,fontSize:13,textAlign:'center'}}>{i+4}</span>
            <div style={{width:34,height:34,borderRadius:17,background:'linear-gradient(135deg,#1e3a5f,#3b82f6)',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,color:'white',fontSize:13}}>{r.staff_name[0]}</div>
            <div style={{flex:1}}>
              <div style={{fontSize:13,fontWeight:600,color:r.staff_id===user.staffId?'#c8a84b':'white',display:'flex',alignItems:'center',gap:5,flexWrap:'wrap'}}>
                {r.staff_name}{r.staff_id===user.staffId?' (我)':''}
                {r.attempts>1&&<span style={{fontSize:9,color:'#f59e0b',background:'rgba(245,158,11,0.12)',border:'1px solid rgba(245,158,11,0.3)',borderRadius:4,padding:'0 4px',fontWeight:700}}>首次·答了{r.attempts}次</span>}
              </div>
              <div style={{fontSize:11,color:'#64748b',marginTop:1}}>
                {r.cycle_count>0?<span>参与{r.cycle_count}轮</span>:<span>得分{r.score??r.avg_score} · {r.q_count}题</span>}
              </div>
            </div>
            <div style={{fontSize:18,fontWeight:900,color:'white'}}>{r.total_points}</div>
          </div>
        ))}
        {data.length===0&&<div style={{textAlign:'center',color:'#475569',padding:40}}>暂无数据</div>}
      </div>
      {lbModal&&(
        <div onClick={()=>{setLbModal(null);setLbDetail(null);}} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',zIndex:200,display:'flex',alignItems:'flex-end',justifyContent:'center'}}>
          <div onClick={e=>e.stopPropagation()} style={{width:'100%',maxWidth:440,background:'#0d1e35',border:'1px solid rgba(59,130,246,0.3)',borderRadius:'16px 16px 0 0',padding:'20px 16px 32px',maxHeight:'75vh',overflowY:'auto'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:14}}>
              <div style={{display:'flex',gap:10,alignItems:'flex-start'}}>
                {lbDetail?.sessions?.[0]?.avatar
                  ?<img src={lbDetail.sessions[0].avatar} style={{width:44,height:44,borderRadius:'50%',objectFit:'cover',flexShrink:0,border:'2px solid rgba(59,130,246,0.4)'}}/>
                  :<div style={{width:44,height:44,borderRadius:'50%',background:'linear-gradient(135deg,#1e3a5f,#3b82f6)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,fontWeight:700,color:'white',flexShrink:0}}>{lbModal.staffName?.[0]}</div>
                }
                <div>
                  <div style={{fontSize:15,fontWeight:700,color:'white'}}>{lbModal.staffName}</div>
                  <div style={{fontSize:10,color:'#64748b',marginTop:2}}>{lbModal.type==='monthly'?'本月答题记录':'轮班答题记录'}</div>
                </div>
              </div>
              <button onClick={()=>{setLbModal(null);setLbDetail(null);}} style={{background:'none',border:'1px solid #1b3255',color:'#64748b',borderRadius:6,padding:'4px 10px',cursor:'pointer',fontSize:12,flexShrink:0}}>关闭</button>
            </div>
            {lbDetailLoading&&<div style={{textAlign:'center',padding:'20px 0'}}><div className="spinner" style={{margin:'0 auto'}}/></div>}
            {!lbDetailLoading&&lbDetail&&lbDetail.sessions?.length===0&&<div style={{color:'#475569',fontSize:13,textAlign:'center',padding:'20px 0'}}>暂无答题记录</div>}
            {!lbDetailLoading&&lbDetail?.sessions?.map((s,si)=>(
              <div key={si} style={{marginBottom:12,background:'rgba(15,38,66,0.6)',border:'1px solid #1b3255',borderRadius:10,padding:'12px 14px'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                  <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                    <span style={{fontSize:11,color:'#64748b'}}>{s.created_at?.slice(5,10)}{s.cycle_label?` · ${s.cycle_label}`:''}</span>
                    {s.tab_switch_count>0&&<span style={{fontSize:10,color:'#ef4444',background:'rgba(239,68,68,0.12)',border:'1px solid rgba(239,68,68,0.3)',borderRadius:4,padding:'0 5px',fontWeight:700}}>切屏×{s.tab_switch_count}</span>}
                  </div>
                  <div style={{display:'flex',gap:8,alignItems:'center'}}>
                    <span style={{fontSize:12,fontWeight:700,color:'white'}}>{s.total_score}分</span>
                    <span style={{fontSize:11,color:'#c8a84b'}}>+{s.total_points}积分</span>
                  </div>
                </div>
                {s.answers?.map((a,ai)=>(
                  <div key={ai} style={{padding:'6px 0',borderTop:'1px solid rgba(27,50,85,0.5)',display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
                    <span style={{fontSize:11,color:'rgba(255,255,255,0.7)',flex:1,lineHeight:1.5}}>{a.question_text}</span>
                    <span style={{fontSize:12,fontWeight:700,flexShrink:0,color:a.score>=99?'#22c55e':a.score>=67?'#f59e0b':'#ef4444'}}>{Math.round(a.score*33/100)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// PROFILE
function ProfileScreen({ user, onBack }) {
  const [d,setD]=useState(null);
  const [aiAnalysis,setAiAnalysis]=useState('');
  const [aiLoading,setAiLoading]=useState(false);

  useEffect(()=>{ apiJson(`/api/me/${user.staffId}`).then(setD).catch(()=>setD({})); },[]);

  const loadAiAnalysis = async (data) => {
    if(aiLoading||aiAnalysis) return;
    setAiLoading(true);
    try {
      const catText = (data.catScores||[]).map(c=>`${c.category}：${c.avg}分`).join('、');
      const weakText = (data.weakCats||[]).map(c=>c.category).join('、');
      const trendText = (data.trend||[]).map(t=>t.score).join(',');
      const prompt = `你是一位地铁乘务培训教练。以下是学员${user.name}的答题数据：
答题天数：${data.stats?.total_days||0}天，平均分：${data.stats?.avg_score||0}分，连续答题：${data.streak||0}天
各类题得分：${catText||'暂无'}
薄弱科目：${weakText||'暂无'}
近期得分趋势（从早到晚）：${trendText||'暂无'}
请用100字以内给出个性化训练建议，语气专业但亲切，重点指出最需要加强的方向，结尾给一句鼓励。不要用markdown格式。`;
      const resp = await fetch('https://api.anthropic.com/v1/messages',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:300,messages:[{role:'user',content:prompt}]})
      });
      const json = await resp.json();
      setAiAnalysis(json.content?.[0]?.text||'暂时无法生成分析');
    } catch(e) {
      setAiAnalysis('AI分析暂时不可用');
    } finally {
      setAiLoading(false);
    }
  };

  if(!d)return(
    <div style={{display:'flex',flex:1,alignItems:'center',justifyContent:'center',minHeight:'100vh',background:'var(--bg)',flexDirection:'column',gap:16}}>
      <div className="spinner"/>
      <button onClick={onBack} style={{background:'none',border:'none',color:'#3b82f6',fontSize:14,cursor:'pointer',fontFamily:'var(--font)'}}>← 返回</button>
    </div>
  );

  const avg = d.stats?.avg_score||0;
  const cats = d.catScores||[];
  const maxCat = cats.length ? cats.reduce((a,b)=>a.avg>b.avg?a:b) : null;
  const minCat = cats.length ? cats.reduce((a,b)=>a.avg<b.avg?a:b) : null;
  const trendData = (d.trend||[]).map(t=>t.score);
  const trendUp = trendData.length>=2 && trendData[trendData.length-1] > trendData[0];

  // 雷达图SVG
  const RadarChart = ({cats}) => {
    if(!cats||cats.length<3) return null;
    const cx=110,cy=110,r=80,n=cats.length;
    const angle = i => (i/n)*2*Math.PI - Math.PI/2;
    const pt = (i,val) => {
      const ratio=Math.min(val,100)/100;
      return [cx+r*ratio*Math.cos(angle(i)), cy+r*ratio*Math.sin(angle(i))];
    };
    const gridPts = (ratio) => cats.map((_,i)=>{
      const [x,y]=[ cx+r*ratio*Math.cos(angle(i)), cy+r*ratio*Math.sin(angle(i)) ];
      return `${x},${y}`;
    }).join(' ');
    const dataPts = cats.map((_,i)=>pt(i,cats[i].avg)).map(([x,y])=>`${x},${y}`).join(' ');
    return (
      <svg width={220} height={220} style={{display:'block',margin:'0 auto'}}>
        {[0.25,0.5,0.75,1].map(ratio=>(
          <polygon key={ratio} points={gridPts(ratio)} fill="none" stroke="rgba(59,130,246,0.15)" strokeWidth="1"/>
        ))}
        {cats.map((_,i)=>{
          const [x,y]=[cx+r*Math.cos(angle(i)),cy+r*Math.sin(angle(i))];
          return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(59,130,246,0.15)" strokeWidth="1"/>;
        })}
        <polygon points={dataPts} fill="rgba(59,130,246,0.25)" stroke="#3b82f6" strokeWidth="2"/>
        {cats.map((c,i)=>{
          const [x,y]=pt(i,c.avg);
          return <circle key={i} cx={x} cy={y} r={4} fill="#3b82f6"/>;
        })}
        {cats.map((c,i)=>{
          const labelR=r+18;
          const lx=cx+labelR*Math.cos(angle(i));
          const ly=cy+labelR*Math.sin(angle(i));
          const anchor=lx<cx-5?'end':lx>cx+5?'start':'middle';
          return (
            <g key={i}>
              <text x={lx} y={ly-4} textAnchor={anchor} fill="rgba(255,255,255,0.7)" fontSize={9}>{c.category}</text>
              <text x={lx} y={ly+8} textAnchor={anchor} fill={c.avg>=85?'#22c55e':c.avg>=60?'#f59e0b':'#ef4444'} fontSize={10} fontWeight="700">{c.avg}</text>
            </g>
          );
        })}
      </svg>
    );
  };

  // 趋势折线图
  const TrendChart = ({data}) => {
    if(!data||data.length<2) return <div style={{color:'#475569',fontSize:12,textAlign:'center',padding:'20px 0'}}>答题场次不足，趋势待生成</div>;
    const w=280,h=70,max=Math.max(...data,60),min=Math.max(0,Math.min(...data)-10);
    const px=i=>i*(w/(data.length-1));
    const py=v=>h-((v-min)/(max-min||1))*h;
    const pts=data.map((v,i)=>`${px(i)},${py(v)}`).join(' ');
    const fillPts=`${px(0)},${h} ${pts} ${px(data.length-1)},${h}`;
    const last=data[data.length-1];
    const col=last>=85?'#22c55e':last>=60?'#f59e0b':'#ef4444';
    return (
      <svg width={w} height={h+20} style={{display:'block',margin:'0 auto',overflow:'visible'}}>
        <defs>
          <linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={col} stopOpacity="0.3"/>
            <stop offset="100%" stopColor={col} stopOpacity="0"/>
          </linearGradient>
        </defs>
        <polygon points={fillPts} fill="url(#tg)"/>
        <polyline points={pts} fill="none" stroke={col} strokeWidth="2" strokeLinejoin="round"/>
        {data.map((v,i)=>(
          <g key={i}>
            <circle cx={px(i)} cy={py(v)} r={i===data.length-1?5:3} fill={i===data.length-1?col:'#1e3a5f'} stroke={col} strokeWidth="1.5"/>
            {i===data.length-1&&<text x={px(i)} y={py(v)-9} textAnchor="middle" fill={col} fontSize={11} fontWeight="700">{v}</text>}
          </g>
        ))}
      </svg>
    );
  };

  return(
    <div className="screen">
      <div className="page-header">
        <button className="back-btn" onClick={onBack}>←</button>
        <h2>个人分析</h2>
        <div/>
      </div>
      <div style={{padding:'14px 14px 32px',display:'flex',flexDirection:'column',gap:12}}>

        {/* Hero卡片 */}
        <div className="card" style={{background:'linear-gradient(135deg,#0d2d5a,#1a3a6e)',border:'1px solid rgba(59,130,246,0.3)'}}>
          <div style={{display:'flex',alignItems:'center',gap:14,marginBottom:14}}>
            <div style={{width:52,height:52,borderRadius:26,background:'linear-gradient(135deg,#3b82f6,#0ea5e9)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,fontWeight:700,color:'white',flexShrink:0,boxShadow:'0 4px 14px rgba(59,130,246,0.4)'}}>{user.name[0]}</div>
            <div style={{flex:1}}>
              <div style={{fontSize:17,fontWeight:700,color:'white'}}>{user.name}</div>
              <div style={{fontSize:11,color:'rgba(255,255,255,0.5)',marginTop:2}}>Y{user.staffId} · 武汉地铁5号线</div>
            </div>
            <div style={{textAlign:'right'}}>
              <div style={{fontSize:24,fontWeight:900,color:'white',lineHeight:1}}>{d.streak||0}<span style={{fontSize:12,color:'rgba(255,255,255,0.5)',fontWeight:400}}>天</span></div>
              <div style={{fontSize:10,color:'rgba(255,255,255,0.4)',marginTop:2}}>连续答题🔥</div>
            </div>
          </div>
          <div style={{display:'flex',gap:8}}>
            {[
              {label:'答题天数',val:d.stats?.total_days||0,unit:'天',col:'#3b82f6'},
              {label:'累计积分',val:d.stats?.total_points||0,unit:'分',col:'#c8a84b'},
              {label:'综合均分',val:avg,unit:'',col:avg>=85?'#22c55e':avg>=60?'#f59e0b':'#ef4444'},
              ...(d.cycleRank?[{label:'本轮排名',val:`#${d.cycleRank}`,unit:'',col:'#a855f7'}]:[]),
            ].map((item,i)=>(
              <div key={i} style={{flex:1,textAlign:'center',background:'rgba(0,0,0,0.25)',borderRadius:8,padding:'8px 4px'}}>
                <div style={{fontSize:18,fontWeight:900,color:item.col,lineHeight:1}}>{item.val}<span style={{fontSize:10,color:'rgba(255,255,255,0.4)',fontWeight:400}}>{item.unit}</span></div>
                <div style={{fontSize:9,color:'rgba(255,255,255,0.4)',marginTop:3}}>{item.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 优势/弱势快速标签 */}
        {cats.length>0&&(
          <div style={{display:'flex',gap:8}}>
            {maxCat&&<div style={{flex:1,padding:'10px 12px',background:'rgba(34,197,94,0.08)',border:'1px solid rgba(34,197,94,0.25)',borderRadius:10}}>
              <div style={{fontSize:9,color:'#22c55e',letterSpacing:1,marginBottom:4}}>💪 最强科目</div>
              <div style={{fontSize:13,fontWeight:700,color:'white'}}>{maxCat.category}</div>
              <div style={{fontSize:18,fontWeight:900,color:'#22c55e'}}>{maxCat.avg}<span style={{fontSize:10,fontWeight:400,color:'rgba(255,255,255,0.4)'}}>分</span></div>
            </div>}
            {minCat&&minCat.category!==maxCat?.category&&<div style={{flex:1,padding:'10px 12px',background:'rgba(239,68,68,0.08)',border:'1px solid rgba(239,68,68,0.25)',borderRadius:10}}>
              <div style={{fontSize:9,color:'#ef4444',letterSpacing:1,marginBottom:4}}>⚠ 需要加强</div>
              <div style={{fontSize:13,fontWeight:700,color:'white'}}>{minCat.category}</div>
              <div style={{fontSize:18,fontWeight:900,color:'#ef4444'}}>{minCat.avg}<span style={{fontSize:10,fontWeight:400,color:'rgba(255,255,255,0.4)'}}>分</span></div>
            </div>}
          </div>
        )}

        {/* 雷达图 */}
        {cats.length>=3&&(
          <div className="card">
            <div style={{fontSize:11,color:'#64748b',letterSpacing:1,marginBottom:12,fontWeight:600}}>各科目掌握度雷达图</div>
            <RadarChart cats={cats}/>
          </div>
        )}

        {/* 条形图备用（科目少于3时显示） */}
        {cats.length>0&&cats.length<3&&(
          <div className="card">
            <div style={{fontSize:11,color:'#64748b',letterSpacing:1,marginBottom:10,fontWeight:600}}>各科目掌握度</div>
            {cats.map((c,i)=><MiniBar key={i} label={c.category} value={c.avg}/>)}
          </div>
        )}

        {/* 得分趋势 */}
        <div className="card">
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
            <div style={{fontSize:11,color:'#64748b',letterSpacing:1,fontWeight:600}}>近期得分趋势</div>
            {trendData.length>=2&&<span style={{fontSize:11,color:trendUp?'#22c55e':'#ef4444',fontWeight:600}}>{trendUp?'↑ 上升':'↓ 下降'}</span>}
          </div>
          <TrendChart data={trendData}/>
        </div>

        {/* AI教练分析 */}
        <div className="card" style={{border:'1px solid rgba(168,85,247,0.3)',background:'rgba(88,28,135,0.08)'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
            <div style={{fontSize:11,color:'#a855f7',letterSpacing:1,fontWeight:600}}>🤖 AI教练分析</div>
            {!aiAnalysis&&!aiLoading&&(
              <button onClick={()=>loadAiAnalysis(d)} style={{background:'linear-gradient(135deg,#6d28d9,#a855f7)',border:'none',borderRadius:6,padding:'5px 12px',color:'white',fontSize:11,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}>生成分析</button>
            )}
          </div>
          {aiLoading&&(
            <div style={{display:'flex',alignItems:'center',gap:8,padding:'12px 0'}}>
              <div className="spinner" style={{width:20,height:20,borderWidth:2}}/>
              <span style={{fontSize:12,color:'rgba(255,255,255,0.5)'}}>AI教练分析中…</span>
            </div>
          )}
          {aiAnalysis&&<div style={{fontSize:13,color:'rgba(255,255,255,0.85)',lineHeight:1.8,fontStyle:'italic'}}>「{aiAnalysis}」</div>}
          {!aiAnalysis&&!aiLoading&&<div style={{fontSize:12,color:'rgba(255,255,255,0.3)'}}>点击生成按钮，获取专属训练建议</div>}
        </div>

        {/* 薄弱知识点 */}
        {d.weakCats?.length>0&&(
          <div className="card" style={{border:'1px solid rgba(239,68,68,0.2)'}}>
            <div style={{fontSize:11,color:'#64748b',letterSpacing:1,marginBottom:10,fontWeight:600}}>⚠ 重点强化科目</div>
            {d.weakCats.map((c,i)=>(
              <div key={i} style={{display:'flex',alignItems:'center',gap:10,marginBottom:i<d.weakCats.length-1?8:0,padding:'10px 12px',background:'rgba(239,68,68,0.06)',borderRadius:8,border:'1px solid rgba(239,68,68,0.15)'}}>
                <div style={{width:24,height:24,borderRadius:12,background:'rgba(239,68,68,0.2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,color:'#ef4444',flexShrink:0}}>{i+1}</div>
                <span style={{flex:1,fontSize:13,color:'#e2e8f0'}}>{c.category}</span>
                <div style={{textAlign:'right'}}>
                  <div style={{fontSize:15,fontWeight:700,color:'#ef4444'}}>{c.avg}分</div>
                  <div style={{fontSize:9,color:'rgba(255,255,255,0.3)'}}>需达到80+</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 近期记录 */}
        <div className="card">
          <div style={{fontSize:11,color:'#64748b',letterSpacing:1,marginBottom:10,fontWeight:600}}>近期答题记录</div>
          {d.recent?.length>0?d.recent.map((s,i)=>(
            <div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 0',borderBottom:i<d.recent.length-1?'1px solid rgba(27,50,85,0.7)':'none'}}>
              <div style={{width:36,fontSize:10,color:'#64748b',flexShrink:0,textAlign:'center'}}>
                <div>{s.created_at?.slice(5,7)}月</div>
                <div style={{fontSize:13,fontWeight:700,color:'rgba(255,255,255,0.6)'}}>{s.created_at?.slice(8,10)}日</div>
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:12,color:'rgba(255,255,255,0.7)'}}>{s.q_count}题</div>
              </div>
              <Badge label={s.total_score>=85?'优秀':s.total_score>=60?'合格':'需加强'} color={s.total_score>=85?'#22c55e':s.total_score>=60?'#f59e0b':'#ef4444'}/>
              <div style={{textAlign:'right',minWidth:50}}>
                <div style={{fontWeight:700,color:'white',fontSize:14}}>{s.total_score}</div>
                <div style={{fontSize:10,color:'#c8a84b'}}>+{s.total_points}分</div>
              </div>
            </div>
          )):<div style={{color:'#475569',fontSize:13,textAlign:'center',padding:'20px 0'}}>暂无记录，完成答题后显示</div>}
        </div>

      </div>
    </div>
  );
}

// ADMIN

// ─── MembersTab Component ─────────────────────────────────────────────────
function MembersTab({ members, pwd, onRefresh, selectedMember, setSelectedMember, memberDetail, loadMemberDetail }) {
  const [showAdd, setShowAdd] = useState(false);
  const [showBatch, setShowBatch] = useState(false);
  const [addForm, setAddForm] = useState({id:'', real_name:'', phone_tail:'', is_exempt:false, is_tester:false, is_cp:false});
  const [addErr, setAddErr] = useState('');
  const [batchText, setBatchText] = useState('');
  const [batchErr, setBatchErr] = useState('');
  const [delConfirm, setDelConfirm] = useState(null);
  const [editId,setEditId]=useState(null);
  const [editForm,setEditForm]=useState({real_name:'',phone_tail:'',is_exempt:false,is_tester:false,is_cp:false});
  const [editErr,setEditErr]=useState('');
  const [batchSelected,setBatchSelected]=useState(new Set());
  const [batchMode,setBatchMode]=useState(false);

  const hdrs = (extra={}) => ({'x-admin-password': pwd, 'Content-Type':'application/json', ...extra});

  const toggleSelect = (id) => setBatchSelected(prev => { const s=new Set(prev); s.has(id)?s.delete(id):s.add(id); return s; });
  const selectAll = () => setBatchSelected(new Set(members.map(m=>m.id)));
  const clearSelect = () => setBatchSelected(new Set());
  const batchSetIdentity = async (is_tester, is_exempt, is_cp=false) => {
    if(batchSelected.size===0) return;
    const label = is_cp?'车峰':is_tester?'测试':is_exempt?'免答':'正常';
    if(!window.confirm(`将选中的 ${batchSelected.size} 人设为「${label}」身份？`)) return;
    const r = await apiJson('/api/admin/staff/batch-identity',{method:'PUT',headers:hdrs(),body:JSON.stringify({ids:[...batchSelected],is_tester,is_exempt,is_cp})}).catch(()=>null);
    if(r?.ok){ setBatchSelected(new Set()); onRefresh(); }
    else alert('操作失败');
  };

  const openEdit = (m) => {
    setEditId(m.id);
    setEditForm({real_name:m.real_name||'',phone_tail:m.phone_tail||'',is_exempt:!!m.is_exempt,is_tester:!!m.is_tester,is_cp:!!m.is_cp});
    setEditErr('');
  };
  const saveEdit = async () => {
    setEditErr('');
    if (!editForm.real_name.trim()) { setEditErr('姓名不能为空'); return; }
    if (editForm.phone_tail && !/^\d{4}$/.test(editForm.phone_tail)) { setEditErr('手机尾号须为4位数字'); return; }
    const r = await fetch('/api/staff/'+editId, {method:'PUT', headers:hdrs(), body: JSON.stringify({real_name:editForm.real_name.trim(), phone_tail:editForm.phone_tail.trim(), is_exempt:editForm.is_exempt, is_tester:!!editForm.is_tester, is_cp:!!editForm.is_cp})});
    const d = await r.json();
    if (d.ok) { setEditId(null); onRefresh(); }
    else setEditErr(d.error || '保存失败');
  };
  const addOne = async () => {
    setAddErr('');
    const id = addForm.id.trim().replace(/^Y/i,'');
    if (!id || !addForm.real_name.trim()) { setAddErr('工号和姓名不能为空'); return; }
    if (addForm.phone_tail && !/^\d{4}$/.test(addForm.phone_tail)) { setAddErr('手机尾号须为4位数字'); return; }
    const r = await fetch('/api/staff', {method:'POST', headers:hdrs(), body: JSON.stringify({id, real_name: addForm.real_name.trim(), phone_tail: addForm.phone_tail.trim(), is_exempt: addForm.is_exempt, is_tester: !!addForm.is_tester, is_cp: !!addForm.is_cp})});
    const d = await r.json();
    if (d.ok) { setShowAdd(false); setAddForm({id:'',real_name:'',phone_tail:'',is_exempt:false,is_tester:false,is_cp:false}); onRefresh(); }
    else setAddErr(d.error || '添加失败');
  };

  const batchImport = async () => {
    setBatchErr('');
    const lines = batchText.trim().split('\n').filter(Boolean);
    const list = [];
    for (const line of lines) {
      const parts = line.split(/[,，\t]+/).map(s=>s.trim());
      if (parts.length < 2) { setBatchErr(`格式错误：${line}（需要 姓名,工号 或 姓名,工号,手机尾号）`); return; }
      list.push({ real_name: parts[0], id: parts[1].replace(/^Y/i,''), phone_tail: parts[2]||'' });
    }
    const r = await fetch('/api/staff/batch', {method:'POST', headers:hdrs(), body: JSON.stringify(list)});
    const d = await r.json();
    if (d.ok) { setShowBatch(false); setBatchText(''); onRefresh(); }
    else setBatchErr(d.error || '导入失败');
  };

  const delStaff = async (id) => {
    await fetch('/api/staff/'+id, {method:'DELETE', headers:hdrs()});
    setDelConfirm(null);
    onRefresh();
  };

  return (
    <div>
      {/* 批量操作栏 */}
      <div style={{display:'flex',alignItems:'center',gap:6,padding:'8px 12px',marginBottom:4,flexWrap:'wrap'}}>
        <button onClick={()=>{setBatchMode(m=>!m);clearSelect();}} style={{fontSize:11,padding:'4px 10px',borderRadius:6,border:`1px solid ${batchMode?'#3b82f6':'#1b3255'}`,background:batchMode?'rgba(59,130,246,0.15)':'none',color:batchMode?'#3b82f6':'#64748b',cursor:'pointer'}}>
          {batchMode?'退出批量':'批量编辑'}
        </button>
        {batchMode&&<>
          <button onClick={selectAll} style={{fontSize:11,padding:'4px 8px',borderRadius:6,border:'1px solid #1b3255',background:'none',color:'#94a3b8',cursor:'pointer'}}>全选</button>
          <button onClick={clearSelect} style={{fontSize:11,padding:'4px 8px',borderRadius:6,border:'1px solid #1b3255',background:'none',color:'#94a3b8',cursor:'pointer'}}>清空</button>
          {batchSelected.size>0&&<span style={{fontSize:11,color:'#3b82f6',marginLeft:2}}>已选{batchSelected.size}人</span>}
          <div style={{display:'flex',gap:5,marginLeft:'auto'}}>
            <button onClick={()=>batchSetIdentity(false,false)} style={{fontSize:11,padding:'4px 9px',borderRadius:6,border:'1px solid rgba(34,197,94,0.4)',background:'rgba(34,197,94,0.1)',color:'#4ade80',cursor:'pointer',opacity:batchSelected.size?1:0.4}}>正常</button>
            <button onClick={()=>batchSetIdentity(true,false)} style={{fontSize:11,padding:'4px 9px',borderRadius:6,border:'1px solid rgba(168,85,247,0.4)',background:'rgba(168,85,247,0.1)',color:'#c084fc',cursor:'pointer',opacity:batchSelected.size?1:0.4}}>测试</button>
            <button onClick={()=>batchSetIdentity(false,true)} style={{fontSize:11,padding:'4px 9px',borderRadius:6,border:'1px solid rgba(100,116,139,0.4)',background:'rgba(100,116,139,0.1)',color:'#94a3b8',cursor:'pointer',opacity:batchSelected.size?1:0.4}}>免答</button>
            <button onClick={()=>batchSetIdentity(false,false,true)} style={{fontSize:11,padding:'4px 9px',borderRadius:6,border:'1px solid rgba(234,179,8,0.4)',background:'rgba(234,179,8,0.1)',color:'#eab308',cursor:'pointer',opacity:batchSelected.size?1:0.4}}>车峰</button>
          </div>
        </>}
      </div>
      {/* 人员列表 */}
      <div className="card" style={{padding:'6px 0', marginBottom:10}}>
        {members.length === 0 && <div style={{padding:'20px',textAlign:'center',color:'#475569',fontSize:13}}>暂无人员，请添加</div>}
        {(()=>{const nameCnt={};members.forEach(m=>{nameCnt[m.real_name]=(nameCnt[m.real_name]||0)+1;});const dups=new Set(Object.keys(nameCnt).filter(n=>nameCnt[n]>1));if(dups.size>0&&!window._dupAlerted){window._dupAlerted=true;alert('⚠️ 发现重复姓名：'+[...dups].join('、')+'，请检查人员数据！');}return null;})()}
        {members.map((m,i)=>{const isDup=members.filter(x=>x.real_name===m.real_name).length>1; return (
          <div key={i}>
            <div style={{display:'flex',alignItems:'center',gap:10,padding:'11px 14px',cursor:'pointer',background:batchSelected.has(m.id)?'rgba(59,130,246,0.08)':selectedMember===m.id?'rgba(59,130,246,0.06)':'none'}}
              onClick={()=>batchMode?toggleSelect(m.id):(selectedMember===m.id?setSelectedMember(null):loadMemberDetail(m.id))}>
              {batchMode&&<input type="checkbox" checked={batchSelected.has(m.id)} onChange={()=>toggleSelect(m.id)} onClick={e=>e.stopPropagation()} style={{width:15,height:15,flexShrink:0,accentColor:'#3b82f6'}}/>}
              <div style={{fontSize:11,color:'#475569',width:18,textAlign:'right',flexShrink:0}}>{i+1}</div>
              <div style={{width:36,height:36,borderRadius:18,background:isDup?'linear-gradient(135deg,#7c2d12,#ef4444)':'linear-gradient(135deg,#1e3a5f,#3b82f6)',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,color:'white',fontSize:14,flexShrink:0}}>
                {(m.real_name||'?')[0]}
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:600,color:'white',display:'flex',alignItems:'center',gap:6}}>
                  {m.real_name||'（未设姓名）'}{isDup&&<span style={{fontSize:10,color:'#ef4444',marginLeft:4,background:'rgba(239,68,68,0.1)',padding:'1px 5px',borderRadius:4}}>重复</span>}
                  {m.is_exempt?<Badge label="免答" color="#64748b"/>:null}
                  {m.is_tester?<Badge label="测试" color="#a855f7"/>:null}
                  {m.is_cp?<Badge label="车峰" color="#eab308"/>:null}
                </div>
                <div style={{fontSize:11,color:'#64748b',marginTop:2,display:'flex',gap:8}}>
                  <span>Y{m.id}</span>
                  <span style={{color:'#1b3255'}}>·</span>
                  <span>{m.phone_tail ? '尾号 '+m.phone_tail : '未录手机'}</span>
                </div>
              </div>
              <div style={{textAlign:'right',flexShrink:0}}>
                <div style={{fontWeight:700,color:'white',fontSize:13}}>{m.total_points||0}<span style={{fontSize:10,color:'#475569',fontWeight:400}}> 分</span></div>
                <div style={{fontSize:11,color:'#64748b'}}>均{m.avg_score||'--'}</div>
              </div>
              <button onClick={e=>{e.stopPropagation();openEdit(m);}}
                style={{background:'none',border:'1px solid rgba(59,130,246,0.4)',color:'#3b82f6',borderRadius:6,padding:'3px 8px',fontSize:11,cursor:'pointer',flexShrink:0,marginRight:4}}>编辑</button>
              <button onClick={e=>{e.stopPropagation();setDelConfirm(m.id);}}
                style={{background:'none',border:'1px solid rgba(239,68,68,0.3)',color:'#ef4444',borderRadius:6,padding:'3px 8px',fontSize:11,cursor:'pointer',flexShrink:0}}>删</button>
            </div>
            {selectedMember===m.id&&memberDetail&&(
              <div style={{padding:'12px 16px',background:'rgba(15,38,66,0.6)',borderTop:'1px solid #1b3255'}}>
                {(!memberDetail.sessions?.length)&&<div style={{color:'#475569',fontSize:12}}>暂无答题数据</div>}
                {memberDetail.sessions?.length>0&&(
                  <div style={{marginTop:10}}>
                    <div style={{fontSize:11,color:'#475569',letterSpacing:1,marginBottom:6}}>最近答题记录</div>
                    {memberDetail.sessions.map((s,j)=>(
                      <div key={j} style={{display:'flex',alignItems:'center',gap:8,padding:'5px 0',borderBottom:j<memberDetail.sessions.length-1?'1px solid rgba(27,50,85,0.6)':'none'}}>
                        <span style={{fontSize:11,color:'#475569',flexShrink:0}}>{s.created_at?.slice(5,16)}</span>
                        <span style={{fontSize:11,color:'#94a3b8',flex:1}}>{s.q_count}题</span>
                        <span style={{fontSize:12,fontWeight:700,color:'#c8a84b'}}>{s.total_points}分</span>
                        <span style={{fontSize:11,color:'#64748b'}}>均{s.total_score?.toFixed?.(0)??'--'}</span>
                        {s.tab_switch_count>0&&<span style={{fontSize:10,color:'#ef4444',background:'rgba(239,68,68,0.12)',border:'1px solid rgba(239,68,68,0.3)',borderRadius:4,padding:'0 5px',fontWeight:700}}>切屏×{s.tab_switch_count}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {delConfirm===m.id&&(
              <div style={{padding:'10px 14px',background:'rgba(239,68,68,0.08)',borderTop:'1px solid rgba(239,68,68,0.2)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <span style={{fontSize:12,color:'#fca5a5'}}>确认删除 {m.real_name}？</span>
                <div style={{display:'flex',gap:8}}>
                  <button onClick={()=>setDelConfirm(null)} style={{background:'none',border:'1px solid #1b3255',color:'#94a3b8',borderRadius:6,padding:'4px 10px',fontSize:12,cursor:'pointer'}}>取消</button>
                  <button onClick={()=>delStaff(m.id)} style={{background:'#ef4444',border:'none',color:'white',borderRadius:6,padding:'4px 10px',fontSize:12,cursor:'pointer'}}>确认删除</button>
                </div>
              </div>
            )}
            {editId===m.id&&(
              <div style={{padding:'12px 14px',background:'rgba(30,58,95,0.4)',borderTop:'1px solid #1b3255'}}>
                <div style={{fontSize:11,color:'#64748b',marginBottom:10,fontWeight:600}}>编辑人员</div>
                {[['姓名','real_name','请输入姓名'],['手机后4位','phone_tail','如：1234']].map(([lbl,key,ph])=>(
                  <div key={key} style={{marginBottom:8}}>
                    <label style={{display:'block',fontSize:11,color:'#64748b',marginBottom:3}}>{lbl}</label>
                    <input value={editForm[key]} onChange={e=>setEditForm(f=>({...f,[key]:e.target.value}))}
                      placeholder={ph} maxLength={key==='phone_tail'?4:20}
                      style={{width:'100%',background:'#0d1e35',border:'1px solid #1b3255',borderRadius:6,padding:'7px 10px',color:'white',fontSize:13,fontFamily:'inherit',outline:'none'}}/>
                  </div>
                ))}
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
                  <input type="checkbox" id={"edit_exempt_"+m.id} checked={editForm.is_exempt} onChange={e=>setEditForm(f=>({...f,is_exempt:e.target.checked}))} style={{width:15,height:15}}/>
                  <label htmlFor={"edit_exempt_"+m.id} style={{fontSize:12,color:'#94a3b8',cursor:'pointer'}}>班组长/免答</label>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
                  <input type="checkbox" id={"edit_tester_"+m.id} checked={!!editForm.is_tester} onChange={e=>setEditForm(f=>({...f,is_tester:e.target.checked}))} style={{width:15,height:15}}/>
                  <label htmlFor={"edit_tester_"+m.id} style={{fontSize:12,color:'#94a3b8',cursor:'pointer'}}>测试员（积分标注测试）</label>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
                  <input type="checkbox" id={"edit_cp_"+m.id} checked={!!editForm.is_cp} onChange={e=>setEditForm(f=>({...f,is_cp:e.target.checked}))} style={{width:15,height:15,accentColor:'#eab308'}}/>
                  <label htmlFor={"edit_cp_"+m.id} style={{fontSize:12,color:'#eab308',cursor:'pointer'}}>车峰（不计入今日未完成列表）</label>
                </div>
                {editErr&&<div style={{color:'#ef4444',fontSize:12,marginBottom:6}}>⚠ {editErr}</div>}
                <div style={{display:'flex',gap:8}}>
                  <button onClick={()=>setEditId(null)} style={{flex:1,padding:'7px',borderRadius:6,border:'1px solid #1b3255',background:'transparent',color:'#94a3b8',fontFamily:'inherit',fontSize:12,cursor:'pointer'}}>取消</button>
                  <button onClick={saveEdit} style={{flex:2,padding:'7px',borderRadius:6,border:'none',background:'linear-gradient(135deg,#1e3a5f,#3b82f6)',color:'white',fontFamily:'inherit',fontSize:12,fontWeight:600,cursor:'pointer'}}>保存</button>
                </div>
              </div>
            )}
            {i<members.length-1&&<div style={{height:1,background:'rgba(27,50,85,.5)',margin:'0 14px'}}/>}
          </div>
                );
        })}

      </div>

      {/* 添加按钮行 */}
      <div style={{display:'flex',gap:8,marginBottom:12}}>
        <button onClick={()=>{setShowAdd(v=>!v);setShowBatch(false);}} style={{flex:1,padding:'11px',borderRadius:9,border:'1px solid #3b82f6',background:showAdd?'rgba(59,130,246,0.12)':'transparent',color:'#3b82f6',fontFamily:'inherit',fontSize:13,cursor:'pointer',fontWeight:600}}>
          ＋ 添加人员
        </button>
        <button onClick={()=>{setShowBatch(v=>!v);setShowAdd(false);}} style={{flex:1,padding:'11px',borderRadius:9,border:'1px solid #22c55e',background:showBatch?'rgba(34,197,94,0.1)':'transparent',color:'#22c55e',fontFamily:'inherit',fontSize:13,cursor:'pointer',fontWeight:600}}>
          📋 批量导入
        </button>
      </div>

      {/* 单条添加表单 */}
      {showAdd&&(
        <div className="card" style={{marginBottom:10}}>
          <div style={{fontSize:11,color:'#64748b',letterSpacing:1,marginBottom:12,fontWeight:600}}>添加人员</div>
          {[
            ['姓名 *', 'real_name', '请输入真实姓名', 'text'],
            ['工号 * （输入数字，Y自动补全）', 'id', '如：3743', 'text'],
            ['手机后4位（用于登录验证）', 'phone_tail', '如：1234', 'text'],
          ].map(([lbl,key,ph,type])=>(
            <div key={key} style={{marginBottom:10}}>
              <label style={{display:'block',fontSize:11,color:'#64748b',marginBottom:4}}>{lbl}</label>
              <input type={type} value={addForm[key]} onChange={e=>setAddForm(f=>({...f,[key]:e.target.value}))}
                placeholder={ph} maxLength={key==='phone_tail'?4:20}
                style={{width:'100%',background:'#0d1e35',border:'1px solid #1b3255',borderRadius:7,padding:'9px 12px',color:'white',fontSize:14,fontFamily:'inherit',outline:'none'}}/>
            </div>
          ))}
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
            <input type="checkbox" id="exempt" checked={addForm.is_exempt} onChange={e=>setAddForm(f=>({...f,is_exempt:e.target.checked}))} style={{width:16,height:16}}/>
            <label htmlFor="exempt" style={{fontSize:12,color:'#94a3b8',cursor:'pointer'}}>班组长/免答</label>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
            <input type="checkbox" id="tester" checked={!!addForm.is_tester} onChange={e=>setAddForm(f=>({...f,is_tester:e.target.checked}))} style={{width:16,height:16}}/>
            <label htmlFor="tester" style={{fontSize:12,color:'#94a3b8',cursor:'pointer'}}>测试员（积分标注测试）</label>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
            <input type="checkbox" id="add_cp" checked={!!addForm.is_cp} onChange={e=>setAddForm(f=>({...f,is_cp:e.target.checked}))} style={{width:16,height:16,accentColor:'#eab308'}}/>
            <label htmlFor="add_cp" style={{fontSize:12,color:'#eab308',cursor:'pointer'}}>车峰（不计入今日未完成列表）</label>
          </div>
          {addErr&&<div style={{color:'#ef4444',fontSize:12,marginBottom:8}}>⚠ {addErr}</div>}
          <div style={{display:'flex',gap:8}}>
            <button onClick={()=>setShowAdd(false)} style={{flex:1,padding:'10px',borderRadius:7,border:'1px solid #1b3255',background:'transparent',color:'#94a3b8',fontFamily:'inherit',fontSize:13,cursor:'pointer'}}>取消</button>
            <button onClick={addOne} style={{flex:2,padding:'10px',borderRadius:7,border:'none',background:'linear-gradient(135deg,#1e3a5f,#3b82f6)',color:'white',fontFamily:'inherit',fontSize:13,fontWeight:600,cursor:'pointer'}}>确认添加</button>
          </div>
        </div>
      )}

      {/* 批量导入 */}
      {showBatch&&(
        <div className="card" style={{marginBottom:10}}>
          <div style={{fontSize:11,color:'#64748b',letterSpacing:1,marginBottom:6,fontWeight:600}}>批量导入</div>
          <div style={{fontSize:11,color:'#475569',marginBottom:10,lineHeight:1.8}}>
            每行一人，格式：<code style={{color:'#c8a84b'}}>姓名,工号,手机后4位</code><br/>
            示例：<code style={{color:'#94a3b8'}}>张三,3743,1234</code><br/>
            手机尾号可留空，工号不用写Y前缀
          </div>
          <textarea value={batchText} onChange={e=>setBatchText(e.target.value)}
            placeholder={"张三,3743,1234\n李四,3788,5678\n王五,3701"}
            rows={8}
            style={{width:'100%',background:'#0d1e35',border:'1px solid #1b3255',borderRadius:7,padding:'10px 12px',color:'white',fontSize:13,fontFamily:'monospace',outline:'none',resize:'vertical'}}/>
          {batchErr&&<div style={{color:'#ef4444',fontSize:12,marginTop:6}}>⚠ {batchErr}</div>}
          <div style={{display:'flex',gap:8,marginTop:10}}>
            <button onClick={()=>{setShowBatch(false);setBatchText('');}} style={{flex:1,padding:'10px',borderRadius:7,border:'1px solid #1b3255',background:'transparent',color:'#94a3b8',fontFamily:'inherit',fontSize:13,cursor:'pointer'}}>取消</button>
            <button onClick={batchImport} style={{flex:2,padding:'10px',borderRadius:7,border:'none',background:'linear-gradient(135deg,#22c55e88,#22c55e)',color:'white',fontFamily:'inherit',fontSize:13,fontWeight:600,cursor:'pointer'}}>导入 {batchText.trim().split('\n').filter(Boolean).length} 人</button>
          </div>
        </div>
      )}
    </div>
  );
}

function BankImportCard({ pwd, onImported }) {
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const doImport = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setImporting(true); setImportMsg('');
    const fd = new FormData();
    fd.append('file', file);
    const bankName = prompt('新题库名称（留空则导入到默认题库）');
    if (bankName?.trim()) fd.append('bank_name', bankName.trim());
    else fd.append('bank_id', '1');
    try {
      const r = await fetch('/api/admin/banks/import', {method:'POST', headers:adminHeaders(pwd), body:fd});
      const d = await r.json();
      if (d.ok) { setImportMsg(`✅ 成功导入 ${d.count} 题`); onImported?.(); }
      else setImportMsg('❌ ' + (d.error || '导入失败'));
    } catch { setImportMsg('❌ 网络错误'); }
    setImporting(false); e.target.value = '';
  };
  return (
    <label className="card" style={{border:'1px dashed #1b3255',textAlign:'center',padding:'22px',cursor:'pointer',display:'block'}}>
      <input type="file" accept=".xlsx,.xls,.csv" style={{display:'none'}} onChange={doImport}/>
      <div style={{fontSize:28,marginBottom:6}}>{importing ? '⏳' : '＋'}</div>
      <div style={{fontSize:13,color:'#64748b'}}>{importing ? '导入中…' : '点击上传题库（Excel / CSV）'}</div>
      {importMsg && <div style={{fontSize:12,marginTop:8,color:importMsg.startsWith('✅')?'#22c55e':'#ef4444'}}>{importMsg}</div>}
    </label>
  );
}

function DocParseCard({ pwd, banks, onImported }) {
  const [step, setStep] = useState('idle'); // idle | parsing | preview | saving
  const [msg, setMsg] = useState('');
  const [questions, setQuestions] = useState([]);
  const [docType, setDocType] = useState('general');
  const [checked, setChecked] = useState([]);
  const [bankId, setBankId] = useState('');
  const [newBankName, setNewBankName] = useState('');
  const fileRef = useRef();

  const adminHeaders = pwd => ({ 'x-admin-password': pwd });

  const doParse = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    e.target.value = '';
    setStep('parsing'); setMsg(''); setQuestions([]); setChecked([]);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('count', '5');
    try {
      const r = await fetch('/api/admin/banks/parse-doc', { method: 'POST', headers: adminHeaders(pwd), body: fd });
      const d = await r.json();
      if (!d.ok) { setMsg('❌ ' + (d.error || '解析失败')); setStep('idle'); return; }
      setQuestions(d.questions || []);
      setDocType(d.docType || 'general');
      setChecked((d.questions || []).map((_, i) => i));
      setStep('preview');
    } catch { setMsg('❌ 网络错误'); setStep('idle'); }
  };

  const doSave = async () => {
    const toSave = questions.filter((_, i) => checked.includes(i));
    if (toSave.length === 0) { setMsg('❌ 请至少选择一道题'); return; }
    setStep('saving');
    const target = banks.find(b => b.id === parseInt(bankId));
    const fd = new FormData();
    // 复用 ai-generate 端点保存
    const body = { questions: toSave, bank_id: bankId ? parseInt(bankId) : undefined, bank_name: newBankName.trim() || undefined };
    try {
      const r = await fetch('/api/admin/questions/ai-generate', {
        method: 'POST',
        headers: { ...adminHeaders(pwd), 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '__presaved__', count: 0, bank_id: bankId ? parseInt(bankId) : undefined, bank_name: newBankName.trim() || undefined, presaved: toSave })
      });
      // 因 ai-generate 不支持 presaved，直接用 parse-doc 保存（带 bank_id）
      // 重新调用并带上 bank 信息
      const fd2 = new FormData();
      fd2.append('_saveOnly', '1');
      if (bankId) fd2.append('bank_id', bankId);
      if (newBankName.trim()) fd2.append('bank_name', newBankName.trim());
      // 通过 admin/questions/batch-save 保存
      const r2 = await fetch('/api/admin/questions/batch-save', {
        method: 'POST',
        headers: { ...adminHeaders(pwd), 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions: toSave, bank_id: bankId ? parseInt(bankId) : undefined, bank_name: newBankName.trim() || undefined })
      });
      const d2 = await r2.json();
      if (d2.ok) { setMsg(`✅ 已保存 ${d2.count} 题`); setStep('idle'); onImported?.(); }
      else { setMsg('❌ ' + (d2.error || '保存失败')); setStep('preview'); }
    } catch { setMsg('❌ 网络错误'); setStep('preview'); }
  };

  const toggleCheck = (i) => setChecked(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i]);

  if (step === 'idle' || step === 'parsing') return (
    <label className="card" style={{border:'1px dashed #1e3a5f',textAlign:'center',padding:'22px',cursor: step==='parsing'?'default':'pointer',display:'block',background:'rgba(59,130,246,0.04)'}}>
      <input ref={fileRef} type="file" accept=".docx,.pdf,.jpg,.jpeg,.png,.gif,.webp" style={{display:'none'}} onChange={doParse} disabled={step==='parsing'}/>
      <div style={{fontSize:24,marginBottom:6}}>{step === 'parsing' ? '🤖' : '📄'}</div>
      <div style={{fontSize:13,color:'#3b82f6',fontWeight:600}}>{step === 'parsing' ? 'AI解析中，请稍候…' : '智能出题（Word / PDF / 图片）'}</div>
      <div style={{fontSize:11,color:'#64748b',marginTop:4}}>支持事故分析报告·自动识别出题结构</div>
      {msg && <div style={{fontSize:12,marginTop:8,color:'#ef4444'}}>{msg}</div>}
    </label>
  );

  return (
    <div className="card" style={{border:'1px solid #1e3a5f',padding:'16px'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
        <div style={{fontSize:13,fontWeight:700,color:'#3b82f6'}}>
          🤖 AI识别结果 {docType==='incident' ? '·📋 安全事件报告' : '·📖 业务材料'}
        </div>
        <button onClick={()=>{setStep('idle');setMsg('');}} style={{background:'none',border:'none',color:'#64748b',cursor:'pointer',fontSize:12}}>重新上传</button>
      </div>
      <div style={{fontSize:11,color:'#64748b',marginBottom:8}}>共 {questions.length} 道题，已选 {checked.length} 道</div>
      <div style={{maxHeight:300,overflowY:'auto',marginBottom:12}}>
        {questions.map((q, i) => (
          <div key={i} onClick={()=>toggleCheck(i)} style={{padding:'8px 10px',marginBottom:6,borderRadius:6,border:`1px solid ${checked.includes(i)?'#3b82f6':'#1b3255'}`,cursor:'pointer',background:checked.includes(i)?'rgba(59,130,246,0.08)':'transparent'}}>
            <div style={{display:'flex',gap:8,alignItems:'flex-start'}}>
              <span style={{color:checked.includes(i)?'#3b82f6':'#475569',fontSize:14,flexShrink:0}}>{checked.includes(i)?'☑':'☐'}</span>
              <div>
                <div style={{fontSize:12,color:'#e2e8f0',marginBottom:3}}>{q.text}</div>
                <div style={{fontSize:11,color:'#64748b'}}>参考：{q.reference?.slice(0,60)}{q.reference?.length>60?'…':''}</div>
                {q.category && <span style={{fontSize:10,color:'#3b82f6',background:'rgba(59,130,246,0.1)',padding:'1px 5px',borderRadius:3,marginTop:3,display:'inline-block'}}>{q.category}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div style={{display:'flex',gap:8,marginBottom:8,flexWrap:'wrap'}}>
        <select value={bankId} onChange={e=>{setBankId(e.target.value);setNewBankName('');}} style={{flex:1,minWidth:120,padding:'6px 8px',borderRadius:6,border:'1px solid #1b3255',background:'#0d1117',color:'#e2e8f0',fontSize:12}}>
          <option value=''>-- 选择已有题库 --</option>
          {banks.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <input placeholder="或新建题库名称" value={newBankName} onChange={e=>{setNewBankName(e.target.value);setBankId('');}} style={{flex:1,minWidth:120,padding:'6px 8px',borderRadius:6,border:'1px solid #1b3255',background:'#0d1117',color:'#e2e8f0',fontSize:12}}/>
      </div>
      <button onClick={doSave} disabled={step==='saving'||checked.length===0||(!bankId&&!newBankName.trim())} style={{width:'100%',padding:'9px',background:'linear-gradient(135deg,#1e3a5f,#3b82f6)',border:'none',borderRadius:7,color:'white',fontSize:13,fontWeight:600,cursor:'pointer',opacity:(step==='saving'||checked.length===0||(!bankId&&!newBankName.trim()))?0.5:1}}>
        {step==='saving'?'保存中…':`保存选中 ${checked.length} 题到题库`}
      </button>
      {msg && <div style={{fontSize:12,marginTop:8,color:msg.startsWith('✅')?'#22c55e':'#ef4444'}}>{msg}</div>}
    </div>
  );
}

function AdminScreen({ onBack }) {
  const [authed,setAuthed]=useState(false);
  const [pwd,setPwd]=useState('');
  const [pwdErr,setPwdErr]=useState('');
  const [tab,setTab]=useState('overview');
  const [overview,setOverview]=useState(null);
  const [members,setMembers]=useState([]);
  const [selectedMember,setSelectedMember]=useState(null);
  const [memberDetail,setMemberDetail]=useState(null);
  const [banks,setBanks]=useState([]);
  const [settings,setSettings]=useState({});
  const [qr,setQr]=useState(null);
  const [logs,setLogs]=useState([]);
  const [lbSessions,setLbSessions]=useState([]);
  const [lbMode,setLbMode]=useState('cycle'); // 'cycle'|'alltime'
  const [lbEdit,setLbEdit]=useState(false);
  const [lbAdminDetail,setLbAdminDetail]=useState(null);
  const [lbAdminDetailLoading,setLbAdminDetailLoading]=useState(false);
  const [weakQuestions,setWeakQuestions]=useState([]);
  const [expandedLbStaffId,setExpandedLbStaffId]=useState(null);
  const [incompleteExpanded,setIncompleteExpanded]=useState(false);
  const [lbCollapsed,setLbCollapsed]=useState(true);
  const [allCorrectExpanded,setAllCorrectExpanded]=useState(false);
  const [lowErrorExpanded,setLowErrorExpanded]=useState(false);
  const [exportMonths,setExportMonths]=useState([]);
  const [showExportMenu,setShowExportMenu]=useState(false);
  // 手动添加题目
  const [addQ,setAddQ]=useState({text:'',reference:'',keywords:'',category:'业务知识',difficulty:'中等',bank_id:''});
  const [addQLoading,setAddQLoading]=useState(false);
  // AI生成题目
  const [aiContent,setAiContent]=useState('');
  const [aiCount,setAiCount]=useState(3);
  const [aiBankId,setAiBankId]=useState('');
  const [aiResult,setAiResult]=useState(null);
  const [aiLoading,setAiLoading]=useState(false);
  // 手动选题
  const [qSearch,setQSearch]=useState('');
  const [qAll,setQAll]=useState([]);
  const [qPinned,setQPinned]=useState({ids:[],scope:'none',bank_fallback_id:null});
  const [qSelected,setQSelected]=useState([]);
  const [pinScope,setPinScope]=useState('today');
  const [pinFallback,setPinFallback]=useState('');
  const [qSelectOpen,setQSelectOpen]=useState(false);
  const ah=useMemo?undefined:adminHeaders(pwd); // will pass inline
  const hdrs=(extra={})=>({...adminHeaders(pwd),'Content-Type':'application/json',...extra});

  const login=async()=>{
    try{const r=await api('/api/admin/login',{method:'POST',body:JSON.stringify({password:pwd})});
      if(r.ok){setAuthed(true);}else setPwdErr('密码错误');
    }catch{setPwdErr('连接服务器失败');}
  };

  useEffect(()=>{
    if(!authed)return;
    if(tab==='overview'){apiJson('/api/admin/overview',{headers:hdrs()}).then(setOverview).catch(()=>{});apiJson('/api/admin/leaderboard/cycle',{headers:hdrs()}).then(d=>setLbSessions(d.rows||[])).catch(()=>{});apiJson('/api/admin/weak-questions',{headers:hdrs()}).then(setWeakQuestions).catch(()=>{});apiJson('/api/export/months',{headers:hdrs()}).then(setExportMonths).catch(()=>{});}
    if(tab==='members')apiJson('/api/admin/members',{headers:hdrs()}).then(setMembers).catch(()=>{});
    if(tab==='banks'){apiJson('/api/banks',{headers:hdrs()}).then(d=>{setBanks(d);if(d.length>0){setAiBankId(String(d[0].id));setPinFallback(String(d[0].id));}}).catch(()=>{});apiJson('/api/settings',{headers:hdrs()}).then(setSettings).catch(()=>{});apiJson('/api/admin/pinned-questions',{headers:hdrs()}).then(d=>{setQPinned(d);setQSelected(d.ids||[]);setPinScope(d.scope==='none'?'today':d.scope);setPinFallback(d.bank_fallback_id?String(d.bank_fallback_id):'');}).catch(()=>{});}
    if(tab==='qr')apiJson('/api/qrcode').then(setQr).catch(()=>{});
    if(tab==='logs')apiJson('/api/admin/logs',{headers:hdrs()}).then(setLogs).catch(()=>{});
  },[tab,authed]);

  const loadMemberDetail=async(id)=>{
    setSelectedMember(id);
    const d=await apiJson(`/api/admin/member/${id}`,{headers:hdrs()}).catch(()=>null);
    setMemberDetail(d);
  };

  if(!authed)return(
    <div className="screen login-screen">
      <div className="login-grid-bg"/><div className="login-glow"/>
      <div className="login-card">
        <div className="brand"><div className="brand-icon">🛠</div><div><div style={{fontSize:16,fontWeight:700,color:'white'}}>管理员后台</div><div style={{fontSize:11,color:'#64748b'}}>武汉地铁5号线</div></div></div>
        <div className="gold-rule"/>
        <div className="field"><label>管理员密码</label><input type="password" value={pwd} onChange={e=>setPwd(e.target.value)} onKeyDown={e=>e.key==='Enter'&&login()} placeholder="请输入管理员密码"/></div>
        {pwdErr&&<div className="err-msg">⚠ {pwdErr}</div>}
        <button className="btn-primary" onClick={login}>进入后台</button>
        <button className="link-btn" onClick={onBack}>← 返回首页</button>
      </div>
    </div>
  );

  return(
    <div className="screen admin-screen">
      <div className="page-header"><button className="back-btn" onClick={onBack}>←</button><h2>管理员后台</h2><div/></div>
      <div className="tab-row" style={{flexWrap:'wrap',gap:5}}>
        {[['overview','概览'],['members','人员'],['banks','题库'],['settings','设置'],['logs','日志'],['qr','扫码']].map(([k,v])=>(
          <button key={k} className={`tab${tab===k?' active':''}`} style={{flex:'none',padding:'7px 12px'}} onClick={()=>setTab(k)}>{v}</button>
        ))}
      </div>
      <div style={{padding:'12px 14px 28px',display:'flex',flexDirection:'column',gap:12,overflowY:'auto'}}>

        {tab==='overview'&&overview&&<>

          {/* ── 今日完成情况 ── */}
          <div className="card" style={{padding:0,overflow:'hidden'}}>
            <div style={{padding:'14px 16px 12px'}}>
              <div style={{fontSize:10,color:'#64748b',letterSpacing:2,fontWeight:600,marginBottom:10,textTransform:'uppercase'}}>今日完成情况</div>
              <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:10}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:30,fontWeight:900,color:'white',lineHeight:1}}>{overview.todayComplete}<span style={{fontSize:12,color:'#64748b',fontWeight:400,marginLeft:5}}>/ {overview.totalStaff} 人</span></div>
                  {overview.incompleteList?.length>0
                    ? <div style={{fontSize:11,color:'#f59e0b',marginTop:4}}>还差 {overview.incompleteList.length} 人未完成</div>
                    : <div style={{fontSize:11,color:'#22c55e',marginTop:4}}>全部完成 ✓</div>
                  }
                </div>
                <ScoreRing score={Math.round((overview.todayComplete/Math.max(overview.totalStaff,1))*100)} size={62}/>
              </div>
              <div style={{height:5,background:'#1e293b',borderRadius:3,overflow:'hidden'}}>
                <div style={{height:'100%',width:`${(overview.todayComplete/Math.max(overview.totalStaff,1))*100}%`,background:'linear-gradient(90deg,#3b82f6,#22c55e)',borderRadius:3,transition:'width 0.8s ease'}}/>
              </div>
            </div>
            {overview.incompleteList?.length>0&&(
              <div style={{borderTop:'1px solid #1b3255',padding:'10px 14px 4px'}}>
                <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'6px 8px'}}>
                  {(incompleteExpanded?overview.incompleteList:overview.incompleteList.slice(0,9)).map((p,ni)=>(
                    <div key={ni} style={{display:'flex',flexDirection:'column',gap:2,padding:'6px 8px',background:'rgba(15,38,66,0.5)',border:'1px solid rgba(27,50,85,0.6)',borderRadius:7,minWidth:0}}>
                      <div style={{fontSize:9,color:'#475569',fontWeight:700,lineHeight:1}}>№{ni+1}</div>
                      <div style={{fontSize:12,color:'rgba(255,255,255,0.85)',fontWeight:600,lineHeight:1.3,wordBreak:'keep-all',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.name}</div>
                      {(p.is_tester||p.is_cp||p.is_exempt)?<div style={{display:'flex',gap:3,flexWrap:'wrap'}}>{p.is_tester&&<Badge label="测试" color="#a855f7"/>}{p.is_cp&&<Badge label="车峰" color="#eab308"/>}{p.is_exempt&&<Badge label="免答" color="#64748b"/>}</div>:null}
                    </div>
                  ))}
                </div>
                {overview.incompleteList.length>9&&(
                  <div onClick={()=>setIncompleteExpanded(e=>!e)} style={{display:'flex',alignItems:'center',justifyContent:'center',gap:6,padding:'10px 0 6px',cursor:'pointer',color:'#f59e0b',fontSize:13,fontWeight:600}}>
                    <span style={{display:'inline-block',transform:incompleteExpanded?'rotate(180deg)':'none',transition:'transform 0.2s',fontSize:16}}>⌄</span>
                    {incompleteExpanded?'收起':(`还有 ${overview.incompleteList.length-9} 人，点击展开`)}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── 本期高错误率题目 ── */}
          {weakQuestions.length>0&&(()=>{
            const highError=weakQuestions.filter(q=>q.error_rate>=40);
            const lowError=weakQuestions.filter(q=>q.error_rate>0&&q.error_rate<40);
            const allCorrect=weakQuestions.filter(q=>q.error_rate===0);
            const renderQ=(q,qi,arr,dimmed=false)=>{
              const col=q.error_rate>=70?'#ef4444':q.error_rate>=40?'#f59e0b':'#22c55e';
              return(
                <div key={qi} style={{marginBottom:qi<arr.length-1?14:0}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8,marginBottom:5}}>
                    <span style={{fontSize:11,color:dimmed?'rgba(255,255,255,0.45)':'rgba(255,255,255,0.85)',flex:1,lineHeight:1.6}}>{q.question_text.length>42?q.question_text.slice(0,42)+'…':q.question_text}</span>
                    <span style={{fontSize:14,fontWeight:800,color:col,flexShrink:0}}>{q.error_rate}%</span>
                  </div>
                  <div style={{height:5,background:'#1e293b',borderRadius:3,overflow:'hidden',marginBottom:4}}>
                    <div style={{height:'100%',width:`${q.error_rate}%`,background:`linear-gradient(90deg,${col}55,${col})`,borderRadius:3,transition:'width 0.8s ease'}}/>
                  </div>
                  <div style={{fontSize:9,color:'#475569'}}>
                    {q.total} 次作答 · 均分 {q.avg_score} 分 · {q.wrong} 人错误
                    {q.wrong_names?.length>0&&<span style={{color:'#64748b'}}> （{q.wrong_names.join('、')}）</span>}
                  </div>
                </div>
              );
            };
            return(
              <div className="card" style={{borderColor:'rgba(239,68,68,0.3)'}}>
                <div style={{fontSize:10,color:'#ef4444',letterSpacing:2,fontWeight:600,marginBottom:14,textTransform:'uppercase'}}>本期高错误率题目</div>
                {highError.length===0&&<div style={{fontSize:12,color:'#22c55e',marginBottom:8}}>✓ 暂无错误率 ≥40% 的题目</div>}
                {highError.map((q,qi)=>renderQ(q,qi,highError))}
                {lowError.length>0&&(
                  <div style={{borderTop:highError.length>0?'1px solid rgba(27,50,85,0.5)':'none',paddingTop:highError.length>0?12:0,marginTop:highError.length>0?2:0}}>
                    <div onClick={()=>setLowErrorExpanded(e=>!e)} style={{display:'flex',alignItems:'center',justifyContent:'space-between',cursor:'pointer',marginBottom:lowErrorExpanded?10:0}}>
                      <span style={{fontSize:13,color:'#f59e0b',letterSpacing:0.5,fontWeight:700}}>⚠ 低错误率题目（{lowError.length} 道，1%–39%）</span>
                      <span style={{fontSize:16,color:'#f59e0b',display:'inline-block',transform:lowErrorExpanded?'rotate(180deg)':'none',transition:'transform 0.2s'}}>⌄</span>
                    </div>
                    {lowErrorExpanded&&lowError.map((q,qi)=>renderQ(q,qi,lowError,true))}
                  </div>
                )}
                {allCorrect.length>0&&(
                  <div style={{borderTop:(highError.length>0||lowError.length>0)?'1px solid rgba(27,50,85,0.5)':'none',paddingTop:(highError.length>0||lowError.length>0)?12:0,marginTop:2}}>
                    <div onClick={()=>setAllCorrectExpanded(e=>!e)} style={{display:'flex',alignItems:'center',justifyContent:'space-between',cursor:'pointer',marginBottom:allCorrectExpanded?10:0}}>
                      <span style={{fontSize:13,color:'#22c55e',letterSpacing:0.5,fontWeight:700}}>✓ 全部答对的题目（{allCorrect.length} 道）</span>
                      <span style={{fontSize:16,color:'#22c55e',display:'inline-block',transform:allCorrectExpanded?'rotate(180deg)':'none',transition:'transform 0.2s'}}>⌄</span>
                    </div>
                    {allCorrectExpanded&&allCorrect.map((q,qi)=>(
                      <div key={qi} style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8,padding:'6px 0',borderTop:'1px solid rgba(27,50,85,0.3)'}}>
                        <span style={{fontSize:11,color:'rgba(255,255,255,0.45)',flex:1,lineHeight:1.5}}>{q.question_text.length>42?q.question_text.slice(0,42)+'…':q.question_text}</span>
                        <span style={{fontSize:11,fontWeight:700,color:'#22c55e',flexShrink:0}}>100%</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── 班组各类题均分 ── */}
          <div className="card">
            <div style={{fontSize:10,color:'#64748b',letterSpacing:2,fontWeight:600,marginBottom:10,textTransform:'uppercase'}}>班组各类题均分</div>
            {overview.catAvg?.map((c,i)=><MiniBar key={i} label={c.category} value={c.avg}/>)}
          </div>

          {/* ── 积分榜（折叠式，默认收起，展开显示前10） ── */}
          <div className="card" style={{padding:0,overflow:'hidden'}}>
            <div style={{padding:'12px 16px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                <span style={{fontSize:10,color:'#64748b',letterSpacing:2,fontWeight:600,textTransform:'uppercase'}}>{lbMode==='cycle'?'本轮积分榜':'总排行榜'}</span>
                <button onClick={()=>{const nm=lbMode==='cycle'?'alltime':'cycle';setLbMode(nm);setLbEdit(false);setExpandedLbStaffId(null);setLbAdminDetail(null);apiJson(nm==='alltime'?'/api/admin/leaderboard/alltime':'/api/admin/leaderboard/cycle',{headers:hdrs()}).then(d=>setLbSessions(d.rows||d||[])).catch(()=>{});}} style={{fontSize:10,color:'#3b82f6',background:'rgba(59,130,246,0.08)',border:'1px solid rgba(59,130,246,0.2)',borderRadius:20,padding:'2px 9px',cursor:'pointer'}}>切换{lbMode==='cycle'?'全记录':'本轮'}</button>
              </div>
              <div style={{display:'flex',gap:6,alignItems:'center'}}>
                <button onClick={()=>{setLbEdit(e=>!e);setExpandedLbStaffId(null);setLbAdminDetail(null);}} style={{fontSize:11,color:lbEdit?'#ef4444':'#94a3b8',background:'none',border:`1px solid ${lbEdit?'rgba(239,68,68,0.4)':'#1b3255'}`,borderRadius:6,padding:'3px 9px',cursor:'pointer'}}>{lbEdit?'完成':'编辑'}</button>
              </div>
            </div>
            <div style={{borderTop:'1px solid #1b3255'}}/>
            {lbSessions.slice(0, lbCollapsed ? 10 : lbSessions.length).map((r,i)=>{
              const isExp=expandedLbStaffId===r.staff_id&&!lbEdit;
              const medals=['🥇','🥈','🥉'];
              return(
                <div key={r.id} style={{borderBottom:i<lbSessions.length-1?'1px solid rgba(27,50,85,0.4)':'none',opacity:r.hidden?0.35:1}}>
                  <div onClick={async()=>{
                    if(lbEdit)return;
                    if(expandedLbStaffId===r.staff_id){setExpandedLbStaffId(null);setLbAdminDetail(null);return;}
                    setExpandedLbStaffId(r.staff_id);setLbAdminDetail(null);setLbAdminDetailLoading(true);
                    const ep=lbMode==='alltime'?`/api/leaderboard/alltime/member/${r.staff_id}`:`/api/leaderboard/cycle/member/${r.staff_id}`;
                    const d=await apiJson(ep).catch(()=>null);
                    setLbAdminDetail(d);setLbAdminDetailLoading(false);
                  }} style={{display:'flex',alignItems:'center',gap:8,padding:'11px 16px',cursor:lbEdit?'default':'pointer'}}>
                    <span style={{fontSize:i<3?15:12,width:24,textAlign:'center',flexShrink:0}}>{i<3?medals[i]:(i+1)}</span>
                    <span style={{flex:1,fontSize:13,color:r.hidden?'#475569':'var(--text)',fontWeight:500,display:'flex',alignItems:'center',gap:5,flexWrap:'wrap'}}>
                      {r.staff_name}
                      {r.is_tester?<Badge label="测试" color="#a855f7"/>:null}
                      {r.is_cp?<Badge label="车峰" color="#eab308"/>:null}
                      {r.is_exempt?<Badge label="免答" color="#64748b"/>:null}
                      {r.hidden&&<span style={{fontSize:10,color:'#475569'}}>[已隐藏]</span>}
                      {r.tab_switch_count>0&&<span style={{fontSize:10,color:'#ef4444',background:'rgba(239,68,68,0.1)',border:'1px solid rgba(239,68,68,0.3)',borderRadius:4,padding:'0 5px',fontWeight:700}}>切屏×{r.tab_switch_count}</span>}
                    </span>
                    <span style={{fontSize:11,color:'#64748b',flexShrink:0}}>{r.q_count??r.sessions}题</span>
                    <span style={{fontWeight:700,color:'#c8a84b',fontSize:14,minWidth:28,textAlign:'right',flexShrink:0}}>{r.total_points??r.pts}</span>
                    {!lbEdit&&<span style={{fontSize:16,color:'#60a5fa',display:'inline-block',transform:isExp?'rotate(180deg)':'none',transition:'transform 0.2s',marginLeft:2}}>⌄</span>}
                    {lbEdit&&<div style={{display:'flex',gap:4,marginLeft:4}}>
                      <button onClick={async e=>{e.stopPropagation();await api(`/api/admin/sessions/${r.id}/hide`,{method:'PUT',headers:hdrs(),body:JSON.stringify({hidden:!r.hidden})});setLbSessions(ls=>ls.map(s=>s.id===r.id?{...s,hidden:!s.hidden}:s));}} style={{fontSize:10,padding:'2px 7px',borderRadius:4,border:'1px solid #1b3255',background:'none',color:'#f59e0b',cursor:'pointer'}}>{r.hidden?'恢复':'隐藏'}</button>
                      <button onClick={async e=>{e.stopPropagation();if(!window.confirm(`确认删除 ${r.staff_name} 的这条成绩？`))return;await api(`/api/admin/sessions/${r.id}`,{method:'DELETE',headers:hdrs()});setLbSessions(ls=>ls.filter(s=>s.id!==r.id));}} style={{fontSize:10,padding:'2px 7px',borderRadius:4,border:'1px solid rgba(239,68,68,0.3)',background:'none',color:'#ef4444',cursor:'pointer'}}>删除</button>
                    </div>}
                  </div>
                  {isExp&&(
                    <div style={{borderTop:'1px solid rgba(27,50,85,0.4)',padding:'8px 16px 12px 48px'}}>
                      {lbAdminDetailLoading&&<div style={{padding:'12px 0',display:'flex',justifyContent:'center'}}><div className="spinner" style={{width:20,height:20,borderWidth:2}}/></div>}
                      {!lbAdminDetailLoading&&lbAdminDetail?.sessions?.length===0&&<div style={{color:'#475569',fontSize:12,padding:'8px 0'}}>暂无记录</div>}
                      {!lbAdminDetailLoading&&lbAdminDetail?.sessions?.map((s,si)=>(
                        <div key={si} style={{marginTop:8,background:'rgba(15,38,66,0.5)',border:'1px solid rgba(27,50,85,0.6)',borderRadius:8,padding:'10px 12px'}}>
                          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                            <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                              <span style={{fontSize:10,color:'#64748b'}}>{s.created_at?.slice(5,10)}{s.cycle_label?` · ${s.cycle_label}`:''}</span>
                              {s.tab_switch_count>0&&<span style={{fontSize:10,color:'#ef4444',background:'rgba(239,68,68,0.12)',border:'1px solid rgba(239,68,68,0.3)',borderRadius:4,padding:'0 5px',fontWeight:700}}>切屏×{s.tab_switch_count}</span>}
                            </div>
                            <div style={{display:'flex',gap:6,alignItems:'center'}}>
                              <span style={{fontSize:11,fontWeight:700,color:'white'}}>{s.total_score}分</span>
                              <span style={{fontSize:10,color:'#c8a84b'}}>+{s.total_points}</span>
                            </div>
                          </div>
                          {s.answers?.map((a,ai)=>(
                            <div key={ai} style={{padding:'4px 0',borderTop:'1px solid rgba(27,50,85,0.4)',display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
                              <span style={{fontSize:10,color:'rgba(255,255,255,0.6)',flex:1,lineHeight:1.5}}>{a.question_text}</span>
                              <span style={{fontSize:11,fontWeight:700,flexShrink:0,color:a.score>=99?'#22c55e':a.score>=67?'#f59e0b':'#ef4444'}}>{Math.round(a.score*33/100)}</span>
                            </div>
                          ))}
                          {overview.cycle&&si===0&&lbAdminDetail.sessions.length>0&&(
                            <button onClick={async()=>{if(!window.confirm(`确认删除 ${r.staff_name} 在本套班的全部 ${lbAdminDetail.sessions.length} 条成绩？`))return;const res=await apiJson(`/api/admin/sessions/staff/${r.staff_id}?cycle_id=${overview.cycle.id}`,{method:'DELETE',headers:hdrs()}).catch(()=>null);if(res?.ok){setExpandedLbStaffId(null);setLbAdminDetail(null);apiJson(lbMode==='alltime'?'/api/admin/leaderboard/alltime':'/api/admin/leaderboard/cycle',{headers:hdrs()}).then(d=>setLbSessions(d.rows||d||[])).catch(()=>{});}}} style={{marginTop:8,width:'100%',padding:'5px',background:'rgba(239,68,68,0.07)',border:'1px solid rgba(239,68,68,0.2)',borderRadius:6,color:'#ef4444',fontSize:10,cursor:'pointer'}}>删除本套班全部成绩</button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {lbSessions.length>10&&(
              <div onClick={()=>{setLbCollapsed(c=>!c);setExpandedLbStaffId(null);setLbAdminDetail(null);}} style={{display:'flex',alignItems:'center',justifyContent:'center',gap:6,padding:'11px 16px',cursor:'pointer',borderTop:'1px solid rgba(27,50,85,0.4)',color:'#60a5fa',fontSize:13,fontWeight:600}}>
                <span style={{display:'inline-block',transform:lbCollapsed?'none':'rotate(180deg)',transition:'transform 0.2s',fontSize:15}}>⌄</span>
                {lbCollapsed?`展开全部 (共 ${lbSessions.length} 条)`:'收起（只显示前 10）'}
              </div>
            )}
          </div>

          {/* ── 导出记录 ── */}
          <div style={{position:'relative'}}>
            <button onClick={()=>{setShowExportMenu(m=>!m);if(!exportMonths.length)apiJson('/api/export/months',{headers:hdrs()}).then(setExportMonths).catch(()=>{});}} className="btn-primary" style={{width:'100%',textAlign:'center',padding:'13px',border:'none',cursor:'pointer'}}>📊 导出记录 ▾</button>
            {showExportMenu&&(
              <div onClick={()=>setShowExportMenu(false)} style={{position:'absolute',bottom:'calc(100% + 6px)',left:0,right:0,background:'#0d1e35',border:'1px solid rgba(59,130,246,0.4)',borderRadius:10,overflow:'hidden',zIndex:50,boxShadow:'0 -4px 20px rgba(0,0,0,0.5)'}}>
                <div style={{padding:'8px 14px 6px',fontSize:10,color:'#64748b',letterSpacing:1,fontWeight:600,textTransform:'uppercase'}}>选择月份</div>
                {exportMonths.length===0&&<div style={{padding:'10px 14px',fontSize:12,color:'#475569'}}>暂无数据</div>}
                {exportMonths.map(m=>(
                  <a key={m} href={`/api/export?password=${pwd}&month=${m}`} target="_blank" style={{display:'block',padding:'11px 16px',fontSize:14,color:'white',textDecoration:'none',borderTop:'1px solid rgba(27,50,85,0.5)'}}
                    onMouseEnter={e=>e.currentTarget.style.background='rgba(59,130,246,0.12)'}
                    onMouseLeave={e=>e.currentTarget.style.background='none'}>
                    {m} <span style={{fontSize:11,color:'#64748b',marginLeft:6}}>下载 Excel</span>
                  </a>
                ))}
              </div>
            )}
          </div>
          <button onClick={async()=>{
            if(!window.confirm('确认清除今日所有答题记录？\n（记录会保留在数据库中，不影响 Excel 导出）'))return;
            const r=await apiJson('/api/admin/sessions/today',{method:'DELETE',headers:hdrs()}).catch(()=>null);
            if(r?.ok){alert(`已清除今日 ${r.deleted} 条记录`);apiJson('/api/admin/overview',{headers:hdrs()}).then(setOverview).catch(()=>{});apiJson('/api/admin/weak-questions',{headers:hdrs()}).then(setWeakQuestions).catch(()=>{});const ep=lbMode==='alltime'?'/api/admin/leaderboard/alltime':'/api/admin/leaderboard/cycle';apiJson(ep,{headers:hdrs()}).then(d=>setLbSessions(d.rows||d||[])).catch(()=>{});}
            else alert('清除失败');
          }} style={{width:'100%',marginTop:8,padding:'13px',background:'rgba(239,68,68,0.1)',border:'1px solid rgba(239,68,68,0.3)',borderRadius:8,color:'#ef4444',fontSize:13,fontWeight:600,cursor:'pointer'}}>🗑 清除今日答题数据</button>
        </>}

        {tab==='members'&&<MembersTab members={members} pwd={pwd} onRefresh={()=>apiJson('/api/admin/members',{headers:hdrs()}).then(setMembers).catch(()=>{})} selectedMember={selectedMember} setSelectedMember={setSelectedMember} memberDetail={memberDetail} loadMemberDetail={loadMemberDetail}/>}

        {tab==='banks'&&<>

          {/* ══ 板块1：本套班抽问题目 ══ */}
          {(()=>{
            // 从题库中筛选"概述题"（安全事件类，含"请简述"或"请简要概述"）
            const summaryQs = qAll.filter(q => q.category==='安全事件' && (q.text.includes('请简述') || q.text.includes('请简要概述')));
            // 已选题目详情
            const slots = [0,1,2].map(i => {
              const id = qSelected[i];
              return id ? (qPinned.questions?.find(q=>q.id===id) || summaryQs.find(q=>q.id===id) || qAll.find(q=>q.id===id) || {id,text:'...'}) : null;
            });
            const isManual = qPinned.scope !== 'none';
            return (
              <div className="card">
                <div style={{fontSize:11,color:'#64748b',letterSpacing:1,fontWeight:600,marginBottom:10}}>📌 本套班抽问题目</div>
                {/* 两个模式按钮 */}
                <div style={{display:'flex',gap:8,marginBottom:14}}>
                  <button onClick={async()=>{
                    const r=await apiJson('/api/admin/pinned-questions',{method:'PUT',headers:hdrs(),body:JSON.stringify({ids:[],scope:'none',bank_fallback_id:null})}).catch(()=>null);
                    if(r?.ok){setQPinned({ids:[],scope:'none',bank_fallback_id:null,questions:[]});setQSelected([]);setQSelectOpen(false);}
                  }} style={{flex:1,padding:'10px',borderRadius:8,border:`2px solid ${!isManual?'#3b82f6':'#1b3255'}`,background:!isManual?'rgba(59,130,246,0.12)':'none',color:!isManual?'#60a5fa':'#64748b',cursor:'pointer',fontSize:13,fontWeight:600}}>
                    🎲 应急随机三题
                  </button>
                  <button onClick={()=>{
                    setQSelectOpen(true);
                    if(qAll.length===0) apiJson('/api/admin/questions/all',{headers:hdrs()}).then(setQAll).catch(()=>{});
                  }} style={{flex:1,padding:'10px',borderRadius:8,border:`2px solid ${isManual?'#3b82f6':'#1b3255'}`,background:isManual?'rgba(59,130,246,0.12)':'none',color:isManual?'#60a5fa':'#64748b',cursor:'pointer',fontSize:13,fontWeight:600}}>
                    ✏️ 手动选题
                  </button>
                </div>

                {/* 三个槽位 - 始终显示当前状态 */}
                <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:qSelectOpen?12:0}}>
                  {[0,1,2].map(i=>{
                    const q = isManual ? (qPinned.questions?.[i] || null) : null;
                    const editing = qSelectOpen && qSelected[i]!==undefined;
                    const draft = qSelectOpen ? (qAll.find(x=>x.id===qSelected[i])||null) : null;
                    const display = qSelectOpen ? draft : q;
                    return (
                      <div key={i} style={{display:'flex',alignItems:'center',gap:8,padding:'9px 12px',borderRadius:8,border:`1px solid ${display?'#1e3a5f':'rgba(27,50,85,0.5)'}`,background:display?'rgba(30,58,95,0.3)':'rgba(13,17,23,0.4)'}}>
                        <div style={{width:22,height:22,borderRadius:'50%',background:display?'#1e3a5f':'#0d1117',border:`1px solid ${display?'#3b82f6':'#1b3255'}`,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                          <span style={{fontSize:11,color:display?'#60a5fa':'#475569',fontWeight:700}}>{i+1}</span>
                        </div>
                        <div style={{flex:1,minWidth:0}}>
                          {display
                            ? <div style={{fontSize:12,color:'#e2e8f0',lineHeight:1.4,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{display.text?.slice(0,32)}{display.text?.length>32?'…':''}</div>
                            : <div style={{fontSize:12,color:'#475569'}}>未选题{qSelectOpen?'，请从下方选择':''}</div>
                          }
                        </div>
                        {qSelectOpen&&display&&<button onClick={()=>setQSelected(s=>{const n=[...s];n.splice(i,1);return n;})} style={{background:'none',border:'none',color:'#ef4444',cursor:'pointer',fontSize:14,padding:'0 4px',flexShrink:0}}>×</button>}
                      </div>
                    );
                  })}
                </div>

                {/* 选题面板 */}
                {qSelectOpen&&<>
                  <div style={{fontSize:11,color:'#64748b',marginBottom:8,marginTop:4}}>从事件分析题库选择（点击加入）：</div>
                  <div style={{maxHeight:200,overflowY:'auto',border:'1px solid #1b3255',borderRadius:8,marginBottom:10}}>
                    {summaryQs.length===0
                      ? <div style={{padding:'14px',textAlign:'center',color:'#475569',fontSize:12}}>暂无事件概述题，请先上传事件分析报告</div>
                      : summaryQs.map(q=>{
                          const idx = qSelected.indexOf(q.id);
                          const sel = idx !== -1;
                          return (
                            <div key={q.id} onClick={()=>{
                              if(sel){setQSelected(s=>s.filter(id=>id!==q.id));}
                              else if(qSelected.length<3){setQSelected(s=>[...s,q.id]);}
                            }} style={{display:'flex',gap:8,alignItems:'flex-start',padding:'9px 12px',borderBottom:'1px solid rgba(27,50,85,0.4)',cursor:sel||qSelected.length>=3?'default':'pointer',background:sel?'rgba(59,130,246,0.1)':'none',opacity:!sel&&qSelected.length>=3?0.4:1}}>
                              <div style={{width:16,height:16,borderRadius:3,border:`2px solid ${sel?'#3b82f6':'#475569'}`,background:sel?'#3b82f6':'none',flexShrink:0,marginTop:2,display:'flex',alignItems:'center',justifyContent:'center'}}>
                                {sel&&<span style={{color:'white',fontSize:9}}>✓</span>}
                              </div>
                              <div style={{flex:1}}>
                                <div style={{fontSize:12,color:'white',lineHeight:1.4}}>{q.text.slice(0,50)}{q.text.length>50?'…':''}</div>
                                <div style={{fontSize:10,color:'#475569',marginTop:2}}>{q.bank_name}</div>
                              </div>
                            </div>
                          );
                        })
                    }
                  </div>
                  <div style={{display:'flex',gap:8,marginBottom:8}}>
                    {['today','shift'].map(s=><button key={s} onClick={()=>setPinScope(s)} style={{flex:1,padding:'7px',borderRadius:6,border:`1px solid ${pinScope===s?'#3b82f6':'#1b3255'}`,background:pinScope===s?'rgba(59,130,246,0.15)':'none',color:pinScope===s?'#60a5fa':'#94a3b8',cursor:'pointer',fontSize:12}}>{s==='today'?'今天生效':'本套班生效'}</button>)}
                  </div>
                  <div style={{display:'flex',gap:8}}>
                    <button disabled={qSelected.length===0} onClick={async()=>{
                      const r=await apiJson('/api/admin/pinned-questions',{method:'PUT',headers:hdrs(),body:JSON.stringify({ids:qSelected,scope:pinScope,bank_fallback_id:1})}).catch(()=>null);
                      if(r?.ok){apiJson('/api/admin/pinned-questions',{headers:hdrs()}).then(d=>{setQPinned(d);});setQSelectOpen(false);}
                      else alert('设置失败');
                    }} style={{flex:2,background:'#1b3a6e',border:'none',color:'white',borderRadius:7,padding:'10px',fontSize:13,fontWeight:600,cursor:'pointer',opacity:qSelected.length===0?0.4:1}}>确认启用（{qSelected.length}/3）</button>
                    <button onClick={()=>{setQSelectOpen(false);setQSelected(qPinned.ids||[]);}} style={{flex:1,background:'none',border:'1px solid #1b3255',color:'#64748b',borderRadius:7,padding:'10px',fontSize:12,cursor:'pointer'}}>取消</button>
                  </div>
                </>}
              </div>
            );
          })()}

          {/* ══ 板块2：人工出题 ══ */}
          <div className="card">
            <div style={{fontSize:11,color:'#64748b',letterSpacing:1,fontWeight:600,marginBottom:12}}>✍️ 人工出题</div>
            <div style={{display:'flex',flexDirection:'column',gap:10}}>
              <div style={{display:'flex',flexDirection:'column',gap:8}}>
                <div style={{fontSize:11,color:'#94a3b8',fontWeight:600}}>题目</div>
                <select value={addQ.bank_id} onChange={e=>setAddQ(q=>({...q,bank_id:e.target.value}))} style={{background:'#0d1117',border:'1px solid #1b3255',color:'white',borderRadius:6,padding:'7px 10px',fontSize:13}}>
                  <option value="">选择题库</option>
                  {banks.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                <select value={addQ.category} onChange={e=>setAddQ(q=>({...q,category:e.target.value}))} style={{background:'#0d1117',border:'1px solid #1b3255',color:'white',borderRadius:6,padding:'7px 10px',fontSize:13}}>
                  {['安全事件','应急处置','业务知识','设备操作','规章制度'].map(c=><option key={c}>{c}</option>)}
                </select>
                <textarea value={addQ.text} onChange={e=>setAddQ(q=>({...q,text:e.target.value}))} placeholder="输入题目内容…" rows={3} style={{background:'#0d1117',border:'1px solid #1b3255',color:'white',borderRadius:6,padding:'8px 10px',fontSize:13,resize:'vertical'}}/>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:8}}>
                <div style={{fontSize:11,color:'#94a3b8',fontWeight:600}}>答题要点</div>
                {(addQ.reference?addQ.reference.split(';').filter((_,i,a)=>i<a.length||true):['','']).map((pt,i,arr)=>(
                  <div key={i} style={{display:'flex',gap:6,alignItems:'center'}}>
                    <span style={{fontSize:11,color:'#475569',width:16,flexShrink:0,textAlign:'right'}}>{i+1}.</span>
                    <input value={pt} onChange={e=>{const pts=addQ.reference?addQ.reference.split(';'):[];while(pts.length<=i)pts.push('');pts[i]=e.target.value;setAddQ(q=>({...q,reference:pts.join(';')}));}} placeholder={`要点 ${i+1}`} style={{flex:1,background:'#0d1117',border:'1px solid #1b3255',color:'white',borderRadius:6,padding:'7px 10px',fontSize:13}}/>
                    {i>0&&<button onClick={()=>{const pts=addQ.reference.split(';');pts.splice(i,1);setAddQ(q=>({...q,reference:pts.join(';')}));}} style={{background:'none',border:'none',color:'#475569',cursor:'pointer',fontSize:16,padding:'0 4px'}}>×</button>}
                  </div>
                ))}
                <button onClick={()=>setAddQ(q=>({...q,reference:(q.reference?q.reference+';':'')}))} style={{background:'none',border:'1px dashed #1b3255',color:'#475569',borderRadius:6,padding:'6px',fontSize:12,cursor:'pointer'}}>+ 添加要点</button>
                <button disabled={aiLoading||!addQ.text.trim()} onClick={async()=>{
                  setAiLoading(true);
                  const r=await apiJson('/api/admin/questions/ai-generate',{method:'POST',headers:hdrs(),body:JSON.stringify({content:addQ.text,count:1})}).catch(()=>null);
                  setAiLoading(false);
                  if(r?.ok&&r.questions?.[0]?.reference){setAddQ(q=>({...q,reference:r.questions[0].reference}));alert('AI已生成答题要点');}
                  else alert('AI生成失败');
                }} style={{background:'linear-gradient(135deg,#1e3a5f,#3b82f6)',border:'none',color:'white',borderRadius:7,padding:'9px',fontSize:13,fontWeight:600,cursor:'pointer',opacity:aiLoading?0.6:1}}>{aiLoading?'AI分析中…':'🤖 AI生成答题要点'}</button>
                <button disabled={addQLoading||!addQ.text.trim()||!addQ.reference.trim()||!addQ.bank_id} onClick={async()=>{
                  setAddQLoading(true);
                  const r=await apiJson('/api/questions',{method:'POST',headers:hdrs(),body:JSON.stringify({...addQ,bank_id:parseInt(addQ.bank_id)})}).catch(()=>null);
                  setAddQLoading(false);
                  if(r?.id){alert('添加成功');setAddQ(q=>({...q,text:'',reference:'',keywords:''}));apiJson('/api/banks',{headers:hdrs()}).then(setBanks);}
                  else alert('添加失败');
                }} style={{background:'#1b3a6e',border:'none',color:'white',borderRadius:7,padding:'9px',fontSize:13,fontWeight:600,cursor:'pointer',opacity:addQLoading?0.6:1}}>{addQLoading?'提交中…':'保存题目'}</button>
              </div>
            </div>
          </div>

          {/* ══ 板块3：题库 ══ */}
          {(()=>{
            const emergencyBank = banks.find(b=>b.id===1);
            const incidentBanks = banks.filter(b=>b.id!==1&&(b.name.includes('事件')||b.name.includes('事故')||b.name.includes('分析')||b.name.includes('报告')));
            const internalBanks = banks.filter(b=>b.id!==1&&!b.name.includes('事件')&&!b.name.includes('事故')&&!b.name.includes('分析')&&!b.name.includes('报告'));
            const BankRow = ({b,showTag})=>(
              <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',padding:'9px 12px',borderBottom:'1px solid rgba(27,50,85,0.4)'}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:12,color:'white',fontWeight:600,marginBottom:2,lineHeight:1.4}}>{b.name}</div>
                  <div style={{fontSize:11,color:'#475569'}}>{b.q_count||0} 题</div>
                </div>
                {showTag&&<span style={{fontSize:10,color:'#22c55e',background:'rgba(34,197,94,0.1)',border:'1px solid rgba(34,197,94,0.3)',borderRadius:4,padding:'2px 7px',flexShrink:0,marginLeft:8}}>固定使用</span>}
              </div>
            );
            const Section = ({label,icon,items,fixed})=>{
              const [open,setOpen]=useState(true);
              if(!items||items.length===0)return null;
              return (
                <div style={{marginBottom:10,border:'1px solid #1b3255',borderRadius:8,overflow:'hidden'}}>
                  <div onClick={()=>!fixed&&setOpen(o=>!o)} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'9px 12px',background:'#0d1e35',cursor:fixed?'default':'pointer'}}>
                    <span style={{fontSize:12,fontWeight:700,color:'#94a3b8'}}>{icon} {label} <span style={{color:'#475569',fontWeight:400,fontSize:11}}>· {items.length}个</span></span>
                    {!fixed&&<span style={{color:'#475569',fontSize:11}}>{open?'▲':'▼'}</span>}
                  </div>
                  {open&&items.map((b,i)=><BankRow key={i} b={b} showTag={fixed}/>)}
                </div>
              );
            };
            return (
              <div className="card">
                <div style={{fontSize:11,color:'#64748b',letterSpacing:1,fontWeight:600,marginBottom:12}}>📚 题库</div>
                <div style={{fontSize:11,color:'#475569',marginBottom:10,padding:'7px 10px',background:'rgba(59,130,246,0.06)',borderRadius:6,border:'1px solid rgba(59,130,246,0.15)'}}>
                  💡 应急随机三题固定从<span style={{color:'#60a5fa'}}>应急故障处置题库</span>随机抽取；手动选题从<span style={{color:'#60a5fa'}}>事件分析报告</span>题库中选择
                </div>
                {emergencyBank&&<Section label="应急故障处置" icon="🚨" items={[emergencyBank]} fixed={true}/>}
                <Section label="事件分析报告" icon="📋" items={incidentBanks}/>
                {internalBanks.length>0&&<Section label="其他题库" icon="📖" items={internalBanks}/>}
              </div>
            );
          })()}

          {/* ══ 板块4：上传文件 ══ */}
          <div className="card">
            <div style={{fontSize:11,color:'#64748b',letterSpacing:1,fontWeight:600,marginBottom:12}}>📥 上传题库文件</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              <BankImportCard pwd={pwd} onImported={()=>apiJson('/api/banks',{headers:hdrs()}).then(setBanks).catch(()=>{})}/>
              <DocParseCard pwd={pwd} banks={banks} onImported={()=>apiJson('/api/banks',{headers:hdrs()}).then(setBanks).catch(()=>{})}/>
            </div>
          </div>

        </>}

        {tab==='settings'&&<>
          <div className="card">
            <div style={{fontSize:11,color:'#64748b',letterSpacing:1,marginBottom:12,fontWeight:600}}>题库与答题设置</div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 0',borderBottom:'1px solid #1b3255',fontSize:13}}>
              <span style={{color:'#94a3b8'}}>考试模式</span>
              <div style={{width:38,height:22,borderRadius:11,background:settings.exam_mode==='1'?'#22c55e':'#1e293b',position:'relative',cursor:'pointer'}} onClick={()=>{const nv=settings.exam_mode==='1'?'0':'1';api('/api/settings',{method:'PUT',headers:hdrs(),body:JSON.stringify({exam_mode:nv})}).then(()=>setSettings(s=>({...s,exam_mode:nv})));}}>
                <div style={{width:18,height:18,borderRadius:9,background:'white',position:'absolute',top:2,transition:'transform .2s',transform:settings.exam_mode==='1'?'translateX(18px)':'translateX(2px)'}}/>
              </div>
            </div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 0',fontSize:13}}>
              <span style={{color:'#94a3b8'}}>开新一轮班组</span>
              <button style={{background:'none',border:'1px solid #1b3255',color:'#3b82f6',padding:'5px 12px',borderRadius:7,cursor:'pointer',fontSize:12}} onClick={()=>{const label=prompt('输入本轮班组名称（如：3月第4轮）');if(label)api('/api/admin/cycle/new',{method:'POST',headers:hdrs(),body:JSON.stringify({label})}).then(()=>alert('新周期已开始，排行榜已重置'));}}>开启新轮次 →</button>
            </div>
          </div>
          <div className="card">
            <div style={{fontSize:11,color:'#64748b',letterSpacing:1,marginBottom:12,fontWeight:600}}>积分规则说明</div>
            <div style={{fontSize:13,color:'#94a3b8',lineHeight:2}}>
              每题满分：<strong style={{color:'white'}}>33分</strong>，三题满分 <strong style={{color:'#c8a84b'}}>99分</strong><br/>
              60分及格，按答题得分比例折算<br/>
              本月练习过：额外 <strong style={{color:'#22c55e'}}>+1分</strong><br/>
              本轮排行榜范围：<strong style={{color:'white'}}>白班→夜班→早班（27人）</strong>
            </div>
          </div>
        </>}

        {tab==='qr'&&(
          <div className="card" style={{textAlign:'center'}}>
            <div style={{fontSize:13,color:'#64748b',marginBottom:16}}>班组成员扫码即可进入答题页</div>
            {qr?<><img src={qr.qr} alt="QR" style={{width:240,height:240,borderRadius:10,border:'4px solid #1b3255'}}/><div style={{marginTop:12,fontSize:13,color:'#c8a84b'}}>{qr.url}</div></>:<div className="spinner"/>}
          </div>
        )}

        {tab==='logs'&&(
          <div className="card" style={{padding:0,overflow:'hidden'}}>
            <div style={{padding:'12px 14px 8px',display:'flex',justifyContent:'space-between',alignItems:'center',borderBottom:'1px solid #1b3255'}}>
              <div style={{fontSize:11,color:'#64748b',letterSpacing:1,fontWeight:600}}>后台操作日志</div>
              <button onClick={()=>apiJson('/api/admin/logs',{headers:hdrs()}).then(setLogs).catch(()=>{})} style={{fontSize:11,color:'#3b82f6',background:'none',border:'none',cursor:'pointer'}}>刷新</button>
            </div>
            {logs.length===0&&<div style={{textAlign:'center',color:'#475569',padding:'24px 0',fontSize:13}}>暂无操作记录</div>}
            {logs.map((l,i)=>(
              <div key={l.id} style={{display:'flex',alignItems:'flex-start',gap:10,padding:'9px 14px',borderBottom:i<logs.length-1?'1px solid rgba(27,50,85,0.6)':'none'}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:2}}>
                    <span style={{fontSize:13,fontWeight:600,color:'white'}}>{l.action}</span>
                    <span style={{fontSize:10,color:'#64748b',background:'#1b3255',borderRadius:3,padding:'1px 5px'}}>{l.operator}</span>
                  </div>
                  {l.detail&&<div style={{fontSize:11,color:'#94a3b8',lineHeight:1.5}}>{l.detail}</div>}
                </div>
                <div style={{fontSize:10,color:'#475569',flexShrink:0,whiteSpace:'nowrap'}}>{l.created_at?.slice(5,16)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


// ─── App Root ─────────────────────────────────────────────────────────────
export default function App() {
  const [screen,setScreen]=useState("login");
  const [user,setUser]=useState(null);
  const [quizResults,setQuizResults]=useState([]);
  const [quizPoints,setQuizPoints]=useState(null);
  const [quizMode,setQuizMode]=useState('normal');
  const [practiceMode,setPracticeMode]=useState('practice_random');
  const nav=s=>setScreen(s);
  return(
    <>
      <style>{CSS}</style>
      <div className="app-frame">
        {screen==="login"&&<LoginScreen onLogin={u=>{setUser(u);nav("home");}} onAdmin={()=>nav("admin")}/>}
        {screen==="home"&&<HomeScreen user={user} nav={nav}/>}
        {screen==="quiz"&&<QuizScreen user={user} mode="normal" onDone={(r,p,m)=>{setQuizResults(r);setQuizPoints(p);setQuizMode(m);nav("result");}} onBack={()=>nav("home")}/>}
        {screen==="practice_quiz"&&<QuizScreen user={user} mode={practiceMode} onDone={(r,p,m)=>{setQuizResults(r);setQuizPoints(p);setQuizMode(m);nav("practice_result");}}/>}
        {screen==="result"&&<ResultScreen user={user} results={quizResults} points={quizPoints} mode={quizMode} onHome={()=>nav("home")}/>}
        {screen==="practice_result"&&<ResultScreen user={user} results={quizResults} points={quizPoints} mode={quizMode} onHome={()=>nav("home")} onContinuePractice={()=>{nav("practice_quiz");}}/>}
        {screen==="practice"&&<PracticeScreen user={user} onBack={()=>nav("home")} onStart={m=>{setPracticeMode(m);nav("practice_quiz");}}/>}
        {screen==="history"&&<HistoryScreen user={user} onBack={()=>nav("home")}/>}
        {screen==="banks"&&<BanksPreviewScreen onBack={()=>nav("home")}/>}
        {screen==="leaderboard"&&<LeaderboardScreen user={user} onBack={()=>nav("home")}/>}
        {screen==="profile"&&<ProfileScreen user={user} onBack={()=>nav("home")}/>}
        {screen==="admin"&&<AdminScreen onBack={()=>nav("login")}/>}
      </div>
    </>
  );
}

// ─── CSS ──────────────────────────────────────────────────────────────────
const CSS=`
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300;400;500;700;900&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
:root{--bg:#07101f;--card:#0f2642;--border:#1b3255;--gold:#c8a84b;--blue:#3b82f6;--green:#22c55e;--red:#ef4444;--amber:#f59e0b;--text:#e2e8f0;--muted:#64748b;--font:'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif;}
body{font-family:var(--font);background:var(--bg);color:var(--text);-webkit-tap-highlight-color:transparent;}
.app-frame{width:100%;max-width:440px;margin:0 auto;min-height:100vh;background:var(--bg);}
.screen{min-height:100vh;display:flex;flex-direction:column;background:var(--bg);overflow-y:auto;}
.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px;}
/* Home */
.home-header{padding:18px 16px 10px;display:flex;align-items:flex-start;justify-content:space-between;}
.avatar-btn{background:none;border:none;cursor:pointer;}
.user-avatar{width:38px;height:38px;border-radius:19px;background:linear-gradient(135deg,var(--blue),#0ea5e9);display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;color:white;}
.task-card{background:linear-gradient(135deg,#0d2d5a,#1a4a8a);border:1px solid rgba(59,130,246,.4);border-radius:14px;padding:18px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;box-shadow:0 8px 22px rgba(59,130,246,.18);transition:transform .2s;}
.task-card:hover{transform:translateY(-2px);}
.nav-card{background:var(--card);border:1px solid var(--border);border-radius:11px;padding:12px 6px;text-align:center;cursor:pointer;transition:all .2s;}
.nav-card:hover{border-color:var(--blue);}
.gold-rule{height:1px;background:linear-gradient(90deg,var(--gold),transparent);margin-bottom:18px;}
.brand{display:flex;align-items:center;gap:12px;margin-bottom:18px;}
.brand-icon{width:42px;height:42px;border-radius:10px;background:linear-gradient(135deg,#1e3a5f,#3b82f6);display:flex;align-items:center;justify-content:center;font-size:21px;}
.field{margin-bottom:12px;}
.field label{display:block;font-size:11px;color:var(--muted);margin-bottom:5px;}
.field input{width:100%;background:#0d1e35;border:1px solid var(--border);border-radius:8px;padding:11px 13px;color:var(--text);font-size:15px;font-family:var(--font);outline:none;transition:border-color .2s;}
.field input:focus{border-color:var(--blue);}
.err-msg{color:var(--red);font-size:12px;margin-bottom:8px;}
.btn-primary{width:100%;padding:13px;border-radius:9px;border:none;cursor:pointer;background:linear-gradient(135deg,#1e3a5f,#3b82f6);color:white;font-size:15px;font-weight:600;font-family:var(--font);transition:all .2s;letter-spacing:1px;}
.link-btn{width:100%;margin-top:12px;background:none;border:none;color:var(--muted);font-size:12px;cursor:pointer;text-decoration:underline;font-family:var(--font);}
.page-header{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--border);background:#0d1e35;}
.page-header h2{font-size:15px;font-weight:700;color:white;}
.back-btn{background:none;border:1px solid var(--border);color:var(--text);width:30px;height:30px;border-radius:7px;cursor:pointer;font-size:15px;}
.tab-row{display:flex;gap:5px;padding:10px 12px;border-bottom:1px solid var(--border);}
.tab{flex:1;padding:7px 4px;border-radius:7px;border:1px solid var(--border);background:transparent;color:var(--muted);cursor:pointer;font-family:var(--font);font-size:12px;transition:all .2s;}
.tab.active{background:var(--blue);border-color:var(--blue);color:white;font-weight:600;}
.spinner{width:40px;height:40px;border:3px solid var(--border);border-top-color:var(--blue);border-radius:50%;animation:spin .8s linear infinite;}
/* Animations */
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes slideUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
@keyframes wave{from{height:4px}to{height:18px}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes bgZoom{from{transform:scale(1)}to{transform:scale(1.08)}}
@keyframes cardIn{from{opacity:0;transform:translateY(24px) scale(0.96)}to{opacity:1;transform:translateY(0) scale(1)}}
@keyframes liveDot{0%,100%{box-shadow:0 0 6px rgba(200,57,75,0.5)}50%{box-shadow:0 0 18px rgba(200,57,75,0.8),0 0 36px rgba(200,57,75,0.3)}}
@keyframes glowPulse{0%,100%{opacity:0.5}50%{opacity:1}}
@keyframes mascotIdle{0%,100%{transform:translateY(0) rotate(0deg)}33%{transform:translateY(-5px) rotate(0.5deg)}66%{transform:translateY(-3px) rotate(-0.3deg)}}
@keyframes mascotSpeak{from{transform:translateY(0) scale(1)}to{transform:translateY(-4px) scale(1.018)}}
@keyframes ringOut{from{transform:scale(0.3);opacity:0.7}to{transform:scale(2.5);opacity:0}}
@keyframes barDance{from{transform:scaleY(0.3)}to{transform:scaleY(1)}}
@keyframes micPulse{0%{box-shadow:0 0 0 10px rgba(200,57,75,0.12),0 0 0 20px rgba(200,57,75,0.06),0 8px 24px rgba(200,57,75,0.4)}100%{box-shadow:0 0 0 14px rgba(200,57,75,0.08),0 0 0 28px rgba(200,57,75,0.04),0 8px 24px rgba(200,57,75,0.3)}}
`;
