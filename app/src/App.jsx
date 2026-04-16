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
      onLogin({staffId:d.staffId, name:d.realName||d.staffId, isExempt:!!d.isExempt, isTester:!!d.isTester, isInstructor:!!d.isInstructor});
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
      api("/api/session/start",{method:"POST",body:JSON.stringify({staffId:user.staffId,staffName:user.name,isPractice})})
        .then(async r=>{ const d=await r.json(); if(!r.ok){ const err=new Error(d.error||'启动失败'); err.alreadyDone=d.alreadyDone; err.shiftDeadline=d.shiftDeadline; throw err; } return d; })
    ]).then(([qData,sData])=>{
      setQuestions(qData.questions||[]);
      setSessionId(sData.sessionId);
      setPhase("intro");
      if (mode==='normal') {
        const today=new Date().toISOString().slice(0,10);
        localStorage.setItem('quiz_inprogress',JSON.stringify({staffId:user.staffId,date:today,answered:0,total:(qData.questions||[]).length}));
      }
    }).catch(err=>{ if(err.alreadyDone){ localStorage.removeItem('quiz_inprogress'); setPhase("already_done"); } else if(err.shiftDeadline){ localStorage.removeItem('quiz_inprogress'); setPhase("shift_deadline"); } else setPhase("error"); });
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

  if (phase==="shift_deadline") return (
    <div style={{position:"relative",width:"100%",height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12,background:"#080a0c"}}>
      <div style={{position:"absolute",inset:0,backgroundImage:`url(${IMG_TUNNEL})`,backgroundSize:"cover",backgroundPosition:"center",filter:"brightness(0.3)",pointerEvents:"none"}}/>
      <div style={{position:"relative",zIndex:1,textAlign:"center",padding:"0 32px"}}>
        <div style={{fontSize:40,marginBottom:12}}>⏰</div>
        <div style={{color:"white",fontSize:18,fontWeight:700,marginBottom:8}}>早班答题已截止</div>
        <div style={{color:"rgba(255,255,255,0.45)",fontSize:13,lineHeight:1.7,marginBottom:24}}>早班答题截止时间为 09:30<br/>如需答题请联系班组长</div>
        <button onClick={onBack} style={{padding:"10px 28px",borderRadius:8,border:"1px solid rgba(255,255,255,0.2)",background:"none",color:"white",fontSize:14,cursor:"pointer"}}>返回首页</button>
      </div>
    </div>
  );
  if (phase==="already_done") return (
    <div style={{position:"relative",width:"100%",height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12,background:"#080a0c"}}>
      <div style={{position:"absolute",inset:0,backgroundImage:`url(${IMG_TUNNEL})`,backgroundSize:"cover",backgroundPosition:"center",filter:"brightness(0.3)",pointerEvents:"none"}}/>
      <div style={{position:"relative",zIndex:1,textAlign:"center",padding:"0 32px"}}>
        <div style={{fontSize:40,marginBottom:12}}>✅</div>
        <div style={{color:"white",fontSize:18,fontWeight:700,marginBottom:8}}>本轮已完成答题</div>
        <div style={{color:"rgba(255,255,255,0.45)",fontSize:13,lineHeight:1.7,marginBottom:24}}>每套班（白夜早）只需完成一次答题<br/>下一轮开始后即可继续<br/>您可以在练习板块中继续沉淀</div>
        <button onClick={onBack} style={{padding:"10px 28px",borderRadius:8,border:"1px solid rgba(255,255,255,0.2)",background:"none",color:"white",fontSize:14,cursor:"pointer"}}>返回首页</button>
      </div>
    </div>
  );
  if (phase==="loading"||phase==="error") return (
    <div style={{position:"relative",width:"100%",height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12,background:"#080a0c"}}>
      <div style={{position:"absolute",inset:0,backgroundImage:`url(${IMG_TUNNEL})`,backgroundSize:"cover",backgroundPosition:"center",filter:"brightness(0.3)",pointerEvents:"none"}}/>
      <div style={{position:"relative",zIndex:1,textAlign:"center"}}>
        {phase==="error"?<><div style={{fontSize:30}}>⚠</div><div style={{color:"#ef4444",marginTop:8}}>加载失败，请检查服务器</div></>:<><div className="spinner"/><div style={{color:"rgba(255,255,255,0.5)",marginTop:12,fontSize:14}}>加载题目中…</div></>}
      </div>
    </div>
  );
  if (!q) return (
    <div style={{position:"relative",width:"100%",height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12,background:"#080a0c"}}>
      <div style={{fontSize:30}}>⚠</div>
      <div style={{color:"#ef4444",marginTop:8,fontSize:14}}>题库暂无题目，请联系管理员</div>
      <button onClick={onBack} style={{marginTop:16,padding:"10px 28px",borderRadius:8,border:"1px solid rgba(255,255,255,0.2)",background:"none",color:"white",fontSize:14,cursor:"pointer"}}>返回</button>
    </div>
  );

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
  const [sessions,setSessions]=useState([]);
  const [loading,setLoading]=useState(true);
  const [expanded,setExpanded]=useState({});
  useEffect(()=>{
    apiJson(`/api/me/${user.staffId}/sessions`).then(d=>{
      setSessions(d||[]);
      setLoading(false);
    }).catch(()=>setLoading(false));
  },[]);
  const toggle=(id)=>setExpanded(e=>({...e,[id]:!e[id]}));
  return (
    <div className="screen" style={{padding:'16px'}}>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16}}>
        <button onClick={onBack} style={{background:'none',border:'none',color:'#3b82f6',fontSize:22,cursor:'pointer',padding:'0 4px'}}>←</button>
        <span style={{fontSize:15,fontWeight:700,color:'white'}}>我的答题历史</span>
      </div>
      {loading&&<div style={{color:'#64748b',textAlign:'center',marginTop:40}}>加载中…</div>}
      {!loading&&sessions.length===0&&<div style={{color:'#475569',textAlign:'center',marginTop:40,fontSize:13}}>暂无答题记录</div>}
      {sessions.map((s)=>{
        const avg=Math.round(s.total_score||0);
        const scoreCol=avg>=85?'#22c55e':avg>=60?'#f59e0b':'#ef4444';
        const perQ=Math.round(100/(s.q_count||3));
        const isOpen=!!expanded[s.id];
        return(
          <div key={s.id} className="card" style={{marginBottom:8,padding:0,overflow:'hidden'}}>
            <div onClick={()=>toggle(s.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'12px 14px',cursor:'pointer'}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:12,color:'#64748b'}}>
                  {s.created_at?s.created_at.slice(5,10)+' '+s.created_at.slice(11,16):'--'}
                  {s.cycle_label&&<span style={{marginLeft:6,color:'#475569'}}>{s.cycle_label}</span>}
                  {s.is_practice?<span style={{marginLeft:6,fontSize:10,color:'#f59e0b'}}>练习</span>:null}
                </div>
                <div style={{fontSize:11,color:'#475569',marginTop:2}}>{s.q_count||0}题</div>
              </div>
              <span style={{fontSize:20,fontWeight:800,color:scoreCol,flexShrink:0}}>{avg}<span style={{fontSize:10,fontWeight:400,color:'rgba(255,255,255,0.35)'}}>分</span></span>
              <span style={{fontSize:14,color:'#475569',flexShrink:0,transform:isOpen?'rotate(180deg)':'none',transition:'transform 0.2s'}}>⌄</span>
            </div>
            {isOpen&&(
              <div style={{borderTop:'1px solid rgba(27,50,85,0.6)',padding:'8px 14px 12px'}}>
                {s.answers?.map((a,ai)=>{
                  const pts=Math.round(a.score/(s.q_count||3));
                  const ac=a.score>=99?'#22c55e':a.score>=67?'#f59e0b':'#ef4444';
                  return(
                    <div key={ai} style={{paddingTop:ai>0?10:4,borderTop:ai>0?'1px solid rgba(27,50,85,0.4)':'none'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
                        <span style={{fontSize:11,color:'#94a3b8',flex:1,lineHeight:1.4}}>{ai+1}. {a.question_text}</span>
                        <span style={{fontSize:13,fontWeight:700,color:ac,flexShrink:0,marginLeft:8}}>{pts}<span style={{fontSize:10,color:'rgba(255,255,255,0.3)',fontWeight:400}}>/{perQ}</span></span>
                      </div>
                      <div style={{fontSize:11,color:'#64748b',lineHeight:1.5,paddingLeft:10}}>↳ {a.answer_text||'（无作答）'}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
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
  const [isInterrupted, setIsInterrupted] = useState(false);
  const [makeupGrant, setMakeupGrant] = useState(null); // null or {expiresAt}
  const [makeupPrompted, setMakeupPrompted] = useState(false);
  const [workshopStatus, setWorkshopStatus] = useState(null); // [{plan_id, shift_date, plan_type, relevant, checked_in, instructor_confirmed}]
  const [yearPlanItems, setYearPlanItems] = useState(null); // [{item, trainType}] 本月年度计划项点

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
      if (d.isInterrupted) {
        // 有数据库中断记录，清除 localStorage 残留，改由管理员重置
        localStorage.removeItem('quiz_inprogress');
        setQuizInProgress(null);
        setIsInterrupted(true);
      }
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
        const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
        const regular = members.filter(m => !m.is_exempt && !m.is_cp && !m.is_leader);
        setPeriodTotal(regular.length);
        // last_at is UTC ISO string; convert to CST date for comparison
        setPeriodDone(regular.filter(m => {
          if (!m.last_at) return false;
          const d = new Date(m.last_at);
          return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }) === todayStr;
        }).length);
      }).catch(() => {});

    apiJson('/api/banks').then(banks => {
      setActiveBank(banks.find(b => b.is_default) || banks.find(b => b.is_active) || banks[0]);
    }).catch(() => {});

    fetch('/api/admin/pinned-questions', { headers: { 'x-admin-password': 'admin888' } })
      .then(r => r.json()).then(p => {
        const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
        const hasContent = (p.ids?.length > 0) || (p.mode === 'random' && (p.bank_id || p.bank_ids?.length > 0)) || p.mode === 'emergency';
        const active = hasContent && (
          (p.scope === 'today' && p.created_date === todayStr) || p.scope === 'shift'
        );
        setPinnedInfo(active ? p : null);
      }).catch(() => {});

    // 车间任务状态
    const curMonth = new Date().toISOString().slice(0, 7);
    apiJson(`/api/workshop/my-status?month=${curMonth}&staff_id=${user.staffId}`).then(st => {
      setWorkshopStatus(st || []);
    }).catch(() => {});
    // 年度培训计划本月项点
    const curYr = new Date().getFullYear();
    const curMo = new Date().getMonth() + 1;
    apiJson(`/api/admin/training-year-plan?year=${curYr}`).then(d => {
      const mo = Array.isArray(d) ? d.find(r => r.month === curMo) : null;
      setYearPlanItems(mo?.sessions || []);
    }).catch(() => setYearPlanItems([]));

    // 补答授权查询（每30秒轮询一次）
    const checkMakeup = () => {
      apiJson(`/api/makeup/status/${user.staffId}`).then(d => {
        setMakeupGrant(d.granted ? d : null);
      }).catch(() => {});
    };
    checkMakeup();
    const makeupTimer = setInterval(checkMakeup, 30000);
    return () => clearInterval(makeupTimer);
  }, [user.staffId]);

  const getShiftDeadline = () => {
    const now = new Date();
    const base = new Date('2026-03-22');
    const diff = Math.floor((now - base) / 86400000);
    const phaseDay = ((diff % 4) + 4) % 4;
    const startD = new Date(now); startD.setDate(startD.getDate() - phaseDay);
    const endD = new Date(startD); endD.setDate(endD.getDate() + 2);
    const fmt = d => `${d.getMonth()+1}月${d.getDate()}日`;
    return `${fmt(startD)} — ${fmt(endD)}`;
  };

  const getMonthRange = () => {
    const now = new Date();
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return `${now.getMonth()+1}月1日—${now.getMonth()+1}月${last.getDate()}日`;
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
        <div style={{ fontSize:16, fontWeight:700, color:'var(--text)' }}>
          你好，<span style={{ color:'var(--gold)' }}>{user.name || user.staffId}</span>
          {isExempt && <span style={{ marginLeft:6, fontSize:10, color:'var(--muted)', fontWeight:400, verticalAlign:'middle' }}>班组长</span>}
        </div>
        {/* 右侧：两排状态 */}
        {(() => {
          const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
          const nextOp = (workshopStatus || []).find(s =>
            s.relevant && s.plan_type !== '轮空' && s.shift_date >= today &&
            !(s.plan_type === '中旬会' ? s.checked_in : s.instructor_confirmed)
          );
          const dateShort = d => { const x=new Date(d+'T00:00:00'); return `${x.getMonth()+1}月${x.getDate()}日`; };
          return (
            <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4 }}>
              {/* 行1：本轮班答题 */}
              <div style={{ background:'rgba(200,168,75,.12)', border:'1px solid rgba(200,168,75,.35)', borderRadius:20, padding:'3px 11px', fontSize:11, color:'var(--gold)', fontWeight:700, whiteSpace:'nowrap' }}>
                本轮班答题 {isExempt ? '免答' : taskDone ? '✅' : `${periodDone}/${periodTotal} 已完成`}
              </div>
              {/* 行2：下次回段/场 */}
              <div style={{ fontSize:10, color:'var(--muted)', whiteSpace:'nowrap' }}>
                {nextOp
                  ? nextOp.plan_type === '中旬会'
                    ? <span style={{color:'var(--gold)',fontWeight:600}}>下次回 {nextOp.location||'工人村'} 中旬会 {dateShort(nextOp.shift_date)}</span>
                    : <span>下次{nextOp.location||'回段/场'} <span style={{color:'var(--gold)',fontWeight:600}}>{dateShort(nextOp.shift_date)}</span></span>
                  : <span>本月无待完成实操</span>
                }
              </div>
            </div>
          );
        })()}
      </div>

      {/* ══ 板块一：任务中心 ══ */}
      <SectionCard style={{ marginTop:14 }}>
        <SecHeader title="任务中心" />
        <div style={{ display:'flex' }}>

          {/* 左：班组任务 */}
          <div style={{ flex:1, padding:'12px 14px', display:'flex', flexDirection:'column', gap:8 }}>
            <div style={{display:'flex',alignItems:'baseline',gap:5,flexWrap:'wrap'}}>
              <div style={{ fontSize:12, fontWeight:700, color:'var(--text)' }}>班组任务</div>
              <div style={{ fontSize:9, color:'var(--muted)' }}>{getShiftDeadline()}</div>
            </div>
            <div style={{
              flex:1, background:'#081828', border:'1px solid var(--border)',
              borderRadius:8, padding:'9px 10px', fontSize:11, color:'var(--text)', lineHeight:1.6, minHeight:48
            }}>
              {pinnedInfo
                ? (() => {
                    const cnt = pinnedInfo.count || 3;
                    const pts = Math.round(100 / cnt);
                    if (pinnedInfo.mode === 'random' || pinnedInfo.mode === 'emergency') {
                      let bankLabel;
                      if (pinnedInfo.mode === 'emergency') bankLabel = '应急题库';
                      else if (pinnedInfo.bank_names?.length > 0) bankLabel = pinnedInfo.bank_names.join(' + ');
                      else bankLabel = pinnedInfo.bank_name || '指定题库';
                      return (
                        <div style={{display:'flex',flexDirection:'column',gap:4}}>
                          <div style={{color:'#22c55e',fontWeight:700,fontSize:10}}>📌 今日指定题目</div>
                          <div style={{color:'#e2e8f0',fontSize:12,fontWeight:600,lineHeight:1.5}}>
                            {bankLabel} 随机{cnt}题，每题{pts}分
                          </div>
                        </div>
                      );
                    }
                    // 手动选题：按分类汇总
                    const catMap = {};
                    (pinnedInfo.questions || []).forEach(q => {
                      const c = q.category || '业务知识';
                      catMap[c] = (catMap[c] || 0) + 1;
                    });
                    const summary = Object.entries(catMap).map(([c, n]) => `${n}个${c}`).join('，');
                    const manualCnt = pinnedInfo.questions?.length || cnt;
                    const manualPts = Math.round(100 / manualCnt);
                    return (
                      <div style={{display:'flex',flexDirection:'column',gap:4}}>
                        <div style={{color:'#22c55e',fontWeight:700,fontSize:10}}>📌 今日指定题目</div>
                        <div style={{color:'#e2e8f0',fontSize:12,fontWeight:600,lineHeight:1.5}}>{summary}，每题{manualPts}分</div>
                      </div>
                    );
                  })()
                : activeBank ? activeBank.name : '加载中…'}
            </div>
            {makeupGrant&&!makeupPrompted&&(()=>{ setTimeout(()=>setMakeupPrompted(true),0); return null; })()}
            {makeupGrant&&makeupPrompted&&<AppModal
              icon="⏰"
              title="补答提醒"
              body={`管理员已授权补答\n请在 ${makeupGrant.expiresAt?.slice(11,16)} 前完成本套班答题`}
              buttons={[
                {label:'稍后再答',onClick:()=>setMakeupPrompted(false)},
                {label:'立即补答',primary:true,onClick:()=>{ setMakeupPrompted(false); nav('quiz'); }}
              ]}
            />}
            {isInterrupted
              ? <button disabled style={{ width:'100%', padding:'9px', borderRadius:8, border:'1px solid rgba(239,68,68,0.25)', cursor:'not-allowed', background:'rgba(239,68,68,0.06)', color:'rgba(239,68,68,0.55)', fontSize:11, fontWeight:700, fontFamily:'var(--font)', letterSpacing:'0.3px' }}>答题已中断，请联系管理员重置</button>
              : taskDone
              ? <button className="btn-done" style={{ width:'100%', padding:'9px', borderRadius:8, border:'1px solid rgba(34,197,94,.4)', background:'rgba(34,197,94,.08)', color:'var(--green)', fontSize:11, fontWeight:700, fontFamily:'var(--font)' }}>✓ 今日已完成</button>
              : makeupGrant
              ? <button onClick={() => nav('quiz')} style={{ width:'100%', padding:'9px', borderRadius:8, border:'none', cursor:'pointer', background:'linear-gradient(135deg,#b84d00,#f97316)', color:'white', fontSize:12, fontWeight:800, fontFamily:'var(--font)', letterSpacing:'1px' }}>⏰ 补答（限时）</button>
              : pinnedInfo
              ? <button onClick={() => nav('quiz')} style={{ width:'100%', padding:'9px', borderRadius:8, border:'none', cursor:'pointer', background:'linear-gradient(135deg,#9a6f10,#c8a84b)', color:'#07101f', fontSize:12, fontWeight:800, fontFamily:'var(--font)', letterSpacing:'1px' }}>开始抽问</button>
              : <button disabled style={{ width:'100%', padding:'9px', borderRadius:8, border:'1px solid rgba(255,255,255,0.08)', cursor:'not-allowed', background:'rgba(255,255,255,0.05)', color:'rgba(255,255,255,0.25)', fontSize:11, fontWeight:700, fontFamily:'var(--font)', letterSpacing:'0.5px' }}>管理员尚未发布本套班抽问</button>
            }
          </div>

          <HalfDivider />

          {/* 右：月度任务 */}
          {(() => {
            const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
            const itemDone = (itemName) => (workshopStatus || []).some(s =>
              s.relevant &&
              (s.completed_items || []).includes(itemName) &&
              (s.plan_type === '中旬会' ? s.checked_in : s.instructor_confirmed)
            );
            const myRelevant = (workshopStatus || []).filter(s => s.relevant && s.plan_type !== '轮空');
            const upcoming = myRelevant.filter(s => s.shift_date >= today && !(s.plan_type === '中旬会' ? s.checked_in : s.instructor_confirmed));
            const next = upcoming[0] || null;
            const allItemsDone = yearPlanItems && yearPlanItems.length > 0 && yearPlanItems.every(it => itemDone(it.item));
            return (
              <div style={{ flex:1, padding:'12px 14px', display:'flex', flexDirection:'column', gap:8 }}>
                <div style={{display:'flex',alignItems:'baseline',gap:5,flexWrap:'wrap'}}>
                  <div style={{ fontSize:12, fontWeight:700, color:'var(--text)' }}>月度任务</div>
                  <div style={{ fontSize:9, color:'var(--muted)' }}>{getMonthRange()}</div>
                </div>
                <div style={{
                  flex:1, background:'#081828', border:'1px solid var(--border)',
                  borderRadius:8, padding:'9px 10px', fontSize:10, lineHeight:1.9, minHeight:48,
                  display:'flex', flexDirection:'column', gap:3
                }}>
                  {yearPlanItems === null ? (
                    <span style={{color:'var(--muted)'}}>加载中…</span>
                  ) : yearPlanItems.length === 0 ? (
                    <span style={{color:'var(--muted)'}}>本月暂无培训项点</span>
                  ) : yearPlanItems.map((it,i) => {
                    const done = itemDone(it.item);
                    return (
                      <div key={i} style={{display:'flex',alignItems:'center',gap:4}}>
                        <span style={{fontSize:10,flexShrink:0}}>{done?'✅':'❌'}</span>
                        <span style={{color: done?'#86efac':'#94a3b8',fontSize:10,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{it.item}</span>
                      </div>
                    );
                  })}
                </div>
                {allItemsDone ? (
                  <button disabled style={{ width:'100%', padding:'9px', borderRadius:8, border:'1px solid rgba(34,197,94,.4)', background:'rgba(34,197,94,.08)', color:'var(--green)', fontSize:11, fontWeight:700, fontFamily:'var(--font)' }}>☑ 本月已全部完成</button>
                ) : (
                  <button onClick={()=>nav('workshop')} style={{ width:'100%', padding:'9px', borderRadius:8, border:'none', cursor:'pointer', background:'linear-gradient(135deg,#7c3400,#f97316)', color:'white', fontSize:11, fontWeight:700, fontFamily:'var(--font)' }}>
                    进入日程，进行签到 →
                  </button>
                )}
              </div>
            );
          })()}

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
                    <span style={{fontSize:11,color:'#64748b'}}>{s.created_at?.slice(5,10)}{s.created_at?.length>=16?` ${s.created_at.slice(11,16)}`:''}{s.cycle_label?` · ${s.cycle_label}`:''}</span>
                    {s.tab_switch_count>0&&<span style={{fontSize:10,color:'#ef4444',background:'rgba(239,68,68,0.12)',border:'1px solid rgba(239,68,68,0.3)',borderRadius:4,padding:'0 5px',fontWeight:700}}>切屏×{s.tab_switch_count}</span>}
                  </div>
                  <div style={{display:'flex',gap:8,alignItems:'center'}}>
                    <span style={{fontSize:12,fontWeight:700,color:'white'}}>{Math.round(s.total_score)}分</span>
                  </div>
                </div>
                {s.answers?.map((a,ai)=>(
                  <div key={ai} style={{padding:'6px 0',borderTop:'1px solid rgba(27,50,85,0.5)',display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
                    <span style={{fontSize:11,color:'rgba(255,255,255,0.7)',flex:1,lineHeight:1.5}}>{a.question_text}</span>
                    <span style={{fontSize:12,fontWeight:700,flexShrink:0,color:a.score>=99?'#22c55e':a.score>=67?'#f59e0b':'#ef4444'}}>{Math.round(a.score/(s.answers.length||3))}</span>
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
                <span style={{ flex:1, fontSize:11, color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.staff_name}</span>
                {r.is_instructor?<span style={{fontSize:9,padding:'1px 5px',borderRadius:8,background:'rgba(99,102,241,0.15)',border:'1px solid rgba(99,102,241,0.4)',color:'#a5b4fc',flexShrink:0,marginRight:2}}>教员</span>:null}
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
                <span style={{ flex:1, fontSize:11, color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.staff_name}</span>
                {r.is_instructor?<span style={{fontSize:9,padding:'1px 5px',borderRadius:8,background:'rgba(99,102,241,0.15)',border:'1px solid rgba(99,102,241,0.4)',color:'#a5b4fc',flexShrink:0,marginRight:2}}>教员</span>:null}
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
        <div style={{display:'flex',justifyContent:'center',margin:'20px 0',padding:'14px 20px',background:'#0d1e35',border:'1px solid #1b3255',borderRadius:12}}>
          <div style={{textAlign:'center'}}><div style={{fontSize:32,fontWeight:900,color:'#22c55e'}}>{points.total}</div><div style={{fontSize:11,color:'#64748b'}}>本次得分（满分100）</div></div>
        </div>
      )}
      <div style={{width:'100%',maxWidth:380,marginBottom:24}}>
        {results.map((r,i)=>(
          <div key={i} style={{background:'#0f2642',border:'1px solid #1b3255',borderRadius:10,padding:'12px 14px',marginBottom:8}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:5}}>
              <span style={{fontSize:11,color:'#64748b'}}>第{r.qNum}题 · {r.category}</span>
              <div style={{display:'flex',gap:6,alignItems:'center'}}><Badge label={r.level} color={r.level==='优秀'?'#22c55e':r.level==='合格'?'#f59e0b':'#ef4444'}/><span style={{fontWeight:700,color:r.score>=99?'#22c55e':r.score>=67?'#f59e0b':'#ef4444'}}>{Math.round(r.score/results.length)}<span style={{fontSize:10,color:'rgba(255,255,255,0.4)',fontWeight:400}}>/{Math.round(100/results.length)}分</span></span></div>
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
                    <span style={{fontSize:11,color:'#64748b'}}>{s.created_at?.slice(5,10)}{s.created_at?.length>=16?` ${s.created_at.slice(11,16)}`:''}{s.cycle_label?` · ${s.cycle_label}`:''}</span>
                    {s.tab_switch_count>0&&<span style={{fontSize:10,color:'#ef4444',background:'rgba(239,68,68,0.12)',border:'1px solid rgba(239,68,68,0.3)',borderRadius:4,padding:'0 5px',fontWeight:700}}>切屏×{s.tab_switch_count}</span>}
                  </div>
                  <div style={{display:'flex',gap:8,alignItems:'center'}}>
                    <span style={{fontSize:12,fontWeight:700,color:'white'}}>{Math.round(s.total_score)}分</span>
                  </div>
                </div>
                {s.answers?.map((a,ai)=>(
                  <div key={ai} style={{padding:'6px 0',borderTop:'1px solid rgba(27,50,85,0.5)',display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
                    <span style={{fontSize:11,color:'rgba(255,255,255,0.7)',flex:1,lineHeight:1.5}}>{a.question_text}</span>
                    <span style={{fontSize:12,fontWeight:700,flexShrink:0,color:a.score>=99?'#22c55e':a.score>=67?'#f59e0b':'#ef4444'}}>{Math.round(a.score/(s.answers.length||3))}</span>
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
                <div style={{fontWeight:700,color:'white',fontSize:14}}>{Math.round(s.total_score)}分</div>
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
  const [addForm, setAddForm] = useState({id:'', real_name:'', phone_tail:'', is_exempt:false, is_tester:false, is_cp:false, is_leader:false, is_instructor:false});
  const [addErr, setAddErr] = useState('');
  const [batchText, setBatchText] = useState('');
  const [batchErr, setBatchErr] = useState('');
  const [delConfirm, setDelConfirm] = useState(null);
  const [editId,setEditId]=useState(null);
  const [editForm,setEditForm]=useState({real_name:'',phone_tail:'',is_exempt:false,is_tester:false,is_cp:false,is_leader:false,is_instructor:false});
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
    setEditForm({real_name:m.real_name||'',phone_tail:m.phone_tail||'',is_exempt:!!m.is_exempt,is_tester:!!m.is_tester,is_cp:!!m.is_cp,is_leader:!!m.is_leader,is_instructor:!!m.is_instructor});
    setEditErr('');
  };
  const saveEdit = async () => {
    setEditErr('');
    if (!editForm.real_name.trim()) { setEditErr('姓名不能为空'); return; }
    if (editForm.phone_tail && !/^\d{4}$/.test(editForm.phone_tail)) { setEditErr('手机尾号须为4位数字'); return; }
    const r = await fetch('/api/staff/'+editId, {method:'PUT', headers:hdrs(), body: JSON.stringify({real_name:editForm.real_name.trim(), phone_tail:editForm.phone_tail.trim(), is_exempt:editForm.is_exempt, is_tester:!!editForm.is_tester, is_cp:!!editForm.is_cp, is_leader:!!editForm.is_leader, is_instructor:!!editForm.is_instructor})});
    const d = await r.json();
    if (d.ok) { setEditId(null); onRefresh(); }
    else setEditErr(d.error || '保存失败');
  };
  const addOne = async () => {
    setAddErr('');
    const id = addForm.id.trim().replace(/^Y/i,'');
    if (!id || !addForm.real_name.trim()) { setAddErr('工号和姓名不能为空'); return; }
    if (addForm.phone_tail && !/^\d{4}$/.test(addForm.phone_tail)) { setAddErr('手机尾号须为4位数字'); return; }
    const r = await fetch('/api/staff', {method:'POST', headers:hdrs(), body: JSON.stringify({id, real_name: addForm.real_name.trim(), phone_tail: addForm.phone_tail.trim(), is_exempt: addForm.is_exempt, is_tester: !!addForm.is_tester, is_cp: !!addForm.is_cp, is_leader: !!addForm.is_leader, is_instructor: !!addForm.is_instructor})});
    const d = await r.json();
    if (d.ok) { setShowAdd(false); setAddForm({id:'',real_name:'',phone_tail:'',is_exempt:false,is_tester:false,is_cp:false,is_leader:false,is_instructor:false}); onRefresh(); }
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
    setEditId(null);
    onRefresh();
  };

  return (
    <div>
      {/* 班组长固定行 */}
      {(()=>{
        const leaders=members.filter(m=>!!m.is_leader).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
        if(!leaders.length) return null;
        return (
          <div style={{display:'flex',alignItems:'center',gap:6,padding:'8px 12px 6px',flexWrap:'wrap'}}>
            <span style={{fontSize:10,color:'#64748b',flexShrink:0,marginRight:2}}>班组长</span>
            {leaders.map(m=>(
              <div key={m.id} onClick={()=>openEdit(m)} style={{display:'flex',flexDirection:'column',gap:1,padding:'5px 12px',background:'rgba(245,158,11,0.08)',border:'1px solid rgba(245,158,11,0.38)',borderRadius:6,cursor:'pointer',minWidth:56}}>
                <div style={{fontSize:12,fontWeight:700,color:'#fbbf24',whiteSpace:'nowrap'}}>{m.real_name||'（未设）'}</div>
                <div style={{fontSize:9,color:'#92724a'}}>班组长</div>
              </div>
            ))}
          </div>
        );
      })()}
      {/* 批量操作栏 */}
      <div style={{display:'flex',alignItems:'center',gap:6,padding:'4px 12px',marginBottom:4,flexWrap:'wrap'}}>
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
      {/* 人员列表 - 四列卡片网格 */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'5px 6px',marginBottom:10}}>
        {members.length===0&&<div style={{gridColumn:'1/-1',padding:'20px',textAlign:'center',color:'#475569',fontSize:13}}>暂无人员，请添加</div>}
        {(()=>{
          const sg=arr=>[...arr].sort((a,b)=>String(b.id).localeCompare(String(a.id)));
          // 排序：无身份 → 教员 → 免答 → 其他（车峰/测试），班组长已单独置顶
          const pure=sg(members.filter(m=>!m.is_leader&&!m.is_instructor&&!m.is_exempt&&!m.is_cp&&!m.is_tester));
          const instr=sg(members.filter(m=>!!m.is_instructor&&!m.is_leader));
          const exempt=sg(members.filter(m=>!!m.is_exempt&&!m.is_leader&&!m.is_instructor));
          const others=sg(members.filter(m=>!m.is_leader&&!m.is_instructor&&!m.is_exempt&&(!!m.is_cp||!!m.is_tester)));
          return [...pure,...instr,...exempt,...others];
        })().map(m=>{
          const isDup=members.filter(x=>x.real_name===m.real_name).length>1;
          let nameCol,bg,border;
          if(m.is_instructor){nameCol='#60a5fa';bg='rgba(59,130,246,0.07)';border='rgba(59,130,246,0.28)';}
          else if(m.is_exempt){nameCol='#94a3b8';bg='rgba(100,116,139,0.07)';border='rgba(100,116,139,0.28)';}
          else if(m.is_cp){nameCol='#f97316';bg='rgba(249,115,22,0.07)';border='rgba(249,115,22,0.28)';}
          else if(m.is_tester){nameCol='#c084fc';bg='rgba(168,85,247,0.07)';border='rgba(168,85,247,0.25)';}
          else{nameCol='#e2e8f0';bg='rgba(10,25,41,0.8)';border='rgba(27,50,85,0.8)';}
          if(isDup) nameCol='#fca5a5';
          if(batchSelected.has(m.id)){bg='rgba(59,130,246,0.15)';border='rgba(59,130,246,0.55)';}
          return (
            <div key={m.id} onClick={()=>batchMode?toggleSelect(m.id):openEdit(m)}
              style={{display:'flex',flexDirection:'column',gap:2,padding:'6px 8px',background:bg,border:`1px solid ${border}`,borderRadius:6,minWidth:0,cursor:'pointer',position:'relative'}}>
              {batchMode&&<input type="checkbox" checked={batchSelected.has(m.id)} onChange={()=>toggleSelect(m.id)} onClick={e=>e.stopPropagation()} style={{position:'absolute',top:5,right:5,width:13,height:13,accentColor:'#3b82f6'}}/>}
              <div style={{fontSize:12,fontWeight:700,color:nameCol,lineHeight:1.3,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',paddingRight:batchMode?16:0}}>
                {m.real_name||'（未设）'}
              </div>
              <div style={{fontSize:10,color:'#64748b',display:'flex',gap:3,flexWrap:'wrap',alignItems:'center'}}>
                {!!m.is_instructor&&<Badge label="教员" color="#3b82f6"/>}
                {!!m.is_leader&&<Badge label="组长" color="#f59e0b"/>}
                {!!m.is_exempt&&!m.is_leader&&<Badge label="免答" color="#64748b"/>}
                {!!m.is_tester&&<Badge label="测" color="#a855f7"/>}
                {!!m.is_cp&&<Badge label="峰" color="#eab308"/>}
              </div>
            </div>
          );
        })}
      </div>
      {/* 编辑人员 Modal */}
      {editId&&(()=>{
        const m=members.find(x=>x.id===editId);
        if(!m) return null;
        return (
          <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,padding:16}} onClick={()=>{setEditId(null);setDelConfirm(null);}}>
            <div style={{background:'#0f2744',borderRadius:12,padding:20,width:'100%',maxWidth:380}} onClick={e=>e.stopPropagation()}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
                <div style={{fontWeight:600,color:'#e2e8f0',fontSize:15}}>编辑人员</div>
                <div style={{display:'flex',gap:6,alignItems:'center'}}>
                  {delConfirm===m.id?(
                    <>
                      <span style={{fontSize:11,color:'#fca5a5'}}>确认删除？</span>
                      <button onClick={()=>setDelConfirm(null)} style={{fontSize:11,padding:'3px 8px',borderRadius:5,border:'1px solid #1b3255',background:'transparent',color:'#94a3b8',cursor:'pointer',fontFamily:'inherit'}}>取消</button>
                      <button onClick={()=>delStaff(m.id)} style={{fontSize:11,padding:'3px 8px',borderRadius:5,border:'none',background:'#ef4444',color:'white',cursor:'pointer',fontFamily:'inherit'}}>删除</button>
                    </>
                  ):(
                    <button onClick={()=>setDelConfirm(m.id)} style={{fontSize:11,padding:'3px 8px',borderRadius:5,border:'1px solid rgba(239,68,68,0.4)',background:'transparent',color:'#ef4444',cursor:'pointer',fontFamily:'inherit'}}>删除此人</button>
                  )}
                  <button onClick={()=>{setEditId(null);setDelConfirm(null);}} style={{fontSize:20,lineHeight:1,padding:'0 4px',border:'none',background:'transparent',color:'#64748b',cursor:'pointer'}}>×</button>
                </div>
              </div>
              {[['姓名','real_name','请输入姓名'],['手机后4位','phone_tail','如：1234']].map(([lbl,key,ph])=>(
                <div key={key} style={{marginBottom:8}}>
                  <label style={{display:'block',fontSize:11,color:'#64748b',marginBottom:3}}>{lbl}</label>
                  <input value={editForm[key]} onChange={e=>setEditForm(f=>({...f,[key]:e.target.value}))}
                    placeholder={ph} maxLength={key==='phone_tail'?4:20}
                    style={{width:'100%',background:'#0d1e35',border:'1px solid #1b3255',borderRadius:6,padding:'7px 10px',color:'white',fontSize:13,fontFamily:'inherit',outline:'none',boxSizing:'border-box'}}/>
                </div>
              ))}
              <div style={{display:'flex',flexDirection:'column',gap:7,marginBottom:10}}>
                {[
                  ['ld_'+m.id,'is_leader','班组长（最高权限，免答题，免月度任务）','#f59e0b'],
                  ['inst_'+m.id,'is_instructor','教员（可编辑培训计划）','#3b82f6'],
                  ['ex_'+m.id,'is_exempt','免答（仅免每套班答题）','#94a3b8'],
                  ['ts_'+m.id,'is_tester','测试员（积分标注测试）','#c084fc'],
                  ['cp_'+m.id,'is_cp','车峰（不计入答题统计）','#eab308']
                ].map(([id,key,label,color])=>(
                  <div key={key} style={{display:'flex',alignItems:'center',gap:8}}>
                    <input type="checkbox" id={id} checked={!!editForm[key]} onChange={e=>setEditForm(f=>({...f,[key]:e.target.checked}))} style={{width:15,height:15,accentColor:'#3b82f6'}}/>
                    <label htmlFor={id} style={{fontSize:12,color,cursor:'pointer'}}>{label}</label>
                  </div>
                ))}
              </div>
              {editErr&&<div style={{color:'#ef4444',fontSize:12,marginBottom:6}}>⚠ {editErr}</div>}
              <div style={{display:'flex',gap:8}}>
                <button onClick={()=>{setEditId(null);setDelConfirm(null);}} style={{flex:1,padding:'9px',borderRadius:7,border:'1px solid #1b3255',background:'transparent',color:'#94a3b8',fontFamily:'inherit',fontSize:13,cursor:'pointer'}}>取消</button>
                <button onClick={saveEdit} style={{flex:2,padding:'9px',borderRadius:7,border:'none',background:'linear-gradient(135deg,#1e3a5f,#3b82f6)',color:'white',fontFamily:'inherit',fontSize:13,fontWeight:600,cursor:'pointer'}}>保存</button>
              </div>
            </div>
          </div>
        );
      })()}

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
          {[
            ['add_ld','is_leader','班组长（最高权限，免答题，免月度任务）','#f59e0b'],
            ['add_inst','is_instructor','教员（可编辑培训计划）','#3b82f6'],
            ['exempt','is_exempt','免答（仅免每套班答题）','#94a3b8'],
            ['tester','is_tester','测试员（积分标注测试）','#c084fc'],
            ['add_cp','is_cp','车峰（不计入答题统计）','#eab308'],
          ].map(([id,key,label,color])=>(
            <div key={key} style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
              <input type="checkbox" id={id} checked={!!addForm[key]} onChange={e=>setAddForm(f=>({...f,[key]:e.target.checked}))} style={{width:16,height:16}}/>
              <label htmlFor={id} style={{fontSize:12,color,cursor:'pointer'}}>{label}</label>
            </div>
          ))}
          {addErr&&<div style={{color:'#ef4444',fontSize:12,marginBottom:8}}>⚠ {addErr}</div>}
          <div style={{display:'flex',gap:8}}>
            <button onClick={()=>setShowAdd(false)} style={{flex:1,padding:'10px',borderRadius:7,border:'1px solid #1b3255',background:'transparent',color:'#94a3b8',fontFamily:'inherit',fontSize:13,cursor:'pointer'}}>取消</button>
            <button onClick={addOne} style={{flex:2,padding:'10px',borderRadius:7,border:'none',background:'linear-gradient(135deg,#1e3a5f,#3b82f6)',color:'white',fontFamily:'inherit',fontSize:13,fontWeight:600,cursor:'pointer'}}>确认添加</button>
          </div>
        </div>
      )}

      {/* 培训小组管理 */}
      <TrainingGroupsSection pwd={pwd} staff={members} />

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

// ─── TrainingGroupsSection ────────────────────────────────────────────────
function TrainingGroupsSection({ pwd, staff }) {
  const [groups, setGroups] = useState([]);
  const [fixedGlobal, setFixedGlobal] = useState([]); // 全局固定人员 staff_ids
  const [showAddGroup, setShowAddGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [editingGroup, setEditingGroup] = useState(null);
  const [editingMembers, setEditingMembers] = useState(null); // group id
  const [selectedMembers, setSelectedMembers] = useState(new Set());
  const [assigningStaff, setAssigningStaff] = useState(null); // {id,name}
  const [showFixedEditor, setShowFixedEditor] = useState(false);
  const [pendingFixed, setPendingFixed] = useState(new Set());

  const hdrs = () => ({ 'x-admin-password': pwd, 'Content-Type': 'application/json' });

  const load = async () => {
    const [g, f] = await Promise.all([
      apiJson('/api/admin/training-groups', { headers: hdrs() }).catch(() => []),
      apiJson('/api/admin/training-fixed-members', { headers: hdrs() }).catch(() => []),
    ]);
    if (Array.isArray(g)) setGroups(g);
    if (Array.isArray(f)) setFixedGlobal(f);
  };
  useEffect(() => { if (pwd) load(); }, [pwd]);

  const addGroup = async () => {
    if (!newGroupName.trim()) return;
    await api('/api/admin/training-groups', { method: 'POST', headers: hdrs(), body: JSON.stringify({ name: newGroupName.trim() }) });
    setNewGroupName(''); setShowAddGroup(false); load();
  };

  const deleteGroup = async (id) => {
    if (!window.confirm('确认删除该小组？')) return;
    await api(`/api/admin/training-groups/${id}`, { method: 'DELETE', headers: hdrs() });
    load();
  };

  const saveGroupEdit = async () => {
    const { id, name, instructor_id } = editingGroup;
    if (!name.trim()) return;
    await api(`/api/admin/training-groups/${id}`, { method: 'PUT', headers: hdrs(), body: JSON.stringify({ name: name.trim(), instructor_id: instructor_id || null }) });
    setEditingGroup(null); load();
  };

  const openMemberEdit = (g) => {
    setEditingMembers(g.id);
    setSelectedMembers(new Set(g.members.map(m => m.id)));
  };

  const toggleMember = (staffId) => {
    setSelectedMembers(prev => {
      const s = new Set(prev);
      s.has(staffId) ? s.delete(staffId) : s.add(staffId);
      return s;
    });
  };

  const saveMembers = async () => {
    const members = [...selectedMembers].map(sid => ({ staff_id: sid, is_fixed: 0 }));
    await api(`/api/admin/training-groups/${editingMembers}/members`, { method: 'PUT', headers: hdrs(), body: JSON.stringify({ members }) });
    setEditingMembers(null); load();
  };

  const openFixedEditor = () => {
    setPendingFixed(new Set(fixedGlobal));
    setShowFixedEditor(true);
  };

  const saveFixed = async () => {
    await api('/api/admin/training-fixed-members', { method: 'PUT', headers: hdrs(), body: JSON.stringify({ staff_ids: [...pendingFixed] }) });
    setShowFixedEditor(false); load();
  };

  const addToGroup = async (groupId) => {
    const g = groups.find(x => x.id === groupId);
    if (!g) return;
    const existing = g.members.map(m => ({ staff_id: m.id, is_fixed: 0 }));
    if (existing.some(m => m.staff_id === assigningStaff.id)) { setAssigningStaff(null); return; }
    await api(`/api/admin/training-groups/${groupId}/members`, { method: 'PUT', headers: hdrs(), body: JSON.stringify({ members: [...existing, { staff_id: assigningStaff.id, is_fixed: 0 }] }) });
    setAssigningStaff(null); load();
  };

  const allStaff = (staff || []).filter(s => !s.is_cp);
  const fixedSet = new Set(fixedGlobal);
  const instructorIds = new Set(groups.map(g => g.instructor_id).filter(Boolean));
  const allGroupMemberIds = new Set(groups.flatMap(g => g.members.map(m => m.id)));
  // 未分配：不在任何小组、不是固定人员、不是教员
  const unassigned = allStaff.filter(s => !allGroupMemberIds.has(s.id) && !fixedSet.has(s.id) && !instructorIds.has(s.id));

  const staffName = (id) => {
    const s = (staff || []).find(x => x.id === id);
    return s ? (s.real_name || s.name) : id;
  };

  return (
    <div style={{marginTop:28,borderTop:'1px solid #1b3255',paddingTop:20}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
        <div style={{fontSize:11,color:'#64748b',letterSpacing:1,fontWeight:600}}>培训小组管理</div>
        <div style={{display:'flex',gap:6}}>
          <button onClick={openFixedEditor}
            style={{fontSize:11,padding:'4px 10px',borderRadius:6,border:'1px solid rgba(234,179,8,0.5)',background:fixedGlobal.length?'rgba(234,179,8,0.1)':'transparent',color:'#fbbf24',cursor:'pointer',fontFamily:'inherit'}}>
            固定人员{fixedGlobal.length>0?`（${fixedGlobal.length}）`:''}
          </button>
          <button onClick={()=>setShowAddGroup(true)} style={{fontSize:11,padding:'4px 10px',borderRadius:6,border:'1px solid #3b82f6',background:'transparent',color:'#3b82f6',cursor:'pointer',fontFamily:'inherit'}}>＋ 新建小组</button>
        </div>
      </div>

      {showAddGroup && (
        <div className="card" style={{marginBottom:10}}>
          <div style={{fontSize:11,color:'#64748b',marginBottom:8,fontWeight:600}}>新建小组</div>
          <input value={newGroupName} onChange={e=>setNewGroupName(e.target.value)} placeholder="如：第一小组" style={{width:'100%',background:'#0d1e35',border:'1px solid #1b3255',borderRadius:7,padding:'8px 12px',color:'white',fontSize:13,fontFamily:'inherit',outline:'none',boxSizing:'border-box'}} />
          <div style={{display:'flex',gap:8,marginTop:8}}>
            <button onClick={()=>{setShowAddGroup(false);setNewGroupName('');}} style={{flex:1,padding:'8px',borderRadius:7,border:'1px solid #1b3255',background:'transparent',color:'#94a3b8',fontFamily:'inherit',fontSize:13,cursor:'pointer'}}>取消</button>
            <button onClick={addGroup} style={{flex:2,padding:'8px',borderRadius:7,border:'none',background:'linear-gradient(135deg,#1e3a5f,#3b82f6)',color:'white',fontFamily:'inherit',fontSize:13,fontWeight:600,cursor:'pointer'}}>确认</button>
          </div>
        </div>
      )}

      {groups.map(g => (
        <div key={g.id} className="card" style={{marginBottom:10}}>
          {editingGroup?.id === g.id ? (
            <div>
              <div style={{fontSize:11,color:'#64748b',marginBottom:5}}>小组名称</div>
              <input value={editingGroup.name} onChange={e=>setEditingGroup({...editingGroup,name:e.target.value})} style={{width:'100%',background:'#0d1e35',border:'1px solid #1b3255',borderRadius:7,padding:'7px 10px',color:'white',fontSize:13,fontFamily:'inherit',outline:'none',marginBottom:8,boxSizing:'border-box'}} />
              <div style={{fontSize:11,color:'#64748b',marginBottom:5}}>负责教员</div>
              <select value={editingGroup.instructor_id||''} onChange={e=>setEditingGroup({...editingGroup,instructor_id:e.target.value||null})} style={{width:'100%',background:'#0d1e35',border:'1px solid #1b3255',borderRadius:7,padding:'7px 10px',color:'white',fontSize:13,fontFamily:'inherit',outline:'none',marginBottom:10}}>
                <option value="">— 暂无 —</option>
                {(staff||[]).map(s=><option key={s.id} value={s.id}>{s.real_name||s.name}（{s.id}）</option>)}
              </select>
              <div style={{display:'flex',gap:8}}>
                <button onClick={()=>setEditingGroup(null)} style={{flex:1,padding:'7px',borderRadius:7,border:'1px solid #1b3255',background:'transparent',color:'#94a3b8',fontFamily:'inherit',fontSize:12,cursor:'pointer'}}>取消</button>
                <button onClick={saveGroupEdit} style={{flex:2,padding:'7px',borderRadius:7,border:'none',background:'linear-gradient(135deg,#1e3a5f,#3b82f6)',color:'white',fontFamily:'inherit',fontSize:12,fontWeight:600,cursor:'pointer'}}>保存</button>
              </div>
            </div>
          ) : (
            <div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:600,color:'#e2e8f0',fontSize:14,marginBottom:3}}>{g.name}</div>
                  <div style={{fontSize:11,color:'#64748b',marginBottom:6}}>
                    教员：<span style={{color:'#94a3b8'}}>{g.instructor_id ? staffName(g.instructor_id) : '未指定'}</span>
                  </div>
                  {/* 成员标签 */}
                  <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
                    {g.members.length === 0 && fixedGlobal.length === 0
                      ? <span style={{fontSize:11,color:'#475569'}}>暂无成员</span>
                      : <>
                          {/* 普通成员：过滤掉已是固定人员的（避免重复显示）*/}
                          {g.members.filter(m=>!fixedSet.has(m.id)).map(m => (
                            <span key={m.id} style={{fontSize:11,padding:'2px 7px',borderRadius:5,background:'rgba(59,130,246,0.12)',border:'1px solid rgba(59,130,246,0.3)',color:'#93c5fd'}}>
                              {m.real_name||m.name}
                            </span>
                          ))}
                          {/* 固定人员：始终显示在末尾，无需过滤 */}
                          {fixedGlobal.map(sid=>(
                            <span key={'fx_'+sid} style={{fontSize:11,padding:'2px 7px',borderRadius:5,background:'rgba(234,179,8,0.12)',border:'1px solid rgba(234,179,8,0.4)',color:'#fbbf24',display:'flex',alignItems:'center',gap:3}}>
                              <span style={{fontSize:9,fontWeight:700}}>固</span>{staffName(sid)}
                            </span>
                          ))}
                        </>
                    }
                  </div>
                  <div style={{fontSize:10,color:'#475569',marginTop:5}}>
                    {(()=>{
                      const normalCnt = g.members.filter(m=>!fixedSet.has(m.id)).length;
                      const hasInstructor = !!g.instructor_id;
                      const total = (hasInstructor?1:0) + normalCnt;
                      return <>
                        {hasInstructor?'1个教员 + ':''}本组{normalCnt}人 = {total}人
                        {fixedGlobal.length>0&&<span style={{color:'#78716c'}}> （未加固定{fixedGlobal.length}人）</span>}
                      </>;
                    })()}
                  </div>
                </div>
                <div style={{display:'flex',flexDirection:'column',gap:5,marginLeft:10,flexShrink:0}}>
                  <button onClick={()=>openMemberEdit(g)} style={{fontSize:11,padding:'4px 8px',borderRadius:6,border:'1px solid #475569',background:'transparent',color:'#94a3b8',cursor:'pointer',fontFamily:'inherit'}}>编辑成员</button>
                  <button onClick={()=>setEditingGroup({id:g.id,name:g.name,instructor_id:g.instructor_id})} style={{fontSize:11,padding:'4px 8px',borderRadius:6,border:'1px solid #475569',background:'transparent',color:'#94a3b8',cursor:'pointer',fontFamily:'inherit'}}>编辑小组</button>
                  <button onClick={()=>deleteGroup(g.id)} style={{fontSize:11,padding:'4px 8px',borderRadius:6,border:'1px solid #7f1d1d',background:'transparent',color:'#ef4444',cursor:'pointer',fontFamily:'inherit'}}>删除</button>
                </div>
              </div>
            </div>
          )}
        </div>
      ))}

      {groups.length === 0 && !showAddGroup && (
        <div style={{textAlign:'center',color:'#475569',fontSize:13,padding:'20px 0'}}>暂无培训小组，点击右上角新建</div>
      )}

      {/* 未分配人员 */}
      {groups.length > 0 && (
        <div style={{marginTop:14}}>
          <div style={{fontSize:11,color:'#64748b',fontWeight:600,marginBottom:7}}>
            未分配人员（{unassigned.length}人）
            <span style={{fontSize:10,color:'#475569',fontWeight:400,marginLeft:6}}>点击分配到小组</span>
          </div>
          {unassigned.length === 0
            ? <div style={{fontSize:12,color:'#22c55e'}}>全员已分配</div>
            : <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                {unassigned.map(s => (
                  <div key={s.id} onClick={()=>setAssigningStaff({id:s.id,name:s.real_name||s.name})}
                    style={{fontSize:12,padding:'5px 10px',borderRadius:7,border:'1px dashed #475569',color:'#94a3b8',cursor:'pointer',display:'flex',alignItems:'center',gap:4}}>
                    <span style={{color:'#475569',fontSize:13}}>＋</span>{s.real_name||s.name}
                    {!!s.is_exempt&&<span style={{fontSize:9,padding:'0 3px',borderRadius:3,background:'rgba(100,116,139,0.2)',color:'#64748b'}}>免</span>}
                  </div>
                ))}
              </div>
          }
        </div>
      )}

      {/* 编辑小组成员弹窗 */}
      {editingMembers !== null && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,padding:16}} onClick={()=>setEditingMembers(null)}>
          <div style={{background:'#0f2744',borderRadius:12,padding:20,width:'100%',maxWidth:420,maxHeight:'82vh',display:'flex',flexDirection:'column'}} onClick={e=>e.stopPropagation()}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4,flexShrink:0}}>
              <div style={{fontWeight:600,color:'#e2e8f0',fontSize:15}}>
                编辑成员 — {groups.find(g=>g.id===editingMembers)?.name}
              </div>
              <button onClick={()=>setEditingMembers(null)} style={{fontSize:20,lineHeight:1,padding:'0 4px',border:'none',background:'transparent',color:'#64748b',cursor:'pointer'}}>×</button>
            </div>
            <div style={{fontSize:11,color:'#475569',marginBottom:10,flexShrink:0}}>
              已选 <span style={{color:'#3b82f6'}}>{selectedMembers.size}</span> 人（固定人员自动显示，无需勾选）
            </div>
            <div style={{overflow:'auto',flex:1}}>
              {allStaff.filter(s=>!fixedSet.has(s.id)).map(s => {
                const checked = selectedMembers.has(s.id);
                return (
                  <div key={s.id} onClick={()=>toggleMember(s.id)}
                    style={{display:'flex',alignItems:'center',gap:8,padding:'8px 10px',borderRadius:7,marginBottom:4,cursor:'pointer',
                      background:checked?'#1e3a5f':'transparent',border:'1px solid '+(checked?'#3b82f6':'#1b3255')}}>
                    <div style={{width:16,height:16,borderRadius:3,border:'2px solid '+(checked?'#3b82f6':'#475569'),background:checked?'#3b82f6':'transparent',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,color:'white',flexShrink:0}}>
                      {checked?'✓':''}
                    </div>
                    <span style={{fontSize:13,color:checked?'#e2e8f0':'#64748b',flex:1}}>{s.real_name||s.name}</span>
                    <span style={{fontSize:10,color:'#475569'}}>{s.id}</span>
                    {!!s.is_exempt&&<span style={{fontSize:9,padding:'1px 4px',borderRadius:3,background:'rgba(100,116,139,0.2)',color:'#64748b'}}>免答</span>}
                  </div>
                );
              })}
              {fixedGlobal.length > 0 && (
                <div style={{marginTop:8,paddingTop:8,borderTop:'1px solid rgba(234,179,8,0.2)'}}>
                  <div style={{fontSize:10,color:'#78716c',marginBottom:6}}>固定人员（自动显示在所有小组末尾）</div>
                  {fixedGlobal.map(sid=>(
                    <div key={sid} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 10px',borderRadius:7,marginBottom:3,background:'rgba(234,179,8,0.06)',border:'1px solid rgba(234,179,8,0.2)'}}>
                      <span style={{fontSize:10,color:'#fbbf24',fontWeight:700}}>固</span>
                      <span style={{fontSize:13,color:'#78716c',flex:1}}>{staffName(sid)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{display:'flex',gap:8,marginTop:12,flexShrink:0}}>
              <button onClick={()=>setEditingMembers(null)} style={{flex:1,padding:'10px',borderRadius:7,border:'1px solid #1b3255',background:'transparent',color:'#94a3b8',fontFamily:'inherit',fontSize:13,cursor:'pointer'}}>取消</button>
              <button onClick={saveMembers} style={{flex:2,padding:'10px',borderRadius:7,border:'none',background:'linear-gradient(135deg,#1e3a5f,#3b82f6)',color:'white',fontFamily:'inherit',fontSize:13,fontWeight:600,cursor:'pointer'}}>保存（{selectedMembers.size}人）</button>
            </div>
          </div>
        </div>
      )}

      {/* 固定人员编辑弹窗 */}
      {showFixedEditor && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,padding:16}} onClick={()=>setShowFixedEditor(false)}>
          <div style={{background:'#0f2744',borderRadius:12,padding:20,width:'100%',maxWidth:400,maxHeight:'80vh',display:'flex',flexDirection:'column'}} onClick={e=>e.stopPropagation()}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4,flexShrink:0}}>
              <div style={{fontWeight:600,color:'#e2e8f0',fontSize:15}}>固定培训人员</div>
              <button onClick={()=>setShowFixedEditor(false)} style={{fontSize:20,lineHeight:1,padding:'0 4px',border:'none',background:'transparent',color:'#64748b',cursor:'pointer'}}>×</button>
            </div>
            <div style={{fontSize:11,color:'#64748b',marginBottom:12,flexShrink:0}}>勾选后将自动显示在所有小组末尾，无需逐个小组添加</div>
            <div style={{overflow:'auto',flex:1}}>
              {allStaff.map(s => {
                const checked = pendingFixed.has(s.id);
                return (
                  <div key={s.id} onClick={()=>setPendingFixed(prev=>{const ns=new Set(prev);ns.has(s.id)?ns.delete(s.id):ns.add(s.id);return ns;})}
                    style={{display:'flex',alignItems:'center',gap:8,padding:'8px 10px',borderRadius:7,marginBottom:4,cursor:'pointer',
                      background:checked?'rgba(234,179,8,0.1)':'transparent',border:'1px solid '+(checked?'rgba(234,179,8,0.5)':'#1b3255')}}>
                    <div style={{width:16,height:16,borderRadius:3,border:'2px solid '+(checked?'#fbbf24':'#475569'),background:checked?'#fbbf24':'transparent',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,color:'#0f2744',flexShrink:0,fontWeight:700}}>
                      {checked?'✓':''}
                    </div>
                    <span style={{fontSize:13,color:checked?'#fbbf24':'#64748b',flex:1}}>{s.real_name||s.name}</span>
                    <span style={{fontSize:10,color:'#475569'}}>{s.id}</span>
                  </div>
                );
              })}
            </div>
            <div style={{display:'flex',gap:8,marginTop:12,flexShrink:0}}>
              <button onClick={()=>setShowFixedEditor(false)} style={{flex:1,padding:'10px',borderRadius:7,border:'1px solid #1b3255',background:'transparent',color:'#94a3b8',fontFamily:'inherit',fontSize:13,cursor:'pointer'}}>取消</button>
              <button onClick={saveFixed} style={{flex:2,padding:'10px',borderRadius:7,border:'none',background:'linear-gradient(135deg,#422006,#d97706)',color:'white',fontFamily:'inherit',fontSize:13,fontWeight:600,cursor:'pointer'}}>保存（{pendingFixed.size}人）</button>
            </div>
          </div>
        </div>
      )}

      {/* 分配到小组弹窗 */}
      {assigningStaff && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,padding:16}} onClick={()=>setAssigningStaff(null)}>
          <div style={{background:'#0f2744',borderRadius:12,padding:20,width:'100%',maxWidth:360}} onClick={e=>e.stopPropagation()}>
            <div style={{fontWeight:600,color:'#e2e8f0',fontSize:14,marginBottom:4}}>将 {assigningStaff.name} 加入小组</div>
            <div style={{fontSize:11,color:'#64748b',marginBottom:14}}>选择要加入的小组</div>
            {groups.map(g => (
              <div key={g.id} onClick={()=>addToGroup(g.id)}
                style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'11px 14px',borderRadius:8,border:'1px solid #1b3255',marginBottom:7,cursor:'pointer',background:'#0a1929'}}>
                <span style={{fontSize:13,color:'#e2e8f0'}}>{g.name}</span>
                <span style={{fontSize:11,color:'#64748b'}}>{g.members.length}人</span>
              </div>
            ))}
            <button onClick={()=>setAssigningStaff(null)} style={{width:'100%',padding:'9px',borderRadius:7,border:'1px solid #1b3255',background:'transparent',color:'#94a3b8',fontFamily:'inherit',fontSize:13,cursor:'pointer',marginTop:4}}>取消</button>
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

// ─── WorkshopScreen ───────────────────────────────────────────────────────────
function WorkshopScreen({ user, onBack }) {
  const now = new Date();
  const defaultMonth = now.toISOString().slice(0, 7);
  const todayStr = now.toISOString().slice(0, 10);
  const [month, setMonth] = useState(defaultMonth);
  const [plan, setPlan] = useState(null);
  const [myStatus, setMyStatus] = useState([]);
  const [loading, setLoading] = useState(true);
  // 权限：教员或管理员均可编辑
  const [adminPwd, setAdminPwd] = useState('');
  const [showAdminInput, setShowAdminInput] = useState(false);
  const [pwdInput, setPwdInput] = useState('');
  // 日程卡显示模式：false=只展示相关卡，true=全部展开+可编辑
  const [wsEditMode, setWsEditMode] = useState(false);
  // 非相关卡单独展开集合
  const [expandedCards, setExpandedCards] = useState(new Set());
  // 行内展开字段：{planId, field} 当前正在展开选择的字段
  const [activeField, setActiveField] = useState(null);
  // 轮空确认弹窗
  const [lunKongConfirm, setLunKongConfirm] = useState(null); // {planId, prevType, noteInput}
  // 成员操作弹窗
  const [memberModal, setMemberModal] = useState(null);
  // {planId, staffId, staffName, isAdded, step:'main'|'swap'|'postpone', candidates:[], target:null}
  // 导出菜单
  const [showWsExport, setShowWsExport] = useState(false);
  const [wsExportMonths, setWsExportMonths] = useState([]);

  // 照片相册
  const [photoAlbum, setPhotoAlbum] = useState(null); // null | {photos:[],loading:false}
  const [lightbox, setLightbox] = useState(null); // null | {photos:[],index:number}
  const [albumWatermark, setAlbumWatermark] = useState(true);
  const [albumLocation, setAlbumLocation] = useState('');
  const [albumLocLoading, setAlbumLocLoading] = useState(false);
  const [albumDate, setAlbumDate] = useState(() => new Date().toLocaleDateString('sv-SE', {timeZone:'Asia/Shanghai'}));
  const albumFileRef = useRef(null);
  const albumCameraRef = useRef(null);
  // 后台上传队列
  const [uploadQueue, setUploadQueue] = useState([]); // [{id, planId, filename, status:'uploading'|'done'|'error'}]
  // 现场记录弹窗
  const [photoModal, setPhotoModal] = useState(null);
  // {planId, photos:[]}
  // 确认点评弹窗
  const [evalModal, setEvalModal] = useState(null);
  // {planId, members:[], step:'pick'|'eval', target:{staffId,staffName}, comment:'', saving:false, evaluations:{}}
  // 弹窗
  const [showSettings, setShowSettings] = useState(false);
  const [safetyInput, setSafetyInput] = useState('');
  const [startGroupInput, setStartGroupInput] = useState('');
  const [startLeaderInput, setStartLeaderInput] = useState('');
  const [confirmingId, setConfirmingId] = useState(null);
  const [zhxhExpanded, setZhxhExpanded] = useState(new Set()); // 中旬会展开全员名单的 plan id 集合

  const isInstructor = !!(user?.isInstructor);
  const hasEditPerm = !!(adminPwd || isInstructor); // 有权限（不管当前是否在编辑模式）
  const canEdit = hasEditPerm && wsEditMode;         // 实际可编辑

  const hdrs = () => {
    const h = { 'Content-Type': 'application/json' };
    if (adminPwd) h['x-admin-password'] = adminPwd;
    if (isInstructor && !adminPwd) h['x-instructor-id'] = String(user.staffId);
    return h;
  };

  const load = async (m) => {
    setLoading(true);
    const [d, st] = await Promise.all([
      apiJson(`/api/workshop/training-plan?month=${m}`).catch(() => null),
      user ? apiJson(`/api/workshop/my-status?month=${m}&staff_id=${user.staffId}`).catch(() => []) : Promise.resolve([]),
    ]);
    if (d) setPlan(d);
    setMyStatus(st || []);
    setLoading(false);
  };

  useEffect(() => { load(month); }, [month]);

  // 找到我所在的小组ID
  const myGroupId = plan ? (() => {
    for (const g of (plan.groups || [])) {
      if (String(g.instructor_id) === String(user?.staffId)) return g.id;
      if ((g.members || []).some(m => String(m.id) === String(user?.staffId))) return g.id;
    }
    return null;
  })() : null;
  const isFixedMember = plan ? (plan.fixedStaff || []).some(f => f.staff_id === user?.staffId) : false;
  const isMyRow = (p) => {
    if (!user) return false;
    if (p.plan_type === '中旬会') return true;
    if (isFixedMember && p.plan_type !== '轮空') return true;
    const g = p.group;
    // 该计划的教员（用 String 比较避免类型不一致）
    if (g && g.instructor_id && String(g.instructor_id) === String(user.staffId)) return true;
    // 该计划的小组成员
    if (p.group_id && p.group_id === myGroupId) return true;
    // 班组长
    if (p.leader_name && p.leader_name === (user.name || '')) return true;
    // 成员覆盖里被加入的情况
    const overrides = p.memberOverrides || {};
    if ((overrides.added || []).some(a => String(a.id||a.staff_id) === String(user.staffId))) return true;
    return false;
  };

  // 教员确认（教员为某人确认）
  const doConfirm = async (planId, staffId) => {
    setConfirmingId(planId + '-' + staffId);
    await api('/api/workshop/instructor-confirm', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ plan_id: planId, staff_id: staffId, confirmed_by: user?.staffId }) }).catch(()=>{});
    load(month);
    setConfirmingId(null);
  };

  const shiftMonth = (delta) => {
    setActiveField(null);
    setMonth(m => {
      const d = new Date(m + '-01');
      d.setMonth(d.getMonth() + delta);
      return d.toISOString().slice(0, 7);
    });
  };

  const confirmAdminPwd = () => {
    setAdminPwd(pwdInput);
    setPwdInput('');
    setShowAdminInput(false);
  };

  // 确保有权限才提交：管理员密码 或 教员身份
  const ensurePwd = () => {
    if (adminPwd || isInstructor) return true;
    setShowAdminInput(true);
    return false;
  };

  const saveSettings = async () => {
    if (!ensurePwd()) return;
    await api('/api/admin/training-plan/settings', {
      method: 'PUT', headers: hdrs(),
      body: JSON.stringify({ month, safety_date: safetyInput || null, start_group_id: startGroupInput ? parseInt(startGroupInput) : null, start_leader_idx: startLeaderInput !== '' ? parseInt(startLeaderInput) : undefined })
    });
    setShowSettings(false);
    load(month);
  };

  const regenerate = async () => {
    if (!ensurePwd()) return;
    if (!window.confirm(`重新生成 ${monthLabel(month)} 培训计划？已有修改会丢失。`)) return;
    await api('/api/admin/training-plan/regenerate', { method: 'POST', headers: hdrs(), body: JSON.stringify({ month }) });
    load(month);
  };

  // 通用保存单字段变更
  const patchRow = async (planId, changes, logEntry) => {
    if (!ensurePwd()) return;
    setActiveField(null);
    await api(`/api/admin/training-plan/${planId}`, {
      method: 'PUT', headers: hdrs(),
      body: JSON.stringify({ ...changes, log_entry: logEntry || undefined })
    });
    load(month);
  };

  // 客户端压缩图片：Canvas 缩放到 maxW，输出 JPEG blob
  const compressImage = (file, maxW=800, quality=0.62) => new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob(blob => resolve(blob || file), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });

  // 给图片打水印（Canvas），返回 Blob
  const addWatermark = (file, locationText, customDate) => new Promise(resolve => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      // 水印文字：用选定日期 + 当前时间
      const now = new Date();
      const pad = n => String(n).padStart(2,'0');
      const datePart = customDate
        ? customDate.replace(/-/g, '.') // "2026-04-15" → "2026.04.15"
        : `${now.getFullYear()}.${pad(now.getMonth()+1)}.${pad(now.getDate())}`;
      const dateStr = `${datePart}，${pad(now.getHours())}:${pad(now.getMinutes())}`;
      const locStr = `地点：${locationText||'未知地点'}`;
      const lines = [dateStr, locStr];
      const fontSize = Math.max(16, Math.round(canvas.width * 0.026));
      ctx.font = `bold ${fontSize}px sans-serif`;
      ctx.textBaseline = 'bottom';
      const padding = Math.round(fontSize * 0.5);
      const lineH = Math.round(fontSize * 1.4);
      const maxW = lines.reduce((m,l)=>Math.max(m,ctx.measureText(l).width),0);
      const boxW = maxW + padding * 2;
      const boxH = lines.length * lineH + padding;
      // 左下角
      const x = padding;
      const y = canvas.height - boxH - padding;
      // 半透明背景（更透明）
      ctx.fillStyle = 'rgba(0,0,0,0.32)';
      ctx.beginPath();
      ctx.roundRect(x - 2, y - 2, boxW + 4, boxH + 4, 6);
      ctx.fill();
      // 白色文字
      lines.forEach((line, i) => {
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.fillText(line, x + padding, y + padding + (i + 1) * lineH);
      });
      canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.88);
    };
    img.onerror = () => resolve(file);
    img.src = url;
  });

  // 相册拍照/导入上传
  const albumUploadFile = async (file) => {
    const targetDate = albumDate;
    // 找选定日期的计划，找不到就找最近日期（允许后补）
    let planId = null;
    if (plan?.plans) {
      const exact = plan.plans.find(p => p.shift_date === targetDate && p.plan_type !== '轮空');
      if (exact) planId = exact.id;
      if (!planId) {
        // 找日期最接近的计划
        const valid = plan.plans.filter(p=>p.plan_type!=='轮空').sort((a,b)=>
          Math.abs(new Date(a.shift_date)-new Date(targetDate)) - Math.abs(new Date(b.shift_date)-new Date(targetDate))
        );
        if (valid.length) planId = valid[0].id;
      }
    }
    if (!planId) { alert('未找到可关联的培训计划'); return; }
    let uploadFile = file;
    if (albumWatermark) {
      const locText = albumLocation || locationRef.current || '未知地点';
      // 先压缩再打水印，避免在原始大图上操作
      const compressed = await compressImage(file);
      const watermarked = await addWatermark(compressed, locText, targetDate);
      uploadFile = new File([watermarked], file.name||'photo.jpg', {type:'image/jpeg'});
      // 已经压缩过，直接上传（跳过 uploadPhoto 内部的二次压缩）
      const qid = Date.now();
      const name = uploadFile.name;
      setUploadQueue(q => [...q, {id:qid, planId, filename:name, status:'uploading'}]);
      (async () => {
        try {
          const fd = new FormData();
          fd.append('photo', uploadFile, name);
          const headers = {};
          if (adminPwd) headers['x-admin-password'] = adminPwd;
          if (isInstructor && !adminPwd) headers['x-instructor-id'] = String(user.staffId);
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 30000);
          let r = null;
          try {
            const resp = await fetch(`/api/workshop/training-plan/${planId}/photos`, {method:'POST',headers,body:fd,signal:controller.signal});
            r = await resp.json();
          } finally { clearTimeout(timer); }
          if (r?.ok) {
            setUploadQueue(q => q.map(x => x.id===qid ? {...x,status:'done'} : x));
            const photos = await apiJson('/api/workshop/photos').catch(()=>[]);
            setPhotoAlbum(prev => prev ? {...prev, photos: Array.isArray(photos)?photos:[]} : prev);
            setTimeout(() => setUploadQueue(q => q.filter(x => x.id!==qid)), 3000);
          } else {
            setUploadQueue(q => q.map(x => x.id===qid ? {...x,status:'error'} : x));
          }
        } catch(e) {
          setUploadQueue(q => q.map(x => x.id===qid ? {...x,status:'error'} : x));
        }
      })();
      return;
    }
    await uploadPhoto(uploadFile, planId);
    // 刷新相册
    const photos = await apiJson('/api/workshop/photos').catch(()=>[]);
    setPhotoAlbum(prev => prev ? {...prev, photos: Array.isArray(photos)?photos:[]} : prev);
  };

  // 定位
  const albumGeolocate = () => {
    if (!navigator.geolocation) return;
    setAlbumLocLoading(true);
    navigator.geolocation.getCurrentPosition(pos => {
      setAlbumLocLoading(false);
      // 简单按经纬度判断两个地点
      // 工人村车辆段：约 114.30, 30.52；青菱车场：约 114.20, 30.46（示意值，实际靠用户手动修正）
      const {latitude: lat, longitude: lng} = pos.coords;
      // 计算到两点的距离
      const dist = (a,b,c,d) => Math.sqrt((a-c)**2+(b-d)**2);
      const dGongren = dist(lat,lng,30.52,114.30);
      const dQingling = dist(lat,lng,30.46,114.20);
      setAlbumLocation(dGongren < dQingling ? '工人村车辆段' : '青菱车场');
    }, () => setAlbumLocLoading(false), {timeout:8000});
  };

  const locationRef = useRef('');
  useEffect(()=>{ locationRef.current = albumLocation; }, [albumLocation]);

  // 后台上传（压缩后），不阻塞 UI，完成后刷新 photoModal
  const uploadPhoto = async (file, planId) => {
    const qid = Date.now();
    const name = file.name || 'photo.jpg';
    setUploadQueue(q => [...q, {id:qid, planId, filename:name, status:'uploading'}]);
    // 异步在后台执行，不 await，让 UI 立即响应
    (async () => {
      try {
        const blob = await compressImage(file);
        const fd = new FormData();
        fd.append('photo', blob, name.replace(/\.[^.]+$/, '.jpg'));
        const headers = {};
        if (adminPwd) headers['x-admin-password'] = adminPwd;
        if (isInstructor && !adminPwd) headers['x-instructor-id'] = String(user.staffId);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30000);
        let r = null;
        try {
          const resp = await fetch(`/api/workshop/training-plan/${planId}/photos`, {method:'POST',headers,body:fd,signal:controller.signal});
          r = await resp.json();
        } finally {
          clearTimeout(timer);
        }
        if (r?.ok) {
          setUploadQueue(q => q.map(x => x.id===qid ? {...x,status:'done'} : x));
          setPhotoModal(prev => {
            if (prev?.planId === planId) {
              apiJson(`/api/workshop/training-plan/${planId}/photos`).then(photos => {
                setPhotoModal(p2 => p2?.planId===planId ? {...p2, photos:Array.isArray(photos)?photos:[]} : p2);
              });
            }
            return prev;
          });
          setTimeout(() => setUploadQueue(q => q.filter(x => x.id!==qid)), 3000);
        } else {
          setUploadQueue(q => q.map(x => x.id===qid ? {...x,status:'error'} : x));
        }
      } catch(e) {
        setUploadQueue(q => q.map(x => x.id===qid ? {...x,status:'error'} : x));
      }
    })();
  };

  // 切换类型，轮空需要确认+备注
  const handleTypeChange = (p, newType) => {
    if (newType === p.plan_type) { setActiveField(null); return; }
    if (newType === '轮空') {
      setLunKongConfirm({ planId: p.id, prevType: p.plan_type, noteInput: '' });
      setActiveField(null);
    } else {
      const now = new Date().toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'});
      patchRow(p.id, { plan_type: newType }, `${now} 培训方式改为"${newType}"`);
    }
  };

  // 确认设为轮空
  const confirmLunKong = async () => {
    if (!lunKongConfirm) return;
    const { planId, noteInput } = lunKongConfirm;
    const now = new Date().toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'});
    await patchRow(planId, { plan_type: '轮空', group_id: null, leader_name: null, notes: noteInput || null },
      `${now} 设为轮空${noteInput ? `（${noteInput}）` : ''}`);
    setLunKongConfirm(null);
  };

  const monthLabel = (m) => `${parseInt(m.split('-')[1])}月`;

  const dateLabel = (dateStr) => {
    const d = new Date(dateStr + 'T00:00:00');
    const mo = d.getMonth() + 1, day = d.getDate();
    const wd = ['日','一','二','三','四','五','六'][d.getDay()];
    return `${mo}月${day}日（周${wd}）`;
  };

  const typeStyle = (t) => {
    if (t === '轮空')  return { text:'#475569', bg:'rgba(71,85,105,0.1)',  border:'rgba(71,85,105,0.3)' };
    if (t === '中旬会') return { text:'#f59e0b', bg:'rgba(245,158,11,0.1)', border:'rgba(245,158,11,0.35)' };
    return { text:'#3b82f6', bg:'rgba(59,130,246,0.1)', border:'rgba(59,130,246,0.28)' };
  };

  // 我的相关培训 sessions（本月）
  const myRelevant = myStatus.filter(s => s.relevant && s.plan_type !== '轮空');
  const nextSession = myRelevant.find(s => {
    if (s.shift_date < todayStr) return false;
    if (s.plan_type === '中旬会') return !s.checked_in;
    return !s.instructor_confirmed;
  }) || null;

  // 按地点归类（本月，location 直接从 myStatus 取）
  const myQingling = myRelevant.filter(s => s.location === '青菱车场' && s.plan_type !== '中旬会');
  const myGongren = myRelevant.filter(s => s.location === '工人村' && s.plan_type !== '中旬会');
  const myZhongxun = myRelevant.filter(s => s.plan_type === '中旬会');

  const dateShort = (d) => { const x = new Date(d + 'T00:00:00'); return `${x.getMonth()+1}月${x.getDate()}日`; };

  return (
    <div style={{minHeight:'100vh',background:'#07101f',fontFamily:'var(--font, system-ui)',color:'white',paddingBottom:50}}>
      {/* 顶栏 */}
      <div style={{display:'flex',alignItems:'center',gap:10,padding:'14px 16px',borderBottom:'1px solid #1b3255',position:'sticky',top:0,background:'#07101f',zIndex:10}}>
        <button onClick={onBack} style={{background:'none',border:'none',color:'#94a3b8',fontSize:22,cursor:'pointer',lineHeight:1,padding:'0 4px'}}>←</button>
        <div style={{flex:1,fontWeight:700,fontSize:15}}>月度任务</div>
        <div style={{display:'flex',gap:5,alignItems:'center'}}>
          <button onClick={()=>shiftMonth(-1)} style={{background:'none',border:'1px solid #1b3255',color:'#64748b',borderRadius:5,padding:'3px 8px',fontSize:13,cursor:'pointer'}}>‹</button>
          <span style={{fontSize:13,color:'#94a3b8',minWidth:32,textAlign:'center'}}>{monthLabel(month)}</span>
          <button onClick={()=>shiftMonth(1)} style={{background:'none',border:'1px solid #1b3255',color:'#64748b',borderRadius:5,padding:'3px 8px',fontSize:13,cursor:'pointer'}}>›</button>
        </div>
      </div>

      <div style={{padding:'14px 14px',display:'flex',flexDirection:'column',gap:16}}>

        {/* ══ 板块一：个人培训视图 ══ */}
        <div style={{background:'#0a1929',border:'1px solid #1b3255',borderRadius:12,overflow:'hidden'}}>
          {/* 问候标题 */}
          <div style={{padding:'14px 16px 12px',borderBottom:'1px solid #1b3255'}}>
            <div style={{fontSize:15,fontWeight:700,color:'#e2e8f0',marginBottom:10}}>{user?.name}，你好：</div>

            {loading ? <div style={{fontSize:11,color:'#475569'}}>加载中…</div> : myRelevant.length === 0 ? (
              <div style={{fontSize:11,color:'#475569'}}>本月暂无分配培训任务</div>
            ) : (
              <div style={{display:'flex',flexDirection:'column',gap:7}}>
                {myRelevant.map(s => {
                  const isPast = s.shift_date < todayStr;
                  const isZhongxun = s.plan_type === '中旬会';
                  const complete = isZhongxun ? s.checked_in : s.instructor_confirmed;
                  const typeLabel = isZhongxun ? '中旬会' : `${s.location} 实操培训`;
                  let statusNode;
                  if (complete) {
                    statusNode = <span style={{color:'#22c55e',fontWeight:600,fontSize:11}}>已完成 ✅</span>;
                  } else if (isPast) {
                    statusNode = <span style={{color:'#64748b',fontSize:11}}>未确认</span>;
                  } else {
                    statusNode = <span style={{color:'#f97316',fontSize:11}}>待确认</span>;
                  }
                  return (
                    <div key={s.plan_id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
                      <span style={{fontSize:12,color: isPast&&complete?'#22c55e': isPast?'#475569':'#e2e8f0', fontWeight: isPast&&complete?600:400}}>
                        {dateShort(s.shift_date)}，{typeLabel}
                      </span>
                      {statusNode}
                    </div>
                  );
                })}
              </div>
            )}

            {/* 下次实操培训 */}
            {!loading && (() => {
              const nextTraining = myRelevant.find(s => s.shift_date >= todayStr && s.plan_type !== '中旬会');
              if (!nextTraining) return null;
              return (
                <div style={{marginTop:10,fontSize:11,color:'#64748b',borderTop:'1px solid #1b3255',paddingTop:8}}>
                  下次实操培训时间：<span style={{color:'#93c5fd',fontWeight:600}}>{dateShort(nextTraining.shift_date)}</span>
                  <span style={{color:'#64748b'}}> · {nextTraining.location}</span>
                </div>
              );
            })()}
          </div>

          {/* 教员确认状态（针对最近一次待完成培训）*/}
          {!loading && nextSession && nextSession.plan_type !== '中旬会' && (
            <div style={{padding:'12px 16px',borderBottom:'1px solid #1b3255'}}>
              <div style={{fontSize:10,color:'#64748b',marginBottom:8}}>
                下次实操培训：
                <span style={{color:'#e2e8f0',fontWeight:600}}>{dateShort(nextSession.shift_date)}</span>
                <span style={{color:'#64748b'}}> · {nextSession.location}</span>
              </div>
              {nextSession.instructor_confirmed ? (
                <div style={{padding:'10px',borderRadius:8,border:'1px solid rgba(34,197,94,0.35)',background:'rgba(34,197,94,0.07)',color:'#22c55e',fontSize:12,fontWeight:600,textAlign:'center'}}>
                  ☑ 教员已确认完成
                </div>
              ) : isInstructor ? (
                <button onClick={()=>doConfirm(nextSession.plan_id, user.staffId)} disabled={confirmingId!=null}
                  style={{width:'100%',padding:'10px',borderRadius:8,border:'none',background:'linear-gradient(135deg,#3b1f6e,#7c3aed)',color:'white',fontSize:12,fontWeight:700,fontFamily:'inherit',cursor:'pointer',opacity:confirmingId?0.6:1}}>
                  已到现场
                </button>
              ) : (
                <div style={{padding:'10px',borderRadius:8,border:'1px solid #1b3255',color:'#475569',fontSize:12,textAlign:'center'}}>
                  等待教员确认
                </div>
              )}
            </div>
          )}
        </div>

        {/* ══ 板块二：实操前巩固 ══ */}
        <div>
          <div style={{fontSize:11,color:'#64748b',letterSpacing:1,fontWeight:600,marginBottom:8}}>实操前巩固</div>
          <div style={{background:'#0a1929',border:'1px solid #1b3255',borderRadius:10,padding:'14px'}}>
            <div style={{fontSize:12,color:'#94a3b8',marginBottom:10,lineHeight:1.7}}>培训前先用语音答题巩固业务知识，提高实操质量。</div>
            <button onClick={()=>onBack()} style={{
              width:'100%',padding:'11px',borderRadius:9,border:'1px dashed rgba(100,116,139,0.5)',
              background:'transparent',color:'#64748b',fontSize:12,fontFamily:'inherit',cursor:'pointer',fontWeight:600
            }}>去答题预习 →</button>
          </div>
        </div>

        {/* ══ 板块三：本月早班培训计划 ══ */}
        <div>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
            <div style={{display:'flex',alignItems:'center',gap:6}}>
              <div style={{fontSize:11,color:'#64748b',letterSpacing:1,fontWeight:600}}>{monthLabel(month)} 早班培训计划</div>
              {isInstructor && <span style={{fontSize:10,padding:'1px 6px',borderRadius:4,background:'rgba(59,130,246,0.15)',border:'1px solid rgba(59,130,246,0.3)',color:'#93c5fd'}}>教员</span>}
            </div>
            <div style={{display:'flex',gap:5,alignItems:'center'}}>
              {/* 相册 */}
              <button onClick={async()=>{
                setPhotoAlbum({photos:[],loading:true});
                const photos = await apiJson('/api/workshop/photos').catch(()=>[]);
                setPhotoAlbum({photos:Array.isArray(photos)?photos:[],loading:false});
              }} style={{fontSize:10,padding:'3px 8px',borderRadius:5,border:'1px solid rgba(148,163,184,0.3)',background:'rgba(148,163,184,0.06)',color:'#94a3b8',cursor:'pointer',fontFamily:'inherit'}}>
                🖼 相册
              </button>


              {/* 教员：生成快捷入口链接 */}
              {isInstructor && !wsEditMode && (
                <button onClick={async()=>{
                  try {
                    const r = await fetch('/api/magic-link',{method:'POST',headers:{'Content-Type':'application/json','x-instructor-id':user?.staffId||''},body:JSON.stringify({target:'workshop'})});
                    const d = await r.json();
                    if (d.url) { await navigator.clipboard.writeText(d.url); alert('快捷链接已复制（48小时有效）\n粘贴到钉钉收藏即可一键直达'); }
                  } catch { alert('复制失败，请手动复制'); }
                }} style={{fontSize:10,padding:'3px 8px',borderRadius:5,border:'1px solid rgba(251,191,36,0.35)',background:'rgba(251,191,36,0.07)',color:'#fbbf24',cursor:'pointer',fontFamily:'inherit'}}>
                  🔗 快捷入口
                </button>
              )}

              {/* 编辑 / 保存（有权限） */}
              {hasEditPerm ? (
                wsEditMode ? (
                  <button onClick={()=>{ setWsEditMode(false); setExpandedCards(new Set()); setActiveField(null); }}
                    style={{fontSize:10,padding:'3px 10px',borderRadius:5,border:'none',background:'#22c55e',color:'#07101f',cursor:'pointer',fontFamily:'inherit',fontWeight:700}}>
                    保存
                  </button>
                ) : (
                  <button onClick={()=>setWsEditMode(true)}
                    style={{fontSize:10,padding:'3px 10px',borderRadius:5,border:'1px solid rgba(34,197,94,0.4)',background:'rgba(34,197,94,0.08)',color:'#22c55e',cursor:'pointer',fontFamily:'inherit',fontWeight:600}}>
                    ✎ 编辑
                  </button>
                )
              ) : (
                <button onClick={()=>setShowAdminInput(v=>!v)}
                  style={{fontSize:10,padding:'3px 8px',borderRadius:5,border:'1px solid #1b3255',background:'transparent',color:'#475569',cursor:'pointer',fontFamily:'inherit'}}>解锁</button>
              )}
            </div>
          </div>

          {/* 编辑模式提示 + 管理员设置/重排按钮 */}
          {wsEditMode && canEdit && (
            <div style={{display:'flex',alignItems:'center',gap:6,fontSize:10,color:'#475569',marginBottom:8,padding:'5px 10px',background:'rgba(27,50,85,0.2)',borderRadius:6,border:'1px solid rgba(27,50,85,0.4)'}}>
              <span style={{flex:1}}>点击字段（▾）可直接修改</span>
              {!isInstructor && adminPwd && <>
                <button onClick={()=>{ setSafetyInput(plan?.safetyDate||''); setStartGroupInput(plan?.startGroupId?String(plan.startGroupId):''); setStartLeaderInput(plan?.startLeaderIdx!=null?String(plan.startLeaderIdx):''); setShowSettings(true); }}
                  style={{fontSize:10,padding:'2px 7px',borderRadius:4,border:'1px solid #1b3255',background:'transparent',color:'#94a3b8',cursor:'pointer',fontFamily:'inherit'}}>设置</button>
                <button onClick={regenerate}
                  style={{fontSize:10,padding:'2px 7px',borderRadius:4,border:'1px solid rgba(239,68,68,0.3)',background:'transparent',color:'#ef4444',cursor:'pointer',fontFamily:'inherit'}}>重排</button>
              </>}
            </div>
          )}

          {/* 管理员密码输入框 */}
          {showAdminInput && (
            <div style={{display:'flex',gap:7,marginBottom:10}}>
              <input type="password" value={pwdInput} onChange={e=>setPwdInput(e.target.value)}
                onKeyDown={e=>e.key==='Enter'&&confirmAdminPwd()}
                placeholder="管理员密码" autoFocus
                style={{flex:1,background:'#0d1e35',border:'1px solid #1b3255',borderRadius:6,padding:'7px 10px',color:'white',fontSize:12,fontFamily:'inherit',outline:'none'}}/>
              <button onClick={confirmAdminPwd} style={{padding:'7px 14px',borderRadius:6,border:'none',background:'#1e3a5f',color:'white',fontSize:12,cursor:'pointer',fontFamily:'inherit',fontWeight:600}}>确认</button>
            </div>
          )}

          {loading && <div style={{textAlign:'center',color:'#475569',fontSize:13,padding:'30px 0'}}>加载中…</div>}

          {!loading && plan && (
            <div style={{display:'flex',flexDirection:'column',gap:7}}>
              {plan.plans.map((p) => {
                const tc = typeStyle(p.plan_type);
                const g = p.group;
                const mine = isMyRow(p);
                const rowOpacity = mine ? 1 : 0.55;

                // 非编辑模式下，非相关卡显示为折叠行
                const isIndividuallyExpanded = expandedCards.has(p.id);
                if (!wsEditMode && !mine && !isIndividuallyExpanded) {
                  return (
                    <div key={p.id} style={{
                      display:'flex', alignItems:'center', gap:8,
                      padding:'8px 12px', borderRadius:9,
                      background:'rgba(10,25,41,0.6)', border:'1px solid #1b3255',
                      cursor:'pointer', opacity:0.72,
                    }} onClick={()=>setExpandedCards(s=>{ const n=new Set(s); n.add(p.id); return n; })}>
                      <span style={{fontSize:12,fontWeight:600,color:'#64748b',flexShrink:0}}>{dateLabel(p.shift_date)}</span>
                      <span style={{fontSize:10,padding:'1px 6px',borderRadius:4,border:`1px solid ${tc.border}`,color:tc.text,flexShrink:0,background:tc.bg}}>{p.plan_type==='培训'?'实操':p.plan_type}</span>
                      {g && <span style={{fontSize:11,color:'#475569',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{g.name}{g.instructor_name?` · ${g.instructor_name}`:''}</span>}
                      {!g && p.plan_type==='中旬会' && <span style={{fontSize:11,color:'#475569',flex:1}}>全员回段</span>}
                      <span style={{fontSize:16,color:'#334155',flexShrink:0}}>›</span>
                    </div>
                  );
                }

                // 已单独展开的非相关卡：顶部加收起按钮
                const collapsible = !wsEditMode && !mine && isIndividuallyExpanded;
                const fixedNames = (plan.fixedStaff || []).map(f => f.real_name || f.name);
                const allLeaders = (plan.leaderStaff || []).map(l => l.real_name || l.name);
                const normalMembers = g
                  ? (g.members || []).filter(m => m.id !== g.instructor_id && !(plan.fixedStaff||[]).some(f => f.staff_id === m.id))
                  : [];

                const isOpen = (field) => activeField?.planId === p.id && activeField?.field === field;
                const toggleField = (field) => {
                  if (!canEdit) return;
                  setActiveField(prev => (prev?.planId === p.id && prev?.field === field) ? null : { planId: p.id, field });
                };
                const now = new Date().toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'});
                const LOCATIONS = ['工人村', '青菱车场', '复兴路'];
                const TYPE_LABELS = {'培训':'实操','理论':'理论','轮空':'轮空','中旬会':'中旬会'};

                // 通用下拉 chip 组件（行内渲染）
                const Chip = ({field, label, color='#94a3b8', borderColor='#1b3255', options, onSelect}) => (
                  <span style={{display:'inline-flex',alignItems:'center',gap:0,flexShrink:0}}>
                    <button onClick={()=>toggleField(field)} style={{
                      padding:'1px 6px',borderRadius:5,fontSize:11,fontWeight:600,fontFamily:'inherit',cursor:'pointer',
                      color, border:`1px solid ${isOpen(field)?color:borderColor}`,
                      background: isOpen(field)?'rgba(59,130,246,0.1)':'none'
                    }}>{label} {canEdit?'▾':''}</button>
                    {canEdit && isOpen(field) && (
                      <span style={{display:'inline-flex',flexWrap:'wrap',gap:4,marginLeft:4}}>
                        {options.map(opt=>(
                          <button key={opt.value} onClick={()=>onSelect(opt.value)} style={{
                            padding:'1px 8px',borderRadius:5,fontSize:11,fontFamily:'inherit',cursor:'pointer',
                            border:`1px solid ${opt.value===opt.current?color:'#1b3255'}`,
                            background: opt.value===opt.current?`rgba(59,130,246,0.15)`:'none',
                            color: opt.value===opt.current?color:'#64748b', fontWeight: opt.value===opt.current?600:400
                          }}>{opt.label}</button>
                        ))}
                      </span>
                    )}
                  </span>
                );

                return (
                  <div key={p.id} style={{
                    background:'#0a1929', border:`1px solid ${tc.border}`,
                    borderRadius:10, overflow:'hidden',
                    transition:'opacity 0.15s', opacity: rowOpacity,
                    boxShadow: mine ? '0 0 0 1.5px rgba(59,130,246,0.35)' : 'none',
                  }}>

                    {/* 已单独展开的非相关卡：收起按钮 */}
                    {collapsible && (
                      <div style={{display:'flex',justifyContent:'flex-end',padding:'4px 10px',borderBottom:`1px solid ${tc.border}`,background:'rgba(0,0,0,0.2)'}}>
                        <button onClick={()=>setExpandedCards(s=>{ const n=new Set(s); n.delete(p.id); return n; })}
                          style={{background:'none',border:'none',color:'#475569',fontSize:11,cursor:'pointer',padding:'0 2px',fontFamily:'inherit'}}>
                          收起 ∧
                        </button>
                      </div>
                    )}

                    {/* ── 行1：日期 小组 类型 地点 ── */}
                    <div style={{padding:'8px 12px',background:tc.bg,borderBottom:`1px solid ${tc.border}`}}>
                      <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                        {mine && <span style={{fontSize:9,color:'#3b82f6'}}>◆</span>}
                        <span style={{fontWeight:700,fontSize:12,color:'white',marginRight:2}}>{dateLabel(p.shift_date)}</span>

                        {/* 小组 */}
                        {g && p.plan_type!=='中旬会' && p.plan_type!=='轮空' && (
                          <Chip field="group" label={g.name} color="#e2e8f0" borderColor="#1e3a5f"
                            options={(plan.groups||[]).map(gr=>({value:gr.id,label:gr.name,current:p.group_id}))}
                            onSelect={v=>patchRow(p.id,{group_id:v},`${now} 小组改为"${(plan.groups||[]).find(gr=>gr.id===v)?.name}"`)}
                          />
                        )}
                        {/* 中旬会固定标签 */}
                        {p.plan_type==='中旬会' && (
                          <span style={{fontSize:11,fontWeight:600,color:'#fbbf24',padding:'1px 6px',border:'1px solid rgba(251,191,36,0.3)',borderRadius:5}}>全员回段</span>
                        )}

                        <span style={{flex:1}}/>

                        {/* 培训类型 */}
                        {p.plan_type!=='中旬会' && (
                          <Chip field="type" label={TYPE_LABELS[p.plan_type]||p.plan_type} color={tc.text} borderColor={tc.border}
                            options={['培训','理论','轮空'].map(t=>({value:t,label:t==='培训'?'实操':t,current:p.plan_type}))}
                            onSelect={v=>handleTypeChange(p,v)}
                          />
                        )}
                        {/* 中旬会 类型 chip */}
                        {p.plan_type==='中旬会' && (
                          <Chip field="type" label="理论" color={tc.text} borderColor={tc.border}
                            options={['理论','培训'].map(t=>({value:t,label:t,current:'理论'}))}
                            onSelect={()=>{}}
                          />
                        )}

                        {/* 地点 */}
                        {p.plan_type!=='轮空' && (
                          <Chip field="location" label={p.location||'—'} color="#64748b" borderColor="#1b3255"
                            options={LOCATIONS.map(l=>({value:l,label:l,current:p.location}))}
                            onSelect={v=>patchRow(p.id,{location:v},`${now} 地点改为"${v}"`)}
                          />
                        )}
                      </div>
                    </div>

                    {/* ── 内容区 ── */}
                    {p.plan_type === '轮空' ? (
                      <div style={{padding:'8px 12px',fontSize:11,color:'#6b7280',fontStyle:'italic'}}>
                        本次早班轮空，暂不安排车场培训
                        {p.notes && <span style={{marginLeft:6,color:'#9ca3af'}}>（{p.notes}）</span>}
                      </div>
                    ) : p.plan_type === '中旬会' ? (
                      (()=>{
                        // 解析 notes 中存储的特殊人员记录（JSON数组）
                        let specialEntries = [];
                        try { specialEntries = JSON.parse(p.notes || '[]'); if(!Array.isArray(specialEntries)) specialEntries = []; } catch(e) { specialEntries = []; }
                        const ZHXH_SLOTS = 8;
                        const now2 = new Date().toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'});
                        const isZhxhExpanded = zhxhExpanded.has(p.id);
                        return (
                          <div style={{padding:'8px 12px',display:'flex',flexDirection:'column',gap:6}}>
                            {/* 占位方框行（登记请假/临时参会） */}
                            <div style={{display:'flex',alignItems:'center',gap:4,flexWrap:'wrap'}}>
                              {Array.from({length:ZHXH_SLOTS}).map((_,i)=>{
                                const entry = specialEntries[i];
                                return entry ? (
                                  <button key={i} onClick={()=>{
                                    if(!canEdit) return;
                                    if(!confirm(`移除 ${entry.staffName}？`)) return;
                                    const newEntries = specialEntries.filter((_,idx)=>idx!==i);
                                    const newNotes = JSON.stringify(newEntries);
                                    patchRow(p.id,{notes:newNotes},`${now2} 移除记录：${entry.staffName}`);
                                  }} style={{
                                    padding:'2px 6px',borderRadius:4,fontSize:10,fontFamily:'inherit',cursor:canEdit?'pointer':'default',
                                    border:`1px solid ${entry.type==='请假'?'#ef4444':'#3b82f6'}`,
                                    background:entry.type==='请假'?'rgba(239,68,68,0.12)':'rgba(59,130,246,0.12)',
                                    color:entry.type==='请假'?'#fca5a5':'#93c5fd',fontWeight:600
                                  }}>{entry.staffName}</button>
                                ) : (
                                  <button key={i} onClick={()=>{
                                    if(!canEdit) return;
                                    setMemberModal({planId:p.id,step:'zhxh_pick',specialEntries,staffId:null,staffName:null,isAdded:false,candidates:[],target:null});
                                  }} style={{
                                    display:'inline-block',width:28,height:20,border:'1px dashed rgba(100,130,180,0.5)',borderRadius:4,
                                    background:'rgba(27,50,85,0.25)',cursor:canEdit?'pointer':'default',padding:0
                                  }}/>
                                );
                              })}
                            </div>
                            {/* 备注行 */}
                            {specialEntries.length>0 && (
                              <div style={{fontSize:10,color:'#64748b',lineHeight:1.7}}>
                                备注：{specialEntries.map(e=>`${e.staffName} ${e.type}`).join('；')}
                              </div>
                            )}
                            {specialEntries.length===0 && (
                              <div style={{fontSize:10,color:'#6b7280',fontStyle:'italic'}}>备注：点击方框登记请假或临时参会人员</div>
                            )}

                            {/* 全员名单（默认折叠） */}
                            <div style={{borderTop:'1px solid rgba(27,50,85,0.8)',paddingTop:6}}>
                              <button onClick={()=>setZhxhExpanded(s=>{const n=new Set(s);isZhxhExpanded?n.delete(p.id):n.add(p.id);return n;})} style={{
                                background:'none',border:'none',color:'#60a5fa',fontSize:11,cursor:'pointer',padding:0,fontFamily:'inherit',
                                display:'flex',alignItems:'center',gap:4,width:'100%',justifyContent:'space-between'
                              }}>
                                <span style={{fontWeight:600}}>全员名单</span>
                                <span style={{color:'#475569',fontSize:10}}>{isZhxhExpanded?'收起 ∧':'展开 ∨'}</span>
                              </button>
                              {isZhxhExpanded && (
                                <div style={{marginTop:8,display:'flex',flexDirection:'column',gap:6}}>
                                  {(plan.groups||[]).map(grp=>{
                                    const fixedIdsSet = new Set((plan.fixedStaff||[]).map(f=>f.staff_id));
                                    const grpMembers = (grp.members||[]).filter(m=>!fixedIdsSet.has(m.id));
                                    return (
                                      <div key={grp.id} style={{background:'rgba(13,30,50,0.5)',borderRadius:6,padding:'6px 8px'}}>
                                        <div style={{fontSize:10,color:'#60a5fa',fontWeight:700,marginBottom:4}}>
                                          {grp.name}{grp.instructor_name?<span style={{color:'#64748b',fontWeight:400,marginLeft:4}}>· {grp.instructor_name}（教员）</span>:null}
                                        </div>
                                        <div style={{display:'flex',gap:3,flexWrap:'wrap'}}>
                                          {grpMembers.map((m,mi)=>(
                                            <button key={mi} onClick={async()=>{
                                              if(!hasEditPerm) return;
                                              const shiftYear = parseInt(p.shift_date.slice(0,4));
                                              const shiftMonth = parseInt(p.shift_date.slice(5,7));
                                              const yearPlanData = await apiJson(`/api/admin/training-year-plan?year=${shiftYear}`).catch(()=>[]);
                                              const monthPlanItems = (Array.isArray(yearPlanData)?yearPlanData:[]).find(r=>r.month===shiftMonth)?.sessions || [];
                                              const currentItems = (() => { try { return JSON.parse(p.completed_items||'[]'); } catch(e) { return []; } })();
                                              const evals = await apiJson(`/api/workshop/training-plan/${p.id}/evaluations`).catch(()=>[]);
                                              const evMap = {};
                                              (Array.isArray(evals)?evals:[]).forEach(e=>{ evMap[e.staff_id]=e; });
                                              // 构建全员名单供 pick 步骤
                                              const allZhxhMembers = (plan.groups||[]).flatMap(gr=>{
                                                const fids = new Set((plan.fixedStaff||[]).map(f=>f.staff_id));
                                                return (gr.members||[]).filter(x=>!fids.has(x.id)).map(x=>({id:x.id,real_name:x.real_name||x.name}));
                                              });
                                              const fixedM = (plan.fixedStaff||[]).map(f=>({id:f.staff_id,real_name:f.real_name||f.name}));
                                              const allM = [...allZhxhMembers,...fixedM].filter((x,i,a)=>a.findIndex(y=>y.id===x.id)===i);
                                              const targetMember = {staffId:m.id,staffName:m.real_name||m.name};
                                              const step = currentItems.length>0 ? 'eval' : 'items';
                                              setEvalModal({planId:p.id,shiftDate:p.shift_date,members:allM,step,target:step==='eval'?targetMember:null,comment:evMap[m.id]?.comment||'',saving:false,evaluations:evMap,yearPlanItems:monthPlanItems,selectedItems:currentItems.length>0?currentItems:monthPlanItems.map(i=>i.item)});
                                            }} style={{
                                              padding:'2px 6px',borderRadius:4,fontSize:10,fontFamily:'inherit',
                                              cursor:hasEditPerm?'pointer':'default',
                                              border:'1px solid #1e3a5f',
                                              background:'rgba(30,41,59,0.5)',color:'#b0bec5',fontWeight:400
                                            }}>{m.real_name||m.name}</button>
                                          ))}
                                        </div>
                                      </div>
                                    );
                                  })}
                                  {(plan.fixedStaff||[]).length>0 && (
                                    <div style={{background:'rgba(13,30,50,0.5)',borderRadius:6,padding:'6px 8px'}}>
                                      <div style={{fontSize:10,color:'#c4b5fd',fontWeight:700,marginBottom:4}}>固定成员</div>
                                      <div style={{display:'flex',gap:3,flexWrap:'wrap'}}>
                                        {(plan.fixedStaff||[]).map((f,fi)=>(
                                          <button key={fi} onClick={async()=>{
                                            if(!hasEditPerm) return;
                                            const shiftYear = parseInt(p.shift_date.slice(0,4));
                                            const shiftMonth = parseInt(p.shift_date.slice(5,7));
                                            const yearPlanData = await apiJson(`/api/admin/training-year-plan?year=${shiftYear}`).catch(()=>[]);
                                            const monthPlanItems = (Array.isArray(yearPlanData)?yearPlanData:[]).find(r=>r.month===shiftMonth)?.sessions || [];
                                            const currentItems = (() => { try { return JSON.parse(p.completed_items||'[]'); } catch(e) { return []; } })();
                                            const evals = await apiJson(`/api/workshop/training-plan/${p.id}/evaluations`).catch(()=>[]);
                                            const evMap = {};
                                            (Array.isArray(evals)?evals:[]).forEach(e=>{ evMap[e.staff_id]=e; });
                                            const allZhxhMembers = (plan.groups||[]).flatMap(gr=>{
                                              const fids = new Set((plan.fixedStaff||[]).map(x=>x.staff_id));
                                              return (gr.members||[]).filter(x=>!fids.has(x.id)).map(x=>({id:x.id,real_name:x.real_name||x.name}));
                                            });
                                            const fixedM = (plan.fixedStaff||[]).map(x=>({id:x.staff_id,real_name:x.real_name||x.name}));
                                            const allM = [...allZhxhMembers,...fixedM].filter((x,i,a)=>a.findIndex(y=>y.id===x.id)===i);
                                            const targetMember = {staffId:f.staff_id,staffName:f.real_name||f.name};
                                            const step = currentItems.length>0 ? 'eval' : 'items';
                                            setEvalModal({planId:p.id,shiftDate:p.shift_date,members:allM,step,target:step==='eval'?targetMember:null,comment:evMap[f.staff_id]?.comment||'',saving:false,evaluations:evMap,yearPlanItems:monthPlanItems,selectedItems:currentItems.length>0?currentItems:monthPlanItems.map(i=>i.item)});
                                          }} style={{
                                            padding:'2px 6px',borderRadius:4,fontSize:10,fontFamily:'inherit',
                                            cursor:hasEditPerm?'pointer':'default',
                                            border:'1px solid rgba(196,181,253,0.3)',
                                            background:'rgba(30,41,59,0.5)',color:'#c4b5fd',fontWeight:400
                                          }}>{f.real_name||f.name}</button>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })()
                    ) : g ? (
                      <div style={{padding:'8px 12px',display:'flex',flexDirection:'column',gap:5}}>
                        {/* 行2：教员 班组长 */}
                        <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
                          {(g.instructor_name||canEdit) && (
                            <span style={{fontSize:11,color:'#7c8fa6',display:'inline-flex',alignItems:'center',gap:4}}>
                              教员
                              <Chip field="instructor" label={g.instructor_name||'—'} color="#93c5fd" borderColor="#1b3255"
                                options={(plan.groups||[]).flatMap(gr=>gr.members||[]).filter((m,i,a)=>m.id&&a.findIndex(x=>x.id===m.id)===i).map(m=>({value:m.id,label:m.real_name||m.name,current:null}))}
                                onSelect={v=>{const nm=(plan.groups||[]).flatMap(gr=>gr.members||[]).find(m=>m.id===v);patchRow(p.id,{},`${now} 教员暂改为"${nm?.real_name||nm?.name}"（如需永久生效请在小组设置中修改）`);}}
                              />
                            </span>
                          )}
                          <span style={{fontSize:11,color:'#7c8fa6',display:'inline-flex',alignItems:'center',gap:4}}>
                            班组长
                            <Chip field="leader" label={p.leader_name||'—'} color="#fbbf24" borderColor="#1b3255"
                              options={allLeaders.map(l=>({value:l,label:l,current:p.leader_name}))}
                              onSelect={v=>patchRow(p.id,{leader_name:v},`${now} 班组长改为"${v}"`)}
                            />
                          </span>
                        </div>
                        {/* 行3：组员方框（8格）+ 固定 */}
                        {(()=>{
                          // 计算实际出现成员：基础成员 ± overrides
                          const overrides = p.memberOverrides || {added:[],removed:[]};
                          // 服务端字段: {id, real_name, name} (不是 staff_id/staff_name)
                          const removedIds = new Set((overrides.removed||[]).map(r=>String(r.id||r.staff_id)));
                          const baseMembers = normalMembers.filter(m=>!removedIds.has(String(m.id)));
                          const addedMembers = (overrides.added||[]).map(a=>({id:a.id||a.staff_id,real_name:a.real_name||a.staff_name||a.name,isAdded:true}));
                          const effectiveMembers = [...baseMembers,...addedMembers];
                          const SLOTS = 8;
                          return (
                            <div style={{display:'flex',flexDirection:'column',gap:4}}>
                              {/* 组员方框行 */}
                              <div style={{display:'flex',alignItems:'center',gap:4,flexWrap:'wrap'}}>
                                <span style={{fontSize:10,color:'#7c8fa6',flexShrink:0}}>组员</span>
                                <div style={{display:'flex',gap:3,flexWrap:'wrap'}}>
                                  {Array.from({length:SLOTS}).map((_,i)=>{
                                    const m = effectiveMembers[i];
                                    const isSwapped = m?.isAdded;
                                    return m ? (
                                      <button key={i} onClick={()=>{
                                        if(!canEdit) return;
                                        setMemberModal({planId:p.id,staffId:m.id,staffName:m.real_name||m.name,isAdded:isSwapped,step:'main',candidates:[],target:null});
                                      }} style={{
                                        padding:'2px 6px',borderRadius:4,fontSize:10,fontFamily:'inherit',cursor:canEdit?'pointer':'default',
                                        border:`1px solid ${isSwapped?'#3b82f6':'#1e3a5f'}`,
                                        background:isSwapped?'rgba(59,130,246,0.15)':'rgba(30,41,59,0.5)',
                                        color:isSwapped?'#60a5fa':'#b0bec5',fontWeight:isSwapped?600:400
                                      }}>{m.real_name||m.name}</button>
                                    ) : (
                                      <span key={i} style={{display:'inline-block',width:28,height:20,border:'1px dashed rgba(100,130,180,0.45)',borderRadius:4,background:'rgba(27,50,85,0.2)'}}/>
                                    );
                                  })}
                                </div>
                              </div>
                              {/* 固定人员 */}
                              {fixedNames.length>0 && (
                                <div style={{fontSize:10,color:'#7c8fa6'}}>
                                  固定 <span style={{color:'#c4b5fd'}}>{fixedNames.join('、')}</span>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                        {p.notes && <div style={{fontSize:10,color:'#7c8fa6',fontStyle:'italic'}}>备注：{p.notes}</div>}
                      </div>
                    ) : (
                      <div style={{padding:'8px 12px',fontSize:11,color:'#7c8fa6'}}>
                        未分配小组{p.notes && <span style={{marginLeft:6}}>（{p.notes}）</span>}
                      </div>
                    )}

                    {/* ── 变更记录 ── */}
                    {p.change_log && (
                      <div style={{padding:'5px 12px 7px',borderTop:'1px solid rgba(27,50,85,0.4)',background:'rgba(0,0,0,0.12)'}}>
                        {p.change_log.split('\n').map((ln,i)=>(
                          <div key={i} style={{fontSize:10,color:'#6b7280',lineHeight:1.7}}>• {ln}</div>
                        ))}
                      </div>
                    )}

                    {/* ── 现场记录 & 确认点评 ── */}
                    {p.plan_type !== '轮空' && canEdit && (
                      <div style={{display:'flex',gap:6,padding:'7px 10px',borderTop:'1px solid rgba(27,50,85,0.35)',background:'rgba(0,0,0,0.1)'}}>
                        <button onClick={async()=>{
                          const photos = await apiJson(`/api/workshop/training-plan/${p.id}/photos`).catch(()=>[]);
                          setPhotoModal({planId:p.id,photos:Array.isArray(photos)?photos:[]});
                        }} style={{flex:1,padding:'6px',borderRadius:6,border:'1px solid rgba(59,130,246,0.3)',background:'rgba(59,130,246,0.07)',color:'#60a5fa',fontSize:11,fontFamily:'inherit',cursor:'pointer',fontWeight:600}}>
                          📷 现场记录
                        </button>
                        {p.plan_type !== '中旬会' && (
                          <button onClick={async()=>{
                            const overrides = p.memberOverrides||{added:[],removed:[]};
                            const removedIds = new Set((overrides.removed||[]).map(r=>String(r.id||r.staff_id)));
                            const baseM = (g?.members||[]).filter(m=>!removedIds.has(String(m.id)));
                            const addedM = (overrides.added||[]).map(a=>({id:a.id||a.staff_id,real_name:a.real_name||a.staff_name||a.name}));
                            const fixedM = (plan.fixedStaff||[]).map(f=>({id:f.staff_id,real_name:f.real_name||f.name}));
                            const allM = [...baseM,...addedM,...fixedM].filter((m,i,a)=>a.findIndex(x=>x.id===m.id)===i);
                            const evals = await apiJson(`/api/workshop/training-plan/${p.id}/evaluations`).catch(()=>[]);
                            const evMap = {};
                            (Array.isArray(evals)?evals:[]).forEach(e=>{ evMap[e.staff_id]=e; });
                            // 加载本月年度计划项点
                            const shiftYear = parseInt(p.shift_date.slice(0,4));
                            const shiftMonth = parseInt(p.shift_date.slice(5,7));
                            const yearPlanData = await apiJson(`/api/admin/training-year-plan?year=${shiftYear}`).catch(()=>[]);
                            const monthPlanItems = (Array.isArray(yearPlanData)?yearPlanData:[]).find(r=>r.month===shiftMonth)?.sessions || [];
                            const currentItems = (() => { try { return JSON.parse(p.completed_items||'[]'); } catch(e) { return []; } })();
                            setEvalModal({planId:p.id,shiftDate:p.shift_date,members:allM,step:'items',target:null,comment:'',saving:false,evaluations:evMap,yearPlanItems:monthPlanItems,selectedItems:currentItems.length>0?currentItems:monthPlanItems.map(i=>i.item)});
                          }} style={{flex:1,padding:'6px',borderRadius:6,border:'1px solid rgba(251,191,36,0.3)',background:'rgba(251,191,36,0.07)',color:'#fbbf24',fontSize:11,fontFamily:'inherit',cursor:'pointer',fontWeight:600}}>
                            ✅ 确认点评
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 轮空确认弹窗 */}
      {lunKongConfirm && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,padding:16}} onClick={()=>setLunKongConfirm(null)}>
          <div style={{background:'#0f2744',borderRadius:12,padding:20,width:'100%',maxWidth:340}} onClick={e=>e.stopPropagation()}>
            <div style={{fontWeight:600,color:'#fbbf24',fontSize:14,marginBottom:8}}>⚠️ 设为轮空</div>
            <div style={{fontSize:12,color:'#94a3b8',marginBottom:4,lineHeight:1.6}}>
              此次早班将设为<strong style={{color:'#ef4444'}}>轮空</strong>，不安排培训。<br/>
              后续日程不会自动级联变化，如需调整小组顺序请使用"重生"功能。
            </div>
            <div style={{fontSize:11,color:'#64748b',marginBottom:5,marginTop:10}}>轮空原因（必填）</div>
            <input
              value={lunKongConfirm.noteInput}
              onChange={e=>setLunKongConfirm(prev=>({...prev,noteInput:e.target.value}))}
              placeholder="如：恶劣天气、临时调整…"
              autoFocus
              style={{width:'100%',boxSizing:'border-box',background:'#0d1e35',border:'1px solid #1b3255',borderRadius:6,padding:'8px 10px',color:'white',fontSize:13,fontFamily:'inherit',outline:'none',marginBottom:14}}
            />
            <div style={{display:'flex',gap:8}}>
              <button onClick={()=>setLunKongConfirm(null)} style={{flex:1,padding:'10px',borderRadius:7,border:'1px solid #1b3255',background:'transparent',color:'#94a3b8',fontFamily:'inherit',fontSize:13,cursor:'pointer'}}>取消</button>
              <button disabled={!lunKongConfirm.noteInput.trim()} onClick={confirmLunKong} style={{flex:2,padding:'10px',borderRadius:7,border:'none',background:'linear-gradient(135deg,#7c1d1d,#dc2626)',color:'white',fontFamily:'inherit',fontSize:13,fontWeight:600,cursor:'pointer',opacity:!lunKongConfirm.noteInput.trim()?0.4:1}}>确认设为轮空</button>
            </div>
          </div>
        </div>
      )}

      {/* 成员操作弹窗 */}
      {memberModal && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.8)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:210,padding:16}} onClick={()=>setMemberModal(null)}>
          <div style={{background:'#0f2744',borderRadius:12,padding:20,width:'100%',maxWidth:340}} onClick={e=>e.stopPropagation()}>

            {/* 主选项：替换 / 延后 */}
            {memberModal.step==='main' && (<>
              <div style={{fontWeight:600,color:'#e2e8f0',fontSize:14,marginBottom:4}}>
                {memberModal.staffName}
                {memberModal.isAdded && <span style={{fontSize:10,color:'#60a5fa',marginLeft:6,fontWeight:400}}>（换入）</span>}
              </div>
              <div style={{fontSize:11,color:'#475569',marginBottom:16}}>选择操作</div>
              <div style={{display:'flex',gap:8}}>
                <button onClick={async()=>{
                  // 加载本月其他计划的成员（排除本计划，且只显示未来日期）
                  const today2 = new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
                  const allP = plan.plans.filter(x=>x.id!==memberModal.planId&&x.plan_type!=='轮空'&&x.plan_type!=='中旬会'&&x.group&&x.shift_date>=today2);
                  // 候选：其他计划的组员（包含他们的固定成员来源不同，暂仅用正式组员）
                  const candidates = allP.flatMap(x=>{
                    const g2=x.group;
                    if(!g2)return[];
                    const overrides2=x.memberOverrides||{added:[],removed:[]};
                    const removed2=new Set((overrides2.removed||[]).map(r=>String(r.id||r.staff_id)));
                    const base2=(g2.members||[]).filter(m=>m.id!==g2.instructor_id&&!removed2.has(String(m.id))&&!(plan.fixedStaff||[]).some(f=>f.staff_id===m.id));
                    const added2=(overrides2.added||[]).map(a=>({id:a.id||a.staff_id,real_name:a.real_name||a.staff_name||a.name,isAdded:true}));
                    return [...base2,...added2].map(m=>({...m,planId:x.id,shiftDate:x.shift_date}));
                  }).filter(m=>m.id!==memberModal.staffId);
                  setMemberModal(prev=>({...prev,step:'swap',candidates}));
                }} style={{flex:1,padding:'10px',borderRadius:7,border:'1px solid #1e3a5f',background:'rgba(59,130,246,0.1)',color:'#60a5fa',fontFamily:'inherit',fontSize:13,fontWeight:600,cursor:'pointer'}}>
                  替换
                </button>
                <button onClick={()=>{
                  // 候选：本月之后的其他培训日期（排除本计划）
                  const today = new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
                  const futurePlans = plan.plans.filter(x=>x.id!==memberModal.planId&&x.shift_date>=today&&x.plan_type!=='轮空'&&x.plan_type!=='中旬会');
                  setMemberModal(prev=>({...prev,step:'postpone',candidates:futurePlans}));
                }} style={{flex:1,padding:'10px',borderRadius:7,border:'1px solid #1e3a5f',background:'rgba(251,191,36,0.08)',color:'#fbbf24',fontFamily:'inherit',fontSize:13,fontWeight:600,cursor:'pointer'}}>
                  延后
                </button>
              </div>
              <button onClick={()=>setMemberModal(null)} style={{width:'100%',marginTop:10,padding:'8px',borderRadius:7,border:'1px solid #1b3255',background:'transparent',color:'#64748b',fontFamily:'inherit',fontSize:12,cursor:'pointer'}}>取消</button>
            </>)}

            {/* 替换：选目标成员 */}
            {memberModal.step==='swap' && (<>
              <div style={{fontWeight:600,color:'#e2e8f0',fontSize:13,marginBottom:4}}>替换 {memberModal.staffName}</div>
              <div style={{fontSize:11,color:'#475569',marginBottom:10}}>选择要与之互换的成员</div>
              <div style={{maxHeight:260,overflowY:'auto',display:'flex',flexDirection:'column',gap:4}}>
                {memberModal.candidates.length===0&&<div style={{fontSize:12,color:'#475569',textAlign:'center',padding:'16px 0'}}>无可替换成员</div>}
                {memberModal.candidates.map((c,i)=>(
                  <button key={i} onClick={()=>setMemberModal(prev=>({...prev,target:c}))} style={{
                    padding:'8px 12px',borderRadius:7,border:`1px solid ${memberModal.target?.id===c.id&&memberModal.target?.planId===c.planId?'#3b82f6':'#1b3255'}`,
                    background:memberModal.target?.id===c.id&&memberModal.target?.planId===c.planId?'rgba(59,130,246,0.15)':'rgba(13,17,23,0.4)',
                    color:'#e2e8f0',fontFamily:'inherit',fontSize:12,cursor:'pointer',textAlign:'left',
                    display:'flex',justifyContent:'space-between',alignItems:'center'
                  }}>
                    <span style={{fontWeight:600}}>{c.real_name||c.name}</span>
                    <span style={{fontSize:10,color:'#475569'}}>{c.shiftDate?.slice(5)}</span>
                  </button>
                ))}
              </div>
              {memberModal.target && (
                <div style={{marginTop:10,padding:'8px 10px',background:'rgba(59,130,246,0.08)',borderRadius:6,border:'1px solid rgba(59,130,246,0.2)',fontSize:11,color:'#94a3b8'}}>
                  将与 <strong style={{color:'#60a5fa'}}>{memberModal.target.real_name||memberModal.target.name}</strong>（{memberModal.target.shiftDate?.slice(5)}）互换位置
                </div>
              )}
              <div style={{display:'flex',gap:8,marginTop:12}}>
                <button onClick={()=>setMemberModal(prev=>({...prev,step:'main',target:null}))} style={{flex:1,padding:'9px',borderRadius:7,border:'1px solid #1b3255',background:'transparent',color:'#64748b',fontFamily:'inherit',fontSize:12,cursor:'pointer'}}>返回</button>
                <button disabled={!memberModal.target} onClick={async()=>{
                  const {planId,staffId,target} = memberModal;
                  const now = new Date().toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'});
                  const r = await apiJson('/api/admin/training-plan/member-swap',{method:'POST',headers:hdrs(),body:JSON.stringify({
                    plan_id_a:planId, staff_id_a:staffId,
                    plan_id_b:target.planId, staff_id_b:target.id,
                    note:`${now} ${memberModal.staffName}↔${target.real_name||target.name}`
                  })}).catch(()=>null);
                  if(r?.ok){setMemberModal(null);load(month);}
                  else alert(r?.error||'操作失败');
                }} style={{flex:2,padding:'9px',borderRadius:7,border:'none',background:'linear-gradient(135deg,#1e3a5f,#2563eb)',color:'white',fontFamily:'inherit',fontSize:13,fontWeight:600,cursor:'pointer',opacity:memberModal.target?1:0.4}}>
                  确认互换
                </button>
              </div>
            </>)}

            {/* 中旬会：选人员 */}
            {memberModal.step==='zhxh_pick' && (<>
              <div style={{fontWeight:600,color:'#e2e8f0',fontSize:13,marginBottom:4}}>登记人员</div>
              <div style={{maxHeight:240,overflowY:'auto',display:'flex',flexDirection:'column',gap:3,marginBottom:10}}>
                {(plan.allStaff||[]).filter(s=>!memberModal.specialEntries?.some(e=>e.staffId===s.id)).map((s,i)=>(
                  <button key={i} onClick={()=>setMemberModal(prev=>({...prev,target:{staffId:null,staffName:s.real_name||s.name},step:'zhxh_confirm'}))} style={{
                    padding:'7px 12px',borderRadius:7,border:'1px solid #1b3255',
                    background:'rgba(13,17,23,0.4)',color:'#e2e8f0',
                    fontFamily:'inherit',fontSize:12,cursor:'pointer',textAlign:'left'
                  }}>
                    {s.real_name||s.name}
                  </button>
                ))}
              </div>
              {/* 手动输入外部人员 */}
              <div style={{fontSize:11,color:'#475569',marginBottom:5}}>或手动输入姓名</div>
              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                <input
                  value={memberModal.manualName||''}
                  onChange={e=>setMemberModal(prev=>({...prev,manualName:e.target.value}))}
                  placeholder="输入姓名…"
                  style={{width:'100%',boxSizing:'border-box',background:'#0d1e35',border:'1px solid #1b3255',borderRadius:6,padding:'7px 10px',color:'white',fontSize:13,fontFamily:'inherit',outline:'none'}}
                />
                <button disabled={!(memberModal.manualName||'').trim()} onClick={()=>{
                  const name = (memberModal.manualName||'').trim();
                  if(!name) return;
                  setMemberModal(prev=>({...prev,target:{staffId:null,staffName:name},step:'zhxh_confirm'}));
                }} style={{width:'100%',padding:'8px',borderRadius:6,border:'none',background:'rgba(59,130,246,0.2)',color:'#60a5fa',fontFamily:'inherit',fontSize:12,fontWeight:600,cursor:'pointer',opacity:(memberModal.manualName||'').trim()?1:0.4}}>
                  下一步
                </button>
              </div>
              <button onClick={()=>setMemberModal(null)} style={{width:'100%',marginTop:8,padding:'7px',borderRadius:7,border:'1px solid #1b3255',background:'transparent',color:'#64748b',fontFamily:'inherit',fontSize:12,cursor:'pointer'}}>取消</button>
            </>)}

            {/* 中旬会：选类型（请假 / 临时参会） */}
            {memberModal.step==='zhxh_confirm' && memberModal.target && (<>
              <div style={{fontWeight:600,color:'#e2e8f0',fontSize:14,marginBottom:4}}>{memberModal.target.staffName}</div>
              <div style={{fontSize:11,color:'#475569',marginBottom:14}}>选择状态</div>
              <div style={{display:'flex',gap:8}}>
                {['请假','临时参会'].map(type=>(
                  <button key={type} onClick={async()=>{
                    const newEntry = {staffId:memberModal.target.staffId,staffName:memberModal.target.staffName,type};
                    const newEntries = [...(memberModal.specialEntries||[]),newEntry];
                    const now2 = new Date().toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'});
                    const r = await apiJson(`/api/admin/training-plan/${memberModal.planId}`,{method:'PUT',headers:hdrs(),body:JSON.stringify({
                      notes:JSON.stringify(newEntries),
                      log_entry:`${now2} 登记：${memberModal.target.staffName} ${type}`
                    })}).catch(()=>null);
                    if(r?.ok){setMemberModal(null);load(month);}
                    else alert('操作失败');
                  }} style={{
                    flex:1,padding:'12px 8px',borderRadius:8,border:`1px solid ${type==='请假'?'rgba(239,68,68,0.4)':'rgba(59,130,246,0.4)'}`,
                    background:type==='请假'?'rgba(239,68,68,0.1)':'rgba(59,130,246,0.1)',
                    color:type==='请假'?'#fca5a5':'#93c5fd',
                    fontFamily:'inherit',fontSize:13,fontWeight:600,cursor:'pointer'
                  }}>{type}</button>
                ))}
              </div>
              <button onClick={()=>setMemberModal(prev=>({...prev,step:'zhxh_pick',target:null}))} style={{width:'100%',marginTop:10,padding:'8px',borderRadius:7,border:'1px solid #1b3255',background:'transparent',color:'#64748b',fontFamily:'inherit',fontSize:12,cursor:'pointer'}}>返回</button>
            </>)}

            {/* 延后：选目标日期 */}
            {memberModal.step==='postpone' && (<>
              <div style={{fontWeight:600,color:'#e2e8f0',fontSize:13,marginBottom:4}}>延后 {memberModal.staffName}</div>
              <div style={{fontSize:11,color:'#475569',marginBottom:10}}>选择延后回段的日期</div>
              <div style={{maxHeight:240,overflowY:'auto',display:'flex',flexDirection:'column',gap:4}}>
                {memberModal.candidates.length===0&&<div style={{fontSize:12,color:'#475569',textAlign:'center',padding:'16px 0'}}>无可选日期</div>}
                {memberModal.candidates.map((fp,i)=>(
                  <button key={i} onClick={()=>setMemberModal(prev=>({...prev,target:fp}))} style={{
                    padding:'8px 12px',borderRadius:7,border:`1px solid ${memberModal.target?.id===fp.id?'#fbbf24':'#1b3255'}`,
                    background:memberModal.target?.id===fp.id?'rgba(251,191,36,0.12)':'rgba(13,17,23,0.4)',
                    color:'#e2e8f0',fontFamily:'inherit',fontSize:12,cursor:'pointer',textAlign:'left',
                    display:'flex',justifyContent:'space-between',alignItems:'center'
                  }}>
                    <span style={{fontWeight:600}}>{fp.shift_date?.slice(5)}</span>
                    <span style={{fontSize:10,color:'#475569'}}>{fp.group?.name||'—'}</span>
                  </button>
                ))}
              </div>
              {memberModal.target && (
                <div style={{marginTop:10,padding:'8px 10px',background:'rgba(251,191,36,0.06)',borderRadius:6,border:'1px solid rgba(251,191,36,0.2)',fontSize:11,color:'#94a3b8'}}>
                  <strong style={{color:'#fbbf24'}}>{memberModal.staffName}</strong> 将从本次移出，延后至 <strong style={{color:'#fbbf24'}}>{memberModal.target.shift_date?.slice(5)}</strong>
                </div>
              )}
              <div style={{display:'flex',gap:8,marginTop:12}}>
                <button onClick={()=>setMemberModal(prev=>({...prev,step:'main',target:null}))} style={{flex:1,padding:'9px',borderRadius:7,border:'1px solid #1b3255',background:'transparent',color:'#64748b',fontFamily:'inherit',fontSize:12,cursor:'pointer'}}>返回</button>
                <button disabled={!memberModal.target} onClick={async()=>{
                  const {planId,staffId,target} = memberModal;
                  const now = new Date().toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'});
                  const r = await apiJson('/api/admin/training-plan/member-postpone',{method:'POST',headers:hdrs(),body:JSON.stringify({
                    from_plan_id:planId, to_plan_id:target.id, staff_id:staffId,
                    note:`${now} ${memberModal.staffName}延后至${target.shift_date?.slice(5)}`
                  })}).catch(()=>null);
                  if(r?.ok){setMemberModal(null);load(month);}
                  else alert(r?.error||'操作失败');
                }} style={{flex:2,padding:'9px',borderRadius:7,border:'none',background:'linear-gradient(135deg,#7c5c00,#d97706)',color:'white',fontFamily:'inherit',fontSize:13,fontWeight:600,cursor:'pointer',opacity:memberModal.target?1:0.4}}>
                  确认延后
                </button>
              </div>
            </>)}

          </div>
        </div>
      )}

      {/* 现场记录弹窗 */}
      {photoModal && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',display:'flex',alignItems:'flex-end',justifyContent:'center',zIndex:210,padding:0}} onClick={()=>setPhotoModal(null)}>
          <div style={{background:'#0f2744',borderRadius:'14px 14px 0 0',padding:20,width:'100%',maxWidth:480,maxHeight:'80vh',display:'flex',flexDirection:'column'}} onClick={e=>e.stopPropagation()}>
            <div style={{fontWeight:600,color:'#e2e8f0',fontSize:14,marginBottom:14,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              📷 现场记录
              <button onClick={()=>setPhotoModal(null)} style={{background:'none',border:'none',color:'#475569',fontSize:18,cursor:'pointer',padding:0}}>×</button>
            </div>

            {/* 照片网格 */}
            <div style={{flex:1,overflowY:'auto',marginBottom:12}}>
              {photoModal.photos.length===0 && (
                <div style={{textAlign:'center',color:'#334155',fontSize:12,padding:'24px 0'}}>暂无照片，点击下方按钮拍照</div>
              )}
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:6}}>
                {photoModal.photos.map(ph=>(
                  <div key={ph.id} style={{position:'relative',aspectRatio:'1',borderRadius:6,overflow:'hidden',border:'1px solid #1b3255'}}>
                    <img src={ph.url} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>
                    <button onClick={async()=>{
                      if(!confirm('删除这张照片？')) return;
                      await apiJson(`/api/workshop/training-plan/photos/${ph.id}`,{method:'DELETE',headers:hdrs()}).catch(()=>null);
                      setPhotoModal(prev=>({...prev,photos:prev.photos.filter(x=>x.id!==ph.id)}));
                    }} style={{position:'absolute',top:3,right:3,width:20,height:20,borderRadius:'50%',background:'rgba(0,0,0,0.6)',border:'none',color:'white',fontSize:12,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',padding:0}}>×</button>
                    <div style={{position:'absolute',bottom:0,left:0,right:0,background:'rgba(0,0,0,0.5)',fontSize:9,color:'#94a3b8',padding:'2px 4px',textAlign:'center'}}>{ph.uploaded_at?.slice(5,16)}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* 拍照/选图按钮（后台上传，不阻塞） */}
            <div style={{display:'flex',gap:8}}>
              <label style={{flex:1,padding:'11px',borderRadius:8,border:'1px solid rgba(59,130,246,0.4)',background:'rgba(59,130,246,0.1)',color:'#60a5fa',fontSize:13,fontWeight:600,cursor:'pointer',textAlign:'center'}}>
                📷 拍照
                <input type="file" accept="image/*" capture="environment" style={{display:'none'}} onChange={e=>{
                  const file = e.target.files?.[0];
                  if(file) uploadPhoto(file, photoModal.planId);
                  e.target.value='';
                }}/>
              </label>
              <label style={{flex:1,padding:'11px',borderRadius:8,border:'1px solid #1b3255',background:'rgba(27,50,85,0.2)',color:'#94a3b8',fontSize:13,fontWeight:600,cursor:'pointer',textAlign:'center'}}>
                🖼 相册
                <input type="file" accept="image/*" style={{display:'none'}} onChange={e=>{
                  const file = e.target.files?.[0];
                  if(file) uploadPhoto(file, photoModal.planId);
                  e.target.value='';
                }}/>
              </label>
            </div>
          </div>
        </div>
      )}

      {/* 确认点评弹窗 */}
      {evalModal && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',display:'flex',alignItems:'flex-end',justifyContent:'center',zIndex:210}} onClick={()=>setEvalModal(null)}>
          <div style={{background:'#0f2744',borderRadius:'14px 14px 0 0',padding:20,width:'100%',maxWidth:480,maxHeight:'80vh',display:'flex',flexDirection:'column'}} onClick={e=>e.stopPropagation()}>

            {/* 第零层：选择本次完成的项点 */}
            {evalModal.step==='items' && (<>
              <div style={{fontWeight:600,color:'#e2e8f0',fontSize:14,marginBottom:4,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                本次完成项点
                <button onClick={()=>setEvalModal(null)} style={{background:'none',border:'none',color:'#475569',fontSize:18,cursor:'pointer',padding:0}}>×</button>
              </div>
              <div style={{fontSize:11,color:'#64748b',marginBottom:12}}>勾选本次早班实际完成的培训项点</div>
              {evalModal.yearPlanItems.length===0
                ? <div style={{color:'#475569',fontSize:13,textAlign:'center',padding:'20px 0'}}>本月无年度计划项点</div>
                : <div style={{flex:1,overflowY:'auto',display:'flex',flexDirection:'column',gap:6,marginBottom:14}}>
                  {evalModal.yearPlanItems.map((it,i)=>{
                    const sel=(evalModal.selectedItems||[]).includes(it.item);
                    return(
                      <button key={i} onClick={()=>setEvalModal(prev=>{
                        const cur=prev.selectedItems||[];
                        const next=sel?cur.filter(x=>x!==it.item):[...cur,it.item];
                        return{...prev,selectedItems:next};
                      })} style={{
                        padding:'10px 14px',borderRadius:8,border:`1px solid ${sel?'rgba(34,197,94,0.5)':'#1b3255'}`,
                        background:sel?'rgba(34,197,94,0.09)':'rgba(13,17,23,0.4)',
                        color:'#e2e8f0',fontFamily:'inherit',fontSize:12,cursor:'pointer',
                        textAlign:'left',display:'flex',alignItems:'center',gap:10
                      }}>
                        <span style={{width:16,height:16,borderRadius:4,border:`2px solid ${sel?'#22c55e':'#334155'}`,background:sel?'#22c55e':'transparent',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,color:'white'}}>{sel?'✓':''}</span>
                        <span style={{flex:1,fontWeight:sel?600:400}}>{it.item}</span>
                        <span style={{fontSize:10,color:'#475569',flexShrink:0}}>{it.trainType}</span>
                      </button>
                    );
                  })}
                </div>
              }
              <button disabled={evalModal.saving} onClick={async()=>{
                setEvalModal(prev=>({...prev,saving:true}));
                await apiJson(`/api/workshop/training-plan/${evalModal.planId}/completed-items`,{method:'PATCH',headers:hdrs(),body:JSON.stringify({items:evalModal.selectedItems||[]})}).catch(()=>{});
                setEvalModal(prev=>({...prev,saving:false,step:'pick'}));
              }} style={{padding:'11px',borderRadius:8,border:'none',background:'linear-gradient(135deg,#1e3a5f,#3b82f6)',color:'white',fontFamily:'inherit',fontSize:13,fontWeight:600,cursor:'pointer',opacity:evalModal.saving?0.6:1}}>
                {evalModal.saving?'保存中…':`确认（已选 ${(evalModal.selectedItems||[]).length} 个项点）→`}
              </button>
            </>)}

            {/* 第一层：人员列表 */}
            {evalModal.step==='pick' && (<>
              <div style={{fontWeight:600,color:'#e2e8f0',fontSize:14,marginBottom:4,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                ✅ 确认点评
                <button onClick={()=>setEvalModal(null)} style={{background:'none',border:'none',color:'#475569',fontSize:18,cursor:'pointer',padding:0}}>×</button>
              </div>
              <div style={{fontSize:11,color:'#475569',marginBottom:8}}>选择人员进行培训确认和点评</div>
              {(evalModal.selectedItems||[]).length>0&&<div style={{fontSize:10,color:'#60a5fa',marginBottom:10,padding:'5px 8px',background:'rgba(59,130,246,0.08)',borderRadius:5,border:'1px solid rgba(59,130,246,0.2)'}}>本次项点：{(evalModal.selectedItems||[]).join('、')} <button onClick={()=>setEvalModal(prev=>({...prev,step:'items'}))} style={{marginLeft:6,background:'none',border:'none',color:'#475569',fontSize:10,cursor:'pointer',padding:0}}>修改</button></div>}
              <div style={{flex:1,overflowY:'auto',display:'flex',flexDirection:'column',gap:4}}>
                {evalModal.members.map((m,i)=>{
                  const ev = evalModal.evaluations[m.id];
                  return (
                    <button key={i} onClick={()=>setEvalModal(prev=>({...prev,step:'eval',target:{staffId:m.id,staffName:m.real_name||m.name},comment:ev?.comment||''}))} style={{
                      padding:'10px 14px',borderRadius:8,border:`1px solid ${ev?'rgba(34,197,94,0.4)':'#1b3255'}`,
                      background:ev?'rgba(34,197,94,0.07)':'rgba(13,17,23,0.4)',
                      color:'#e2e8f0',fontFamily:'inherit',fontSize:13,cursor:'pointer',
                      textAlign:'left',display:'flex',justifyContent:'space-between',alignItems:'center'
                    }}>
                      <span style={{fontWeight:600}}>{m.real_name||m.name}</span>
                      {ev ? (
                        <span style={{fontSize:10,color:'#22c55e'}}>✓ 已点评{ev.comment?'':' (无评价)'}</span>
                      ) : (
                        <span style={{fontSize:10,color:'#334155'}}>待确认</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </>)}

            {/* 第二层：确认 + 点评框 */}
            {evalModal.step==='eval' && evalModal.target && (<>
              <div style={{fontWeight:600,color:'#e2e8f0',fontSize:14,marginBottom:2,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                {evalModal.target.staffName}
                <button onClick={()=>setEvalModal(null)} style={{background:'none',border:'none',color:'#475569',fontSize:18,cursor:'pointer',padding:0}}>×</button>
              </div>
              <div style={{fontSize:11,color:'#475569',marginBottom:14}}>本次培训确认与评价</div>
              <div style={{fontSize:11,color:'#94a3b8',marginBottom:6}}>培训评价（可不填）</div>
              <textarea
                value={evalModal.comment}
                onChange={e=>setEvalModal(prev=>({...prev,comment:e.target.value}))}
                placeholder="填写本次培训情况、表现要点或改进建议…"
                rows={4}
                style={{width:'100%',boxSizing:'border-box',background:'#0d1e35',border:'1px solid #1b3255',borderRadius:8,padding:'10px',color:'white',fontSize:13,fontFamily:'inherit',outline:'none',resize:'none',marginBottom:14}}
              />
              <div style={{display:'flex',gap:8}}>
                <button onClick={()=>setEvalModal(prev=>({...prev,step:'pick',target:null}))} style={{flex:1,padding:'10px',borderRadius:8,border:'1px solid #1b3255',background:'transparent',color:'#64748b',fontFamily:'inherit',fontSize:13,cursor:'pointer'}}>返回</button>
                <button disabled={evalModal.saving} onClick={async()=>{
                  setEvalModal(prev=>({...prev,saving:true}));
                  const {planId,target,comment} = evalModal;
                  const r = await apiJson(`/api/workshop/training-plan/${planId}/evaluations/${target.staffId}`,{
                    method:'PUT', headers:hdrs(),
                    body:JSON.stringify({staff_name:target.staffName, comment})
                  }).catch(()=>null);
                  if(r?.ok){
                    const evals = await apiJson(`/api/workshop/training-plan/${planId}/evaluations`).catch(()=>[]);
                    const evMap={};
                    (Array.isArray(evals)?evals:[]).forEach(e=>{evMap[e.staff_id]=e;});
                    setEvalModal(prev=>({...prev,saving:false,step:'pick',target:null,evaluations:evMap}));
                  } else {
                    setEvalModal(prev=>({...prev,saving:false}));
                    alert('保存失败');
                  }
                }} style={{flex:2,padding:'10px',borderRadius:8,border:'none',background:'linear-gradient(135deg,#14532d,#16a34a)',color:'white',fontFamily:'inherit',fontSize:13,fontWeight:600,cursor:'pointer',opacity:evalModal.saving?0.6:1}}>
                  {evalModal.saving ? '保存中…' : '✅ 确认培训'}
                </button>
              </div>
            </>)}

          </div>
        </div>
      )}


      {/* 照片相册弹窗 */}
      {photoAlbum && (() => {
        // 按教员分组，教员内按 uploaded_at 排序，再按日期分隔
        const sorted = [...photoAlbum.photos].sort((a,b)=>(a.uploaded_at||'').localeCompare(b.uploaded_at||''));
        const instructorMap = {};
        sorted.forEach(ph => {
          const inst = ph.instructor_name || '未分配教员';
          if (!instructorMap[inst]) instructorMap[inst] = {};
          const dateKey = ph.plan_date || ph.uploaded_at?.slice(0,10) || '未知日期';
          if (!instructorMap[inst][dateKey]) instructorMap[inst][dateKey] = [];
          instructorMap[inst][dateKey].push(ph);
        });
        const instructors = Object.keys(instructorMap).sort();
        const allPhotos = sorted;
        return (
          <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.92)',zIndex:250,display:'flex',flexDirection:'column'}} onClick={()=>setPhotoAlbum(null)}>
            <div style={{background:'#0a1929',borderBottom:'1px solid #1b3255',flexShrink:0}} onClick={e=>e.stopPropagation()}>
              {/* 标题栏 */}
              <div style={{padding:'12px 16px 8px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <div style={{fontWeight:700,color:'#e2e8f0',fontSize:15}}>📷 现场记录相册</div>
                <button onClick={()=>setPhotoAlbum(null)} style={{background:'none',border:'none',color:'#475569',fontSize:22,cursor:'pointer',padding:0,lineHeight:1}}>×</button>
              </div>
              {/* 上传工具栏 */}
              <div style={{padding:'0 12px 10px',display:'flex',flexDirection:'column',gap:8}}>
                {/* 拍照/导入按钮 */}
                <div style={{display:'flex',gap:8}}>
                  <button onClick={()=>albumCameraRef.current?.click()} style={{flex:1,padding:'9px',borderRadius:8,border:'1px solid rgba(59,130,246,0.4)',background:'rgba(59,130,246,0.08)',color:'#60a5fa',cursor:'pointer',fontSize:12,fontWeight:600}}>📷 拍照</button>
                  <button onClick={()=>albumFileRef.current?.click()} style={{flex:1,padding:'9px',borderRadius:8,border:'1px solid rgba(100,116,139,0.4)',background:'rgba(100,116,139,0.06)',color:'#94a3b8',cursor:'pointer',fontSize:12,fontWeight:600}}>🖼 导入图片</button>
                  <input ref={albumCameraRef} type="file" accept="image/*" capture="environment" multiple style={{display:'none'}} onChange={e=>{Array.from(e.target.files||[]).forEach(f=>albumUploadFile(f));e.target.value='';}}/>
                  <input ref={albumFileRef} type="file" accept="image/*" multiple style={{display:'none'}} onChange={e=>{Array.from(e.target.files||[]).forEach(f=>albumUploadFile(f));e.target.value='';}}/>
                </div>
                {/* 水印设置 */}
                <div style={{display:'flex',flexDirection:'column',gap:6}}>
                  <label style={{display:'flex',alignItems:'center',gap:5,cursor:'pointer',userSelect:'none'}}>
                    <input type="checkbox" checked={albumWatermark} onChange={e=>setAlbumWatermark(e.target.checked)} style={{accentColor:'#3b82f6',width:14,height:14}}/>
                    <span style={{fontSize:11,color:'#94a3b8'}}>加水印</span>
                  </label>
                  {albumWatermark&&(<>
                    {/* 日期选择 */}
                    <div style={{display:'flex',alignItems:'center',gap:6}}>
                      <span style={{fontSize:11,color:'#64748b',flexShrink:0}}>日期</span>
                      <input type="date" value={albumDate} onChange={e=>setAlbumDate(e.target.value)}
                        style={{flex:1,background:'#0d1e35',border:'1px solid #1b3255',borderRadius:5,padding:'4px 8px',color:'#e2e8f0',fontSize:11,fontFamily:'inherit',outline:'none'}}/>
                    </div>
                    {/* 地点 */}
                    <div style={{display:'flex',alignItems:'center',gap:5,flexWrap:'wrap'}}>
                      <span style={{fontSize:11,color:'#64748b',flexShrink:0}}>地点</span>
                      {[['工人村','武汉地铁工人村车辆段'],['青菱','武汉地铁青菱车场'],['复兴路','复兴路地铁站']].map(([short,full])=>(
                        <button key={short} onClick={()=>setAlbumLocation(albumLocation===full?'':full)} style={{padding:'3px 8px',borderRadius:5,border:`1px solid ${albumLocation===full?'#3b82f6':'#1b3255'}`,background:albumLocation===full?'rgba(59,130,246,0.15)':'transparent',color:albumLocation===full?'#60a5fa':'#64748b',cursor:'pointer',fontSize:11,fontFamily:'inherit'}}>{short}</button>
                      ))}
                      <button onClick={albumGeolocate} disabled={albumLocLoading} style={{padding:'3px 8px',borderRadius:5,border:'1px solid rgba(34,197,94,0.25)',background:'transparent',color:albumLocLoading?'#475569':'#4ade80',cursor:'pointer',fontSize:11,fontFamily:'inherit'}}>
                        {albumLocLoading?'…':'📍'}
                      </button>
                    </div>
                  </>)}
                </div>
              </div>
            </div>
            <div style={{flex:1,overflowY:'auto',padding:'10px 12px 24px'}} onClick={e=>e.stopPropagation()}>
              {photoAlbum.loading && <div style={{textAlign:'center',color:'#475569',padding:'40px 0',fontSize:13}}>加载中…</div>}
              {!photoAlbum.loading && instructors.length===0 && <div style={{textAlign:'center',color:'#334155',padding:'40px 0',fontSize:13}}>暂无现场照片</div>}
              {instructors.map(inst => {
                const dateMap = instructorMap[inst];
                const dateKeys = Object.keys(dateMap).sort((a,b)=>b.localeCompare(a));
                const instTotal = dateKeys.reduce((s,d)=>s+dateMap[d].length, 0);
                return (
                  <div key={inst} style={{marginBottom:20}}>
                    {/* 教员标题 */}
                    <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10,paddingBottom:6,borderBottom:'1px solid rgba(59,130,246,0.2)'}}>
                      <span style={{fontSize:13,fontWeight:700,color:'#60a5fa'}}>👤 {inst}</span>
                      <span style={{fontSize:10,color:'#334155',marginLeft:'auto'}}>{instTotal} 张</span>
                    </div>
                    {/* 按日期分块 */}
                    {dateKeys.map(dateKey => {
                      const photos = dateMap[dateKey];
                      return (
                        <div key={dateKey} style={{marginBottom:12}}>
                          <div style={{fontSize:11,color:'#475569',marginBottom:5,display:'flex',alignItems:'center',gap:6}}>
                            <span style={{color:'#64748b',fontWeight:600}}>{dateKey}</span>
                            <span style={{color:'#334155'}}>· {photos[0]?.plan_type||''} {photos[0]?.group_name||''}</span>
                            <span style={{marginLeft:'auto',color:'#334155'}}>{photos.length} 张</span>
                          </div>
                          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:5}}>
                            {photos.map(ph => {
                              const globalIdx = allPhotos.indexOf(ph);
                              return (
                                <div key={ph.photo_id} style={{position:'relative',aspectRatio:'1',borderRadius:7,overflow:'hidden',border:'1px solid #1b3255',background:'#0d1e35'}}>
                                  <img src={ph.url} alt="" loading="lazy" onClick={()=>setLightbox({photos:allPhotos,index:globalIdx})} style={{width:'100%',height:'100%',objectFit:'cover',cursor:'pointer'}}/>
                                  <div style={{position:'absolute',bottom:0,left:0,right:0,fontSize:9,color:'rgba(255,255,255,0.45)',background:'rgba(0,0,0,0.3)',padding:'2px 4px',textAlign:'right',lineHeight:1.4}}>
                                    {ph.uploaded_at?.slice(11,16)}
                                  </div>
                                  {hasEditPerm&&(
                                    <button onClick={async e=>{
                                      e.stopPropagation();
                                      if(!window.confirm('确认删除此照片？'))return;
                                      await apiJson(`/api/workshop/training-plan/photos/${ph.photo_id}`,{method:'DELETE',headers:hdrs()}).catch(()=>null);
                                      const photos2=await apiJson('/api/workshop/photos').catch(()=>[]);
                                      setPhotoAlbum(prev=>prev?{...prev,photos:Array.isArray(photos2)?photos2:[]}:prev);
                                    }} style={{position:'absolute',top:4,right:4,width:20,height:20,borderRadius:'50%',border:'none',background:'rgba(239,68,68,0.8)',color:'white',fontSize:12,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',lineHeight:1}}>×</button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* 全屏灯箱 */}
      {lightbox && (() => {
        const ph = lightbox.photos[lightbox.index];
        const total = lightbox.photos.length;
        const goPrev = e => { e.stopPropagation(); setLightbox(l=>({...l,index:(l.index-1+total)%total})); };
        const goNext = e => { e.stopPropagation(); setLightbox(l=>({...l,index:(l.index+1)%total})); };
        return (
          <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.97)',zIndex:300,display:'flex',flexDirection:'column'}} onClick={()=>setLightbox(null)}>
            {/* 顶栏 */}
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 14px',flexShrink:0}} onClick={e=>e.stopPropagation()}>
              <div style={{color:'#94a3b8',fontSize:12}}>{lightbox.index+1} / {total}</div>
              <a href={ph.url} download={ph.filename}
                style={{fontSize:11,padding:'5px 12px',borderRadius:6,border:'1px solid rgba(59,130,246,0.5)',background:'rgba(59,130,246,0.12)',color:'#60a5fa',textDecoration:'none',fontWeight:600}}
                onClick={e=>e.stopPropagation()}>
                ⬇ 下载
              </a>
              <button onClick={()=>setLightbox(null)} style={{background:'none',border:'none',color:'#475569',fontSize:22,cursor:'pointer',padding:0}}>×</button>
            </div>
            {/* 图片区 */}
            <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',position:'relative',overflow:'hidden'}} onClick={e=>e.stopPropagation()}>
              {total>1 && <button onClick={goPrev} style={{position:'absolute',left:8,zIndex:1,background:'rgba(0,0,0,0.5)',border:'1px solid #1b3255',borderRadius:'50%',width:36,height:36,color:'white',fontSize:18,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>‹</button>}
              <img src={ph.url} alt="" style={{maxWidth:'100%',maxHeight:'100%',objectFit:'contain',borderRadius:4}}/>
              {total>1 && <button onClick={goNext} style={{position:'absolute',right:8,zIndex:1,background:'rgba(0,0,0,0.5)',border:'1px solid #1b3255',borderRadius:'50%',width:36,height:36,color:'white',fontSize:18,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>›</button>}
            </div>
            {/* 底部信息 */}
            <div style={{padding:'8px 14px',color:'#475569',fontSize:11,textAlign:'center',flexShrink:0}} onClick={e=>e.stopPropagation()}>
              {ph.plan_date} {ph.plan_type && `· ${ph.plan_type}`} {ph.group_name && `· ${ph.group_name}`}
            </div>
          </div>
        );
      })()}

      {/* 后台上传进度浮动提示 */}
      {uploadQueue.length > 0 && (
        <div style={{position:'fixed',bottom:90,left:'50%',transform:'translateX(-50%)',zIndex:300,display:'flex',flexDirection:'column',gap:4,minWidth:200,maxWidth:320,pointerEvents:'none'}}>
          {uploadQueue.map(item=>(
            <div key={item.id} style={{
              background: item.status==='done' ? 'rgba(22,163,74,0.9)' : item.status==='error' ? 'rgba(220,38,38,0.9)' : 'rgba(15,39,68,0.95)',
              border: `1px solid ${item.status==='done'?'rgba(34,197,94,0.5)':item.status==='error'?'rgba(239,68,68,0.5)':'rgba(59,130,246,0.4)'}`,
              borderRadius:10,padding:'8px 14px',display:'flex',alignItems:'center',gap:8,
              boxShadow:'0 4px 16px rgba(0,0,0,0.4)'
            }}>
              <span style={{fontSize:13}}>
                {item.status==='uploading' ? '⏫' : item.status==='done' ? '✅' : '❌'}
              </span>
              <span style={{color:'#e2e8f0',fontSize:12,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                {item.status==='uploading' ? `上传中… ${item.filename}` : item.status==='done' ? `上传成功` : `上传失败`}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* 月度设置弹窗 */}
      {showSettings && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.8)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,padding:16}} onClick={()=>setShowSettings(false)}>
          <div style={{background:'#0f2744',borderRadius:12,padding:20,width:'100%',maxWidth:360}} onClick={e=>e.stopPropagation()}>
            <div style={{fontWeight:600,color:'#e2e8f0',fontSize:15,marginBottom:14}}>月度设置 — {monthLabel(month)}</div>
            <div style={{fontSize:11,color:'#64748b',marginBottom:5}}>中旬会日期（留空=自动取11~20首个工作日早班）</div>
            <input type="date" value={safetyInput} onChange={e=>setSafetyInput(e.target.value)}
              style={{width:'100%',background:'#0d1e35',border:'1px solid #1b3255',borderRadius:6,padding:'7px 10px',color:'white',fontSize:13,fontFamily:'inherit',outline:'none',boxSizing:'border-box',marginBottom:12}}/>
            <div style={{fontSize:11,color:'#64748b',marginBottom:5}}>本月起始小组</div>
            <select value={startGroupInput} onChange={e=>setStartGroupInput(e.target.value)}
              style={{width:'100%',background:'#0d1e35',border:'1px solid #1b3255',borderRadius:6,padding:'7px 10px',color:'white',fontSize:13,fontFamily:'inherit',outline:'none',marginBottom:10}}>
              <option value="">— 自动（第一小组）—</option>
              {(plan?.groups||[]).map(g=><option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <div style={{fontSize:11,color:'#64748b',marginBottom:5}}>班组长起始序号（0~N）</div>
            <input type="number" value={startLeaderInput} onChange={e=>setStartLeaderInput(e.target.value)} min={0}
              style={{width:'100%',background:'#0d1e35',border:'1px solid #1b3255',borderRadius:6,padding:'7px 10px',color:'white',fontSize:13,fontFamily:'inherit',outline:'none',boxSizing:'border-box',marginBottom:16}}
              placeholder={`0 ~ ${(plan?.leaderStaff?.length||1)-1}`}/>
            <div style={{display:'flex',gap:8}}>
              <button onClick={()=>setShowSettings(false)} style={{flex:1,padding:'10px',borderRadius:7,border:'1px solid #1b3255',background:'transparent',color:'#94a3b8',fontFamily:'inherit',fontSize:13,cursor:'pointer'}}>取消</button>
              <button onClick={saveSettings} style={{flex:2,padding:'10px',borderRadius:7,border:'none',background:'linear-gradient(135deg,#1e3a5f,#3b82f6)',color:'white',fontFamily:'inherit',fontSize:13,fontWeight:600,cursor:'pointer'}}>保存并重新生成</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// ── 导入培训计划卡片 ──────────────────────────────────────────────────────────
const TRAIN_TYPES_YP = ['示范','实操','理论','实践','其他'];
const TYPE_COLOR_YP = {'示范':'#a78bfa','实操':'#34d399','理论':'#38bdf8','实践':'#fb923c','其他':'#94a3b8'};

function ImportPlanCard({ hdrs }) {
  const curYear = new Date().getFullYear();
  const curMonth = new Date().getMonth() + 1;
  const [uploading, setUploading] = useState(false);
  const [fileList, setFileList] = useState(null);
  const [yearPlan, setYearPlan] = useState([]); // [{year,month,sessions:[{item,trainType}]}]
  const [expanded, setExpanded] = useState({ [curMonth]: true });
  // editBuf[month] = [{item,trainType}] — 编辑中的草稿
  const [editBuf, setEditBuf] = useState({});
  const [editingMonth, setEditingMonth] = useState(null);
  const [saving, setSaving] = useState(false);
  const [parsing, setParsing] = useState({});

  const iconFor = name => {
    const ext = (name||'').split('.').pop()?.toLowerCase();
    if (['jpg','jpeg','png','gif','webp','heic','bmp'].includes(ext)) return '🖼';
    if (['xlsx','xls','csv'].includes(ext)) return '📊';
    if (ext==='pdf') return '📄';
    if (['doc','docx'].includes(ext)) return '📝';
    return '📎';
  };

  const loadFileList = () => fetch('/api/admin/training-imports',{headers:hdrs()}).then(r=>r.json()).then(d=>setFileList(Array.isArray(d)?d:[])).catch(()=>setFileList([]));
  const loadPlan = () => fetch(`/api/admin/training-year-plan?year=${curYear}`,{headers:hdrs()}).then(r=>r.json()).then(d=>setYearPlan(Array.isArray(d)?d:[])).catch(()=>{});

  useEffect(()=>{ loadFileList(); loadPlan(); },[]);

  const upload = async (files) => {
    if (!files?.length) return;
    setUploading(true);
    for (const f of Array.from(files)) {
      const fd = new FormData(); fd.append('file', f);
      const h = {...hdrs()}; delete h['Content-Type'];
      await fetch('/api/admin/training-imports',{method:'POST',headers:h,body:fd}).catch(()=>{});
    }
    setUploading(false);
    loadFileList();
  };

  const delFile = async (id) => {
    if (!confirm('确认删除此文件？')) return;
    await fetch(`/api/admin/training-imports/${id}`,{method:'DELETE',headers:hdrs()});
    setFileList(l=>l.filter(x=>x.id!==id));
  };

  const parseFile = async (id) => {
    setParsing(p=>({...p,[id]:true}));
    await fetch(`/api/admin/training-imports/${id}/parse`,{method:'POST',headers:hdrs()}).catch(()=>{});
    setFileList(l=>l.map(x=>x.id===id?{...x,parse_status:'processing'}:x));
    const poll = setInterval(async () => {
      const r = await fetch('/api/admin/training-imports',{headers:hdrs()}).then(r=>r.json()).catch(()=>[]);
      const f = r.find(x=>x.id===id);
      if (f?.parse_status !== 'processing') {
        setFileList(r); setParsing(p=>({...p,[id]:false})); clearInterval(poll);
        if (f?.parse_status==='done') loadPlan();
      }
    }, 3000);
    setTimeout(()=>{ clearInterval(poll); setParsing(p=>({...p,[id]:false})); }, 90000);
  };

  const getMonthRows = (m) => yearPlan.find(r=>r.month===m)?.sessions || [];

  // 开始编辑某月：复制当前数据到 editBuf
  const startEdit = (m) => {
    setEditBuf(b=>({...b,[m]: getMonthRows(m).map(r=>({...r}))}));
    setEditingMonth(m);
    setExpanded(e=>({...e,[m]:true}));
  };
  const cancelEdit = (m) => { setEditingMonth(null); };
  const saveEdit = async (m) => {
    setSaving(true);
    const sessions = editBuf[m] || [];
    await fetch(`/api/admin/training-year-plan/${curYear}/${m}`,{method:'PUT',headers:hdrs(),body:JSON.stringify({sessions})}).catch(()=>{});
    setYearPlan(p=>{ const rest=p.filter(r=>r.month!==m); return [...rest,{year:curYear,month:m,sessions}].sort((a,b)=>a.month-b.month); });
    setEditingMonth(null); setSaving(false);
  };
  const bufUpdate = (m,idx,field,val) => setEditBuf(b=>({...b,[m]:b[m].map((r,i)=>i===idx?{...r,[field]:val}:r)}));
  const bufAdd = (m) => setEditBuf(b=>({...b,[m]:[...(b[m]||getMonthRows(m)),{item:'',trainType:'实操'}]}));
  const bufDel = (m,idx) => setEditBuf(b=>({...b,[m]:(b[m]||getMonthRows(m)).filter((_,i)=>i!==idx)}));

  const statusBadge = s => s==='done'?{t:'已识别',c:'#22c55e'}:s==='processing'?{t:'识别中…',c:'#f59e0b'}:s==='error'?{t:'识别失败',c:'#ef4444'}:{t:'待识别',c:'#475569'};

  const MONTHS = Array.from({length:12},(_,i)=>i+1);

  return (
    <div className="card" style={{padding:0,overflow:'hidden'}}>

      {/* ── 文件上传区 ── */}
      <div style={{padding:'14px 16px 12px',borderBottom:'1px solid #1b3255'}}>
        <div style={{fontSize:11,color:'#64748b',letterSpacing:1,marginBottom:10,fontWeight:600}}>导入培训计划文件</div>
        <label style={{display:'block',border:'1px dashed rgba(59,130,246,0.4)',borderRadius:8,padding:'12px',textAlign:'center',cursor:'pointer',background:'rgba(59,130,246,0.04)',marginBottom:8}}>
          <input type="file" multiple accept="image/*,.xlsx,.xls,.csv,.pdf,.doc,.docx" style={{display:'none'}}
            onChange={e=>{upload(e.target.files);e.target.value='';}} disabled={uploading}/>
          <div style={{fontSize:16,marginBottom:2}}>{uploading?'⏳':'＋'}</div>
          <div style={{fontSize:11,color:'#64748b'}}>{uploading?'上传中…':'点击上传排班图片 / Excel / PDF / Word'}</div>
        </label>
        {fileList && fileList.map(f => {
          const b = statusBadge(f.parse_status);
          return (
            <div key={f.id} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 0',borderTop:'1px solid rgba(27,50,85,0.35)'}}>
              <span style={{fontSize:14,flexShrink:0}}>{iconFor(f.original_name||f.filename)}</span>
              <div style={{flex:1,overflow:'hidden'}}>
                <div style={{fontSize:11,color:'#e2e8f0',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{f.original_name||f.filename}</div>
                <div style={{fontSize:10,color:'#475569'}}>{(f.uploaded_at||'').slice(0,16)}</div>
              </div>
              <span style={{fontSize:10,color:b.c,flexShrink:0}}>{b.t}</span>
              {f.parse_status!=='processing' && (
                <button onClick={()=>parseFile(f.id)} disabled={!!parsing[f.id]}
                  style={{fontSize:10,padding:'3px 8px',borderRadius:5,border:'1px solid rgba(59,130,246,0.4)',background:'rgba(59,130,246,0.1)',color:'#60a5fa',cursor:'pointer',flexShrink:0,opacity:parsing[f.id]?0.5:1}}>
                  🤖 {f.parse_status==='done'?'重新识别':'识别'}
                </button>
              )}
              <a href={`/training-imports/${f.filename}`} target="_blank" style={{fontSize:10,color:'#475569',textDecoration:'none',flexShrink:0}}>查看</a>
              <button onClick={()=>delFile(f.id)} style={{background:'none',border:'none',color:'#334155',fontSize:16,cursor:'pointer',padding:0,flexShrink:0}}>×</button>
            </div>
          );
        })}
      </div>

      {/* ── 年度培训计划表 ── */}
      {/* 表头 */}
      <div style={{display:'grid',gridTemplateColumns:'52px 1fr 64px 80px',background:'rgba(27,50,85,0.6)',borderBottom:'1px solid #1b3255'}}>
        {['月份','培训项点','培训方式','操作'].map(h=>(
          <div key={h} style={{padding:'7px 8px',fontSize:10,fontWeight:700,color:'#64748b',letterSpacing:1,textAlign:'center'}}>{h}</div>
        ))}
      </div>

      {MONTHS.map(m => {
        const rows = getMonthRows(m);
        const isOpen = !!expanded[m];
        const isCur = m===curMonth;
        const isPast = m<curMonth;
        const isEditing = editingMonth===m;
        const buf = editBuf[m] || rows;

        return (
          <div key={m} style={{borderBottom:'1px solid rgba(27,50,85,0.4)'}}>
            {/* 月份折叠标题 */}
            <div onClick={()=>setExpanded(e=>({...e,[m]:!isOpen}))}
              style={{display:'flex',alignItems:'center',padding:'8px 12px',cursor:'pointer',
                background:isCur?'rgba(59,130,246,0.07)':isPast?'rgba(0,0,0,0.12)':'transparent',
                borderLeft:`3px solid ${isCur?'#3b82f6':isPast?'#1e3a5f':'transparent'}`}}>
              <span style={{fontSize:12,fontWeight:isCur?700:400,color:isCur?'#93c5fd':isPast?'#475569':'#64748b',minWidth:56}}>
                {m}月 {isCur&&<span style={{fontSize:9,background:'rgba(59,130,246,0.25)',color:'#60a5fa',borderRadius:3,padding:'0 4px',marginLeft:3}}>本月</span>}
              </span>
              <span style={{fontSize:10,color:'#334155',flex:1}}>{rows.length>0?`${rows.length}项`:'暂无'}</span>
              <span style={{fontSize:11,color:'#334155'}}>{isOpen?'▾':'›'}</span>
            </div>

            {/* 展开内容 */}
            {isOpen && (<>
              {/* 数据行 */}
              {(isEditing?buf:rows).map((r,idx)=>(
                <div key={idx} style={{display:'grid',gridTemplateColumns:'52px 1fr 64px 80px',borderTop:'1px solid rgba(27,50,85,0.25)',background:idx%2===0?'transparent':'rgba(0,0,0,0.08)'}}>
                  <div style={{padding:'7px 8px',fontSize:11,color:'#475569',textAlign:'center',alignSelf:'center'}}>{m}/{idx+1}</div>
                  {isEditing ? (
                    <input value={r.item||''} onChange={e=>bufUpdate(m,idx,'item',e.target.value)}
                      style={{margin:'4px 4px',padding:'4px 6px',background:'#0d1e35',border:'1px solid #2a4a7f',borderRadius:4,color:'#e2e8f0',fontSize:11,fontFamily:'inherit',outline:'none'}}/>
                  ) : (
                    <div style={{padding:'7px 8px',fontSize:11,color:'#e2e8f0',lineHeight:1.5,alignSelf:'center'}}>{r.item}</div>
                  )}
                  {isEditing ? (
                    <select value={r.trainType||'实操'} onChange={e=>bufUpdate(m,idx,'trainType',e.target.value)}
                      style={{margin:'4px 2px',padding:'4px 4px',background:'#0d1e35',border:'1px solid #2a4a7f',borderRadius:4,color:TYPE_COLOR_YP[r.trainType]||'#94a3b8',fontSize:11,fontFamily:'inherit',outline:'none'}}>
                      {TRAIN_TYPES_YP.map(t=><option key={t} value={t}>{t}</option>)}
                    </select>
                  ) : (
                    <div style={{padding:'7px 4px',textAlign:'center',alignSelf:'center'}}>
                      <span style={{fontSize:10,padding:'2px 6px',borderRadius:4,border:`1px solid ${TYPE_COLOR_YP[r.trainType]||'#475569'}44`,color:TYPE_COLOR_YP[r.trainType]||'#94a3b8',background:`${TYPE_COLOR_YP[r.trainType]||'#475569'}11`}}>{r.trainType||'—'}</span>
                    </div>
                  )}
                  <div style={{padding:'4px 6px',display:'flex',alignItems:'center',justifyContent:'center'}}>
                    {isEditing && <button onClick={()=>bufDel(m,idx)} style={{background:'none',border:'none',color:'#475569',fontSize:14,cursor:'pointer',padding:'0 4px'}}>×</button>}
                  </div>
                </div>
              ))}

              {/* 空提示 */}
              {!isEditing && rows.length===0 && (
                <div style={{padding:'10px 12px',fontSize:11,color:'#334155',textAlign:'center'}}>暂无培训项点</div>
              )}

              {/* 编辑模式：添加行 + 保存取消 */}
              {isEditing && (
                <div style={{padding:'6px 12px',borderTop:'1px solid rgba(27,50,85,0.3)',display:'flex',gap:8,alignItems:'center',background:'rgba(0,0,0,0.1)'}}>
                  <button onClick={()=>bufAdd(m)} style={{fontSize:11,padding:'4px 10px',borderRadius:5,border:'1px dashed rgba(59,130,246,0.4)',background:'rgba(59,130,246,0.06)',color:'#60a5fa',cursor:'pointer',fontFamily:'inherit'}}>＋ 添加</button>
                  <span style={{flex:1}}/>
                  <button onClick={()=>cancelEdit(m)} style={{fontSize:11,padding:'4px 10px',borderRadius:5,border:'1px solid #1b3255',background:'transparent',color:'#64748b',cursor:'pointer',fontFamily:'inherit'}}>取消</button>
                  <button onClick={()=>saveEdit(m)} disabled={saving} style={{fontSize:11,padding:'4px 12px',borderRadius:5,border:'none',background:'#3b82f6',color:'white',cursor:'pointer',fontFamily:'inherit',fontWeight:600}}>
                    {saving?'保存中…':'保存'}
                  </button>
                </div>
              )}

              {/* 非编辑模式：修改按钮 */}
              {!isEditing && (
                <div style={{padding:'5px 12px',borderTop:'1px solid rgba(27,50,85,0.2)',background:'rgba(0,0,0,0.08)',display:'flex',justifyContent:'flex-end'}}>
                  <button onClick={()=>startEdit(m)} style={{fontSize:10,padding:'3px 10px',borderRadius:5,border:'1px solid #1b3255',background:'transparent',color:'#64748b',cursor:'pointer',fontFamily:'inherit'}}>✎ 修改</button>
                </div>
              )}
            </>)}
          </div>
        );
      })}
    </div>
  );
}

function AdminScreen({ onBack }) {
  const [authed,setAuthed]=useState(()=>!!localStorage.getItem('admin_pwd'));
  const [pwd,setPwd]=useState(()=>localStorage.getItem('admin_pwd')||'');
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
  const [lbSessionsAlltime,setLbSessionsAlltime]=useState([]);
  const [lbMode,setLbMode]=useState('cycle'); // 'cycle'|'alltime'
  const [weakQuestions,setWeakQuestions]=useState([]);
  const [incompleteExpanded,setIncompleteExpanded]=useState(false);
  const [lbCollapsed,setLbCollapsed]=useState(true);
  const [staffListCollapsed,setStaffListCollapsed]=useState(true);
  const [resetModal,setResetModal]=useState(null); // null or {staff_id, name}
  const [makeupModal,setMakeupModal]=useState(null); // null or {staff_id, name}
  const [adminDrillModal,setAdminDrillModal]=useState(null); // {staffId,staffName,mode,loading,sessions,cycles,expandedCycleId}
  const [dingtalkLoading,setDingtalkLoading]=useState(false);
  const [allCorrectExpanded,setAllCorrectExpanded]=useState(false);
  const [lowErrorExpanded,setLowErrorExpanded]=useState(false);
  const [highErrorCollapsed,setHighErrorCollapsed]=useState(true);
  const [monthPlanCompletion,setMonthPlanCompletion]=useState([]);
  const [monthMemberCompletion,setMonthMemberCompletion]=useState(null);
  const [memberEvalModal,setMemberEvalModal]=useState(null); // {id, name, plans:[]}
  const [planDetailModal,setPlanDetailModal]=useState(null); // plan object
  const [exportMonths,setExportMonths]=useState([]);
  const [showExportMenu,setShowExportMenu]=useState(null); // null|'quiz'|'workshop'
  const [exportWsModal,setExportWsModal]=useState(null);
  // 手动添加题目
  const [addQ,setAddQ]=useState({text:'',reference:'',keywords:'',category:'业务知识',difficulty:'中等',bank_id:''});
  const [addQLoading,setAddQLoading]=useState(false);
  // AI生成题目
  const [aiContent,setAiContent]=useState('');
  const [aiCount,setAiCount]=useState(3);
  const [aiBankId,setAiBankId]=useState('');
  const [aiResult,setAiResult]=useState(null);
  const [aiLoading,setAiLoading]=useState(false);
  // 手动选题 / 抽问设置
  const [qSearch,setQSearch]=useState('');
  const [qAll,setQAll]=useState([]);
  const [qPinned,setQPinned]=useState({ids:[],scope:'none',mode:'emergency',count:3,bank_id:null});
  const [qSelected,setQSelected]=useState([]);
  const [pinScope,setPinScope]=useState('today');
  const [pinFallback,setPinFallback]=useState('');
  const [qSelectOpen,setQSelectOpen]=useState(false);
  const [qSelectBank,setQSelectBank]=useState('incident'); // 'incident' | 'emergency'
  const [pinCount,setPinCount]=useState(3);         // 抽问题目数 1-5
  const [pinMode,setPinMode]=useState('emergency'); // 'manual'|'random'|'emergency'
  const [pinRandomBankId,setPinRandomBankId]=useState(null); // 多题随机时的题库id
  const [pinSaveModal,setPinSaveModal]=useState(false); // 保存确认弹窗
  // 题库展开状态（bankId -> true/false）和题目缓存（bankId -> questions[]）
  const [bankExpanded,setBankExpanded]=useState({});
  const [bankQsCache,setBankQsCache]=useState({});
  const [bankSectionOpen,setBankSectionOpen]=useState({});
  const [editQModal,setEditQModal]=useState(null); // {id,bankId,text,reference,keywords,category}
  const [checkedBankIds,setCheckedBankIds]=useState([]);
  // 上传/人工出题面板
  const [showUploadPanel,setShowUploadPanel]=useState(false);
  const [showAddQPanel,setShowAddQPanel]=useState(false);
  // 新增分类
  const [newCategoryName,setNewCategoryName]=useState('');
  const [savingCategory,setSavingCategory]=useState(false);
  const ah=useMemo?undefined:adminHeaders(pwd); // will pass inline
  const hdrs=(extra={})=>({...adminHeaders(pwd),'Content-Type':'application/json',...extra});

  const login=async()=>{
    try{const r=await api('/api/admin/login',{method:'POST',body:JSON.stringify({password:pwd})});
      if(r.ok){localStorage.setItem('admin_pwd',pwd);setAuthed(true);}else setPwdErr('密码错误');
    }catch{setPwdErr('连接服务器失败');}
  };
  const logout=()=>{localStorage.removeItem('admin_pwd');setPwd('');setAuthed(false);};

  useEffect(()=>{
    if(!authed)return;
    if(tab==='overview'){apiJson('/api/admin/overview',{headers:hdrs()}).then(setOverview).catch(()=>{});apiJson('/api/admin/leaderboard/cycle',{headers:hdrs()}).then(d=>setLbSessions(d.rows||[])).catch(()=>{});apiJson('/api/admin/leaderboard/alltime',{headers:hdrs()}).then(d=>setLbSessionsAlltime(Array.isArray(d)?d:(d.rows||[]))).catch(()=>{});apiJson('/api/admin/weak-questions',{headers:hdrs()}).then(setWeakQuestions).catch(()=>{});apiJson('/api/export/months',{headers:hdrs()}).then(setExportMonths).catch(()=>{});apiJson('/api/admin/month-plan-completion',{headers:hdrs()}).then(setMonthPlanCompletion).catch(()=>{});apiJson('/api/admin/month-member-completion',{headers:hdrs()}).then(setMonthMemberCompletion).catch(()=>{});}
    if(tab==='members')apiJson('/api/admin/members',{headers:hdrs()}).then(setMembers).catch(()=>{});
    if(tab==='banks'){apiJson('/api/banks',{headers:hdrs()}).then(d=>{setBanks(d);if(d.length>0){setAiBankId(String(d[0].id));setPinFallback(String(d[0].id));}const manualBank=d.find(b=>b.name==='人工提问');if(manualBank)setAddQ(q=>({...q,bank_id:String(manualBank.id)}));}).catch(()=>{});apiJson('/api/settings',{headers:hdrs()}).then(setSettings).catch(()=>{});apiJson('/api/admin/pinned-questions',{headers:hdrs()}).then(d=>{setQPinned(d);setQSelected(d.ids||[]);setPinScope(d.scope==='none'?'today':d.scope);setPinFallback(d.bank_fallback_id?String(d.bank_fallback_id):'');setPinCount(d.count||3);setPinMode(d.bank_ids?.length>0?'manual':d.mode||'emergency');setPinRandomBankId(d.bank_id||null);setCheckedBankIds(d.bank_ids||[]);}).catch(()=>{});}
    if(tab==='qr')apiJson('/api/qrcode').then(setQr).catch(()=>{});
    if(tab==='logs')apiJson('/api/admin/logs',{headers:hdrs()}).then(setLogs).catch(()=>{});
  },[tab,authed]);

  const pushDingtalk=async()=>{
    setDingtalkLoading(true);
    try{
      const r=await apiJson('/api/admin/dingtalk/push',{method:'POST',headers:hdrs()});
      if(r.ok) alert(`✅ 已推送到钉钉群（${r.count}/${r.total}人完成）`);
      else alert(`推送失败：${r.error}`);
    }catch(e){alert('推送失败：'+e.message);}
    finally{setDingtalkLoading(false);}
  };

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
      <div className="page-header"><button className="back-btn" onClick={onBack}>←</button><h2>管理员后台</h2><button onClick={logout} style={{fontSize:11,color:'#475569',background:'none',border:'1px solid #1b3255',borderRadius:5,padding:'3px 9px',cursor:'pointer'}}>退出登录</button></div>
      <div className="tab-row" style={{flexWrap:'wrap',gap:5}}>
        {[['overview','概览'],['members','人员'],['banks','题库'],['settings','设置'],['logs','日志'],['qr','扫码']].map(([k,v])=>(
          <button key={k} className={`tab${tab===k?' active':''}`} style={{flex:'none',padding:'7px 12px'}} onClick={()=>setTab(k)}>{v}</button>
        ))}
      </div>
      <div style={{padding:'12px 14px 28px',display:'flex',flexDirection:'column',gap:12,overflowY:'auto'}}>

        {tab==='overview'&&overview&&<>

          {/* ── 本套班完成情况 ── */}
          <div className="card" style={{padding:0,overflow:'hidden'}}>
            <div style={{padding:'14px 16px 12px'}}>
              <div style={{fontSize:10,color:'#64748b',letterSpacing:2,fontWeight:600,marginBottom:10,textTransform:'uppercase'}}>本套班完成情况</div>
              <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:10}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:30,fontWeight:900,color:'white',lineHeight:1}}>{overview.todayComplete}<span style={{fontSize:12,color:'#64748b',fontWeight:400,marginLeft:5}}>/ {overview.totalStaff} 人</span></div>
                  {overview.incompleteList?.length>0
                    ? <div style={{fontSize:11,color:'#f59e0b',marginTop:4}}>还差 {overview.incompleteList.length} 人未完成</div>
                    : <div style={{fontSize:11,color:'#22c55e',marginTop:4}}>全部完成 ✓</div>
                  }
                </div>
                <ScoreRing score={Math.round((overview.todayComplete/Math.max(overview.totalStaff,1))*100)} size={62}/>
                <button onClick={pushDingtalk} disabled={dingtalkLoading} style={{flexShrink:0,display:'flex',flexDirection:'column',alignItems:'center',gap:3,padding:'8px 10px',background:dingtalkLoading?'rgba(59,130,246,0.1)':'rgba(59,130,246,0.15)',border:'1px solid rgba(59,130,246,0.35)',borderRadius:10,color:dingtalkLoading?'#64748b':'#60a5fa',fontSize:10,cursor:dingtalkLoading?'not-allowed':'pointer',lineHeight:1.3,minWidth:48}}>
                  <span style={{fontSize:18}}>{dingtalkLoading?'⏳':'📤'}</span>
                  <span>推送</span>
                  <span>钉钉</span>
                </button>
              </div>
              <div style={{height:5,background:'#1e293b',borderRadius:3,overflow:'hidden'}}>
                <div style={{height:'100%',width:`${(overview.todayComplete/Math.max(overview.totalStaff,1))*100}%`,background:'linear-gradient(90deg,#3b82f6,#22c55e)',borderRadius:3,transition:'width 0.8s ease'}}/>
              </div>
            </div>
            {overview.allStaff?.length>0&&(()=>{
              // Sort: none(staff_id desc) → interrupted/browsed(staff_id desc) → done(completed_at asc, earliest last)
              const noneGroup=[...overview.allStaff.filter(p=>p.status==='none')].sort((a,b)=>b.staff_id.localeCompare(a.staff_id));
              const midGroup=[...overview.allStaff.filter(p=>p.status==='interrupted'||p.status==='browsed')].sort((a,b)=>b.staff_id.localeCompare(a.staff_id));
              const doneGroup=[...overview.allStaff.filter(p=>p.status==='done')].sort((a,b)=>(b.completed_at||'').localeCompare(a.completed_at||''));
              const sorted=[...noneGroup,...midGroup,...doneGroup];
              return(
                <div style={{borderTop:'1px solid #1b3255',padding:'10px 12px 10px'}}>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'5px 6px'}}>
                    {(staffListCollapsed?sorted.slice(0,12):sorted).map((p,ni)=>{
                      const isDone=p.status==='done';
                      const isInt=p.status==='interrupted';
                      const isBrowse=p.status==='browsed';
                      const isOverdue=p.overdue&&p.status==='none';
                      const nameCol=isDone?'#22c55e':isInt||isBrowse?'#f59e0b':isOverdue?'#f97316':'#ef4444';
                      const bg=isDone?'rgba(34,197,94,0.06)':isInt||isBrowse?'rgba(245,158,11,0.06)':isOverdue?'rgba(249,115,22,0.07)':'rgba(239,68,68,0.05)';
                      const border=isDone?'rgba(34,197,94,0.18)':isInt||isBrowse?'rgba(245,158,11,0.2)':isOverdue?'rgba(249,115,22,0.25)':'rgba(239,68,68,0.12)';
                      const clickable=isDone||isInt||isBrowse||isOverdue;
                      return(
                        <div key={ni} onClick={()=>{
                          if(isDone) setResetModal({staff_id:p.staff_id,name:p.name,score:p.score,completed_at:p.completed_at,isDone:true});
                          else if(isInt||isBrowse) setResetModal({staff_id:p.staff_id,name:p.name});
                          else if(isOverdue) setMakeupModal({staff_id:p.staff_id,name:p.name});
                        }}
                          style={{display:'flex',flexDirection:'column',gap:1,padding:'5px 7px',background:bg,border:`1px solid ${border}`,borderRadius:6,minWidth:0,cursor:clickable?'pointer':'default'}}>
                          <div style={{fontSize:11,color:nameCol,fontWeight:700,lineHeight:1.3,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.name}</div>
                          <div style={{fontSize:8,color:'#64748b',lineHeight:1.2}}>
                            {isDone?`${p.score??'—'}分 ›`:isInt?'中断 ›':isBrowse?'浏览 ›':isOverdue?'逾期 ›':'未答'}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{display:'flex',gap:10,marginTop:8,fontSize:9,color:'#475569',flexWrap:'wrap'}}>
                    <span style={{color:'#22c55e'}}>● 已完成</span>
                    <span style={{color:'#f59e0b'}}>● 中断/浏览（可点击重置）</span>
                    <span style={{color:'#ef4444'}}>● 未答题</span>
                    <span style={{color:'#f97316'}}>● 逾期（可点击补答）</span>
                  </div>
                  {sorted.length>12&&(
                    <div onClick={()=>setStaffListCollapsed(c=>!c)} style={{display:'flex',alignItems:'center',justifyContent:'center',gap:6,marginTop:8,padding:'7px 0',cursor:'pointer',borderTop:'1px solid rgba(27,50,85,0.4)',color:'#60a5fa',fontSize:12,fontWeight:600}}>
                      <span style={{display:'inline-block',transform:staffListCollapsed?'none':'rotate(180deg)',transition:'transform 0.2s',fontSize:14}}>⌄</span>
                      {staffListCollapsed?`展开全部 (共 ${sorted.length} 人)`:'收起'}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {/* ── 重置答题机会弹窗 ── */}
          {resetModal&&<AppModal
            icon="🔄"
            title={`重置：${resetModal.name}`}
            body={`确认重置本套班答题记录？\n重置后该人员可在本套班内重新答题。`}
            buttons={[
              {label:'取消',onClick:()=>setResetModal(null)},
              {label:'确认重置',danger:true,onClick:async()=>{
                const r=await apiJson(`/api/admin/sessions/reset-cycle/${resetModal.staff_id}`,{method:'DELETE',headers:hdrs()}).catch(()=>null);
                setResetModal(null);
                if(r?.ok){
                  apiJson('/api/admin/overview',{headers:hdrs()}).then(setOverview).catch(()=>{});
                  const ep=lbMode==='alltime'?'/api/admin/leaderboard/alltime':'/api/admin/leaderboard/cycle';
                  apiJson(ep,{headers:hdrs()}).then(d=>setLbSessions(d.rows||d||[])).catch(()=>{});
                } else alert('重置失败');
              }}
            ]}
          />}

          {/* ── 补答授权弹窗 ── */}
          {makeupModal&&<AppModal
            icon="⏰"
            title={`补答授权：${makeupModal.name}`}
            body={`授权后该人员可在 30 分钟内完成本套班补答。\n逾期未答将不再计入本轮成绩。`}
            buttons={[
              {label:'取消',onClick:()=>setMakeupModal(null)},
              {label:'授权补答',primary:true,onClick:async()=>{
                const r=await apiJson('/api/admin/makeup/grant',{method:'POST',headers:hdrs(),body:JSON.stringify({staffId:makeupModal.staff_id})}).catch(()=>null);
                setMakeupModal(null);
                if(r?.ok){ alert(`已授权 ${makeupModal.name} 补答，有效至 ${r.expiresAt.slice(11,16)}`); }
                else alert('授权失败，请重试');
              }}
            ]}
          />}

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
            const shownHighError=highErrorCollapsed?highError.slice(0,3):highError;
            return(
              <div className="card" style={{borderColor:'rgba(239,68,68,0.3)'}}>
                <div onClick={()=>setHighErrorCollapsed(c=>!c)} style={{display:'flex',alignItems:'center',justifyContent:'space-between',cursor:'pointer',marginBottom:highErrorCollapsed?8:14}}>
                  <div style={{fontSize:10,color:'#ef4444',letterSpacing:2,fontWeight:600,textTransform:'uppercase'}}>本期高错误率题目{highError.length>0?` (${highError.length})`:''}</div>
                  <span style={{fontSize:15,color:'#ef4444',display:'inline-block',transform:highErrorCollapsed?'none':'rotate(180deg)',transition:'transform 0.2s'}}>⌄</span>
                </div>
                {highErrorCollapsed&&highError.length>0&&(
                  <div style={{display:'flex',flexDirection:'column',gap:5}}>
                    {highError.slice(0,3).map((q,qi)=>(
                      <div key={qi} style={{display:'flex',alignItems:'center',gap:8}}>
                        <div style={{flex:1,fontSize:11,color:'rgba(255,255,255,0.75)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{q.question_text.length>28?q.question_text.slice(0,28)+'…':q.question_text}</div>
                        <span style={{fontSize:12,fontWeight:700,color:q.error_rate>=70?'#ef4444':'#f59e0b',flexShrink:0}}>{q.error_rate}%</span>
                      </div>
                    ))}
                    {highError.length>3&&<div style={{fontSize:10,color:'#475569',marginTop:2}}>还有 {highError.length-3} 道 · 点击展开</div>}
                  </div>
                )}
                {highErrorCollapsed&&highError.length===0&&<div style={{fontSize:12,color:'#22c55e'}}>✓ 暂无高错误率题目</div>}
                {!highErrorCollapsed&&<>
                {highError.length===0&&<div style={{fontSize:12,color:'#22c55e',marginBottom:8}}>✓ 暂无错误率 ≥40% 的题目</div>}
                {shownHighError.map((q,qi)=>renderQ(q,qi,shownHighError))}
                {highError.length>3&&(
                  <div onClick={e=>{e.stopPropagation();setHighErrorCollapsed(false);}} style={{textAlign:'center',color:'#60a5fa',fontSize:11,marginTop:8,cursor:'pointer'}}>{highErrorCollapsed?`展开全部 ${highError.length} 道`:'收起'}</div>
                )}
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
                </>}
              </div>
            );
          })()}

          {/* ── 本月培训完成情况（全员按小组） ── */}
          {monthMemberCompletion&&(()=>{
            const allGroups=monthMemberCompletion.groups||[];
            const fixedMembers=monthMemberCompletion.fixed||[];
            // 汇总：所有人的 done/total
            const allMembers=[...allGroups.flatMap(g=>g.members),...fixedMembers];
            const totalPeople=allMembers.length;
            const donePeople=allMembers.filter(m=>m.total>0&&m.done>=m.total).length;
            const pct=Math.round((donePeople/Math.max(totalPeople,1))*100);
            return(
              <div className="card" style={{padding:0,overflow:'hidden'}}>
                <div style={{padding:'14px 16px 10px'}}>
                  <div style={{fontSize:10,color:'#64748b',letterSpacing:2,fontWeight:600,marginBottom:10,textTransform:'uppercase'}}>本月培训完成情况</div>
                  <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:10}}>
                    <div style={{flex:1}}>
                      <div style={{fontSize:30,fontWeight:900,color:'white',lineHeight:1}}>{donePeople}<span style={{fontSize:12,color:'#64748b',fontWeight:400,marginLeft:5}}>/ {totalPeople} 人</span></div>
                      {donePeople<totalPeople
                        ? <div style={{fontSize:11,color:'#f59e0b',marginTop:4}}>还差 {totalPeople-donePeople} 人未完成评价</div>
                        : <div style={{fontSize:11,color:'#22c55e',marginTop:4}}>全员已完成评价 ✓</div>}
                    </div>
                    <ScoreRing score={pct} size={62}/>
                  </div>
                  <div style={{height:5,background:'#1e293b',borderRadius:3,overflow:'hidden'}}>
                    <div style={{height:'100%',width:`${pct}%`,background:'linear-gradient(90deg,#3b82f6,#22c55e)',borderRadius:3,transition:'width 0.8s ease'}}/>
                  </div>
                </div>
                <div style={{borderTop:'1px solid #1b3255',padding:'10px 12px 12px'}}>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:8}}>
                    {allGroups.map(g=>(
                      <div key={g.id} style={{background:'rgba(15,33,56,0.6)',border:'1px solid #1b3255',borderRadius:8,padding:'8px 10px'}}>
                        <div style={{fontSize:10,color:'#60a5fa',fontWeight:700,marginBottom:6,letterSpacing:0.5}}>{g.name}{g.instructor_name?<span style={{color:'#64748b',fontWeight:400,marginLeft:4}}>· {g.instructor_name}</span>:null}</div>
                        <div style={{display:'flex',flexDirection:'column',gap:4}}>
                          {g.members.map(m=>{
                            const isDone=m.total>0&&m.done>=m.total;
                            const isNone=m.total===0;
                            const scoreCol=isDone?'#22c55e':isNone?'#475569':'#f59e0b';
                            const openMemberModal=()=>{
                              const monthItems=monthMemberCompletion?.monthItems||[];
                              const itemStatuses=monthItems.map(it=>{
                                const coveringPlan=(monthPlanCompletion||[]).find(p=>{
                                  const ci=p.completed_items||[];
                                  return ci.includes(it.item)&&p.members?.some(x=>x.id===m.id&&x.evaluated);
                                });
                                if(coveringPlan){const mem=coveringPlan.members.find(x=>x.id===m.id);return{item:it.item,trainType:it.trainType,done:true,shift_date:coveringPlan.shift_date,comment:mem?.comment||''};}
                                return{item:it.item,trainType:it.trainType,done:false};
                              });
                              setMemberEvalModal({id:m.id,name:m.name,itemStatuses});
                            };
                            return(
                              <div key={m.id} onClick={openMemberModal} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:4,cursor:'pointer',borderRadius:4,padding:'1px 2px',margin:'-1px -2px'}}>
                                <span style={{fontSize:11,color:isDone?'#94a3b8':'#cbd5e1',fontWeight:isDone?400:500,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{m.name}</span>
                                <span style={{fontSize:10,color:scoreCol,fontWeight:700,flexShrink:0}}>
                                  {isNone?'—':`${m.done}/${m.total}`}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                  {fixedMembers.length>0&&(
                    <div style={{marginTop:8,background:'rgba(15,33,56,0.6)',border:'1px solid rgba(196,181,253,0.2)',borderRadius:8,padding:'8px 10px'}}>
                      <div style={{fontSize:10,color:'#c4b5fd',fontWeight:700,marginBottom:6,letterSpacing:0.5}}>固定成员</div>
                      <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
                        {fixedMembers.map(m=>{
                          const isDone=m.total>0&&m.done>=m.total;
                          const isNone=m.total===0;
                          const scoreCol=isDone?'#22c55e':isNone?'#475569':'#f59e0b';
                          const openMemberModal=()=>{
                            const monthItems=monthMemberCompletion?.monthItems||[];
                            const itemStatuses=monthItems.map(it=>{
                              const coveringPlan=(monthPlanCompletion||[]).find(p=>{
                                const ci=p.completed_items||[];
                                return ci.includes(it.item)&&p.members?.some(x=>x.id===m.id&&x.evaluated);
                              });
                              if(coveringPlan){const mem=coveringPlan.members.find(x=>x.id===m.id);return{item:it.item,trainType:it.trainType,done:true,shift_date:coveringPlan.shift_date,comment:mem?.comment||''};}
                              return{item:it.item,trainType:it.trainType,done:false};
                            });
                            setMemberEvalModal({id:m.id,name:m.name,itemStatuses});
                          };
                          return(
                            <div key={m.id} onClick={openMemberModal} style={{display:'flex',alignItems:'center',gap:4,cursor:'pointer'}}>
                              <span style={{fontSize:11,color:'#cbd5e1'}}>{m.name}</span>
                              <span style={{fontSize:10,color:scoreCol,fontWeight:700}}>{isNone?'—':`${m.done}/${m.total}`}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <div style={{display:'flex',gap:10,marginTop:8,fontSize:9,color:'#475569',flexWrap:'wrap'}}>
                    <span style={{color:'#22c55e'}}>● 已完成</span>
                    <span style={{color:'#f59e0b'}}>● 待完成</span>
                    <span style={{color:'#475569'}}>● 本月无安排</span>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ── 成员培训评价详情弹窗 ── */}
          {memberEvalModal&&(
            <div onClick={()=>setMemberEvalModal(null)} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',zIndex:200,display:'flex',alignItems:'flex-end',justifyContent:'center'}}>
              <div onClick={e=>e.stopPropagation()} style={{width:'100%',maxWidth:440,background:'#0d1e35',border:'1px solid rgba(59,130,246,0.3)',borderRadius:'16px 16px 0 0',padding:'20px 16px 32px',maxHeight:'70vh',overflowY:'auto'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
                  <div>
                    <div style={{fontWeight:700,fontSize:15,color:'white'}}>{memberEvalModal.name}</div>
                    <div style={{fontSize:12,color:'#64748b',marginTop:2}}>本月培训项点完成情况</div>
                  </div>
                  <button onClick={()=>setMemberEvalModal(null)} style={{background:'none',border:'none',color:'#64748b',fontSize:22,cursor:'pointer',lineHeight:1}}>×</button>
                </div>
                {(()=>{
                  const items=memberEvalModal.itemStatuses||[];
                  if(items.length===0) return <div style={{color:'#475569',fontSize:13,textAlign:'center',padding:'20px 0'}}>本月暂无培训项点</div>;
                  const doneCount=items.filter(it=>it.done).length;
                  return(
                    <div style={{display:'flex',flexDirection:'column',gap:6}}>
                      <div style={{fontSize:11,color:'#64748b',marginBottom:4}}>{doneCount}/{items.length} 项已完成</div>
                      {items.map((it,i)=>{
                        const mm_dd = it.done && it.shift_date ? (()=>{const[,mm,dd]=it.shift_date.split('-');return`${parseInt(mm)}/${parseInt(dd)}`;})() : null;
                        return(
                          <div key={i} style={{padding:'10px 12px',background:it.done?'rgba(34,197,94,0.06)':'rgba(239,68,68,0.04)',border:`1px solid ${it.done?'rgba(34,197,94,0.2)':'rgba(239,68,68,0.15)'}`,borderRadius:8}}>
                            <div style={{display:'flex',alignItems:'center',gap:8}}>
                              <span style={{fontSize:13,flexShrink:0}}>{it.done?'✅':'❌'}</span>
                              <span style={{flex:1,fontSize:12,color:it.done?'#e2e8f0':'#ef4444',fontWeight:it.done?500:600}}>{it.item}</span>
                              <span style={{fontSize:10,color:'#475569',flexShrink:0}}>{it.trainType}</span>
                              {mm_dd&&<span style={{fontSize:10,color:'#64748b',flexShrink:0}}>（{mm_dd}）</span>}
                            </div>
                            {it.done&&it.comment&&(
                              <div style={{marginTop:5,fontSize:11,color:'#94a3b8',lineHeight:1.6,borderLeft:'2px solid rgba(34,197,94,0.35)',paddingLeft:8}}>评价：{it.comment}</div>
                            )}
                            {it.done&&!it.comment&&(
                              <div style={{marginTop:3,fontSize:10,color:'#475569',paddingLeft:10}}>（无评语）</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* ── 本月项点详情弹窗 ── */}
          {planDetailModal&&(
            <div onClick={()=>setPlanDetailModal(null)} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',zIndex:200,display:'flex',alignItems:'flex-end',justifyContent:'center'}}>
              <div onClick={e=>e.stopPropagation()} style={{width:'100%',maxWidth:440,background:'#0d1e35',border:'1px solid rgba(59,130,246,0.3)',borderRadius:'16px 16px 0 0',padding:'20px 16px 32px',maxHeight:'70vh',overflowY:'auto'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
                  <div>
                    <div style={{fontWeight:700,fontSize:15,color:'white'}}>{(()=>{const[,m,d]=planDetailModal.shift_date.split('-');return`${parseInt(m)}月${parseInt(d)}日`;})()}</div>
                    <div style={{fontSize:12,color:'#64748b',marginTop:2}}>{planDetailModal.group_name} · {planDetailModal.plan_type==='培训'?'实操培训':planDetailModal.plan_type}</div>
                  </div>
                  <button onClick={()=>setPlanDetailModal(null)} style={{background:'none',border:'none',color:'#64748b',fontSize:22,cursor:'pointer',lineHeight:1}}>×</button>
                </div>
                <div style={{display:'flex',flexDirection:'column',gap:6}}>
                  {planDetailModal.members.length===0
                    ? <div style={{color:'#475569',fontSize:13,textAlign:'center',padding:'20px 0'}}>暂无成员数据</div>
                    : planDetailModal.members.map((m,i)=>(
                      <div key={i} style={{padding:'8px 12px',background:m.evaluated?'rgba(34,197,94,0.06)':'rgba(239,68,68,0.05)',border:`1px solid ${m.evaluated?'rgba(34,197,94,0.18)':'rgba(239,68,68,0.12)'}`,borderRadius:8}}>
                        <div style={{display:'flex',alignItems:'center',gap:10}}>
                          <div style={{width:8,height:8,borderRadius:'50%',background:m.evaluated?'#22c55e':'#ef4444',flexShrink:0}}/>
                          <div style={{flex:1,fontSize:13,color:'white',fontWeight:600}}>{m.name}</div>
                          <div style={{fontSize:11,color:m.evaluated?'#22c55e':'#ef4444'}}>{m.evaluated?'已评价':'未评价'}</div>
                        </div>
                        {m.evaluated&&m.comment&&(
                          <div style={{marginTop:5,marginLeft:18,fontSize:11,color:'#94a3b8',lineHeight:1.5,borderLeft:'2px solid rgba(34,197,94,0.3)',paddingLeft:8}}>{m.comment}</div>
                        )}
                      </div>
                    ))
                  }
                </div>
              </div>
            </div>
          )}

          {/* ── 班组各类题均分 ── */}
          <div className="card">
            <div style={{fontSize:10,color:'#64748b',letterSpacing:2,fontWeight:600,marginBottom:10,textTransform:'uppercase'}}>班组各类题均分</div>
            {overview.catAvg?.map((c,i)=><MiniBar key={i} label={c.category} value={c.avg}/>)}
          </div>

          {/* ── 管理员详情 modal（底部弹出） ── */}
          {adminDrillModal&&(
            <div onClick={()=>setAdminDrillModal(null)} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',zIndex:200,display:'flex',alignItems:'flex-end',justifyContent:'center'}}>
              <div onClick={e=>e.stopPropagation()} style={{width:'100%',maxWidth:440,background:'#0d1e35',border:'1px solid rgba(59,130,246,0.3)',borderRadius:'16px 16px 0 0',padding:'20px 16px 32px',maxHeight:'75vh',overflowY:'auto'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:14}}>
                  <div style={{display:'flex',gap:10,alignItems:'flex-start'}}>
                    <div style={{width:44,height:44,borderRadius:'50%',background:'linear-gradient(135deg,#1e3a5f,#3b82f6)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,fontWeight:700,color:'white',flexShrink:0}}>{adminDrillModal.staffName?.[0]}</div>
                    <div>
                      <div style={{fontSize:15,fontWeight:700,color:'white'}}>{adminDrillModal.staffName}</div>
                      <div style={{fontSize:10,color:'#64748b',marginTop:2}}>{adminDrillModal.mode==='cycle'?'本轮答题记录':'本月套班汇总'}</div>
                    </div>
                  </div>
                  <button onClick={()=>setAdminDrillModal(null)} style={{background:'none',border:'1px solid #1b3255',color:'#64748b',borderRadius:6,padding:'4px 10px',cursor:'pointer',fontSize:12,flexShrink:0}}>关闭</button>
                </div>
                {adminDrillModal.loading&&<div style={{textAlign:'center',padding:'20px 0'}}><div className="spinner" style={{margin:'0 auto'}}/></div>}
                {/* cycle mode: show sessions */}
                {!adminDrillModal.loading&&adminDrillModal.mode==='cycle'&&(<>
                  {adminDrillModal.sessions?.length===0&&<div style={{color:'#475569',fontSize:13,textAlign:'center',padding:'20px 0'}}>暂无答题记录</div>}
                  {adminDrillModal.sessions?.map((s,si)=>(
                    <div key={si} style={{marginBottom:12,background:'rgba(15,38,66,0.6)',border:'1px solid #1b3255',borderRadius:10,padding:'12px 14px'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                        <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                          <span style={{fontSize:11,color:'#64748b'}}>{s.created_at?.slice(5,10)}{s.created_at?.length>=16?` ${s.created_at.slice(11,16)}`:''}{s.cycle_label?` · ${s.cycle_label}`:''}</span>
                          {s.tab_switch_count>0&&<span style={{fontSize:10,color:'#ef4444',background:'rgba(239,68,68,0.12)',border:'1px solid rgba(239,68,68,0.3)',borderRadius:4,padding:'0 5px',fontWeight:700}}>切屏×{s.tab_switch_count}</span>}
                        </div>
                        <div style={{display:'flex',gap:8,alignItems:'center'}}>
                          <span style={{fontSize:12,fontWeight:700,color:'white'}}>{Math.round(s.total_score)}分</span>
                          <button onClick={async()=>{if(!window.confirm(`确认删除这条成绩？`))return;const r=await apiJson(`/api/admin/sessions/staff/${adminDrillModal.staffId}?cycle_id=${overview.cycle?.id}`,{method:'DELETE',headers:hdrs()}).catch(()=>null);if(r?.ok){apiJson('/api/admin/leaderboard/cycle',{headers:hdrs()}).then(d=>setLbSessions(d.rows||[])).catch(()=>{});setAdminDrillModal(null);}}} style={{fontSize:9,padding:'2px 6px',borderRadius:4,border:'1px solid rgba(239,68,68,0.3)',background:'none',color:'#ef4444',cursor:'pointer'}}>删除</button>
                        </div>
                      </div>
                      {s.answers?.map((a,ai)=>(
                        <div key={ai} style={{padding:'6px 0',borderTop:'1px solid rgba(27,50,85,0.5)',display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
                          <span style={{fontSize:11,color:'rgba(255,255,255,0.7)',flex:1,lineHeight:1.5}}>{a.question_text}</span>
                          <span style={{fontSize:12,fontWeight:700,flexShrink:0,color:a.score>=99?'#22c55e':a.score>=67?'#f59e0b':'#ef4444'}}>{Math.round(a.score/(s.answers.length||3))}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </>)}
                {/* alltime mode: cycles list, click to expand questions */}
                {!adminDrillModal.loading&&adminDrillModal.mode==='alltime'&&(<>
                  {adminDrillModal.cycles?.length===0&&<div style={{color:'#475569',fontSize:13,textAlign:'center',padding:'20px 0'}}>暂无记录</div>}
                  {adminDrillModal.cycles?.map((cy,ci)=>{
                    const cyExp=adminDrillModal.expandedCycleId===cy.cycle_id;
                    return(
                      <div key={ci} style={{marginBottom:10,background:'rgba(15,38,66,0.6)',border:'1px solid #1b3255',borderRadius:10,overflow:'hidden'}}>
                        <div onClick={()=>setAdminDrillModal(m=>({...m,expandedCycleId:cyExp?null:cy.cycle_id}))} style={{display:'flex',alignItems:'center',gap:10,padding:'12px 14px',cursor:'pointer'}}>
                          <div style={{flex:1}}>
                            <div style={{fontSize:13,fontWeight:600,color:'white'}}>{cy.cycle_label||cy.cycle_id||'—'}</div>
                            <div style={{fontSize:9,color:'#64748b',marginTop:2}}>{cy.sessions_count}次答题</div>
                          </div>
                          <span style={{fontSize:13,fontWeight:700,color:'#c8a84b'}}>{cy.total_points}分</span>
                          <span style={{fontSize:15,color:'#60a5fa',display:'inline-block',transform:cyExp?'rotate(180deg)':'none',transition:'transform 0.2s'}}>⌄</span>
                        </div>
                        {cyExp&&cy.sessions?.map((s,si)=>(
                          <div key={si} style={{borderTop:'1px solid rgba(27,50,85,0.4)',padding:'10px 14px',background:'rgba(7,20,40,0.4)'}}>
                            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                              <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                                <span style={{fontSize:10,color:'#64748b'}}>{s.created_at?.slice(5,10)}{s.created_at?.length>=16?` ${s.created_at.slice(11,16)}`:''}</span>
                                {s.tab_switch_count>0&&<span style={{fontSize:10,color:'#ef4444',background:'rgba(239,68,68,0.12)',border:'1px solid rgba(239,68,68,0.3)',borderRadius:4,padding:'0 5px',fontWeight:700}}>切屏×{s.tab_switch_count}</span>}
                              </div>
                              <div style={{display:'flex',gap:6,alignItems:'center'}}>
                                <span style={{fontSize:11,fontWeight:700,color:'white'}}>{Math.round(s.total_score)}分</span>
                              </div>
                            </div>
                            {s.answers?.map((a,ai)=>(
                              <div key={ai} style={{padding:'5px 0',borderTop:'1px solid rgba(27,50,85,0.4)',display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
                                <span style={{fontSize:10,color:'rgba(255,255,255,0.6)',flex:1,lineHeight:1.5}}>{a.question_text}</span>
                                <span style={{fontSize:11,fontWeight:700,flexShrink:0,color:a.score>=99?'#22c55e':a.score>=67?'#f59e0b':'#ef4444'}}>{Math.round(a.score/(s.answers.length||3))}</span>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </>)}
              </div>
            </div>
          )}

          {/* ── 积分榜（双列） ── */}
          {(()=>{
            const AdminLbCol = ({title, rows, mode, collapsed, setCollapsed})=>{
              const shown = collapsed ? rows.slice(0,3) : rows;
              const badges = r => (<>
                {r.is_leader?<span style={{fontSize:8,padding:'1px 4px',borderRadius:6,background:'rgba(234,179,8,0.15)',border:'1px solid rgba(234,179,8,0.4)',color:'#fbbf24',flexShrink:0}}>组长</span>:null}
                {r.is_exempt&&!r.is_leader?<span style={{fontSize:8,padding:'1px 4px',borderRadius:6,background:'rgba(245,158,11,0.15)',border:'1px solid rgba(245,158,11,0.4)',color:'#f59e0b',flexShrink:0}}>免答</span>:null}
                {r.is_instructor?<span style={{fontSize:8,padding:'1px 4px',borderRadius:6,background:'rgba(99,102,241,0.15)',border:'1px solid rgba(99,102,241,0.4)',color:'#a5b4fc',flexShrink:0}}>教员</span>:null}
              </>);
              return (
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:10,color:'#64748b',fontWeight:600,letterSpacing:1,marginBottom:8}}>{title}</div>
                  {shown.map((r,i)=>{
                    const pts=r.total_points??0;
                    return(
                      <div key={r.staff_id} onClick={async()=>{
                        setAdminDrillModal({staffId:r.staff_id,staffName:r.staff_name,mode,loading:true,sessions:null,cycles:null,expandedCycleId:null});
                        if(mode==='cycle'){
                          const d=await apiJson(`/api/leaderboard/cycle/member/${r.staff_id}`).catch(()=>null);
                          setAdminDrillModal(m=>({...m,loading:false,sessions:d?.sessions||[]}));
                        } else {
                          const d=await apiJson(`/api/admin/leaderboard/alltime/cycles/${r.staff_id}`,{headers:hdrs()}).catch(()=>null);
                          setAdminDrillModal(m=>({...m,loading:false,cycles:d?.cycles||[]}));
                        }
                      }} style={{display:'flex',alignItems:'center',gap:5,padding:'5px 0',borderBottom:i<shown.length-1?'1px solid rgba(27,50,85,0.5)':'none',cursor:'pointer'}}>
                        <span style={{fontSize:i<3?12:10,width:16,textAlign:'center',flexShrink:0,color:['#ffd700','#b0b8c8','#cd7f32'][i]||'var(--muted)'}}>
                          {['🥇','🥈','🥉'][i]||(i+1)}
                        </span>
                        <span style={{flex:1,fontSize:11,color:'var(--text)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.staff_name}</span>
                        <div style={{display:'flex',gap:2,alignItems:'center',flexShrink:0}}>{badges(r)}</div>
                        <span style={{fontWeight:700,color:'var(--gold)',fontSize:11,flexShrink:0,marginLeft:2}}>{pts}</span>
                      </div>
                    );
                  })}
                  {rows.length>3&&(
                    <div onClick={()=>setCollapsed(c=>!c)} style={{textAlign:'center',marginTop:6,fontSize:11,color:'#60a5fa',cursor:'pointer',fontWeight:600}}>
                      {collapsed?`全部 ${rows.length} 人 ▼`:'收起 ▲'}
                    </div>
                  )}
                </div>
              );
            };
            return (
              <div className="card">
                <div style={{fontSize:10,color:'#64748b',letterSpacing:2,fontWeight:600,marginBottom:12}}>积分榜</div>
                <div style={{display:'flex',gap:12}}>
                  <AdminLbCol title="本轮" rows={lbSessions} mode="cycle" collapsed={lbCollapsed} setCollapsed={setLbCollapsed}/>
                  <div style={{width:1,background:'rgba(27,50,85,0.6)'}}/>
                  <AdminLbCol title="本月" rows={lbSessionsAlltime} mode="alltime" collapsed={lbCollapsed} setCollapsed={setLbCollapsed}/>
                </div>
              </div>
            );
          })()}

          {/* ── 导出记录 ── */}
          <button onClick={()=>{
            setShowExportMenu('open');
            if(!exportMonths.length) apiJson('/api/export/months',{headers:hdrs()}).then(setExportMonths).catch(()=>{});
          }} className="btn-primary" style={{width:'100%',textAlign:'center',padding:'13px',border:'none',cursor:'pointer'}}>📊 导出记录</button>

          {/* 导出弹窗 */}
          {showExportMenu==='open'&&(
            <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',zIndex:200,display:'flex',alignItems:'flex-end',justifyContent:'center'}} onClick={()=>{setShowExportMenu(null);setExportWsModal(null);}}>
              <div style={{background:'#0a1929',borderRadius:'14px 14px 0 0',width:'100%',maxWidth:480,maxHeight:'80vh',display:'flex',flexDirection:'column'}} onClick={e=>e.stopPropagation()}>
                {/* 顶栏 */}
                <div style={{padding:'14px 16px 10px',borderBottom:'1px solid #1b3255',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
                  <span style={{fontWeight:700,color:'#e2e8f0',fontSize:15}}>📊 导出记录</span>
                  <button onClick={()=>{setShowExportMenu(null);setExportWsModal(null);}} style={{background:'none',border:'none',color:'#475569',fontSize:22,cursor:'pointer',padding:0,lineHeight:1}}>×</button>
                </div>
                {/* 二级选择 */}
                {!exportWsModal&&(
                  <div style={{padding:'12px 16px',display:'flex',flexDirection:'column',gap:10}}>
                    {/* 抽问记录 */}
                    <div>
                      <div style={{fontSize:11,color:'#64748b',fontWeight:600,letterSpacing:1,marginBottom:6}}>📋 抽问记录</div>
                      <div style={{background:'#0d1e35',border:'1px solid rgba(59,130,246,0.25)',borderRadius:8,overflow:'hidden'}}>
                        {exportMonths.length===0&&<div style={{padding:'12px 14px',fontSize:12,color:'#475569'}}>暂无数据</div>}
                        {exportMonths.map(m=>(
                          <a key={m} href={`/api/export?password=${pwd}&month=${m}`} target="_blank" style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'11px 14px',fontSize:13,color:'white',textDecoration:'none',borderTop:'1px solid rgba(27,50,85,0.5)'}}
                            onMouseEnter={e=>e.currentTarget.style.background='rgba(59,130,246,0.1)'}
                            onMouseLeave={e=>e.currentTarget.style.background='none'}>
                            <span>{m}</span><span style={{fontSize:11,color:'#475569'}}>↓ Excel</span>
                          </a>
                        ))}
                      </div>
                    </div>
                    {/* 月度任务 */}
                    <div>
                      <div style={{fontSize:11,color:'#64748b',fontWeight:600,letterSpacing:1,marginBottom:6}}>🏭 月度任务</div>
                      <button onClick={async()=>{
                        setExportWsModal({plans:[],months:[],activeMonth:'',selected:new Set(),showMonthPicker:false,loading:true});
                        const plans=await apiJson('/api/export/workshop/plans',{headers:hdrs()}).catch(()=>[]);
                        const allPlans=Array.isArray(plans)?plans:[];
                        const months=[...new Set(allPlans.map(p=>p.year_month))].sort((a,b)=>b.localeCompare(a));
                        const curMonth=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}).slice(0,7);
                        const active=months.includes(curMonth)?curMonth:(months[0]||curMonth);
                        const mp=allPlans.filter(p=>p.year_month===active);
                        setExportWsModal({plans:allPlans,months,activeMonth:active,selected:new Set(mp.map(p=>p.id)),showMonthPicker:false,loading:false});
                      }} style={{width:'100%',padding:'11px',borderRadius:8,border:'1px solid rgba(34,197,94,0.3)',background:'rgba(34,197,94,0.06)',color:'#4ade80',cursor:'pointer',fontSize:13,fontWeight:600,fontFamily:'inherit'}}>
                        选择月份并导出 →
                      </button>
                    </div>
                  </div>
                )}
                {/* 月度任务勾选面板 */}
                {exportWsModal&&(()=>{
                  const {plans,months,activeMonth,selected:sel,showMonthPicker,loading}=exportWsModal;
                  const monthPlans=plans.filter(p=>p.year_month===activeMonth);
                  const allSel=monthPlans.length>0&&monthPlans.every(p=>sel.has(p.id));
                  const switchMonth=m=>{const mp=plans.filter(p=>p.year_month===m);setExportWsModal(prev=>({...prev,activeMonth:m,selected:new Set(mp.map(p=>p.id)),showMonthPicker:false}));};
                  const toggleAll=()=>{const next=new Set(sel);if(allSel)monthPlans.forEach(p=>next.delete(p.id));else monthPlans.forEach(p=>next.add(p.id));setExportWsModal(prev=>({...prev,selected:next}));};
                  const toggleOne=id=>{const next=new Set(sel);next.has(id)?next.delete(id):next.add(id);setExportWsModal(prev=>({...prev,selected:next}));};
                  const doExport=()=>{if(!sel.size)return;const ids=[...sel].join(',');window.open(`/api/export/workshop?password=${encodeURIComponent(pwd)}&ids=${ids}`,'_blank');};
                  const typeColor=t=>t==='中旬会'?'#f59e0b':t==='理论'?'#38bdf8':'#34d399';
                  return (<>
                    <div style={{padding:'8px 14px',borderBottom:'1px solid #1b3255',display:'flex',alignItems:'center',gap:6,flexShrink:0}}>
                      <button onClick={()=>setExportWsModal(null)} style={{background:'none',border:'none',color:'#60a5fa',fontSize:13,cursor:'pointer',padding:0,marginRight:4}}>← 返回</button>
                      <div style={{position:'relative',flex:1}}>
                        <button onClick={()=>setExportWsModal(prev=>({...prev,showMonthPicker:!prev.showMonthPicker}))} style={{padding:'5px 10px',borderRadius:5,border:`1px solid ${showMonthPicker?'#3b82f6':'#1b3255'}`,background:'transparent',color:'#e2e8f0',cursor:'pointer',fontSize:12,fontFamily:'inherit'}}>
                          {activeMonth||'…'} ▾
                        </button>
                        {showMonthPicker&&(
                          <div style={{position:'absolute',top:'calc(100% + 4px)',left:0,background:'#0a1929',border:'1px solid rgba(59,130,246,0.4)',borderRadius:7,overflow:'hidden',zIndex:20,boxShadow:'0 4px 20px rgba(0,0,0,0.6)',minWidth:110}}>
                            {months.map(m=><div key={m} onClick={()=>switchMonth(m)} style={{padding:'8px 12px',fontSize:12,color:m===activeMonth?'#60a5fa':'#e2e8f0',background:m===activeMonth?'rgba(59,130,246,0.1)':'transparent',cursor:'pointer',borderTop:'1px solid rgba(27,50,85,0.4)'}}>{m}</div>)}
                          </div>
                        )}
                      </div>
                      <button onClick={toggleAll} style={{padding:'5px 8px',borderRadius:5,border:'1px solid #1b3255',background:'transparent',color:'#64748b',cursor:'pointer',fontSize:11,fontFamily:'inherit'}}>{allSel?'取消全选':'全选'}</button>
                      <button onClick={doExport} disabled={!sel.size} style={{padding:'5px 12px',borderRadius:5,border:'none',background:sel.size?'#22c55e':'#1b3255',color:sel.size?'#022c16':'#475569',cursor:sel.size?'pointer':'default',fontSize:11,fontWeight:600,fontFamily:'inherit'}}>↓ 导出{sel.size?` (${sel.size})`:''}</button>
                    </div>
                    <div style={{flex:1,overflowY:'auto'}}>
                      {loading&&<div style={{textAlign:'center',color:'#475569',padding:'28px 0',fontSize:13}}>加载中…</div>}
                      {!loading&&monthPlans.length===0&&<div style={{textAlign:'center',color:'#475569',padding:'28px 0',fontSize:13}}>该月暂无培训计划</div>}
                      {monthPlans.map(p=>(
                        <div key={p.id} onClick={()=>toggleOne(p.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',borderBottom:'1px solid rgba(27,50,85,0.35)',cursor:'pointer',background:sel.has(p.id)?'rgba(34,197,94,0.05)':'transparent'}}>
                          <div style={{width:16,height:16,borderRadius:3,border:`2px solid ${sel.has(p.id)?'#22c55e':'#334155'}`,background:sel.has(p.id)?'#22c55e':'transparent',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                            {sel.has(p.id)&&<span style={{color:'#022c16',fontSize:10,fontWeight:700,lineHeight:1}}>✓</span>}
                          </div>
                          <span style={{fontSize:12,color:'#94a3b8',width:36,flexShrink:0}}>{p.shift_date?.slice(5)}</span>
                          <span style={{fontSize:10,padding:'1px 5px',borderRadius:3,border:`1px solid ${typeColor(p.plan_type)}55`,color:typeColor(p.plan_type),flexShrink:0}}>{p.plan_type}</span>
                          <span style={{fontSize:12,color:'#cbd5e1',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.group_name||''}{p.instructor_name?` · ${p.instructor_name}`:''}</span>
                        </div>
                      ))}
                    </div>
                  </>);
                })()}
              </div>
            </div>
          )}
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
            const isActive = qPinned.scope !== 'none';
            const needPool = pinMode==='random'&&!pinRandomBankId; // 需要手动勾选题池
            const poolEnough = needPool ? qSelected.length > pinCount : true;
            const bankPoolMode = pinMode==='manual' && checkedBankIds.length > 0; // 勾选整个题库随机
            const manualEnough = pinMode==='manual' ? (bankPoolMode || qSelected.length === pinCount) : true;
            const canSave = pinMode==='emergency' || (pinMode==='random'&&pinRandomBankId) || (pinMode==='random'&&poolEnough) || (pinMode==='manual'&&manualEnough);

            const doSave = async()=>{
              const body = {
                mode: bankPoolMode ? 'random' : pinMode,
                count: pinCount,
                scope: pinScope,
                ids: (!bankPoolMode && (pinMode==='manual'||needPool)) ? qSelected : [],
                bank_id: (pinMode==='random'&&pinRandomBankId&&!bankPoolMode) ? parseInt(pinRandomBankId) : null,
                bank_ids: bankPoolMode ? checkedBankIds : [],
                bank_fallback_id: null,
              };
              const r=await apiJson('/api/admin/pinned-questions',{method:'PUT',headers:hdrs(),body:JSON.stringify(body)}).catch(()=>null);
              if(r?.ok){
                apiJson('/api/admin/pinned-questions',{headers:hdrs()}).then(d=>{setQPinned(d);setPinCount(d.count||3);setPinMode(d.bank_ids?.length>0?'manual':d.mode||'emergency');setPinRandomBankId(d.bank_id||null);setQSelected(d.ids||[]);setCheckedBankIds(d.bank_ids||[]);});
                setQSelectOpen(false);
                setPinSaveModal(false);
                apiJson('/api/admin/dingtalk/notify-start',{method:'POST',headers:hdrs(),body:JSON.stringify({ids:body.ids,mode:body.mode,count:body.count,bank_id:body.bank_id,bank_ids:body.bank_ids,scope:body.scope})}).catch(()=>null);
              } else { alert('设置失败'); }
            };

            return (
              <div className="card">
                <div style={{fontSize:11,color:'#64748b',letterSpacing:1,fontWeight:600,marginBottom:12}}>📌 本套班抽问题目</div>

                {/* 当前生效状态 */}
                {isActive&&!qSelectOpen&&(
                  <div style={{marginBottom:12,padding:'8px 12px',background:'rgba(34,197,94,0.07)',border:'1px solid rgba(34,197,94,0.2)',borderRadius:8,fontSize:11,color:'#86efac'}}>
                    ✅ 当前已设置：{qPinned.mode==='emergency'?'应急随机':qPinned.mode==='random'?'多题随机':'手动选题'} · {qPinned.count||3}题 · {qPinned.scope==='today'?'今天生效':'本套班生效'}
                    <button onClick={async()=>{await apiJson('/api/admin/pinned-questions',{method:'PUT',headers:hdrs(),body:JSON.stringify({ids:[],scope:'none',mode:'emergency',count:3,bank_id:null,bank_ids:[]})}).catch(()=>null);setQPinned({ids:[],scope:'none',mode:'emergency',count:3,bank_id:null,bank_ids:[],questions:[]});setQSelected([]);setPinMode('emergency');setPinCount(3);setPinRandomBankId(null);setCheckedBankIds([]);}} style={{marginLeft:10,background:'none',border:'none',color:'#ef4444',cursor:'pointer',fontSize:11,padding:0}}>取消</button>
                  </div>
                )}

                {/* 第一排：抽问几题 */}
                <div style={{marginBottom:12}}>
                  <div style={{fontSize:11,color:'#94a3b8',fontWeight:600,marginBottom:6}}>抽问几题</div>
                  <div style={{display:'flex',gap:6}}>
                    {[1,2,3,4,5].map(n=>(
                      <button key={n} onClick={()=>{setPinCount(n);setQSelected([]);}} style={{flex:1,padding:'8px 0',borderRadius:7,border:`2px solid ${pinCount===n?'#3b82f6':'#1b3255'}`,background:pinCount===n?'rgba(59,130,246,0.18)':'rgba(13,17,23,0.4)',color:pinCount===n?'#60a5fa':'#64748b',cursor:'pointer',fontSize:14,fontWeight:700}}>{n}</button>
                    ))}
                  </div>
                </div>

                {/* 第二排：模式选择 */}
                <div style={{marginBottom:12}}>
                  <div style={{fontSize:11,color:'#94a3b8',fontWeight:600,marginBottom:6}}>出题方式</div>
                  <div style={{display:'flex',gap:6}}>
                    {[['manual','✏️ 手动选题'],['random','🎲 多题随机'],['emergency','🚨 应急随机']].map(([m,label])=>(
                      <button key={m} onClick={()=>{setPinMode(m);setQSelected([]);if(m!=='manual'&&m!=='random')setQSelectOpen(false);}} style={{flex:1,padding:'9px 4px',borderRadius:8,border:`2px solid ${pinMode===m?'#3b82f6':'#1b3255'}`,background:pinMode===m?'rgba(59,130,246,0.15)':'none',color:pinMode===m?'#60a5fa':'#64748b',cursor:'pointer',fontSize:11,fontWeight:600}}>{label}</button>
                    ))}
                  </div>
                </div>

                {/* 多题随机：选题库或勾选题池 */}
                {pinMode==='random'&&(
                  <div style={{marginBottom:12,padding:'10px 12px',background:'rgba(13,17,23,0.5)',border:'1px solid #1b3255',borderRadius:8}}>
                    <div style={{fontSize:11,color:'#94a3b8',fontWeight:600,marginBottom:8}}>随机来源</div>
                    <div style={{display:'flex',gap:6,marginBottom:8}}>
                      <button onClick={()=>{setPinRandomBankId(null);setQSelectOpen(false);}} style={{flex:1,padding:'7px',borderRadius:6,border:`1px solid ${!pinRandomBankId?'#3b82f6':'#1b3255'}`,background:!pinRandomBankId?'rgba(59,130,246,0.12)':'none',color:!pinRandomBankId?'#60a5fa':'#94a3b8',cursor:'pointer',fontSize:11,fontWeight:600}}>手动勾选题池</button>
                      <button onClick={()=>{setPinRandomBankId('select');setQSelectOpen(false);}} style={{flex:1,padding:'7px',borderRadius:6,border:`1px solid ${pinRandomBankId?'#3b82f6':'#1b3255'}`,background:pinRandomBankId?'rgba(59,130,246,0.12)':'none',color:pinRandomBankId?'#60a5fa':'#94a3b8',cursor:'pointer',fontSize:11,fontWeight:600}}>指定题库随机</button>
                    </div>
                    {pinRandomBankId&&pinRandomBankId!=='select'&&(
                      <div style={{fontSize:11,color:'#60a5fa',marginBottom:4}}>已选：{banks.find(b=>String(b.id)===String(pinRandomBankId))?.name||'—'} <button onClick={()=>setPinRandomBankId('select')} style={{marginLeft:6,background:'none',border:'none',color:'#475569',cursor:'pointer',fontSize:10,padding:0}}>重选</button></div>
                    )}
                    {pinRandomBankId==='select'&&(
                      <div style={{maxHeight:160,overflowY:'auto',display:'flex',flexDirection:'column',gap:3}}>
                        {banks.filter(b=>b.name!=='人工提问').map(b=>(
                          <button key={b.id} onClick={()=>setPinRandomBankId(String(b.id))} style={{textAlign:'left',padding:'6px 10px',borderRadius:6,border:`1px solid ${String(pinRandomBankId)===String(b.id)?'#3b82f6':'#1b3255'}`,background:String(pinRandomBankId)===String(b.id)?'rgba(59,130,246,0.12)':'none',color:'#e2e8f0',cursor:'pointer',fontSize:12}}>{b.name} <span style={{color:'#475569',fontSize:10}}>({b.q_count||0}题)</span></button>
                        ))}
                      </div>
                    )}
                    {!pinRandomBankId&&(
                      <div>
                        <div style={{fontSize:11,color:'#475569',marginBottom:6}}>需勾选 &gt; {pinCount} 题作为题池（当前 {qSelected.length} 题{!poolEnough?<span style={{color:'#ef4444'}}> ⚠️ 不足</span>:null}）</div>
                        <button onClick={()=>{setQSelectOpen(o=>!o);if(qAll.length===0)apiJson('/api/admin/questions/all',{headers:hdrs()}).then(setQAll).catch(()=>{});}} style={{width:'100%',padding:'7px',borderRadius:6,border:'1px dashed rgba(59,130,246,0.4)',background:'rgba(59,130,246,0.06)',color:'#60a5fa',cursor:'pointer',fontSize:11,fontFamily:'inherit'}}>{qSelectOpen?'▲ 收起题库':'▼ 展开题库勾选'}</button>
                      </div>
                    )}
                  </div>
                )}

                {/* 手动选题：显示已选槽位 + 展开题库 */}
                {pinMode==='manual'&&(
                  <div style={{marginBottom:12}}>
                    <div style={{display:'flex',flexDirection:'column',gap:5,marginBottom:8}}>
                      {Array.from({length:pinCount}).map((_,i)=>{
                        const q=qAll.find(x=>x.id===qSelected[i])||qPinned.questions?.find(x=>x.id===qSelected[i]);
                        return(
                          <div key={i} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 10px',borderRadius:7,border:`1px solid ${q?'#1e3a5f':'rgba(27,50,85,0.4)'}`,background:q?'rgba(30,58,95,0.25)':'rgba(13,17,23,0.3)'}}>
                            <span style={{width:18,height:18,borderRadius:'50%',background:q?'#1e3a5f':'#0a1929',border:`1px solid ${q?'#3b82f6':'#1b3255'}`,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,fontSize:10,color:q?'#60a5fa':'#475569',fontWeight:700}}>{i+1}</span>
                            <span style={{flex:1,fontSize:11,color:q?'#e2e8f0':'#475569',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{q?q.text?.slice(0,40)+(q.text?.length>40?'…':''):'未选'}</span>
                            {q&&<button onClick={()=>setQSelected(s=>s.filter((_,idx)=>idx!==i))} style={{background:'none',border:'none',color:'#ef4444',cursor:'pointer',fontSize:13,padding:'0 2px',flexShrink:0}}>×</button>}
                          </div>
                        );
                      })}
                    </div>
                    <button onClick={()=>{setQSelectOpen(o=>!o);if(qAll.length===0)apiJson('/api/admin/questions/all',{headers:hdrs()}).then(setQAll).catch(()=>{});}} style={{width:'100%',padding:'7px',borderRadius:6,border:'1px dashed rgba(59,130,246,0.4)',background:'rgba(59,130,246,0.06)',color:'#60a5fa',cursor:'pointer',fontSize:11,fontFamily:'inherit'}}>{qSelectOpen?'▲ 收起题库':'▼ 展开题库选题'}{!manualEnough?<span style={{color:'#f59e0b',marginLeft:6}}>(还需选 {pinCount-qSelected.length} 题)</span>:null}</button>
                  </div>
                )}

                {/* 题库随机池说明 */}
                {bankPoolMode&&(
                  <div style={{marginBottom:12,padding:'8px 10px',background:'rgba(59,130,246,0.06)',border:'1px solid rgba(59,130,246,0.25)',borderRadius:7,fontSize:11,color:'#93c5fd',lineHeight:1.6}}>
                    🎲 将从已勾选题库中混合随机抽取 {pinCount} 题
                    <div style={{marginTop:4,display:'flex',gap:6,flexWrap:'wrap'}}>
                      {checkedBankIds.map(id=>{const b=banks.find(x=>x.id===id);return b?<span key={id} style={{padding:'1px 7px',borderRadius:10,background:'rgba(59,130,246,0.15)',border:'1px solid rgba(59,130,246,0.3)',color:'#60a5fa',fontSize:10}}>{b.name} ({b.q_count||'?'}题)</span>:null;})}
                    </div>
                  </div>
                )}

                {/* 应急随机说明 */}
                {pinMode==='emergency'&&(
                  <div style={{marginBottom:12,padding:'8px 10px',background:'rgba(239,68,68,0.05)',border:'1px solid rgba(239,68,68,0.15)',borderRadius:7,fontSize:11,color:'#fca5a5'}}>
                    🚨 将从应急故障处置题库中随机抽取 {pinCount} 题
                  </div>
                )}

                {/* 第三排：生效范围 */}
                <div style={{marginBottom:12}}>
                  <div style={{fontSize:11,color:'#94a3b8',fontWeight:600,marginBottom:6}}>生效范围</div>
                  <div style={{display:'flex',gap:8}}>
                    {['today','shift'].map(s=><button key={s} onClick={()=>setPinScope(s)} style={{flex:1,padding:'8px',borderRadius:7,border:`1px solid ${pinScope===s?'#3b82f6':'#1b3255'}`,background:pinScope===s?'rgba(59,130,246,0.15)':'none',color:pinScope===s?'#60a5fa':'#94a3b8',cursor:'pointer',fontSize:12}}>{s==='today'?'今天生效':'本套班生效'}</button>)}
                  </div>
                </div>

                {/* 第四排：保存按钮 */}
                <button disabled={!canSave} onClick={()=>setPinSaveModal(true)} style={{width:'100%',padding:'11px',borderRadius:8,border:'none',background:canSave?'linear-gradient(135deg,#1e3a5f,#3b82f6)':'#1b3255',color:canSave?'white':'#475569',fontSize:13,fontWeight:600,cursor:canSave?'pointer':'not-allowed',fontFamily:'inherit'}}>
                  保存并发布
                </button>

                {/* 保存确认弹窗 */}
                {pinSaveModal&&(
                  <div onClick={()=>setPinSaveModal(false)} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',zIndex:300,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
                    <div onClick={e=>e.stopPropagation()} style={{background:'#0f2744',borderRadius:12,padding:20,width:'100%',maxWidth:320,border:'1px solid rgba(59,130,246,0.3)'}}>
                      <div style={{fontWeight:700,color:'white',fontSize:15,marginBottom:8}}>📣 发布抽问</div>
                      <div style={{fontSize:13,color:'#94a3b8',marginBottom:6,lineHeight:1.6}}>
                        将设置 <span style={{color:'#60a5fa',fontWeight:600}}>{pinCount}题 · {pinMode==='emergency'?'应急随机':pinMode==='random'?'多题随机':'手动选题'} · {pinScope==='today'?'今天生效':'本套班生效'}</span>
                      </div>
                      <div style={{fontSize:12,color:'#f59e0b',marginBottom:16}}>⚠️ 同时将在钉钉群内发出答题提醒通知</div>
                      <div style={{display:'flex',gap:8}}>
                        <button onClick={()=>setPinSaveModal(false)} style={{flex:1,padding:'10px',borderRadius:7,border:'1px solid #1b3255',background:'transparent',color:'#94a3b8',fontFamily:'inherit',fontSize:13,cursor:'pointer'}}>取消</button>
                        <button onClick={doSave} style={{flex:2,padding:'10px',borderRadius:7,border:'none',background:'linear-gradient(135deg,#1e3a5f,#3b82f6)',color:'white',fontFamily:'inherit',fontSize:13,fontWeight:600,cursor:'pointer'}}>确认发布</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* ══ 板块2：题库 ══ */}
          {(()=>{
            const emergencyBank = banks.find(b=>b.id===1);
            const riskBank = banks.find(b=>b.name==='风险数据库');
            const incidentBanks = banks.filter(b=>b.id!==1&&b.name!=='风险数据库'&&b.name!=='人工提问'&&(b.name.includes('事件')||b.name.includes('事故')||b.name.includes('分析')||b.name.includes('报告')));
            const theoryBanks = banks.filter(b=>b.id!==1&&b.name!=='风险数据库'&&b.name!=='人工提问'&&!b.name.includes('事件')&&!b.name.includes('事故')&&!b.name.includes('分析')&&!b.name.includes('报告'));
            const renderBankRow=(b)=>{
              const expanded=!!bankExpanded[b.id];
              const qs=bankQsCache[b.id]||null;
              const toggleExpand=async()=>{
                if(!expanded&&qs===null){
                  const d=await apiJson(`/api/admin/questions/all?bank_id=${b.id}`,{headers:hdrs()}).catch(()=>null);
                  setBankQsCache(prev=>({...prev,[b.id]:Array.isArray(d)?d:[]}));
                }
                setBankExpanded(prev=>({...prev,[b.id]:!expanded}));
              };
              const deleteQ=async(qid)=>{
                if(!confirm('确认删除该题目？'))return;
                await apiJson(`/api/questions/${qid}`,{method:'DELETE',headers:hdrs()}).catch(()=>null);
                setBankQsCache(prev=>({...prev,[b.id]:(prev[b.id]||[]).filter(q=>q.id!==qid)}));
                apiJson('/api/banks',{headers:hdrs()}).then(setBanks).catch(()=>{});
              };
              const _bankPoolMode = pinMode==='manual' && checkedBankIds.length > 0;
              const canCheck = (qSelectOpen || (pinMode==='manual') || (pinMode==='random'&&!pinRandomBankId)) && !_bankPoolMode;
              return (
                <div key={b.id} style={{borderBottom:'1px solid rgba(27,50,85,0.4)'}}>
                  <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',padding:'9px 12px',cursor:'pointer'}} onClick={toggleExpand}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,color:'white',fontWeight:600,marginBottom:2,lineHeight:1.4}}>{b.name}</div>
                      <div style={{fontSize:11,color:'#475569'}}>{b.q_count||0} 题 <span style={{color:'#334155',marginLeft:4}}>{expanded?'▲':'▼'}</span></div>
                    </div>
                  </div>
                  {expanded&&qs!==null&&(
                    <div style={{padding:'0 12px 10px',background:'rgba(13,17,23,0.5)',maxHeight:320,overflowY:'auto'}}>
                      {qs.length===0?<div style={{fontSize:11,color:'#475569',textAlign:'center',padding:'8px 0'}}>暂无题目</div>:qs.map(q=>{
                        const sel=qSelected.includes(q.id);
                        const maxReached=!sel&&(pinMode==='manual'?qSelected.length>=pinCount:false);
                        return (
                          <div key={q.id} style={{display:'flex',alignItems:'flex-start',gap:8,padding:'7px 0',borderBottom:'1px solid rgba(27,50,85,0.3)'}}>
                            {canCheck&&<div onClick={e=>{e.stopPropagation();if(sel){setQSelected(s=>s.filter(id=>id!==q.id));}else if(!maxReached){setQSelected(s=>[...s,q.id]);}}} style={{width:16,height:16,borderRadius:3,border:`2px solid ${sel?'#3b82f6':'#334155'}`,background:sel?'#3b82f6':'none',flexShrink:0,marginTop:2,display:'flex',alignItems:'center',justifyContent:'center',cursor:maxReached?'not-allowed':'pointer',opacity:maxReached?0.4:1}}>
                              {sel&&<span style={{color:'white',fontSize:9}}>✓</span>}
                            </div>}
                            <div style={{flex:1,fontSize:11,color:'#94a3b8',lineHeight:1.5}}>{q.text}</div>
                            <button onClick={e=>{e.stopPropagation();setEditQModal({id:q.id,bankId:b.id,text:q.text,reference:q.reference||'',keywords:q.keywords||'',category:q.category||''});}} style={{flexShrink:0,background:'none',border:'1px solid rgba(59,130,246,0.3)',color:'#60a5fa',borderRadius:4,padding:'2px 8px',fontSize:11,cursor:'pointer',marginRight:4}}>编辑</button>
                            <button onClick={e=>{e.stopPropagation();deleteQ(q.id);}} style={{flexShrink:0,background:'none',border:'1px solid rgba(239,68,68,0.3)',color:'#ef4444',borderRadius:4,padding:'2px 8px',fontSize:11,cursor:'pointer'}}>删除</button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            };
            const BankSection = ({sectionKey,label,icon,items,defaultOpen=true})=>{
              const open = sectionKey in bankSectionOpen ? bankSectionOpen[sectionKey] : defaultOpen;
              const toggleOpen = ()=>setBankSectionOpen(prev=>({...prev,[sectionKey]:!open}));
              if(!items||items.length===0)return null;
              const sectionBankIds = items.map(b=>b.id);
              const allChecked = sectionBankIds.every(id=>checkedBankIds.includes(id));
              const toggleBankSection = e=>{
                e.stopPropagation();
                setCheckedBankIds(prev=>{
                  if(allChecked) return prev.filter(id=>!sectionBankIds.includes(id));
                  return [...new Set([...prev,...sectionBankIds])];
                });
                setQSelected([]);
              };
              const showBankCheck = pinMode==='manual';
              return (
                <div style={{marginBottom:10,border:`1px solid ${allChecked&&showBankCheck?'rgba(59,130,246,0.5)':'#1b3255'}`,borderRadius:8,overflow:'hidden',background:allChecked&&showBankCheck?'rgba(59,130,246,0.04)':'transparent'}}>
                  <div onClick={toggleOpen} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'9px 12px',background:'#0d1e35',cursor:'pointer'}}>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      {showBankCheck&&(
                        <div onClick={toggleBankSection} style={{width:16,height:16,borderRadius:3,border:`2px solid ${allChecked?'#3b82f6':'#334155'}`,background:allChecked?'#3b82f6':'none',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer'}}>
                          {allChecked&&<span style={{color:'white',fontSize:9,lineHeight:1}}>✓</span>}
                        </div>
                      )}
                      <span style={{fontSize:12,fontWeight:700,color:allChecked&&showBankCheck?'#60a5fa':'#94a3b8'}}>{icon} {label} <span style={{color:'#475569',fontWeight:400,fontSize:11}}>· {items.length}个</span></span>
                    </div>
                    <span style={{color:'#475569',fontSize:11}}>{open?'▲':'▼'}</span>
                  </div>
                  {open&&items.map(b=>renderBankRow(b))}
                </div>
              );
            };
            return (
              <div className="card">
                <div style={{fontSize:11,color:'#64748b',letterSpacing:1,fontWeight:600,marginBottom:12}}>📚 题库</div>
                {emergencyBank&&<BankSection sectionKey="emergency" label="应急故障处置" icon="🚨" items={[emergencyBank]} defaultOpen={true}/>}
                {riskBank&&<BankSection sectionKey="risk" label="风险数据库" icon="⚠️" items={[riskBank]} defaultOpen={false}/>}
                <BankSection sectionKey="incident" label="事件分析报告" icon="📋" items={incidentBanks} defaultOpen={false}/>
                {theoryBanks.length>0&&<BankSection sectionKey="theory" label="理论考试题库" icon="📖" items={theoryBanks} defaultOpen={false}/>}

                {/* 增加分类 */}
                <div style={{display:'flex',gap:8,marginTop:4,marginBottom:14}}>
                  <input value={newCategoryName} onChange={e=>setNewCategoryName(e.target.value)} placeholder="增加分类…" style={{flex:1,background:'#0d1117',border:'1px solid #1b3255',color:'white',borderRadius:6,padding:'7px 10px',fontSize:12}}/>
                  <button disabled={savingCategory||!newCategoryName.trim()} onClick={async()=>{
                    setSavingCategory(true);
                    const r=await apiJson('/api/admin/banks',{method:'POST',headers:hdrs(),body:JSON.stringify({name:newCategoryName.trim(),q_type:'简答'})}).catch(()=>null);
                    setSavingCategory(false);
                    if(r?.id){setNewCategoryName('');apiJson('/api/banks',{headers:hdrs()}).then(setBanks).catch(()=>{});}
                    else alert('保存失败');
                  }} style={{background:'#1b3a6e',border:'none',color:'white',borderRadius:6,padding:'7px 14px',fontSize:12,fontWeight:600,cursor:'pointer',opacity:savingCategory?0.6:1,whiteSpace:'nowrap'}}>保存</button>
                </div>

                {/* 操作按钮行 */}
                <div style={{display:'flex',gap:8}}>
                  <button onClick={()=>{setShowUploadPanel(p=>!p);setShowAddQPanel(false);}} style={{flex:1,background:showUploadPanel?'#1b3a6e':'#0d1e35',border:`1px solid ${showUploadPanel?'#3b82f6':'#1b3255'}`,color:showUploadPanel?'#60a5fa':'#94a3b8',borderRadius:7,padding:'9px',fontSize:12,fontWeight:600,cursor:'pointer'}}>📥 上传题库</button>
                  <button onClick={()=>{setShowAddQPanel(p=>!p);setShowUploadPanel(false);}} style={{flex:1,background:showAddQPanel?'#1b3a6e':'#0d1e35',border:`1px solid ${showAddQPanel?'#3b82f6':'#1b3255'}`,color:showAddQPanel?'#60a5fa':'#94a3b8',borderRadius:7,padding:'9px',fontSize:12,fontWeight:600,cursor:'pointer'}}>✍️ 人工出题</button>
                </div>

                {/* 上传题库面板 */}
                {showUploadPanel&&(
                  <div style={{marginTop:10,display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                    <BankImportCard pwd={pwd} onImported={()=>apiJson('/api/banks',{headers:hdrs()}).then(setBanks).catch(()=>{})}/>
                    <DocParseCard pwd={pwd} banks={banks} onImported={()=>apiJson('/api/banks',{headers:hdrs()}).then(setBanks).catch(()=>{})}/>
                  </div>
                )}

                {/* 人工出题面板 */}
                {showAddQPanel&&(
                  <div style={{marginTop:10,display:'flex',flexDirection:'column',gap:10,borderTop:'1px solid #1b3255',paddingTop:12}}>
                    <div style={{display:'flex',flexDirection:'column',gap:8}}>
                      <div style={{fontSize:11,color:'#94a3b8',fontWeight:600}}>题目</div>
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
                )}
              </div>
            );
          })()}

        </>}

        {/* 题目编辑弹窗 */}
        {editQModal&&(
          <div onClick={()=>setEditQModal(null)} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.8)',zIndex:400,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
            <div onClick={e=>e.stopPropagation()} style={{background:'#0f2744',borderRadius:12,padding:20,width:'100%',maxWidth:400,border:'1px solid rgba(59,130,246,0.3)',display:'flex',flexDirection:'column',gap:12}}>
              <div style={{fontWeight:700,color:'white',fontSize:15}}>编辑题目</div>
              <div>
                <div style={{fontSize:11,color:'#64748b',marginBottom:4}}>题目</div>
                <textarea value={editQModal.text} onChange={e=>setEditQModal(m=>({...m,text:e.target.value}))}
                  rows={3} style={{width:'100%',padding:'8px 10px',borderRadius:7,border:'1px solid #1b3255',background:'#0d1117',color:'#e2e8f0',fontSize:12,fontFamily:'inherit',resize:'vertical',boxSizing:'border-box'}}/>
              </div>
              <div>
                <div style={{fontSize:11,color:'#64748b',marginBottom:4}}>参考答案（各要点用分号分隔）</div>
                <textarea value={editQModal.reference} onChange={e=>setEditQModal(m=>({...m,reference:e.target.value}))}
                  rows={4} style={{width:'100%',padding:'8px 10px',borderRadius:7,border:'1px solid #1b3255',background:'#0d1117',color:'#e2e8f0',fontSize:12,fontFamily:'inherit',resize:'vertical',boxSizing:'border-box'}}/>
              </div>
              <div>
                <div style={{fontSize:11,color:'#64748b',marginBottom:4}}>关键词（逗号分隔，用于关键词评分）</div>
                <input value={editQModal.keywords} onChange={e=>setEditQModal(m=>({...m,keywords:e.target.value}))}
                  style={{width:'100%',padding:'7px 10px',borderRadius:7,border:'1px solid #1b3255',background:'#0d1117',color:'#e2e8f0',fontSize:12,boxSizing:'border-box'}}/>
              </div>
              <div style={{display:'flex',gap:8,marginTop:4}}>
                <button onClick={()=>setEditQModal(null)} style={{flex:1,padding:'10px',borderRadius:7,border:'1px solid #1b3255',background:'transparent',color:'#94a3b8',fontFamily:'inherit',fontSize:13,cursor:'pointer'}}>取消</button>
                <button onClick={async()=>{
                  const r=await apiJson(`/api/questions/${editQModal.id}`,{method:'PUT',headers:hdrs(),body:JSON.stringify({text:editQModal.text,reference:editQModal.reference,keywords:editQModal.keywords,category:editQModal.category})}).catch(()=>null);
                  if(r?.ok){
                    setBankQsCache(prev=>({...prev,[editQModal.bankId]:(prev[editQModal.bankId]||[]).map(q=>q.id===editQModal.id?{...q,text:editQModal.text,reference:editQModal.reference,keywords:editQModal.keywords}:q)}));
                    setEditQModal(null);
                  } else { alert('保存失败'); }
                }} style={{flex:2,padding:'10px',borderRadius:7,border:'none',background:'linear-gradient(135deg,#1e3a5f,#3b82f6)',color:'white',fontFamily:'inherit',fontSize:13,fontWeight:600,cursor:'pointer'}}>保存</button>
              </div>
            </div>
          </div>
        )}

        {tab==='settings'&&<>
          <ImportPlanCard hdrs={hdrs}/>
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
              每题均分，满分 <strong style={{color:'#c8a84b'}}>100分</strong>（题数不同每题分值自动调整）<br/>
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

  // Magic link 自动登录 + 深链导航
  useEffect(()=>{
    // 1. 从 /go 落地页写入的 sessionStorage 自动登录
    try {
      const mu = sessionStorage.getItem('magic_user');
      const mn = sessionStorage.getItem('magic_nav');
      if (mu) {
        sessionStorage.removeItem('magic_user');
        sessionStorage.removeItem('magic_nav');
        const u = JSON.parse(mu);
        setUser(u);
        setScreen(mn || 'home');
        return;
      }
    } catch {}
    // 2. 普通深链：URL 带 ?_nav=workshop 等，登录后跳转
    const urlNav = new URLSearchParams(location.search).get('_nav');
    if (urlNav) { sessionStorage.setItem('pending_nav', urlNav); history.replaceState({},'','/'); }
  }, []);

  const handleLogin = u => {
    setUser(u);
    const dest = sessionStorage.getItem('pending_nav');
    if (dest) { sessionStorage.removeItem('pending_nav'); nav(dest); }
    else nav('home');
  };

  return(
    <>
      <style>{CSS}</style>
      <div className="app-frame">
        {screen==="login"&&<LoginScreen onLogin={handleLogin} onAdmin={()=>nav("admin")}/>}
        {screen==="home"&&<HomeScreen user={user} nav={nav}/>}
        {screen==="quiz"&&<QuizScreen user={user} mode="normal" onDone={(r,p,m)=>{setQuizResults(r);setQuizPoints(p);setQuizMode(m);nav("result");}} onBack={()=>nav("home")}/>}
        {screen==="practice_quiz"&&<QuizScreen user={user} mode={practiceMode} onDone={(r,p,m)=>{setQuizResults(r);setQuizPoints(p);setQuizMode(m);nav("practice_result");}} onBack={()=>nav("practice")}/>}
        {screen==="result"&&<ResultScreen user={user} results={quizResults} points={quizPoints} mode={quizMode} onHome={()=>nav("home")}/>}
        {screen==="practice_result"&&<ResultScreen user={user} results={quizResults} points={quizPoints} mode={quizMode} onHome={()=>nav("home")} onContinuePractice={()=>{nav("practice_quiz");}}/>}
        {screen==="practice"&&<PracticeScreen user={user} onBack={()=>nav("home")} onStart={m=>{setPracticeMode(m);nav("practice_quiz");}}/>}
        {screen==="history"&&<HistoryScreen user={user} onBack={()=>nav("home")}/>}
        {screen==="banks"&&<BanksPreviewScreen onBack={()=>nav("home")}/>}
        {screen==="leaderboard"&&<LeaderboardScreen user={user} onBack={()=>nav("home")}/>}
        {screen==="profile"&&<ProfileScreen user={user} onBack={()=>nav("home")}/>}
        {screen==="admin"&&<AdminScreen onBack={()=>nav(user?"home":"login")}/>}
        {screen==="workshop"&&<WorkshopScreen user={user} onBack={()=>nav("home")}/>}
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
