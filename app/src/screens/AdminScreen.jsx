import { useState, useEffect, useRef, useMemo } from "react";
import { api, apiJson, adminHeaders, AppModal, Badge, ScoreRing, MiniBar } from "../shared.jsx";

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
    setSelectedMembers(new Set(g.members.filter(m => !m.is_cp).map(m => m.id)));
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
                          {/* 普通成员：过滤掉已是固定人员和已调车峰的 */}
                          {g.members.filter(m=>!fixedSet.has(m.id) && !m.is_cp).map(m => (
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
                      const normalCnt = g.members.filter(m=>!fixedSet.has(m.id) && !m.is_cp).length;
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
              <button onClick={()=>{setShowFixedEditor(false);setFixedSaveMsg('');}} style={{flex:1,padding:'10px',borderRadius:7,border:'1px solid #1b3255',background:'transparent',color:'#94a3b8',fontFamily:'inherit',fontSize:13,cursor:'pointer'}}>取消</button>
              <button onClick={saveFixed} style={{flex:2,padding:'10px',borderRadius:7,border:'none',background:'linear-gradient(135deg,#422006,#d97706)',color:'white',fontFamily:'inherit',fontSize:13,fontWeight:600,cursor:'pointer'}}>保存（{pendingFixed.size}人）</button>
            </div>
            {fixedSaveMsg && <div style={{fontSize:12,marginTop:8,color:'#ef4444',textAlign:'center'}}>{fixedSaveMsg}</div>}
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

// ─── AddQuestionPanel ─────────────────────────────────────────────────────────
function AddQuestionPanel({ pwd, banks, hdrs, onDone }) {
  // Section 1: AI 辅助出题
  const [srcFile, setSrcFile] = useState(null);
  const [pasteText, setPasteText] = useState('');
  const [tplSelected, setTplSelected] = useState([]);
  const [customTplText, setCustomTplText] = useState('');
  const [aiParsing, setAiParsing] = useState(false);
  const [parsedQs, setParsedQs] = useState([]);
  const [checkedQs, setCheckedQs] = useState([]);
  const [aiMsg, setAiMsg] = useState('');
  const [aiSaving, setAiSaving] = useState(false);
  const [aiBank, setAiBank] = useState('');
  const [aiNewBank, setAiNewBank] = useState('');
  const [expandedQsIdx, setExpandedQsIdx] = useState(null);
  const updateParsedQ = (i, field, val) => setParsedQs(prev => prev.map((q, j) => j === i ? { ...q, [field]: val } : q));
  const s1Ref = useRef();

  // Section 2: 手动出题
  const [manQ, setManQ] = useState('');
  const [manA, setManA] = useState('');
  const [manCat, setManCat] = useState('安全事件');
  const [manBank, setManBank] = useState('');
  const [manNewBank, setManNewBank] = useState('');
  const [manAiLoading, setManAiLoading] = useState(false);
  const [manSaving, setManSaving] = useState(false);
  const [manMsg, setManMsg] = useState('');
  const s2Ref = useRef();


  const TEMPLATES = [
    '请简要描述事件发生的经过',
    '乘务员在事件中存在哪些问题',
    '事件的整改措施及反思有哪些',
  ];

  const isIncidentBank = b => b.id !== 1 && b.name !== '风险数据库' && b.name !== '人工提问' &&
    (b.name.includes('事件') || b.name.includes('事故') || b.name.includes('分析') || b.name.includes('报告'));

  const GroupedBankSelect = ({ value, onChange, newValue, onNewChange }) => {
    const g = {
      emergency: banks.filter(b => b.id === 1),
      risk: banks.filter(b => b.name === '风险数据库'),
      incident: banks.filter(isIncidentBank),
      theory: banks.filter(b => b.id !== 1 && b.name !== '风险数据库' && b.name !== '人工提问' && !isIncidentBank(b)),
    };
    const sel = { padding:'6px 8px', borderRadius:6, border:'1px solid #1b3255', background:'#0d1117', color:'#e2e8f0', fontSize:12, flex:1, minWidth:0 };
    return (
      <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
        <select value={value} onChange={e=>{onChange(e.target.value);onNewChange('');}} style={sel}>
          <option value=''>── 选择已有题库 ──</option>
          {g.emergency.length>0&&<optgroup label="🚨 应急故障处置">{g.emergency.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</optgroup>}
          {g.risk.length>0&&<optgroup label="⚠️ 风险数据库">{g.risk.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</optgroup>}
          {g.incident.length>0&&<optgroup label="📋 事件分析报告">{g.incident.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</optgroup>}
          {g.theory.length>0&&<optgroup label="📖 理论考试题库">{g.theory.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</optgroup>}
        </select>
        <input value={newValue} onChange={e=>{onNewChange(e.target.value);onChange('');}} placeholder="或新建题库名称" style={{...sel,flex:'0 0 130px'}}/>
      </div>
    );
  };

  // 所有要提问的题目（模板 + 自定义）
  const allQuestions = [
    ...TEMPLATES.filter((_, i) => tplSelected.includes(i)),
    ...customTplText.split('\n').map(s => s.trim()).filter(Boolean),
  ];

  const doAiParse = async () => {
    if (allQuestions.length === 0) { setAiMsg('❌ 请至少选择一个问题模板或输入自定义题目'); return; }
    if (!srcFile && !pasteText.trim()) { setAiMsg('❌ 请上传文件或粘贴内容'); return; }
    setAiParsing(true); setAiMsg(''); setParsedQs([]); setCheckedQs([]);
    const fd = new FormData();
    fd.append('mode', 'custom');
    fd.append('custom_questions', JSON.stringify(allQuestions));
    if (srcFile) fd.append('file', srcFile);
    else fd.append('paste_text', pasteText.trim());
    try {
      const r = await fetch('/api/admin/banks/parse-doc', { method:'POST', headers:{'x-admin-password':pwd}, body:fd });
      const d = await r.json();
      if (!d.ok) { setAiMsg('❌ ' + (d.error||'解析失败')); }
      else { setParsedQs(d.questions||[]); setCheckedQs((d.questions||[]).map((_,i)=>i)); }
    } catch { setAiMsg('❌ 网络错误'); }
    setAiParsing(false);
  };

  const doAiSave = async () => {
    const toSave = parsedQs.filter((_,i) => checkedQs.includes(i));
    if (toSave.length === 0) { setAiMsg('❌ 请至少选择一道题'); return; }
    if (!aiBank && !aiNewBank.trim()) { setAiMsg('❌ 请选择或新建题库'); return; }
    setAiSaving(true);
    try {
      const r = await fetch('/api/admin/questions/batch-save', {
        method:'POST', headers:{...hdrs(),'Content-Type':'application/json'},
        body: JSON.stringify({ questions:toSave, bank_id:aiBank?parseInt(aiBank):undefined, bank_name:aiNewBank.trim()||undefined })
      });
      const d = await r.json();
      if (d.ok) { setAiMsg(`✅ 已保存 ${d.count} 题`); setParsedQs([]); setSrcFile(null); setPasteText(''); onDone?.(); }
      else setAiMsg('❌ ' + (d.error||'保存失败'));
    } catch { setAiMsg('❌ 网络错误'); }
    setAiSaving(false);
  };

  const doManAiExtract = async () => {
    const file = s2Ref.current?.files?.[0];
    if (!file || !manQ.trim()) return;
    setManAiLoading(true); setManMsg('');
    const fd = new FormData();
    fd.append('file', file);
    fd.append('mode', 'custom');
    fd.append('custom_questions', JSON.stringify([manQ.trim()]));
    try {
      const r = await fetch('/api/admin/banks/parse-doc', { method:'POST', headers:{'x-admin-password':pwd}, body:fd });
      const d = await r.json();
      if (d.ok && d.questions?.[0]?.reference) { setManA(d.questions[0].reference); setManMsg('✅ AI 已提取参考答案'); }
      else setManMsg('❌ ' + (d.error||'AI 未能提取答案'));
    } catch { setManMsg('❌ 网络错误'); }
    if (s2Ref.current) s2Ref.current.value = '';
    setManAiLoading(false);
  };

  const doManSave = async () => {
    if (!manQ.trim() || !manA.trim()) { setManMsg('❌ 题目和答案不能为空'); return; }
    if (!manBank && !manNewBank.trim()) { setManMsg('❌ 请选择或新建题库'); return; }
    setManSaving(true);
    try {
      const r = await fetch('/api/admin/questions/batch-save', {
        method:'POST', headers:{...hdrs(),'Content-Type':'application/json'},
        body: JSON.stringify({ questions:[{text:manQ.trim(),reference:manA.trim(),keywords:'',category:manCat}], bank_id:manBank?parseInt(manBank):undefined, bank_name:manNewBank.trim()||undefined })
      });
      const d = await r.json();
      if (d.ok) { setManMsg('✅ 已保存'); setManQ(''); setManA(''); onDone?.(); }
      else setManMsg('❌ ' + (d.error||'保存失败'));
    } catch { setManMsg('❌ 网络错误'); }
    setManSaving(false);
  };


  const inp = { background:'#0d1117', border:'1px solid #1b3255', color:'#e2e8f0', borderRadius:6, padding:'7px 10px', fontSize:12, width:'100%', boxSizing:'border-box', fontFamily:'inherit' };
  const divider = <div style={{borderTop:'1px solid #1b3255',margin:'14px 0'}}/>;
  const sectionLabel = (icon, text) => <div style={{fontSize:11,color:'#64748b',fontWeight:700,letterSpacing:0.5,marginBottom:8}}>{icon} {text}</div>;

  return (
    <div style={{marginTop:10,padding:'14px',border:'1px solid #1b3255',borderRadius:8,background:'rgba(13,17,23,0.6)'}}>

      {/* ── Section 1: AI 辅助出题 ── */}
      {sectionLabel('🤖','AI 辅助出题')}

      {/* 内容来源 */}
      <div style={{display:'flex',gap:8,marginBottom:8,alignItems:'flex-start'}}>
        <div style={{flex:1}}>
          <textarea value={pasteText} onChange={e=>{setPasteText(e.target.value);if(e.target.value)setSrcFile(null);}}
            placeholder="粘贴文件内容（事件报告、培训材料等）…"
            rows={4} style={{...inp,resize:'vertical'}}/>
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:6,flexShrink:0}}>
          <label style={{display:'flex',flexDirection:'column',alignItems:'center',gap:4,padding:'8px 10px',border:'1px dashed #1b3255',borderRadius:6,cursor:'pointer',background:srcFile?'rgba(59,130,246,0.1)':'transparent',minWidth:72}}>
            <input ref={s1Ref} type="file" accept=".docx,.pdf,.jpg,.jpeg,.png,.gif,.webp" style={{display:'none'}} onChange={e=>{const f=e.target.files?.[0];if(f){setSrcFile(f);setPasteText('');}e.target.value='';}}/>
            <span style={{fontSize:18}}>{srcFile?'📄':'📁'}</span>
            <span style={{fontSize:10,color:srcFile?'#60a5fa':'#64748b',textAlign:'center',lineHeight:1.2}}>{srcFile?srcFile.name.slice(0,12)+(srcFile.name.length>12?'…':''):'上传文件'}</span>
          </label>
          {srcFile&&<button onClick={()=>setSrcFile(null)} style={{fontSize:10,color:'#475569',background:'none',border:'none',cursor:'pointer',padding:0}}>✕ 清除</button>}
        </div>
      </div>

      {/* 问题模板 */}
      <div style={{marginBottom:8}}>
        <div style={{fontSize:11,color:'#94a3b8',marginBottom:6}}>选择要提问的方向：</div>
        <div style={{display:'flex',flexDirection:'column',gap:5}}>
          {TEMPLATES.map((t,i)=>(
            <label key={i} style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer'}}>
              <div onClick={()=>setTplSelected(prev=>prev.includes(i)?prev.filter(x=>x!==i):[...prev,i])}
                style={{width:15,height:15,borderRadius:3,border:`2px solid ${tplSelected.includes(i)?'#3b82f6':'#334155'}`,background:tplSelected.includes(i)?'#3b82f6':'none',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center'}}>
                {tplSelected.includes(i)&&<span style={{color:'white',fontSize:9,lineHeight:1}}>✓</span>}
              </div>
              <span style={{fontSize:12,color:tplSelected.includes(i)?'#e2e8f0':'#64748b'}}>{t}</span>
            </label>
          ))}
        </div>
        <textarea value={customTplText} onChange={e=>setCustomTplText(e.target.value)}
          placeholder="自定义题目（每行一个，AI 将从内容中提取对应答案）"
          rows={2} style={{...inp,marginTop:8,resize:'vertical'}}/>
      </div>

      {/* AI 识别按钮 */}
      <button onClick={doAiParse} disabled={aiParsing}
        style={{width:'100%',padding:'9px',background:'linear-gradient(135deg,#1e3a5f,#3b82f6)',border:'none',borderRadius:7,color:'white',fontSize:13,fontWeight:600,cursor:'pointer',opacity:aiParsing?0.6:1,marginBottom:8}}>
        {aiParsing?'AI 识别中，请稍候…':'🤖 AI 识别并生成答案'}
      </button>

      {/* AI 结果预览 */}
      {parsedQs.length>0&&(
        <div>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
            <span style={{fontSize:11,color:'#64748b'}}>识别结果（{parsedQs.length} 题，已选 {checkedQs.length}）</span>
            <div style={{display:'flex',gap:5}}>
              <button onClick={()=>setCheckedQs(parsedQs.map((_,i)=>i))} style={{fontSize:11,padding:'2px 7px',borderRadius:4,border:'1px solid #1b3255',background:'#0d1e35',color:'#94a3b8',cursor:'pointer'}}>全选</button>
              <button onClick={()=>setCheckedQs([])} style={{fontSize:11,padding:'2px 7px',borderRadius:4,border:'1px solid #1b3255',background:'#0d1e35',color:'#94a3b8',cursor:'pointer'}}>取消</button>
            </div>
          </div>
          <div style={{maxHeight:320,overflowY:'auto',marginBottom:8}}>
            {parsedQs.map((q,i)=>{
              const isExp = expandedQsIdx === i;
              const normCat = STANDARD_CATS.includes(q.category) ? q.category : '业务知识';
              return (
                <div key={i} style={{marginBottom:5,borderRadius:6,border:`1px solid ${checkedQs.includes(i)?'#3b82f6':'#1b3255'}`,background:checkedQs.includes(i)?'rgba(59,130,246,0.08)':'transparent'}}>
                  <div style={{display:'flex',gap:8,alignItems:'flex-start',padding:'8px 10px',cursor:'pointer'}} onClick={()=>setCheckedQs(prev=>prev.includes(i)?prev.filter(x=>x!==i):[...prev,i])}>
                    <span style={{color:checkedQs.includes(i)?'#3b82f6':'#475569',fontSize:14,flexShrink:0,marginTop:1}}>{checkedQs.includes(i)?'☑':'☐'}</span>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,color:'#e2e8f0',marginBottom:3}}>{q.text}</div>
                      {!isExp&&<div style={{fontSize:11,color:'#64748b',wordBreak:'break-all'}}>{(q.reference||'').slice(0,60)}{(q.reference||'').length>60?'…':''}</div>}
                    </div>
                    <button onClick={e=>{e.stopPropagation();setExpandedQsIdx(isExp?null:i);}} style={{flexShrink:0,background:'none',border:'none',color:'#64748b',cursor:'pointer',fontSize:13,padding:'0 2px'}}>{isExp?'▲':'✏️'}</button>
                  </div>
                  <div style={{paddingLeft:32,paddingRight:10,paddingBottom:isExp?2:8}} onClick={e=>e.stopPropagation()}>
                    <select value={normCat} onChange={e=>updateParsedQ(i,'category',e.target.value)} style={{fontSize:11,padding:'3px 8px',borderRadius:4,border:'1px solid #1b3255',background:'#0d1117',color:'#60a5fa',cursor:'pointer',minWidth:90}}>
                      {STANDARD_CATS.map(c=><option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  {isExp&&(
                    <div style={{padding:'4px 10px 10px 10px',display:'flex',flexDirection:'column',gap:6}} onClick={e=>e.stopPropagation()}>
                      <div style={{fontSize:11,color:'#64748b'}}>题目文本</div>
                      <textarea value={q.text} onChange={e=>updateParsedQ(i,'text',e.target.value)} rows={2} style={{width:'100%',boxSizing:'border-box',background:'#0d1117',border:'1px solid #1b3255',color:'#e2e8f0',borderRadius:5,padding:'6px 8px',fontSize:12,fontFamily:'inherit',resize:'vertical'}}/>
                      <div style={{fontSize:11,color:'#64748b'}}>参考答案</div>
                      <textarea value={q.reference||''} onChange={e=>updateParsedQ(i,'reference',e.target.value)} rows={3} style={{width:'100%',boxSizing:'border-box',background:'#0d1117',border:'1px solid #1b3255',color:'#e2e8f0',borderRadius:5,padding:'6px 8px',fontSize:12,fontFamily:'inherit',resize:'vertical'}}/>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <GroupedBankSelect value={aiBank} onChange={setAiBank} newValue={aiNewBank} onNewChange={setAiNewBank}/>
          <button onClick={doAiSave} disabled={aiSaving||checkedQs.length===0}
            style={{width:'100%',marginTop:6,padding:'8px',background:'#1b3a6e',border:'none',borderRadius:7,color:'white',fontSize:13,fontWeight:600,cursor:'pointer',opacity:(aiSaving||checkedQs.length===0)?0.5:1}}>
            {aiSaving?'保存中…':`保存选中 ${checkedQs.length} 题`}
          </button>
        </div>
      )}
      {aiMsg&&<div style={{fontSize:12,marginTop:6,color:aiMsg.startsWith('✅')?'#22c55e':'#ef4444'}}>{aiMsg}</div>}

      {divider}

      {/* ── Section 2: 手动出题 ── */}
      {sectionLabel('✍️','手动出题')}
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        <select value={manCat} onChange={e=>setManCat(e.target.value)} style={{...inp,width:'auto'}}>
          {['安全事件','应急处置','业务知识','设备操作','规章制度'].map(c=><option key={c}>{c}</option>)}
        </select>
        <textarea value={manQ} onChange={e=>setManQ(e.target.value)} placeholder="输入题目内容…" rows={3} style={{...inp,resize:'vertical'}}/>
        <textarea value={manA} onChange={e=>setManA(e.target.value)} placeholder="输入参考答案（各要点用分号分隔）…" rows={4} style={{...inp,resize:'vertical'}}/>
        <label style={{display:'flex',alignItems:'center',gap:8,padding:'7px 10px',border:'1px dashed #1b3255',borderRadius:6,cursor:manAiLoading||!manQ.trim()?'default':'pointer',background:'rgba(59,130,246,0.04)',opacity:!manQ.trim()?0.5:1}}>
          <input ref={s2Ref} type="file" accept=".docx,.pdf,.jpg,.jpeg,.png,.gif,.webp" style={{display:'none'}}
            onChange={()=>{ if(!manQ.trim()){setManMsg('❌ 请先填写题目');return;} doManAiExtract(); }} disabled={manAiLoading||!manQ.trim()}/>
          <span style={{fontSize:14}}>{manAiLoading?'🤖':'📎'}</span>
          <span style={{fontSize:12,color:'#64748b'}}>{manAiLoading?'AI 提取中…':'上传文件，AI 从文件中提取参考答案'}</span>
        </label>
        <GroupedBankSelect value={manBank} onChange={setManBank} newValue={manNewBank} onNewChange={setManNewBank}/>
        <button onClick={doManSave} disabled={manSaving||!manQ.trim()||!manA.trim()}
          style={{padding:'9px',background:'#1b3a6e',border:'none',borderRadius:7,color:'white',fontSize:13,fontWeight:600,cursor:'pointer',opacity:(manSaving||!manQ.trim()||!manA.trim())?0.5:1}}>
          {manSaving?'保存中…':'保存题目'}
        </button>
        {manMsg&&<div style={{fontSize:12,color:manMsg.startsWith('✅')?'#22c55e':'#ef4444'}}>{manMsg}</div>}
      </div>


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

const STANDARD_CATS = ['安全事件', '应急处置', '故障处置', '业务知识', '设备操作', '规章制度', '隐患排查'];

const DOC_CAT_BTNS = [
  { key: 'incident',  icon: '📋', label: '安全事件',   color: '#f59e0b' },
  { key: 'theory',    icon: '📖', label: '理论题目',   color: '#3b82f6' },
  { key: 'emergency', icon: '🚨', label: '应急处置',   color: '#ef4444' },
  { key: 'risk',      icon: '⚠️', label: '风险数据库', color: '#a78bfa' },
];

function DocParseCard({ pwd, banks, onImported }) {
  const [step, setStep] = useState('idle'); // idle | parsing | preview | saving
  const [msg, setMsg] = useState('');
  const [questions, setQuestions] = useState([]);
  const [checked, setChecked] = useState([]);
  const [mode, setMode] = useState('auto');
  const [autoCount, setAutoCount] = useState(5);
  const [expandedIdx, setExpandedIdx] = useState(null);
  const [customText, setCustomText] = useState('');
  const [destCat, setDestCat] = useState(''); // 'incident'|'theory'|'emergency'|'risk'
  const [eventBankName, setEventBankName] = useState('');
  const [theoryBankId, setTheoryBankId] = useState('');
  const fileRef = useRef();

  const hdrs = () => ({ 'x-admin-password': pwd });
  const isIncidentName = n => n.includes('事件') || n.includes('事故') || n.includes('分析') || n.includes('报告');
  const emergencyBank = banks.find(b => b.id === 1);
  const riskBank = banks.find(b => b.name === '风险数据库');
  const theoryBanks = banks.filter(b => b.id !== 1 && b.name !== '风险数据库' && b.name !== '人工提问' && !isIncidentName(b.name));

  const extractEventName = (qs) => {
    for (const q of qs) {
      const m = (q.text||'').match(/\[([^\]]{4,50})\]/);
      if (m) return m[1];
    }
    return '';
  };

  const INCIDENT_TEMPLATES = ['请简要描述事件发生的经过','乘务员在事件中存在哪些问题','事件的整改措施及反思有哪些'];
  const addTemplate = t => {
    const lines = customText.split('\n').map(s=>s.trim()).filter(Boolean);
    if (lines.includes(t)) return;
    setCustomText(prev => prev.trim() ? prev.replace(/\s+$/,'') + '\n' + t : t);
  };

  const selectCat = (key) => {
    setDestCat(key);
    if (key === 'theory' && theoryBanks.length > 0 && !theoryBankId)
      setTheoryBankId(String(theoryBanks[0].id));
  };

  const doParse = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    e.target.value = '';
    let customList = [];
    if (mode === 'custom') {
      customList = customText.split('\n').map(s=>s.trim()).filter(Boolean);
      if (customList.length === 0) { setMsg('❌ 自定义模式请至少输入一道题目'); return; }
    }
    setStep('parsing'); setMsg(''); setQuestions([]); setChecked([]);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('mode', mode);
    if (mode === 'auto') fd.append('count', String(autoCount));
    else fd.append('custom_questions', JSON.stringify(customList));
    try {
      const r = await fetch('/api/admin/banks/parse-doc', { method:'POST', headers:hdrs(), body:fd });
      const d = await r.json();
      if (!d.ok) { setMsg('❌ ' + (d.error||'解析失败')); setStep('idle'); return; }
      const qs = d.questions || [];
      setQuestions(qs);
      setChecked(qs.map((_,i)=>i));
      // 根据 AI 识别结果自动确认分类
      if (d.docType === 'incident' || destCat === 'incident') {
        setDestCat('incident');
        if (!eventBankName) setEventBankName(extractEventName(qs));
      } else if (!destCat || destCat === '') {
        setDestCat('theory');
        if (theoryBanks.length > 0 && !theoryBankId) setTheoryBankId(String(theoryBanks[0].id));
      }
      setStep('preview');
    } catch { setMsg('❌ 网络错误'); setStep('idle'); }
  };

  const doSave = async () => {
    const toSave = questions.filter((_,i) => checked.includes(i));
    if (toSave.length === 0) { setMsg('❌ 请至少选择一道题'); return; }
    let bank_id, bank_name;
    if (destCat === 'emergency')      bank_id = emergencyBank?.id || 1;
    else if (destCat === 'risk')      { bank_id = riskBank?.id; if (!bank_id) { setMsg('❌ 未找到风险数据库'); return; } }
    else if (destCat === 'theory')    { bank_id = parseInt(theoryBankId); if (!bank_id) { setMsg('❌ 请选择理论题库'); return; } }
    else if (destCat === 'incident')  { bank_name = eventBankName.trim(); if (!bank_name) { setMsg('❌ 请填写事件名称'); return; } }
    else { setMsg('❌ 请选择内容分类'); return; }
    setStep('saving');
    try {
      const r = await fetch('/api/admin/questions/batch-save', {
        method:'POST', headers:{...hdrs(),'Content-Type':'application/json'},
        body: JSON.stringify({ questions: toSave, bank_id, bank_name })
      });
      const d = await r.json();
      if (d.ok) { setMsg(`✅ 已保存 ${d.count} 题`); setStep('idle'); onImported?.(); }
      else { setMsg('❌ ' + (d.error||'保存失败')); setStep('preview'); }
    } catch { setMsg('❌ 网络错误'); setStep('preview'); }
  };

  const toggleCheck = (i) => setChecked(prev => prev.includes(i) ? prev.filter(x=>x!==i) : [...prev,i]);
  const updateQuestion = (i, field, val) => setQuestions(prev => prev.map((q,j) => j===i ? {...q,[field]:val} : q));

  const catBtn = (key, disabled) => {
    const b = DOC_CAT_BTNS.find(x=>x.key===key);
    const active = destCat === key;
    return (
      <button key={key} onClick={()=>selectCat(key)} disabled={disabled}
        style={{flex:1,padding:'8px 4px',borderRadius:7,border:`1px solid ${active?b.color:'#1b3255'}`,background:active?`${b.color}20`:'transparent',color:active?b.color:'#64748b',fontSize:12,fontWeight:active?700:400,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:4}}>
        {b.icon} {b.label}
      </button>
    );
  };

  /* ── IDLE / PARSING ── */
  if (step === 'idle' || step === 'parsing') return (
    <div className="card" style={{border:'1px solid #1e3a5f',padding:14,background:'rgba(59,130,246,0.04)'}}>
      {/* 1. 内容分类 */}
      <div style={{fontSize:11,color:'#64748b',fontWeight:600,letterSpacing:0.5,marginBottom:7}}>① 内容类型</div>
      <div style={{display:'flex',gap:6,marginBottom:12}}>
        {DOC_CAT_BTNS.map(b => catBtn(b.key, step==='parsing'))}
      </div>

      {/* 2. 出题模式（应急/风险直接入库，无需选模式） */}
      {(destCat==='incident'||destCat==='theory'||destCat==='') && (
        <>
          <div style={{fontSize:11,color:'#64748b',fontWeight:600,letterSpacing:0.5,marginBottom:7}}>② 出题方式</div>
          <div style={{display:'flex',gap:6,marginBottom:10}}>
            <button onClick={()=>setMode('auto')} disabled={step==='parsing'} style={{flex:1,padding:'7px',borderRadius:6,border:`1px solid ${mode==='auto'?'#3b82f6':'#1b3255'}`,background:mode==='auto'?'rgba(59,130,246,0.15)':'transparent',color:mode==='auto'?'#60a5fa':'#94a3b8',fontSize:12,fontWeight:600,cursor:'pointer'}}>🤖 AI自动出题</button>
            <button onClick={()=>setMode('custom')} disabled={step==='parsing'} style={{flex:1,padding:'7px',borderRadius:6,border:`1px solid ${mode==='custom'?'#3b82f6':'#1b3255'}`,background:mode==='custom'?'rgba(59,130,246,0.15)':'transparent',color:mode==='custom'?'#60a5fa':'#94a3b8',fontSize:12,fontWeight:600,cursor:'pointer'}}>✍️ 我来出题</button>
          </div>
          {mode==='auto' && (
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10,fontSize:12,color:'#94a3b8'}}>
              <span>出题数：</span>
              <input type="number" min={1} max={20} value={autoCount} onChange={e=>setAutoCount(Math.max(1,Math.min(20,parseInt(e.target.value)||5)))} disabled={step==='parsing'} style={{width:55,padding:'4px 8px',borderRadius:5,border:'1px solid #1b3255',background:'#0d1117',color:'#e2e8f0',fontSize:12}}/>
              <span style={{fontSize:11,color:'#64748b'}}>{destCat==='incident'?'（事件报告固定1题）':'题'}</span>
            </div>
          )}
          {mode==='custom' && (
            <div style={{marginBottom:10}}>
              <textarea value={customText} onChange={e=>setCustomText(e.target.value)} placeholder="每行输入一道题目，AI 从文档提取对应答案" rows={3} disabled={step==='parsing'} style={{width:'100%',padding:'8px 10px',borderRadius:6,border:'1px solid #1b3255',background:'#0d1117',color:'#e2e8f0',fontSize:12,fontFamily:'inherit',resize:'vertical',boxSizing:'border-box'}}/>
              {destCat==='incident' && (
                <div style={{display:'flex',gap:5,marginTop:5,flexWrap:'wrap'}}>
                  {INCIDENT_TEMPLATES.map(t=>(
                    <button key={t} onClick={()=>addTemplate(t)} disabled={step==='parsing'} style={{fontSize:11,padding:'3px 8px',borderRadius:4,border:'1px solid #1b3255',background:'#0d1e35',color:'#94a3b8',cursor:'pointer'}}>+ {t}</button>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* 3. 上传 */}
      <div style={{fontSize:11,color:'#64748b',fontWeight:600,letterSpacing:0.5,marginBottom:7}}>{(destCat==='incident'||destCat==='theory'||destCat==='') ? '③' : '②'} 上传文件</div>
      <label style={{display:'block',textAlign:'center',padding:'16px',border:'1px dashed #1e3a5f',borderRadius:8,cursor:step==='parsing'?'default':'pointer',background:'rgba(15,23,42,0.4)'}}>
        <input ref={fileRef} type="file" accept=".docx,.pdf,.jpg,.jpeg,.png,.gif,.webp" style={{display:'none'}} onChange={doParse} disabled={step==='parsing'}/>
        <div style={{fontSize:22,marginBottom:4}}>{step==='parsing'?'🤖':'📄'}</div>
        <div style={{fontSize:13,color:'#3b82f6',fontWeight:600}}>{step==='parsing'?'AI解析中，请稍候…':'点击上传（Word / PDF / 图片）'}</div>
      </label>
      {msg && <div style={{fontSize:12,marginTop:8,color:msg.startsWith('✅')?'#22c55e':'#ef4444'}}>{msg}</div>}
    </div>
  );

  /* ── PREVIEW ── */
  const canSave = step!=='saving' && checked.length>0 && (
    destCat==='emergency' ||
    (destCat==='risk' && !!riskBank) ||
    (destCat==='theory' && !!theoryBankId) ||
    (destCat==='incident' && !!eventBankName.trim())
  );

  return (
    <div className="card" style={{border:'1px solid #1e3a5f',padding:'16px'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
        <div style={{fontSize:13,fontWeight:700,color:'#3b82f6'}}>🤖 AI识别结果</div>
        <button onClick={()=>{setStep('idle');setMsg('');}} style={{background:'none',border:'none',color:'#64748b',cursor:'pointer',fontSize:12}}>重新上传</button>
      </div>

      {/* 题目列表 */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
        <span style={{fontSize:11,color:'#64748b'}}>共 {questions.length} 道，已选 {checked.length} 道</span>
        <div style={{display:'flex',gap:6}}>
          <button onClick={()=>setChecked(questions.map((_,i)=>i))} style={{fontSize:11,padding:'2px 8px',borderRadius:4,border:'1px solid #1b3255',background:'#0d1e35',color:'#94a3b8',cursor:'pointer'}}>全选</button>
          <button onClick={()=>setChecked([])} style={{fontSize:11,padding:'2px 8px',borderRadius:4,border:'1px solid #1b3255',background:'#0d1e35',color:'#94a3b8',cursor:'pointer'}}>取消</button>
        </div>
      </div>
      <div style={{maxHeight:360,overflowY:'auto',marginBottom:12}}>
        {questions.map((q,i) => {
          const isExp = expandedIdx === i;
          const normCat = STANDARD_CATS.includes(q.category) ? q.category : '业务知识';
          return (
            <div key={i} style={{marginBottom:6,borderRadius:6,border:`1px solid ${checked.includes(i)?'#3b82f6':'#1b3255'}`,background:checked.includes(i)?'rgba(59,130,246,0.08)':'transparent'}}>
              <div style={{display:'flex',gap:8,alignItems:'flex-start',padding:'8px 10px',cursor:'pointer'}} onClick={()=>toggleCheck(i)}>
                <span style={{color:checked.includes(i)?'#3b82f6':'#475569',fontSize:14,flexShrink:0,marginTop:1}}>{checked.includes(i)?'☑':'☐'}</span>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:12,color:'#e2e8f0',marginBottom:3,lineHeight:1.4}}>{q.text}</div>
                  {!isExp && <div style={{fontSize:11,color:'#64748b'}}>参考：{(q.reference||'').slice(0,55)}{(q.reference||'').length>55?'…':''}</div>}
                </div>
                <button onClick={e=>{e.stopPropagation();setExpandedIdx(isExp?null:i);}} style={{flexShrink:0,background:'none',border:'none',color:'#64748b',cursor:'pointer',fontSize:13,padding:'0 2px'}}>{isExp?'▲':'✏️'}</button>
              </div>
              <div style={{paddingLeft:32,paddingRight:10,paddingBottom:isExp?2:8}} onClick={e=>e.stopPropagation()}>
                <select value={normCat} onChange={e=>updateQuestion(i,'category',e.target.value)} style={{fontSize:11,padding:'3px 8px',borderRadius:4,border:'1px solid #1b3255',background:'#0d1117',color:'#60a5fa',cursor:'pointer',minWidth:90}}>
                  {STANDARD_CATS.map(c=><option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              {isExp && (
                <div style={{padding:'4px 10px 10px 10px',display:'flex',flexDirection:'column',gap:6}} onClick={e=>e.stopPropagation()}>
                  <div style={{fontSize:11,color:'#64748b'}}>题目文本</div>
                  <textarea value={q.text} onChange={e=>updateQuestion(i,'text',e.target.value)} rows={2} style={{width:'100%',boxSizing:'border-box',background:'#0d1117',border:'1px solid #1b3255',color:'#e2e8f0',borderRadius:5,padding:'6px 8px',fontSize:12,fontFamily:'inherit',resize:'vertical'}}/>
                  <div style={{fontSize:11,color:'#64748b'}}>参考答案</div>
                  <textarea value={q.reference||''} onChange={e=>updateQuestion(i,'reference',e.target.value)} rows={3} style={{width:'100%',boxSizing:'border-box',background:'#0d1117',border:'1px solid #1b3255',color:'#e2e8f0',borderRadius:5,padding:'6px 8px',fontSize:12,fontFamily:'inherit',resize:'vertical'}}/>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 保存目标 — 简化 */}
      <div style={{background:'rgba(13,17,23,0.6)',border:'1px solid #1b3255',borderRadius:8,padding:'10px 12px',marginBottom:10}}>
        <div style={{fontSize:11,color:'#64748b',fontWeight:600,marginBottom:8}}>保存到</div>
        <div style={{display:'flex',gap:6,marginBottom:8}}>
          {DOC_CAT_BTNS.map(b=>{
            const active = destCat===b.key;
            return (
              <button key={b.key} onClick={()=>selectCat(b.key)}
                style={{flex:1,padding:'7px 4px',borderRadius:6,border:`1px solid ${active?b.color:'#1b3255'}`,background:active?`${b.color}20`:'transparent',color:active?b.color:'#64748b',fontSize:11,fontWeight:active?700:400,cursor:'pointer'}}>
                {b.icon} {b.label}
              </button>
            );
          })}
        </div>
        {destCat==='incident' && (
          <input value={eventBankName} onChange={e=>setEventBankName(e.target.value)} placeholder="事件名称（将作为新题库名称）"
            style={{width:'100%',boxSizing:'border-box',padding:'7px 10px',borderRadius:6,border:'1px solid #1b3255',background:'#0d1117',color:'#e2e8f0',fontSize:12}}/>
        )}
        {destCat==='theory' && (
          <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
            {theoryBanks.map(b=>(
              <button key={b.id} onClick={()=>setTheoryBankId(String(b.id))}
                style={{padding:'5px 10px',borderRadius:5,border:`1px solid ${theoryBankId===String(b.id)?'#3b82f6':'#1b3255'}`,background:theoryBankId===String(b.id)?'rgba(59,130,246,0.15)':'transparent',color:theoryBankId===String(b.id)?'#60a5fa':'#64748b',fontSize:11,cursor:'pointer'}}>
                {b.name}
              </button>
            ))}
          </div>
        )}
        {destCat==='emergency' && <div style={{fontSize:12,color:'#94a3b8'}}>→ {emergencyBank?.name || '应急故障处置'}</div>}
        {destCat==='risk'      && <div style={{fontSize:12,color:'#94a3b8'}}>→ {riskBank?.name || '风险数据库'}</div>}
      </div>

      <button onClick={doSave} disabled={!canSave}
        style={{width:'100%',padding:'10px',background:'linear-gradient(135deg,#1e3a5f,#3b82f6)',border:'none',borderRadius:7,color:'white',fontSize:13,fontWeight:600,cursor:'pointer',opacity:canSave?1:0.4}}>
        {step==='saving'?'保存中…':`保存选中 ${checked.length} 题`}
      </button>
      {msg && <div style={{fontSize:12,marginTop:8,color:msg.startsWith('✅')?'#22c55e':'#ef4444'}}>{msg}</div>}
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
  const [bankSectionOpen,setBankSectionOpen]=useState({});
  const [editQModal,setEditQModal]=useState(null); // {id,bankId,text,reference,keywords,category}
  const [renamingBank,setRenamingBank]=useState(null); // {id, name}
  const [checkedBankIds,setCheckedBankIds]=useState([]);
  // 上传/人工出题面板
  const [showUploadPanel,setShowUploadPanel]=useState(false);
  const [showAddQPanel,setShowAddQPanel]=useState(false);
  const [showImportPanel,setShowImportPanel]=useState(false);
  const [pinFormOpen,setPinFormOpen]=useState(false);
  const [pinCancelModal,setPinCancelModal]=useState(false);
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
    if(tab==='banks'){apiJson('/api/banks',{headers:hdrs()}).then(d=>{setBanks(d);if(d.length>0){setAiBankId(String(d[0].id));setPinFallback(String(d[0].id));}const manualBank=d.find(b=>b.name==='人工提问');if(manualBank)setAddQ(q=>({...q,bank_id:String(manualBank.id)}));}).catch(()=>{});apiJson('/api/settings',{headers:hdrs()}).then(setSettings).catch(()=>{});apiJson('/api/admin/pinned-questions',{headers:hdrs()}).then(d=>{setQPinned(d);setQSelected(d.ids||[]);setPinScope(d.scope==='none'?'shift':d.scope);setPinFallback(d.bank_fallback_id?String(d.bank_fallback_id):'');setPinCount(d.count||3);setPinMode(d.bank_ids?.length>0?'manual':d.mode||'emergency');setPinRandomBankId(d.bank_id||null);setCheckedBankIds(d.bank_ids||[]);}).catch(()=>{});}
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
              const midGroup=[...overview.allStaff.filter(p=>p.status==='interrupted'||p.status==='browsed'||p.status==='answering')].sort((a,b)=>b.staff_id.localeCompare(a.staff_id));
              const doneGroup=[...overview.allStaff.filter(p=>p.status==='done')].sort((a,b)=>(b.completed_at||'').localeCompare(a.completed_at||''));
              const sorted=[...noneGroup,...midGroup,...doneGroup];
              return(
                <div style={{borderTop:'1px solid #1b3255',padding:'10px 12px 10px'}}>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'5px 6px'}}>
                    {(staffListCollapsed?sorted.slice(0,12):sorted).map((p,ni)=>{
                      const isDone=p.status==='done';
                      const isAnswering=p.status==='answering';
                      const isInt=p.status==='interrupted';
                      const isBrowse=p.status==='browsed';
                      const isOverdue=p.overdue&&p.status==='none';
                      const nameCol=isDone?'#22c55e':isAnswering?'#3b82f6':isInt||isBrowse?'#f59e0b':isOverdue?'#f97316':'#ef4444';
                      const bg=isDone?'rgba(34,197,94,0.06)':isAnswering?'rgba(59,130,246,0.08)':isInt||isBrowse?'rgba(245,158,11,0.06)':isOverdue?'rgba(249,115,22,0.07)':'rgba(239,68,68,0.05)';
                      const border=isDone?'rgba(34,197,94,0.18)':isAnswering?'rgba(59,130,246,0.35)':isInt||isBrowse?'rgba(245,158,11,0.2)':isOverdue?'rgba(249,115,22,0.25)':'rgba(239,68,68,0.12)';
                      const clickable=isDone||isAnswering||isInt||isBrowse||isOverdue;
                      return(
                        <div key={ni} onClick={()=>{
                          if(isDone) setResetModal({staff_id:p.staff_id,name:p.name,score:p.score,completed_at:p.completed_at,isDone:true});
                          else if(isAnswering) setResetModal({staff_id:p.staff_id,name:p.name,isAnswering:true,last_active_at:p.last_active_at});
                          else if(isInt||isBrowse) setResetModal({staff_id:p.staff_id,name:p.name});
                          else if(isOverdue) setMakeupModal({staff_id:p.staff_id,name:p.name});
                        }}
                          style={{display:'flex',flexDirection:'column',gap:1,padding:'5px 7px',background:bg,border:`1px solid ${border}`,borderRadius:6,minWidth:0,cursor:clickable?'pointer':'default'}}>
                          <div style={{fontSize:11,color:nameCol,fontWeight:700,lineHeight:1.3,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.name}</div>
                          <div style={{fontSize:8,color:'#64748b',lineHeight:1.2}}>
                            {isDone?`${p.score??'—'}分 ›`:isAnswering?'答题中 ›':isInt?'中断 ›':isBrowse?'浏览 ›':isOverdue?'逾期 ›':'未答'}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{display:'flex',gap:10,marginTop:8,fontSize:9,color:'#475569',flexWrap:'wrap'}}>
                    <span style={{color:'#22c55e'}}>● 已完成</span>
                    <span style={{color:'#3b82f6'}}>● 答题中（10分钟内有动作）</span>
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
                  {(()=>{
                    const notStarted = allMembers.filter(m=>m.total>0 && m.done===0);
                    const ringCol = totalPeople===0 ? '#475569' : donePeople>=totalPeople ? '#22c55e' : donePeople===0 ? '#ef4444' : '#f59e0b';
                    const ringSize = 72;
                    const r = ringSize*0.38, circ = 2*Math.PI*r;
                    const dash = (donePeople/Math.max(totalPeople,1))*circ;
                    return (
                      <div style={{display:'flex',alignItems:'center',gap:14,marginBottom:10}}>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:11,color:'#94a3b8',fontWeight:600,marginBottom:6}}>本月任务未完成人员</div>
                          {notStarted.length===0
                            ? <div style={{fontSize:12,color:'#22c55e'}}>✓ 无</div>
                            : <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
                                {notStarted.map(m=>(
                                  <span key={m.id} style={{fontSize:10,color:'#ef4444',padding:'1px 6px',borderRadius:4,background:'rgba(239,68,68,0.08)',border:'1px solid rgba(239,68,68,0.3)',whiteSpace:'nowrap'}}>
                                    {m.name}
                                  </span>
                                ))}
                              </div>}
                        </div>
                        <svg width={ringSize} height={ringSize} viewBox={`0 0 ${ringSize} ${ringSize}`} style={{flexShrink:0}}>
                          <circle cx={ringSize/2} cy={ringSize/2} r={r} fill="none" stroke="#1e293b" strokeWidth={ringSize*0.1}/>
                          <circle cx={ringSize/2} cy={ringSize/2} r={r} fill="none" stroke={ringCol} strokeWidth={ringSize*0.1}
                            strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
                            transform={`rotate(-90 ${ringSize/2} ${ringSize/2})`} style={{transition:'stroke-dasharray 0.8s'}}/>
                          <text x={ringSize/2} y={ringSize/2+ringSize*0.07} textAnchor="middle" fill="white" fontSize={ringSize*0.26} fontWeight="700">
                            {donePeople}<tspan fill="#64748b" fontSize={ringSize*0.16}>/{totalPeople}</tspan>
                          </text>
                        </svg>
                      </div>
                    );
                  })()}
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
                            const isZero=m.total>0&&m.done===0;
                            const scoreCol=isDone?'#22c55e':isNone?'#475569':isZero?'#ef4444':'#f59e0b';
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
                                <span style={{fontSize:11,color:isDone?'#94a3b8':'#cbd5e1',fontWeight:isDone?400:500,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                                  {m.name}{dateLabel&&<span style={{fontSize:9,color:'#475569',marginLeft:3}}>{dateLabel}</span>}
                                </span>
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
                          const isZero=m.total>0&&m.done===0;
                          const scoreCol=isDone?'#22c55e':isNone?'#475569':isZero?'#ef4444':'#f59e0b';
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
                              <span style={{fontSize:11,color:'#cbd5e1'}}>{m.name}{dateLabel&&<span style={{fontSize:9,color:'#475569',marginLeft:3}}>{dateLabel}</span>}</span>
                              <span style={{fontSize:10,color:scoreCol,fontWeight:700}}>{isNone?'—':`${m.done}/${m.total}`}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <div style={{display:'flex',gap:10,marginTop:8,fontSize:9,color:'#475569',flexWrap:'wrap'}}>
                    <span style={{color:'#22c55e'}}>● 全部完成</span>
                    <span style={{color:'#f59e0b'}}>● 部分完成</span>
                    <span style={{color:'#ef4444'}}>● 未开始</span>
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
            <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',zIndex:200,display:'flex',alignItems:'flex-end',justifyContent:'center'}} onClick={()=>{setShowExportMenu(null);setExportWsModal(null);setWsMultiMonthSel(null);}}>
              <div style={{background:'#0a1929',borderRadius:'14px 14px 0 0',width:'100%',maxWidth:480,maxHeight:'80vh',display:'flex',flexDirection:'column'}} onClick={e=>e.stopPropagation()}>
                {/* 顶栏 */}
                <div style={{padding:'14px 16px 10px',borderBottom:'1px solid #1b3255',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
                  <span style={{fontWeight:700,color:'#e2e8f0',fontSize:15}}>📊 导出记录</span>
                  <button onClick={()=>{setShowExportMenu(null);setExportWsModal(null);setWsMultiMonthSel(null);}} style={{background:'none',border:'none',color:'#475569',fontSize:22,cursor:'pointer',padding:0,lineHeight:1}}>×</button>
                </div>
                {/* ── 主选择面板 ── */}
                {!exportWsModal&&!wsMultiMonthSel&&(
                  <div style={{padding:'12px 16px',display:'flex',flexDirection:'column',gap:10,overflowY:'auto'}}>
                    {/* 抽问记录：复选框多月合并 */}
                    <div>
                      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
                        <span style={{fontSize:11,color:'#64748b',fontWeight:600,letterSpacing:1}}>📋 抽问记录</span>
                        <div style={{display:'flex',gap:6,alignItems:'center'}}>
                          <button onClick={()=>{const allM=new Set(exportMonths);setQuizExportSel(quizExportSel.size===exportMonths.length?new Set():allM);}} style={{padding:'3px 8px',borderRadius:4,border:'1px solid #1b3255',background:'transparent',color:'#64748b',cursor:'pointer',fontSize:10,fontFamily:'inherit'}}>
                            {quizExportSel.size===exportMonths.length&&exportMonths.length>0?'取消全选':'全选'}
                          </button>
                          <button onClick={()=>{if(!quizExportSel.size)return;const ms=[...quizExportSel].sort().join(',');window.open(`/api/export/multi?password=${encodeURIComponent(pwd)}&months=${ms}`,'_blank');}}
                            disabled={!quizExportSel.size}
                            style={{padding:'3px 10px',borderRadius:4,border:'none',background:quizExportSel.size?'#3b82f6':'#1b3255',color:quizExportSel.size?'white':'#475569',cursor:quizExportSel.size?'pointer':'default',fontSize:10,fontWeight:600,fontFamily:'inherit'}}>
                            ↓ 合并导出{quizExportSel.size?` (${quizExportSel.size}月)`:''}
                          </button>
                        </div>
                      </div>
                      <div style={{background:'#0d1e35',border:'1px solid rgba(59,130,246,0.25)',borderRadius:8,overflow:'hidden'}}>
                        {exportMonths.length===0&&<div style={{padding:'12px 14px',fontSize:12,color:'#475569'}}>暂无数据</div>}
                        {exportMonths.map(m=>{
                          const sel=quizExportSel.has(m);
                          return (
                            <div key={m} onClick={()=>{const next=new Set(quizExportSel);sel?next.delete(m):next.add(m);setQuizExportSel(next);}}
                              style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',borderTop:'1px solid rgba(27,50,85,0.5)',cursor:'pointer',background:sel?'rgba(59,130,246,0.08)':'transparent'}}>
                              <div style={{width:15,height:15,borderRadius:3,border:`2px solid ${sel?'#3b82f6':'#334155'}`,background:sel?'#3b82f6':'transparent',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                                {sel&&<span style={{color:'white',fontSize:9,fontWeight:700,lineHeight:1}}>✓</span>}
                              </div>
                              <span style={{fontSize:13,color:'#e2e8f0',flex:1}}>{m}</span>
                              <a href={`/api/export?password=${encodeURIComponent(pwd)}&month=${m}`} target="_blank" onClick={e=>e.stopPropagation()} style={{fontSize:10,color:'#475569',textDecoration:'none',padding:'2px 6px',borderRadius:3,border:'1px solid #1b3255'}}>单月↓</a>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    {/* 月度任务 */}
                    <div>
                      <div style={{fontSize:11,color:'#64748b',fontWeight:600,letterSpacing:1,marginBottom:6}}>🏭 月度任务</div>
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
                        }} style={{flex:1,padding:'11px',borderRadius:8,border:'1px solid rgba(34,197,94,0.3)',background:'rgba(34,197,94,0.06)',color:'#4ade80',cursor:'pointer',fontSize:13,fontWeight:600,fontFamily:'inherit'}}>
                          按场次导出 →
                        </button>
                        <button onClick={async()=>{
                          const wsMths=await apiJson('/api/export/workshop/months',{headers:hdrs()}).catch(()=>[]);
                          const ms=Array.isArray(wsMths)?wsMths:[];
                          setWsMultiMonthSel({months:ms,selected:new Set()});
                        }} style={{flex:1,padding:'11px',borderRadius:8,border:'1px solid rgba(251,191,36,0.3)',background:'rgba(251,191,36,0.06)',color:'#fbbf24',cursor:'pointer',fontSize:13,fontWeight:600,fontFamily:'inherit'}}>
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
                    <div style={{padding:'8px 14px',borderBottom:'1px solid #1b3255',display:'flex',alignItems:'center',gap:6,flexShrink:0}}>
                      <button onClick={()=>setWsMultiMonthSel(null)} style={{background:'none',border:'none',color:'#60a5fa',fontSize:13,cursor:'pointer',padding:0,marginRight:4}}>← 返回</button>
                      <span style={{fontSize:13,color:'#e2e8f0',flex:1,fontWeight:600}}>培训记录跨月合并</span>
                      <button onClick={()=>setWsMultiMonthSel(prev=>({...prev,selected:allSel?new Set():new Set(months)}))} style={{padding:'5px 8px',borderRadius:5,border:'1px solid #1b3255',background:'transparent',color:'#64748b',cursor:'pointer',fontSize:11,fontFamily:'inherit'}}>{allSel?'取消全选':'全选'}</button>
                      <button onClick={doExport} disabled={!sel.size} style={{padding:'5px 12px',borderRadius:5,border:'none',background:sel.size?'#fbbf24':'#1b3255',color:sel.size?'#1a1000':'#475569',cursor:sel.size?'pointer':'default',fontSize:11,fontWeight:600,fontFamily:'inherit'}}>↓ 导出{sel.size?` (${sel.size}月)`:''}</button>
                    </div>
                    <div style={{flex:1,overflowY:'auto'}}>
                      <div style={{padding:'8px 14px',fontSize:11,color:'#475569'}}>每个月生成一个 Sheet，含培训日程和出勤人数</div>
                      {months.length===0&&<div style={{textAlign:'center',color:'#475569',padding:'28px 0',fontSize:13}}>暂无数据</div>}
                      {months.map(m=>(
                        <div key={m} onClick={()=>toggleM(m)} style={{display:'flex',alignItems:'center',gap:10,padding:'11px 14px',borderBottom:'1px solid rgba(27,50,85,0.35)',cursor:'pointer',background:sel.has(m)?'rgba(251,191,36,0.06)':'transparent'}}>
                          <div style={{width:16,height:16,borderRadius:3,border:`2px solid ${sel.has(m)?'#fbbf24':'#334155'}`,background:sel.has(m)?'#fbbf24':'transparent',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                            {sel.has(m)&&<span style={{color:'#1a1000',fontSize:10,fontWeight:700,lineHeight:1}}>✓</span>}
                          </div>
                          <span style={{fontSize:13,color:'#e2e8f0'}}>{m}</span>
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
            // 休息日：白班开始日 +3 天即为休息日，套班答题已结束
            const todayStr = new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
            const cycleStart = qPinned.cycle?.start_date;
            const cycleRestDate = cycleStart
              ? new Date(new Date(cycleStart+'T00:00:00+08:00').getTime()+3*86400000).toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'})
              : null;
            const isCycleOver = cycleRestDate ? todayStr >= cycleRestDate : false;
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
                setPinFormOpen(false);
                apiJson('/api/admin/dingtalk/notify-start',{method:'POST',headers:hdrs(),body:JSON.stringify({ids:body.ids,mode:body.mode,count:body.count,bank_id:body.bank_id,bank_ids:body.bank_ids,scope:body.scope})}).catch(()=>null);
              } else { alert('设置失败'); }
            };

            return (
              <div className="card">
                <div style={{fontSize:11,color:'#64748b',letterSpacing:1,fontWeight:600,marginBottom:6,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <span>📌 本套班抽问题目</span>
                  {qPinned.cycle?.label && <span style={{fontSize:10,color:'rgba(96,165,250,0.7)',fontWeight:400}}>本套班：{qPinned.cycle.label}</span>}
                </div>
                {!isActive && (
                  <div style={{marginBottom:12,padding:'8px 12px',background:'rgba(148,163,184,0.06)',border:'1px solid rgba(148,163,184,0.18)',borderRadius:8,fontSize:11,color:'#94a3b8'}}>
                    ⏳ 本套班尚未发布抽问题目{qPinned.stale && <span style={{color:'#64748b',marginLeft:6}}>（上套班 {qPinned.stale.created_date} 设置已失效）</span>}
                  </div>
                )}

                {/* 当前生效状态 */}
                {isActive&&(
                  <div style={{marginBottom:12,padding:'8px 12px',background:isCycleOver?'rgba(100,116,139,0.07)':'rgba(34,197,94,0.07)',border:`1px solid ${isCycleOver?'rgba(100,116,139,0.25)':'rgba(34,197,94,0.2)'}`,borderRadius:8,fontSize:11,color:isCycleOver?'#94a3b8':'#86efac'}}>
                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:6}}>
                      <span>
                        {isCycleOver?'🔒 本套班已结束：':'✅ 当前已设置：'}
                        {qPinned.mode==='emergency'?'应急随机':qPinned.mode==='random'?'多题随机':'手动选题'} · {qPinned.count||3}题 · {qPinned.scope==='today'?'今天生效':'本套班生效'}
                      </span>
                      {!isCycleOver&&(
                        <span style={{display:'flex',gap:10,flexShrink:0}}>
                          <button onClick={()=>setPinFormOpen(o=>!o)} style={{background:'none',border:'none',color:'#60a5fa',cursor:'pointer',fontSize:11,padding:0}}>{pinFormOpen?'▲ 收起':'修改设置'}</button>
                          <button onClick={()=>setPinCancelModal(true)} style={{background:'none',border:'none',color:'#ef4444',cursor:'pointer',fontSize:11,padding:0}}>取消发布</button>
                        </span>
                      )}
                    </div>
                    {(qPinned.created_at||qPinned.created_date)&&(()=>{
                      const stamp = qPinned.created_at || qPinned.created_date;
                      const isToday = stamp.startsWith(todayStr);
                      return (
                        <div style={{marginTop:4,fontSize:10,color:isCycleOver?'#64748b':isToday?'rgba(134,239,172,0.7)':'#f59e0b'}}>
                          📅 发布于 {stamp}{!isCycleOver&&!isToday&&' （非今日设置，注意核对）'}
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* 表单：未发布时直接显示，已发布时折叠 */}
                {(!isActive||pinFormOpen)&&<>

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
                    {['shift','today'].map(s=><button key={s} onClick={()=>setPinScope(s)} style={{flex:1,padding:'8px',borderRadius:7,border:`1px solid ${pinScope===s?'#3b82f6':'#1b3255'}`,background:pinScope===s?'rgba(59,130,246,0.15)':'none',color:pinScope===s?'#60a5fa':'#94a3b8',cursor:'pointer',fontSize:12}}>{s==='today'?'今天生效':'本套班生效'}</button>)}
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
                </>}

                {/* 取消发布确认弹窗 — 放在折叠块外，始终可渲染 */}
                {pinCancelModal&&(
                  <div onClick={()=>setPinCancelModal(false)} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',zIndex:300,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
                    <div onClick={e=>e.stopPropagation()} style={{background:'#0f2744',borderRadius:12,padding:20,width:'100%',maxWidth:300,border:'1px solid rgba(239,68,68,0.3)'}}>
                      <div style={{fontWeight:700,color:'white',fontSize:15,marginBottom:8}}>⚠️ 取消本套班抽问？</div>
                      <div style={{fontSize:13,color:'#94a3b8',marginBottom:16,lineHeight:1.6}}>取消后本套班答题按钮将变灰，已完成的成绩记录不受影响。</div>
                      <div style={{display:'flex',gap:8}}>
                        <button onClick={()=>setPinCancelModal(false)} style={{flex:1,padding:'10px',borderRadius:7,border:'1px solid #1b3255',background:'transparent',color:'#94a3b8',fontFamily:'inherit',fontSize:13,cursor:'pointer'}}>返回</button>
                        <button onClick={async()=>{
                          await apiJson('/api/admin/pinned-questions',{method:'PUT',headers:hdrs(),body:JSON.stringify({ids:[],scope:'none',mode:'emergency',count:3,bank_id:null,bank_ids:[]})}).catch(()=>null);
                          setQPinned({ids:[],scope:'none',mode:'emergency',count:3,bank_id:null,bank_ids:[],questions:[]});
                          setQSelected([]);setPinMode('emergency');setPinCount(3);setPinRandomBankId(null);setCheckedBankIds([]);setPinFormOpen(false);setPinCancelModal(false);
                        }} style={{flex:1,padding:'10px',borderRadius:7,border:'none',background:'#dc2626',color:'white',fontFamily:'inherit',fontSize:13,fontWeight:600,cursor:'pointer'}}>确认取消</button>
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
                      <div style={{fontSize:12,color:'white',fontWeight:600,marginBottom:2,lineHeight:1.4,display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                        {renamingBank?.id===b.id ? (
                          <form style={{display:'flex',gap:4,alignItems:'center',flex:1}} onSubmit={async e=>{e.preventDefault();e.stopPropagation();const nm=renamingBank.name.trim();if(!nm)return;await apiJson(`/api/banks/${b.id}`,{method:'PUT',headers:hdrs(),body:JSON.stringify({name:nm})}).catch(()=>null);setBanks(prev=>prev.map(x=>x.id===b.id?{...x,name:nm}:x));setRenamingBank(null);}}>
                            <input autoFocus value={renamingBank.name} onChange={e=>setRenamingBank(prev=>({...prev,name:e.target.value}))} onClick={e=>e.stopPropagation()} style={{flex:1,fontSize:12,padding:'3px 6px',borderRadius:4,border:'1px solid #3b82f6',background:'#0d1117',color:'white'}}/>
                            <button type="submit" onClick={e=>e.stopPropagation()} style={{fontSize:11,padding:'3px 8px',borderRadius:4,border:'none',background:'#3b82f6',color:'white',cursor:'pointer'}}>保存</button>
                            <button type="button" onClick={e=>{e.stopPropagation();setRenamingBank(null);}} style={{fontSize:11,padding:'3px 8px',borderRadius:4,border:'1px solid #334155',background:'none',color:'#94a3b8',cursor:'pointer'}}>取消</button>
                          </form>
                        ) : (
                          <><span>{b.name}</span><button onClick={e=>{e.stopPropagation();setRenamingBank({id:b.id,name:b.name});}} style={{flexShrink:0,background:'none',border:'none',color:'#475569',cursor:'pointer',fontSize:12,padding:'0 2px',lineHeight:1}} title="改名">✏️</button></>
                        )}
                        {b.bank_type_summary && b.bank_type_summary !== 'empty' && (() => {
                          const map = { choice:{label:'选择',color:'#60a5fa'}, fill:{label:'填空',color:'#f59e0b'}, short:{label:'简答',color:'#22c55e'}, mixed:{label:'混合',color:'#a78bfa'} };
                          const m = map[b.bank_type_summary];
                          return m && <span style={{fontSize:9,color:m.color,background:m.color+'22',border:`1px solid ${m.color}44`,borderRadius:4,padding:'1px 5px',fontWeight:600}}>{m.label}</span>;
                        })()}
                      </div>
                      <div style={{fontSize:11,color:'#475569'}}>
                        {b.q_count||0} 题
                        {(() => {
                          const TLAB = {choice_single:'单选',choice_multi:'多选',true_false:'判断',fill_blank:'填空',short_answer:'简答'};
                          const ORDER = ['choice_single','choice_multi','true_false','fill_blank','short_answer'];
                          const d = b.type_dist || {};
                          const parts = ORDER.filter(t=>d[t]).map(t=>`${TLAB[t]}${d[t]}`);
                          return parts.length>0 ? <span style={{marginLeft:6,color:'#64748b'}}>· {parts.join('/')}</span> : null;
                        })()}
                        <span style={{color:'#334155',marginLeft:4}}>{expanded?'▲':'▼'}</span>
                      </div>
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
            const canCheckAny = (qSelectOpen || (pinMode==='manual') || (pinMode==='random'&&!pinRandomBankId)) && !(pinMode==='manual' && checkedBankIds.length > 0);
            return (
              <div className="card">
                <div style={{fontSize:11,color:'#64748b',letterSpacing:1,fontWeight:600,marginBottom:10}}>📚 题库</div>
                {/* 选题模式搜索框 */}
                {canCheckAny&&(
                  <div style={{marginBottom:12}}>
                    <div style={{display:'flex',gap:6,alignItems:'center'}}>
                      <input
                        value={qSearch}
                        onChange={e=>{setQSearch(e.target.value);if(e.target.value.trim()&&qAll.length===0)apiJson('/api/admin/questions/all',{headers:hdrs()}).then(setQAll).catch(()=>{});}}
                        placeholder="搜索题目关键词…"
                        style={{flex:1,background:'#0d1117',border:'1px solid #1b3255',color:'white',borderRadius:6,padding:'7px 10px',fontSize:12,fontFamily:'inherit',outline:'none'}}
                      />
                      {qSearch&&<button onClick={()=>setQSearch('')} style={{background:'none',border:'none',color:'#475569',cursor:'pointer',fontSize:16,padding:'0 4px',lineHeight:1}}>×</button>}
                    </div>
                    {qSearch.trim()&&(()=>{
                      const filtered=qAll.filter(q=>q.text.toLowerCase().includes(qSearch.toLowerCase()));
                      return(
                        <div style={{maxHeight:280,overflowY:'auto',marginTop:6,border:'1px solid #1b3255',borderRadius:6,background:'rgba(13,17,23,0.6)'}}>
                          {qAll.length===0
                            ?<div style={{fontSize:11,color:'#475569',textAlign:'center',padding:'10px 0'}}>加载中…</div>
                            :filtered.length===0
                            ?<div style={{fontSize:11,color:'#475569',textAlign:'center',padding:'10px 0'}}>未找到匹配题目</div>
                            :filtered.map(q=>{
                              const sel=qSelected.includes(q.id);
                              const maxReached=!sel&&(pinMode==='manual'?qSelected.length>=pinCount:false);
                              return(
                                <div key={q.id} style={{display:'flex',alignItems:'flex-start',gap:8,padding:'8px 10px',borderBottom:'1px solid rgba(27,50,85,0.3)',background:sel?'rgba(59,130,246,0.08)':'none'}}>
                                  <div onClick={e=>{e.stopPropagation();if(sel){setQSelected(s=>s.filter(id=>id!==q.id));}else if(!maxReached){setQSelected(s=>[...s,q.id]);}}} style={{width:16,height:16,borderRadius:3,border:`2px solid ${sel?'#3b82f6':'#334155'}`,background:sel?'#3b82f6':'none',flexShrink:0,marginTop:2,display:'flex',alignItems:'center',justifyContent:'center',cursor:maxReached?'not-allowed':'pointer',opacity:maxReached?0.4:1}}>
                                    {sel&&<span style={{color:'white',fontSize:9}}>✓</span>}
                                  </div>
                                  <div style={{flex:1,fontSize:11,color:'#94a3b8',lineHeight:1.5}}>{q.text}</div>
                                  <span style={{fontSize:10,color:'#475569',flexShrink:0,marginTop:1,whiteSpace:'nowrap'}}>{q.bank_name}</span>
                                </div>
                              );
                            })}
                        </div>
                      );
                    })()}
                  </div>
                )}
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

                {/* 操作按钮行：添加题目 + 添加题库 */}
                <div style={{display:'flex',gap:8}}>
                  <button onClick={()=>{setShowAddQPanel(p=>!p);setShowImportPanel(false);}} style={{flex:1,background:showAddQPanel?'#1b3a6e':'#0d1e35',border:`1px solid ${showAddQPanel?'#3b82f6':'#1b3255'}`,color:showAddQPanel?'#60a5fa':'#94a3b8',borderRadius:7,padding:'9px',fontSize:12,fontWeight:600,cursor:'pointer'}}>
                    {showAddQPanel?'▲ 收起':'＋ 添加题目'}
                  </button>
                  <button onClick={()=>{setShowImportPanel(p=>!p);setShowAddQPanel(false);}} style={{flex:1,background:showImportPanel?'#1b3a6e':'#0d1e35',border:`1px solid ${showImportPanel?'#3b82f6':'#1b3255'}`,color:showImportPanel?'#60a5fa':'#94a3b8',borderRadius:7,padding:'9px',fontSize:12,fontWeight:600,cursor:'pointer'}}>
                    {showImportPanel?'▲ 收起':'＋ 添加题库'}
                  </button>
                </div>

                {showAddQPanel&&<AddQuestionPanel pwd={pwd} banks={banks} hdrs={hdrs} onDone={()=>apiJson('/api/banks',{headers:hdrs()}).then(setBanks).catch(()=>{})}/>}

                {showImportPanel&&<BankImportCard pwd={pwd} onImported={()=>{apiJson('/api/banks',{headers:hdrs()}).then(setBanks).catch(()=>{});}}/>}
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

export default AdminScreen;
