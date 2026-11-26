// screens/admin/SimpleTabParts.jsx
//
// 三个「简单 tab」的渲染内容（从 AdminScreen.jsx 抽出，2026-11-27）
//
// 为什么放一起而不是各一个文件：
//   logs 28 行、devices 66 行、leave 208 行，都只显示一块内容，
//   各建一个文件反而更零碎。同一主题（都是「只读查看类」）放一起。
//
// 三个组件都不含 state —— 数据由 AdminScreen 传进来，
// 这样搬动时不改变任何数据流向，风险最低。
//
// 注意 LeaveTab 的 reviewLeave 是 props 传进来的：
//   批准/驳回后要刷新列表，刷新逻辑仍在 AdminScreen 里，
//   组件只负责「点了按钮调用一下」。

import { apiJson } from "../../shared.jsx";

/** 休假审批：周报批清单 + 待批列表 + 驳回弹窗 */
export function LeaveTab({
  weekBatch, weekLoading, weekAnchor, setWeekAnchor,
  leavePending, leavePendLoading, loadLeavePending,
  rejectModal, setRejectModal, rejectReason, setRejectReason,
  reviewLeave, loadWeekBatch, hdrs,
  copyBatchText, markReported,
}) {
  return (
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
  );
}

/** 登录/答题设备留痕（只记录不拦截，用途是发现替人答题） */
export function DevicesTab({ devices, setDevices, hdrs }) {
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
}

/** 后台操作日志 */
export function LogsTab({ logs, setLogs, hdrs }) {
  return (
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
  );
}
