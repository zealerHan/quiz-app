// screens/admin/MembersParts.jsx
//
// 人员 tab 的子组件（从 AdminScreen.jsx 抽出，2026-11-27）
//
// 为什么这两个一起搬：MembersTab 内部用了 TrainingGroupsSection，
// 分开搬会导致一边找不到另一个。这正是搬运前必查「谁依赖谁」的意义。
//
// 依赖：api / apiJson（请求）、Badge（标签展示）。都不碰题库常量。

import { useState, useEffect } from "react";
import { api, apiJson, Badge } from "../../shared.jsx";

export function TrainingGroupsSection({ pwd, staff }) {
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

export function MembersTab({ members, pwd, onRefresh, selectedMember, setSelectedMember, memberDetail, loadMemberDetail }) {
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
