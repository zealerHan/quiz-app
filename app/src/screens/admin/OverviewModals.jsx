import { apiJson, AppModal } from "../../shared.jsx";

// screens/admin/OverviewModals.jsx
//
// 从 AdminScreen.jsx 概览区抽出的弹窗组件。
//
// 抽取原则（2026-11-27 Stage 3）：
//   按功能边界切，不按 useState 数量切。
//   先抽「纯展示 + 单个 setter」这类耦合最浅的，风险最小、最容易验证。
//   每个组件独立可上线、可回滚，不与其它弹窗捆在一起改。

/**
 * 成员培训评价详情弹窗
 *
 * 从概览「本月任务未完成人员」点人名打开，
 * 显示该成员本月每个培训项点的完成状态、日期和教员评语。
 *
 * props:
 *   modal     {name, itemStatuses:[{item, trainType, done, shift_date, comment}]} | null
 *   onClose   () => void
 *
 * 依赖零：只用 modal 自己带的数据，不读其它 state，不发请求。
 */
export function MemberEvalModal({ modal, onClose }) {
  if (!modal) return null;
  const items = modal.itemStatuses || [];

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'var(--p-black-00-a70)', zIndex: 200,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 440, background: 'var(--input-bg)',
          border: '1px solid var(--p-blue-60-a30)', borderRadius: '16px 16px 0 0',
          padding: '20px 16px 32px', maxHeight: '70vh', overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>{modal.name}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>本月培训项点完成情况</div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}
          >×</button>
        </div>

        {items.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
            本月暂无培训项点
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
              {items.filter((it) => it.done).length}/{items.length} 项已完成
            </div>
            {items.map((it, i) => {
              const mmdd = it.done && it.shift_date
                ? (() => { const [, mm, dd] = it.shift_date.split('-'); return `${parseInt(mm)}/${parseInt(dd)}`; })()
                : null;
              return (
                <div key={i} style={{
                  padding: '10px 12px',
                  background: it.done ? 'var(--p-green-45-a06)' : 'var(--p-red-60-a04)',
                  border: `1px solid ${it.done ? 'var(--p-green-45-a20)' : 'var(--p-red-60-a15)'}`,
                  borderRadius: 8,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13, flexShrink: 0 }}>{it.done ? '✅' : '❌'}</span>
                    <span style={{
                      flex: 1, fontSize: 12,
                      color: it.done ? 'var(--text)' : 'var(--red)',
                      fontWeight: it.done ? 500 : 600,
                    }}>{it.item}</span>
                    <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>{it.trainType}</span>
                    {mmdd && <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>（{mmdd}）</span>}
                  </div>
                  {it.done && it.comment && (
                    <div style={{
                      marginTop: 5, fontSize: 11, color: 'var(--muted)', lineHeight: 1.6,
                      borderLeft: '2px solid var(--p-green-45-a35)', paddingLeft: 8,
                    }}>评价：{it.comment}</div>
                  )}
                  {it.done && !it.comment && (
                    <div style={{ marginTop: 3, fontSize: 11, color: 'var(--muted)', paddingLeft: 10 }}>（无评语）</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 重置答题弹窗
 *
 * 用于把某人本套班的答题记录清空。若该人员正在答题（isAnswering），
 * 文案和按钮会升级为「正在答题 / 仍然重置」，避免误杀。
 *
 * props:
 *   modal       {staff_id, name, isAnswering?, last_active_at?} | null
 *   hdrs        () => headers
 *   onClose     () => void
 *   onDone      () => void   重置成功后刷新概览/积分榜
 *
 * 副作用封装在组件内：只暴露「重置成功了」这个事件，父组件不用再传 4 个 setter。
 */
export function ResetAnswerModal({ modal, hdrs, onClose, onDone }) {
  if (!modal) return null;
  const isAnswering = !!modal.isAnswering;

  const doReset = async () => {
    const r = await apiJson(
      `/api/admin/sessions/reset-cycle/${modal.staff_id}`,
      { method: 'DELETE', headers: hdrs() }
    ).catch(() => null);
    onClose();
    if (r?.ok) onDone?.();
    else alert('重置失败');
  };

  return (
    <AppModal
      icon={isAnswering ? '⚠️' : '🔄'}
      title={isAnswering ? `正在答题：${modal.name}` : `重置：${modal.name}`}
      body={isAnswering
        ? `⚠ 该人员正在答题（最后操作 ${modal.last_active_at?.slice(11, 16) || ''}），重置会清空其本轮所有答题记录。\n确认要中断并重置吗？`
        : '确认重置本套班答题记录？\n重置后该人员可在本套班内重新答题。'}
      buttons={[
        { label: '取消', onClick: onClose },
        { label: isAnswering ? '仍然重置' : '确认重置', danger: true, onClick: doReset },
      ]}
    />
  );
}

/**
 * 补答授权弹窗
 *
 * props:
 *   modal    {staff_id, name} | null
 *   hdrs     () => headers
 *   onClose  () => void
 */
export function MakeupGrantModal({ modal, hdrs, onClose }) {
  if (!modal) return null;

  const doGrant = async () => {
    const r = await apiJson('/api/admin/makeup/grant', {
      method: 'POST', headers: hdrs(), body: JSON.stringify({ staffId: modal.staff_id }),
    }).catch(() => null);
    onClose();
    if (r?.ok) alert(`已授权 ${modal.name} 补答，有效至 ${r.expiresAt.slice(0, 16)}`);
    else alert('授权失败，请重试');
  };

  return (
    <AppModal
      icon="⏰"
      title={`补答授权：${modal.name}`}
      body={'授权后该人员可在 30 分钟内完成本套班补答。\n逾期未答将不再计入本轮成绩。'}
      buttons={[
        { label: '取消', onClick: onClose },
        { label: '授权补答', primary: true, onClick: doGrant },
      ]}
    />
  );
}

/**
 * 授权复查弹窗
 *
 * 不合格人员 12 小时内可复查一次，结果记入复查台账。
 *
 * props:
 *   modal    {staff_id, name, score?} | null
 *   hdrs     () => headers
 *   onClose  () => void
 *   onDone   () => void   授权成功后刷新概览 + 复查台账
 */
export function RemediationGrantModal({ modal, hdrs, onClose, onDone }) {
  if (!modal) return null;

  const doGrant = async () => {
    const r = await apiJson('/api/admin/remediation/grant', {
      method: 'POST', headers: hdrs(), body: JSON.stringify({ staffId: modal.staff_id }),
    }).catch(() => null);
    onClose();
    if (r?.ok) {
      alert(`已授权 ${modal.name} 复查，有效至 ${r.expiresAt.slice(0, 16)}`);
      onDone?.();
    } else alert('授权失败，请重试');
  };

  return (
    <AppModal
      icon="⚠️"
      title={`授权复查：${modal.name}`}
      body={`本轮得分：${modal.score ?? '—'}分（不合格）\n\n授权后该人员可在 12 小时内完成本套班复查。\n复查结果将记入复查台账，作为考核依据。`}
      buttons={[
        { label: '取消', onClick: onClose },
        { label: '确认授权复查', danger: true, onClick: doGrant },
      ]}
    />
  );
}

/**
 * 本月项点详情弹窗
 *
 * 显示某个培训项点（某月某日某组）下每个成员的完成情况：
 * 绿点=已评价、红点=未评价，已评价且带评语的显示评语。
 *
 * props:
 *   modal    {shift_date, group_name, plan_type, members:[{name, evaluated, comment}]} | null
 *   onClose  () => void
 *
 * 依赖零：纯展示，不发请求。
 */
export function PlanDetailModal({ modal, onClose }) {
  if (!modal) return null;
  const members = modal.members || [];

  // shift_date 形如 2026-11-27，显示成「11月27日」
  const dateLabel = (() => {
    const parts = (modal.shift_date || '').split('-');
    if (parts.length < 3) return modal.shift_date || '';
    return `${parseInt(parts[1])}月${parseInt(parts[2])}日`;
  })();

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'var(--p-black-00-a70)', zIndex: 200,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 440, background: 'var(--input-bg)',
          border: '1px solid var(--p-blue-60-a30)', borderRadius: '16px 16px 0 0',
          padding: '20px 16px 32px', maxHeight: '70vh', overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>{dateLabel}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              {modal.group_name} · {modal.plan_type === '培训' ? '实操培训' : modal.plan_type}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}
          >×</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {members.length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
              暂无成员数据
            </div>
          ) : (
            members.map((m, i) => (
              <div key={i} style={{
                padding: '8px 12px',
                background: m.evaluated ? 'var(--p-green-45-a06)' : 'var(--p-red-60-a05)',
                border: `1px solid ${m.evaluated ? 'var(--p-green-45-a18)' : 'var(--p-red-60-a12)'}`,
                borderRadius: 8,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: m.evaluated ? 'var(--green)' : 'var(--red)', flexShrink: 0,
                  }} />
                  <div style={{ flex: 1, fontSize: 13, color: 'var(--text)', fontWeight: 600 }}>{m.name}</div>
                  <div style={{ fontSize: 11, color: m.evaluated ? 'var(--green)' : 'var(--red)' }}>
                    {m.evaluated ? '已评价' : '未评价'}
                  </div>
                </div>
                {m.evaluated && m.comment && (
                  <div style={{
                    marginTop: 5, marginLeft: 18, fontSize: 11, color: 'var(--muted)', lineHeight: 1.5,
                    borderLeft: '2px solid var(--p-green-45-a30)', paddingLeft: 8,
                  }}>{m.comment}</div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 管理员答题轨迹弹窗
 *
 * 两种模式：
 *   mode='cycle'   只显示本套班的每次答题（可删单条成绩）
 *   mode='alltime' 按套班折叠，展开看每次答题和逐题得分
 *
 * props:
 *   modal          {staffId, staffName, mode, loading, sessions, cycles, expandedCycleId} | null
 *   hdrs           () => headers
 *   cycleId        当前套班 id（删除成绩时要带上）
 *   onClose        () => void
 *   onToggleCycle  (cycleId|null) => void   展开/收起某个套班
 *   onDeleted      () => void               删除成功后刷新积分榜
 *
 * 这个组件比其它弹窗多两个依赖（cycleId、onToggleCycle），因为它有删除和折叠交互。
 */
export function AdminDrillModal({ modal, hdrs, cycleId, onClose, onToggleCycle, onDeleted }) {
  if (!modal) return null;
  const cyExpanded = (id) => modal.expandedCycleId === id;

  return (
    <div onClick={()=>onClose()} style={{position:'fixed',inset:0,background:'var(--p-black-00-a70)',zIndex:200,display:'flex',alignItems:'flex-end',justifyContent:'center'}}>
            <div onClick={e=>e.stopPropagation()} style={{width:'100%',maxWidth:440,background:'var(--input-bg)',border:'1px solid var(--p-blue-60-a30)',borderRadius:'16px 16px 0 0',padding:'20px 16px 32px',maxHeight:'75vh',overflowY:'auto'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:14}}>
                <div style={{display:'flex',gap:10,alignItems:'flex-start'}}>
                  <div style={{width:44,height:44,borderRadius:'50%',background:'linear-gradient(135deg,var(--p-navy-25),var(--blue))',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,fontWeight:700,color:'var(--text)',flexShrink:0}}>{modal.staffName?.[0]}</div>
                  <div>
                    <div style={{fontSize:15,fontWeight:700,color:'var(--text)'}}>{modal.staffName}</div>
                    <div style={{fontSize:11,color:'var(--muted)',marginTop:2}}>{modal.mode==='cycle'?'本轮答题记录':'本月套班汇总'}</div>
                  </div>
                </div>
                <button onClick={()=>onClose()} style={{background:'none',border:'1px solid var(--border)',color:'var(--muted)',borderRadius:6,padding:'4px 10px',cursor:'pointer',fontSize:12,flexShrink:0}}>关闭</button>
              </div>
              {modal.loading&&<div style={{textAlign:'center',padding:'20px 0'}}><div className="spinner" style={{margin:'0 auto'}}/></div>}
              {/* cycle mode: show sessions */}
              {!modal.loading&&modal.mode==='cycle'&&(<>
                {modal.sessions?.length===0&&<div style={{color:'var(--muted)',fontSize:13,textAlign:'center',padding:'20px 0'}}>暂无答题记录</div>}
                {modal.sessions?.map((s,si)=>(
                  <div key={si} style={{marginBottom:12,background:'var(--p-navy-16-a60)',border:'1px solid var(--border)',borderRadius:10,padding:'12px 14px'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                      <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                        <span style={{fontSize:11,color:'var(--muted)'}}>{s.created_at?.slice(5,10)}{s.created_at?.length>=16?` ${s.created_at.slice(11,16)}`:''}{s.cycle_label?` · ${s.cycle_label}`:''}</span>
                        {s.tab_switch_count>0&&<span style={{fontSize:11,color:'var(--red)',background:'var(--p-red-60-a12)',border:'1px solid var(--p-red-60-a30)',borderRadius:4,padding:'0 5px',fontWeight:700}}>切屏×{s.tab_switch_count}</span>}
                      </div>
                      <div style={{display:'flex',gap:8,alignItems:'center'}}>
                        <span style={{fontSize:12,fontWeight:700,color:'var(--text)'}}>{Math.round(s.total_score)}分</span>
                        <button onClick={async()=>{if(!window.confirm(`确认删除这条成绩？`))return;const r=await apiJson(`/api/admin/sessions/staff/${modal.staffId}?cycle_id=${overview.cycle?.id}`,{method:'DELETE',headers:hdrs()}).catch(()=>null);if(r?.ok){apiJson('/api/admin/leaderboard/cycle',{headers:hdrs()}).then(d=>setLbSessions(d.rows||[])).catch(()=>{});onClose();}}} style={{fontSize:11,padding:'2px 6px',borderRadius:4,border:'1px solid var(--p-red-60-a30)',background:'none',color:'var(--red)',cursor:'pointer'}}>删除</button>
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
              {!modal.loading&&modal.mode==='alltime'&&(<>
                {modal.cycles?.length===0&&<div style={{color:'var(--muted)',fontSize:13,textAlign:'center',padding:'20px 0'}}>暂无记录</div>}
                {modal.cycles?.map((cy,ci)=>{
                  const cyExp=cyExpanded(cy.cycle_id);
                  return(
                    <div key={ci} style={{marginBottom:10,background:'var(--p-navy-16-a60)',border:'1px solid var(--border)',borderRadius:10,overflow:'hidden'}}>
                      <div onClick={()=>onToggleCycle(cyExp?null:cy.cycle_id)} style={{display:'flex',alignItems:'center',gap:10,padding:'12px 14px',cursor:'pointer'}}>
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
  );
}
