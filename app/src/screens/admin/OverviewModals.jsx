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
