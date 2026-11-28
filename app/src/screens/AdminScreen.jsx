import { useState, useEffect, useRef, useMemo } from "react";
import { api, apiJson, adminHeaders, AppModal, Badge, ScoreRing, MiniBar, SHOW_LEADERBOARD, SHOW_WALL } from "../shared.jsx";
// 题库子组件与常量（2026-11-27 从本文件抽出）
import {
  BankTypeSelect, AddQuestionPanel, BankImportCard, DocParseCard,
  ManualEntryForm, ExcelImportForm, ImportPlanCard,
} from "./admin/QuestionBankParts.jsx";
import { BANK_TYPES, BANK_TYPE_MAP, groupBanksByType } from "./admin/bankConstants.js";

// 人员 tab 子组件（2026-11-27 从本文件抽出）
import { MembersTab, TrainingGroupsSection } from "./admin/MembersParts.jsx";
import { LeaveTab, DevicesTab, LogsTab } from "./admin/SimpleTabParts.jsx";
import LeaveOverview from "./admin/LeaveOverview.jsx";
// 概览区弹窗（2026-11-27 Stage 3 从本文件抽出）
import {
  MemberEvalModal, ResetAnswerModal, MakeupGrantModal, RemediationGrantModal, PlanDetailModal,
  AdminDrillModal,
} from "./admin/OverviewModals.jsx";
// 导出记录三个面板（2026-11-27 抽出）
import { ExportMainPanel, WorkshopMultiMonthPanel, WorkshopPlansPanel } from "./admin/ExportPanels.jsx";

// 供下拉选择框使用的分组 select
// 管理后台 tab 列表。留言墙由 SHOW_WALL 控制（2026-11-28 老韩决定隐藏：
// 上线后只有 5 条测试数据，组员没用起来）。代码保留，改回 true 即恢复。
const TABS = [
  ['overview','概览'],['members','人员'],['leave','休假'],['banks','题库'],
  ...(SHOW_WALL ? [['wall','留言']] : []),
  ['settings','设置'],['logs','日志'],['devices','设备'],['qr','扫码'],
];

function AdminScreen({ onBack }) {
  const [authed,setAuthed]=useState(()=>!!localStorage.getItem('admin_pwd'));
  const [pwd,setPwd]=useState(()=>localStorage.getItem('admin_pwd')||'');
  const [pwdErr,setPwdErr]=useState('');
  const [tab,setTab]=useState('overview');
  const [wallPosts,setWallPosts]=useState([]);
  const [leavePending,setLeavePending]=useState([]);
  const [leavePendLoading,setLeavePendLoading]=useState(false);
  // 周报批清单
  const [weekBatch,setWeekBatch]=useState(null);
  const [weekLoading,setWeekLoading]=useState(false);
  const [weekAnchor,setWeekAnchor]=useState('');   // 空=默认下周

  const loadWeekBatch = (week) => {
    setWeekLoading(true);
    const q = week ? `?week=${week}` : '';
    apiJson('/api/leave/week-batch'+q,{headers:hdrs()})
      .then(d=>{ if(d?.error) alert('加载失败：'+d.error); else setWeekBatch(d); })
      .catch(e=>alert('加载失败：'+e))
      .finally(()=>setWeekLoading(false));
  };

  const markReported = async () => {
    if(!weekBatch) return;
    if(!confirm(`确认「${weekBatch.week_start} ~ ${weekBatch.week_end}」已报车场组？\n本周已批准的休假会推进到「已报车场组」。`)) return;
    try{
      const r = await apiJson('/api/leave/week-batch/report',{
        method:'POST', headers:hdrs(),
        body: JSON.stringify({ week_start: weekBatch.week_start }),
      });
      if(r?.error) alert('操作失败：'+r.error);
      else { alert(`已标记 ${r.reported_at}，推进 ${r.advanced} 条记录`); loadWeekBatch(weekAnchor||undefined); loadLeavePending(); }
    }catch(e){ alert('操作失败：'+e); }
  };

  const copyBatchText = async () => {
    if(!weekBatch?.text) return;
    try{
      await navigator.clipboard.writeText(weekBatch.text);
      alert('已复制，可直接粘贴到车场组群里');
    }catch(e){
      // 兜底：选中文本让用户手动复制
      const ta=document.createElement('textarea');
      ta.value=weekBatch.text; document.body.appendChild(ta); ta.select();
      try{ document.execCommand('copy'); alert('已复制'); }catch(_){ alert('复制失败，请手动长按选择'); }
      document.body.removeChild(ta);
    }
  };

  const loadLeavePending = () => {
    setLeavePendLoading(true);
    apiJson('/api/leave/pending',{headers:hdrs()})
      .then(d=>setLeavePending(d?.records||[]))
      .catch(()=>setLeavePending([]))
      .finally(()=>setLeavePendLoading(false));
  };

  const reviewLeave = async (id, action, reason) => {
    try {
      const r = await apiJson(`/api/leave/${id}/review`, {
        method:'POST', headers:hdrs(),
        body: JSON.stringify({ action, reason }),
      });
      if (r?.error) alert('操作失败：'+r.error);
      else { setRejectModal(null); setRejectReason(''); loadLeavePending(); }
    } catch(e) { alert('操作失败：'+e); }
  };
  const [rejectModal,setRejectModal]=useState(null);
  const [rejectReason,setRejectReason]=useState('');
  const [wallLoaded,setWallLoaded]=useState(false);
  const [overview,setOverview]=useState(null);
  const [members,setMembers]=useState([]);
  const [selectedMember,setSelectedMember]=useState(null);
  const [memberDetail,setMemberDetail]=useState(null);
  const [banks,setBanks]=useState([]);
  const [settings,setSettings]=useState({});
  const [qr,setQr]=useState(null);
  const [logs,setLogs]=useState([]);
  const [devices,setDevices]=useState(null);   // 登录/答题设备留痕
  const [lbSessions,setLbSessions]=useState([]);
  const [lbSessionsAlltime,setLbSessionsAlltime]=useState([]);
  const [lbMode,setLbMode]=useState('cycle'); // 'cycle'|'alltime'
  const [weakQuestions,setWeakQuestions]=useState([]);
  const [incompleteExpanded,setIncompleteExpanded]=useState(false);
  const [lbCollapsed,setLbCollapsed]=useState(true);
  const [staffListCollapsed,setStaffListCollapsed]=useState(true);
  const [resetModal,setResetModal]=useState(null); // null or {staff_id, name}
  const [makeupModal,setMakeupModal]=useState(null); // null or {staff_id, name}
  const [remediationModal,setRemediationModal]=useState(null); // null or {staff_id, name, score, original_score, remediation_result}
  const [remRecords,setRemRecords]=useState([]); // 复查台账
  const [remMonth,setRemMonth]=useState(()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}).slice(0,7));
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
  const [quizExportSel,setQuizExportSel]=useState(new Set()); // 抽问记录多月勾选
  const [wsMultiMonthSel,setWsMultiMonthSel]=useState(null); // null | {months:[], selected:Set}
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
  const [pinScope,setPinScope]=useState('shift');
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
  const [manualPickExpanded,setManualPickExpanded]=useState({}); // 手动选题：题库展开状态
  const [bankSectionOpen,setBankSectionOpen]=useState({});
  const [bankSubTab,setBankSubTab]=useState('quiz'); // 'quiz' | 'manage'
  const [editQModal,setEditQModal]=useState(null); // {id,bankId,text,reference,keywords,category}
  const [renamingBank,setRenamingBank]=useState(null); // {id, name}
  const [checkedBankIds,setCheckedBankIds]=useState([]);
  // 上传/人工出题面板
  const [addMode,setAddMode]=useState(null); // null | 'media' | 'manual' | 'excel'
  const [pinFormOpen,setPinFormOpen]=useState(false);
  const [pinCancelModal,setPinCancelModal]=useState(false);
  const [quizCat,setQuizCat]=useState(null);   // 新版选题来源分类
  const [quizBankId,setQuizBankId]=useState(null); // null=整类随机, '<id>'=指定题库
  const [multiBankIds,setMultiBankIds]=useState([]); // 多选题库（跨分类均衡随机）
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
    if(tab==='overview'){apiJson('/api/admin/overview',{headers:hdrs()}).then(setOverview).catch(()=>{});apiJson('/api/admin/leaderboard/cycle',{headers:hdrs()}).then(d=>setLbSessions(d.rows||[])).catch(()=>{});apiJson('/api/admin/leaderboard/alltime',{headers:hdrs()}).then(d=>setLbSessionsAlltime(Array.isArray(d)?d:(d.rows||[]))).catch(()=>{});apiJson('/api/admin/weak-questions',{headers:hdrs()}).then(setWeakQuestions).catch(()=>{});apiJson('/api/export/months',{headers:hdrs()}).then(setExportMonths).catch(()=>{});apiJson('/api/admin/month-plan-completion',{headers:hdrs()}).then(setMonthPlanCompletion).catch(()=>{});apiJson('/api/admin/month-member-completion',{headers:hdrs()}).then(setMonthMemberCompletion).catch(()=>{});apiJson('/api/admin/remediation/records',{headers:hdrs()}).then(setRemRecords).catch(()=>{});}
    if(tab==='members')apiJson('/api/admin/members',{headers:hdrs()}).then(setMembers).catch(()=>{});
    if(tab==='banks'){apiJson('/api/banks',{headers:hdrs()}).then(d=>{setBanks(d);if(d.length>0){setAiBankId(String(d[0].id));setPinFallback(String(d[0].id));}const manualBank=d.find(b=>b.name==='人工提问');if(manualBank)setAddQ(q=>({...q,bank_id:String(manualBank.id)}));}).catch(()=>{});apiJson('/api/settings',{headers:hdrs()}).then(setSettings).catch(()=>{});apiJson('/api/admin/pinned-questions',{headers:hdrs()}).then(d=>{setQPinned(d);setQSelected(d.ids||[]);setPinScope(d.scope==='none'?'shift':d.scope);setPinFallback(d.bank_fallback_id?String(d.bank_fallback_id):'');setPinCount(d.count||3);setPinMode(d.bank_ids?.length>0?'manual':d.mode||'emergency');setPinRandomBankId(d.bank_id||null);setCheckedBankIds(d.bank_ids||[]);setMultiBankIds(d.bank_ids||[]);}).catch(()=>{});}
    if(tab==='leave'){ loadLeavePending(); loadWeekBatch(weekAnchor||undefined); }
    if(SHOW_WALL && tab==='wall'){ apiJson('/api/wall/admin/posts',{headers:hdrs()}).then(d=>{setWallPosts(d?.posts||[]);setWallLoaded(true);}).catch(()=>{setWallPosts([]);setWallLoaded(true);}); }
    if(tab==='qr')apiJson('/api/qrcode').then(setQr).catch(()=>{});
    if(tab==='logs')apiJson('/api/admin/logs',{headers:hdrs()}).then(setLogs).catch(()=>{});
    if(tab==='devices')apiJson('/api/admin/login-devices?days=7',{headers:hdrs()}).then(setDevices).catch(()=>{});
  },[tab,authed]);
  useEffect(()=>{
    if(!authed||tab!=='overview')return;
    apiJson(`/api/admin/remediation/records?month=${remMonth}`,{headers:hdrs()}).then(setRemRecords).catch(()=>{});
  },[remMonth,authed,tab]);

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
        <div className="brand"><div className="brand-icon">🛠</div><div><div style={{fontSize:16,fontWeight:700,color:'var(--text)'}}>管理员后台</div><div style={{fontSize:11,color:'var(--muted)'}}>武汉地铁5号线</div></div></div>
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
      <div className="page-header"><button className="back-btn" onClick={onBack}>←</button><h2>管理员后台</h2><button onClick={logout} style={{fontSize:11,color:'var(--muted)',background:'none',border:'1px solid var(--border)',borderRadius:5,padding:'3px 9px',cursor:'pointer'}}>退出登录</button></div>
      <div className="tab-row" style={{flexWrap:'wrap',gap:5}}>
        {TABS.map(([k,v])=>(
          <button key={k} className={`tab${tab===k?' active':''}`} style={{flex:'none',padding:'7px 12px'}} onClick={()=>setTab(k)}>{v}</button>
        ))}
      </div>
      <div style={{padding:'12px 14px 28px',display:'flex',flexDirection:'column',gap:12,overflowY:'auto'}}>

        {tab==='overview'&&overview&&<>

          {/* ── 本套班完成情况 ── */}
          <div className="card" style={{padding:0,overflow:'hidden'}}>
            <div style={{padding:'14px 16px 12px'}}>
              <div style={{fontSize:11,color:'var(--muted)',letterSpacing:2,fontWeight:600,marginBottom:10,textTransform:'uppercase'}}>本套班完成情况</div>
              <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:10}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:30,fontWeight:900,color:'var(--text)',lineHeight:1}}>{overview.todayComplete}<span style={{fontSize:12,color:'var(--muted)',fontWeight:400,marginLeft:5}}>/ {overview.totalStaff} 人</span></div>
                  {overview.incompleteList?.length>0
                    ? <div style={{fontSize:11,color:'var(--amber)',marginTop:4}}>还差 {overview.incompleteList.length} 人未完成</div>
                    : <div style={{fontSize:11,color:'var(--green)',marginTop:4}}>全部完成 ✓</div>
                  }
                </div>
                <ScoreRing score={Math.round((overview.todayComplete/Math.max(overview.totalStaff,1))*100)} size={62}/>
                <button onClick={pushDingtalk} disabled={dingtalkLoading} style={{flexShrink:0,display:'flex',flexDirection:'column',alignItems:'center',gap:3,padding:'8px 10px',background:dingtalkLoading?'var(--p-blue-60-a10)':'var(--p-blue-60-a15)',border:'1px solid var(--p-blue-60-a35)',borderRadius:10,color:dingtalkLoading?'var(--muted)':'var(--p-blue-68)',fontSize:11,cursor:dingtalkLoading?'not-allowed':'pointer',lineHeight:1.3,minWidth:48}}>
                  <span style={{fontSize:18}}>{dingtalkLoading?'⏳':'📤'}</span>
                  <span>推送</span>
                  <span>钉钉</span>
                </button>
              </div>
              <div style={{height:5,background:'var(--p-navy-17)',borderRadius:3,overflow:'hidden'}}>
                <div style={{height:'100%',width:`${(overview.todayComplete/Math.max(overview.totalStaff,1))*100}%`,background:'linear-gradient(90deg,var(--blue),var(--green))',borderRadius:3,transition:'width 0.8s ease'}}/>
              </div>
            </div>
            {overview.allStaff?.length>0&&(()=>{
              // Sort: none(staff_id desc) → interrupted/browsed(staff_id desc) → done(completed_at asc, earliest last)
              const noneGroup=[...overview.allStaff.filter(p=>p.status==='none')].sort((a,b)=>b.staff_id.localeCompare(a.staff_id));
              const midGroup=[...overview.allStaff.filter(p=>p.status==='interrupted'||p.status==='browsed'||p.status==='answering')].sort((a,b)=>b.staff_id.localeCompare(a.staff_id));
              const doneGroup=[...overview.allStaff.filter(p=>p.status==='done')].sort((a,b)=>(b.completed_at||'').localeCompare(a.completed_at||''));
              const sorted=[...noneGroup,...midGroup,...doneGroup];
              return(
                <div style={{borderTop:'1px solid var(--border)',padding:'10px 12px 10px'}}>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'5px 6px'}}>
                    {(staffListCollapsed?sorted.slice(0,12):sorted).map((p,ni)=>{
                      const isDone=p.status==='done';
                      const isAnswering=p.status==='answering';
                      const isInt=p.status==='interrupted';
                      const isBrowse=p.status==='browsed';
                      const isOverdue=p.overdue&&p.status==='none';
                      // 已完成但不合格（需复查）：分数<60且无已通过的复查
                      const needsRemediation=isDone&&(p.score??100)<60&&p.remediation_result!=='pass';
                      const hasRemediationPending=p.remediation_result==='pending'&&p.has_remediation; // 已授权复查(进行中)，独立于是否已完成(原始session被删后仍可识别)
                      const hasRemediationFail=isDone&&p.remediation_result==='fail';
                      const hasRemediationPass=isDone&&p.remediation_result==='pass';
                      const nameCol=needsRemediation&&!hasRemediationPending?'var(--p-red-51)':hasRemediationPending?'var(--p-purple-65)':hasRemediationFail?'var(--p-red-51)':hasRemediationPass?'var(--green)':isDone?'var(--green)':isAnswering?'var(--blue)':isInt||isBrowse?'var(--amber)':isOverdue?'var(--p-amber-53)':'var(--red)';
                      const bg=needsRemediation&&!hasRemediationPending?'var(--p-red-51-a08)':hasRemediationPending?'var(--p-purple-65-a08)':hasRemediationFail?'var(--p-red-51-a08)':isDone?'var(--p-green-45-a06)':isAnswering?'var(--p-blue-60-a08)':isInt||isBrowse?'var(--p-amber-50-a06)':isOverdue?'var(--p-amber-53-a07)':'var(--p-red-60-a05)';
                      const border=needsRemediation&&!hasRemediationPending?'var(--p-red-51-a30)':hasRemediationPending?'var(--p-purple-65-a35)':hasRemediationFail?'var(--p-red-51-a30)':isDone?'var(--p-green-45-a18)':isAnswering?'var(--p-blue-60-a35)':isInt||isBrowse?'var(--p-amber-50-a20)':isOverdue?'var(--p-amber-53-a25)':'var(--p-red-60-a12)';
                      const clickable=isDone||hasRemediationPending||isAnswering||isInt||isBrowse||isOverdue;
                      const subLabel=needsRemediation&&!hasRemediationPending?`${p.score??'—'}分 需复查 ›`:hasRemediationPending?`${p.original_score??'—'}分 复查中 ›`:hasRemediationFail?`复查${Math.round(p.score??0)}分❌ ›`:hasRemediationPass?`复查${Math.round(p.score??0)}分✅ ›`:isDone?`${p.score??'—'}分 ›`:isAnswering?'答题中 ›':isInt?'中断 ›':isBrowse?'浏览 ›':isOverdue?'逾期 ›':'未答';
                      return(
                        <div key={ni} onClick={()=>{
                          if(hasRemediationPending) setRemediationModal({staff_id:p.staff_id,name:p.name,score:p.original_score??p.score,original_score:p.original_score,remediation_result:p.remediation_result});
                          else if(isDone&&needsRemediation&&!hasRemediationPending) setRemediationModal({staff_id:p.staff_id,name:p.name,score:p.score,original_score:p.original_score,remediation_result:p.remediation_result});
                          else if(isDone) setResetModal({staff_id:p.staff_id,name:p.name,score:p.score,completed_at:p.completed_at,isDone:true});
                          else if(isAnswering) setResetModal({staff_id:p.staff_id,name:p.name,isAnswering:true,last_active_at:p.last_active_at});
                          else if(isInt||isBrowse) setResetModal({staff_id:p.staff_id,name:p.name});
                          else if(isOverdue) setMakeupModal({staff_id:p.staff_id,name:p.name});
                        }}
                          style={{display:'flex',flexDirection:'column',gap:1,padding:'5px 7px',background:bg,border:`1px solid ${border}`,borderRadius:6,minWidth:0,cursor:clickable?'pointer':'default'}}>
                          <div style={{fontSize:11,color:nameCol,fontWeight:700,lineHeight:1.3,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.name}</div>
                          <div style={{fontSize:11,color:'var(--muted)',lineHeight:1.2}}>{subLabel}</div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{display:'flex',gap:10,marginTop:8,fontSize:11,color:'var(--muted)',flexWrap:'wrap'}}>
                    <span style={{color:'var(--green)'}}>● 已完成</span>
                    <span style={{color:'var(--blue)'}}>● 答题中（10分钟内有动作）</span>
                    <span style={{color:'var(--amber)'}}>● 中断/浏览（可点击重置）</span>
                    <span style={{color:'var(--red)'}}>● 未答题</span>
                    <span style={{color:'var(--p-amber-53)'}}>● 逾期（可点击补答）</span>
                    <span style={{color:'var(--p-red-51)'}}>● 不合格（可点击授权复查）</span>
                    <span style={{color:'var(--p-purple-65)'}}>● 复查进行中</span>
                  </div>
                  {sorted.length>12&&(
                    <div onClick={()=>setStaffListCollapsed(c=>!c)} style={{display:'flex',alignItems:'center',justifyContent:'center',gap:6,marginTop:8,padding:'7px 0',cursor:'pointer',borderTop:'1px solid var(--p-navy-22-a40)',color:'var(--p-blue-68)',fontSize:12,fontWeight:600}}>
                      <span style={{display:'inline-block',transform:staffListCollapsed?'none':'rotate(180deg)',transition:'transform 0.2s',fontSize:14}}>⌄</span>
                      {staffListCollapsed?`展开全部 (共 ${sorted.length} 人)`:'收起'}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {/* ── 重置答题机会弹窗 ── */}
          {/* ── 重置答题弹窗（已抽到 admin/OverviewModals.jsx）── */}
          <ResetAnswerModal
            modal={resetModal}
            hdrs={hdrs}
            onClose={()=>setResetModal(null)}
            onDone={()=>{
              apiJson('/api/admin/overview',{headers:hdrs()}).then(setOverview).catch(()=>{});
              const ep=lbMode==='alltime'?'/api/admin/leaderboard/alltime':'/api/admin/leaderboard/cycle';
              apiJson(ep,{headers:hdrs()}).then(d=>setLbSessions(d.rows||d||[])).catch(()=>{});
            }}
          />

          {/* ── 补答授权弹窗 ── */}
          {/* ── 补答授权弹窗（已抽到 admin/OverviewModals.jsx）── */}
          <MakeupGrantModal modal={makeupModal} hdrs={hdrs} onClose={()=>setMakeupModal(null)}/>

          {/* ── 授权复查弹窗 ── */}
          {/* ── 授权复查弹窗（已抽到 admin/OverviewModals.jsx）── */}
          <RemediationGrantModal
            modal={remediationModal}
            hdrs={hdrs}
            onClose={()=>setRemediationModal(null)}
            onDone={()=>{
              apiJson('/api/admin/overview',{headers:hdrs()}).then(setOverview).catch(()=>{});
              apiJson('/api/admin/remediation/records',{headers:hdrs()}).then(setRemRecords).catch(()=>{});
            }}
          />

          {/* ── 复查台账 ── */}
          {(()=>{
            const doExport=()=>{
              const url=`/api/admin/remediation/export?months=${remMonth}&password=${encodeURIComponent(pwd)}`;
              const a=document.createElement('a'); a.href=url; a.download=''; a.click();
            };
            const doPushRemediation=async()=>{
              const hasCompleted=remRecords.some(r=>r.result!=='pending');
              if(!hasCompleted){alert('本轮暂无已完成的复查记录，无需推送');return;}
              if(!window.confirm('推送本轮复查结果到钉钉群？'))return;
              const r=await apiJson('/api/admin/dingtalk/notify-remediation',{method:'POST',headers:hdrs()}).catch(()=>null);
              if(r?.ok) alert(`已推送复查结果（${r.passCount}人合格 / ${r.failCount}人不合格）`);
              else alert('推送失败：'+(r?.error||'网络错误'));
            };
            return(
              <div style={{background:'var(--card)',borderRadius:10,padding:'12px 14px',marginBottom:14,border:'1px solid var(--p-purple-65-a20)'}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
                  <span style={{fontSize:12,fontWeight:700,color:'var(--p-purple-65)'}}>⚠️ 复查台账</span>
                  <div style={{display:'flex',gap:6,alignItems:'center'}}>
                    <input type="month" value={remMonth} onChange={e=>setRemMonth(e.target.value)}
                      style={{background:'var(--card-deep)',border:'1px solid var(--border)',borderRadius:5,color:'var(--text)',fontSize:11,padding:'2px 6px',fontFamily:'inherit'}}/>
                    {remRecords.some(r=>r.result!=='pending')&&(
                      <button onClick={doPushRemediation} style={{padding:'3px 10px',borderRadius:5,border:'1px solid var(--p-green-45-a40)',background:'var(--p-green-45-a08)',color:'var(--green)',cursor:'pointer',fontSize:11,fontWeight:600,fontFamily:'inherit'}}>📣 推送结果</button>
                    )}
                    <button onClick={doExport} style={{padding:'3px 10px',borderRadius:5,border:'1px solid var(--p-purple-65-a40)',background:'var(--p-purple-65-a10)',color:'var(--p-purple-65)',cursor:'pointer',fontSize:11,fontWeight:600,fontFamily:'inherit'}}>↓ 导出</button>
                  </div>
                </div>
                {remRecords.length===0
                  ? <div style={{fontSize:11,color:'var(--muted)',textAlign:'center',padding:'8px 0'}}>{remMonth} 暂无复查记录</div>
                  : remRecords.map((r,i)=>(
                    <div key={i} style={{padding:'8px 0',borderTop:i>0?'1px solid var(--border)':undefined}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}>
                        <span style={{fontSize:12,fontWeight:700,color:'var(--text)'}}>{r.name}</span>
                        <span style={{fontSize:11,color:'var(--muted)'}}>{r.authorized_at?.slice(5,16)}</span>
                      </div>
                      <div style={{fontSize:11,color:'var(--muted)',marginTop:3,lineHeight:1.6}}>
                        初试 <span style={{color:'var(--p-red-71)',fontWeight:600}}>{Math.round(r.original_score)}分</span>
                        {' → '}
                        {r.result==='pending'
                          ? <span style={{color:'var(--p-purple-65)'}}>待复查</span>
                          : r.result==='pass'
                          ? <span style={{color:'var(--green)',fontWeight:600}}>复查{Math.round(r.remediation_score)}分 ✅合格</span>
                          : <span style={{color:'var(--p-red-71)',fontWeight:600}}>复查{Math.round(r.remediation_score)}分 ❌不合格</span>
                        }
                        {' · 授权：'}{r.authorized_by||'—'}
                      </div>
                    </div>
                  ))
                }
              </div>
            );
          })()}

          {/* ── 本期高错误率题目 ── */}
          {weakQuestions.length>0&&(()=>{
            const highError=weakQuestions.filter(q=>q.error_rate>=40);
            const lowError=weakQuestions.filter(q=>q.error_rate>0&&q.error_rate<40);
            const allCorrect=weakQuestions.filter(q=>q.error_rate===0);
            const renderQ=(q,qi,arr,dimmed=false)=>{
              const col=q.error_rate>=70?'var(--red)':q.error_rate>=40?'var(--amber)':'var(--green)';
              return(
                <div key={qi} style={{marginBottom:qi<arr.length-1?14:0}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8,marginBottom:5}}>
                    <span style={{fontSize:11,color:dimmed?'var(--border)':'var(--border)',flex:1,lineHeight:1.6}}>{q.question_text.length>42?q.question_text.slice(0,42)+'…':q.question_text}</span>
                    <span style={{fontSize:14,fontWeight:800,color:col,flexShrink:0}}>{q.error_rate}%</span>
                  </div>
                  <div style={{height:5,background:'var(--p-navy-17)',borderRadius:3,overflow:'hidden',marginBottom:4}}>
                    <div style={{height:'100%',width:`${q.error_rate}%`,background:`linear-gradient(90deg,${col}55,${col})`,borderRadius:3,transition:'width 0.8s ease'}}/>
                  </div>
                  <div style={{fontSize:11,color:'var(--muted)'}}>
                    {q.total} 次作答 · 均分 {q.avg_score} 分 · {q.wrong} 人错误
                    {q.wrong_names?.length>0&&<span style={{color:'var(--muted)'}}> （{q.wrong_names.join('、')}）</span>}
                  </div>
                </div>
              );
            };
            const shownHighError=highErrorCollapsed?highError.slice(0,3):highError;
            return(
              <div className="card" style={{borderColor:'var(--p-red-60-a30)'}}>
                <div onClick={()=>setHighErrorCollapsed(c=>!c)} style={{display:'flex',alignItems:'center',justifyContent:'space-between',cursor:'pointer',marginBottom:highErrorCollapsed?8:14}}>
                  <div style={{fontSize:11,color:'var(--red)',letterSpacing:2,fontWeight:600,textTransform:'uppercase'}}>本期高错误率题目{highError.length>0?` (${highError.length})`:''}</div>
                  <span style={{fontSize:15,color:'var(--red)',display:'inline-block',transform:highErrorCollapsed?'none':'rotate(180deg)',transition:'transform 0.2s'}}>⌄</span>
                </div>
                {highErrorCollapsed&&highError.length>0&&(
                  <div style={{display:'flex',flexDirection:'column',gap:5}}>
                    {highError.slice(0,3).map((q,qi)=>(
                      <div key={qi} style={{display:'flex',alignItems:'center',gap:8}}>
                        <div style={{flex:1,fontSize:11,color:'var(--text)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{q.question_text.length>28?q.question_text.slice(0,28)+'…':q.question_text}</div>
                        <span style={{fontSize:12,fontWeight:700,color:q.error_rate>=70?'var(--red)':'var(--amber)',flexShrink:0}}>{q.error_rate}%</span>
                      </div>
                    ))}
                    {highError.length>3&&<div style={{fontSize:11,color:'var(--muted)',marginTop:2}}>还有 {highError.length-3} 道 · 点击展开</div>}
                  </div>
                )}
                {highErrorCollapsed&&highError.length===0&&<div style={{fontSize:12,color:'var(--green)'}}>✓ 暂无高错误率题目</div>}
                {!highErrorCollapsed&&<>
                {highError.length===0&&<div style={{fontSize:12,color:'var(--green)',marginBottom:8}}>✓ 暂无错误率 ≥40% 的题目</div>}
                {shownHighError.map((q,qi)=>renderQ(q,qi,shownHighError))}
                {highError.length>3&&(
                  <div onClick={e=>{e.stopPropagation();setHighErrorCollapsed(false);}} style={{textAlign:'center',color:'var(--p-blue-68)',fontSize:11,marginTop:8,cursor:'pointer'}}>{highErrorCollapsed?`展开全部 ${highError.length} 道`:'收起'}</div>
                )}
                {lowError.length>0&&(
                  <div style={{borderTop:highError.length>0?'1px solid var(--p-navy-22-a50)':'none',paddingTop:highError.length>0?12:0,marginTop:highError.length>0?2:0}}>
                    <div onClick={()=>setLowErrorExpanded(e=>!e)} style={{display:'flex',alignItems:'center',justifyContent:'space-between',cursor:'pointer',marginBottom:lowErrorExpanded?10:0}}>
                      <span style={{fontSize:13,color:'var(--amber)',letterSpacing:0.5,fontWeight:700}}>⚠ 低错误率题目（{lowError.length} 道，1%–39%）</span>
                      <span style={{fontSize:16,color:'var(--amber)',display:'inline-block',transform:lowErrorExpanded?'rotate(180deg)':'none',transition:'transform 0.2s'}}>⌄</span>
                    </div>
                    {lowErrorExpanded&&lowError.map((q,qi)=>renderQ(q,qi,lowError,true))}
                  </div>
                )}
                {allCorrect.length>0&&(
                  <div style={{borderTop:(highError.length>0||lowError.length>0)?'1px solid var(--p-navy-22-a50)':'none',paddingTop:(highError.length>0||lowError.length>0)?12:0,marginTop:2}}>
                    <div onClick={()=>setAllCorrectExpanded(e=>!e)} style={{display:'flex',alignItems:'center',justifyContent:'space-between',cursor:'pointer',marginBottom:allCorrectExpanded?10:0}}>
                      <span style={{fontSize:13,color:'var(--green)',letterSpacing:0.5,fontWeight:700}}>✓ 全部答对的题目（{allCorrect.length} 道）</span>
                      <span style={{fontSize:16,color:'var(--green)',display:'inline-block',transform:allCorrectExpanded?'rotate(180deg)':'none',transition:'transform 0.2s'}}>⌄</span>
                    </div>
                    {allCorrectExpanded&&allCorrect.map((q,qi)=>(
                      <div key={qi} style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8,padding:'6px 0',borderTop:'1px solid var(--p-navy-22-a30)'}}>
                        <span style={{fontSize:11,color:'var(--muted)',flex:1,lineHeight:1.5}}>{q.question_text.length>42?q.question_text.slice(0,42)+'…':q.question_text}</span>
                        <span style={{fontSize:11,fontWeight:700,color:'var(--green)',flexShrink:0}}>100%</span>
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
                  <div style={{fontSize:11,color:'var(--muted)',letterSpacing:2,fontWeight:600,marginBottom:10,textTransform:'uppercase'}}>本月培训完成情况</div>
                  {(()=>{
                    const notStarted = allMembers.filter(m=>m.total>0 && m.done===0);
                    const ringCol = totalPeople===0 ? 'var(--muted)' : donePeople>=totalPeople ? 'var(--green)' : donePeople===0 ? 'var(--red)' : 'var(--amber)';
                    const ringSize = 72;
                    const r = ringSize*0.38, circ = 2*Math.PI*r;
                    const dash = (donePeople/Math.max(totalPeople,1))*circ;
                    return (
                      <div style={{display:'flex',alignItems:'center',gap:14,marginBottom:10}}>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:11,color:'var(--muted)',fontWeight:600,marginBottom:6}}>本月任务未完成人员</div>
                          {notStarted.length===0
                            ? <div style={{fontSize:12,color:'var(--green)'}}>✓ 无</div>
                            : <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
                                {notStarted.map(m=>(
                                  <span key={m.id} style={{fontSize:11,color:'var(--red)',padding:'1px 6px',borderRadius:4,background:'var(--p-red-60-a08)',border:'1px solid var(--p-red-60-a30)',whiteSpace:'nowrap'}}>
                                    {m.name}
                                  </span>
                                ))}
                              </div>}
                        </div>
                        <svg width={ringSize} height={ringSize} viewBox={`0 0 ${ringSize} ${ringSize}`} style={{flexShrink:0}}>
                          <circle cx={ringSize/2} cy={ringSize/2} r={r} fill="none" stroke="var(--p-navy-17)" strokeWidth={ringSize*0.1}/>
                          <circle cx={ringSize/2} cy={ringSize/2} r={r} fill="none" stroke={ringCol} strokeWidth={ringSize*0.1}
                            strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
                            transform={`rotate(-90 ${ringSize/2} ${ringSize/2})`} style={{transition:'stroke-dasharray 0.8s'}}/>
                          <text x={ringSize/2} y={ringSize/2+ringSize*0.07} textAnchor="middle" fill="white" fontSize={ringSize*0.26} fontWeight="700">
                            {donePeople}<tspan fill="var(--muted)" fontSize={ringSize*0.16}>/{totalPeople}</tspan>
                          </text>
                        </svg>
                      </div>
                    );
                  })()}
                  <div style={{height:5,background:'var(--p-navy-17)',borderRadius:3,overflow:'hidden'}}>
                    <div style={{height:'100%',width:`${pct}%`,background:'linear-gradient(90deg,var(--blue),var(--green))',borderRadius:3,transition:'width 0.8s ease'}}/>
                  </div>
                </div>
                <div style={{borderTop:'1px solid var(--border)',padding:'10px 12px 12px'}}>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:8}}>
                    {allGroups.map(g=>(
                      <div key={g.id} style={{background:'var(--p-navy-14-a60)',border:'1px solid var(--border)',borderRadius:8,padding:'8px 10px'}}>
                        <div style={{fontSize:11,color:'var(--p-blue-68)',fontWeight:700,marginBottom:6,letterSpacing:0.5}}>{g.name}{g.instructor_name?<span style={{color:'var(--muted)',fontWeight:400,marginLeft:4}}>· {g.instructor_name}</span>:null}</div>
                        <div style={{display:'flex',flexDirection:'column',gap:4}}>
                          {g.members.map(m=>{
                            const isDone=m.total>0&&m.done>=m.total;
                            const isNone=m.total===0;
                            const isZero=m.total>0&&m.done===0;
                            const scoreCol=isDone?'var(--green)':isNone?'var(--muted)':isZero?'var(--red)':'var(--amber)';
                            const openMemberModal=()=>{
                              const monthItems=monthMemberCompletion?.monthItems||[];
                              const doneMap=new Map((m.doneItems||[]).map(d=>[d.item,d]));
                              const itemStatuses=monthItems.map(it=>{
                                const found=doneMap.get(it.item);
                                if(found) return{item:it.item,trainType:it.trainType,done:true,shift_date:found.shift_date,comment:found.comment||''};
                                return{item:it.item,trainType:it.trainType,done:false};
                              });
                              setMemberEvalModal({id:m.id,name:m.name,itemStatuses});
                            };
                            const dates=[...new Set((m.doneItems||[]).map(d=>d.shift_date).filter(Boolean))].sort();
                            const dateLabel=dates.length>0?dates.map(d=>{const p=d.split('-');return`${parseInt(p[1])}/${parseInt(p[2])}`}).join('·'):'';
                            return(
                              <div key={m.id} onClick={openMemberModal} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:4,cursor:'pointer',borderRadius:4,padding:'1px 2px',margin:'-1px -2px'}}>
                                <span style={{fontSize:11,color:isDone?'var(--muted)':'var(--muted)',fontWeight:isDone?400:500,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                                  {m.name}{dateLabel&&<span style={{fontSize:11,color:'var(--muted)',marginLeft:3}}>{dateLabel}</span>}
                                </span>
                                <span style={{fontSize:11,color:scoreCol,fontWeight:700,flexShrink:0}}>
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
                    <div style={{marginTop:8,background:'var(--p-navy-14-a60)',border:'1px solid var(--p-indigo-85-a20)',borderRadius:8,padding:'8px 10px'}}>
                      <div style={{fontSize:11,color:'var(--p-indigo-85)',fontWeight:700,marginBottom:6,letterSpacing:0.5}}>固定成员</div>
                      <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
                        {fixedMembers.map(m=>{
                          const isDone=m.total>0&&m.done>=m.total;
                          const isNone=m.total===0;
                          const isZero=m.total>0&&m.done===0;
                          const scoreCol=isDone?'var(--green)':isNone?'var(--muted)':isZero?'var(--red)':'var(--amber)';
                          const openMemberModal=()=>{
                            const monthItems=monthMemberCompletion?.monthItems||[];
                            const doneMap=new Map((m.doneItems||[]).map(d=>[d.item,d]));
                            const itemStatuses=monthItems.map(it=>{
                              const found=doneMap.get(it.item);
                              if(found) return{item:it.item,trainType:it.trainType,done:true,shift_date:found.shift_date,comment:found.comment||''};
                              return{item:it.item,trainType:it.trainType,done:false};
                            });
                            setMemberEvalModal({id:m.id,name:m.name,itemStatuses});
                          };
                          const dates=[...new Set((m.doneItems||[]).map(d=>d.shift_date).filter(Boolean))].sort();
                          const dateLabel=dates.length>0?dates.map(d=>{const p=d.split('-');return`${parseInt(p[1])}/${parseInt(p[2])}`}).join('·'):'';
                          return(
                            <div key={m.id} onClick={openMemberModal} style={{display:'flex',alignItems:'center',gap:4,cursor:'pointer'}}>
                              <span style={{fontSize:11,color:'var(--muted)'}}>{m.name}{dateLabel&&<span style={{fontSize:11,color:'var(--muted)',marginLeft:3}}>{dateLabel}</span>}</span>
                              <span style={{fontSize:11,color:scoreCol,fontWeight:700}}>{isNone?'—':`${m.done}/${m.total}`}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <div style={{display:'flex',gap:10,marginTop:8,fontSize:11,color:'var(--muted)',flexWrap:'wrap'}}>
                    <span style={{color:'var(--green)'}}>● 全部完成</span>
                    <span style={{color:'var(--amber)'}}>● 部分完成</span>
                    <span style={{color:'var(--red)'}}>● 未开始</span>
                    <span style={{color:'var(--muted)'}}>● 本月无安排</span>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ── 成员培训评价详情弹窗（已抽到 admin/OverviewModals.jsx）── */}
          <MemberEvalModal modal={memberEvalModal} onClose={()=>setMemberEvalModal(null)}/>

          {/* ── 本月项点详情弹窗（已抽到 admin/OverviewModals.jsx）── */}
          <PlanDetailModal modal={planDetailModal} onClose={()=>setPlanDetailModal(null)}/>

          {/* ── 班组各类题均分 ── */}
          <div className="card">
            <div style={{fontSize:11,color:'var(--muted)',letterSpacing:2,fontWeight:600,marginBottom:10,textTransform:'uppercase'}}>班组各类题均分</div>
            {overview.catAvg?.map((c,i)=><MiniBar key={i} label={c.category} value={c.avg}/>)}
          </div>

          {/* ── 管理员答题轨迹弹窗（已抽到 admin/OverviewModals.jsx）── */}
          <AdminDrillModal
            modal={adminDrillModal}
            hdrs={hdrs}
            cycleId={overview.cycle?.id}
            onClose={()=>setAdminDrillModal(null)}
            onToggleCycle={(cid)=>setAdminDrillModal(m=>({...m,expandedCycleId:cid}))}
            onDeleted={()=>{
              apiJson('/api/admin/leaderboard/cycle',{headers:hdrs()}).then(d=>setLbSessions(d.rows||[])).catch(()=>{});
              setAdminDrillModal(null);
            }}
          />

          {/* ── 积分榜（双列）· SHOW_LEADERBOARD=false 时隐藏，代码保留 ── */}
          {SHOW_LEADERBOARD && (()=>{
            const AdminLbCol = ({title, rows, mode, collapsed, setCollapsed})=>{
              const shown = collapsed ? rows.slice(0,3) : rows;
              const badges = r => (<>
                {r.is_leader?<span style={{fontSize:11,padding:'1px 4px',borderRadius:6,background:'var(--p-amber-47-a15)',border:'1px solid var(--p-amber-47-a40)',color:'var(--p-amber-56)',flexShrink:0}}>组长</span>:null}
                {r.is_exempt&&!r.is_leader?<span style={{fontSize:11,padding:'1px 4px',borderRadius:6,background:'var(--p-amber-50-a15)',border:'1px solid var(--p-amber-50-a40)',color:'var(--amber)',flexShrink:0}}>免答</span>:null}
                {r.is_instructor?<span style={{fontSize:11,padding:'1px 4px',borderRadius:6,background:'var(--p-indigo-67-a15)',border:'1px solid var(--p-indigo-67-a40)',color:'var(--p-blue-82)',flexShrink:0}}>教员</span>:null}
              </>);
              return (
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:11,color:'var(--muted)',fontWeight:600,letterSpacing:1,marginBottom:8}}>{title}</div>
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
                      }} style={{display:'flex',alignItems:'center',gap:5,padding:'5px 0',borderBottom:i<shown.length-1?'1px solid var(--p-navy-22-a50)':'none',cursor:'pointer'}}>
                        <span style={{fontSize:i<3?12:10,width:16,textAlign:'center',flexShrink:0,color:['var(--p-amber-50-h051)','var(--p-blue-74)','var(--p-amber-50)'][i]||'var(--muted)'}}>
                          {['🥇','🥈','🥉'][i]||(i+1)}
                        </span>
                        <span style={{flex:1,fontSize:11,color:'var(--text)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.staff_name}</span>
                        <div style={{display:'flex',gap:2,alignItems:'center',flexShrink:0}}>{badges(r)}</div>
                        <span style={{fontWeight:700,color:'var(--gold)',fontSize:11,flexShrink:0,marginLeft:2}}>{pts}</span>
                      </div>
                    );
                  })}
                  {rows.length>3&&(
                    <div onClick={()=>setCollapsed(c=>!c)} style={{textAlign:'center',marginTop:6,fontSize:11,color:'var(--p-blue-68)',cursor:'pointer',fontWeight:600}}>
                      {collapsed?`全部 ${rows.length} 人 ▼`:'收起 ▲'}
                    </div>
                  )}
                </div>
              );
            };
            return (
              <div className="card">
                <div style={{fontSize:11,color:'var(--muted)',letterSpacing:2,fontWeight:600,marginBottom:12}}>积分榜</div>
                <div style={{display:'flex',gap:12}}>
                  <AdminLbCol title="本轮" rows={lbSessions} mode="cycle" collapsed={lbCollapsed} setCollapsed={setLbCollapsed}/>
                  <div style={{width:1,background:'var(--p-navy-22-a60)'}}/>
                  <AdminLbCol title="本月" rows={lbSessionsAlltime} mode="alltime" collapsed={lbCollapsed} setCollapsed={setLbCollapsed}/>
                </div>
              </div>
            );
          })()}

          {/* ── 导出记录（面板已抽到 admin/ExportPanels.jsx）── */}
          <button onClick={()=>{
            setShowExportMenu('open');
            if(!exportMonths.length) apiJson('/api/export/months',{headers:hdrs()}).then(setExportMonths).catch(()=>{});
          }} className="btn-primary" style={{width:'100%',textAlign:'center',padding:'13px',border:'none',cursor:'pointer'}}>📊 导出记录</button>

          {/* 导出弹窗 */}
          {showExportMenu==='open'&&(
            <div style={{position:'fixed',inset:0,background:'var(--p-black-00-a75)',zIndex:200,display:'flex',alignItems:'flex-end',justifyContent:'center'}} onClick={()=>{setShowExportMenu(null);setExportWsModal(null);setWsMultiMonthSel(null);}}>
              <div style={{background:'var(--p-navy-10)',borderRadius:'14px 14px 0 0',width:'100%',maxWidth:480,maxHeight:'80vh',display:'flex',flexDirection:'column'}} onClick={e=>e.stopPropagation()}>
                <div style={{padding:'14px 16px 10px',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
                  <span style={{fontWeight:700,color:'var(--text)',fontSize:15}}>📊 导出记录</span>
                  <button onClick={()=>{setShowExportMenu(null);setExportWsModal(null);setWsMultiMonthSel(null);}} style={{background:'none',border:'none',color:'var(--muted)',fontSize:22,cursor:'pointer',padding:0,lineHeight:1}}>×</button>
                </div>

                {/* 主选择面板 */}
                {!exportWsModal&&!wsMultiMonthSel&&(
                  <ExportMainPanel
                    pwd={pwd}
                    exportMonths={exportMonths}
                    quizExportSel={quizExportSel}
                    setQuizExportSel={setQuizExportSel}
                    onOpenPlans={async()=>{
                      setExportWsModal({plans:[],months:[],activeMonth:'',selected:new Set(),showMonthPicker:false,loading:true});
                      const plans=await apiJson('/api/export/workshop/plans',{headers:hdrs()}).catch(()=>[]);
                      const allPlans=Array.isArray(plans)?plans:[];
                      const months=[...new Set(allPlans.map(p=>p.year_month))].sort((a,b)=>b.localeCompare(a));
                      const curMonth=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}).slice(0,7);
                      const active=months.includes(curMonth)?curMonth:(months[0]||curMonth);
                      const mp=allPlans.filter(p=>p.year_month===active);
                      setExportWsModal({plans:allPlans,months,activeMonth:active,selected:new Set(mp.map(p=>p.id)),showMonthPicker:false,loading:false});
                    }}
                    onOpenWsMulti={async()=>{
                      const wsMths=await apiJson('/api/export/workshop/months',{headers:hdrs()}).catch(()=>[]);
                      const ms=Array.isArray(wsMths)?wsMths:[];
                      setWsMultiMonthSel({months:ms,selected:new Set()});
                    }}
                  />
                )}

                {/* 培训跨月合并面板 */}
                {!exportWsModal&&wsMultiMonthSel&&(
                  <WorkshopMultiMonthPanel
                    pwd={pwd}
                    state={wsMultiMonthSel}
                    setState={setWsMultiMonthSel}
                    onBack={()=>setWsMultiMonthSel(null)}
                  />
                )}

                {/* 月度任务按场次勾选面板 */}
                {exportWsModal&&(
                  <WorkshopPlansPanel
                    pwd={pwd}
                    state={exportWsModal}
                    setState={setExportWsModal}
                    onBack={()=>setExportWsModal(null)}
                  />
                )}
              </div>
            </div>
          )}

          <button onClick={async()=>{
            if(!window.confirm('确认清除今日所有答题记录？\n（记录会保留在数据库中，不影响 Excel 导出）'))return;
            const r=await apiJson('/api/admin/sessions/today',{method:'DELETE',headers:hdrs()}).catch(()=>null);
            if(r?.ok){alert(`已清除今日 ${r.deleted} 条记录`);apiJson('/api/admin/overview',{headers:hdrs()}).then(setOverview).catch(()=>{});apiJson('/api/admin/weak-questions',{headers:hdrs()}).then(setWeakQuestions).catch(()=>{});const ep=lbMode==='alltime'?'/api/admin/leaderboard/alltime':'/api/admin/leaderboard/cycle';apiJson(ep,{headers:hdrs()}).then(d=>setLbSessions(d.rows||d||[])).catch(()=>{});}
            else alert('清除失败');
          }} style={{width:'100%',marginTop:8,padding:'13px',background:'var(--p-red-60-a10)',border:'1px solid var(--p-red-60-a30)',borderRadius:8,color:'var(--red)',fontSize:13,fontWeight:600,cursor:'pointer'}}>🗑 清除今日答题数据</button>
        </>}

        {tab==='members'&&<MembersTab members={members} pwd={pwd} onRefresh={()=>apiJson('/api/admin/members',{headers:hdrs()}).then(setMembers).catch(()=>{})} selectedMember={selectedMember} setSelectedMember={setSelectedMember} memberDetail={memberDetail} loadMemberDetail={loadMemberDetail}/>}

        {SHOW_WALL&&tab==='wall'&&(
          <div style={{padding:'0 2px'}}>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
              <span style={{fontSize:12.5,fontWeight:700,color:'var(--text)'}}>留言管理</span>
              <span style={{fontSize:10.5,color:'var(--muted)'}}>共 {wallPosts.length} 条 · 前台显示署名，真身仅后台可见</span>
              <button onClick={()=>{apiJson('/api/wall/admin/posts',{headers:hdrs()}).then(d=>setWallPosts(d?.posts||[])).catch(()=>{});}}
                style={{marginLeft:'auto',fontSize:11,padding:'4px 10px',borderRadius:6,background:'var(--card)',border:'1px solid var(--border)',color:'var(--text)',cursor:'pointer'}}>刷新</button>
            </div>
            {!wallLoaded&&<div style={{fontSize:11.5,color:'var(--muted)',padding:'20px 0',textAlign:'center'}}>加载中…</div>}
            {wallLoaded&&wallPosts.length===0&&<div style={{fontSize:11.5,color:'var(--muted)',padding:'20px 0',textAlign:'center'}}>还没有留言</div>}
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              {wallPosts.map(p=>(
                <div key={p.id} style={{background:'var(--card)',border:'1px solid var(--border)',borderRadius:11,padding:'10px 12px',opacity:p.is_hidden?0.45:1}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:5}}>
                    <span style={{fontSize:12.5,fontWeight:700,color:'#7ec8f0'}}>{p.nick}</span>
                    <span style={{fontSize:10,color:'var(--muted)'}}>{p.created_at}</span>
                    {p.is_hidden?<span style={{fontSize:9.5,color:'var(--p-red-60)',border:'1px solid var(--p-red-60)',borderRadius:4,padding:'0 4px'}}>已隐藏</span>:null}
                    <button onClick={async()=>{
                        try{
                          await apiJson(`/api/wall/admin/${p.id}/hide`,{method:'POST',headers:hdrs(),body:JSON.stringify({hidden:!p.is_hidden})});
                          const d=await apiJson('/api/wall/admin/posts',{headers:hdrs()});setWallPosts(d?.posts||[]);
                        }catch(e){alert('操作失败：'+e);}
                      }}
                      style={{marginLeft:'auto',fontSize:10.5,padding:'3px 9px',borderRadius:5,cursor:'pointer',
                        background:'transparent',border:'1px solid var(--border)',color:p.is_hidden?'var(--p-green-52)':'var(--p-red-60)'}}>
                      {p.is_hidden?'恢复':'隐藏'}
                    </button>
                  </div>
                  <div style={{fontSize:12.5,lineHeight:1.5,color:'var(--text)',wordBreak:'break-word',marginBottom:6}}>{p.content}</div>
                  <div style={{fontSize:10,color:'var(--muted)',borderTop:'1px dashed var(--border)',paddingTop:5}}>
                    真身：{p.real_name||'未知'}（{p.staff_id||'-'}）
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {tab==='leave'&&<>
          <LeaveOverview hdrs={hdrs} members={members}/>
          <LeaveTab
          weekBatch={weekBatch} weekLoading={weekLoading}
          weekAnchor={weekAnchor} setWeekAnchor={setWeekAnchor}
          leavePending={leavePending} leavePendLoading={leavePendLoading}
          loadLeavePending={loadLeavePending}
          rejectModal={rejectModal} setRejectModal={setRejectModal}
          rejectReason={rejectReason} setRejectReason={setRejectReason}
          reviewLeave={reviewLeave} loadWeekBatch={loadWeekBatch} hdrs={hdrs}
          copyBatchText={copyBatchText} markReported={markReported}
          /></>}


        {tab==='banks'&&<>

          {/* 子导航 */}
          <div style={{display:'flex',gap:3,marginBottom:12,background:'var(--p-navy-07-a60)',borderRadius:9,padding:3,border:'1px solid var(--border)'}}>
            {[['quiz','📋 本套班选题'],['manage','📚 题库管理']].map(([k,label])=>(
              <button key={k} onClick={()=>setBankSubTab(k)} style={{flex:1,padding:'8px 4px',borderRadius:7,border:'none',background:bankSubTab===k?'var(--card)':'transparent',color:bankSubTab===k?'var(--text)':'var(--muted)',fontSize:12,fontWeight:bankSubTab===k?700:400,cursor:'pointer',fontFamily:'inherit',boxShadow:bankSubTab===k?'0 1px 4px var(--p-black-00-a40)':'none'}}>
                {label}
              </button>
            ))}
          </div>

          {/* ══ 板块1：本套班抽问题目 ══ */}
          {bankSubTab==='quiz'&&(()=>{
            const isActive = qPinned.scope !== 'none';
            // 休息日：白班开始日 +3 天即为休息日，套班答题已结束
            const todayStr = new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
            const cycleStart = qPinned.cycle?.start_date;
            const cycleRestDate = cycleStart
              ? new Date(new Date(cycleStart+'T00:00:00+08:00').getTime()+3*86400000).toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'})
              : null;
            const isCycleOver = cycleRestDate ? todayStr >= cycleRestDate : false;
            const bankGroups2 = groupBanksByType(banks); // quiz 子tab 用
            const quizBanksInCat = quizCat ? (bankGroups2[quizCat]||[]) : [];
            const canSave = pinMode==='manual'
              ? qSelected.length > 0
              : multiBankIds.length > 0
                ? true
                : !!quizCat && (quizCat==='emergency' || quizBanksInCat.length > 0);

            const doSave = async()=>{
              let mode, bank_id=null, bank_ids=[], ids=[], count=pinCount;
              if (pinMode==='manual') {
                mode = 'manual'; ids = qSelected; count = Math.min(pinCount, qSelected.length);
              } else if (multiBankIds.length > 0) {
                // 多选题库：均衡随机
                mode = 'random'; bank_ids = multiBankIds;
              } else if (quizCat==='emergency') {
                mode = 'emergency';
              } else if (quizBankId) {
                mode = 'random'; bank_id = parseInt(quizBankId);
              } else {
                mode = 'random'; bank_ids = quizBanksInCat.map(b=>b.id);
              }
              const body = { mode, count, scope:pinScope, ids, bank_id, bank_ids, bank_fallback_id:null };
              const r=await apiJson('/api/admin/pinned-questions',{method:'PUT',headers:hdrs(),body:JSON.stringify(body)}).catch(()=>null);
              if(r?.ok){
                apiJson('/api/admin/pinned-questions',{headers:hdrs()}).then(d=>{
                  setQPinned(d); setPinCount(d.count||3);
                  if(d.mode==='manual'){setPinMode('manual');setQSelected(d.ids||[]);}
                  else if(d.mode==='emergency'){setPinMode('emergency');setQuizCat('emergency');}
                  else if(d.bank_id){setPinMode('random');const b=banks.find(x=>x.id===d.bank_id);if(b){setQuizCat(b.bank_type||'essential');setQuizBankId(String(b.id));}}
                  else if(d.bank_ids?.length>0){setPinMode('random');const b=banks.find(x=>x.id===d.bank_ids[0]);if(b){setQuizCat(b.bank_type||'essential');setQuizBankId(null);}setMultiBankIds(d.bank_ids);}
                });
                setPinSaveModal(false); setPinFormOpen(false);
                apiJson('/api/admin/dingtalk/notify-start',{method:'POST',headers:hdrs(),body:JSON.stringify({ids,mode,count,bank_id,bank_ids,scope:pinScope})}).catch(()=>null);
              } else { alert('设置失败'); }
            };

            return (
              <div className="card">
                <div style={{fontSize:11,color:'var(--muted)',letterSpacing:1,fontWeight:600,marginBottom:6,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <span>📌 本套班抽问题目</span>
                  {qPinned.cycle?.label && <span style={{fontSize:11,color:'var(--p-blue-68-a70)',fontWeight:400}}>本套班：{qPinned.cycle.label}</span>}
                </div>
                {!isActive && (
                  <div style={{marginBottom:12,padding:'8px 12px',background:'var(--p-blue-65-a06)',border:'1px solid var(--p-blue-65-a18)',borderRadius:8,fontSize:11,color:'var(--muted)'}}>
                    ⏳ 本套班尚未发布抽问题目{qPinned.stale && <span style={{color:'var(--muted)',marginLeft:6}}>（上套班 {qPinned.stale.created_date} 设置已失效）</span>}
                  </div>
                )}

                {/* 当前生效状态 */}
                {isActive&&(
                  <div style={{marginBottom:12,padding:'8px 12px',background:isCycleOver?'var(--p-blue-47-a07)':'var(--p-green-45-a07)',border:`1px solid ${isCycleOver?'var(--p-blue-47-a25)':'var(--p-green-45-a20)'}`,borderRadius:8,fontSize:11,color:isCycleOver?'var(--muted)':'var(--p-green-73)'}}>
                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:6}}>
                      <span>
                        {isCycleOver?'🔒 本套班已结束：':'✅ 当前已设置：'}
                        {qPinned.mode==='emergency'?'应急随机':qPinned.mode==='random'?'多题随机':'手动选题'} · {qPinned.count||3}题 · {qPinned.scope==='today'?'今天生效':'本套班生效'}
                      </span>
                      {!isCycleOver&&(
                        <span style={{display:'flex',gap:10,flexShrink:0}}>
                          <button onClick={()=>setPinFormOpen(o=>!o)} style={{background:'none',border:'none',color:'var(--p-blue-68)',cursor:'pointer',fontSize:11,padding:0}}>{pinFormOpen?'▲ 收起':'修改设置'}</button>
                          <button onClick={()=>setPinCancelModal(true)} style={{background:'none',border:'none',color:'var(--red)',cursor:'pointer',fontSize:11,padding:0}}>取消发布</button>
                        </span>
                      )}
                    </div>
                    {(qPinned.created_at||qPinned.created_date)&&(()=>{
                      const stamp = qPinned.created_at || qPinned.created_date;
                      const isToday = stamp.startsWith(todayStr);
                      return (
                        <div style={{marginTop:4,fontSize:11,color:isCycleOver?'var(--muted)':isToday?'var(--p-green-73-a70)':'var(--amber)'}}>
                          📅 发布于 {stamp}{!isCycleOver&&!isToday&&' （非今日设置，注意核对）'}
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* 已发布：展示本轮班题目+答案 */}
                {isActive&&!pinFormOpen&&(()=>{
                  const qs = qPinned.questions || [];
                  if (qs.length === 0) return null;
                  return (
                    <div style={{marginBottom:4}}>
                      {qs.map((q,i)=>(
                        <div key={q.id||i} style={{marginBottom:10,padding:'10px 12px',background:'var(--p-navy-07-a50)',border:'1px solid var(--p-blue-60-a15)',borderRadius:8}}>
                          <div style={{display:'flex',gap:8,alignItems:'flex-start'}}>
                            <span style={{width:20,height:20,borderRadius:'50%',background:'var(--p-blue-60-a20)',border:'1px solid var(--p-blue-60-a40)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,fontSize:11,color:'var(--p-blue-68)',fontWeight:700,marginTop:1}}>{i+1}</span>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{fontSize:12,color:'var(--text)',lineHeight:1.5,marginBottom:6}}>{q.text}</div>
                              <div style={{fontSize:11,color:'var(--muted)',lineHeight:1.5,borderTop:'1px solid var(--p-blue-60-a10)',paddingTop:6}}>
                                <span style={{color:'var(--p-blue-68-a60)',fontWeight:600,marginRight:4}}>参考：</span>{q.reference}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* 表单：未发布时直接显示，已发布时折叠 */}
                {(!isActive||pinFormOpen)&&<>

                {/* 模式切换：随机出题 / 手动选题 */}
                <div style={{marginBottom:12,display:'flex',gap:4}}>
                  {[['random','🎲 随机出题'],['manual','🎯 手动选题']].map(([m,label])=>{
                    const active = m==='manual' ? pinMode==='manual' : pinMode!=='manual';
                    return (
                      <button key={m} onClick={()=>{
                        if(m==='manual'){setPinMode('manual');setQuizCat(null);}
                        else {setPinMode(quizCat==='emergency'?'emergency':'random');setQSelected([]);}
                      }} style={{flex:1,padding:'9px',borderRadius:7,border:`2px solid ${active?'var(--blue)':'var(--border)'}`,background:active?'var(--p-blue-60-a15)':'var(--p-navy-07-a40)',color:active?'var(--p-blue-68)':'var(--muted)',cursor:'pointer',fontSize:12,fontWeight:700,fontFamily:'inherit'}}>
                        {label}
                      </button>
                    );
                  })}
                </div>

                {/* ── 随机出题模式 ── */}
                {pinMode!=='manual'&&<>

                {/* Step 1: 题库来源 */}
                <div style={{marginBottom:12}}>
                  <div style={{fontSize:11,color:'var(--muted)',fontWeight:600,marginBottom:6}}>① 题库来源</div>
                  <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                    {BANK_TYPES.map(t=>{
                      const active = quizCat===t.key;
                      const totalQ = (bankGroups2[t.key]||[]).reduce((s,b)=>s+(b.q_count||0),0);
                      return (
                        <button key={t.key} onClick={()=>{setQuizCat(t.key);setQuizBankId(null);}}
                          style={{flex:1,minWidth:58,padding:'8px 2px',borderRadius:8,border:`2px solid ${active?t.color:'var(--border)'}`,background:active?`${t.color}22`:'var(--p-navy-07-a40)',color:active?t.color:'var(--muted)',cursor:'pointer',fontWeight:active?700:400,textAlign:'center',lineHeight:1.3}}>
                          <div style={{fontSize:16}}>{t.icon}</div>
                          <div style={{fontSize:11,marginTop:2}}>{t.label}</div>
                          <div style={{fontSize:11,opacity:0.6,marginTop:1}}>{totalQ}题</div>
                        </button>
                      );
                    })}
                  </div>
                  {quizCat && quizCat!=='emergency' && quizBanksInCat.length > 0 && (
                    <div style={{marginTop:8,padding:'8px 10px',background:'var(--p-navy-07-a50)',border:'1px solid var(--border)',borderRadius:8}}>
                      <div style={{fontSize:11,color:'var(--muted)',marginTop:2,marginBottom:6}}>可只选一个，也可多选混合（多选时按题库均衡抽取，保证每个题库都能抽到）</div>
                      <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
                        <button onClick={()=>{setQuizBankId(null);setMultiBankIds([]);}}
                          style={{padding:'5px 10px',borderRadius:6,border:`1px solid ${!quizBankId&&multiBankIds.length===0?'var(--blue)':'var(--border)'}`,background:!quizBankId&&multiBankIds.length===0?'var(--p-blue-60-a15)':'none',color:!quizBankId&&multiBankIds.length===0?'var(--p-blue-68)':'var(--muted)',fontSize:11,cursor:'pointer',fontWeight:!quizBankId&&multiBankIds.length===0?700:400}}>
                          🎲 全类随机
                        </button>
                        {quizBanksInCat.map(b=>{
                          const multiSel = multiBankIds.includes(b.id);
                          const singleSel = quizBankId===String(b.id);
                          const sel = multiSel||singleSel;
                          return (
                            <button key={b.id} onClick={()=>{
                              // 点第一个题库→单选；再点其他题库→转多选
                              if (singleSel) { setQuizBankId(null); setMultiBankIds([]); return; }
                              if (quizBankId && !multiSel) { setMultiBankIds([parseInt(quizBankId), b.id]); setQuizBankId(null); return; }
                              if (multiSel) { const nx=multiBankIds.filter(x=>x!==b.id); setMultiBankIds(nx); if(nx.length===1) setQuizBankId(String(nx[0])); if(nx.length===0) setQuizBankId(null); return; }
                              if (multiBankIds.length>0) { setMultiBankIds([...multiBankIds, b.id]); return; }
                              setQuizBankId(String(b.id));
                            }}
                              style={{padding:'5px 10px',borderRadius:6,border:`1px solid ${sel?'var(--blue)':'var(--border)'}`,background:sel?'var(--p-blue-60-a15)':'none',color:sel?'var(--p-blue-68)':'var(--muted)',fontSize:11,cursor:'pointer',maxWidth:'100%',textAlign:'left',fontWeight:sel?700:400}}>
                              {sel?'✓ ':''}{b.name} <span style={{opacity:0.6,fontSize:11}}>({b.q_count||0}题)</span>
                            </button>
                          );
                        })}
                      </div>
                      {quizBankId && <div style={{marginTop:6,fontSize:11,color:'var(--muted)'}}>已选：{banks.find(b=>String(b.id)===quizBankId)?.name}</div>}
                      {multiBankIds.length>0 && (
                        <div style={{marginTop:6,fontSize:11,color:'var(--p-blue-68)'}}>
                          已选 {multiBankIds.length} 个题库混合随机（均衡抽取，每个题库至少 1 题）
                        </div>
                      )}
                      {!quizBankId && multiBankIds.length===0 && quizBanksInCat.length > 1 && <div style={{marginTop:6,fontSize:11,color:'var(--muted)'}}>将从该分类 {quizBanksInCat.length} 个题库混合随机出题</div>}
                      {!quizBankId && multiBankIds.length===0 && quizBanksInCat.length === 1 && (()=>{setQuizBankId(String(quizBanksInCat[0].id));return null;})()}
                    </div>
                  )}
                  {quizCat==='emergency' && (
                    <div style={{marginTop:8,fontSize:11,color:'var(--p-red-82)',padding:'7px 10px',background:'var(--p-red-60-a06)',borderRadius:7,border:'1px solid var(--p-red-60-a15)'}}>
                      🚨 从应急故障处置 + 风险数据库随机抽取
                    </div>
                  )}
                </div>

                {/* Step 2: 出题数 */}
                <div style={{marginBottom:12}}>
                  <div style={{fontSize:11,color:'var(--muted)',fontWeight:600,marginBottom:6}}>② 出几题</div>
                  <div style={{display:'flex',gap:6}}>
                    {[1,2,3,4,5].map(n=>(
                      <button key={n} onClick={()=>setPinCount(n)}
                        style={{flex:1,padding:'10px 0',borderRadius:7,border:`2px solid ${pinCount===n?'var(--blue)':'var(--border)'}`,background:pinCount===n?'var(--p-blue-60-a18)':'var(--p-navy-07-a40)',color:pinCount===n?'var(--p-blue-68)':'var(--muted)',cursor:'pointer',fontSize:16,fontWeight:700}}>
                        {n}
                      </button>
                    ))}
                  </div>
                </div>

                </>}

                {/* ── 手动选题模式 ── */}
                {pinMode==='manual'&&<>

                {/* 已选题目汇总 */}
                {qSelected.length>0&&(
                  <div style={{marginBottom:10,padding:'8px 10px',background:'var(--p-blue-60-a06)',border:'1px solid var(--p-blue-60-a25)',borderRadius:8}}>
                    <div style={{fontSize:11,color:'var(--p-blue-68)',fontWeight:600,marginBottom:6}}>已选 {qSelected.length} 题</div>
                    <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
                      {qSelected.map(id=>{
                        const q=Object.values(bankQsCache).flat().find(x=>x.id===id);
                        return (
                          <div key={id} style={{display:'flex',alignItems:'center',gap:3,background:'var(--p-blue-60-a12)',border:'1px solid var(--p-blue-60-a30)',borderRadius:4,padding:'3px 7px',maxWidth:'100%'}}>
                            <span style={{fontSize:11,color:'var(--text)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:170}}>{q?.text||`题目#${id}`}</span>
                            <button onClick={()=>setQSelected(s=>s.filter(x=>x!==id))} style={{background:'none',border:'none',color:'var(--muted)',cursor:'pointer',fontSize:12,padding:'0 2px',lineHeight:1,flexShrink:0}}>×</button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 题库浏览器 */}
                <div style={{marginBottom:12}}>
                  <div style={{fontSize:11,color:'var(--muted)',fontWeight:600,marginBottom:8}}>① 从各题库中选题（可多选）</div>
                  {BANK_TYPES.map(t=>{
                    const bks=bankGroups2[t.key]||[];
                    if(bks.length===0) return null;
                    return (
                      <div key={t.key} style={{marginBottom:6}}>
                        <div style={{fontSize:11,color:t.color,fontWeight:600,padding:'4px 0 4px 2px',letterSpacing:0.5}}>{t.icon} {t.label}</div>
                        {bks.map(b=>{
                          const exp=!!manualPickExpanded[b.id];
                          const qs=bankQsCache[b.id]||null;
                          const selInBank=qSelected.filter(id=>(qs||[]).some(q=>q.id===id)).length;
                          return (
                            <div key={b.id} style={{marginBottom:3,border:`1px solid ${exp?'var(--p-blue-60-a30)':'var(--border)'}`,borderRadius:7,overflow:'hidden'}}>
                              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'8px 10px',cursor:'pointer',background:exp?'var(--p-blue-60-a08)':'var(--p-navy-07-a50)'}}
                                onClick={async()=>{
                                  if(!exp&&qs===null){
                                    const d=await apiJson(`/api/admin/questions/all?bank_id=${b.id}`,{headers:hdrs()}).catch(()=>null);
                                    setBankQsCache(prev=>({...prev,[b.id]:Array.isArray(d)?d:[]}));
                                  }
                                  setManualPickExpanded(prev=>({...prev,[b.id]:!exp}));
                                }}>
                                <span style={{fontSize:11,color:'var(--text)',flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{b.name}</span>
                                <span style={{fontSize:11,color:'var(--muted)',flexShrink:0,marginLeft:8}}>
                                  {selInBank>0&&<span style={{color:'var(--p-blue-68)',fontWeight:700,marginRight:4}}>已选{selInBank}</span>}
                                  {b.q_count||0}题 {exp?'▲':'▼'}
                                </span>
                              </div>
                              {exp&&qs!==null&&(
                                <div style={{maxHeight:240,overflowY:'auto',background:'var(--p-navy-04-a60)'}}>
                                  {qs.length===0
                                    ? <div style={{fontSize:11,color:'var(--muted)',padding:'8px 12px'}}>暂无题目</div>
                                    : qs.map(q=>{
                                        const sel=qSelected.includes(q.id);
                                        return (
                                          <div key={q.id} onClick={()=>{
                                            if(sel){setQSelected(s=>s.filter(x=>x!==q.id));}
                                            else{setQSelected(s=>[...s,q.id]);}
                                          }} style={{display:'flex',alignItems:'flex-start',gap:8,padding:'7px 10px',borderBottom:'1px solid var(--p-navy-22-a30)',cursor:'pointer',background:sel?'var(--p-blue-60-a07)':'none'}}>
                                            <div style={{width:16,height:16,borderRadius:3,border:`2px solid ${sel?'var(--blue)':'var(--p-blue-27)'}`,background:sel?'var(--blue)':'none',flexShrink:0,marginTop:2,display:'flex',alignItems:'center',justifyContent:'center'}}>
                                              {sel&&<span style={{color:'white',fontSize:11,lineHeight:1}}>✓</span>}
                                            </div>
                                            <div style={{flex:1,fontSize:11,color:sel?'var(--text)':'var(--muted)',lineHeight:1.5}}>{q.text}</div>
                                          </div>
                                        );
                                      })
                                  }
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>

                {/* 出几题（手动模式） */}
                {qSelected.length > 0 && (
                  <div style={{marginBottom:12}}>
                    <div style={{fontSize:11,color:'var(--muted)',fontWeight:600,marginBottom:6}}>
                      ② 每人随机答几题
                      {qSelected.length > 1 && <span style={{fontWeight:400,color:'var(--p-blue-65-a60)',marginLeft:4}}>（从已选 {qSelected.length} 题中随机）</span>}
                    </div>
                    <div style={{display:'flex',gap:6}}>
                      {Array.from({length:Math.min(qSelected.length,5)},(_,i)=>i+1).map(n=>(
                        <button key={n} onClick={()=>setPinCount(n)}
                          style={{flex:1,padding:'10px 0',borderRadius:7,border:`2px solid ${pinCount===n?'var(--blue)':'var(--border)'}`,background:pinCount===n?'var(--p-blue-60-a18)':'var(--p-navy-07-a40)',color:pinCount===n?'var(--p-blue-68)':'var(--muted)',cursor:'pointer',fontSize:16,fontWeight:700}}>
                          {n}
                        </button>
                      ))}
                    </div>
                    {qSelected.length > pinCount && (
                      <div style={{marginTop:5,fontSize:11,color:'var(--amber)'}}>
                        每人从 {qSelected.length} 题中随机抽 {pinCount} 题，不同人顺序不同
                      </div>
                    )}
                    {qSelected.length === pinCount && (
                      <div style={{marginTop:5,fontSize:11,color:'var(--muted)'}}>
                        所有人答相同的 {pinCount} 题
                      </div>
                    )}
                  </div>
                )}

                </>}

                {/* 生效范围（共用） */}
                <div style={{marginBottom:12,display:'flex',alignItems:'center',gap:8,fontSize:11}}>
                  <span style={{color:'var(--muted)',flexShrink:0}}>{pinMode==='manual'?'② 生效范围：':'生效范围：'}</span>
                  {[['shift','本套班'],['today','今天']].map(([s,label])=>(
                    <button key={s} onClick={()=>setPinScope(s)}
                      style={{padding:'5px 12px',borderRadius:6,border:`1px solid ${pinScope===s?'var(--blue)':'var(--border)'}`,background:pinScope===s?'var(--p-blue-60-a15)':'none',color:pinScope===s?'var(--p-blue-68)':'var(--muted)',fontSize:11,cursor:'pointer'}}>
                      {label}
                    </button>
                  ))}
                </div>

                {/* 发布按钮 */}
                <button disabled={!canSave} onClick={()=>setPinSaveModal(true)}
                  style={{width:'100%',padding:'12px',borderRadius:8,border:'none',background:canSave?'linear-gradient(135deg,var(--p-navy-25),var(--blue))':'var(--border)',color:canSave?'white':'var(--muted)',fontSize:13,fontWeight:600,cursor:canSave?'pointer':'not-allowed',fontFamily:'inherit'}}>
                  {canSave
                    ? pinMode==='manual'
                      ? `发布 · 选${qSelected.length}题答${Math.min(pinCount,qSelected.length)}题 · 手动选题`
                      : `发布 · ${pinCount}题 · ${BANK_TYPE_MAP[quizCat]?.icon} ${quizBankId?banks.find(b=>String(b.id)===quizBankId)?.name:quizCat==='emergency'?'应急/风险':'全类随机'}`
                    : pinMode==='manual' ? '请先从题库中选择题目' : '请先选择题库来源'}
                </button>

                {/* 保存确认弹窗 */}
                {pinSaveModal&&(
                  <div onClick={()=>setPinSaveModal(false)} style={{position:'fixed',inset:0,background:'var(--p-black-00-a75)',zIndex:300,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
                    <div onClick={e=>e.stopPropagation()} style={{background:'var(--p-navy-16)',borderRadius:12,padding:20,width:'100%',maxWidth:320,border:'1px solid var(--p-blue-60-a30)'}}>
                      <div style={{fontWeight:700,color:'var(--text)',fontSize:15,marginBottom:8}}>📣 发布抽问</div>
                      <div style={{fontSize:13,color:'var(--muted)',marginBottom:6,lineHeight:1.6}}>
                        {pinMode==='manual'
                          ? <>将发布手动选题：从 <span style={{color:'var(--p-blue-68)',fontWeight:600}}>{qSelected.length} 道题</span>中随机抽 <span style={{color:'var(--p-blue-68)',fontWeight:600}}>{Math.min(pinCount,qSelected.length)} 题</span>，{pinScope==='today'?'今天':'本套班'}生效</>
                          : <>将设置 <span style={{color:'var(--p-blue-68)',fontWeight:600}}>{pinCount}题 · {BANK_TYPE_MAP[quizCat]?.icon} {quizBankId?banks.find(b=>String(b.id)===quizBankId)?.name:quizCat==='emergency'?'应急/风险':BANK_TYPE_MAP[quizCat]?.label+'全类'} · {pinScope==='today'?'今天生效':'本套班生效'}</span></>
                        }
                      </div>
                      <div style={{fontSize:12,color:'var(--amber)',marginBottom:16}}>⚠️ 同时将在钉钉群内发出答题提醒通知</div>
                      <div style={{display:'flex',gap:8}}>
                        <button onClick={()=>setPinSaveModal(false)} style={{flex:1,padding:'10px',borderRadius:7,border:'1px solid var(--border)',background:'transparent',color:'var(--muted)',fontFamily:'inherit',fontSize:13,cursor:'pointer'}}>取消</button>
                        <button onClick={doSave} style={{flex:2,padding:'10px',borderRadius:7,border:'none',background:'linear-gradient(135deg,var(--p-navy-25),var(--blue))',color:'var(--text)',fontFamily:'inherit',fontSize:13,fontWeight:600,cursor:'pointer'}}>确认发布</button>
                      </div>
                    </div>
                  </div>
                )}
                </>}

                {/* 取消发布确认弹窗 — 放在折叠块外，始终可渲染 */}
                {pinCancelModal&&(
                  <div onClick={()=>setPinCancelModal(false)} style={{position:'fixed',inset:0,background:'var(--p-black-00-a75)',zIndex:300,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
                    <div onClick={e=>e.stopPropagation()} style={{background:'var(--p-navy-16)',borderRadius:12,padding:20,width:'100%',maxWidth:300,border:'1px solid var(--p-red-60-a30)'}}>
                      <div style={{fontWeight:700,color:'var(--text)',fontSize:15,marginBottom:8}}>⚠️ 取消本套班抽问？</div>
                      <div style={{fontSize:13,color:'var(--muted)',marginBottom:16,lineHeight:1.6}}>取消后本套班答题按钮将变灰，已完成的成绩记录不受影响。</div>
                      <div style={{display:'flex',gap:8}}>
                        <button onClick={()=>setPinCancelModal(false)} style={{flex:1,padding:'10px',borderRadius:7,border:'1px solid var(--border)',background:'transparent',color:'var(--muted)',fontFamily:'inherit',fontSize:13,cursor:'pointer'}}>返回</button>
                        <button onClick={async()=>{
                          await apiJson('/api/admin/pinned-questions',{method:'PUT',headers:hdrs(),body:JSON.stringify({ids:[],scope:'none',mode:'emergency',count:3,bank_id:null,bank_ids:[]})}).catch(()=>null);
                          setQPinned({ids:[],scope:'none',mode:'emergency',count:3,bank_id:null,bank_ids:[],questions:[]});
                          setQuizCat(null);setQuizBankId(null);setPinCount(3);setPinFormOpen(false);setPinCancelModal(false);
                        }} style={{flex:1,padding:'10px',borderRadius:7,border:'none',background:'var(--p-red-51)',color:'var(--text)',fontFamily:'inherit',fontSize:13,fontWeight:600,cursor:'pointer'}}>确认取消</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* ══ 板块2：题库管理 ══ */}
          {bankSubTab==='manage'&&(()=>{
            const bankGroups = groupBanksByType(banks);
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
              const canCheck = false; // 管理 tab 不需要勾选题目
              return (
                <div key={b.id} style={{borderBottom:'1px solid var(--p-navy-22-a40)'}}>
                  <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',padding:'9px 12px',cursor:'pointer'}} onClick={toggleExpand}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,color:'var(--text)',fontWeight:600,marginBottom:2,lineHeight:1.4,display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                        {renamingBank?.id===b.id ? (
                          <form style={{display:'flex',gap:4,alignItems:'center',flex:1}} onSubmit={async e=>{e.preventDefault();e.stopPropagation();const nm=renamingBank.name.trim();if(!nm)return;await apiJson(`/api/banks/${b.id}`,{method:'PUT',headers:hdrs(),body:JSON.stringify({name:nm})}).catch(()=>null);setBanks(prev=>prev.map(x=>x.id===b.id?{...x,name:nm}:x));setRenamingBank(null);}}>
                            <input autoFocus value={renamingBank.name} onChange={e=>setRenamingBank(prev=>({...prev,name:e.target.value}))} onClick={e=>e.stopPropagation()} style={{flex:1,fontSize:12,padding:'3px 6px',borderRadius:4,border:'1px solid var(--blue)',background:'var(--p-navy-07)',color:'var(--text)'}}/>
                            <button type="submit" onClick={e=>e.stopPropagation()} style={{fontSize:11,padding:'3px 8px',borderRadius:4,border:'none',background:'var(--blue)',color:'var(--text)',cursor:'pointer'}}>保存</button>
                            <button type="button" onClick={e=>{e.stopPropagation();setRenamingBank(null);}} style={{fontSize:11,padding:'3px 8px',borderRadius:4,border:'1px solid var(--p-blue-27)',background:'none',color:'var(--muted)',cursor:'pointer'}}>取消</button>
                          </form>
                        ) : (
                          <><span>{b.name}</span><button onClick={e=>{e.stopPropagation();setRenamingBank({id:b.id,name:b.name});}} style={{flexShrink:0,background:'none',border:'none',color:'var(--muted)',cursor:'pointer',fontSize:12,padding:'0 2px',lineHeight:1}} title="改名">✏️</button>{(b.q_count||0)===0&&<button onClick={async e=>{e.stopPropagation();if(!confirm(`确认删除题库「${b.name}」？此操作不可恢复。`))return;const r=await apiJson(`/api/banks/${b.id}`,{method:'DELETE',headers:hdrs()}).catch(()=>null);if(r?.ok){setBanks(prev=>prev.filter(x=>x.id!==b.id));}else{alert('删除失败');}}} style={{flexShrink:0,background:'none',border:'none',color:'var(--red)',cursor:'pointer',fontSize:12,padding:'0 2px',lineHeight:1,opacity:0.7}} title="删除空题库">🗑️</button>}</>
                        )}
                        {b.bank_type_summary && b.bank_type_summary !== 'empty' && (() => {
                          const map = { choice:{label:'选择',color:'var(--p-blue-68)'}, fill:{label:'填空',color:'var(--amber)'}, short:{label:'简答',color:'var(--green)'}, mixed:{label:'混合',color:'var(--p-indigo-76)'} };
                          const m = map[b.bank_type_summary];
                          return m && <span style={{fontSize:11,color:m.color,background:m.color+'22',border:`1px solid ${m.color}44`,borderRadius:4,padding:'1px 5px',fontWeight:600}}>{m.label}</span>;
                        })()}
                      </div>
                      <div style={{fontSize:11,color:'var(--muted)'}}>
                        {b.q_count||0} 题
                        {(() => {
                          const TLAB = {choice_single:'单选',choice_multi:'多选',true_false:'判断',fill_blank:'填空',short_answer:'简答'};
                          const ORDER = ['choice_single','choice_multi','true_false','fill_blank','short_answer'];
                          const d = b.type_dist || {};
                          const parts = ORDER.filter(t=>d[t]).map(t=>`${TLAB[t]}${d[t]}`);
                          return parts.length>0 ? <span style={{marginLeft:6,color:'var(--muted)'}}>· {parts.join('/')}</span> : null;
                        })()}
                        <span style={{color:'var(--p-blue-27)',marginLeft:4}}>{expanded?'▲':'▼'}</span>
                      </div>
                    </div>
                  </div>
                  {expanded&&qs!==null&&(
                    <div style={{padding:'0 12px 10px',background:'var(--p-navy-07-a50)',maxHeight:320,overflowY:'auto'}}>
                      {qs.length===0?<div style={{fontSize:11,color:'var(--muted)',textAlign:'center',padding:'8px 0'}}>暂无题目</div>:qs.map(q=>{
                        const sel=qSelected.includes(q.id);
                        const maxReached=!sel&&(pinMode==='manual'?qSelected.length>=pinCount:false);
                        return (
                          <div key={q.id} style={{display:'flex',alignItems:'flex-start',gap:8,padding:'7px 0',borderBottom:'1px solid var(--p-navy-22-a30)'}}>
                            {canCheck&&<div onClick={e=>{e.stopPropagation();if(sel){setQSelected(s=>s.filter(id=>id!==q.id));}else if(!maxReached){setQSelected(s=>[...s,q.id]);}}} style={{width:16,height:16,borderRadius:3,border:`2px solid ${sel?'var(--blue)':'var(--p-blue-27)'}`,background:sel?'var(--blue)':'none',flexShrink:0,marginTop:2,display:'flex',alignItems:'center',justifyContent:'center',cursor:maxReached?'not-allowed':'pointer',opacity:maxReached?0.4:1}}>
                              {sel&&<span style={{color:'var(--text)',fontSize:11}}>✓</span>}
                            </div>}
                            <div style={{flex:1,fontSize:11,color:'var(--muted)',lineHeight:1.5}}>{q.text}</div>
                            <button onClick={e=>{e.stopPropagation();setEditQModal({id:q.id,bankId:b.id,text:q.text,reference:q.reference||'',keywords:q.keywords||'',category:q.category||''});}} style={{flexShrink:0,background:'none',border:'1px solid var(--p-blue-60-a30)',color:'var(--p-blue-68)',borderRadius:4,padding:'2px 8px',fontSize:11,cursor:'pointer',marginRight:4}}>编辑</button>
                            <button onClick={e=>{e.stopPropagation();deleteQ(q.id);}} style={{flexShrink:0,background:'none',border:'1px solid var(--p-red-60-a30)',color:'var(--red)',borderRadius:4,padding:'2px 8px',fontSize:11,cursor:'pointer'}}>删除</button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            };
            const BankSection = ({sectionKey,label,icon,typeColor,items,defaultOpen=true})=>{
              const open = sectionKey in bankSectionOpen ? bankSectionOpen[sectionKey] : defaultOpen;
              const toggleOpen = ()=>setBankSectionOpen(prev=>({...prev,[sectionKey]:!open}));
              if(!items||items.length===0)return null;
              const totalQ = items.reduce((s,b)=>s+(b.q_count||0),0);
              return (
                <div style={{marginBottom:10,border:'1px solid var(--border)',borderRadius:8,overflow:'hidden'}}>
                  <div onClick={toggleOpen} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'9px 12px',background:'var(--input-bg)',cursor:'pointer',borderLeft:`3px solid ${typeColor||'var(--border)'}`}}>
                    <span style={{fontSize:12,fontWeight:700,color:'var(--text)'}}>{icon} {label}
                      <span style={{color:'var(--muted)',fontWeight:400,fontSize:11,marginLeft:6}}>{items.length}个题库 · {totalQ}题</span>
                    </span>
                    <span style={{color:'var(--muted)',fontSize:11}}>{open?'▲':'▼'}</span>
                  </div>
                  {open&&items.map(b=>renderBankRow(b))}
                </div>
              );
            };
            return (
              <div className="card">
                <div style={{fontSize:11,color:'var(--muted)',letterSpacing:1,fontWeight:600,marginBottom:10}}>📚 题库管理</div>
                {BANK_TYPES.map(t=>(
                  <BankSection key={t.key} sectionKey={t.key} label={t.label} icon={t.icon} typeColor={t.color} items={bankGroups[t.key]||[]} defaultOpen={t.key==='emergency'}/>
                ))}

                {/* ── 录题入口 ── */}
                <div style={{marginTop:8}}>
                  <button onClick={()=>setAddMode(m=>m?null:'media')} style={{width:'100%',padding:'10px',borderRadius:8,border:`1px solid ${addMode?'var(--p-blue-60-a50)':'var(--border)'}`,background:addMode?'var(--p-blue-60-a08)':'var(--input-bg)',color:addMode?'var(--p-blue-68)':'var(--muted)',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}>
                    {addMode?'▲ 收起录题':'＋ 录题'}
                  </button>

                  {addMode&&(
                    <div style={{marginTop:10,padding:'12px',background:'var(--p-navy-07-a50)',border:'1px solid var(--border)',borderRadius:8}}>
                      {/* 来源选择 */}
                      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:6,marginBottom:12}}>
                        {[['media','📸','AI 解析','图片或文档'],['manual','✏️','手动录入','逐题输入'],['excel','📊','Excel','批量导入']].map(([m,icon,label,sub])=>(
                          <button key={m} onClick={()=>setAddMode(m)} style={{padding:'10px 4px',borderRadius:8,border:`2px solid ${addMode===m?'var(--p-blue-60-a60)':'var(--border)'}`,background:addMode===m?'var(--p-blue-60-a12)':'var(--p-navy-07-a40)',color:'var(--text)',cursor:'pointer',textAlign:'center',fontFamily:'inherit',transition:'border-color .15s'}}>
                            <div style={{fontSize:18,marginBottom:2}}>{icon}</div>
                            <div style={{fontSize:11,fontWeight:700,color:addMode===m?'var(--p-blue-78)':'var(--muted)'}}>{label}</div>
                            <div style={{fontSize:11,color:'var(--p-blue-35)',marginTop:1}}>{sub}</div>
                          </button>
                        ))}
                      </div>
                      {addMode==='media'&&<DocParseCard pwd={pwd} banks={banks} onImported={()=>apiJson('/api/banks',{headers:hdrs()}).then(setBanks).catch(()=>{})}/>}
                      {addMode==='manual'&&<ManualEntryForm pwd={pwd} banks={banks} hdrs={hdrs} onDone={()=>apiJson('/api/banks',{headers:hdrs()}).then(setBanks).catch(()=>{})}/>}
                      {addMode==='excel'&&<ExcelImportForm pwd={pwd} banks={banks} onDone={()=>apiJson('/api/banks',{headers:hdrs()}).then(setBanks).catch(()=>{})}/>}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

        </>}

        {/* 题目编辑弹窗 */}
        {editQModal&&(
          <div onClick={()=>setEditQModal(null)} style={{position:'fixed',inset:0,background:'var(--p-black-00-a80)',zIndex:400,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
            <div onClick={e=>e.stopPropagation()} style={{background:'var(--p-navy-16)',borderRadius:12,padding:20,width:'100%',maxWidth:400,border:'1px solid var(--p-blue-60-a30)',display:'flex',flexDirection:'column',gap:12}}>
              <div style={{fontWeight:700,color:'var(--text)',fontSize:15}}>编辑题目</div>
              <div>
                <div style={{fontSize:11,color:'var(--muted)',marginBottom:4}}>题目</div>
                <textarea value={editQModal.text} onChange={e=>setEditQModal(m=>({...m,text:e.target.value}))}
                  rows={3} style={{width:'100%',padding:'8px 10px',borderRadius:7,border:'1px solid var(--border)',background:'var(--p-navy-07)',color:'var(--text)',fontSize:12,fontFamily:'inherit',resize:'vertical',boxSizing:'border-box'}}/>
              </div>
              <div>
                <div style={{fontSize:11,color:'var(--muted)',marginBottom:4}}>参考答案（各要点用分号分隔）</div>
                <textarea value={editQModal.reference} onChange={e=>setEditQModal(m=>({...m,reference:e.target.value}))}
                  rows={4} style={{width:'100%',padding:'8px 10px',borderRadius:7,border:'1px solid var(--border)',background:'var(--p-navy-07)',color:'var(--text)',fontSize:12,fontFamily:'inherit',resize:'vertical',boxSizing:'border-box'}}/>
              </div>
              <div>
                <div style={{fontSize:11,color:'var(--muted)',marginBottom:4}}>关键词（逗号分隔，用于关键词评分）</div>
                <input value={editQModal.keywords} onChange={e=>setEditQModal(m=>({...m,keywords:e.target.value}))}
                  style={{width:'100%',padding:'7px 10px',borderRadius:7,border:'1px solid var(--border)',background:'var(--p-navy-07)',color:'var(--text)',fontSize:12,boxSizing:'border-box'}}/>
              </div>
              <div style={{display:'flex',gap:8,marginTop:4}}>
                <button onClick={()=>setEditQModal(null)} style={{flex:1,padding:'10px',borderRadius:7,border:'1px solid var(--border)',background:'transparent',color:'var(--muted)',fontFamily:'inherit',fontSize:13,cursor:'pointer'}}>取消</button>
                <button onClick={async()=>{
                  const r=await apiJson(`/api/questions/${editQModal.id}`,{method:'PUT',headers:hdrs(),body:JSON.stringify({text:editQModal.text,reference:editQModal.reference,keywords:editQModal.keywords,category:editQModal.category})}).catch(()=>null);
                  if(r?.ok){
                    setBankQsCache(prev=>({...prev,[editQModal.bankId]:(prev[editQModal.bankId]||[]).map(q=>q.id===editQModal.id?{...q,text:editQModal.text,reference:editQModal.reference,keywords:editQModal.keywords}:q)}));
                    setEditQModal(null);
                  } else { alert('保存失败'); }
                }} style={{flex:2,padding:'10px',borderRadius:7,border:'none',background:'linear-gradient(135deg,var(--p-navy-25),var(--blue))',color:'var(--text)',fontFamily:'inherit',fontSize:13,fontWeight:600,cursor:'pointer'}}>保存</button>
              </div>
            </div>
          </div>
        )}

        {tab==='settings'&&<>
          <ImportPlanCard hdrs={hdrs}/>
          <div className="card">
            <div style={{fontSize:11,color:'var(--muted)',letterSpacing:1,marginBottom:12,fontWeight:600}}>题库与答题设置</div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 0',borderBottom:'1px solid var(--border)',fontSize:13}}>
              <span style={{color:'var(--muted)'}}>考试模式</span>
              <div style={{width:38,height:22,borderRadius:11,background:settings.exam_mode==='1'?'var(--green)':'var(--p-navy-17)',position:'relative',cursor:'pointer'}} onClick={()=>{const nv=settings.exam_mode==='1'?'0':'1';api('/api/settings',{method:'PUT',headers:hdrs(),body:JSON.stringify({exam_mode:nv})}).then(()=>setSettings(s=>({...s,exam_mode:nv})));}}>
                <div style={{width:18,height:18,borderRadius:9,background:'white',position:'absolute',top:2,transition:'transform .2s',transform:settings.exam_mode==='1'?'translateX(18px)':'translateX(2px)'}}/>
              </div>
            </div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 0',fontSize:13}}>
              <span style={{color:'var(--muted)'}}>开新一轮班组</span>
              <button style={{background:'none',border:'1px solid var(--border)',color:'var(--blue)',padding:'5px 12px',borderRadius:7,cursor:'pointer',fontSize:12}} onClick={()=>{const label=prompt('输入本轮班组名称（如：3月第4轮）');if(label)api('/api/admin/cycle/new',{method:'POST',headers:hdrs(),body:JSON.stringify({label})}).then(()=>alert('新周期已开始，排行榜已重置'));}}>开启新轮次 →</button>
            </div>
          </div>
          <div className="card">
            <div style={{fontSize:11,color:'var(--muted)',letterSpacing:1,marginBottom:12,fontWeight:600}}>积分规则说明</div>
            <div style={{fontSize:13,color:'var(--muted)',lineHeight:2}}>
              每题均分，满分 <strong style={{color:'var(--gold)'}}>100分</strong>（题数不同每题分值自动调整）<br/>
              60分及格，按答题得分比例折算<br/>
              本月练习过：额外 <strong style={{color:'var(--green)'}}>+1分</strong><br/>
              本轮排行榜范围：<strong style={{color:'var(--text)'}}>白班→夜班→早班（27人）</strong>
            </div>
          </div>
        </>}

        {tab==='qr'&&(
          <div className="card" style={{textAlign:'center'}}>
            <div style={{fontSize:13,color:'var(--muted)',marginBottom:16}}>班组成员扫码即可进入答题页</div>
            {qr?<><img src={qr.qr} alt="QR" style={{width:240,height:240,borderRadius:10,border:'4px solid var(--border)'}}/><div style={{marginTop:12,fontSize:13,color:'var(--gold)'}}>{qr.url}</div></>:<div className="spinner"/>}
          </div>
        )}
        {tab==='devices'&&<DevicesTab devices={devices} setDevices={setDevices} hdrs={hdrs}/>}

        {tab==='logs'&&<LogsTab logs={logs} setLogs={setLogs} hdrs={hdrs}/>}

      </div>
    </div>
  );
}

export default AdminScreen;
