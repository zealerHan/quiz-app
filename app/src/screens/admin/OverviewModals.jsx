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
