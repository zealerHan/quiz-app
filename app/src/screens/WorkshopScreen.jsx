import { useState, useEffect, useRef } from "react";
import { api, apiJson, Chip } from "../shared.jsx";

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
  // {planId, staffId, staffName, isAdded, step:'pick-date'|'pick-action'|'pick-member'|'zhxh_pick'|'zhxh_confirm', dates:[], target:null, swapCandidates:[]}
  // 整体对调弹窗
  const [swapPlanModal, setSwapPlanModal] = useState(null);
  // {planId, shiftDate, step:'pick'|'confirm', target:null|{id,shift_date,group_name}}
  // 全员延后弹窗
  const [bulkPostponeModal, setBulkPostponeModal] = useState(null);
  // {planId, shiftDate, step:'pick'|'confirm', target:null|{id,shift_date,group_name}, setLunKong:false}
  // 卡片操作成功闪绿
  const [flashCardId, setFlashCardId] = useState(null);
  const flashCard = (planId) => { setFlashCardId(planId); setTimeout(() => setFlashCardId(null), 700); };
  // 教员互换弹窗
  const [instructorSwapModal, setInstructorSwapModal] = useState(null);
  // {planId, planDate, instructorName, candidates:[{planId,shiftDate,instructorId,instructorName}], target:null}
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
  const [memberCheckModal, setMemberCheckModal] = useState(null);
  // {planId, staffId, staffName, shiftDate, isFuture, readOnly, monthItems:[], monthDone, monthTotal, planItems:[], selectedItems:[], comment:'', step:'check'|'comment', saving:false, tippedItem:null}
  const [memberCheckLoading, setMemberCheckLoading] = useState(false);
  const [retroMode, setRetroMode] = useState(false); // 修改/补录模式：已过日期卡片全展开可点击

  const isInstructor = !!(user?.isInstructor);
  const hasEditPerm = !!(adminPwd || isInstructor); // 有权限（不管当前是否在编辑模式）
  const canEdit = hasEditPerm && wsEditMode;         // 实际可编辑

  const hdrs = () => {
    const h = { 'Content-Type': 'application/json' };
    if (adminPwd) h['x-admin-password'] = adminPwd;
    if (isInstructor && !adminPwd) h['x-instructor-id'] = String(user.staffId);
    return h;
  };

  // 点击人员按钮的统一处理：震动 + 日期判断 + 打开对应弹窗
  const handleMemberClick = async (m, p, evMap, monthPlanItems, currentItems, allM) => {
    if (navigator.vibrate) navigator.vibrate(30);
    const today = new Date().toLocaleDateString('sv-SE', {timeZone:'Asia/Shanghai'});
    const isFuture = p.shift_date > today;
    const staffId = m.id || m.staff_id;
    const staffName = m.real_name || m.name;
    const curMonth = p.shift_date.slice(0,7);
    const readOnly = isFuture || !hasEditPerm || (!retroMode && !isMyRow(p));
    const hasEvaluated = !!evMap[staffId];
    setMemberCheckLoading(true);
    setMemberCheckModal({planId:p.id, staffId, staffName, shiftDate:p.shift_date, isFuture, readOnly, hasEvaluated, monthItems:[], monthDone:0, monthTotal:0, planItems:currentItems, selectedItems:[...currentItems], comment:evMap[staffId]?.comment||'', step:'check', saving:false, tippedItem:null});
    const data = await apiJson(`/api/workshop/member-month-items?staff_id=${staffId}&month=${curMonth}`).catch(()=>null);
    setMemberCheckLoading(false);
    setMemberCheckModal(prev => prev ? ({...prev, monthItems:data?.items||[], monthDone:data?.done||0, monthTotal:data?.total||0}) : null);
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

  // 生成变更日志前缀：日期 时间 操作人
  const logNow = () => {
    const tz = new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Shanghai'}));
    const pad = n => String(n).padStart(2,'0');
    return `${tz.getFullYear()}/${pad(tz.getMonth()+1)}/${pad(tz.getDate())} ${pad(tz.getHours())}:${pad(tz.getMinutes())} ${user?.name||'admin'}`;
  };

  // 通用保存单字段变更
  const patchRow = async (planId, changes, logEntry) => {
    if (!ensurePwd()) return;
    setActiveField(null);
    await api(`/api/admin/training-plan/${planId}`, {
      method: 'PUT', headers: hdrs(),
      body: JSON.stringify({ ...changes, log_entry: logEntry || undefined })
    });
    flashCard(planId);
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
      const now = logNow();
      patchRow(p.id, { plan_type: newType }, `${now} 培训方式改为"${newType}"`);
    }
  };

  // 确认设为轮空
  const confirmLunKong = async () => {
    if (!lunKongConfirm) return;
    const { planId, noteInput } = lunKongConfirm;
    const now = logNow();
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
          <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:6}}>
            <div style={{fontSize:11,color:'#64748b',letterSpacing:1,fontWeight:600}}>{monthLabel(month)} 早班培训计划</div>
            {isInstructor && <span style={{fontSize:10,padding:'1px 6px',borderRadius:4,background:'rgba(59,130,246,0.15)',border:'1px solid rgba(59,130,246,0.3)',color:'#93c5fd'}}>教员</span>}
          </div>
          <div style={{display:'flex',gap:5,alignItems:'center',flexWrap:'wrap',marginBottom:8}}>
            {/* 相册 */}
            <button onClick={async()=>{
              setPhotoAlbum({photos:[],loading:true});
              const photos = await apiJson('/api/workshop/photos').catch(()=>[]);
              setPhotoAlbum({photos:Array.isArray(photos)?photos:[],loading:false});
            }} style={{fontSize:10,padding:'3px 8px',borderRadius:5,border:'1px solid rgba(148,163,184,0.3)',background:'rgba(148,163,184,0.06)',color:'#94a3b8',cursor:'pointer',fontFamily:'inherit'}}>
              🖼 相册
            </button>

            {/* 确认/评论（补录）模式 */}
            {hasEditPerm && !wsEditMode && (
              <button onClick={()=>setRetroMode(v=>!v)}
                style={{fontSize:10,padding:'3px 8px',borderRadius:5,
                  border:`1px solid ${retroMode?'rgba(251,191,36,0.6)':'rgba(251,191,36,0.35)'}`,
                  background:retroMode?'rgba(251,191,36,0.18)':'rgba(251,191,36,0.07)',
                  color:'#fbbf24',cursor:'pointer',fontFamily:'inherit',fontWeight:retroMode?700:400}}>
                {retroMode ? '📝 补录中' : '📝 确认/评论'}
              </button>
            )}

            {/* 组员管理 / 保存（有权限） */}
            {hasEditPerm ? (
              wsEditMode ? (
                <button onClick={()=>{ setWsEditMode(false); setExpandedCards(new Set()); setActiveField(null); }}
                  style={{fontSize:10,padding:'3px 10px',borderRadius:5,border:'none',background:'#22c55e',color:'#07101f',cursor:'pointer',fontFamily:'inherit',fontWeight:700}}>
                  保存
                </button>
              ) : (
                <button onClick={()=>{ setWsEditMode(true); setRetroMode(false); }}
                  style={{fontSize:10,padding:'3px 10px',borderRadius:5,border:'1px solid rgba(34,197,94,0.4)',background:'rgba(34,197,94,0.08)',color:'#22c55e',cursor:'pointer',fontFamily:'inherit',fontWeight:600}}>
                  ✎ 组员管理
                </button>
              )
            ) : (
              <button onClick={()=>setShowAdminInput(v=>!v)}
                style={{fontSize:10,padding:'3px 8px',borderRadius:5,border:'1px solid #1b3255',background:'transparent',color:'#475569',cursor:'pointer',fontFamily:'inherit'}}>解锁</button>
            )}
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
                // retroMode 时已过日期的卡片强制展开
                const today2 = new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
                const isPast = p.shift_date < today2;
                const isIndividuallyExpanded = expandedCards.has(p.id) || (retroMode && isPast);
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
                const planRemovedIds = new Set((p.memberOverrides?.removed||[]).map(r=>String(r.id||r.staff_id)));
                const activeFixedStaff = (plan.fixedStaff||[]).filter(f=>!planRemovedIds.has(String(f.staff_id)));
                const cancelledFixedStaff = (plan.fixedStaff||[]).filter(f=>planRemovedIds.has(String(f.staff_id)));
                const fixedNames = activeFixedStaff.map(f => f.real_name || f.name);
                const allLeaders = (plan.leaderStaff || []).map(l => l.real_name || l.name);
                const normalMembers = g
                  ? (g.members || []).filter(m => m.id !== g.instructor_id && !(plan.fixedStaff||[]).some(f => f.staff_id === m.id))
                  : [];

                const isOpen = (field) => activeField?.planId === p.id && activeField?.field === field;
                const toggleField = (field) => {
                  if (!canEdit) return;
                  setActiveField(prev => (prev?.planId === p.id && prev?.field === field) ? null : { planId: p.id, field });
                };
                const now = logNow();
                const LOCATIONS = ['工人村', '青菱车场', '复兴路'];
                const TYPE_LABELS = {'培训':'实操','理论':'理论','轮空':'轮空','中旬会':'中旬会'};

                // 通用下拉 chip 组件（行内渲染；popover=true 时选项以浮层形式弹出，不撑开整行）
                const Chip = ({field, label, color='#94a3b8', borderColor='#1b3255', options, onSelect, popover=false}) => (
                  <span style={{display:'inline-flex',alignItems:'center',gap:0,flexShrink:0,position:popover?'relative':'static'}}>
                    <button onClick={()=>toggleField(field)} style={{
                      padding:'1px 6px',borderRadius:5,fontSize:11,fontWeight:600,fontFamily:'inherit',cursor:'pointer',
                      color, border:`1px solid ${isOpen(field)?color:borderColor}`,
                      background: isOpen(field)?'rgba(59,130,246,0.1)':'none'
                    }}>{label} {canEdit?'▾':''}</button>
                    {canEdit && isOpen(field) && !popover && (
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
                    {canEdit && isOpen(field) && popover && (
                      <>
                        <span onClick={()=>toggleField(field)} style={{position:'fixed',inset:0,zIndex:40}}/>
                        <span style={{
                          position:'absolute',top:'calc(100% + 4px)',left:0,zIndex:50,
                          background:'#0d1e35',border:`1px solid ${color}`,borderRadius:6,
                          padding:5,boxShadow:'0 4px 14px rgba(0,0,0,0.5)',
                          display:'grid',gridTemplateColumns:'repeat(2,minmax(60px,auto))',gap:3,
                          minWidth:140,
                        }}>
                          {options.length===0 && <span style={{fontSize:10,color:'#475569',padding:'4px 8px',gridColumn:'span 2'}}>无可选项</span>}
                          {options.map(opt=>(
                            <button key={opt.value} onClick={()=>onSelect(opt.value)} style={{
                              padding:'3px 6px',borderRadius:4,fontSize:10,fontFamily:'inherit',cursor:'pointer',
                              border:`1px solid ${opt.value===opt.current?color:'#1b3255'}`,
                              background: opt.value===opt.current?`rgba(59,130,246,0.15)`:'rgba(13,17,23,0.4)',
                              color: opt.value===opt.current?color:'#cbd5e1', fontWeight: opt.value===opt.current?600:400,
                              whiteSpace:'nowrap',textAlign:'center',
                            }}>{opt.label}</button>
                          ))}
                        </span>
                      </>
                    )}
                  </span>
                );

                return (
                  <div key={p.id} style={{
                    background:'#0a1929',
                    border:`1px solid ${flashCardId===p.id?'rgba(34,197,94,0.8)':tc.border}`,
                    borderRadius:10, overflow:'hidden',
                    transition: flashCardId===p.id ? 'border-color 0s' : 'border-color 0.6s, opacity 0.15s',
                    opacity: rowOpacity,
                    boxShadow: flashCardId===p.id ? '0 0 0 2px rgba(34,197,94,0.25)' : mine ? '0 0 0 1.5px rgba(59,130,246,0.35)' : 'none',
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

                        {/* 整体对调 / 全员延后 快捷按钮（仅编辑模式） */}
                        {canEdit && p.plan_type!=='轮空' && (<>
                          <button onClick={()=>setSwapPlanModal({planId:p.id,shiftDate:p.shift_date,step:'pick',target:null})}
                            title="与另一期整体对调" style={{padding:'1px 5px',borderRadius:4,fontSize:10,fontFamily:'inherit',cursor:'pointer',border:'1px solid rgba(96,165,250,0.4)',background:'rgba(59,130,246,0.08)',color:'#60a5fa',lineHeight:1.4}}>⇄</button>
                          {p.plan_type!=='中旬会' && p.group_id && (
                            <button onClick={()=>setBulkPostponeModal({planId:p.id,shiftDate:p.shift_date,step:'pick',target:null,setLunKong:false})}
                              title="全员延后到另一期" style={{padding:'1px 5px',borderRadius:4,fontSize:10,fontFamily:'inherit',cursor:'pointer',border:'1px solid rgba(251,191,36,0.4)',background:'rgba(251,191,36,0.07)',color:'#fbbf24',lineHeight:1.4}}>→↑</button>
                          )}
                        </>)}

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
                        const now2 = logNow();
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
                                              const shiftYear = parseInt(p.shift_date.slice(0,4));
                                              const shiftMonth = parseInt(p.shift_date.slice(5,7));
                                              const yearPlanData = await apiJson(`/api/admin/training-year-plan?year=${shiftYear}`).catch(()=>[]);
                                              const monthPlanItems = (Array.isArray(yearPlanData)?yearPlanData:[]).find(r=>r.month===shiftMonth)?.sessions || [];
                                              const currentItems = (() => { try { return JSON.parse(p.completed_items||'[]'); } catch(e) { return []; } })();
                                              const evals = await apiJson(`/api/workshop/training-plan/${p.id}/evaluations`).catch(()=>[]);
                                              const evMap = {};
                                              (Array.isArray(evals)?evals:[]).forEach(e=>{ evMap[e.staff_id]=e; });
                                              const allZhxhMembers = (plan.groups||[]).flatMap(gr=>{
                                                const fids = new Set((plan.fixedStaff||[]).map(f=>f.staff_id));
                                                return (gr.members||[]).filter(x=>!fids.has(x.id)).map(x=>({id:x.id,real_name:x.real_name||x.name}));
                                              });
                                              const fixedM = (plan.fixedStaff||[]).map(f=>({id:f.staff_id,real_name:f.real_name||f.name}));
                                              const allM = [...allZhxhMembers,...fixedM].filter((x,i,a)=>a.findIndex(y=>y.id===x.id)===i);
                                              await handleMemberClick(m, p, evMap, monthPlanItems, currentItems, allM);
                                            }} style={(() => {
                                              const confirmed = (p.confirmedIds||[]).includes(String(m.id));
                                              return {padding:'2px 6px',borderRadius:4,fontSize:10,fontFamily:'inherit',cursor:'pointer',border:`1px solid ${confirmed?'rgba(34,197,94,0.35)':'rgba(248,113,113,0.35)'}`,background:confirmed?'rgba(34,197,94,0.07)':'rgba(248,113,113,0.07)',color:confirmed?'#22c55e':'#f87171',fontWeight:400};
                                            })()}>{m.real_name||m.name}</button>
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
                                            const fixedM2 = (plan.fixedStaff||[]).map(x=>({id:x.staff_id,real_name:x.real_name||x.name}));
                                            const allM = [...allZhxhMembers,...fixedM2].filter((x,i,a)=>a.findIndex(y=>y.id===x.id)===i);
                                            await handleMemberClick({id:f.staff_id,real_name:f.real_name||f.name}, p, evMap, monthPlanItems, currentItems, allM);
                                          }} style={(() => {
                                            const confirmed = (p.confirmedIds||[]).includes(String(f.staff_id));
                                            return {padding:'2px 6px',borderRadius:4,fontSize:10,fontFamily:'inherit',cursor:hasEditPerm?'pointer':'default',border:`1px solid ${confirmed?'rgba(34,197,94,0.35)':'rgba(248,113,113,0.35)'}`,background:confirmed?'rgba(34,197,94,0.07)':'rgba(248,113,113,0.07)',color:confirmed?'#22c55e':'#f87171',fontWeight:400};
                                          })()}>{f.real_name||f.name}</button>
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
                          {(g.instructor_name||canEdit) && (() => {
                            // 该计划小组的"默认教员"（用于"恢复默认"选项）
                            const groupDefault = (plan.groups||[]).find(gr=>gr.id===p.group_id);
                            const defaultInstId = groupDefault?.instructor_id || null;
                            // 候选：仅"教员"标签且非"班组长"的员工，且排除当前已显示的教员本人
                            const allStaff = (plan.allStaff||[]).filter(s=>s.id);
                            const insStaff = allStaff.filter(s=>s.is_instructor && !s.is_leader && String(s.id)!==String(g.instructor_id));
                            const opts = insStaff.map(s=>({value:s.id,label:s.real_name||s.name,current:null}));
                            // 若已被 override，加一个"恢复默认"选项置于最前
                            if (p.instructor_overridden && defaultInstId) {
                              const def = allStaff.find(s=>String(s.id)===String(defaultInstId));
                              opts.unshift({value:'__reset__',label:`↺ 恢复默认（${def?.real_name||def?.name||'—'}）`,current:null});
                            }
                            return (
                              <span style={{fontSize:11,color:'#7c8fa6',display:'inline-flex',alignItems:'center',gap:4}}>
                                教员
                                <Chip field="instructor" label={(g.instructor_name||'—')+(p.instructor_overridden?' *':'')} color="#93c5fd" borderColor="#1b3255"
                                  popover={true}
                                  options={opts}
                                  onSelect={v=>{
                                    if(v==='__reset__'){
                                      const cur = g.instructor_name||'';
                                      const def = allStaff.find(s=>String(s.id)===String(defaultInstId));
                                      const defName = def?.real_name||def?.name||'';
                                      patchRow(p.id,{instructor_id_override:null},`${now} 教员恢复默认（${cur}→${defName}）`);
                                    } else {
                                      const nm = allStaff.find(s=>String(s.id)===String(v));
                                      const newName = nm?.real_name||nm?.name||'';
                                      const cur = g.instructor_name||'';
                                      // 选回默认教员则清 override
                                      const ov = String(v)===String(defaultInstId) ? null : v;
                                      patchRow(p.id,{instructor_id_override:ov},`${now} 教员改为"${newName}"（原${cur}）`);
                                    }
                                  }}
                                />
                                {canEdit && (
                                  <button title="与另一计划的教员互换" onClick={async()=>{
                                    const today2 = new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
                                    const candidates = (plan.plans||[])
                                      .filter(x=>x.id!==p.id && x.plan_type!=='轮空' && x.plan_type!=='中旬会' && x.shift_date>=today2 && x.group)
                                      .map(x=>({
                                        planId:x.id,
                                        shiftDate:x.shift_date,
                                        instructorId:x.group?.instructor_id,
                                        instructorName:x.group?.instructor_name||'—',
                                        groupName:x.group?.name||'',
                                      }))
                                      .filter(x=>x.instructorId && String(x.instructorId)!==String(g.instructor_id));
                                    setInstructorSwapModal({
                                      planId:p.id,
                                      planDate:p.shift_date,
                                      instructorName:g.instructor_name||'—',
                                      candidates,
                                      target:null,
                                    });
                                  }} style={{
                                    padding:'1px 5px',borderRadius:5,fontSize:11,fontFamily:'inherit',cursor:'pointer',
                                    border:'1px solid #1b3255',background:'rgba(59,130,246,0.08)',color:'#93c5fd',
                                  }}>⇄</button>
                                )}
                              </span>
                            );
                          })()}
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
                                    // 补录模式下，组员按钮走"确认/点评"流程（优先于"修改成员"，且不依赖编辑模式）
                                    const canRetro = retroMode && hasEditPerm && p.shift_date <= today2;
                                    return m ? (
                                      <button key={i} onClick={async()=>{
                                        if (canRetro) {
                                          const ov2 = p.memberOverrides||{added:[],removed:[]};
                                          const rids2 = new Set((ov2.removed||[]).map(r=>String(r.id||r.staff_id)));
                                          const baseM2 = normalMembers.filter(x=>!rids2.has(String(x.id)));
                                          const addedM2 = (ov2.added||[]).map(a=>({id:a.id||a.staff_id,real_name:a.real_name||a.staff_name||a.name}));
                                          const fixedM2 = (plan.fixedStaff||[]).filter(f=>!rids2.has(String(f.staff_id))).map(f=>({id:f.staff_id,real_name:f.real_name||f.name}));
                                          const allM2 = [...baseM2,...addedM2,...fixedM2].filter((x,j,a)=>a.findIndex(y=>y.id===x.id)===j);
                                          const evals2 = await apiJson(`/api/workshop/training-plan/${p.id}/evaluations`).catch(()=>[]);
                                          const evMap2 = {}; (Array.isArray(evals2)?evals2:[]).forEach(e=>{ evMap2[e.staff_id]=e; });
                                          const sy2 = parseInt(p.shift_date.slice(0,4)), sm2 = parseInt(p.shift_date.slice(5,7));
                                          const ypd2 = await apiJson(`/api/admin/training-year-plan?year=${sy2}`).catch(()=>[]);
                                          const mpi2 = (Array.isArray(ypd2)?ypd2:[]).find(r=>r.month===sm2)?.sessions||[];
                                          const ci2 = (()=>{try{return JSON.parse(p.completed_items||'[]');}catch(e){return [];}})();
                                          await handleMemberClick(m, p, evMap2, mpi2, ci2, allM2);
                                          return;
                                        }
                                        if(!canEdit) return;
                                        const otherDates = (plan.plans||[]).filter(x=>x.id!==p.id&&x.plan_type!=='轮空'&&x.plan_type!=='中旬会'&&x.group_id);
                                        setMemberModal({planId:p.id,staffId:m.id,staffName:m.real_name||m.name,isAdded:isSwapped,step:'pick-date',dates:otherDates,target:null,swapCandidates:[]});
                                      }} style={(() => {
                                        const confirmed = (p.confirmedIds||[]).includes(String(m.id));
                                        if (canRetro) return {padding:'2px 6px',borderRadius:4,fontSize:10,fontFamily:'inherit',cursor:'pointer',border:'1px solid rgba(251,191,36,0.5)',background:'rgba(251,191,36,0.08)',color:'#fbbf24',fontWeight:600};
                                        if (isSwapped) return {padding:'2px 6px',borderRadius:4,fontSize:10,fontFamily:'inherit',cursor:canEdit?'pointer':'default',border:'1px solid #3b82f6',background:'rgba(59,130,246,0.15)',color:'#60a5fa',fontWeight:600};
                                        return {padding:'2px 6px',borderRadius:4,fontSize:10,fontFamily:'inherit',cursor:canEdit?'pointer':'default',border:`1px solid ${confirmed?'rgba(34,197,94,0.35)':'rgba(248,113,113,0.35)'}`,background:confirmed?'rgba(34,197,94,0.07)':'rgba(248,113,113,0.07)',color:confirmed?'#22c55e':'#f87171',fontWeight:400};
                                      })()}>
                                        {m.real_name||m.name}
                                        {canEdit && <span onClick={async e=>{
                                          e.stopPropagation();
                                          if(!confirm(`将 ${m.real_name||m.name} 本期移出？`)) return;
                                          const now2=logNow();
                                          await api('/api/admin/training-plan/member-remove',{method:'POST',headers:hdrs(),body:JSON.stringify({plan_id:p.id,staff_id:m.id,action:'remove'})});
                                          patchRow(p.id,{},`${now2} ${m.real_name||m.name} 本期移出`);
                                        }} style={{marginLeft:3,color:'rgba(248,113,113,0.6)',fontWeight:700,fontSize:9,verticalAlign:'middle',cursor:'pointer'}}>×</span>}
                                      </button>
                                    ) : (
                                      <span key={i} style={{display:'inline-block',width:28,height:20,border:'1px dashed rgba(100,130,180,0.45)',borderRadius:4,background:'rgba(27,50,85,0.2)'}}/>
                                    );
                                  })}
                                </div>
                              </div>
                              {/* 固定人员 */}
                              {(activeFixedStaff.length>0||cancelledFixedStaff.length>0) && (
                                <div style={{fontSize:10,color:'#7c8fa6',display:'flex',alignItems:'center',gap:4,flexWrap:'wrap'}}>
                                  <span>固定</span>
                                  {activeFixedStaff.map((f,fi)=>(
                                    wsEditMode&&canEdit ? (
                                      <button key={fi} onClick={async()=>{
                                        const now2=logNow();
                                        await api('/api/admin/training-plan/member-remove',{method:'POST',headers:hdrs(),body:JSON.stringify({plan_id:p.id,staff_id:f.staff_id,action:'remove'})});
                                        patchRow(p.id,{},`${now2} ${f.real_name||f.name} 取消本次回段`);
                                      }} style={{padding:'1px 5px',borderRadius:4,fontSize:10,fontFamily:'inherit',cursor:'pointer',border:'1px solid rgba(196,181,253,0.4)',background:'rgba(196,181,253,0.08)',color:'#c4b5fd'}}>
                                        {f.real_name||f.name} ×
                                      </button>
                                    ) : (
                                      <span key={fi} style={{color:'#c4b5fd'}}>{f.real_name||f.name}</span>
                                    )
                                  ))}
                                  {cancelledFixedStaff.map((f,fi)=>(
                                    <button key={'c'+fi} onClick={async()=>{
                                      if(!wsEditMode||!canEdit) return;
                                      const now2=logNow();
                                      await api('/api/admin/training-plan/member-remove',{method:'POST',headers:hdrs(),body:JSON.stringify({plan_id:p.id,staff_id:f.staff_id,action:'restore'})});
                                      patchRow(p.id,{},`${now2} ${f.real_name||f.name} 恢复本次回段`);
                                    }} style={{padding:'1px 5px',borderRadius:4,fontSize:10,fontFamily:'inherit',cursor:wsEditMode&&canEdit?'pointer':'default',border:'1px solid rgba(100,100,100,0.3)',background:'rgba(30,30,30,0.2)',color:'#6b7280',textDecoration:'line-through'}}>
                                      {f.real_name||f.name}
                                    </button>
                                  ))}
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
                        {p.change_log.split('\n').filter((ln,i,arr)=>i===0||arr[i-1]!==ln).map((ln,i)=>(
                          <div key={i} style={{fontSize:10,color:'#6b7280',lineHeight:1.7}}>• {ln}</div>
                        ))}
                      </div>
                    )}

                    {/* ── 现场记录 & 确认点评（编辑模式） ── */}
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
                            const fixedM = (plan.fixedStaff||[]).filter(f=>!removedIds.has(String(f.staff_id))).map(f=>({id:f.staff_id,real_name:f.real_name||f.name}));
                            const allM = [...baseM,...addedM,...fixedM].filter((m,i,a)=>a.findIndex(x=>x.id===m.id)===i);
                            const evals = await apiJson(`/api/workshop/training-plan/${p.id}/evaluations`).catch(()=>[]);
                            const evMap = {};
                            (Array.isArray(evals)?evals:[]).forEach(e=>{ evMap[e.staff_id]=e; });
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

            {/* 第一步：选目标培训日期 */}
            {memberModal.step==='pick-date' && (<>
              <div style={{fontWeight:600,color:'#e2e8f0',fontSize:14,marginBottom:2}}>
                {memberModal.staffName}
                {memberModal.isAdded && <span style={{fontSize:10,color:'#60a5fa',marginLeft:6,fontWeight:400}}>（换入）</span>}
              </div>
              <div style={{fontSize:11,color:'#64748b',marginBottom:10}}>调到哪一期？</div>
              <div style={{maxHeight:260,overflowY:'auto',display:'flex',flexDirection:'column',gap:3}}>
                {memberModal.dates.length===0 && <div style={{fontSize:12,color:'#475569',textAlign:'center',padding:'16px 0'}}>本月无其他培训日期</div>}
                {memberModal.dates.map((d,i)=>{
                  const sel = memberModal.target?.id===d.id;
                  return (
                    <button key={i} onClick={()=>{
                      // 计算目标日期有效组员（供下一步互换选人用）
                      const ov2=d.memberOverrides||{added:[],removed:[]};
                      const removed2=new Set((ov2.removed||[]).map(r=>String(r.id||r.staff_id)));
                      const g2=d.group;
                      const base2=g2?(g2.members||[]).filter(m=>m.id!==g2.instructor_id&&!removed2.has(String(m.id))&&!(plan.fixedStaff||[]).some(f=>f.staff_id===m.id)):[];
                      const added2=(ov2.added||[]).map(a=>({id:a.id||a.staff_id,real_name:a.real_name||a.staff_name||a.name}));
                      const swapCandidates=[...base2,...added2].filter(m=>String(m.id)!==String(memberModal.staffId)).map(m=>({...m,planId:d.id,shiftDate:d.shift_date}));
                      setMemberModal(prev=>({...prev,target:{id:d.id,shift_date:d.shift_date,group_name:d.group?.name||'—'},swapCandidates,step:'pick-action'}));
                    }} style={{padding:'8px 12px',borderRadius:7,border:`1px solid ${sel?'#60a5fa':'#1b3255'}`,background:sel?'rgba(59,130,246,0.15)':'rgba(13,17,23,0.4)',color:'#e2e8f0',fontFamily:'inherit',fontSize:12,cursor:'pointer',textAlign:'left',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                      <span style={{fontWeight:600}}>{d.shift_date?.slice(5)}</span>
                      <span style={{fontSize:10,color:'#64748b'}}>{d.group?.name||'—'}</span>
                    </button>
                  );
                })}
              </div>
              <button onClick={()=>setMemberModal(null)} style={{width:'100%',marginTop:10,padding:'8px',borderRadius:7,border:'1px solid #1b3255',background:'transparent',color:'#64748b',fontFamily:'inherit',fontSize:12,cursor:'pointer'}}>取消</button>
            </>)}

            {/* 第二步：选操作方式（单独移过去 / 与对方互换） */}
            {memberModal.step==='pick-action' && memberModal.target && (<>
              <div style={{fontWeight:600,color:'#e2e8f0',fontSize:13,marginBottom:2}}>
                {memberModal.staffName} → {memberModal.target.shift_date?.slice(5)}
              </div>
              <div style={{fontSize:11,color:'#64748b',marginBottom:12}}>选择调整方式</div>
              <div style={{display:'flex',flexDirection:'column',gap:8}}>
                <button onClick={async()=>{
                  const {planId,staffId,target} = memberModal;
                  const now2=logNow();
                  const r=await apiJson('/api/admin/training-plan/member-postpone',{method:'POST',headers:hdrs(),body:JSON.stringify({from_plan_id:planId,to_plan_id:target.id,staff_id:staffId,note:`${now2} ${memberModal.staffName}延后至${target.shift_date?.slice(5)}`})}).catch(()=>null);
                  if(r?.ok){setMemberModal(null);flashCard(planId);load(month);}
                  else alert(r?.error||'操作失败');
                }} style={{padding:'11px 14px',borderRadius:8,border:'1px solid rgba(251,191,36,0.4)',background:'rgba(251,191,36,0.08)',color:'#fbbf24',fontFamily:'inherit',fontSize:13,fontWeight:600,cursor:'pointer',textAlign:'left'}}>
                  单独移过去（延后）
                  <div style={{fontSize:10,color:'rgba(251,191,36,0.5)',fontWeight:400,marginTop:2}}>{memberModal.target.shift_date?.slice(5)} · {memberModal.target.group_name} 无需给出替代</div>
                </button>
                {memberModal.swapCandidates.length>0 && (
                  <button onClick={()=>setMemberModal(prev=>({...prev,step:'pick-member',swapTarget:null}))}
                    style={{padding:'11px 14px',borderRadius:8,border:'1px solid rgba(96,165,250,0.4)',background:'rgba(59,130,246,0.08)',color:'#60a5fa',fontFamily:'inherit',fontSize:13,fontWeight:600,cursor:'pointer',textAlign:'left'}}>
                    与对方互换
                    <div style={{fontSize:10,color:'rgba(96,165,250,0.5)',fontWeight:400,marginTop:2}}>从 {memberModal.target.shift_date?.slice(5)} 选一人调回来</div>
                  </button>
                )}
              </div>
              <button onClick={()=>setMemberModal(prev=>({...prev,step:'pick-date',target:null}))} style={{width:'100%',marginTop:10,padding:'8px',borderRadius:7,border:'1px solid #1b3255',background:'transparent',color:'#64748b',fontFamily:'inherit',fontSize:12,cursor:'pointer'}}>返回</button>
            </>)}

            {/* 第三步（互换）：选对方具体成员 */}
            {memberModal.step==='pick-member' && memberModal.target && (<>
              <div style={{fontWeight:600,color:'#e2e8f0',fontSize:13,marginBottom:2}}>
                {memberModal.staffName} ↔ ?（{memberModal.target.shift_date?.slice(5)}）
              </div>
              <div style={{fontSize:11,color:'#64748b',marginBottom:10}}>选择要换回来的人</div>
              <div style={{maxHeight:240,overflowY:'auto',display:'flex',flexDirection:'column',gap:3}}>
                {memberModal.swapCandidates.map((c,i)=>{
                  const sel = memberModal.swapTarget?.id===c.id;
                  return (
                    <button key={i} onClick={()=>setMemberModal(prev=>({...prev,swapTarget:c}))} style={{padding:'8px 12px',borderRadius:7,border:`1px solid ${sel?'#60a5fa':'#1b3255'}`,background:sel?'rgba(59,130,246,0.15)':'rgba(13,17,23,0.4)',color:'#e2e8f0',fontFamily:'inherit',fontSize:12,cursor:'pointer',textAlign:'left'}}>
                      {c.real_name||c.name}
                    </button>
                  );
                })}
              </div>
              {memberModal.swapTarget && (
                <div style={{marginTop:8,padding:'7px 10px',background:'rgba(59,130,246,0.07)',borderRadius:6,border:'1px solid rgba(59,130,246,0.2)',fontSize:11,color:'#94a3b8'}}>
                  <strong style={{color:'#60a5fa'}}>{memberModal.staffName}</strong> ↔ <strong style={{color:'#60a5fa'}}>{memberModal.swapTarget.real_name||memberModal.swapTarget.name}</strong>
                </div>
              )}
              <div style={{display:'flex',gap:8,marginTop:10}}>
                <button onClick={()=>setMemberModal(prev=>({...prev,step:'pick-action',swapTarget:null}))} style={{flex:1,padding:'9px',borderRadius:7,border:'1px solid #1b3255',background:'transparent',color:'#64748b',fontFamily:'inherit',fontSize:12,cursor:'pointer'}}>返回</button>
                <button disabled={!memberModal.swapTarget} onClick={async()=>{
                  const {planId,staffId,target,swapTarget} = memberModal;
                  const now2=logNow();
                  const r=await apiJson('/api/admin/training-plan/member-swap',{method:'POST',headers:hdrs(),body:JSON.stringify({plan_id_a:planId,staff_id_a:staffId,plan_id_b:target.id,staff_id_b:swapTarget.id,note:`${now2} ${memberModal.staffName}↔${swapTarget.real_name||swapTarget.name}`})}).catch(()=>null);
                  if(r?.ok){setMemberModal(null);flashCard(planId);load(month);}
                  else alert(r?.error||'操作失败');
                }} style={{flex:2,padding:'9px',borderRadius:7,border:'none',background:'linear-gradient(135deg,#1e3a5f,#2563eb)',color:'white',fontFamily:'inherit',fontSize:13,fontWeight:600,cursor:'pointer',opacity:memberModal.swapTarget?1:0.4}}>
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
                    const now2 = logNow();
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


          </div>
        </div>
      )}

      {/* 整体对调弹窗 */}
      {swapPlanModal && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.82)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:215,padding:16}} onClick={()=>setSwapPlanModal(null)}>
          <div style={{background:'#0f2744',borderRadius:12,padding:20,width:'100%',maxWidth:340}} onClick={e=>e.stopPropagation()}>
            {swapPlanModal.step==='pick' && (<>
              <div style={{fontWeight:600,color:'#60a5fa',fontSize:13,marginBottom:2}}>⇄ 整体对调</div>
              <div style={{fontSize:11,color:'#64748b',marginBottom:10}}>将 <strong style={{color:'white'}}>{swapPlanModal.shiftDate?.slice(5)}</strong> 与哪一期对调？</div>
              <div style={{maxHeight:280,overflowY:'auto',display:'flex',flexDirection:'column',gap:3}}>
                {(plan.plans||[]).filter(x=>x.id!==swapPlanModal.planId&&x.plan_type!=='轮空').map((d,i)=>{
                  const sel=swapPlanModal.target?.id===d.id;
                  return (
                    <button key={i} onClick={()=>setSwapPlanModal(prev=>({...prev,target:{id:d.id,shift_date:d.shift_date,group_name:d.group?.name||d.plan_type},step:'confirm'}))}
                      style={{padding:'9px 12px',borderRadius:7,border:`1px solid ${sel?'#60a5fa':'#1b3255'}`,background:sel?'rgba(59,130,246,0.15)':'rgba(13,17,23,0.4)',color:'#e2e8f0',fontFamily:'inherit',fontSize:12,cursor:'pointer',textAlign:'left',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                      <span style={{fontWeight:600}}>{d.shift_date?.slice(5)}</span>
                      <span style={{fontSize:10,color:'#64748b'}}>{d.group?.name||d.plan_type}</span>
                    </button>
                  );
                })}
              </div>
              <button onClick={()=>setSwapPlanModal(null)} style={{width:'100%',marginTop:10,padding:'8px',borderRadius:7,border:'1px solid #1b3255',background:'transparent',color:'#64748b',fontFamily:'inherit',fontSize:12,cursor:'pointer'}}>取消</button>
            </>)}
            {swapPlanModal.step==='confirm' && swapPlanModal.target && (<>
              <div style={{fontWeight:600,color:'#60a5fa',fontSize:13,marginBottom:8}}>⇄ 确认对调</div>
              <div style={{padding:'12px',background:'rgba(59,130,246,0.07)',borderRadius:8,border:'1px solid rgba(59,130,246,0.2)',fontSize:13,color:'#e2e8f0',marginBottom:14,lineHeight:1.8}}>
                <strong>{swapPlanModal.shiftDate?.slice(5)}</strong> 的内容（小组·人员·教员·地点）<br/>
                ↕<br/>
                <strong>{swapPlanModal.target.shift_date?.slice(5)}</strong> 的内容（{swapPlanModal.target.group_name}）
              </div>
              <div style={{fontSize:11,color:'#64748b',marginBottom:14}}>包括所有人员调整记录，两期完全互换，操作不可撤销。</div>
              <div style={{display:'flex',gap:8}}>
                <button onClick={()=>setSwapPlanModal(prev=>({...prev,step:'pick',target:null}))} style={{flex:1,padding:'10px',borderRadius:7,border:'1px solid #1b3255',background:'transparent',color:'#64748b',fontFamily:'inherit',fontSize:13,cursor:'pointer'}}>返回</button>
                <button onClick={async()=>{
                  const r=await apiJson('/api/admin/training-plan/swap',{method:'PUT',headers:hdrs(),body:JSON.stringify({id1:swapPlanModal.planId,id2:swapPlanModal.target.id})}).catch(()=>null);
                  if(r?.ok){setSwapPlanModal(null);flashCard(swapPlanModal.planId);load(month);}
                  else alert(r?.error||'操作失败');
                }} style={{flex:2,padding:'10px',borderRadius:7,border:'none',background:'linear-gradient(135deg,#1e3a5f,#2563eb)',color:'white',fontFamily:'inherit',fontSize:13,fontWeight:700,cursor:'pointer'}}>
                  确认对调
                </button>
              </div>
            </>)}
          </div>
        </div>
      )}

      {/* 全员延后弹窗 */}
      {bulkPostponeModal && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.82)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:215,padding:16}} onClick={()=>setBulkPostponeModal(null)}>
          <div style={{background:'#0f2744',borderRadius:12,padding:20,width:'100%',maxWidth:340}} onClick={e=>e.stopPropagation()}>
            {bulkPostponeModal.step==='pick' && (<>
              <div style={{fontWeight:600,color:'#fbbf24',fontSize:13,marginBottom:2}}>→↑ 全员延后</div>
              <div style={{fontSize:11,color:'#64748b',marginBottom:10}}>将 <strong style={{color:'white'}}>{bulkPostponeModal.shiftDate?.slice(5)}</strong> 全体组员延后到哪一期？</div>
              <div style={{maxHeight:280,overflowY:'auto',display:'flex',flexDirection:'column',gap:3}}>
                {(plan.plans||[]).filter(x=>x.id!==bulkPostponeModal.planId&&x.plan_type!=='轮空'&&x.plan_type!=='中旬会'&&x.group_id).map((d,i)=>{
                  const sel=bulkPostponeModal.target?.id===d.id;
                  return (
                    <button key={i} onClick={()=>setBulkPostponeModal(prev=>({...prev,target:{id:d.id,shift_date:d.shift_date,group_name:d.group?.name||'—'},step:'confirm',setLunKong:false}))}
                      style={{padding:'9px 12px',borderRadius:7,border:`1px solid ${sel?'#fbbf24':'#1b3255'}`,background:sel?'rgba(251,191,36,0.12)':'rgba(13,17,23,0.4)',color:'#e2e8f0',fontFamily:'inherit',fontSize:12,cursor:'pointer',textAlign:'left',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                      <span style={{fontWeight:600}}>{d.shift_date?.slice(5)}</span>
                      <span style={{fontSize:10,color:'#64748b'}}>{d.group?.name||'—'}</span>
                    </button>
                  );
                })}
              </div>
              <button onClick={()=>setBulkPostponeModal(null)} style={{width:'100%',marginTop:10,padding:'8px',borderRadius:7,border:'1px solid #1b3255',background:'transparent',color:'#64748b',fontFamily:'inherit',fontSize:12,cursor:'pointer'}}>取消</button>
            </>)}
            {bulkPostponeModal.step==='confirm' && bulkPostponeModal.target && (<>
              <div style={{fontWeight:600,color:'#fbbf24',fontSize:13,marginBottom:8}}>→↑ 确认全员延后</div>
              <div style={{padding:'12px',background:'rgba(251,191,36,0.06)',borderRadius:8,border:'1px solid rgba(251,191,36,0.2)',fontSize:13,color:'#e2e8f0',marginBottom:10,lineHeight:1.8}}>
                <strong>{bulkPostponeModal.shiftDate?.slice(5)}</strong> 全体组员<br/>
                → 加入 <strong>{bulkPostponeModal.target.shift_date?.slice(5)}</strong>（{bulkPostponeModal.target.group_name}）
              </div>
              <label style={{display:'flex',alignItems:'center',gap:8,marginBottom:14,cursor:'pointer',fontSize:12,color:'#94a3b8'}}>
                <input type="checkbox" checked={bulkPostponeModal.setLunKong} onChange={e=>setBulkPostponeModal(prev=>({...prev,setLunKong:e.target.checked}))} style={{accentColor:'#fbbf24',width:14,height:14}}/>
                同时将本期改为轮空
              </label>
              <div style={{display:'flex',gap:8}}>
                <button onClick={()=>setBulkPostponeModal(prev=>({...prev,step:'pick',target:null}))} style={{flex:1,padding:'10px',borderRadius:7,border:'1px solid #1b3255',background:'transparent',color:'#64748b',fontFamily:'inherit',fontSize:13,cursor:'pointer'}}>返回</button>
                <button onClick={async()=>{
                  const {planId,target,setLunKong} = bulkPostponeModal;
                  const r=await apiJson('/api/admin/training-plan/bulk-postpone',{method:'POST',headers:hdrs(),body:JSON.stringify({from_plan_id:planId,to_plan_id:target.id})}).catch(()=>null);
                  if(!r?.ok){alert(r?.error||'操作失败');return;}
                  if(setLunKong){
                    await apiJson(`/api/admin/training-plan/${planId}`,{method:'PUT',headers:hdrs(),body:JSON.stringify({plan_type:'轮空',group_id:null,leader_name:null,log_entry:`${logNow()} 全员延后后改为轮空`})}).catch(()=>null);
                  }
                  setBulkPostponeModal(null);flashCard(planId);load(month);
                }} style={{flex:2,padding:'10px',borderRadius:7,border:'none',background:'linear-gradient(135deg,#7c5c00,#d97706)',color:'white',fontFamily:'inherit',fontSize:13,fontWeight:700,cursor:'pointer'}}>
                  确认延后
                </button>
              </div>
            </>)}
          </div>
        </div>
      )}

      {/* 教员互换弹窗 */}
      {instructorSwapModal && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.8)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:215,padding:16}} onClick={()=>setInstructorSwapModal(null)}>
          <div style={{background:'#0f2744',borderRadius:12,padding:20,width:'100%',maxWidth:360}} onClick={e=>e.stopPropagation()}>
            <div style={{fontWeight:600,color:'#e2e8f0',fontSize:13,marginBottom:4}}>
              互换教员 · {instructorSwapModal.planDate?.slice(5)}
            </div>
            <div style={{fontSize:11,color:'#475569',marginBottom:10}}>
              当前教员 <strong style={{color:'#93c5fd'}}>{instructorSwapModal.instructorName}</strong>，选择要与之互换培训的另一位教员
            </div>
            <div style={{maxHeight:280,overflowY:'auto',display:'flex',flexDirection:'column',gap:4}}>
              {instructorSwapModal.candidates.length===0 && (
                <div style={{fontSize:12,color:'#475569',textAlign:'center',padding:'16px 0'}}>无可互换计划</div>
              )}
              {instructorSwapModal.candidates.map((c,i)=>(
                <button key={i} onClick={()=>setInstructorSwapModal(prev=>({...prev,target:c}))} style={{
                  padding:'8px 12px',borderRadius:7,
                  border:`1px solid ${instructorSwapModal.target?.planId===c.planId?'#3b82f6':'#1b3255'}`,
                  background:instructorSwapModal.target?.planId===c.planId?'rgba(59,130,246,0.15)':'rgba(13,17,23,0.4)',
                  color:'#e2e8f0',fontFamily:'inherit',fontSize:12,cursor:'pointer',textAlign:'left',
                  display:'flex',justifyContent:'space-between',alignItems:'center'
                }}>
                  <span><span style={{color:'#94a3b8',marginRight:8}}>{c.shiftDate?.slice(5)}</span><strong style={{color:'#93c5fd'}}>{c.instructorName}</strong></span>
                  <span style={{fontSize:10,color:'#475569'}}>{c.groupName}</span>
                </button>
              ))}
            </div>
            {instructorSwapModal.target && (
              <div style={{marginTop:10,padding:'8px 10px',background:'rgba(59,130,246,0.08)',borderRadius:6,border:'1px solid rgba(59,130,246,0.2)',fontSize:11,color:'#94a3b8'}}>
                互换后：<br/>
                {instructorSwapModal.planDate?.slice(5)} 由 <strong style={{color:'#60a5fa'}}>{instructorSwapModal.target.instructorName}</strong> 上课<br/>
                {instructorSwapModal.target.shiftDate?.slice(5)} 由 <strong style={{color:'#60a5fa'}}>{instructorSwapModal.instructorName}</strong> 上课
              </div>
            )}
            <div style={{display:'flex',gap:8,marginTop:12}}>
              <button onClick={()=>setInstructorSwapModal(null)} style={{flex:1,padding:'9px',borderRadius:7,border:'1px solid #1b3255',background:'transparent',color:'#64748b',fontFamily:'inherit',fontSize:12,cursor:'pointer'}}>取消</button>
              <button disabled={!instructorSwapModal.target} onClick={async()=>{
                const r = await apiJson('/api/admin/training-plan/instructor-swap',{method:'POST',headers:hdrs(),body:JSON.stringify({
                  plan_id_a: instructorSwapModal.planId,
                  plan_id_b: instructorSwapModal.target.planId,
                })}).catch(()=>null);
                if(r?.ok){setInstructorSwapModal(null);load(month);}
                else alert(r?.error||'操作失败');
              }} style={{flex:2,padding:'9px',borderRadius:7,border:'none',background:'linear-gradient(135deg,#1e3a5f,#2563eb)',color:'white',fontFamily:'inherit',fontSize:13,fontWeight:600,cursor:'pointer',opacity:instructorSwapModal.target?1:0.4}}>
                确认互换
              </button>
            </div>
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

      {/* 人员点击弹卡：本月完成情况 + 培训确认 */}
      {memberCheckModal && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',display:'flex',alignItems:'flex-end',justifyContent:'center',zIndex:205}} onClick={()=>setMemberCheckModal(null)}>
          <div style={{background:'#0f2744',borderRadius:'14px 14px 0 0',padding:20,width:'100%',maxWidth:480,maxHeight:'82vh',display:'flex',flexDirection:'column'}} onClick={e=>e.stopPropagation()}>

            {/* 标题 */}
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:10}}>
              <div>
                <div style={{display:'flex',alignItems:'baseline',gap:6}}>
                  <span style={{fontWeight:700,color:'#e2e8f0',fontSize:15}}>{memberCheckModal.staffName}</span>
                  {!memberCheckLoading && memberCheckModal.monthTotal > 0 && (
                    <span style={{color:'#60a5fa',fontSize:13,fontWeight:700}}>({memberCheckModal.monthDone}/{memberCheckModal.monthTotal})</span>
                  )}
                </div>
                <div style={{fontSize:10,color:'#475569',marginTop:2}}>
                  {memberCheckModal.isFuture ? `${memberCheckModal.shiftDate} 尚未开始` : `${memberCheckModal.shiftDate} 本月完成情况`}
                </div>
              </div>
              <button onClick={()=>setMemberCheckModal(null)} style={{background:'none',border:'none',color:'#475569',fontSize:20,cursor:'pointer',padding:0,lineHeight:1}}>×</button>
            </div>

            {memberCheckLoading ? (
              <div style={{textAlign:'center',color:'#475569',padding:'30px 0',fontSize:13}}>加载中…</div>
            ) : (memberCheckModal.monthItems||[]).length === 0 ? (
              <div style={{textAlign:'center',color:'#475569',padding:'30px 0',fontSize:13}}>本月暂无培训项点</div>
            ) : (<>
              {/* 项点清单 */}
              <div style={{flex:1,overflowY:'auto',display:'flex',flexDirection:'column',gap:5,marginBottom:12}}>
                {(memberCheckModal.monthItems||[]).map((it,i)=>{
                  const alreadyDone = it.confirmed; // confirmed in another (or same) plan
                  const inPlan = (memberCheckModal.planItems||[]).includes(it.item);
                  const isSelected = (memberCheckModal.selectedItems||[]).includes(it.item);
                  const tipped = memberCheckModal.tippedItem === it.item;
                  const fmtDate = it.session_date ? `${parseInt(it.session_date.slice(5,7))}月${parseInt(it.session_date.slice(8,10))}日` : '';
                  const isInteractive = !memberCheckModal.readOnly && !alreadyDone;

                  return (
                    <div key={i} onClick={()=>{
                      if (memberCheckModal.readOnly) {
                        if (!alreadyDone) {
                          setMemberCheckModal(prev=>({...prev,tippedItem:it.item}));
                          setTimeout(()=>setMemberCheckModal(prev=>prev?({...prev,tippedItem:null}):prev),1500);
                        }
                        return;
                      }
                      if (alreadyDone) return; // 已在其他场次确认，不可改
                      setMemberCheckModal(prev=>{
                        const cur = prev.selectedItems||[];
                        const next = cur.includes(it.item) ? cur.filter(x=>x!==it.item) : [...cur, it.item];
                        return {...prev, selectedItems:next};
                      });
                    }} style={{
                      display:'flex',alignItems:'flex-start',gap:10,
                      padding:'9px 12px',borderRadius:8,cursor:isInteractive?'pointer':alreadyDone?'default':'pointer',
                      border:`1px solid ${alreadyDone?'rgba(34,197,94,0.35)':isSelected?'rgba(96,165,250,0.4)':tipped?'rgba(251,191,36,0.4)':'rgba(27,50,85,0.7)'}`,
                      background:alreadyDone?'rgba(34,197,94,0.06)':isSelected?'rgba(96,165,250,0.06)':tipped?'rgba(251,191,36,0.04)':'rgba(13,17,23,0.3)',
                      transition:'border-color 0.15s,background 0.15s'
                    }}>
                      {/* 勾选框 / 状态图标 */}
                      <div style={{flexShrink:0,marginTop:1,width:18,height:18,borderRadius:4,display:'flex',alignItems:'center',justifyContent:'center',
                        border:alreadyDone?'none':'1px solid '+(isSelected?'#60a5fa':'#334155'),
                        background:alreadyDone?'transparent':isSelected?'rgba(96,165,250,0.15)':'transparent',
                        fontSize:12
                      }}>
                        {alreadyDone ? '✅' : isSelected ? '✓' : ''}
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:12,color:alreadyDone?'#86efac':isSelected?'#93c5fd':'#94a3b8',fontWeight:alreadyDone||isSelected?600:400,lineHeight:1.4}}>
                          {it.item}
                          {inPlan && !alreadyDone && <span style={{marginLeft:5,fontSize:9,color:'#475569',fontWeight:400}}>本次项点</span>}
                        </div>
                        {alreadyDone && fmtDate && (
                          <div style={{fontSize:10,color:'#475569',marginTop:2}}>{fmtDate}{it.confirmed_by ? ` · ${it.confirmed_by}` : ''}</div>
                        )}
                        {tipped && <div style={{fontSize:10,color:'#fbbf24',marginTop:2}}>⏰ 未到培训时间</div>}
                        {alreadyDone && it.has_comment && <div style={{fontSize:10,color:'#22c55e',marginTop:2}}>已填写评价</div>}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 评价输入框（step=comment 时显示） */}
              {memberCheckModal.step === 'comment' && !memberCheckModal.readOnly && (
                <textarea
                  value={memberCheckModal.comment}
                  onChange={e=>setMemberCheckModal(prev=>({...prev,comment:e.target.value}))}
                  placeholder="填写本次培训情况、表现要点或改进建议…"
                  rows={3}
                  autoFocus
                  style={{width:'100%',boxSizing:'border-box',background:'#0d1e35',border:'1px solid #1b3255',borderRadius:8,padding:'10px',color:'white',fontSize:13,fontFamily:'inherit',outline:'none',resize:'none',marginBottom:10}}
                />
              )}

              {/* 底部按钮 */}
              {!memberCheckModal.readOnly && (
                <div style={{display:'flex',gap:8,flexShrink:0}}>
                  {memberCheckModal.step === 'check' ? (<>
                    {memberCheckModal.hasEvaluated && (
                      <button disabled={memberCheckModal.saving} onClick={async()=>{
                        if(!window.confirm(`撤销 ${memberCheckModal.staffName} 的本场培训确认？`)) return;
                        setMemberCheckModal(prev=>({...prev,saving:true}));
                        const {planId,staffId} = memberCheckModal;
                        const r = await apiJson(`/api/workshop/training-plan/${planId}/evaluations/${staffId}`,{method:'DELETE',headers:hdrs()}).catch(()=>null);
                        setMemberCheckModal(null);
                        if(r?.ok) load(month); else alert('撤销失败');
                      }} style={{flex:1,padding:'11px',borderRadius:8,border:'1px solid rgba(239,68,68,0.4)',background:'transparent',color:'#fca5a5',fontFamily:'inherit',fontSize:13,fontWeight:600,cursor:'pointer',opacity:memberCheckModal.saving?0.6:1}}>
                        撤销确认
                      </button>
                    )}
                    <button onClick={()=>setMemberCheckModal(prev=>({...prev,step:'comment'}))} style={{flex:1,padding:'11px',borderRadius:8,border:'1px solid rgba(148,163,184,0.25)',background:'transparent',color:'#94a3b8',fontFamily:'inherit',fontSize:13,cursor:'pointer'}}>
                      💬 评价
                    </button>
                    <button disabled={memberCheckModal.saving} onClick={async()=>{
                      setMemberCheckModal(prev=>({...prev,saving:true}));
                      const {planId,staffId,staffName,selectedItems,comment} = memberCheckModal;
                      await apiJson(`/api/workshop/training-plan/${planId}/completed-items`,{method:'PATCH',headers:hdrs(),body:JSON.stringify({items:selectedItems||[]})}).catch(()=>{});
                      const r = await apiJson(`/api/workshop/training-plan/${planId}/evaluations/${staffId}`,{method:'PUT',headers:hdrs(),body:JSON.stringify({staff_name:staffName,comment:comment||''})}).catch(()=>null);
                      setMemberCheckModal(null);
                      if(r?.ok) load(month);
                    }} style={{flex:2,padding:'11px',borderRadius:8,border:'none',background:'linear-gradient(135deg,#14532d,#16a34a)',color:'white',fontFamily:'inherit',fontSize:13,fontWeight:600,cursor:'pointer',opacity:memberCheckModal.saving?0.6:1}}>
                      {memberCheckModal.saving ? '保存中…' : `✅ 培训（${(memberCheckModal.selectedItems||[]).length}项）`}
                    </button>
                  </>) : (<>
                    <button onClick={()=>setMemberCheckModal(prev=>({...prev,step:'check'}))} style={{flex:1,padding:'11px',borderRadius:8,border:'1px solid #1b3255',background:'transparent',color:'#64748b',fontFamily:'inherit',fontSize:13,cursor:'pointer'}}>返回</button>
                    <button disabled={memberCheckModal.saving} onClick={async()=>{
                      setMemberCheckModal(prev=>({...prev,saving:true}));
                      const {planId,staffId,staffName,selectedItems,comment} = memberCheckModal;
                      await apiJson(`/api/workshop/training-plan/${planId}/completed-items`,{method:'PATCH',headers:hdrs(),body:JSON.stringify({items:selectedItems||[]})}).catch(()=>{});
                      const r = await apiJson(`/api/workshop/training-plan/${planId}/evaluations/${staffId}`,{method:'PUT',headers:hdrs(),body:JSON.stringify({staff_name:staffName,comment:comment||''})}).catch(()=>null);
                      setMemberCheckModal(null);
                      if(r?.ok) load(month);
                    }} style={{flex:2,padding:'11px',borderRadius:8,border:'none',background:'linear-gradient(135deg,#14532d,#16a34a)',color:'white',fontFamily:'inherit',fontSize:13,fontWeight:600,cursor:'pointer',opacity:memberCheckModal.saving?0.6:1}}>
                      {memberCheckModal.saving ? '保存中…' : '✅ 确认培训'}
                    </button>
                  </>)}
                </div>
              )}
            </>)}
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
                    <button key={i} onClick={async()=>{
                      const staffId = m.id;
                      const staffName = m.real_name || m.name;
                      const curMonth = evalModal.shiftDate.slice(0,7);
                      const data = await apiJson(`/api/workshop/member-month-items?staff_id=${staffId}&month=${curMonth}`).catch(()=>null);
                      setEvalModal(prev=>({...prev,step:'eval',target:{staffId,staffName},comment:ev?.comment||'',memberItems:data?.items||[],memberTotal:data?.total||0,memberDone:data?.done||0}));
                    }} style={{
                      padding:'10px 14px',borderRadius:8,border:`1px solid ${ev?'rgba(34,197,94,0.4)':'#1b3255'}`,
                      background:ev?'rgba(34,197,94,0.07)':'rgba(13,17,23,0.4)',
                      color:'#e2e8f0',fontFamily:'inherit',fontSize:13,cursor:'pointer',
                      textAlign:'left',display:'flex',justifyContent:'space-between',alignItems:'center'
                    }}>
                      <span style={{fontWeight:600,color:ev?'#22c55e':'#f87171'}}>{m.real_name||m.name}</span>
                      {ev ? (
                        <span style={{fontSize:10,color:'#22c55e'}}>✓ 已点评{ev.comment?'':' (无评价)'}</span>
                      ) : (
                        <span style={{fontSize:10,color:'#f87171'}}>待确认</span>
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
              {(evalModal.memberItems||[]).length > 0 && (
                <div style={{marginBottom:12,borderRadius:7,border:'1px solid rgba(27,50,85,0.7)',background:'rgba(0,0,0,0.2)',padding:'8px 10px'}}>
                  <div style={{display:'flex',alignItems:'baseline',gap:6,marginBottom:6}}>
                    <span style={{fontSize:10,color:'#60a5fa',fontWeight:600}}>本月完成情况</span>
                    <span style={{fontSize:11,color:'#60a5fa',fontWeight:700}}>({evalModal.memberDone||0}/{evalModal.memberTotal||0})</span>
                  </div>
                  <div style={{display:'flex',flexDirection:'column',gap:3,maxHeight:110,overflowY:'auto'}}>
                    {(evalModal.memberItems||[]).map((it,i)=>{
                      const fmtDate = it.session_date ? `${parseInt(it.session_date.slice(5,7))}月${parseInt(it.session_date.slice(8,10))}日` : '';
                      return (
                        <div key={i} style={{display:'flex',alignItems:'center',gap:6}}>
                          <span style={{fontSize:11,color:'#94a3b8',flex:1}}>{it.item}</span>
                          <span style={{fontSize:12}}>{it.confirmed?'✅':'❌'}</span>
                          {it.confirmed ? (it.has_comment ? <span style={{fontSize:12}}>✅</span> : <span style={{fontSize:9,color:'#475569'}}>未评价</span>) : <span style={{fontSize:12}}>❌</span>}
                          {fmtDate && <span style={{fontSize:9,color:'#475569'}}>{fmtDate}</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
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
                {evalModal.evaluations[evalModal.target.staffId] && (
                  <button disabled={evalModal.saving} onClick={async()=>{
                    if(!window.confirm(`撤销 ${evalModal.target.staffName} 的本场培训确认？`)) return;
                    setEvalModal(prev=>({...prev,saving:true}));
                    const {planId,target} = evalModal;
                    const r = await apiJson(`/api/workshop/training-plan/${planId}/evaluations/${target.staffId}`,{
                      method:'DELETE', headers:hdrs()
                    }).catch(()=>null);
                    if(r?.ok){
                      const evals = await apiJson(`/api/workshop/training-plan/${planId}/evaluations`).catch(()=>[]);
                      const evMap={};
                      (Array.isArray(evals)?evals:[]).forEach(e=>{evMap[e.staff_id]=e;});
                      setEvalModal(prev=>({...prev,saving:false,step:'pick',target:null,evaluations:evMap}));
                    } else {
                      setEvalModal(prev=>({...prev,saving:false}));
                      alert('撤销失败');
                    }
                  }} style={{flex:1,padding:'10px',borderRadius:8,border:'1px solid rgba(239,68,68,0.4)',background:'transparent',color:'#fca5a5',fontFamily:'inherit',fontSize:13,fontWeight:600,cursor:'pointer',opacity:evalModal.saving?0.6:1}}>
                    撤销确认
                  </button>
                )}
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

export default WorkshopScreen;
