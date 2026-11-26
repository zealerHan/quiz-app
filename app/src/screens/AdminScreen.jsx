import { useState, useEffect, useRef, useMemo } from "react";
import { api, apiJson, adminHeaders, AppModal, Badge, ScoreRing, MiniBar, SHOW_LEADERBOARD } from "../shared.jsx";
// 题库子组件与常量（2026-11-27 从本文件抽出）
import {
  BankTypeSelect, AddQuestionPanel, BankImportCard, DocParseCard,
  ManualEntryForm, ExcelImportForm, ImportPlanCard,
} from "./admin/QuestionBankParts.jsx";
import { BANK_TYPES, BANK_TYPE_MAP, groupBanksByType } from "./admin/bankConstants.js";

// 供下拉选择框使用的分组 select
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
  // 班组长轮训弹窗
  const [showRotation, setShowRotation] = useState(false);
  const [rotList, setRotList] = useState([]);   // 编辑副本 [{id,name,on_leave}]
  const openRotation = () => {
    const ld = members.filter(m=>!!m.is_leader)
      .sort((a,b)=>(a.rotation_order??999)-(b.rotation_order??999) || String(a.id).localeCompare(String(b.id)))
      .map(m=>({ id:m.id, name:m.real_name||m.name, on_leave: !!m.on_leave }));
    setRotList(ld); setShowRotation(true);
  };
  const rotMove = (i, dir) => { // dir: -1 上移 / +1 下移
    setRotList(prev => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const cp = [...prev]; const t = cp[i]; cp[i] = cp[j]; cp[j] = t; return cp;
    });
  };
  const rotToggleLeave = (i) => setRotList(prev => prev.map((x,k)=> k===i?{...x,on_leave:!x.on_leave}:x));
  const saveRotation = async () => {
    const list = rotList.map((x,k)=>({ staff_id: x.id, rotation_order: k+1, on_leave: x.on_leave?1:0 }));
    const r = await apiJson('/api/admin/rotation', { method:'PUT', headers: hdrs(), body: JSON.stringify({ list }) }).catch(()=>null);
    if (r?.ok) { setShowRotation(false); onRefresh(); alert('轮训顺序已保存，下个早班起生效'); }
    else alert(r?.error || '保存失败');
  };

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
        const leaders=members.filter(m=>!!m.is_leader).sort((a,b)=>(a.rotation_order??999)-(b.rotation_order??999) || String(a.id).localeCompare(String(b.id)));
        if(!leaders.length) return null;
        return (
          <div style={{display:'flex',alignItems:'center',gap:6,padding:'8px 12px 6px',flexWrap:'wrap'}}>
            <span style={{fontSize:11,color:'var(--muted)',flexShrink:0,marginRight:2}}>班组长</span>
            {leaders.map(m=>(
              <div key={m.id} onClick={()=>openEdit(m)} style={{display:'flex',flexDirection:'column',gap:1,padding:'5px 12px',background:m.on_leave?'var(--p-blue-65-a08)':'var(--p-amber-50-a08)',border:`1px solid ${m.on_leave?'var(--p-blue-65-a40)':'var(--p-amber-50-a38)'}`,borderRadius:6,cursor:'pointer',minWidth:56,opacity:m.on_leave?0.75:1}}>
                <div style={{fontSize:12,fontWeight:700,color:m.on_leave?'var(--muted)':'var(--p-amber-56)',whiteSpace:'nowrap'}}>{m.real_name||'（未设）'}</div>
                <div style={{fontSize:11,color:m.on_leave?'var(--muted)':'var(--p-amber-43)'}}>{m.on_leave?'休假中':'班组长'}</div>
              </div>
            ))}
            <button onClick={openRotation} style={{fontSize:11,padding:'4px 9px',borderRadius:6,border:'1px solid var(--p-amber-50-a40)',background:'var(--p-amber-50-a08)',color:'var(--p-amber-56)',cursor:'pointer',flexShrink:0}}>⚙ 轮训</button>
          </div>
        );
      })()}
      {/* 批量操作栏 */}
      <div style={{display:'flex',alignItems:'center',gap:6,padding:'4px 12px',marginBottom:4,flexWrap:'wrap'}}>
        <button onClick={()=>{setBatchMode(m=>!m);clearSelect();}} style={{fontSize:11,padding:'4px 10px',borderRadius:6,border:`1px solid ${batchMode?'var(--blue)':'var(--border)'}`,background:batchMode?'var(--p-blue-60-a15)':'none',color:batchMode?'var(--blue)':'var(--muted)',cursor:'pointer'}}>
          {batchMode?'退出批量':'批量编辑'}
        </button>
        {batchMode&&<>
          <button onClick={selectAll} style={{fontSize:11,padding:'4px 8px',borderRadius:6,border:'1px solid var(--border)',background:'none',color:'var(--muted)',cursor:'pointer'}}>全选</button>
          <button onClick={clearSelect} style={{fontSize:11,padding:'4px 8px',borderRadius:6,border:'1px solid var(--border)',background:'none',color:'var(--muted)',cursor:'pointer'}}>清空</button>
          {batchSelected.size>0&&<span style={{fontSize:11,color:'var(--blue)',marginLeft:2}}>已选{batchSelected.size}人</span>}
          <div style={{display:'flex',gap:5,marginLeft:'auto'}}>
            <button onClick={()=>batchSetIdentity(false,false)} style={{fontSize:11,padding:'4px 9px',borderRadius:6,border:'1px solid var(--p-green-45-a40)',background:'var(--p-green-45-a10)',color:'var(--p-green-58)',cursor:'pointer',opacity:batchSelected.size?1:0.4}}>正常</button>
            <button onClick={()=>batchSetIdentity(true,false)} style={{fontSize:11,padding:'4px 9px',borderRadius:6,border:'1px solid var(--p-purple-65-a40)',background:'var(--p-purple-65-a10)',color:'var(--p-purple-75)',cursor:'pointer',opacity:batchSelected.size?1:0.4}}>测试</button>
            <button onClick={()=>batchSetIdentity(false,true)} style={{fontSize:11,padding:'4px 9px',borderRadius:6,border:'1px solid var(--p-blue-47-a40)',background:'var(--p-blue-47-a10)',color:'var(--muted)',cursor:'pointer',opacity:batchSelected.size?1:0.4}}>免答</button>
            <button onClick={()=>batchSetIdentity(false,false,true)} style={{fontSize:11,padding:'4px 9px',borderRadius:6,border:'1px solid var(--p-amber-47-a40)',background:'var(--p-amber-47-a10)',color:'var(--p-amber-47)',cursor:'pointer',opacity:batchSelected.size?1:0.4}}>车峰</button>
          </div>
        </>}
      </div>
      {/* 人员列表 - 四列卡片网格 */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'5px 6px',marginBottom:10}}>
        {members.length===0&&<div style={{gridColumn:'1/-1',padding:'20px',textAlign:'center',color:'var(--muted)',fontSize:13}}>暂无人员，请添加</div>}
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
          if(m.is_instructor){nameCol='var(--p-blue-68)';bg='var(--p-blue-60-a07)';border='var(--p-blue-60-a28)';}
          else if(m.is_exempt){nameCol='var(--muted)';bg='var(--p-blue-47-a07)';border='var(--p-blue-47-a28)';}
          else if(m.is_cp){nameCol='var(--p-amber-53)';bg='var(--p-amber-53-a07)';border='var(--p-amber-53-a28)';}
          else if(m.is_tester){nameCol='var(--p-purple-75)';bg='var(--p-purple-65-a07)';border='var(--p-purple-65-a25)';}
          else{nameCol='var(--text)';bg='var(--p-navy-10-a80)';border='var(--p-navy-22-a80)';}
          if(isDup) nameCol='var(--p-red-82)';
          if(batchSelected.has(m.id)){bg='var(--p-blue-60-a15)';border='var(--p-blue-60-a55)';}
          return (
            <div key={m.id} onClick={()=>batchMode?toggleSelect(m.id):openEdit(m)}
              style={{display:'flex',flexDirection:'column',gap:2,padding:'6px 8px',background:bg,border:`1px solid ${border}`,borderRadius:6,minWidth:0,cursor:'pointer',position:'relative'}}>
              {batchMode&&<input type="checkbox" checked={batchSelected.has(m.id)} onChange={()=>toggleSelect(m.id)} onClick={e=>e.stopPropagation()} style={{position:'absolute',top:5,right:5,width:13,height:13,accentColor:'var(--blue)'}}/>}
              <div style={{fontSize:12,fontWeight:700,color:nameCol,lineHeight:1.3,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',paddingRight:batchMode?16:0}}>
                {m.real_name||'（未设）'}
              </div>
              <div style={{fontSize:11,color:'var(--muted)',display:'flex',gap:3,flexWrap:'wrap',alignItems:'center'}}>
                {!!m.is_instructor&&<Badge label="教员" color="var(--blue)"/>}
                {!!m.is_leader&&<Badge label="组长" color="var(--amber)"/>}
                {!!m.is_exempt&&!m.is_leader&&<Badge label="免答" color="var(--muted)"/>}
                {!!m.is_tester&&<Badge label="测" color="var(--p-purple-65)"/>}
                {!!m.is_cp&&<Badge label={m.group_name ? `峰·${(m.group_name.match(/[一二三四五六七八九十\d]+/)||[''])[0]}组` : '峰·未归组'} color={m.group_name ? 'var(--p-amber-47)' : 'var(--red)'}/>}
              </div>
            </div>
          );
        })}
      </div>
      {/* 班组长轮训弹窗 */}
      {showRotation && (() => {
        if (rotList.length === 0) return null;
        return (
          <div style={{position:'fixed',inset:0,background:'var(--p-black-00-a85)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:230,padding:16}} onClick={()=>setShowRotation(false)}>
            <div onClick={e=>e.stopPropagation()} style={{background:'var(--p-navy-16)',borderRadius:12,width:'100%',maxWidth:340,maxHeight:'88vh',display:'flex',flexDirection:'column'}}>
              <div style={{padding:'14px 16px',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <div>
                  <div style={{fontWeight:700,fontSize:14,color:'var(--text)'}}>班组长轮训</div>
                  <div style={{fontSize:11,color:'var(--muted)',marginTop:2}}>调整先后/勾休假，下个早班起生效</div>
                </div>
                <button onClick={()=>setShowRotation(false)} style={{background:'none',border:'none',color:'var(--muted)',fontSize:20,cursor:'pointer',lineHeight:1}}>×</button>
              </div>
              <div style={{flex:1,overflowY:'auto',padding:'12px 16px'}}>
                {rotList.map((x,i)=>(
                  <div key={x.id} style={{display:'flex',alignItems:'center',gap:8,padding:'7px 10px',borderRadius:7,background:x.on_leave?'var(--p-blue-65-a08)':'var(--p-navy-07-a40)',border:`1px solid ${x.on_leave?'var(--p-blue-65-a30)':'var(--border)'}`,marginBottom:6}}>
                    <span style={{fontSize:12,color:'var(--muted)',width:16,flexShrink:0}}>{['①','②','③','④'][i]||i+1}</span>
                    <span style={{flex:1,fontSize:13,color:x.on_leave?'var(--muted)':'var(--text)',fontWeight:x.on_leave?400:600}}>{x.name}</span>
                    <span onClick={()=>rotToggleLeave(i)} style={{display:'inline-flex',alignItems:'center',gap:4,cursor:'pointer',userSelect:'none'}}>
                      <span style={{fontSize:11,color:x.on_leave?'var(--muted)':'var(--muted)'}}>休假</span>
                      <span style={{width:30,height:16,borderRadius:8,background:x.on_leave?'var(--amber)':'var(--p-blue-35-a50)',position:'relative',transition:'background .2s',flexShrink:0}}>
                        <span style={{position:'absolute',top:2,width:12,height:12,borderRadius:6,background:'var(--p-white-100)',transition:'left .2s',left:x.on_leave?16:2}}/>
                      </span>
                    </span>
                    <button onClick={()=>rotMove(i,-1)} disabled={i===0} style={{fontSize:12,color:i===0?'var(--muted)':'var(--p-blue-68)',background:'none',border:'none',cursor:i===0?'default':'pointer',padding:'0 3px'}}>↑</button>
                    <button onClick={()=>rotMove(i,1)} disabled={i===rotList.length-1} style={{fontSize:12,color:i===rotList.length-1?'var(--muted)':'var(--p-blue-68)',background:'none',border:'none',cursor:i===rotList.length-1?'default':'pointer',padding:'0 3px'}}>↓</button>
                  </div>
                ))}
                <div style={{fontSize:11,color:'var(--muted)',lineHeight:1.6,marginTop:8}}>提示：班组长休假时勾「休假」，剩余班组长自动轮流；休假结束取消勾选即自动回岗。</div>
              </div>
              <div style={{display:'flex',gap:8,padding:'12px 16px',borderTop:'1px solid var(--border)'}}>
                <button onClick={()=>setShowRotation(false)} style={{flex:1,padding:'9px',borderRadius:7,border:'1px solid var(--border)',background:'transparent',color:'var(--muted)',fontFamily:'inherit',fontSize:13,cursor:'pointer'}}>取消</button>
                <button onClick={saveRotation} style={{flex:2,padding:'9px',borderRadius:7,border:'none',background:'linear-gradient(135deg,var(--p-navy-25),var(--p-blue-53))',color:'var(--text)',fontFamily:'inherit',fontSize:13,fontWeight:700,cursor:'pointer'}}>保存</button>
              </div>
            </div>
          </div>
        );
      })()}
      {/* 编辑人员 Modal */}
      {editId&&(()=>{
        const m=members.find(x=>x.id===editId);
        if(!m) return null;
        return (
          <div style={{position:'fixed',inset:0,background:'var(--p-black-00-a75)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,padding:16}} onClick={()=>{setEditId(null);setDelConfirm(null);}}>
            <div style={{background:'var(--p-navy-16)',borderRadius:12,padding:20,width:'100%',maxWidth:380}} onClick={e=>e.stopPropagation()}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
                <div style={{fontWeight:600,color:'var(--text)',fontSize:15}}>编辑人员</div>
                <div style={{display:'flex',gap:6,alignItems:'center'}}>
                  {delConfirm===m.id?(
                    <>
                      <span style={{fontSize:11,color:'var(--p-red-82)'}}>确认删除？</span>
                      <button onClick={()=>setDelConfirm(null)} style={{fontSize:11,padding:'3px 8px',borderRadius:5,border:'1px solid var(--border)',background:'transparent',color:'var(--muted)',cursor:'pointer',fontFamily:'inherit'}}>取消</button>
                      <button onClick={()=>delStaff(m.id)} style={{fontSize:11,padding:'3px 8px',borderRadius:5,border:'none',background:'var(--red)',color:'var(--text)',cursor:'pointer',fontFamily:'inherit'}}>删除</button>
                    </>
                  ):(
                    <button onClick={()=>setDelConfirm(m.id)} style={{fontSize:11,padding:'3px 8px',borderRadius:5,border:'1px solid var(--p-red-60-a40)',background:'transparent',color:'var(--red)',cursor:'pointer',fontFamily:'inherit'}}>删除此人</button>
                  )}
                  <button onClick={()=>{setEditId(null);setDelConfirm(null);}} style={{fontSize:20,lineHeight:1,padding:'0 4px',border:'none',background:'transparent',color:'var(--muted)',cursor:'pointer'}}>×</button>
                </div>
              </div>
              {[['姓名','real_name','请输入姓名'],['手机后4位','phone_tail','如：1234']].map(([lbl,key,ph])=>(
                <div key={key} style={{marginBottom:8}}>
                  <label style={{display:'block',fontSize:11,color:'var(--muted)',marginBottom:3}}>{lbl}</label>
                  <input value={editForm[key]} onChange={e=>setEditForm(f=>({...f,[key]:e.target.value}))}
                    placeholder={ph} maxLength={key==='phone_tail'?4:20}
                    style={{width:'100%',background:'var(--input-bg)',border:'1px solid var(--border)',borderRadius:6,padding:'7px 10px',color:'var(--text)',fontSize:13,fontFamily:'inherit',outline:'none',boxSizing:'border-box'}}/>
                </div>
              ))}
              <div style={{display:'flex',flexDirection:'column',gap:7,marginBottom:10}}>
                {[
                  ['ld_'+m.id,'is_leader','班组长（最高权限，免答题，免月度任务）','var(--amber)'],
                  ['inst_'+m.id,'is_instructor','教员（可编辑培训计划）','var(--blue)'],
                  ['ex_'+m.id,'is_exempt','免答（仅免每套班答题）','var(--muted)'],
                  ['ts_'+m.id,'is_tester','测试员（积分标注测试）','var(--p-purple-75)'],
                  ['cp_'+m.id,'is_cp','车峰（不计入答题统计）','var(--p-amber-47)']
                ].map(([id,key,label,color])=>(
                  <div key={key} style={{display:'flex',alignItems:'center',gap:8}}>
                    <input type="checkbox" id={id} checked={!!editForm[key]} onChange={e=>setEditForm(f=>({...f,[key]:e.target.checked}))} style={{width:15,height:15,accentColor:'var(--blue)'}}/>
                    <label htmlFor={id} style={{fontSize:12,color,cursor:'pointer'}}>{label}</label>
                  </div>
                ))}
              </div>
              {editErr&&<div style={{color:'var(--red)',fontSize:12,marginBottom:6}}>⚠ {editErr}</div>}
              <div style={{display:'flex',gap:8}}>
                <button onClick={()=>{setEditId(null);setDelConfirm(null);}} style={{flex:1,padding:'9px',borderRadius:7,border:'1px solid var(--border)',background:'transparent',color:'var(--muted)',fontFamily:'inherit',fontSize:13,cursor:'pointer'}}>取消</button>
                <button onClick={saveEdit} style={{flex:2,padding:'9px',borderRadius:7,border:'none',background:'linear-gradient(135deg,var(--p-navy-25),var(--blue))',color:'var(--text)',fontFamily:'inherit',fontSize:13,fontWeight:600,cursor:'pointer'}}>保存</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 添加按钮行 */}
      <div style={{display:'flex',gap:8,marginBottom:12}}>
        <button onClick={()=>{setShowAdd(v=>!v);setShowBatch(false);}} style={{flex:1,padding:'11px',borderRadius:9,border:'1px solid var(--blue)',background:showAdd?'var(--p-blue-60-a12)':'transparent',color:'var(--blue)',fontFamily:'inherit',fontSize:13,cursor:'pointer',fontWeight:600}}>
          ＋ 添加人员
        </button>
        <button onClick={()=>{setShowBatch(v=>!v);setShowAdd(false);}} style={{flex:1,padding:'11px',borderRadius:9,border:'1px solid var(--green)',background:showBatch?'var(--p-green-45-a10)':'transparent',color:'var(--green)',fontFamily:'inherit',fontSize:13,cursor:'pointer',fontWeight:600}}>
          📋 批量导入
        </button>
      </div>

      {/* 单条添加表单 */}
      {showAdd&&(
        <div className="card" style={{marginBottom:10}}>
          <div style={{fontSize:11,color:'var(--muted)',letterSpacing:1,marginBottom:12,fontWeight:600}}>添加人员</div>
          {[
            ['姓名 *', 'real_name', '请输入真实姓名', 'text'],
            ['工号 * （输入数字，Y自动补全）', 'id', '如：3743', 'text'],
            ['手机后4位（用于登录验证）', 'phone_tail', '如：1234', 'text'],
          ].map(([lbl,key,ph,type])=>(
            <div key={key} style={{marginBottom:10}}>
              <label style={{display:'block',fontSize:11,color:'var(--muted)',marginBottom:4}}>{lbl}</label>
              <input type={type} value={addForm[key]} onChange={e=>setAddForm(f=>({...f,[key]:e.target.value}))}
                placeholder={ph} maxLength={key==='phone_tail'?4:20}
                style={{width:'100%',background:'var(--input-bg)',border:'1px solid var(--border)',borderRadius:7,padding:'9px 12px',color:'var(--text)',fontSize:14,fontFamily:'inherit',outline:'none'}}/>
            </div>
          ))}
          {[
            ['add_ld','is_leader','班组长（最高权限，免答题，免月度任务）','var(--amber)'],
            ['add_inst','is_instructor','教员（可编辑培训计划）','var(--blue)'],
            ['exempt','is_exempt','免答（仅免每套班答题）','var(--muted)'],
            ['tester','is_tester','测试员（积分标注测试）','var(--p-purple-75)'],
            ['add_cp','is_cp','车峰（不计入答题统计）','var(--p-amber-47)'],
          ].map(([id,key,label,color])=>(
            <div key={key} style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
              <input type="checkbox" id={id} checked={!!addForm[key]} onChange={e=>setAddForm(f=>({...f,[key]:e.target.checked}))} style={{width:16,height:16}}/>
              <label htmlFor={id} style={{fontSize:12,color,cursor:'pointer'}}>{label}</label>
            </div>
          ))}
          {addErr&&<div style={{color:'var(--red)',fontSize:12,marginBottom:8}}>⚠ {addErr}</div>}
          <div style={{display:'flex',gap:8}}>
            <button onClick={()=>setShowAdd(false)} style={{flex:1,padding:'10px',borderRadius:7,border:'1px solid var(--border)',background:'transparent',color:'var(--muted)',fontFamily:'inherit',fontSize:13,cursor:'pointer'}}>取消</button>
            <button onClick={addOne} style={{flex:2,padding:'10px',borderRadius:7,border:'none',background:'linear-gradient(135deg,var(--p-navy-25),var(--blue))',color:'var(--text)',fontFamily:'inherit',fontSize:13,fontWeight:600,cursor:'pointer'}}>确认添加</button>
          </div>
        </div>
      )}

      {/* 培训小组管理 */}
      <TrainingGroupsSection pwd={pwd} staff={members} />

      {/* 批量导入 */}
      {showBatch&&(
        <div className="card" style={{marginBottom:10}}>
          <div style={{fontSize:11,color:'var(--muted)',letterSpacing:1,marginBottom:6,fontWeight:600}}>批量导入</div>
          <div style={{fontSize:11,color:'var(--muted)',marginBottom:10,lineHeight:1.8}}>
            每行一人，格式：<code style={{color:'var(--gold)'}}>姓名,工号,手机后4位</code><br/>
            示例：<code style={{color:'var(--muted)'}}>张三,3743,1234</code><br/>
            手机尾号可留空，工号不用写Y前缀
          </div>
          <textarea value={batchText} onChange={e=>setBatchText(e.target.value)}
            placeholder={"张三,3743,1234\n李四,3788,5678\n王五,3701"}
            rows={8}
            style={{width:'100%',background:'var(--input-bg)',border:'1px solid var(--border)',borderRadius:7,padding:'10px 12px',color:'var(--text)',fontSize:13,fontFamily:'monospace',outline:'none',resize:'vertical'}}/>
          {batchErr&&<div style={{color:'var(--red)',fontSize:12,marginTop:6}}>⚠ {batchErr}</div>}
          <div style={{display:'flex',gap:8,marginTop:10}}>
            <button onClick={()=>{setShowBatch(false);setBatchText('');}} style={{flex:1,padding:'10px',borderRadius:7,border:'1px solid var(--border)',background:'transparent',color:'var(--muted)',fontFamily:'inherit',fontSize:13,cursor:'pointer'}}>取消</button>
            <button onClick={batchImport} style={{flex:2,padding:'10px',borderRadius:7,border:'none',background:'linear-gradient(135deg,var(--p-green-45-a53),var(--green))',color:'var(--text)',fontFamily:'inherit',fontSize:13,fontWeight:600,cursor:'pointer'}}>导入 {batchText.trim().split('\n').filter(Boolean).length} 人</button>
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
  const [fixedSaveMsg, setFixedSaveMsg] = useState('');

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
    // 车峰人员保留组籍（临时调整跑车方式，回岗即恢复名单），所以要一并带进来，
    // 否则保存时全量替换会把他们的组籍静默删掉
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
    setFixedSaveMsg('');
    try {
      const d = await api('/api/admin/training-fixed-members', { method: 'PUT', headers: hdrs(), body: JSON.stringify({ staff_ids: [...pendingFixed] }) });
      if (d?.ok) { setShowFixedEditor(false); setFixedSaveMsg(''); load(); }
      else setFixedSaveMsg('❌ 保存失败：' + (d?.error || '未知错误'));
    } catch (e) { setFixedSaveMsg('❌ 网络错误'); }
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
    <div style={{marginTop:28,borderTop:'1px solid var(--border)',paddingTop:20}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
        <div style={{fontSize:11,color:'var(--muted)',letterSpacing:1,fontWeight:600}}>培训小组管理</div>
        <div style={{display:'flex',gap:6}}>
          <button onClick={openFixedEditor}
            style={{fontSize:11,padding:'4px 10px',borderRadius:6,border:'1px solid var(--p-amber-47-a50)',background:fixedGlobal.length?'var(--p-amber-47-a10)':'transparent',color:'var(--p-amber-56)',cursor:'pointer',fontFamily:'inherit'}}>
            固定人员{fixedGlobal.length>0?`（${fixedGlobal.length}）`:''}
          </button>
          <button onClick={()=>setShowAddGroup(true)} style={{fontSize:11,padding:'4px 10px',borderRadius:6,border:'1px solid var(--blue)',background:'transparent',color:'var(--blue)',cursor:'pointer',fontFamily:'inherit'}}>＋ 新建小组</button>
        </div>
      </div>

      {showAddGroup && (
        <div className="card" style={{marginBottom:10}}>
          <div style={{fontSize:11,color:'var(--muted)',marginBottom:8,fontWeight:600}}>新建小组</div>
          <input value={newGroupName} onChange={e=>setNewGroupName(e.target.value)} placeholder="如：第一小组" style={{width:'100%',background:'var(--input-bg)',border:'1px solid var(--border)',borderRadius:7,padding:'8px 12px',color:'var(--text)',fontSize:13,fontFamily:'inherit',outline:'none',boxSizing:'border-box'}} />
          <div style={{display:'flex',gap:8,marginTop:8}}>
            <button onClick={()=>{setShowAddGroup(false);setNewGroupName('');}} style={{flex:1,padding:'8px',borderRadius:7,border:'1px solid var(--border)',background:'transparent',color:'var(--muted)',fontFamily:'inherit',fontSize:13,cursor:'pointer'}}>取消</button>
            <button onClick={addGroup} style={{flex:2,padding:'8px',borderRadius:7,border:'none',background:'linear-gradient(135deg,var(--p-navy-25),var(--blue))',color:'var(--text)',fontFamily:'inherit',fontSize:13,fontWeight:600,cursor:'pointer'}}>确认</button>
          </div>
        </div>
      )}

      {groups.map(g => (
        <div key={g.id} className="card" style={{marginBottom:10}}>
          {editingGroup?.id === g.id ? (
            <div>
              <div style={{fontSize:11,color:'var(--muted)',marginBottom:5}}>小组名称</div>
              <input value={editingGroup.name} onChange={e=>setEditingGroup({...editingGroup,name:e.target.value})} style={{width:'100%',background:'var(--input-bg)',border:'1px solid var(--border)',borderRadius:7,padding:'7px 10px',color:'var(--text)',fontSize:13,fontFamily:'inherit',outline:'none',marginBottom:8,boxSizing:'border-box'}} />
              <div style={{fontSize:11,color:'var(--muted)',marginBottom:5}}>负责教员</div>
              <select value={editingGroup.instructor_id||''} onChange={e=>setEditingGroup({...editingGroup,instructor_id:e.target.value||null})} style={{width:'100%',background:'var(--input-bg)',border:'1px solid var(--border)',borderRadius:7,padding:'7px 10px',color:'var(--text)',fontSize:13,fontFamily:'inherit',outline:'none',marginBottom:10}}>
                <option value="">— 暂无 —</option>
                {(staff||[]).map(s=><option key={s.id} value={s.id}>{s.real_name||s.name}（{s.id}）</option>)}
              </select>
              <div style={{display:'flex',gap:8}}>
                <button onClick={()=>setEditingGroup(null)} style={{flex:1,padding:'7px',borderRadius:7,border:'1px solid var(--border)',background:'transparent',color:'var(--muted)',fontFamily:'inherit',fontSize:12,cursor:'pointer'}}>取消</button>
                <button onClick={saveGroupEdit} style={{flex:2,padding:'7px',borderRadius:7,border:'none',background:'linear-gradient(135deg,var(--p-navy-25),var(--blue))',color:'var(--text)',fontFamily:'inherit',fontSize:12,fontWeight:600,cursor:'pointer'}}>保存</button>
              </div>
            </div>
          ) : (
            <div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:600,color:'var(--text)',fontSize:14,marginBottom:3}}>{g.name}</div>
                  <div style={{fontSize:11,color:'var(--muted)',marginBottom:6}}>
                    教员：<span style={{color:'var(--muted)'}}>{g.instructor_id ? staffName(g.instructor_id) : '未指定'}</span>
                  </div>
                  {/* 成员标签 */}
                  <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
                    {g.members.length === 0 && fixedGlobal.length === 0
                      ? <span style={{fontSize:11,color:'var(--muted)'}}>暂无成员</span>
                      : <>
                          {/* 普通成员：过滤掉已是固定人员和已调车峰的 */}
                          {g.members.filter(m=>!fixedSet.has(m.id) && !m.is_cp).map(m => (
                            <span key={m.id} style={{fontSize:11,padding:'2px 7px',borderRadius:5,background:'var(--p-blue-60-a12)',border:'1px solid var(--p-blue-60-a30)',color:'var(--p-blue-78)'}}>
                              {m.real_name||m.name}
                            </span>
                          ))}
                          {/* 固定人员：始终显示在末尾，无需过滤 */}
                          {fixedGlobal.map(sid=>(
                            <span key={'fx_'+sid} style={{fontSize:11,padding:'2px 7px',borderRadius:5,background:'var(--p-amber-47-a12)',border:'1px solid var(--p-amber-47-a40)',color:'var(--p-amber-56)',display:'flex',alignItems:'center',gap:3}}>
                              <span style={{fontSize:11,fontWeight:700}}>固</span>{staffName(sid)}
                            </span>
                          ))}
                          {/* 车峰（临时调整跑车方式）：保留组籍、暂不参与培训名单，显出来避免"库里有人、界面看不见" */}
                          {g.members.filter(m=>m.is_cp).map(m => (
                            <span key={'cp_'+m.id} style={{fontSize:11,padding:'2px 7px',borderRadius:5,background:'var(--p-blue-65-a08)',border:'1px dashed var(--muted)',color:'var(--muted)'}}>
                              {m.real_name||m.name}<span style={{fontSize:11,marginLeft:3}}>车峰</span>
                            </span>
                          ))}
                        </>
                    }
                  </div>
                  <div style={{fontSize:11,color:'var(--muted)',marginTop:5}}>
                    {(()=>{
                      // 车峰 = 临时调整跑车方式：在册但不在跑车序列、不参训。
                      // 两个数字分开写，避免"在册总数"和"实际跑车数"被读混。
                      const cpCnt = g.members.filter(m=>!!m.is_cp).length;
                      const normalCnt = g.members.filter(m=>!fixedSet.has(m.id) && !m.is_cp).length;
                      const running = normalCnt + (g.instructor_id?1:0);
                      return <>
                        实际跑车 {running} 人{g.instructor_id&&<span style={{color:'var(--muted)'}}>（含教员1人）</span>}
                        {cpCnt>0 && <span style={{color:'var(--muted)'}}> · 车峰 {cpCnt} 人（在册，不参训）</span>}
                        {cpCnt>0 && <span style={{color:'var(--muted)'}}> · 在册共 {running+cpCnt} 人</span>}
                        {fixedGlobal.length>0&&<span style={{color:'var(--p-slate-45)'}}> · 另加固定{fixedGlobal.length}人</span>}
                      </>;
                    })()}
                  </div>
                </div>
                <div style={{display:'flex',flexDirection:'column',gap:5,marginLeft:10,flexShrink:0}}>
                  <button onClick={()=>openMemberEdit(g)} style={{fontSize:11,padding:'4px 8px',borderRadius:6,border:'1px solid var(--p-blue-35)',background:'transparent',color:'var(--muted)',cursor:'pointer',fontFamily:'inherit'}}>编辑成员</button>
                  <button onClick={()=>setEditingGroup({id:g.id,name:g.name,instructor_id:g.instructor_id})} style={{fontSize:11,padding:'4px 8px',borderRadius:6,border:'1px solid var(--p-blue-35)',background:'transparent',color:'var(--muted)',cursor:'pointer',fontFamily:'inherit'}}>编辑小组</button>
                  <button onClick={()=>deleteGroup(g.id)} style={{fontSize:11,padding:'4px 8px',borderRadius:6,border:'1px solid var(--p-red-31)',background:'transparent',color:'var(--red)',cursor:'pointer',fontFamily:'inherit'}}>删除</button>
                </div>
              </div>
            </div>
          )}
        </div>
      ))}

      {groups.length === 0 && !showAddGroup && (
        <div style={{textAlign:'center',color:'var(--muted)',fontSize:13,padding:'20px 0'}}>暂无培训小组，点击右上角新建</div>
      )}

      {/* 未分配人员 */}
      {groups.length > 0 && (
        <div style={{marginTop:14}}>
          <div style={{fontSize:11,color:'var(--muted)',fontWeight:600,marginBottom:7}}>
            未分配人员（{unassigned.length}人）
            <span style={{fontSize:11,color:'var(--muted)',fontWeight:400,marginLeft:6}}>点击分配到小组</span>
          </div>
          {unassigned.length === 0
            ? <div style={{fontSize:12,color:'var(--green)'}}>全员已分配</div>
            : <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                {unassigned.map(s => (
                  <div key={s.id} onClick={()=>setAssigningStaff({id:s.id,name:s.real_name||s.name})}
                    style={{fontSize:12,padding:'5px 10px',borderRadius:7,border:'1px dashed var(--p-blue-35)',color:'var(--muted)',cursor:'pointer',display:'flex',alignItems:'center',gap:4}}>
                    <span style={{color:'var(--muted)',fontSize:13}}>＋</span>{s.real_name||s.name}
                    {!!s.is_exempt&&<span style={{fontSize:11,padding:'0 3px',borderRadius:3,background:'var(--p-blue-47-a20)',color:'var(--muted)'}}>免</span>}
                  </div>
                ))}
              </div>
          }
        </div>
      )}

      {/* 编辑小组成员弹窗 */}
      {editingMembers !== null && (
        <div style={{position:'fixed',inset:0,background:'var(--p-black-00-a75)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,padding:16}} onClick={()=>setEditingMembers(null)}>
          <div style={{background:'var(--p-navy-16)',borderRadius:12,padding:20,width:'100%',maxWidth:420,maxHeight:'82vh',display:'flex',flexDirection:'column'}} onClick={e=>e.stopPropagation()}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4,flexShrink:0}}>
              <div style={{fontWeight:600,color:'var(--text)',fontSize:15}}>
                编辑成员 — {groups.find(g=>g.id===editingMembers)?.name}
              </div>
              <button onClick={()=>setEditingMembers(null)} style={{fontSize:20,lineHeight:1,padding:'0 4px',border:'none',background:'transparent',color:'var(--muted)',cursor:'pointer'}}>×</button>
            </div>
            <div style={{fontSize:11,color:'var(--muted)',marginBottom:10,flexShrink:0}}>
              已选 <span style={{color:'var(--blue)'}}>{selectedMembers.size}</span> 人（固定人员自动显示，无需勾选）<br/>
              <span style={{color:'var(--muted)'}}>「车峰」= 临时调整跑车方式，保留组籍但不参与培训名单；取消勾选即真正退出小组</span>
            </div>
            <div style={{overflow:'auto',flex:1}}>
              {(() => {
                // 车峰人员不在 allStaff 里（它过滤了 is_cp），但他们是本组成员 → 补进列表显示
                const cur = groups.find(g=>g.id===editingMembers);
                const cpExtra = (cur?.members || []).filter(m=>!!m.is_cp)
                  .filter(m=>!allStaff.some(s=>String(s.id)===String(m.id)));
                return [...allStaff.filter(s=>!fixedSet.has(s.id)), ...cpExtra];
              })().map(s => {
                const checked = selectedMembers.has(s.id);
                const isCp = !!s.is_cp;
                return (
                  <div key={s.id} onClick={()=>toggleMember(s.id)}
                    style={{display:'flex',alignItems:'center',gap:8,padding:'8px 10px',borderRadius:7,marginBottom:4,cursor:'pointer',
                      background:checked?(isCp?'var(--p-blue-65-a10)':'var(--p-navy-25)'):'transparent',
                      border:'1px '+(isCp?'dashed':'solid')+' '+(checked?(isCp?'var(--muted)':'var(--blue)'):'var(--border)')}}>
                    <div style={{width:16,height:16,borderRadius:3,border:'2px solid '+(checked?(isCp?'var(--muted)':'var(--blue)'):'var(--muted)'),background:checked?(isCp?'var(--muted)':'var(--blue)'):'transparent',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,color:'var(--text)',flexShrink:0}}>
                      {checked?'✓':''}
                    </div>
                    <span style={{fontSize:13,color:(checked&&!isCp)?'var(--text)':'var(--muted)',flex:1}}>{s.real_name||s.name}</span>
                    <span style={{fontSize:11,color:'var(--muted)'}}>{s.id}</span>
                    {isCp&&<span style={{fontSize:11,padding:'1px 4px',borderRadius:3,background:'var(--p-blue-65-a15)',color:'var(--muted)'}}>车峰</span>}
                    {!!s.is_exempt&&<span style={{fontSize:11,padding:'1px 4px',borderRadius:3,background:'var(--p-blue-47-a20)',color:'var(--muted)'}}>免答</span>}
                  </div>
                );
              })}
              {fixedGlobal.length > 0 && (
                <div style={{marginTop:8,paddingTop:8,borderTop:'1px solid var(--p-amber-47-a20)'}}>
                  <div style={{fontSize:11,color:'var(--p-slate-45)',marginBottom:6}}>固定人员（自动显示在所有小组末尾）</div>
                  {fixedGlobal.map(sid=>(
                    <div key={sid} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 10px',borderRadius:7,marginBottom:3,background:'var(--p-amber-47-a06)',border:'1px solid var(--p-amber-47-a20)'}}>
                      <span style={{fontSize:11,color:'var(--p-amber-56)',fontWeight:700}}>固</span>
                      <span style={{fontSize:13,color:'var(--p-slate-45)',flex:1}}>{staffName(sid)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{display:'flex',gap:8,marginTop:12,flexShrink:0}}>
              <button onClick={()=>setEditingMembers(null)} style={{flex:1,padding:'10px',borderRadius:7,border:'1px solid var(--border)',background:'transparent',color:'var(--muted)',fontFamily:'inherit',fontSize:13,cursor:'pointer'}}>取消</button>
              <button onClick={saveMembers} style={{flex:2,padding:'10px',borderRadius:7,border:'none',background:'linear-gradient(135deg,var(--p-navy-25),var(--blue))',color:'var(--text)',fontFamily:'inherit',fontSize:13,fontWeight:600,cursor:'pointer'}}>保存（{selectedMembers.size}人）</button>
            </div>
          </div>
        </div>
      )}

      {/* 固定人员编辑弹窗 */}
      {showFixedEditor && (
        <div style={{position:'fixed',inset:0,background:'var(--p-black-00-a75)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,padding:16}} onClick={()=>setShowFixedEditor(false)}>
          <div style={{background:'var(--p-navy-16)',borderRadius:12,padding:20,width:'100%',maxWidth:400,maxHeight:'80vh',display:'flex',flexDirection:'column'}} onClick={e=>e.stopPropagation()}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4,flexShrink:0}}>
              <div style={{fontWeight:600,color:'var(--text)',fontSize:15}}>固定培训人员</div>
              <button onClick={()=>setShowFixedEditor(false)} style={{fontSize:20,lineHeight:1,padding:'0 4px',border:'none',background:'transparent',color:'var(--muted)',cursor:'pointer'}}>×</button>
            </div>
            <div style={{fontSize:11,color:'var(--muted)',marginBottom:12,flexShrink:0}}>勾选后将自动显示在所有小组末尾，无需逐个小组添加</div>
            <div style={{overflow:'auto',flex:1}}>
              {allStaff.map(s => {
                const checked = pendingFixed.has(s.id);
                return (
                  <div key={s.id} onClick={()=>setPendingFixed(prev=>{const ns=new Set(prev);ns.has(s.id)?ns.delete(s.id):ns.add(s.id);return ns;})}
                    style={{display:'flex',alignItems:'center',gap:8,padding:'8px 10px',borderRadius:7,marginBottom:4,cursor:'pointer',
                      background:checked?'var(--p-amber-47-a10)':'transparent',border:'1px solid '+(checked?'var(--p-amber-47-a50)':'var(--border)')}}>
                    <div style={{width:16,height:16,borderRadius:3,border:'2px solid '+(checked?'var(--p-amber-56)':'var(--muted)'),background:checked?'var(--p-amber-56)':'transparent',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,color:'var(--p-navy-16)',flexShrink:0,fontWeight:700}}>
                      {checked?'✓':''}
                    </div>
                    <span style={{fontSize:13,color:checked?'var(--p-amber-56)':'var(--muted)',flex:1}}>{s.real_name||s.name}</span>
                    <span style={{fontSize:11,color:'var(--muted)'}}>{s.id}</span>
                  </div>
                );
              })}
            </div>
            <div style={{display:'flex',gap:8,marginTop:12,flexShrink:0}}>
              <button onClick={()=>{setShowFixedEditor(false);setFixedSaveMsg('');}} style={{flex:1,padding:'10px',borderRadius:7,border:'1px solid var(--border)',background:'transparent',color:'var(--muted)',fontFamily:'inherit',fontSize:13,cursor:'pointer'}}>取消</button>
              <button onClick={saveFixed} style={{flex:2,padding:'10px',borderRadius:7,border:'none',background:'linear-gradient(135deg,var(--p-amber-14),var(--p-amber-44))',color:'var(--text)',fontFamily:'inherit',fontSize:13,fontWeight:600,cursor:'pointer'}}>保存（{pendingFixed.size}人）</button>
            </div>
            {fixedSaveMsg && <div style={{fontSize:12,marginTop:8,color:'var(--red)',textAlign:'center'}}>{fixedSaveMsg}</div>}
          </div>
        </div>
      )}

      {/* 分配到小组弹窗 */}
      {assigningStaff && (
        <div style={{position:'fixed',inset:0,background:'var(--p-black-00-a75)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,padding:16}} onClick={()=>setAssigningStaff(null)}>
          <div style={{background:'var(--p-navy-16)',borderRadius:12,padding:20,width:'100%',maxWidth:360}} onClick={e=>e.stopPropagation()}>
            <div style={{fontWeight:600,color:'var(--text)',fontSize:14,marginBottom:4}}>将 {assigningStaff.name} 加入小组</div>
            <div style={{fontSize:11,color:'var(--muted)',marginBottom:14}}>选择要加入的小组</div>
            {groups.map(g => (
              <div key={g.id} onClick={()=>addToGroup(g.id)}
                style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'11px 14px',borderRadius:8,border:'1px solid var(--border)',marginBottom:7,cursor:'pointer',background:'var(--p-navy-10)'}}>
                <span style={{fontSize:13,color:'var(--text)'}}>{g.name}</span>
                <span style={{fontSize:11,color:'var(--muted)'}}>{g.members.length}人</span>
              </div>
            ))}
            <button onClick={()=>setAssigningStaff(null)} style={{width:'100%',padding:'9px',borderRadius:7,border:'1px solid var(--border)',background:'transparent',color:'var(--muted)',fontFamily:'inherit',fontSize:13,cursor:'pointer',marginTop:4}}>取消</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── AddQuestionPanel ─────────────────────────────────────────────────────────
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
    if(tab==='wall'){ apiJson('/api/wall/admin/posts',{headers:hdrs()}).then(d=>{setWallPosts(d?.posts||[]);setWallLoaded(true);}).catch(()=>{setWallPosts([]);setWallLoaded(true);}); }
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
        {[['overview','概览'],['members','人员'],['leave','休假'],['banks','题库'],['wall','留言'],['settings','设置'],['logs','日志'],['devices','设备'],['qr','扫码']].map(([k,v])=>(
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
          {resetModal&&<AppModal
            icon={resetModal.isAnswering?'⚠️':'🔄'}
            title={resetModal.isAnswering?`正在答题：${resetModal.name}`:`重置：${resetModal.name}`}
            body={resetModal.isAnswering
              ? `⚠ 该人员正在答题（最后操作 ${resetModal.last_active_at?.slice(11,16)||''}），重置会清空其本轮所有答题记录。\n确认要中断并重置吗？`
              : `确认重置本套班答题记录？\n重置后该人员可在本套班内重新答题。`}
            buttons={[
              {label:'取消',onClick:()=>setResetModal(null)},
              {label:resetModal.isAnswering?'仍然重置':'确认重置',danger:true,onClick:async()=>{
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
                if(r?.ok){ alert(`已授权 ${makeupModal.name} 补答，有效至 ${r.expiresAt.slice(0,16)}`); }
                else alert('授权失败，请重试');
              }}
            ]}
          />}

          {/* ── 授权复查弹窗 ── */}
          {remediationModal&&<AppModal
            icon="⚠️"
            title={`授权复查：${remediationModal.name}`}
            body={`本轮得分：${remediationModal.score??'—'}分（不合格）\n\n授权后该人员可在 12 小时内完成本套班复查。\n复查结果将记入复查台账，作为考核依据。`}
            buttons={[
              {label:'取消',onClick:()=>setRemediationModal(null)},
              {label:'确认授权复查',danger:true,onClick:async()=>{
                const r=await apiJson('/api/admin/remediation/grant',{method:'POST',headers:hdrs(),body:JSON.stringify({staffId:remediationModal.staff_id})}).catch(()=>null);
                setRemediationModal(null);
                if(r?.ok){
                  alert(`已授权 ${remediationModal.name} 复查，有效至 ${r.expiresAt.slice(0,16)}`);
                  apiJson('/api/admin/overview',{headers:hdrs()}).then(setOverview).catch(()=>{});
                  apiJson('/api/admin/remediation/records',{headers:hdrs()}).then(setRemRecords).catch(()=>{});
                } else alert('授权失败，请重试');
              }}
            ]}
          />}

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

          {/* ── 成员培训评价详情弹窗 ── */}
          {memberEvalModal&&(
            <div onClick={()=>setMemberEvalModal(null)} style={{position:'fixed',inset:0,background:'var(--p-black-00-a70)',zIndex:200,display:'flex',alignItems:'flex-end',justifyContent:'center'}}>
              <div onClick={e=>e.stopPropagation()} style={{width:'100%',maxWidth:440,background:'var(--input-bg)',border:'1px solid var(--p-blue-60-a30)',borderRadius:'16px 16px 0 0',padding:'20px 16px 32px',maxHeight:'70vh',overflowY:'auto'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
                  <div>
                    <div style={{fontWeight:700,fontSize:15,color:'var(--text)'}}>{memberEvalModal.name}</div>
                    <div style={{fontSize:12,color:'var(--muted)',marginTop:2}}>本月培训项点完成情况</div>
                  </div>
                  <button onClick={()=>setMemberEvalModal(null)} style={{background:'none',border:'none',color:'var(--muted)',fontSize:22,cursor:'pointer',lineHeight:1}}>×</button>
                </div>
                {(()=>{
                  const items=memberEvalModal.itemStatuses||[];
                  if(items.length===0) return <div style={{color:'var(--muted)',fontSize:13,textAlign:'center',padding:'20px 0'}}>本月暂无培训项点</div>;
                  const doneCount=items.filter(it=>it.done).length;
                  return(
                    <div style={{display:'flex',flexDirection:'column',gap:6}}>
                      <div style={{fontSize:11,color:'var(--muted)',marginBottom:4}}>{doneCount}/{items.length} 项已完成</div>
                      {items.map((it,i)=>{
                        const mm_dd = it.done && it.shift_date ? (()=>{const[,mm,dd]=it.shift_date.split('-');return`${parseInt(mm)}/${parseInt(dd)}`;})() : null;
                        return(
                          <div key={i} style={{padding:'10px 12px',background:it.done?'var(--p-green-45-a06)':'var(--p-red-60-a04)',border:`1px solid ${it.done?'var(--p-green-45-a20)':'var(--p-red-60-a15)'}`,borderRadius:8}}>
                            <div style={{display:'flex',alignItems:'center',gap:8}}>
                              <span style={{fontSize:13,flexShrink:0}}>{it.done?'✅':'❌'}</span>
                              <span style={{flex:1,fontSize:12,color:it.done?'var(--text)':'var(--red)',fontWeight:it.done?500:600}}>{it.item}</span>
                              <span style={{fontSize:11,color:'var(--muted)',flexShrink:0}}>{it.trainType}</span>
                              {mm_dd&&<span style={{fontSize:11,color:'var(--muted)',flexShrink:0}}>（{mm_dd}）</span>}
                            </div>
                            {it.done&&it.comment&&(
                              <div style={{marginTop:5,fontSize:11,color:'var(--muted)',lineHeight:1.6,borderLeft:'2px solid var(--p-green-45-a35)',paddingLeft:8}}>评价：{it.comment}</div>
                            )}
                            {it.done&&!it.comment&&(
                              <div style={{marginTop:3,fontSize:11,color:'var(--muted)',paddingLeft:10}}>（无评语）</div>
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
            <div onClick={()=>setPlanDetailModal(null)} style={{position:'fixed',inset:0,background:'var(--p-black-00-a70)',zIndex:200,display:'flex',alignItems:'flex-end',justifyContent:'center'}}>
              <div onClick={e=>e.stopPropagation()} style={{width:'100%',maxWidth:440,background:'var(--input-bg)',border:'1px solid var(--p-blue-60-a30)',borderRadius:'16px 16px 0 0',padding:'20px 16px 32px',maxHeight:'70vh',overflowY:'auto'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
                  <div>
                    <div style={{fontWeight:700,fontSize:15,color:'var(--text)'}}>{(()=>{const[,m,d]=planDetailModal.shift_date.split('-');return`${parseInt(m)}月${parseInt(d)}日`;})()}</div>
                    <div style={{fontSize:12,color:'var(--muted)',marginTop:2}}>{planDetailModal.group_name} · {planDetailModal.plan_type==='培训'?'实操培训':planDetailModal.plan_type}</div>
                  </div>
                  <button onClick={()=>setPlanDetailModal(null)} style={{background:'none',border:'none',color:'var(--muted)',fontSize:22,cursor:'pointer',lineHeight:1}}>×</button>
                </div>
                <div style={{display:'flex',flexDirection:'column',gap:6}}>
                  {planDetailModal.members.length===0
                    ? <div style={{color:'var(--muted)',fontSize:13,textAlign:'center',padding:'20px 0'}}>暂无成员数据</div>
                    : planDetailModal.members.map((m,i)=>(
                      <div key={i} style={{padding:'8px 12px',background:m.evaluated?'var(--p-green-45-a06)':'var(--p-red-60-a05)',border:`1px solid ${m.evaluated?'var(--p-green-45-a18)':'var(--p-red-60-a12)'}`,borderRadius:8}}>
                        <div style={{display:'flex',alignItems:'center',gap:10}}>
                          <div style={{width:8,height:8,borderRadius:'50%',background:m.evaluated?'var(--green)':'var(--red)',flexShrink:0}}/>
                          <div style={{flex:1,fontSize:13,color:'var(--text)',fontWeight:600}}>{m.name}</div>
                          <div style={{fontSize:11,color:m.evaluated?'var(--green)':'var(--red)'}}>{m.evaluated?'已评价':'未评价'}</div>
                        </div>
                        {m.evaluated&&m.comment&&(
                          <div style={{marginTop:5,marginLeft:18,fontSize:11,color:'var(--muted)',lineHeight:1.5,borderLeft:'2px solid var(--p-green-45-a30)',paddingLeft:8}}>{m.comment}</div>
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
            <div style={{fontSize:11,color:'var(--muted)',letterSpacing:2,fontWeight:600,marginBottom:10,textTransform:'uppercase'}}>班组各类题均分</div>
            {overview.catAvg?.map((c,i)=><MiniBar key={i} label={c.category} value={c.avg}/>)}
          </div>

          {/* ── 管理员详情 modal（底部弹出） ── */}
          {adminDrillModal&&(
            <div onClick={()=>setAdminDrillModal(null)} style={{position:'fixed',inset:0,background:'var(--p-black-00-a70)',zIndex:200,display:'flex',alignItems:'flex-end',justifyContent:'center'}}>
              <div onClick={e=>e.stopPropagation()} style={{width:'100%',maxWidth:440,background:'var(--input-bg)',border:'1px solid var(--p-blue-60-a30)',borderRadius:'16px 16px 0 0',padding:'20px 16px 32px',maxHeight:'75vh',overflowY:'auto'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:14}}>
                  <div style={{display:'flex',gap:10,alignItems:'flex-start'}}>
                    <div style={{width:44,height:44,borderRadius:'50%',background:'linear-gradient(135deg,var(--p-navy-25),var(--blue))',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,fontWeight:700,color:'var(--text)',flexShrink:0}}>{adminDrillModal.staffName?.[0]}</div>
                    <div>
                      <div style={{fontSize:15,fontWeight:700,color:'var(--text)'}}>{adminDrillModal.staffName}</div>
                      <div style={{fontSize:11,color:'var(--muted)',marginTop:2}}>{adminDrillModal.mode==='cycle'?'本轮答题记录':'本月套班汇总'}</div>
                    </div>
                  </div>
                  <button onClick={()=>setAdminDrillModal(null)} style={{background:'none',border:'1px solid var(--border)',color:'var(--muted)',borderRadius:6,padding:'4px 10px',cursor:'pointer',fontSize:12,flexShrink:0}}>关闭</button>
                </div>
                {adminDrillModal.loading&&<div style={{textAlign:'center',padding:'20px 0'}}><div className="spinner" style={{margin:'0 auto'}}/></div>}
                {/* cycle mode: show sessions */}
                {!adminDrillModal.loading&&adminDrillModal.mode==='cycle'&&(<>
                  {adminDrillModal.sessions?.length===0&&<div style={{color:'var(--muted)',fontSize:13,textAlign:'center',padding:'20px 0'}}>暂无答题记录</div>}
                  {adminDrillModal.sessions?.map((s,si)=>(
                    <div key={si} style={{marginBottom:12,background:'var(--p-navy-16-a60)',border:'1px solid var(--border)',borderRadius:10,padding:'12px 14px'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                        <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                          <span style={{fontSize:11,color:'var(--muted)'}}>{s.created_at?.slice(5,10)}{s.created_at?.length>=16?` ${s.created_at.slice(11,16)}`:''}{s.cycle_label?` · ${s.cycle_label}`:''}</span>
                          {s.tab_switch_count>0&&<span style={{fontSize:11,color:'var(--red)',background:'var(--p-red-60-a12)',border:'1px solid var(--p-red-60-a30)',borderRadius:4,padding:'0 5px',fontWeight:700}}>切屏×{s.tab_switch_count}</span>}
                        </div>
                        <div style={{display:'flex',gap:8,alignItems:'center'}}>
                          <span style={{fontSize:12,fontWeight:700,color:'var(--text)'}}>{Math.round(s.total_score)}分</span>
                          <button onClick={async()=>{if(!window.confirm(`确认删除这条成绩？`))return;const r=await apiJson(`/api/admin/sessions/staff/${adminDrillModal.staffId}?cycle_id=${overview.cycle?.id}`,{method:'DELETE',headers:hdrs()}).catch(()=>null);if(r?.ok){apiJson('/api/admin/leaderboard/cycle',{headers:hdrs()}).then(d=>setLbSessions(d.rows||[])).catch(()=>{});setAdminDrillModal(null);}}} style={{fontSize:11,padding:'2px 6px',borderRadius:4,border:'1px solid var(--p-red-60-a30)',background:'none',color:'var(--red)',cursor:'pointer'}}>删除</button>
                        </div>
                      </div>
                      {s.answers?.map((a,ai)=>(
                        <div key={ai} style={{padding:'6px 0',borderTop:'1px solid var(--p-navy-22-a50)',display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
                          <span style={{fontSize:11,color:'var(--text)',flex:1,lineHeight:1.5}}>{a.question_text}</span>
                          <span style={{fontSize:12,fontWeight:700,flexShrink:0,color:a.score>=99?'var(--green)':a.score>=67?'var(--amber)':'var(--red)'}}>{Math.round(a.score/(s.answers.length||3))}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </>)}
                {/* alltime mode: cycles list, click to expand questions */}
                {!adminDrillModal.loading&&adminDrillModal.mode==='alltime'&&(<>
                  {adminDrillModal.cycles?.length===0&&<div style={{color:'var(--muted)',fontSize:13,textAlign:'center',padding:'20px 0'}}>暂无记录</div>}
                  {adminDrillModal.cycles?.map((cy,ci)=>{
                    const cyExp=adminDrillModal.expandedCycleId===cy.cycle_id;
                    return(
                      <div key={ci} style={{marginBottom:10,background:'var(--p-navy-16-a60)',border:'1px solid var(--border)',borderRadius:10,overflow:'hidden'}}>
                        <div onClick={()=>setAdminDrillModal(m=>({...m,expandedCycleId:cyExp?null:cy.cycle_id}))} style={{display:'flex',alignItems:'center',gap:10,padding:'12px 14px',cursor:'pointer'}}>
                          <div style={{flex:1}}>
                            <div style={{fontSize:13,fontWeight:600,color:'var(--text)'}}>{cy.cycle_label||cy.cycle_id||'—'}</div>
                            <div style={{fontSize:11,color:'var(--muted)',marginTop:2}}>{cy.sessions_count}次答题</div>
                          </div>
                          <span style={{fontSize:13,fontWeight:700,color:'var(--gold)'}}>{cy.total_points}分</span>
                          <span style={{fontSize:15,color:'var(--p-blue-68)',display:'inline-block',transform:cyExp?'rotate(180deg)':'none',transition:'transform 0.2s'}}>⌄</span>
                        </div>
                        {cyExp&&cy.sessions?.map((s,si)=>(
                          <div key={si} style={{borderTop:'1px solid var(--p-navy-22-a40)',padding:'10px 14px',background:'var(--p-navy-09-a40)'}}>
                            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                              <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                                <span style={{fontSize:11,color:'var(--muted)'}}>{s.created_at?.slice(5,10)}{s.created_at?.length>=16?` ${s.created_at.slice(11,16)}`:''}</span>
                                {s.tab_switch_count>0&&<span style={{fontSize:11,color:'var(--red)',background:'var(--p-red-60-a12)',border:'1px solid var(--p-red-60-a30)',borderRadius:4,padding:'0 5px',fontWeight:700}}>切屏×{s.tab_switch_count}</span>}
                              </div>
                              <div style={{display:'flex',gap:6,alignItems:'center'}}>
                                <span style={{fontSize:11,fontWeight:700,color:'var(--text)'}}>{Math.round(s.total_score)}分</span>
                              </div>
                            </div>
                            {s.answers?.map((a,ai)=>(
                              <div key={ai} style={{padding:'5px 0',borderTop:'1px solid var(--p-navy-22-a40)',display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
                                <span style={{fontSize:11,color:'var(--muted)',flex:1,lineHeight:1.5}}>{a.question_text}</span>
                                <span style={{fontSize:11,fontWeight:700,flexShrink:0,color:a.score>=99?'var(--green)':a.score>=67?'var(--amber)':'var(--red)'}}>{Math.round(a.score/(s.answers.length||3))}</span>
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

          {/* ── 导出记录 ── */}
          <button onClick={()=>{
            setShowExportMenu('open');
            if(!exportMonths.length) apiJson('/api/export/months',{headers:hdrs()}).then(setExportMonths).catch(()=>{});
          }} className="btn-primary" style={{width:'100%',textAlign:'center',padding:'13px',border:'none',cursor:'pointer'}}>📊 导出记录</button>

          {/* 导出弹窗 */}
          {showExportMenu==='open'&&(
            <div style={{position:'fixed',inset:0,background:'var(--p-black-00-a75)',zIndex:200,display:'flex',alignItems:'flex-end',justifyContent:'center'}} onClick={()=>{setShowExportMenu(null);setExportWsModal(null);setWsMultiMonthSel(null);}}>
              <div style={{background:'var(--p-navy-10)',borderRadius:'14px 14px 0 0',width:'100%',maxWidth:480,maxHeight:'80vh',display:'flex',flexDirection:'column'}} onClick={e=>e.stopPropagation()}>
                {/* 顶栏 */}
                <div style={{padding:'14px 16px 10px',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
                  <span style={{fontWeight:700,color:'var(--text)',fontSize:15}}>📊 导出记录</span>
                  <button onClick={()=>{setShowExportMenu(null);setExportWsModal(null);setWsMultiMonthSel(null);}} style={{background:'none',border:'none',color:'var(--muted)',fontSize:22,cursor:'pointer',padding:0,lineHeight:1}}>×</button>
                </div>
                {/* ── 主选择面板 ── */}
                {!exportWsModal&&!wsMultiMonthSel&&(
                  <div style={{padding:'12px 16px',display:'flex',flexDirection:'column',gap:10,overflowY:'auto'}}>
                    {/* 抽问记录：复选框多月合并 */}
                    <div>
                      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
                        <span style={{fontSize:11,color:'var(--muted)',fontWeight:600,letterSpacing:1}}>📋 抽问记录</span>
                        <div style={{display:'flex',gap:6,alignItems:'center'}}>
                          <button onClick={()=>{const allM=new Set(exportMonths);setQuizExportSel(quizExportSel.size===exportMonths.length?new Set():allM);}} style={{padding:'3px 8px',borderRadius:4,border:'1px solid var(--border)',background:'transparent',color:'var(--muted)',cursor:'pointer',fontSize:11,fontFamily:'inherit'}}>
                            {quizExportSel.size===exportMonths.length&&exportMonths.length>0?'取消全选':'全选'}
                          </button>
                          <button onClick={()=>{if(!quizExportSel.size)return;const ms=[...quizExportSel].sort().join(',');window.open(`/api/export/multi?password=${encodeURIComponent(pwd)}&months=${ms}`,'_blank');}}
                            disabled={!quizExportSel.size}
                            style={{padding:'3px 10px',borderRadius:4,border:'none',background:quizExportSel.size?'var(--blue)':'var(--border)',color:quizExportSel.size?'white':'var(--muted)',cursor:quizExportSel.size?'pointer':'default',fontSize:11,fontWeight:600,fontFamily:'inherit'}}>
                            ↓ 合并导出{quizExportSel.size?` (${quizExportSel.size}月)`:''}
                          </button>
                        </div>
                      </div>
                      <div style={{background:'var(--input-bg)',border:'1px solid var(--p-blue-60-a25)',borderRadius:8,overflow:'hidden'}}>
                        {exportMonths.length===0&&<div style={{padding:'12px 14px',fontSize:12,color:'var(--muted)'}}>暂无数据</div>}
                        {exportMonths.map(m=>{
                          const sel=quizExportSel.has(m);
                          return (
                            <div key={m} onClick={()=>{const next=new Set(quizExportSel);sel?next.delete(m):next.add(m);setQuizExportSel(next);}}
                              style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',borderTop:'1px solid var(--p-navy-22-a50)',cursor:'pointer',background:sel?'var(--p-blue-60-a08)':'transparent'}}>
                              <div style={{width:15,height:15,borderRadius:3,border:`2px solid ${sel?'var(--blue)':'var(--p-blue-27)'}`,background:sel?'var(--blue)':'transparent',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                                {sel&&<span style={{color:'var(--text)',fontSize:11,fontWeight:700,lineHeight:1}}>✓</span>}
                              </div>
                              <span style={{fontSize:13,color:'var(--text)',flex:1}}>{m}</span>
                              <a href={`/api/export?password=${encodeURIComponent(pwd)}&month=${m}`} target="_blank" onClick={e=>e.stopPropagation()} style={{fontSize:11,color:'var(--muted)',textDecoration:'none',padding:'2px 6px',borderRadius:3,border:'1px solid var(--border)'}}>单月↓</a>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    {/* 月度任务 */}
                    <div>
                      <div style={{fontSize:11,color:'var(--muted)',fontWeight:600,letterSpacing:1,marginBottom:6}}>🏭 月度任务</div>
                      <div style={{display:'flex',gap:8}}>
                        <button onClick={async()=>{
                          setExportWsModal({plans:[],months:[],activeMonth:'',selected:new Set(),showMonthPicker:false,loading:true});
                          const plans=await apiJson('/api/export/workshop/plans',{headers:hdrs()}).catch(()=>[]);
                          const allPlans=Array.isArray(plans)?plans:[];
                          const months=[...new Set(allPlans.map(p=>p.year_month))].sort((a,b)=>b.localeCompare(a));
                          const curMonth=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}).slice(0,7);
                          const active=months.includes(curMonth)?curMonth:(months[0]||curMonth);
                          const mp=allPlans.filter(p=>p.year_month===active);
                          setExportWsModal({plans:allPlans,months,activeMonth:active,selected:new Set(mp.map(p=>p.id)),showMonthPicker:false,loading:false});
                        }} style={{flex:1,padding:'11px',borderRadius:8,border:'1px solid var(--p-green-45-a30)',background:'var(--p-green-45-a06)',color:'var(--p-green-58)',cursor:'pointer',fontSize:13,fontWeight:600,fontFamily:'inherit'}}>
                          按场次导出 →
                        </button>
                        <button onClick={async()=>{
                          const wsMths=await apiJson('/api/export/workshop/months',{headers:hdrs()}).catch(()=>[]);
                          const ms=Array.isArray(wsMths)?wsMths:[];
                          setWsMultiMonthSel({months:ms,selected:new Set()});
                        }} style={{flex:1,padding:'11px',borderRadius:8,border:'1px solid var(--p-amber-56-a30)',background:'var(--p-amber-56-a06)',color:'var(--p-amber-56)',cursor:'pointer',fontSize:13,fontWeight:600,fontFamily:'inherit'}}>
                          跨月合并 →
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                {/* ── 培训跨月合并面板 ── */}
                {!exportWsModal&&wsMultiMonthSel&&(()=>{
                  const {months,selected:sel}=wsMultiMonthSel;
                  const allSel=months.length>0&&months.every(m=>sel.has(m));
                  const toggleM=m=>{const next=new Set(sel);next.has(m)?next.delete(m):next.add(m);setWsMultiMonthSel(prev=>({...prev,selected:next}));};
                  const doExport=()=>{if(!sel.size)return;const ms=[...sel].sort().join(',');window.open(`/api/export/workshop?password=${encodeURIComponent(pwd)}&months=${ms}`,'_blank');};
                  return (<>
                    <div style={{padding:'8px 14px',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',gap:6,flexShrink:0}}>
                      <button onClick={()=>setWsMultiMonthSel(null)} style={{background:'none',border:'none',color:'var(--p-blue-68)',fontSize:13,cursor:'pointer',padding:0,marginRight:4}}>← 返回</button>
                      <span style={{fontSize:13,color:'var(--text)',flex:1,fontWeight:600}}>培训记录跨月合并</span>
                      <button onClick={()=>setWsMultiMonthSel(prev=>({...prev,selected:allSel?new Set():new Set(months)}))} style={{padding:'5px 8px',borderRadius:5,border:'1px solid var(--border)',background:'transparent',color:'var(--muted)',cursor:'pointer',fontSize:11,fontFamily:'inherit'}}>{allSel?'取消全选':'全选'}</button>
                      <button onClick={doExport} disabled={!sel.size} style={{padding:'5px 12px',borderRadius:5,border:'none',background:sel.size?'var(--p-amber-56)':'var(--border)',color:sel.size?'var(--p-amber-05)':'var(--muted)',cursor:sel.size?'pointer':'default',fontSize:11,fontWeight:600,fontFamily:'inherit'}}>↓ 导出{sel.size?` (${sel.size}月)`:''}</button>
                    </div>
                    <div style={{flex:1,overflowY:'auto'}}>
                      <div style={{padding:'8px 14px',fontSize:11,color:'var(--muted)'}}>每个月生成一个 Sheet，含培训日程和出勤人数</div>
                      {months.length===0&&<div style={{textAlign:'center',color:'var(--muted)',padding:'28px 0',fontSize:13}}>暂无数据</div>}
                      {months.map(m=>(
                        <div key={m} onClick={()=>toggleM(m)} style={{display:'flex',alignItems:'center',gap:10,padding:'11px 14px',borderBottom:'1px solid var(--p-navy-22-a35)',cursor:'pointer',background:sel.has(m)?'var(--p-amber-56-a06)':'transparent'}}>
                          <div style={{width:16,height:16,borderRadius:3,border:`2px solid ${sel.has(m)?'var(--p-amber-56)':'var(--p-blue-27)'}`,background:sel.has(m)?'var(--p-amber-56)':'transparent',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                            {sel.has(m)&&<span style={{color:'var(--p-amber-05)',fontSize:11,fontWeight:700,lineHeight:1}}>✓</span>}
                          </div>
                          <span style={{fontSize:13,color:'var(--text)'}}>{m}</span>
                        </div>
                      ))}
                    </div>
                  </>);
                })()}
                {/* ── 月度任务按场次勾选面板 ── */}
                {exportWsModal&&(()=>{
                  const {plans,months,activeMonth,selected:sel,showMonthPicker,loading}=exportWsModal;
                  const monthPlans=plans.filter(p=>p.year_month===activeMonth);
                  const allSel=monthPlans.length>0&&monthPlans.every(p=>sel.has(p.id));
                  const switchMonth=m=>{const mp=plans.filter(p=>p.year_month===m);setExportWsModal(prev=>({...prev,activeMonth:m,selected:new Set(mp.map(p=>p.id)),showMonthPicker:false}));};
                  const toggleAll=()=>{const next=new Set(sel);if(allSel)monthPlans.forEach(p=>next.delete(p.id));else monthPlans.forEach(p=>next.add(p.id));setExportWsModal(prev=>({...prev,selected:next}));};
                  const toggleOne=id=>{const next=new Set(sel);next.has(id)?next.delete(id):next.add(id);setExportWsModal(prev=>({...prev,selected:next}));};
                  const doExport=()=>{if(!sel.size)return;const ids=[...sel].join(',');window.open(`/api/export/workshop?password=${encodeURIComponent(pwd)}&ids=${ids}`,'_blank');};
                  const typeColor=t=>t==='中旬会'?'var(--amber)':t==='理论'?'var(--p-cyan-60)':'var(--p-green-52)';
                  return (<>
                    <div style={{padding:'8px 14px',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',gap:6,flexShrink:0}}>
                      <button onClick={()=>setExportWsModal(null)} style={{background:'none',border:'none',color:'var(--p-blue-68)',fontSize:13,cursor:'pointer',padding:0,marginRight:4}}>← 返回</button>
                      <div style={{position:'relative',flex:1}}>
                        <button onClick={()=>setExportWsModal(prev=>({...prev,showMonthPicker:!prev.showMonthPicker}))} style={{padding:'5px 10px',borderRadius:5,border:`1px solid ${showMonthPicker?'var(--blue)':'var(--border)'}`,background:'transparent',color:'var(--text)',cursor:'pointer',fontSize:12,fontFamily:'inherit'}}>
                          {activeMonth||'…'} ▾
                        </button>
                        {showMonthPicker&&(
                          <div style={{position:'absolute',top:'calc(100% + 4px)',left:0,background:'var(--p-navy-10)',border:'1px solid var(--p-blue-60-a40)',borderRadius:7,overflow:'hidden',zIndex:20,boxShadow:'0 4px 20px var(--p-black-00-a60)',minWidth:110}}>
                            {months.map(m=><div key={m} onClick={()=>switchMonth(m)} style={{padding:'8px 12px',fontSize:12,color:m===activeMonth?'var(--p-blue-68)':'var(--text)',background:m===activeMonth?'var(--p-blue-60-a10)':'transparent',cursor:'pointer',borderTop:'1px solid var(--p-navy-22-a40)'}}>{m}</div>)}
                          </div>
                        )}
                      </div>
                      <button onClick={toggleAll} style={{padding:'5px 8px',borderRadius:5,border:'1px solid var(--border)',background:'transparent',color:'var(--muted)',cursor:'pointer',fontSize:11,fontFamily:'inherit'}}>{allSel?'取消全选':'全选'}</button>
                      <button onClick={doExport} disabled={!sel.size} style={{padding:'5px 12px',borderRadius:5,border:'none',background:sel.size?'var(--green)':'var(--border)',color:sel.size?'var(--p-green-09)':'var(--muted)',cursor:sel.size?'pointer':'default',fontSize:11,fontWeight:600,fontFamily:'inherit'}}>↓ 导出{sel.size?` (${sel.size})`:''}</button>
                    </div>
                    <div style={{flex:1,overflowY:'auto'}}>
                      {loading&&<div style={{textAlign:'center',color:'var(--muted)',padding:'28px 0',fontSize:13}}>加载中…</div>}
                      {!loading&&monthPlans.length===0&&<div style={{textAlign:'center',color:'var(--muted)',padding:'28px 0',fontSize:13}}>该月暂无培训计划</div>}
                      {monthPlans.map(p=>(
                        <div key={p.id} onClick={()=>toggleOne(p.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',borderBottom:'1px solid var(--p-navy-22-a35)',cursor:'pointer',background:sel.has(p.id)?'var(--p-green-45-a05)':'transparent'}}>
                          <div style={{width:16,height:16,borderRadius:3,border:`2px solid ${sel.has(p.id)?'var(--green)':'var(--p-blue-27)'}`,background:sel.has(p.id)?'var(--green)':'transparent',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                            {sel.has(p.id)&&<span style={{color:'var(--p-green-09)',fontSize:11,fontWeight:700,lineHeight:1}}>✓</span>}
                          </div>
                          <span style={{fontSize:12,color:'var(--muted)',width:36,flexShrink:0}}>{p.shift_date?.slice(5)}</span>
                          <span style={{fontSize:11,padding:'1px 5px',borderRadius:3,border:`1px solid ${typeColor(p.plan_type)}55`,color:typeColor(p.plan_type),flexShrink:0}}>{p.plan_type}</span>
                          <span style={{fontSize:12,color:'var(--muted)',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.group_name||''}{p.instructor_name?` · ${p.instructor_name}`:''}</span>
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
          }} style={{width:'100%',marginTop:8,padding:'13px',background:'var(--p-red-60-a10)',border:'1px solid var(--p-red-60-a30)',borderRadius:8,color:'var(--red)',fontSize:13,fontWeight:600,cursor:'pointer'}}>🗑 清除今日答题数据</button>
        </>}

        {tab==='members'&&<MembersTab members={members} pwd={pwd} onRefresh={()=>apiJson('/api/admin/members',{headers:hdrs()}).then(setMembers).catch(()=>{})} selectedMember={selectedMember} setSelectedMember={setSelectedMember} memberDetail={memberDetail} loadMemberDetail={loadMemberDetail}/>}

        {tab==='wall'&&(
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

        {tab==='leave'&&(
          <div style={{padding:'0 2px'}}>
            {/* ══ 周报批清单 ══ */}
            <div style={{background:'var(--card)',border:'1px solid var(--border)',borderRadius:11,padding:'11px 13px',marginBottom:12}}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:9}}>
                <span style={{fontSize:12.5,fontWeight:700,color:'var(--text)'}}>周报批清单</span>
                {weekBatch && (
                  <span style={{fontSize:10.5,color:'var(--muted)'}}>
                    {weekBatch.week_start} ~ {weekBatch.week_end}
                  </span>
                )}
                {weekBatch?.reported_at && (
                  <span style={{fontSize:9.5,padding:'1px 6px',borderRadius:5,
                    background:'rgba(92,194,124,0.16)',border:'1px solid rgba(92,194,124,0.5)',color:'#5cc27c'}}>已报</span>
                )}
              </div>

              <div style={{display:'flex',gap:6,marginBottom:10,flexWrap:'wrap'}}>
                <input type="date" value={weekAnchor} onChange={e=>{setWeekAnchor(e.target.value); if(e.target.value) loadWeekBatch(e.target.value);}}
                  style={{flex:'1 1 120px',fontSize:11.5,padding:'6px 8px',borderRadius:7,
                    background:'var(--card-deep)',border:'1px solid var(--border)',color:'var(--text)',fontFamily:'var(--font)'}}/>
                <button onClick={()=>loadWeekBatch(undefined)}
                  style={{fontSize:11.5,padding:'6px 12px',borderRadius:7,background:'rgba(91,155,250,0.16)',
                    border:'1px solid rgba(91,155,250,0.5)',color:'#7ec8f0',cursor:'pointer',fontWeight:600}}>
                  {weekBatch ? '刷新' : '加载下周'}
                </button>
              </div>

              {weekLoading && <div style={{fontSize:11.5,color:'var(--muted)',padding:'14px 0',textAlign:'center'}}>加载中…</div>}

              {!weekLoading && weekBatch && (
                <>
                  {/* 汇总行 */}
                  <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:9,fontSize:11.5}}>
                    <span style={{color:'var(--text)'}}>休假 <b>{weekBatch.total_people}</b> 人</span>
                    <span style={{color:'var(--muted)'}}>日名额 {weekBatch.quota} 人</span>
                    {weekBatch.over_quota_days.length > 0 && (
                      <span style={{color:'#e8723c',fontWeight:700}}>⚠ {weekBatch.over_quota_days.length} 天超名额</span>
                    )}
                  </div>

                  {/* 每日人数条形 */}
                  <div style={{display:'flex',gap:4,marginBottom:11}}>
                    {weekBatch.per_day.map(d=>{
                      const over = d.count > weekBatch.quota;
                      return (
                        <div key={d.date} style={{flex:1,textAlign:'center'}}>
                          <div style={{fontSize:9,color:'var(--muted)',marginBottom:3}}>{d.label}</div>
                          <div style={{
                            height:26,borderRadius:6,display:'flex',alignItems:'center',justifyContent:'center',
                            fontSize:11,fontWeight:800,
                            background: d.count===0 ? 'var(--card-deep)' : over ? 'rgba(232,114,60,0.22)' : 'rgba(91,155,250,0.20)',
                            border: `1px solid ${d.count===0 ? 'var(--border)' : over ? 'rgba(232,114,60,0.6)' : 'rgba(91,155,250,0.5)'}`,
                            color: d.count===0 ? 'var(--muted)' : over ? '#e8723c' : '#7ec8f0',
                          }}>{d.count}</div>
                          <div style={{fontSize:8.5,color:'var(--muted)',marginTop:2}}>{d.date.slice(8)}</div>
                        </div>
                      );
                    })}
                  </div>

                  {/* 名单 */}
                  {weekBatch.people.length === 0 ? (
                    <div style={{fontSize:11.5,color:'var(--muted)',padding:'12px 0',textAlign:'center'}}>本周无已批准的休假</div>
                  ) : (
                    <div style={{marginBottom:10}}>
                      {weekBatch.people.map((p,i)=>(
                        <div key={p.staff_id} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 0',
                          borderBottom:i<weekBatch.people.length-1?'1px solid var(--border)':'none',fontSize:11.5}}>
                          <span style={{width:16,color:'var(--muted)',fontSize:10}}>{i+1}</span>
                          <span style={{fontWeight:700,color:'var(--text)',minWidth:52}}>{p.real_name}</span>
                          <span style={{flex:1,color:'var(--muted)',fontSize:10.5}}>
                            {p.items.map(it=>`${it.start.slice(5)}~${it.end.slice(5)}${it.leave_type?'（'+it.leave_type+'）':''}`).join('、')}
                          </span>
                          <span style={{fontWeight:700,color:'var(--text)'}}>{p.total_days}天</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 操作 */}
                  <div style={{display:'flex',gap:7}}>
                    <button onClick={copyBatchText}
                      style={{flex:1,padding:'8px 0',borderRadius:8,fontSize:12,fontWeight:700,cursor:'pointer',
                        background:'rgba(91,155,250,0.18)',border:'1px solid rgba(91,155,250,0.5)',color:'#7ec8f0'}}>
                      复制清单
                    </button>
                    {!weekBatch.reported_at && (
                      <button onClick={markReported}
                        style={{flex:1,padding:'8px 0',borderRadius:8,fontSize:12,fontWeight:700,cursor:'pointer',
                          background:'rgba(92,194,124,0.18)',border:'1px solid rgba(92,194,124,0.5)',color:'#5cc27c'}}>
                        标记已报
                      </button>
                    )}
                  </div>
                  {weekBatch.reported_at && (
                    <div style={{fontSize:10.5,color:'#5cc27c',marginTop:8,textAlign:'center'}}>
                      已于 {weekBatch.reported_at} 报车场组
                    </div>
                  )}
                </>
              )}
            </div>

            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
              <span style={{fontSize:12.5,fontWeight:700,color:'var(--text)'}}>休假审批</span>
              <span style={{fontSize:10.5,color:'var(--muted)'}}>待审 {leavePending.length} 条</span>
              <button onClick={loadLeavePending}
                style={{marginLeft:'auto',fontSize:11,padding:'4px 10px',borderRadius:6,background:'var(--card)',border:'1px solid var(--border)',color:'var(--text)',cursor:'pointer'}}>刷新</button>
            </div>

            {leavePendLoading && <div style={{fontSize:11.5,color:'var(--muted)',padding:'20px 0',textAlign:'center'}}>加载中…</div>}
            {!leavePendLoading && leavePending.length===0 && (
              <div style={{fontSize:11.5,color:'var(--muted)',padding:'24px 0',textAlign:'center'}}>没有待审的休假申请</div>
            )}

            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              {leavePending.map(r=>{
                const isCancel = r.status==='cancel_pending';
                const bal = r.balance;
                return (
                <div key={r.id} style={{background:'var(--card)',border:`1px solid ${isCancel?'rgba(232,167,38,0.55)':'var(--border)'}`,borderRadius:11,padding:'11px 13px'}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                    <span style={{fontSize:13,fontWeight:700,color:'var(--text)'}}>{r.real_name||r.name||r.staff_id}</span>
                    <span style={{fontSize:10,color:'var(--muted)'}}>{r.staff_id}</span>
                    <span style={{fontSize:10.5,padding:'1px 7px',borderRadius:5,
                      background:'rgba(91,155,250,0.16)',border:'1px solid rgba(91,155,250,0.4)',color:'#7ec8f0'}}>{r.leave_type}</span>
                    {isCancel && (
                      <span style={{fontSize:10,padding:'1px 7px',borderRadius:5,
                        background:'rgba(232,167,38,0.16)',border:'1px solid rgba(232,167,38,0.5)',color:'#e8a726'}}>撤销待批</span>
                    )}
                    <span style={{marginLeft:'auto',fontSize:10,color:'var(--muted)'}}>{r.created_at}</span>
                  </div>
                  <div style={{fontSize:12.5,color:'var(--text)',marginBottom:6}}>
                    {r.start_date} ~ {r.end_date}
                    <span style={{marginLeft:8,fontSize:11.5,fontWeight:700,color:isCancel?'var(--muted)':'var(--p-amber-61,#e4bd48)'}}>扣 {r.days} 天</span>
                  </div>

                  {/* 撤销原因 */}
                  {isCancel && r.cancel_reason && (
                    <div style={{fontSize:11,color:'#e8a726',background:'rgba(232,167,38,0.10)',
                      border:'1px solid rgba(232,167,38,0.3)',borderRadius:8,padding:'6px 9px',marginBottom:8,lineHeight:1.6}}>
                      撤销原因：{r.cancel_reason}
                    </div>
                  )}

                  {/* 余额提示（仅年休） */}
                  {bal && (
                    <div style={{
                      fontSize:10.5,lineHeight:1.7,marginBottom:8,padding:'6px 9px',borderRadius:8,
                      background: bal.enough ? 'rgba(92,194,124,0.10)' : 'rgba(232,114,60,0.12)',
                      border: `1px solid ${bal.enough ? 'rgba(92,194,124,0.32)' : 'rgba(232,114,60,0.42)'}`,
                      color: bal.enough ? '#5cc27c' : '#e8723c',
                    }}>
                      年休余额 {bal.left} 天（应得 {bal.total} · 已休 {bal.used}）
                      ，本次扣 {bal.need} 天 → 批后剩 <b>{bal.after}</b> 天
                      {!bal.enough && <><br/>余额不够，请人工确认后再批</>}
                    </div>
                  )}

                  <div style={{display:'flex',gap:8}}>
                    {isCancel ? (
                      <>
                        <button onClick={()=>reviewLeave(r.id,'approve-cancel')}
                          style={{flex:1,padding:'7px 0',borderRadius:8,fontSize:12,fontWeight:700,cursor:'pointer',
                            background:'rgba(92,194,124,0.18)',border:'1px solid rgba(92,194,124,0.5)',color:'#5cc27c'}}>同意撤销</button>
                        <button onClick={()=>reviewLeave(r.id,'reject-cancel','撤销未被同意')}
                          style={{flex:1,padding:'7px 0',borderRadius:8,fontSize:12,cursor:'pointer',
                            background:'transparent',border:'1px solid var(--p-red-60)',color:'var(--p-red-60)'}}>不同意</button>
                      </>
                    ) : (
                      <>
                        <button onClick={()=>reviewLeave(r.id,'approve')}
                          style={{flex:1,padding:'7px 0',borderRadius:8,fontSize:12,fontWeight:700,cursor:'pointer',
                            background:bal&&!bal.enough?'rgba(232,114,60,0.18)':'rgba(92,194,124,0.18)',
                            border:`1px solid ${bal&&!bal.enough?'rgba(232,114,60,0.55)':'rgba(92,194,124,0.5)'}`,
                            color:bal&&!bal.enough?'#e8723c':'#5cc27c'}}>批准</button>
                        <button onClick={()=>{setRejectModal(r);setRejectReason('');}}
                          style={{flex:1,padding:'7px 0',borderRadius:8,fontSize:12,cursor:'pointer',
                            background:'transparent',border:'1px solid var(--p-red-60)',color:'var(--p-red-60)'}}>驳回</button>
                      </>
                    )}
                  </div>
                </div>
                );
              })}
            </div>

            {rejectModal && (
              <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.65)',display:'flex',alignItems:'center',justifyContent:'center',padding:20,zIndex:50}}
                onClick={()=>setRejectModal(null)}>
                <div onClick={e=>e.stopPropagation()} style={{width:'100%',maxWidth:340,background:'var(--card)',border:'1px solid var(--border)',borderRadius:16,padding:'18px 16px'}}>
                  <div style={{fontSize:14,fontWeight:700,color:'var(--text)',marginBottom:10}}>驳回 {rejectModal.real_name||rejectModal.staff_id} 的申请</div>
                  <input value={rejectReason} onChange={e=>setRejectReason(e.target.value)}
                    placeholder="驳回原因（会告知本人）" maxLength={60}
                    style={{width:'100%',boxSizing:'border-box',background:'var(--card-deep)',border:'1px solid var(--border)',borderRadius:9,padding:'9px 11px',fontSize:12.5,color:'var(--text)',outline:'none',marginBottom:12}} />
                  <div style={{display:'flex',gap:8}}>
                    <button onClick={()=>setRejectModal(null)}
                      style={{flex:1,padding:'9px 0',borderRadius:9,fontSize:12.5,background:'var(--card-deep)',border:'1px solid var(--border)',color:'var(--text)',cursor:'pointer'}}>取消</button>
                    <button onClick={()=>reviewLeave(rejectModal.id,'reject',rejectReason||'未说明')}
                      style={{flex:1,padding:'9px 0',borderRadius:9,fontSize:12.5,fontWeight:700,background:'rgba(220,80,80,0.85)',border:'1px solid rgba(220,80,80,0.6)',color:'#fff',cursor:'pointer'}}>确认驳回</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

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

        {tab==='devices'&&(()=>{
          // 设备留痕：只读。用途是发现「替人答题」——
          // 一人多设备 = 同一个人今天用了几台不同手机
          // 设备共用 = 同一台手机换着给几个人答
          const d = devices;
          const card = {background:'var(--card)',border:'1px solid var(--border)',borderRadius:10,padding:12,marginBottom:10};
          const h = {fontSize:11,color:'var(--muted)',fontWeight:600,letterSpacing:0.5,marginBottom:8};
          if(!d) return <div className="card"><div style={{fontSize:13,color:'var(--muted)'}}>加载中…</div></div>;
          return (
            <div>
              <div className="card">
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                  <div style={{fontSize:13,fontWeight:700,color:'var(--text)'}}>🔍 登录/答题设备留痕</div>
                  <button onClick={()=>apiJson('/api/admin/login-devices?days=7',{headers:hdrs()}).then(setDevices).catch(()=>{})}
                    style={{fontSize:11,color:'var(--blue)',background:'none',border:'none',cursor:'pointer'}}>刷新</button>
                </div>
                <div style={{fontSize:11,color:'var(--muted)',lineHeight:1.7,marginBottom:10}}>
                  只记录、不拦截。用途是发现「用别人工号答题」。<br/>
                  统计口径是<b>今天</b>：一个人用了几台设备、一台设备被几个人用。
                </div>

                <div style={card}>
                  <div style={h}>⚠ 今天用了多台设备</div>
                  {d.multiDevice.length===0
                    ? <div style={{fontSize:12,color:'var(--muted)'}}>无 —— 每人只用了一台</div>
                    : d.multiDevice.map(x=>(
                        <div key={x.staffId} style={{display:'flex',justifyContent:'space-between',padding:'6px 0',borderBottom:'1px solid var(--p-navy-22-a30)',fontSize:12}}>
                          <span style={{color:'var(--text)'}}>{x.staffName} <span style={{color:'var(--muted)',fontSize:11}}>Y{x.staffId}</span></span>
                          <span style={{color:'var(--amber)',fontWeight:600}}>{x.deviceCount} 台设备 · {x.records} 次</span>
                        </div>
                      ))}
                </div>

                <div style={card}>
                  <div style={h}>⚠ 今天一台设备被多人使用</div>
                  {d.sharedDevice.length===0
                    ? <div style={{fontSize:12,color:'var(--muted)'}}>无</div>
                    : d.sharedDevice.map(x=>(
                        <div key={x.deviceId} style={{padding:'6px 0',borderBottom:'1px solid var(--p-navy-22-a30)',fontSize:12}}>
                          <span style={{color:'var(--amber)',fontWeight:600}}>{x.staffIds.length} 人共用一台设备：</span>
                          <span style={{color:'var(--text)'}}>{x.staffIds.join('、')}</span>
                        </div>
                      ))}
                </div>
              </div>

              <div className="card" style={{padding:0,overflow:'hidden'}}>
                <div style={{padding:'12px 14px 8px',fontSize:11,color:'var(--muted)',fontWeight:600,letterSpacing:1,borderBottom:'1px solid var(--border)'}}>
                  最近 7 天记录（{d.rows.length} 条）
                </div>
                {d.rows.length===0&&<div style={{textAlign:'center',color:'var(--muted)',padding:'24px 0',fontSize:13}}>暂无记录</div>}
                {d.rows.map(r=>(
                  <div key={r.id} style={{padding:'8px 14px',borderBottom:'1px solid var(--p-navy-22-a60)',fontSize:11}}>
                    <div style={{display:'flex',justifyContent:'space-between',gap:8}}>
                      <span style={{color:'var(--text)',fontWeight:600}}>{r.staff_name} <span style={{color:'var(--muted)',fontWeight:400}}>Y{r.staff_id}</span></span>
                      <span style={{color:'var(--muted)',flexShrink:0}}>{r.created_at?.slice(5,16)}</span>
                    </div>
                    <div style={{color:'var(--muted)',marginTop:2}}>
                      {r.action==='answer_start'?'📝 开始答题':'🔑 登录'} · {r.ua_short||'?'} {r.ip?('· '+r.ip):''}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
        {tab==='logs'&&(
          <div className="card" style={{padding:0,overflow:'hidden'}}>
            <div style={{padding:'12px 14px 8px',display:'flex',justifyContent:'space-between',alignItems:'center',borderBottom:'1px solid var(--border)'}}>
              <div style={{fontSize:11,color:'var(--muted)',letterSpacing:1,fontWeight:600}}>后台操作日志</div>
              <button onClick={()=>apiJson('/api/admin/logs',{headers:hdrs()}).then(setLogs).catch(()=>{})} style={{fontSize:11,color:'var(--blue)',background:'none',border:'none',cursor:'pointer'}}>刷新</button>
            </div>
            {logs.length===0&&<div style={{textAlign:'center',color:'var(--muted)',padding:'24px 0',fontSize:13}}>暂无操作记录</div>}
            {logs.map((l,i)=>(
              <div key={l.id} style={{display:'flex',alignItems:'flex-start',gap:10,padding:'9px 14px',borderBottom:i<logs.length-1?'1px solid var(--p-navy-22-a60)':'none'}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:2}}>
                    <span style={{fontSize:13,fontWeight:600,color:'var(--text)'}}>{l.action}</span>
                    <span style={{fontSize:11,color:'var(--muted)',background:'var(--border)',borderRadius:3,padding:'1px 5px'}}>{l.operator}</span>
                  </div>
                  {l.detail&&<div style={{fontSize:11,color:'var(--muted)',lineHeight:1.5}}>{l.detail}</div>}
                </div>
                <div style={{fontSize:11,color:'var(--muted)',flexShrink:0,whiteSpace:'nowrap'}}>{l.created_at?.slice(5,16)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default AdminScreen;
