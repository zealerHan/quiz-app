import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { api, apiJson, AppModal, Badge, ScoreRing, MiniBar } from "./shared.jsx";
import WorkshopScreen from "./screens/WorkshopScreen.jsx";
import AdminScreen from "./screens/AdminScreen.jsx";

// ─── Assets ────────────────────────────────────────────────────────────────
const IMG_ELEVATED = "/img-elevated.jpeg";
const IMG_TUNNEL = "/img-tunnel.jpeg";
const IMG_MASCOT = "/img-mascot.jpeg";


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
          {err&&<div style={{color:"var(--red)",fontSize:12,marginBottom:8}}>⚠ {err}</div>}
          <button type="submit" disabled={loading}
            style={{width:"100%",height:46,marginTop:6,background:loading?"#555":"#c8394b",border:"none",borderRadius:4,fontFamily:"inherit",fontSize:13,fontWeight:600,letterSpacing:5,color:"white",cursor:loading?"not-allowed":"pointer",transition:"all 0.2s"}}>
            {loading?"登录中…":"欢迎登录"}
          </button>
        </form>
        <button onClick={onAdmin} style={{width:"100%",marginTop:12,background:"none",border:"none",color:"rgba(255,255,255,0.2)",fontSize:11,cursor:"pointer",fontFamily:"inherit",letterSpacing:1}}>管理员入口</button>
        <div style={{marginTop:16,textAlign:"center",fontSize:10,color:"rgba(255,255,255,0.15)",letterSpacing:1}}>武汉地铁5号线乘务四组内训专用</div>
      </div>
    </div>
  );
}

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
function QuizScreen({ user, onDone, onBack, mode='normal', practiceBankId=null }) {
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
  const [recogError,setRecogError]=useState(null); // 识别失败/超时提示
  const questionStartRef=useRef(null); // 当前题目开始作答时间戳（ms），用于记录答题时长
  const [results,setResults]=useState([]);
  const [displayText,setDisplayText]=useState("");
  const [isSpeaking,setIsSpeaking]=useState(false);
  const [muted,setMuted]=useState(true); // 默认静音
  const [showSubmitConfirm,setShowSubmitConfirm]=useState(false);
  const [showBackConfirm,setShowBackConfirm]=useState(false);
  const [tabSwitchCount,setTabSwitchCount]=useState(0);
  const [showTabWarn,setShowTabWarn]=useState(false);
  const tabSwitchRef=useRef(0);
  const isRecRef=useRef(false);       // 录音状态 ref，供 visibilitychange 跨闭包访问
  const hiddenWhileRecRef=useRef(false); // 录音期间是否发生过息屏
  const noSleepAudioRef=useRef(null); // iOS 息屏兜底静音音频
  const recRef=useRef(),typeRef=useRef(),pendingSubmitRef=useRef(false),submitRef=useRef(null),scoreCacheRef=useRef(null),audioStreamRef=useRef(null),recognizeTimeoutRef=useRef(null);
  const finishPromiseRef=useRef(null),finishResultRef=useRef(null);

  const isPractice = mode !== 'normal';

  useEffect(()=>{
    const bankParam = practiceBankId ? `&bank_id=${practiceBankId}` : '';
    const qUrl = mode==='practice_random' ? `/api/practice/questions?mode=random&count=3${bankParam}`
               : mode==='practice_random_all' ? `/api/practice/questions?mode=random_all${bankParam}`
               : mode==='practice_sequential' ? `/api/practice/questions?mode=sequential${bankParam}`
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
        if(isRecRef.current){
          // 录音中息屏：不计切屏，标记需要恢复提示
          hiddenWhileRecRef.current=true;
        } else {
          tabSwitchRef.current+=1;
          setTabSwitchCount(tabSwitchRef.current);
        }
      } else {
        if(hiddenWhileRecRef.current){
          // 录音被息屏打断，恢复屏幕后停止录音并提示重录
          hiddenWhileRecRef.current=false;
          if(isRecRef.current){
            try{ recRef.current?.stop?.(); }catch(_){}
            setIsRec(false);
            setIsRecognizing(false);
            setRecogError('屏幕息屏导致录音中断，请重新录音');
          }
        } else if(tabSwitchRef.current>0){
          setShowTabWarn(true);
        }
      }
    };
    document.addEventListener('visibilitychange',handler);
    return()=>document.removeEventListener('visibilitychange',handler);
  },[]);

  // 答题期间保持屏幕常亮，避免手机自动锁屏被判定为切屏中断
  useEffect(()=>{
    let wakeLock=null;
    let released=false;
    const request=async()=>{
      if(!('wakeLock' in navigator)) return;
      try{
        wakeLock=await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release',()=>{ wakeLock=null; });
      }catch(_){}
    };
    const onVisible=()=>{ if(!document.hidden && !released) request(); };
    request();
    document.addEventListener('visibilitychange',onVisible);
    return()=>{
      released=true;
      document.removeEventListener('visibilitychange',onVisible);
      wakeLock?.release?.().catch(()=>{});
    };
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
        questionStartRef.current = Date.now();
      });
      speak(introText, () => {});
    }, 400);
  }, [phase, qi, q]);

  const startRec = async () => {
    navigator.vibrate?.(50);
    setRecogError(null);
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
      isRecRef.current=true;
      // iOS 息屏兜底：播放静音音频循环，阻止系统在录音期间息屏
      try{
        if(!noSleepAudioRef.current){
          // 最短合法 WAV：44字节，0.001秒静音
          const au=new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=');
          au.loop=true; au.volume=0.001;
          noSleepAudioRef.current=au;
        }
        noSleepAudioRef.current.play().catch(()=>{});
      }catch(_){}

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
        setIsRec(false);
        isRecRef.current=false;
        try{ noSleepAudioRef.current?.pause(); }catch(_){}
        setIsRecognizing(false);
        setRecogError('识别服务连接失败，请重新录音或切换手动输入');
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
          isRecRef.current=false;
          // 停止 iOS 息屏兜底音频
          try{ noSleepAudioRef.current?.pause(); }catch(_){}
          setIsRecognizing(true);
          if(ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({type:'stop'}));
          }
          // 超时保护：8秒内未收到 final/error，强制解除并提示
          recognizeTimeoutRef.current = setTimeout(() => {
            recognizeTimeoutRef.current = null;
            setIsRecognizing(false);
            pendingSubmitRef.current = false;
            setRecogError('识别超时，请重新录音或切换手动输入');
            try { ws.close(); } catch {}
          }, 8000);
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
    const durationSeconds = questionStartRef.current ? Math.round((Date.now() - questionStartRef.current) / 1000) : null;
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
    try { await api(`/api/session/${sessionId}/answer`,{method:"POST",body:JSON.stringify({staffId:user.staffId,staffName:user.name,questionId:q.id,questionText:q.text,category:q.category,answerText:finalTranscript||transcript,score:result.score,level:result.level,summary:result.summary,correctPoints:result.correct_points,missingPoints:result.missing_points,suggestion:result.suggestion,scoreMethod:result.score_method,durationSeconds})}); } catch {}
    const nr = [...results,{...result,questionText:q.text,category:q.category,qNum:qi+1}];
    setResults(nr);
    // 最后一题答完后立即在后台 finish，keepalive 确保关闭 APP 后请求仍能发出
    if (qi+1 >= questions.length && sessionId) {
      localStorage.removeItem('quiz_inprogress');
      const avg = Math.round(nr.reduce((s,r)=>s+r.score,0)/nr.length);
      finishPromiseRef.current = apiJson(`/api/session/${sessionId}/finish`,{method:"POST",keepalive:true,body:JSON.stringify({totalScore:avg,tabSwitchCount:tabSwitchRef.current})})
        .then(pts=>{ finishResultRef.current = pts?.points ?? null; return pts; })
        .catch(()=>{ finishResultRef.current = null; return null; });
    }
    speak(`${result.summary}本题${result.score}分。${result.encouragement}`,()=>{});
    setPhase("feedback");
  };
  submitRef.current = submit;


  const next = async () => {
    if (qi+1 >= questions.length) {
      localStorage.removeItem('quiz_inprogress');
      let pts = finishResultRef.current;
      if (pts == null && finishPromiseRef.current) {
        try { const r = await finishPromiseRef.current; pts = r?.points ?? null; } catch {}
      }
      if (pts == null) {
        // 兜底：submit 阶段 finish 没成功，这里再补一次
        const avg = Math.round(results.reduce((s,r)=>s+r.score,0)/results.length);
        try { const r = await apiJson(`/api/session/${sessionId}/finish`,{method:"POST",body:JSON.stringify({totalScore:avg,tabSwitchCount:tabSwitchRef.current})}); pts = r?.points ?? null; } catch {}
      }
      onDone(results, pts, mode);
    } else { setQi(i=>i+1); setTranscript(""); setTranscriptItems([]); setEditingIdx(-1); setAiRes(null); setPhase("intro"); setDisplayText(""); setEditMode(false); scoreCacheRef.current=null; }
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
        {phase==="error"?<><div style={{fontSize:30}}>⚠</div><div style={{color:"var(--red)",marginTop:8}}>加载失败，请检查服务器</div></>:<><div className="spinner"/><div style={{color:"rgba(255,255,255,0.5)",marginTop:12,fontSize:14}}>加载题目中…</div></>}
      </div>
    </div>
  );
  if (!q) return (
    <div style={{position:"relative",width:"100%",height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12,background:"#080a0c"}}>
      <div style={{fontSize:30}}>⚠</div>
      <div style={{color:"var(--red)",marginTop:8,fontSize:14}}>题库暂无题目，请联系管理员</div>
      <button onClick={onBack} style={{marginTop:16,padding:"10px 28px",borderRadius:8,border:"1px solid rgba(255,255,255,0.2)",background:"none",color:"white",fontSize:14,cursor:"pointer"}}>返回</button>
    </div>
  );

  const pct = (qi / questions.length) * 100;

  return (
    <div onContextMenu={e=>e.preventDefault()} className="quiz-shell" style={{position:"relative",width:"100%",display:"flex",flexDirection:"column",overflow:"hidden",background:"#080a0c"}}>
      {/* 背景：地下隧道 */}
      <div style={{position:"absolute",inset:0,backgroundImage:`url(${IMG_TUNNEL})`,backgroundSize:"cover",backgroundPosition:"center",filter:"brightness(0.32) saturate(0.65)",pointerEvents:"none"}}/>
      <div style={{position:"absolute",inset:0,background:"linear-gradient(180deg,rgba(0,0,0,0.6) 0%,rgba(0,0,0,0.1) 40%,rgba(0,0,0,0.55) 75%,rgba(0,0,0,0.92) 100%)",pointerEvents:"none"}}/>

      {/* 内容 */}
      <div style={{position:"relative",zIndex:10,flex:1,display:"flex",flexDirection:"column",maxWidth:440,margin:"0 auto",width:"100%",overflowY:"auto",overscrollBehavior:"contain"}}>

        {/* 顶部状态栏 */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 20px 6px"}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <button onClick={()=>setShowBackConfirm(true)} title="返回主页" style={{background:"none",border:"none",color:"rgba(255,255,255,0.45)",fontSize:22,cursor:"pointer",padding:"0 4px 0 0",lineHeight:1,fontWeight:300}}>‹</button>
            <div style={{width:7,height:7,borderRadius:"50%",background:"#c8394b",boxShadow:"0 0 8px rgba(200,57,75,0.7)",animation:"liveDot 2s ease-in-out infinite"}}/>
            <span style={{fontSize:12,fontWeight:500,letterSpacing:1.5,color:"rgba(255,255,255,0.8)"}}>第 {qi+1} 题 / 共 {questions.length} 题</span>
            {isPractice&&<span style={{fontSize:10,fontWeight:700,color:"var(--amber)",background:"rgba(245,158,11,0.15)",border:"1px solid rgba(245,158,11,0.35)",borderRadius:8,padding:"1px 7px",letterSpacing:1}}>练习</span>}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            {tabSwitchCount>0&&<span style={{fontSize:10,fontWeight:700,color:"var(--red)",background:"rgba(239,68,68,0.15)",border:"1px solid rgba(239,68,68,0.3)",borderRadius:8,padding:"1px 6px",letterSpacing:0.5}}>切屏×{tabSwitchCount}</span>}
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
              {recogError ? (
                <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:8,padding:"8px 0"}}>
                  <span style={{fontSize:18}}>⚠️</span>
                  <span style={{fontSize:12,color:"#f87171",fontWeight:700,textAlign:"center",lineHeight:1.5}}>{recogError}</span>
                  <textarea
                    placeholder="语音识别失败，请在此手动输入答案…"
                    rows={4}
                    style={{width:"100%",boxSizing:"border-box",background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:8,color:"white",fontSize:14,padding:"8px 10px",resize:"none",fontFamily:"inherit",lineHeight:1.6,outline:"none"}}
                    onChange={e=>{
                      const val=e.target.value;
                      setTranscript(val);
                      setTranscriptItems(val.trim()?splitToItems(val):[]);
                      if(val.trim()) setRecogError(null);
                    }}
                  />
                  <span style={{fontSize:11,color:"rgba(255,255,255,0.35)"}}>输入后点击右侧提交按钮完成作答</span>
                </div>
              ) : isRec ? (
                <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:8,padding:"10px 0"}}>
                  <div style={{display:"flex",gap:3,alignItems:"flex-end",height:40}}>
                    {[10,22,34,28,40,32,18,36,26,14].map((h,i)=>(
                      <div key={i} style={{width:4,borderRadius:3,background:"var(--green)",animation:`wave 0.5s ease-in-out ${i*0.07}s infinite alternate`,height:h}}/>
                    ))}
                  </div>
                  <span style={{fontSize:11,color:"var(--green)",letterSpacing:1.5,fontWeight:600}}>录音中，请自然说话…</span>
                </div>
              ) : isRecognizing ? (
                <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:8,padding:"10px 0"}}>
                  <div className="spinner" style={{width:22,height:22}}/>
                  <span style={{fontSize:11,color:"var(--amber)",letterSpacing:1.5,fontWeight:600}}>正在识别…</span>
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
                    ? <div style={{width:8,height:8,borderRadius:"50%",background:"var(--amber)",animation:"blink 0.8s step-end infinite"}}/>
                    : isRec
                    ? <svg width="26" height="26" viewBox="0 0 24 24" fill="white"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>
                    : <svg width="26" height="26" viewBox="0 0 24 24" fill="white"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
                  }
                  <span style={{fontSize:13,fontWeight:700,color:"rgba(255,255,255,0.95)",letterSpacing:1,lineHeight:1,maxWidth:68,textAlign:"center",display:"block"}}>{isRec?"点击停止":isRecognizing?"识别中":"点击录音"}</span>
                </button>
                <span style={{fontSize:12,fontWeight:600,color:isRec?"#c8394b":isRecognizing?"var(--amber)":"rgba(255,255,255,0.35)",letterSpacing:1.5}}>{isRec?"录音中…":isRecognizing?"识别中…":"语音输入"}</span>
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
                  <Badge label={aiRes.level} color={aiRes.level==="优秀"?"var(--green)":aiRes.level==="合格"?"var(--amber)":"var(--red)"}/>
                </div>
                <p style={{fontSize:13,color:"rgba(255,255,255,0.75)",marginBottom:10,lineHeight:1.7}}>{aiRes.summary}</p>
                {/* 标准答案 — 列表化 */}
                {(()=>{const refItems=splitToItems(q.reference||'');return(
                <div style={{marginBottom:10,padding:"10px 12px",background:"rgba(34,197,94,0.08)",border:"1px solid rgba(34,197,94,0.25)",borderRadius:6}}>
                  <div style={{fontSize:11,color:"var(--green)",letterSpacing:1,marginBottom:7,fontWeight:600}}>📋 标准答案</div>
                  {refItems.length>0?refItems.map((item,i)=>(
                    <div key={i} style={{display:"flex",alignItems:"flex-start",gap:8,padding:"4px 0",borderBottom:i<refItems.length-1?"1px solid rgba(34,197,94,0.1)":"none"}}>
                      <span style={{fontSize:14,fontWeight:700,color:"var(--green)",flexShrink:0,minWidth:22,lineHeight:1.6}}>{i+1}.</span>
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
                    <div style={{fontSize:11,color:"var(--blue)",letterSpacing:1,marginBottom:7,fontWeight:600}}>🎙 您的作答</div>
                    {uItems.length===0&&<div style={{fontSize:14,color:"rgba(255,255,255,0.35)"}}>（未识别到内容）</div>}
                    {uItems.map((item,i)=>{
                      const isCorrect=hasOverlap(item,cp);
                      const isOrder=!isCorrect&&hasOverlap(item,op);
                      const clr=isCorrect?"var(--green)":isOrder?"var(--amber)":"rgba(255,255,255,0.78)";
                      return(
                        <div key={i} style={{display:"flex",alignItems:"flex-start",gap:8,padding:"4px 0",borderBottom:i<uItems.length-1?"1px solid rgba(59,130,246,0.1)":"none"}}>
                          <span style={{fontSize:14,fontWeight:700,color:clr,flexShrink:0,minWidth:22,lineHeight:1.6}}>{CIRCLE_NUMS[i]||`${i+1}.`}</span>
                          <span style={{flex:1,fontSize:14,color:clr,lineHeight:1.6}}>
                            {item}
                            {isOrder&&<span style={{fontSize:11,color:"var(--amber)",marginLeft:6,opacity:0.85}}>→ 顺序有误</span>}
                          </span>
                        </div>
                      );
                    })}
                    {mp.map((p,i)=>(
                      <div key={`m${i}`} style={{display:"flex",alignItems:"flex-start",gap:8,padding:"5px 4px",marginTop:3,background:"rgba(239,68,68,0.08)",borderRadius:4}}>
                        <span style={{fontSize:14,color:"var(--red)",flexShrink:0,lineHeight:1.6}}>✗</span>
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
        <button onClick={onBack} style={{background:'none',border:'none',color:'var(--blue)',fontSize:22,cursor:'pointer',padding:'0 4px'}}>←</button>
        <span style={{fontSize:15,fontWeight:700,color:'var(--text)'}}>我的答题历史</span>
      </div>
      {loading&&<div style={{color:'var(--muted)',textAlign:'center',marginTop:40}}>加载中…</div>}
      {!loading&&sessions.length===0&&<div style={{color:'var(--muted)',textAlign:'center',marginTop:40,fontSize:13}}>暂无答题记录</div>}
      {sessions.map((s)=>{
        const avg=Math.round(s.total_score||0);
        const scoreCol=avg>=85?'var(--green)':avg>=60?'var(--amber)':'var(--red)';
        const perQ=Math.round(100/(s.q_count||3));
        const isOpen=!!expanded[s.id];
        return(
          <div key={s.id} className="card" style={{marginBottom:8,padding:0,overflow:'hidden'}}>
            <div onClick={()=>toggle(s.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'12px 14px',cursor:'pointer'}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:12,color:'var(--muted)'}}>
                  {s.created_at?s.created_at.slice(5,10)+' '+s.created_at.slice(11,16):'--'}
                  {s.cycle_label&&<span style={{marginLeft:6,color:'var(--muted)'}}>{s.cycle_label}</span>}
                  {s.is_practice?<span style={{marginLeft:6,fontSize:10,color:'var(--amber)'}}>练习</span>:null}
                </div>
                <div style={{fontSize:11,color:'var(--muted)',marginTop:2}}>{s.q_count||0}题</div>
              </div>
              <span style={{fontSize:20,fontWeight:800,color:scoreCol,flexShrink:0}}>{avg}<span style={{fontSize:10,fontWeight:400,color:'var(--muted)'}}>分</span></span>
              <span style={{fontSize:14,color:'var(--muted)',flexShrink:0,transform:isOpen?'rotate(180deg)':'none',transition:'transform 0.2s'}}>⌄</span>
            </div>
            {isOpen&&(
              <div style={{borderTop:'1px solid rgba(27,50,85,0.6)',padding:'8px 14px 12px'}}>
                {s.answers?.map((a,ai)=>{
                  const pts=Math.round(a.score/(s.q_count||3));
                  const ac=a.score>=99?'var(--green)':a.score>=67?'var(--amber)':'var(--red)';
                  return(
                    <div key={ai} style={{paddingTop:ai>0?10:4,borderTop:ai>0?'1px solid rgba(27,50,85,0.4)':'none'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
                        <span style={{fontSize:11,color:'var(--muted)',flex:1,lineHeight:1.4}}>{ai+1}. {a.question_text}</span>
                        <span style={{fontSize:13,fontWeight:700,color:ac,flexShrink:0,marginLeft:8}}>{pts}<span style={{fontSize:10,color:'var(--muted)',fontWeight:400}}>/{perQ}</span></span>
                      </div>
                      <div style={{fontSize:11,color:'var(--muted)',lineHeight:1.5,paddingLeft:10}}>↳ {a.answer_text||'（无作答）'}</div>
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
        <button onClick={onBack} style={{background:'none',border:'none',color:'var(--blue)',fontSize:22,cursor:'pointer',padding:'0 4px'}}>←</button>
        <span style={{fontSize:15,fontWeight:700,color:'var(--text)'}}>题库预览</span>
      </div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:14}}>
        {banks.map(b=>(
          <button key={b.id} onClick={()=>{setSelBank(b.id);fetchQ(b.id);}}
            style={{padding:'6px 14px',borderRadius:20,border:'none',background:selBank===b.id?'var(--blue)':'#1b3255',color:'var(--text)',fontSize:12,cursor:'pointer',fontWeight:selBank===b.id?700:400}}>
            {b.name}{b.is_active?' ✓':''}
          </button>
        ))}
      </div>
      {loading&&<div style={{color:'var(--muted)',textAlign:'center',marginTop:40}}>加载中…</div>}
      {!loading&&questions.length===0&&<div style={{color:'var(--muted)',textAlign:'center',marginTop:40,fontSize:13}}>该题库暂无题目</div>}
      {questions.map((q,i)=>(
        <div key={i} className="card" style={{marginBottom:10,padding:'12px 14px'}}>
          <div style={{display:'flex',gap:8,marginBottom:6}}>
            <span style={{fontSize:10,color:'var(--muted)',background:'#1b3255',padding:'2px 8px',borderRadius:10}}>{q.category||'--'}</span>
            <span style={{fontSize:10,color:'var(--muted)'}}>难度 {q.difficulty||'--'}</span>
          </div>
          <div style={{fontSize:13,color:'var(--muted)',lineHeight:1.6,marginBottom:6}}>{q.text||q.question_text}</div>
          {q.reference&&<div style={{fontSize:11,color:'var(--muted)',lineHeight:1.5}}>参考：{q.reference}</div>}
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
  const [remRecord, setRemRecord] = useState(null); // null or {result, original_score, remediation_score}
  const [remediationGrant, setRemediationGrant] = useState(null); // null or {expiresAt}
  const [remediationPrompted, setRemediationPrompted] = useState(false);
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
      setRemRecord(d.remRecord || null);
      if (!exempt && !isTester) {
        const today2 = new Date().toISOString().slice(0, 10);
        // 用 cycleCompletedSession 判断是否完成，避免被 is_deleted 的 session 干扰
        const cycSess = d.cycleCompletedSession;
        const doneToday = !!cycSess || (d.recent || []).some(r => r.created_at && r.created_at.slice(0, 10) === today2);
        // 如果有待完成的复查授权，不标记为 done（用户需要去做复查）
        setTaskDone(doneToday && !(d.remRecord?.result === 'pending'));
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

    fetch('/api/admin/members', { headers: { 'x-admin-password': 'admin530' } })
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

    fetch('/api/admin/pinned-questions', { headers: { 'x-admin-password': 'admin530' } })
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

    // 复查授权查询（每30秒轮询一次）
    const checkRemediation = () => {
      apiJson(`/api/remediation/status/${user.staffId}`).then(d => {
        setRemediationGrant(d.granted ? d : null);
      }).catch(() => {});
    };
    checkRemediation();
    const remTimer = setInterval(checkRemediation, 30000);

    return () => { clearInterval(makeupTimer); clearInterval(remTimer); };
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
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <div style={{ fontSize:16, fontWeight:700, color:'var(--text)' }}>
            你好，<span style={{ color:'var(--gold)' }}>{user.name || user.staffId}</span>
            {isExempt && <span style={{ marginLeft:6, fontSize:10, color:'var(--muted)', fontWeight:400, verticalAlign:'middle' }}>班组长</span>}
          </div>
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
                  ? (() => {
                      const isToday = nextOp.shift_date === today;
                      const prefix = isToday ? '今日' : '下次';
                      if (nextOp.plan_type === '中旬会') {
                        return <span style={{color:'var(--gold)',fontWeight:600}}>{prefix}中旬会（全员回段）{isToday ? '' : dateShort(nextOp.shift_date)}</span>;
                      }
                      return <span>{prefix}{nextOp.location||'回段/场'} <span style={{color:'var(--gold)',fontWeight:600}}>{isToday ? '今天' : dateShort(nextOp.shift_date)}</span></span>;
                    })()
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
              flex:1, background:'var(--card-deep)', border:'1px solid var(--border)',
              borderRadius:8, padding:'9px 10px', fontSize:11, color:'var(--text)', lineHeight:1.6, minHeight:48
            }}>
              {pinnedInfo
                ? (() => {
                    const cnt = pinnedInfo.count || 3;
                    const pts = Math.round(100 / cnt);
                    const bigCat = (c) => {
                      if (c === '故障处置' || c === '应急处置') return '应急';
                      if (c === '安全事件') return '安全事件';
                      return '隐患排查';
                    };
                    if (pinnedInfo.mode === 'random' || pinnedInfo.mode === 'emergency') {
                      // 题池随机：有勾选题池（ids有内容）→ 按大类汇总题池组成
                      const poolQs = pinnedInfo.questions || [];
                      if (pinnedInfo.mode === 'random' && poolQs.length > 0) {
                        const catOrder = ['应急','安全事件','隐患排查'];
                        const catMap = {};
                        poolQs.forEach(q => { const c=bigCat(q.category||''); catMap[c]=(catMap[c]||0)+1; });
                        const breakdown = catOrder.filter(k=>catMap[k]).map(k=>`${catMap[k]}题${k}`).join('，');
                        return (
                          <div style={{display:'flex',flexDirection:'column',gap:4}}>
                            <div style={{color:'var(--green)',fontWeight:700,fontSize:10}}>📌 今日指定题目</div>
                            <div style={{color:'var(--text)',fontSize:11,lineHeight:1.7}}>{breakdown}，随机抽{cnt}题</div>
                            <div style={{color:'var(--muted)',fontSize:10}}>每题{pts}分</div>
                          </div>
                        );
                      }
                      // 题库随机 / 应急随机
                      let bankLabel;
                      if (pinnedInfo.mode === 'emergency') bankLabel = '应急故障处置';
                      else if (pinnedInfo.bank_names?.length > 0) bankLabel = pinnedInfo.bank_names.join(' + ');
                      else bankLabel = pinnedInfo.bank_name || '指定题库';
                      return (
                        <div style={{display:'flex',flexDirection:'column',gap:4}}>
                          <div style={{color:'var(--green)',fontWeight:700,fontSize:10}}>📌 今日指定题目</div>
                          <div style={{color:'var(--text)',fontSize:11,lineHeight:1.7}}>{bankLabel}，随机{cnt}题</div>
                          <div style={{color:'var(--muted)',fontSize:10}}>每题{pts}分</div>
                        </div>
                      );
                    }
                    const manualCnt = pinnedInfo.questions?.length || cnt;
                    const manualPts = Math.round(100 / manualCnt);
                    return (
                      <div style={{display:'flex',flexDirection:'column',gap:5}}>
                        <div style={{color:'var(--green)',fontWeight:700,fontSize:10}}>📌 今日指定题目 · {manualCnt}题 · 每题{manualPts}分</div>
                        {(pinnedInfo.questions||[]).map((q,i)=>(
                          <div key={q.id||i} style={{display:'flex',gap:5,alignItems:'flex-start'}}>
                            <span style={{color:'var(--blue)',fontWeight:700,flexShrink:0,fontSize:10,lineHeight:1.65}}>{i+1}.</span>
                            <span style={{color:'var(--text)',fontSize:11,lineHeight:1.65}}>{q.text}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })()
                : activeBank ? activeBank.name : '加载中…'}
            </div>
            {makeupGrant&&!makeupPrompted&&(()=>{ setTimeout(()=>setMakeupPrompted(true),0); return null; })()}
            {makeupGrant&&makeupPrompted&&<AppModal
              icon="⏰"
              title="补答提醒"
              body={`管理员已授权补答\n请在 ${makeupGrant.expiresAt?.slice(0,16)} 前完成本套班答题`}
              buttons={[
                {label:'稍后再答',onClick:()=>setMakeupPrompted(false)},
                {label:'立即补答',primary:true,onClick:()=>{ setMakeupPrompted(false); nav('quiz'); }}
              ]}
            />}
            {remediationGrant&&!remediationPrompted&&(()=>{ setTimeout(()=>setRemediationPrompted(true),0); return null; })()}
            {remediationGrant&&remediationPrompted&&<AppModal
              icon="⚠️"
              title="复查通知"
              body={`班组长已授权本次复查\n请在 ${remediationGrant.expiresAt?.slice(0,16)} 前完成\n本次复查结果将记录在案`}
              buttons={[
                {label:'稍后再答',onClick:()=>setRemediationPrompted(false)},
                {label:'开始复查',primary:true,onClick:()=>{ setRemediationPrompted(false); nav('quiz'); }}
              ]}
            />}
            {isInterrupted
              ? <button disabled style={{ width:'100%', padding:'9px', borderRadius:8, border:'1px solid rgba(239,68,68,0.25)', cursor:'not-allowed', background:'rgba(239,68,68,0.06)', color:'rgba(239,68,68,0.55)', fontSize:11, fontWeight:700, fontFamily:'var(--font)', letterSpacing:'0.3px' }}>答题已中断，请联系管理员重置</button>
              : remRecord?.result === 'pending' && remediationGrant
              ? <button onClick={() => nav('quiz')} style={{ width:'100%', padding:'9px', borderRadius:8, border:'none', cursor:'pointer', background:'linear-gradient(135deg,#7c3aed,#a855f7)', color:'#fff', fontSize:12, fontWeight:800, fontFamily:'var(--font)', letterSpacing:'1px' }}>⚠️ 开始复查（限时）</button>
              : remRecord?.result === 'pending' && !remediationGrant
              ? <button disabled style={{ width:'100%', padding:'9px', borderRadius:8, border:'1px solid rgba(239,68,68,0.3)', cursor:'not-allowed', background:'rgba(239,68,68,0.06)', color:'rgba(239,68,68,0.7)', fontSize:11, fontWeight:700, fontFamily:'var(--font)', letterSpacing:'0.3px' }}>答题不合格（{remRecord.original_score}分），等待班组长授权复查</button>
              : remRecord?.result === 'fail'
              ? <button disabled style={{ width:'100%', padding:'9px', borderRadius:8, border:'1px solid rgba(239,68,68,0.3)', cursor:'not-allowed', background:'rgba(239,68,68,0.06)', color:'rgba(239,68,68,0.7)', fontSize:11, fontWeight:700, fontFamily:'var(--font)', letterSpacing:'0.3px' }}>复查不合格（{Math.round(remRecord.remediation_score)}分）</button>
              : remRecord?.result === 'pass'
              ? <button disabled style={{ width:'100%', padding:'9px', borderRadius:8, border:'1px solid rgba(34,197,94,.4)', background:'rgba(34,197,94,.08)', color:'var(--green)', fontSize:11, fontWeight:700, fontFamily:'var(--font)' }}>复查合格 {Math.round(remRecord.remediation_score)}分</button>
              : taskDone
              ? <button className="btn-done" style={{ width:'100%', padding:'9px', borderRadius:8, border:'1px solid rgba(34,197,94,.4)', background:'rgba(34,197,94,.08)', color:'var(--green)', fontSize:11, fontWeight:700, fontFamily:'var(--font)' }}>✓ 今日已完成</button>
              : makeupGrant
              ? <button onClick={() => nav('quiz')} style={{ width:'100%', padding:'9px', borderRadius:8, border:'none', cursor:'pointer', background:'linear-gradient(135deg,#b84d00,#f97316)', color:'var(--text)', fontSize:12, fontWeight:800, fontFamily:'var(--font)', letterSpacing:'1px' }}>⏰ 补答（限时）</button>
              : pinnedInfo
              ? <button onClick={() => nav('quiz')} style={{ width:'100%', padding:'9px', borderRadius:8, border:'none', cursor:'pointer', background:'linear-gradient(135deg,#9a6f10,#c8a84b)', color:'#07101f', fontSize:12, fontWeight:800, fontFamily:'var(--font)', letterSpacing:'1px' }}>开始抽问</button>
              : <button disabled style={{ width:'100%', padding:'9px', borderRadius:8, border:'1px solid var(--border)', cursor:'not-allowed', background:'var(--card-deep)', color:'var(--muted)', fontSize:11, fontWeight:700, fontFamily:'var(--font)', letterSpacing:'0.5px', opacity:0.6 }}>管理员尚未发布本套班抽问</button>
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
                  flex:1, background:'var(--card-deep)', border:'1px solid var(--border)',
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
                        <span style={{color: done?'#86efac':'var(--muted)',fontSize:10,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{it.item}</span>
                      </div>
                    );
                  })}
                </div>
                {allItemsDone ? (
                  <button disabled style={{ width:'100%', padding:'9px', borderRadius:8, border:'1px solid rgba(34,197,94,.4)', background:'rgba(34,197,94,.08)', color:'var(--green)', fontSize:11, fontWeight:700, fontFamily:'var(--font)' }}>☑ 本月已全部完成</button>
                ) : (
                  <button onClick={()=>nav('workshop')} style={{ width:'100%', padding:'9px', borderRadius:8, border:'none', cursor:'pointer', background:'linear-gradient(135deg,#7c3400,#f97316)', color:'var(--text)', fontSize:11, fontWeight:700, fontFamily:'var(--font)' }}>
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
                padding:'0 11px', background:'var(--card-deep)', borderRadius:9,
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
          <div onClick={e=>e.stopPropagation()} style={{width:'100%',maxWidth:440,background:'var(--input-bg)',border:'1px solid rgba(59,130,246,0.3)',borderRadius:'16px 16px 0 0',padding:'20px 16px 32px',maxHeight:'75vh',overflowY:'auto'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:14}}>
              <div style={{display:'flex',gap:10,alignItems:'flex-start'}}>
                {lbDetail?.sessions?.[0]?.avatar
                  ? <img src={lbDetail.sessions[0].avatar} style={{width:44,height:44,borderRadius:'50%',objectFit:'cover',flexShrink:0,border:'2px solid rgba(59,130,246,0.4)'}}/>
                  : <div style={{width:44,height:44,borderRadius:'50%',background:'linear-gradient(135deg,#1e3a5f,#3b82f6)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,fontWeight:700,color:'var(--text)',flexShrink:0}}>{lbModal.staffName?.[0]}</div>
                }
                <div>
                  <div style={{fontSize:15,fontWeight:700,color:'var(--text)'}}>{lbModal.staffName}</div>
                  <div style={{fontSize:10,color:'var(--muted)',marginTop:2}}>{lbModal.type==='cycle'?'轮班答题记录':'本月答题记录'}</div>
                </div>
              </div>
              <button onClick={()=>{setLbModal(null);setLbDetail(null);}} style={{background:'none',border:'1px solid #1b3255',color:'var(--muted)',borderRadius:6,padding:'4px 10px',cursor:'pointer',fontSize:12,flexShrink:0}}>关闭</button>
            </div>
            {lbDetailLoading&&<div style={{textAlign:'center',padding:'20px 0'}}><div className="spinner" style={{margin:'0 auto'}}/></div>}
            {!lbDetailLoading&&lbDetail&&lbDetail.sessions?.length===0&&<div style={{color:'var(--muted)',fontSize:13,textAlign:'center',padding:'20px 0'}}>暂无答题记录</div>}
            {!lbDetailLoading&&lbDetail?.sessions?.map((s,si)=>(
              <div key={si} style={{marginBottom:12,background:'rgba(15,38,66,0.6)',border:'1px solid #1b3255',borderRadius:10,padding:'12px 14px'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                  <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                    <span style={{fontSize:11,color:'var(--muted)'}}>{s.created_at?.slice(5,10)}{s.created_at?.length>=16?` ${s.created_at.slice(11,16)}`:''}{s.cycle_label?` · ${s.cycle_label}`:''}</span>
                    {s.tab_switch_count>0&&<span style={{fontSize:10,color:'var(--red)',background:'rgba(239,68,68,0.12)',border:'1px solid rgba(239,68,68,0.3)',borderRadius:4,padding:'0 5px',fontWeight:700}}>切屏×{s.tab_switch_count}</span>}
                  </div>
                  <div style={{display:'flex',gap:8,alignItems:'center'}}>
                    <span style={{fontSize:12,fontWeight:700,color:'var(--text)'}}>{Math.round(s.total_score)}分</span>
                  </div>
                </div>
                {s.answers?.map((a,ai)=>(
                  <div key={ai} style={{padding:'6px 0',borderTop:'1px solid rgba(27,50,85,0.5)',display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
                    <span style={{fontSize:11,color:'var(--text)',flex:1,lineHeight:1.5}}>{a.question_text}</span>
                    <span style={{fontSize:12,fontWeight:700,flexShrink:0,color:a.score>=99?'var(--green)':a.score>=67?'var(--amber)':'var(--red)'}}>{Math.round(a.score/(s.answers.length||3))}</span>
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
  const col=avg>=85?'var(--green)':avg>=60?'var(--amber)':'var(--red)';
  const isPractice = mode !== 'normal';
  return(
    <div className="screen" style={{padding:'32px 16px',alignItems:'center'}}>
      <div style={{fontSize:36,marginBottom:8}}>{isPractice?'📝':'🎯'}</div>
      <div style={{fontSize:20,fontWeight:700,color:'var(--text)',marginBottom:4}}>{isPractice?'练习完成！':'答题完成！'}</div>
      <div style={{fontSize:12,color:'var(--muted)',marginBottom:24}}>{user.name} · {results.length}题 · {new Date().toLocaleDateString('zh-CN')}</div>
      <ScoreRing score={avg} size={110}/>
      <div style={{fontSize:11,color:'var(--muted)',marginTop:4,letterSpacing:1}}>{results.length}题综合均分</div>
      {isPractice&&points&&(
        <div style={{margin:'20px 0',padding:'12px 20px',background:'rgba(245,158,11,0.08)',border:'1px solid rgba(245,158,11,0.25)',borderRadius:12,textAlign:'center'}}>
          {points.practiceBonus>0
            ? <><div style={{fontSize:14,fontWeight:700,color:'var(--amber)'}}>+1 练习加分已获得</div>
                <div style={{fontSize:11,color:'var(--muted)',marginTop:4}}>本月已用 {points.practiceUsed} / {points.practiceMax} 次加分机会</div></>
            : <><div style={{fontSize:14,fontWeight:600,color:'var(--muted)'}}>本月练习加分已用完</div>
                <div style={{fontSize:11,color:'var(--muted)',marginTop:4}}>下月继续加油（每月最多 +3 分）</div></>
          }
        </div>
      )}
      {!isPractice&&points&&(
        <div style={{display:'flex',justifyContent:'center',margin:'20px 0',padding:'14px 20px',background:'var(--input-bg)',border:'1px solid var(--border)',borderRadius:12}}>
          <div style={{textAlign:'center'}}><div style={{fontSize:32,fontWeight:900,color:'var(--green)'}}>{points.total}</div><div style={{fontSize:11,color:'var(--muted)'}}>本次得分（满分100）</div></div>
        </div>
      )}
      <div style={{width:'100%',maxWidth:380,marginBottom:24}}>
        {results.map((r,i)=>(
          <div key={i} style={{background:'var(--card)',border:'1px solid var(--border)',borderRadius:10,padding:'12px 14px',marginBottom:8}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:5}}>
              <span style={{fontSize:11,color:'var(--muted)'}}>第{r.qNum}题 · {r.category}</span>
              <div style={{display:'flex',gap:6,alignItems:'center'}}><Badge label={r.level} color={r.level==='优秀'?'var(--green)':r.level==='合格'?'var(--amber)':'var(--red)'}/><span style={{fontWeight:700,color:r.score>=99?'var(--green)':r.score>=67?'var(--amber)':'var(--red)'}}>{Math.round(r.score/results.length)}<span style={{fontSize:10,color:'var(--muted)',fontWeight:400}}>/{Math.round(100/results.length)}分</span></span></div>
            </div>
            <div style={{fontSize:12,color:'var(--muted)'}}>{r.questionText}</div>
            {r.missing_points?.length>0&&<div style={{fontSize:11,color:'var(--red)',marginTop:5}}>遗漏：{r.missing_points.join('、')}</div>}
          </div>
        ))}
      </div>
      {isPractice?(
        <div style={{width:'100%',maxWidth:380,display:'flex',flexDirection:'column',gap:10}}>
          <button className="btn-primary" onClick={onContinuePractice} style={{background:'linear-gradient(135deg,#92400e,#f59e0b)'}}>继续练习</button>
          <button onClick={onHome} style={{padding:'13px',borderRadius:10,border:'1px solid #1b3255',background:'none',color:'var(--muted)',fontSize:14,cursor:'pointer',fontFamily:'var(--font)'}}>返回首页</button>
        </div>
      ):(
        <button className="btn-primary" style={{maxWidth:380}} onClick={onHome}>返回首页</button>
      )}
    </div>
  );
}

// ─── 练习强化 ────────────────────────────────────────────────────────────────
const PRACTICE_MODES = [
  { key:'practice_random',     label:'随机三题', desc:'快速抽 3 题热身' },
  { key:'practice_random_all', label:'随机全部', desc:'整库打乱顺序全过' },
  { key:'practice_sequential', label:'顺序练习', desc:'按题库顺序逐题' },
];

function PracticeScreen({ user, onBack, onStart }) {
  const [status, setStatus] = useState(null);
  const [mode, setMode] = useState('practice_random');
  const [banks, setBanks] = useState([]);
  const [bankPickerOpen, setBankPickerOpen] = useState(false);
  const [selectedBankId, setSelectedBankId] = useState('');

  useEffect(() => {
    apiJson(`/api/practice/monthly-status/${user.staffId}`).then(setStatus).catch(()=>{});
    apiJson('/api/banks').then(bs=>setBanks((bs||[]).filter(b=>b.q_count>0))).catch(()=>{});
  }, []);

  // 题库分组（与管理后台保持一致：bank_id=1 为应急，其余按名称归类）
  const isIncidentBank = b => b.id !== 1 && b.name !== '风险数据库' && b.name !== '人工提问' &&
    (b.name.includes('事件') || b.name.includes('事故') || b.name.includes('分析') || b.name.includes('报告'));
  const grouped = {
    risk:     banks.filter(b => b.name === '风险数据库'),
    incident: banks.filter(isIncidentBank),
    theory:   banks.filter(b => b.id !== 1 && b.name !== '风险数据库' && b.name !== '人工提问' && !isIncidentBank(b)),
  };

  const startEmergency = () => onStart(mode, 1, 'short'); // 应急题库永远走语音
  const startWithBank = () => {
    if (!selectedBankId) return;
    const bank = banks.find(b => String(b.id) === String(selectedBankId));
    // bank_type_summary: 'choice' | 'fill' | 'short' | 'mixed' | 'empty'
    // 任何含手动答题题目的（choice/fill/mixed）都走 PracticeFlowScreen；纯简答走语音
    onStart(mode, parseInt(selectedBankId), bank?.bank_type_summary || 'short');
  };

  return (
    <div className="screen" style={{padding:'16px'}}>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:20}}>
        <button onClick={onBack} style={{background:'none',border:'none',color:'var(--blue)',fontSize:22,cursor:'pointer',padding:'0 4px'}}>←</button>
        <span style={{fontSize:16,fontWeight:700,color:'var(--text)'}}>练习强化</span>
      </div>

      {/* 月度加分状态 */}
      <div style={{background:'rgba(245,158,11,0.08)',border:'1px solid rgba(245,158,11,0.2)',borderRadius:14,padding:'14px 16px',marginBottom:16,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <div>
          <div style={{fontSize:12,color:'var(--muted)',marginBottom:4}}>本月练习加分</div>
          <div style={{fontSize:11,color:'var(--muted)'}}>每完成一次练习 +1 分，每月最多 +3 分</div>
        </div>
        <div style={{textAlign:'center',minWidth:52}}>
          {status
            ? <><div style={{fontSize:26,fontWeight:900,color:'var(--amber)',lineHeight:1}}>{status.used}</div>
                <div style={{fontSize:10,color:'var(--muted)',marginTop:2}}>/ 3 分</div></>
            : <div style={{width:28,height:28,border:'2px solid rgba(245,158,11,0.3)',borderTop:'2px solid #f59e0b',borderRadius:'50%',animation:'spin 0.8s linear infinite',margin:'0 auto'}}/>
          }
        </div>
      </div>

      {/* 模式选择 */}
      <div style={{marginBottom:16}}>
        <div style={{fontSize:11,color:'var(--muted)',letterSpacing:1,marginBottom:8,fontWeight:600}}>① 选择练习模式</div>
        <div style={{display:'flex',gap:8}}>
          {PRACTICE_MODES.map(m=>{
            const active = mode===m.key;
            return (
              <div key={m.key} onClick={()=>setMode(m.key)}
                style={{
                  flex:1,padding:'10px 8px',borderRadius:10,cursor:'pointer',textAlign:'center',
                  background: active?'rgba(59,130,246,0.15)':'var(--card-deep)',
                  border:`1px solid ${active?'var(--blue)':'var(--border)'}`,
                  transition:'all .15s',
                }}>
                <div style={{fontSize:13,fontWeight:700,color:active?'#60a5fa':'var(--text)',marginBottom:2}}>{m.label}</div>
                <div style={{fontSize:10,color:'var(--muted)',lineHeight:1.3}}>{m.desc}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{fontSize:11,color:'var(--muted)',letterSpacing:1,marginBottom:8,fontWeight:600}}>② 选择题库</div>

      {/* 应急抽问 */}
      <div onClick={startEmergency} style={{background:'linear-gradient(135deg,var(--task-start),var(--task-end))',border:'1px solid rgba(59,130,246,0.4)',borderRadius:14,padding:'18px',marginBottom:12,cursor:'pointer',transition:'transform .15s'}}
        onMouseEnter={e=>e.currentTarget.style.transform='translateY(-2px)'}
        onMouseLeave={e=>e.currentTarget.style.transform='none'}>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <div style={{width:44,height:44,borderRadius:12,background:'rgba(59,130,246,0.2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,flexShrink:0}}>🎯</div>
          <div style={{flex:1}}>
            <div style={{fontSize:15,fontWeight:700,color:'var(--text)',marginBottom:4}}>应急抽问</div>
            <div style={{fontSize:12,color:'var(--muted)',lineHeight:1.5}}>从应急题库练习 · {PRACTICE_MODES.find(m=>m.key===mode)?.label}</div>
          </div>
          <span style={{fontSize:20,color:'var(--muted)'}}>›</span>
        </div>
      </div>

      {/* 选择题库 */}
      <div style={{background:'linear-gradient(135deg,#0d2d1a,#1a4a2a)',border:'1px solid rgba(34,197,94,0.3)',borderRadius:14,padding:'18px',marginBottom:12,transition:'transform .15s'}}>
        <div onClick={()=>setBankPickerOpen(o=>!o)} style={{display:'flex',alignItems:'center',gap:12,cursor:'pointer'}}>
          <div style={{width:44,height:44,borderRadius:12,background:'rgba(34,197,94,0.15)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,flexShrink:0}}>📚</div>
          <div style={{flex:1}}>
            <div style={{fontSize:15,fontWeight:700,color:'var(--text)',marginBottom:4}}>选择题库</div>
            <div style={{fontSize:12,color:'var(--muted)',lineHeight:1.5}}>从管理员上传的题库中挑选强化方向</div>
          </div>
          <span style={{fontSize:20,color:'var(--muted)',transition:'transform .2s',transform:bankPickerOpen?'rotate(90deg)':'none'}}>›</span>
        </div>
        {bankPickerOpen && (
          <div style={{marginTop:14,paddingTop:14,borderTop:'1px solid rgba(34,197,94,0.18)'}}>
            <select value={selectedBankId} onChange={e=>setSelectedBankId(e.target.value)}
              style={{width:'100%',padding:'10px 12px',borderRadius:8,border:'1px solid rgba(34,197,94,0.3)',background:'var(--card-deep)',color:'var(--text)',fontSize:13,marginBottom:10}}>
              <option value=''>── 请选择题库 ──</option>
              {(() => {
                const tagOf = b => ({ choice:'选择', fill:'填空', short:'简答', mixed:'混合', empty:'' }[b.bank_type_summary] || '');
                const renderOpt = b => <option key={b.id} value={b.id}>{b.name}（{b.q_count}题{tagOf(b)?' · '+tagOf(b):''}）</option>;
                return <>
                  {grouped.theory.length>0 && <optgroup label="📖 理论考试题库">{grouped.theory.map(renderOpt)}</optgroup>}
                  {grouped.incident.length>0 && <optgroup label="📋 事件分析报告">{grouped.incident.map(renderOpt)}</optgroup>}
                  {grouped.risk.length>0 && <optgroup label="⚠️ 风险数据库">{grouped.risk.map(renderOpt)}</optgroup>}
                </>;
              })()}
            </select>
            <button onClick={startWithBank} disabled={!selectedBankId}
              style={{
                width:'100%',padding:'10px',borderRadius:8,border:'none',cursor:selectedBankId?'pointer':'not-allowed',
                background:selectedBankId?'linear-gradient(135deg,#22c55e,#16a34a)':'rgba(34,197,94,0.15)',
                color:selectedBankId?'white':'var(--muted)',
                fontSize:13,fontWeight:700,
              }}>开始练习</button>
          </div>
        )}
      </div>

      <div style={{marginTop:8,padding:'12px 14px',background:'var(--card-deep)',borderRadius:10,border:'1px solid var(--border)'}}>
        <div style={{fontSize:11,color:'var(--muted)',lineHeight:1.7}}>
          · 练习分数不计入积分榜排名<br/>
          · 每完成一次练习，总榜积分 +1（每月上限 3 次）<br/>
          · 加分与正式答题积分合并计入排行榜
        </div>
      </div>
    </div>
  );
}

// ─── 练习流（dispatcher：按题型分发到 选择 / 判断 / 填空）─────────────────
// 简答题不在这里处理，由外层路由到 QuizScreen 语音模式
const MANUAL_TYPES = new Set(['choice_single','choice_multi','true_false','fill_blank']);
function PracticeFlowScreen({ user, mode, bankId, onBack, onHome }) {
  const [allQuestions, setAllQuestions] = useState([]); // 服务端返回的全部
  const [questions, setQuestions] = useState([]); // 仅手动答题类型
  const [skippedCount, setSkippedCount] = useState(0); // 简答题被跳过的数量
  const [sessionId, setSessionId] = useState(null);
  const [qi, setQi] = useState(0);
  const [phase, setPhase] = useState('loading'); // loading | answering | showing | done | error | empty
  const [selected, setSelected] = useState([]); // 选择题：[letter,...]
  const [textInput, setTextInput] = useState(''); // 填空题：用户输入
  const [results, setResults] = useState([]);
  const [points, setPoints] = useState(null);
  const [showBackConfirm, setShowBackConfirm] = useState(false);

  useEffect(() => {
    const bankParam = bankId ? `&bank_id=${bankId}` : '';
    const qUrl = mode === 'practice_random' ? `/api/practice/questions?mode=random&count=3${bankParam}`
               : mode === 'practice_random_all' ? `/api/practice/questions?mode=random_all${bankParam}`
               : `/api/practice/questions?mode=sequential${bankParam}`;
    Promise.all([
      apiJson(qUrl),
      api('/api/session/start', {method:'POST', body: JSON.stringify({staffId: user.staffId, staffName: user.name, isPractice: true})}).then(async r => { const d=await r.json(); if(!r.ok) throw new Error(d.error||'启动失败'); return d; }),
    ]).then(([qd, sd]) => {
      const all = qd.questions || [];
      // 把没标 type 的当 choice_single（前提：有 options）；其他无 options 当 short_answer
      const decorated = all.map(q => ({ ...q, type: q.type || (q.options ? 'choice_single' : 'short_answer') }));
      const manual = decorated.filter(q => MANUAL_TYPES.has(q.type));
      const skipped = decorated.length - manual.length;
      setAllQuestions(decorated);
      setQuestions(manual);
      setSkippedCount(skipped);
      if (manual.length === 0) { setPhase('empty'); return; }
      setSessionId(sd.sessionId);
      setPhase('answering');
    }).catch(() => setPhase('error'));
  }, []);

  const q = questions[qi];
  const opts = (() => {
    if (!q?.options) return {};
    try { return typeof q.options === 'string' ? JSON.parse(q.options) : q.options; } catch { return {}; }
  })();
  const refRaw = String(q?.reference || '').trim();
  const correctLetters = refRaw.toUpperCase().replace(/[^A-F]/g,'');
  const isMulti = q?.type === 'choice_multi' || correctLetters.length > 1;
  const isChoiceLike = q?.type === 'choice_single' || q?.type === 'choice_multi' || q?.type === 'true_false';
  const isFillBlank = q?.type === 'fill_blank';

  // 填空答案归一化：去空格、统一中英标点、转小写
  const normalizeFill = (s) => String(s||'').trim().toLowerCase()
    .replace(/[，。！？、；：""''（）()【】《》\s]+/g,'');
  const fillCorrectVariants = (() => {
    if (!isFillBlank) return [];
    // 参考答案中含 ;/；/、/| 视为多种可接受写法
    return refRaw.split(/[;；、|]/).map(normalizeFill).filter(Boolean);
  })();

  const submitAnswer = async (payload) => {
    // payload: 选择题 = letters array; 填空 = string
    let userAns, isCorrect;
    if (isChoiceLike) {
      userAns = [...payload].sort().join('');
      isCorrect = userAns === correctLetters;
    } else if (isFillBlank) {
      userAns = String(payload || '').trim();
      const u = normalizeFill(userAns);
      isCorrect = fillCorrectVariants.some(v => v === u);
    } else {
      userAns = String(payload || ''); isCorrect = false;
    }
    try {
      await api(`/api/session/${sessionId}/answer`, {
        method: 'POST',
        body: JSON.stringify({
          staffId: user.staffId, staffName: user.name,
          questionId: q.id, questionText: q.text, category: q.category,
          answerText: userAns, score: isCorrect?100:0, level: isCorrect?'优秀':'需加强',
          summary: isCorrect?'答对':'答错',
          correctPoints: [isChoiceLike ? correctLetters : refRaw],
          missingPoints: isCorrect?[]:[isChoiceLike ? correctLetters : refRaw],
          suggestion: '', scoreMethod: q.type,
        }),
      });
    } catch {}
    setResults(prev => [...prev, { id: q.id, text: q.text, options: opts, userAnswer: userAns, correct: isChoiceLike ? correctLetters : refRaw, isCorrect, category: q.category, type: q.type }]);
    setPhase('showing');
  };

  const handleSelect = (letter) => {
    if (phase !== 'answering') return;
    if (isMulti) {
      setSelected(prev => prev.includes(letter) ? prev.filter(l => l !== letter) : [...prev, letter]);
    } else {
      setSelected([letter]);
      submitAnswer([letter]);
    }
  };

  const handleNext = async () => {
    if (qi < questions.length - 1) {
      setQi(qi + 1);
      setSelected([]);
      setTextInput('');
      setPhase('answering');
    } else {
      const correctCount = results.filter(r => r.isCorrect).length;
      const totalScore = Math.round(correctCount / results.length * 100);
      try {
        const r = await api(`/api/session/${sessionId}/finish`, {method:'POST', body: JSON.stringify({totalScore, tabSwitchCount: 0})});
        const d = await r.json();
        setPoints(d.points);
      } catch {}
      setPhase('done');
    }
  };

  // 加载中
  if (phase === 'loading') {
    return (
      <div className="screen" style={{padding:20,display:'flex',alignItems:'center',justifyContent:'center'}}>
        <div style={{textAlign:'center',color:'var(--muted)'}}>
          <div className="spinner" style={{margin:'0 auto 12px'}}/>
          加载中…
        </div>
      </div>
    );
  }
  if (phase === 'error' || phase === 'empty') {
    return (
      <div className="screen" style={{padding:20}}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:20}}>
          <button onClick={onBack} style={{background:'none',border:'none',color:'var(--blue)',fontSize:22,cursor:'pointer'}}>←</button>
          <span style={{fontSize:16,fontWeight:700,color:'var(--text)'}}>练习</span>
        </div>
        <div style={{color:'var(--red)',marginTop:40,textAlign:'center',lineHeight:1.6}}>
          {phase==='empty'
            ? (skippedCount > 0
                ? `该题库 ${skippedCount} 道题全部是简答题\n请回到练习页通过"应急抽问"或语音模式练习`
                : '该题库暂无可手动答题的题目')
            : '加载失败，请稍后重试'}
        </div>
      </div>
    );
  }

  // 完成总结页
  if (phase === 'done') {
    const correctCount = results.filter(r => r.isCorrect).length;
    const score = Math.round(correctCount / results.length * 100);
    return (
      <div className="screen" style={{padding:'16px'}}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:20}}>
          <button onClick={onHome} style={{background:'none',border:'none',color:'var(--blue)',fontSize:22,cursor:'pointer'}}>←</button>
          <span style={{fontSize:16,fontWeight:700,color:'var(--text)'}}>练习完成</span>
        </div>
        <div style={{textAlign:'center',padding:'28px 16px',background:'linear-gradient(135deg,var(--task-start),var(--task-end))',borderRadius:14,marginBottom:16}}>
          <div style={{fontSize:12,color:'var(--muted)',marginBottom:6}}>得分</div>
          <div style={{fontSize:48,fontWeight:900,color:score>=80?'var(--green)':score>=60?'var(--amber)':'var(--red)',lineHeight:1}}>{score}</div>
          <div style={{fontSize:13,color:'var(--muted)',marginTop:10}}>共 {results.length} 题 · 答对 {correctCount} 题 · 答错 {results.length-correctCount} 题</div>
          {skippedCount > 0 && <div style={{fontSize:11,color:'rgba(245,158,11,0.8)',marginTop:6}}>另有 {skippedCount} 道简答题已跳过（需语音模式）</div>}
          {points?.practiceBonus > 0 && <div style={{fontSize:12,color:'var(--amber)',marginTop:8}}>本次练习 +{points.practiceBonus} 分（本月 {points.practiceUsed}/{points.practiceMax}）</div>}
        </div>

        <div style={{fontSize:11,color:'var(--muted)',letterSpacing:1,marginBottom:8,fontWeight:600}}>错题回顾</div>
        {results.filter(r => !r.isCorrect).length === 0 && (
          <div style={{textAlign:'center',color:'var(--green)',padding:20}}>🎉 全部答对！</div>
        )}
        {results.filter(r => !r.isCorrect).map((r, i) => (
          <div key={i} style={{background:'rgba(239,68,68,0.06)',border:'1px solid rgba(239,68,68,0.2)',borderRadius:10,padding:'12px 14px',marginBottom:10}}>
            <div style={{fontSize:13,color:'var(--text)',marginBottom:8,lineHeight:1.5}}>{r.text}</div>
            {r.type === 'fill_blank' ? (
              <div style={{fontSize:12,color:'var(--muted)',lineHeight:1.7}}>
                <div>你的答案：<span style={{color:'var(--red)'}}>{r.userAnswer || '(未填)'}</span></div>
                <div>正确答案：<span style={{color:'var(--green)'}}>{r.correct}</span></div>
              </div>
            ) : (
              ['A','B','C','D','E','F'].filter(l => r.options[l]).map(l => (
                <div key={l} style={{fontSize:12,color:r.correct.includes(l)?'var(--green)':(r.userAnswer.includes(l)?'var(--red)':'var(--muted)'),padding:'3px 0'}}>
                  <span style={{fontWeight:700,marginRight:6}}>{l}.</span>{r.options[l]}
                  {r.correct.includes(l) && <span style={{marginLeft:6,fontSize:10}}>✓ 正确</span>}
                  {r.userAnswer.includes(l) && !r.correct.includes(l) && <span style={{marginLeft:6,fontSize:10}}>✗ 你的选择</span>}
                </div>
              ))
            )}
          </div>
        ))}

        <button onClick={onBack} style={{width:'100%',padding:'12px',marginTop:16,borderRadius:10,border:'1px solid rgba(59,130,246,0.4)',background:'rgba(59,130,246,0.1)',color:'#60a5fa',fontSize:14,fontWeight:700,cursor:'pointer'}}>再练一次</button>
        <button onClick={onHome} style={{width:'100%',padding:'12px',marginTop:8,borderRadius:10,border:'none',background:'linear-gradient(135deg,#3b82f6,#1e40af)',color:'var(--text)',fontSize:14,fontWeight:700,cursor:'pointer'}}>返回首页</button>
      </div>
    );
  }

  // 答题中
  const last = results[results.length-1];
  const TYPE_BADGE = { choice_single:{label:'单选',color:'#60a5fa'}, choice_multi:{label:'多选',color:'var(--amber)'}, true_false:{label:'判断',color:'#a78bfa'}, fill_blank:{label:'填空',color:'var(--green)'} };
  const badge = TYPE_BADGE[q?.type];
  return (
    <div className="screen" style={{padding:'16px'}}>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14}}>
        <button onClick={() => setShowBackConfirm(true)} style={{background:'none',border:'none',color:'var(--blue)',fontSize:22,cursor:'pointer'}}>←</button>
        <span style={{fontSize:16,fontWeight:700,color:'var(--text)'}}>练习</span>
      </div>

      {/* 进度 */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
        <span style={{fontSize:13,color:'var(--muted)'}}>第 {qi+1} / {questions.length} 题
          {badge && <span style={{marginLeft:8,color:badge.color,fontSize:11,background:badge.color+'22',border:`1px solid ${badge.color}55`,borderRadius:4,padding:'1px 6px'}}>{badge.label}</span>}
        </span>
        <span style={{fontSize:11,color:'var(--muted)'}}>{q.category || ''}</span>
      </div>
      <div style={{height:4,background:'var(--card-deep)',borderRadius:2,marginBottom:18,overflow:'hidden'}}>
        <div style={{height:'100%',width:`${(qi+(phase==='showing'?1:0))/questions.length*100}%`,background:'linear-gradient(90deg,#3b82f6,#22c55e)',transition:'width .3s'}}/>
      </div>

      {/* 题干 */}
      <div style={{fontSize:15,color:'var(--text)',lineHeight:1.6,marginBottom:18,padding:'14px 16px',background:'var(--card-deep)',border:'1px solid var(--border)',borderRadius:12}}>{q.text}</div>

      {/* 选择题/判断题：选项卡片 */}
      {isChoiceLike && ['A','B','C','D','E','F'].filter(l => opts[l]).map(letter => {
        const isSel = selected.includes(letter);
        const isCorrectOpt = correctLetters.includes(letter);
        const showFeedback = phase === 'showing';
        let bg='var(--card-deep)', border='var(--border)', letterColor='var(--muted)';
        if (showFeedback && isCorrectOpt) { bg='rgba(34,197,94,0.12)'; border='var(--green)'; letterColor='var(--green)'; }
        else if (showFeedback && isSel && !isCorrectOpt) { bg='rgba(239,68,68,0.12)'; border='var(--red)'; letterColor='var(--red)'; }
        else if (isSel) { bg='rgba(59,130,246,0.12)'; border='var(--blue)'; letterColor='#60a5fa'; }
        return (
          <div key={letter} onClick={() => handleSelect(letter)}
            style={{
              padding:'12px 14px',background:bg,border:`1px solid ${border}`,borderRadius:10,marginBottom:8,
              cursor: phase==='answering' ? 'pointer' : 'default',
              display:'flex',gap:10,alignItems:'flex-start',transition:'all .15s',
            }}>
            <span style={{fontWeight:700,color:letterColor,minWidth:20,fontSize:15}}>{letter}</span>
            <span style={{flex:1,fontSize:14,color:'var(--text)',lineHeight:1.5}}>{opts[letter]}</span>
            {showFeedback && isCorrectOpt && <span style={{color:'var(--green)',fontSize:16,fontWeight:700}}>✓</span>}
            {showFeedback && isSel && !isCorrectOpt && <span style={{color:'var(--red)',fontSize:16,fontWeight:700}}>✗</span>}
          </div>
        );
      })}

      {/* 多选提交按钮 */}
      {phase==='answering' && isChoiceLike && isMulti && (
        <button onClick={() => submitAnswer(selected)} disabled={selected.length===0}
          style={{
            width:'100%',padding:'12px',marginTop:8,borderRadius:10,border:'none',
            background:selected.length>0?'linear-gradient(135deg,#3b82f6,#1e40af)':'rgba(59,130,246,0.15)',
            color:selected.length>0?'white':'var(--muted)',
            fontSize:14,fontWeight:700,cursor:selected.length>0?'pointer':'not-allowed',
          }}>提交</button>
      )}

      {/* 填空题：文本输入 */}
      {isFillBlank && (
        <div>
          <input type="text" value={textInput} onChange={e=>setTextInput(e.target.value)}
            disabled={phase!=='answering'}
            onKeyDown={e=>{if(e.key==='Enter' && phase==='answering' && textInput.trim()) submitAnswer(textInput);}}
            placeholder="请输入答案，按 Enter 或点击提交"
            style={{
              width:'100%',padding:'14px 16px',borderRadius:10,
              border:`1px solid ${phase==='showing' ? (last?.isCorrect?'var(--green)':'var(--red)') : 'rgba(34,197,94,0.4)'}`,
              background:'rgba(0,0,0,0.25)',color:'var(--text)',fontSize:15,marginBottom:10,
              outline:'none',
            }}/>
          {phase==='answering' && (
            <button onClick={()=>submitAnswer(textInput)} disabled={!textInput.trim()}
              style={{
                width:'100%',padding:'12px',borderRadius:10,border:'none',
                background:textInput.trim()?'linear-gradient(135deg,#22c55e,#16a34a)':'rgba(34,197,94,0.15)',
                color:textInput.trim()?'white':'var(--muted)',
                fontSize:14,fontWeight:700,cursor:textInput.trim()?'pointer':'not-allowed',
              }}>提交</button>
          )}
        </div>
      )}

      {/* 反馈 + 下一题 */}
      {phase==='showing' && last && (
        <>
          <div style={{padding:'12px 14px',background:last.isCorrect?'rgba(34,197,94,0.1)':'rgba(239,68,68,0.1)',border:`1px solid ${last.isCorrect?'rgba(34,197,94,0.3)':'rgba(239,68,68,0.3)'}`,borderRadius:10,marginTop:12,marginBottom:10}}>
            <div style={{fontSize:14,fontWeight:700,color:last.isCorrect?'var(--green)':'var(--red)',marginBottom:last.isCorrect?0:4}}>
              {last.isCorrect ? '✓ 答对了' : '✗ 答错了'}
            </div>
            {!last.isCorrect && (
              <div style={{fontSize:12,color:'var(--muted)'}}>
                {last.type === 'fill_blank'
                  ? <>正确答案：{last.correct} · 你的答案：{last.userAnswer || '(未填)'}</>
                  : <>正确答案：{last.correct} · 你的答案：{last.userAnswer || '(未选)'}</>}
              </div>
            )}
          </div>
          <button onClick={handleNext}
            style={{
              width:'100%',padding:'12px',borderRadius:10,border:'none',
              background:'linear-gradient(135deg,#3b82f6,#1e40af)',color:'var(--text)',
              fontSize:14,fontWeight:700,cursor:'pointer',
            }}>{qi < questions.length-1 ? '下一题 →' : '完成练习'}</button>
        </>
      )}

      {/* 返回确认 */}
      {showBackConfirm && (
        <div onClick={() => setShowBackConfirm(false)} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
          <div onClick={e => e.stopPropagation()} style={{background:'var(--input-bg)',border:'1px solid var(--border)',borderRadius:14,padding:20,maxWidth:340,width:'100%'}}>
            <div style={{fontSize:15,fontWeight:700,color:'var(--text)',marginBottom:8}}>退出练习？</div>
            <div style={{fontSize:13,color:'var(--muted)',marginBottom:16}}>本次进度将不保存</div>
            <div style={{display:'flex',gap:10}}>
              <button onClick={() => setShowBackConfirm(false)} style={{flex:1,padding:'10px',borderRadius:8,border:'1px solid #1b3255',background:'none',color:'var(--muted)',fontSize:13,cursor:'pointer'}}>继续答题</button>
              <button onClick={onBack} style={{flex:1,padding:'10px',borderRadius:8,border:'none',background:'var(--red)',color:'var(--text)',fontSize:13,fontWeight:700,cursor:'pointer'}}>确认退出</button>
            </div>
          </div>
        </div>
      )}
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
              <div style={{width:46,height:46,borderRadius:23,background:i===1?'linear-gradient(135deg,#c8a84b,#e8c96a)':i===0?'#94a3b8':'#cd7f32',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,fontWeight:700,color:'var(--text)',marginBottom:4}}>{p.staff_name[0]}</div>
              <div style={{fontSize:11,color:p.staff_id===user.staffId?'var(--gold)':'var(--text)',fontWeight:p.staff_id===user.staffId?700:400,textAlign:'center'}}>{p.staff_name}</div>
              <div style={{fontSize:14,fontWeight:900,color:'var(--text)'}}>{p.total_points}</div>
              {p.attempts>1&&<div style={{fontSize:9,color:'var(--amber)',marginTop:1}}>答了{p.attempts}次</div>}
              {p.cycle_count>0&&<div style={{fontSize:9,color:'#60a5fa',marginTop:1}}>{p.cycle_count}轮</div>}
              <div style={{width:90,background:'var(--card)',border:'1px solid var(--border)',borderRadius:'4px 4px 0 0',textAlign:'center',color:'var(--muted)',fontSize:12,padding:`${[32,44,24][i]}px 0 6px`,marginTop:6}}>#{[2,1,3][i]}</div>
            </div>
          ))}
        </div>
      )}
      <div style={{padding:'8px 14px 24px'}}>
        {data.slice(3).map((r,i)=>(
          <div key={i} onClick={()=>openMember(r.staff_id,r.staff_name)} style={{display:'flex',alignItems:'center',gap:10,padding:'11px 13px',background:'#0f2642',border:`1px solid ${r.staff_id===user.staffId?'var(--gold)':'#1b3255'}`,borderRadius:10,marginBottom:7,cursor:'pointer'}}>
            <span style={{width:22,color:'var(--muted)',fontWeight:700,fontSize:13,textAlign:'center'}}>{i+4}</span>
            <div style={{width:34,height:34,borderRadius:17,background:'linear-gradient(135deg,#1e3a5f,#3b82f6)',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,color:'var(--text)',fontSize:13}}>{r.staff_name[0]}</div>
            <div style={{flex:1}}>
              <div style={{fontSize:13,fontWeight:600,color:r.staff_id===user.staffId?'var(--gold)':'white',display:'flex',alignItems:'center',gap:5,flexWrap:'wrap'}}>
                {r.staff_name}{r.staff_id===user.staffId?' (我)':''}
                {r.attempts>1&&<span style={{fontSize:9,color:'var(--amber)',background:'rgba(245,158,11,0.12)',border:'1px solid rgba(245,158,11,0.3)',borderRadius:4,padding:'0 4px',fontWeight:700}}>首次·答了{r.attempts}次</span>}
              </div>
              <div style={{fontSize:11,color:'var(--muted)',marginTop:1}}>
                {r.cycle_count>0?<span>参与{r.cycle_count}轮</span>:<span>得分{r.score??r.avg_score} · {r.q_count}题</span>}
              </div>
            </div>
            <div style={{fontSize:18,fontWeight:900,color:'var(--text)'}}>{r.total_points}</div>
          </div>
        ))}
        {data.length===0&&<div style={{textAlign:'center',color:'var(--muted)',padding:40}}>暂无数据</div>}
      </div>
      {lbModal&&(
        <div onClick={()=>{setLbModal(null);setLbDetail(null);}} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',zIndex:200,display:'flex',alignItems:'flex-end',justifyContent:'center'}}>
          <div onClick={e=>e.stopPropagation()} style={{width:'100%',maxWidth:440,background:'var(--input-bg)',border:'1px solid rgba(59,130,246,0.3)',borderRadius:'16px 16px 0 0',padding:'20px 16px 32px',maxHeight:'75vh',overflowY:'auto'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:14}}>
              <div style={{display:'flex',gap:10,alignItems:'flex-start'}}>
                {lbDetail?.sessions?.[0]?.avatar
                  ?<img src={lbDetail.sessions[0].avatar} style={{width:44,height:44,borderRadius:'50%',objectFit:'cover',flexShrink:0,border:'2px solid rgba(59,130,246,0.4)'}}/>
                  :<div style={{width:44,height:44,borderRadius:'50%',background:'linear-gradient(135deg,#1e3a5f,#3b82f6)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,fontWeight:700,color:'var(--text)',flexShrink:0}}>{lbModal.staffName?.[0]}</div>
                }
                <div>
                  <div style={{fontSize:15,fontWeight:700,color:'var(--text)'}}>{lbModal.staffName}</div>
                  <div style={{fontSize:10,color:'var(--muted)',marginTop:2}}>{lbModal.type==='monthly'?'本月答题记录':'轮班答题记录'}</div>
                </div>
              </div>
              <button onClick={()=>{setLbModal(null);setLbDetail(null);}} style={{background:'none',border:'1px solid #1b3255',color:'var(--muted)',borderRadius:6,padding:'4px 10px',cursor:'pointer',fontSize:12,flexShrink:0}}>关闭</button>
            </div>
            {lbDetailLoading&&<div style={{textAlign:'center',padding:'20px 0'}}><div className="spinner" style={{margin:'0 auto'}}/></div>}
            {!lbDetailLoading&&lbDetail&&lbDetail.sessions?.length===0&&<div style={{color:'var(--muted)',fontSize:13,textAlign:'center',padding:'20px 0'}}>暂无答题记录</div>}
            {!lbDetailLoading&&lbDetail?.sessions?.map((s,si)=>(
              <div key={si} style={{marginBottom:12,background:'rgba(15,38,66,0.6)',border:'1px solid #1b3255',borderRadius:10,padding:'12px 14px'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                  <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                    <span style={{fontSize:11,color:'var(--muted)'}}>{s.created_at?.slice(5,10)}{s.created_at?.length>=16?` ${s.created_at.slice(11,16)}`:''}{s.cycle_label?` · ${s.cycle_label}`:''}</span>
                    {s.tab_switch_count>0&&<span style={{fontSize:10,color:'var(--red)',background:'rgba(239,68,68,0.12)',border:'1px solid rgba(239,68,68,0.3)',borderRadius:4,padding:'0 5px',fontWeight:700}}>切屏×{s.tab_switch_count}</span>}
                  </div>
                  <div style={{display:'flex',gap:8,alignItems:'center'}}>
                    <span style={{fontSize:12,fontWeight:700,color:'var(--text)'}}>{Math.round(s.total_score)}分</span>
                  </div>
                </div>
                {s.answers?.map((a,ai)=>(
                  <div key={ai} style={{padding:'6px 0',borderTop:'1px solid rgba(27,50,85,0.5)',display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
                    <span style={{fontSize:11,color:'var(--text)',flex:1,lineHeight:1.5}}>{a.question_text}</span>
                    <span style={{fontSize:12,fontWeight:700,flexShrink:0,color:a.score>=99?'var(--green)':a.score>=67?'var(--amber)':'var(--red)'}}>{Math.round(a.score/(s.answers.length||3))}</span>
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
      <button onClick={onBack} style={{background:'none',border:'none',color:'var(--blue)',fontSize:14,cursor:'pointer',fontFamily:'var(--font)'}}>← 返回</button>
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
        <polygon points={dataPts} fill="rgba(59,130,246,0.25)" stroke="var(--blue)" strokeWidth="2"/>
        {cats.map((c,i)=>{
          const [x,y]=pt(i,c.avg);
          return <circle key={i} cx={x} cy={y} r={4} fill="var(--blue)"/>;
        })}
        {cats.map((c,i)=>{
          const labelR=r+18;
          const lx=cx+labelR*Math.cos(angle(i));
          const ly=cy+labelR*Math.sin(angle(i));
          const anchor=lx<cx-5?'end':lx>cx+5?'start':'middle';
          return (
            <g key={i}>
              <text x={lx} y={ly-4} textAnchor={anchor} fill="var(--muted)" fontSize={9}>{c.category}</text>
              <text x={lx} y={ly+8} textAnchor={anchor} fill={c.avg>=85?'var(--green)':c.avg>=60?'var(--amber)':'var(--red)'} fontSize={10} fontWeight="700">{c.avg}</text>
            </g>
          );
        })}
      </svg>
    );
  };

  // 趋势折线图
  const TrendChart = ({data}) => {
    if(!data||data.length<2) return <div style={{color:'var(--muted)',fontSize:12,textAlign:'center',padding:'20px 0'}}>答题场次不足，趋势待生成</div>;
    const w=280,h=70,max=Math.max(...data,60),min=Math.max(0,Math.min(...data)-10);
    const px=i=>i*(w/(data.length-1));
    const py=v=>h-((v-min)/(max-min||1))*h;
    const pts=data.map((v,i)=>`${px(i)},${py(v)}`).join(' ');
    const fillPts=`${px(0)},${h} ${pts} ${px(data.length-1)},${h}`;
    const last=data[data.length-1];
    const col=last>=85?'var(--green)':last>=60?'var(--amber)':'var(--red)';
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
        <div className="card" style={{background:'linear-gradient(135deg,var(--task-start),var(--task-end))',border:'1px solid rgba(59,130,246,0.3)'}}>
          <div style={{display:'flex',alignItems:'center',gap:14,marginBottom:14}}>
            <div style={{width:52,height:52,borderRadius:26,background:'linear-gradient(135deg,#3b82f6,#0ea5e9)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,fontWeight:700,color:'var(--text)',flexShrink:0,boxShadow:'0 4px 14px rgba(59,130,246,0.4)'}}>{user.name[0]}</div>
            <div style={{flex:1}}>
              <div style={{fontSize:17,fontWeight:700,color:'var(--text)'}}>{user.name}</div>
              <div style={{fontSize:11,color:'var(--muted)',marginTop:2}}>Y{user.staffId} · 武汉地铁5号线</div>
            </div>
            <div style={{textAlign:'right'}}>
              <div style={{fontSize:24,fontWeight:900,color:'var(--text)',lineHeight:1}}>{d.streak||0}<span style={{fontSize:12,color:'var(--muted)',fontWeight:400}}>天</span></div>
              <div style={{fontSize:10,color:'var(--muted)',marginTop:2}}>连续答题🔥</div>
            </div>
          </div>
          <div style={{display:'flex',gap:8}}>
            {[
              {label:'答题天数',val:d.stats?.total_days||0,unit:'天',col:'var(--blue)'},
              {label:'累计积分',val:d.stats?.total_points||0,unit:'分',col:'var(--gold)'},
              {label:'综合均分',val:avg,unit:'',col:avg>=85?'var(--green)':avg>=60?'var(--amber)':'var(--red)'},
              ...(d.cycleRank?[{label:'本轮排名',val:`#${d.cycleRank}`,unit:'',col:'#a855f7'}]:[]),
            ].map((item,i)=>(
              <div key={i} style={{flex:1,textAlign:'center',background:'rgba(0,0,0,0.25)',borderRadius:8,padding:'8px 4px'}}>
                <div style={{fontSize:18,fontWeight:900,color:item.col,lineHeight:1}}>{item.val}<span style={{fontSize:10,color:'var(--muted)',fontWeight:400}}>{item.unit}</span></div>
                <div style={{fontSize:9,color:'var(--muted)',marginTop:3}}>{item.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 优势/弱势快速标签 */}
        {cats.length>0&&(
          <div style={{display:'flex',gap:8}}>
            {maxCat&&<div style={{flex:1,padding:'10px 12px',background:'rgba(34,197,94,0.08)',border:'1px solid rgba(34,197,94,0.25)',borderRadius:10}}>
              <div style={{fontSize:9,color:'var(--green)',letterSpacing:1,marginBottom:4}}>💪 最强科目</div>
              <div style={{fontSize:13,fontWeight:700,color:'var(--text)'}}>{maxCat.category}</div>
              <div style={{fontSize:18,fontWeight:900,color:'var(--green)'}}>{maxCat.avg}<span style={{fontSize:10,fontWeight:400,color:'var(--muted)'}}>分</span></div>
            </div>}
            {minCat&&minCat.category!==maxCat?.category&&<div style={{flex:1,padding:'10px 12px',background:'rgba(239,68,68,0.08)',border:'1px solid rgba(239,68,68,0.25)',borderRadius:10}}>
              <div style={{fontSize:9,color:'var(--red)',letterSpacing:1,marginBottom:4}}>⚠ 需要加强</div>
              <div style={{fontSize:13,fontWeight:700,color:'var(--text)'}}>{minCat.category}</div>
              <div style={{fontSize:18,fontWeight:900,color:'var(--red)'}}>{minCat.avg}<span style={{fontSize:10,fontWeight:400,color:'var(--muted)'}}>分</span></div>
            </div>}
          </div>
        )}

        {/* 雷达图 */}
        {cats.length>=3&&(
          <div className="card">
            <div style={{fontSize:11,color:'var(--muted)',letterSpacing:1,marginBottom:12,fontWeight:600}}>各科目掌握度雷达图</div>
            <RadarChart cats={cats}/>
          </div>
        )}

        {/* 条形图备用（科目少于3时显示） */}
        {cats.length>0&&cats.length<3&&(
          <div className="card">
            <div style={{fontSize:11,color:'var(--muted)',letterSpacing:1,marginBottom:10,fontWeight:600}}>各科目掌握度</div>
            {cats.map((c,i)=><MiniBar key={i} label={c.category} value={c.avg}/>)}
          </div>
        )}

        {/* 得分趋势 */}
        <div className="card">
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
            <div style={{fontSize:11,color:'var(--muted)',letterSpacing:1,fontWeight:600}}>近期得分趋势</div>
            {trendData.length>=2&&<span style={{fontSize:11,color:trendUp?'var(--green)':'var(--red)',fontWeight:600}}>{trendUp?'↑ 上升':'↓ 下降'}</span>}
          </div>
          <TrendChart data={trendData}/>
        </div>

        {/* AI教练分析 */}
        <div className="card" style={{border:'1px solid rgba(168,85,247,0.3)',background:'rgba(88,28,135,0.08)'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
            <div style={{fontSize:11,color:'#a855f7',letterSpacing:1,fontWeight:600}}>🤖 AI教练分析</div>
            {!aiAnalysis&&!aiLoading&&(
              <button onClick={()=>loadAiAnalysis(d)} style={{background:'linear-gradient(135deg,#6d28d9,#a855f7)',border:'none',borderRadius:6,padding:'5px 12px',color:'var(--text)',fontSize:11,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}>生成分析</button>
            )}
          </div>
          {aiLoading&&(
            <div style={{display:'flex',alignItems:'center',gap:8,padding:'12px 0'}}>
              <div className="spinner" style={{width:20,height:20,borderWidth:2}}/>
              <span style={{fontSize:12,color:'var(--muted)'}}>AI教练分析中…</span>
            </div>
          )}
          {aiAnalysis&&<div style={{fontSize:13,color:'var(--text)',lineHeight:1.8,fontStyle:'italic'}}>「{aiAnalysis}」</div>}
          {!aiAnalysis&&!aiLoading&&<div style={{fontSize:12,color:'var(--muted)'}}>点击生成按钮，获取专属训练建议</div>}
        </div>

        {/* 薄弱知识点 */}
        {d.weakCats?.length>0&&(
          <div className="card" style={{border:'1px solid rgba(239,68,68,0.2)'}}>
            <div style={{fontSize:11,color:'var(--muted)',letterSpacing:1,marginBottom:10,fontWeight:600}}>⚠ 重点强化科目</div>
            {d.weakCats.map((c,i)=>(
              <div key={i} style={{display:'flex',alignItems:'center',gap:10,marginBottom:i<d.weakCats.length-1?8:0,padding:'10px 12px',background:'rgba(239,68,68,0.06)',borderRadius:8,border:'1px solid rgba(239,68,68,0.15)'}}>
                <div style={{width:24,height:24,borderRadius:12,background:'rgba(239,68,68,0.2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,color:'var(--red)',flexShrink:0}}>{i+1}</div>
                <span style={{flex:1,fontSize:13,color:'var(--text)'}}>{c.category}</span>
                <div style={{textAlign:'right'}}>
                  <div style={{fontSize:15,fontWeight:700,color:'var(--red)'}}>{c.avg}分</div>
                  <div style={{fontSize:9,color:'var(--muted)'}}>需达到80+</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 近期记录 */}
        <div className="card">
          <div style={{fontSize:11,color:'var(--muted)',letterSpacing:1,marginBottom:10,fontWeight:600}}>近期答题记录</div>
          {d.recent?.length>0?d.recent.map((s,i)=>(
            <div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 0',borderBottom:i<d.recent.length-1?'1px solid rgba(27,50,85,0.7)':'none'}}>
              <div style={{width:36,fontSize:10,color:'var(--muted)',flexShrink:0,textAlign:'center'}}>
                <div>{s.created_at?.slice(5,7)}月</div>
                <div style={{fontSize:13,fontWeight:700,color:'var(--muted)'}}>{s.created_at?.slice(8,10)}日</div>
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:12,color:'var(--text)'}}>{s.q_count}题</div>
              </div>
              <Badge label={s.total_score>=85?'优秀':s.total_score>=60?'合格':'需加强'} color={s.total_score>=85?'var(--green)':s.total_score>=60?'var(--amber)':'var(--red)'}/>
              <div style={{textAlign:'right',minWidth:50}}>
                <div style={{fontWeight:700,color:'var(--text)',fontSize:14}}>{Math.round(s.total_score)}分</div>
              </div>
            </div>
          )):<div style={{color:'var(--muted)',fontSize:13,textAlign:'center',padding:'20px 0'}}>暂无记录，完成答题后显示</div>}
        </div>

      </div>
    </div>
  );
}

// ADMIN




// ─── App Root ─────────────────────────────────────────────────────────────
export default function App() {
  const [screen,setScreen]=useState("login");
  const [user,setUser]=useState(null);
  const [quizResults,setQuizResults]=useState([]);
  const [quizPoints,setQuizPoints]=useState(null);
  const [quizMode,setQuizMode]=useState('normal');
  const [practiceMode,setPracticeMode]=useState('practice_random');
  const [practiceBankId,setPracticeBankId]=useState(null);
  const nav=s=>setScreen(s);

  // 班次主题色：基准 2026-03-22=白班，4天一循环（白/夜/早/休）
  useEffect(()=>{
    const SHIFT_NAMES=['白班','夜班','早班','休息'];
    const base=new Date('2026-03-22T00:00:00+08:00');
    const now=new Date();
    const diff=Math.floor((now-base)/86400000);
    const phase=((diff%4)+4)%4;
    document.documentElement.setAttribute('data-shift',SHIFT_NAMES[phase]);
  },[]);

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
        {screen==="practice_quiz"&&<QuizScreen user={user} mode={practiceMode} practiceBankId={practiceBankId} onDone={(r,p,m)=>{setQuizResults(r);setQuizPoints(p);setQuizMode(m);nav("practice_result");}} onBack={()=>nav("practice")}/>}
        {screen==="practice_mcq"&&<PracticeFlowScreen user={user} mode={practiceMode} bankId={practiceBankId} onBack={()=>nav("practice")} onHome={()=>nav("home")}/>}
        {screen==="result"&&<ResultScreen user={user} results={quizResults} points={quizPoints} mode={quizMode} onHome={()=>nav("home")}/>}
        {screen==="practice_result"&&<ResultScreen user={user} results={quizResults} points={quizPoints} mode={quizMode} onHome={()=>nav("home")} onContinuePractice={()=>{nav("practice_quiz");}}/>}
        {screen==="practice"&&<PracticeScreen user={user} onBack={()=>nav("home")} onStart={(m,bankId,summary)=>{setPracticeMode(m);setPracticeBankId(bankId||null);
          // summary: 'choice'|'fill'|'short'|'mixed'|'empty' — 含手动题（choice/fill/mixed）→ 走 PracticeFlow（混合自动跳过简答）；纯简答 → 语音
          const useVoice = summary === 'short' || summary === 'empty';
          nav(useVoice ? "practice_quiz" : "practice_mcq");
        }}/>}
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
:root{--bg:#07101f;--card:#0f2642;--border:#1b3255;--gold:#c8a84b;--blue:#3b82f6;--green:#22c55e;--red:#ef4444;--amber:#f59e0b;--text:#e2e8f0;--muted:#64748b;--input-bg:#0d1e35;--card-deep:#081828;--task-start:#0d2d5a;--task-end:#1a4a8a;--modal-bg:rgba(28,32,48,0.96);--font:'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif;}
/* ── 班次主题色（任务卡片渐变 + 活跃强调色）── */
:root[data-shift="白班"]{--task-start:#0d2d5a;--task-end:#1a4a8a;--shift-accent:#3b82f6;}
:root[data-shift="夜班"]{--task-start:#1e0a4a;--task-end:#5b21b6;--shift-accent:#7c3aed;}
:root[data-shift="早班"]{--task-start:#431407;--task-end:#c2410c;--shift-accent:#f97316;}
:root[data-shift="休息"]{--task-start:#0d2d5a;--task-end:#1a4a8a;--shift-accent:#3b82f6;}
body{font-family:var(--font);background:var(--bg);color:var(--text);-webkit-tap-highlight-color:transparent;}
.app-frame{width:100%;max-width:440px;margin:0 auto;min-height:100vh;background:var(--bg);}
.screen{height:100vh;height:100svh;display:flex;flex-direction:column;background:var(--bg);overflow-y:auto;}
.screen>*{flex-shrink:0;}   /* 子元素不被压缩，内容超高时由 .screen 自身滚动（修主页/后台滚动） */
/* WorkshopScreen 根容器（月度任务）：vh 兜底兼容钉钉内置 webview（不认 svh 时落回 vh）*/
.ws-screen{height:100vh;height:100svh;overflow-y:auto;}
/* QuizScreen 答题外壳：全屏固定高，vh 兜底兼容钉钉内置 webview（不认 svh 时落回 vh）*/
.quiz-shell{height:100vh;height:100svh;}
.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px;}
/* Home */
.home-header{padding:18px 16px 10px;display:flex;align-items:flex-start;justify-content:space-between;}
.avatar-btn{background:none;border:none;cursor:pointer;}
.user-avatar{width:38px;height:38px;border-radius:19px;background:linear-gradient(135deg,var(--blue),#0ea5e9);display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;color:white;}
.task-card{background:linear-gradient(135deg,var(--task-start),var(--task-end));border:1px solid rgba(59,130,246,.4);border-radius:14px;padding:18px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;box-shadow:0 8px 22px rgba(59,130,246,.18);transition:transform .2s;}
.task-card:hover{transform:translateY(-2px);}
.nav-card{background:var(--card);border:1px solid var(--border);border-radius:11px;padding:12px 6px;text-align:center;cursor:pointer;transition:all .2s;}
.nav-card:hover{border-color:var(--blue);}
.gold-rule{height:1px;background:linear-gradient(90deg,var(--gold),transparent);margin-bottom:18px;}
.brand{display:flex;align-items:center;gap:12px;margin-bottom:18px;}
.brand-icon{width:42px;height:42px;border-radius:10px;background:linear-gradient(135deg,#1e3a5f,#3b82f6);display:flex;align-items:center;justify-content:center;font-size:21px;}
.field{margin-bottom:12px;}
.field label{display:block;font-size:11px;color:var(--muted);margin-bottom:5px;}
.field input{width:100%;background:var(--input-bg);border:1px solid var(--border);border-radius:8px;padding:11px 13px;color:var(--text);font-size:15px;font-family:var(--font);outline:none;transition:border-color .2s;box-sizing:border-box;}
.field input:focus{border-color:var(--blue);}
.err-msg{color:var(--red);font-size:12px;margin-bottom:8px;}
.btn-primary{width:100%;padding:13px;border-radius:9px;border:none;cursor:pointer;background:linear-gradient(135deg,#1e3a5f,#3b82f6);color:white;font-size:15px;font-weight:600;font-family:var(--font);transition:all .2s;letter-spacing:1px;}
.link-btn{width:100%;margin-top:12px;background:none;border:none;color:var(--muted);font-size:12px;cursor:pointer;text-decoration:underline;font-family:var(--font);}
.page-header{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--border);background:var(--input-bg);}
.page-header h2{font-size:15px;font-weight:700;color:var(--text);}
.back-btn{background:none;border:1px solid var(--border);color:var(--text);width:30px;height:30px;border-radius:7px;cursor:pointer;font-size:15px;}
.tab-row{display:flex;gap:5px;padding:10px 12px;border-bottom:1px solid var(--border);}
.tab{flex:1;padding:7px 4px;border-radius:7px;border:1px solid var(--border);background:transparent;color:var(--muted);cursor:pointer;font-family:var(--font);font-size:12px;transition:all .2s;}
.tab.active{background:var(--shift-accent,var(--blue));border-color:var(--shift-accent,var(--blue));color:white;font-weight:600;}
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
