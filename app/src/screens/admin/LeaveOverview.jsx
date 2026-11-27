// screens/admin/LeaveOverview.jsx
//
// 全组休假总览
//
// 这块界面 2026-11-26 做过（老韩截图可证），但代码没进 git，
// 2026-11-27 规范化部署时被覆盖丢失。现按聊天记录里的原始需求重建。
//
// ══ 老韩的原始需求（逐条对应，别漏）══
//   11-26 15:53  「可视化全组休假预览，一个数据是班组 30 个在编序号的
//                 人休假天数总额，一个是每个人休假情况」
//   11-26 16:05  「总览做一个默认折叠吧，平时一般也不看，处理审批为主」
//   11-26 16:42  「休超了也正常显示。确实是有一些特殊情况和特例，我需要数据真实记录」
//                → 超支显示 `8/5（超3）`，不要 ⚠ 图标
//   11-26 17:10  「加一个切换年份的按钮」「总人数还是这 41」
//                「总览列表名字前面加个序号」
//   11-27        「措辞只用「车峰」，不要用「编外」」
//
// ══ 口径 ══
//   在编  = staff 里 is_cp=0 的人（当前 30 人）
//   车峰  = is_cp=1（当前 11 人），不计入在编合计，列在下方做差异标注
//   已休  = status IN ('verified','locked','reported','released')
//   超支  = 额度>0 且 已休>额度 → 显示 `8/5（超3）`
//   额度0 = 显示「已休N 已用完」，不标异常（这是主动置0的正常状态）
//
// ══ 接口 ══
//   GET /api/leave/all?year=       每人额度/已休/剩余 + 分假别 detail + seq + is_cp
//   GET /api/leave/staff/:id?year= 单人完整记录（点某人弹窗）

import { useState, useEffect } from "react";
import { apiJson } from "../../shared.jsx";

const fmt = (n) => {
  if (n === null || n === undefined) return "-";
  const v = Math.round(n * 10) / 10;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
};

// 进度条配色（老韩原话：蓝色=休得少、橙色=休过半、红色=已用完/超出）
const barColor = (used, total) => {
  if (total <= 0) return "#e8723c";
  const ratio = used / total;
  if (ratio >= 1) return "#e8723c";
  if (ratio > 0.5) return "#e8a726";
  return "#6ba5fb";
};

const STATUS_LABEL = {
  verified: "已核实", locked: "已锁定", reported: "已报车场组",
  released: "已销假", submitted: "待审", cancel_pending: "撤销待批",
  rejected: "已驳回", cancelled: "已撤销", draft: "草稿",
};

/** 单人明细弹窗 */
function StaffDetailModal({ staffRow, year, hdrs, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    apiJson(`/api/leave/staff/${staffRow.staff_id}?year=${year}`, { headers: hdrs() })
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setData({ records: [], lines: [] }); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [staffRow.staff_id, year]);

  const records = data?.records || [];
  const lines = data?.lines || [];

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)",
      display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 100,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "100%", maxWidth: 440, background: "var(--card)",
        border: "1px solid var(--border)", borderRadius: "16px 16px 0 0",
        padding: "16px 16px 28px", maxHeight: "80vh", overflowY: "auto",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
              {staffRow.name}
              {data?.is_cp ? (
                <span style={{
                  marginLeft: 6, fontSize: 9.5, padding: "1px 5px", borderRadius: 3,
                  background: "rgba(232,167,38,0.14)", border: "1px solid rgba(232,167,38,0.4)",
                  color: "#e8a726", fontWeight: 400,
                }}>车峰</span>
              ) : null}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
              {staffRow.seq != null ? `序号 ${staffRow.seq} · ` : ""}Y{staffRow.staff_id} · {year} 年
            </div>
          </div>
          <button onClick={onClose} style={{
            background: "none", border: "1px solid var(--border)", color: "var(--muted)",
            borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 12,
          }}>关闭</button>
        </div>

        {loading && <div style={{ textAlign: "center", padding: "24px 0" }}>
          <div className="spinner" style={{ margin: "0 auto" }} />
        </div>}

        {/* 各假别额度 */}
        {!loading && lines.length > 0 && (
          <div style={{
            background: "var(--p-navy-16-a60)", border: "1px solid var(--border)",
            borderRadius: 9, padding: "9px 11px", marginBottom: 12,
          }}>
            {lines.map((l) => {
              const over = l.total > 0 && l.used > l.total;
              return (
                <div key={l.name} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0" }}>
                  <span style={{ color: "var(--muted)" }}>{l.name}</span>
                  <span style={{ color: over ? "#e8723c" : "var(--text)" }}>
                    {l.total === 0 && l.used > 0
                      ? `已休${fmt(l.used)} 已用完`
                      : `${fmt(l.used)}/${fmt(l.total)}${over ? `（超${fmt(l.used - l.total)}）` : ""}`}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {!loading && records.length === 0 && (
          <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, padding: "28px 0" }}>
            无相关记录
          </div>
        )}

        {!loading && records.map((r) => (
          <div key={r.id} style={{
            background: "var(--p-navy-16-a60)", border: "1px solid var(--border)",
            borderRadius: 10, padding: "10px 12px", marginBottom: 8,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{
                fontSize: 10.5, padding: "1px 7px", borderRadius: 5,
                background: "rgba(91,155,250,0.16)", border: "1px solid rgba(91,155,250,0.4)",
                color: "#7ec8f0",
              }}>{r.leave_type}</span>
              {r.status && r.status !== "verified" && (
                <span style={{ fontSize: 10, color: "var(--muted)" }}>{STATUS_LABEL[r.status] || r.status}</span>
              )}
              <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--muted)" }}>
                {r.start_date === r.end_date ? r.start_date : `${r.start_date} ~ ${r.end_date}`}
              </span>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text)" }}>
              扣 <b>{fmt(r.days)}</b> 天
              {r.created_by && <span style={{ marginLeft: 8, fontSize: 10.5, color: "var(--muted)" }}>{r.created_by}</span>}
            </div>
            {r.relief_note && (
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, lineHeight: 1.6 }}>备注：{r.relief_note}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** 一行：序号 姓名 [车峰] —— 进度条 —— 已休/额度 */
function PersonRow({ r, onOpen }) {
  const over = r.annual_total > 0 && r.annual_used > r.annual_total;
  const usedUp = r.annual_total === 0 && r.annual_used > 0;
  const pct = r.annual_total > 0
    ? Math.min(100, (r.annual_used / r.annual_total) * 100)
    : 100;
  const color = barColor(r.annual_used, r.annual_total);

  return (
    <div onClick={onOpen} style={{ padding: "8px 2px", borderBottom: "1px solid var(--p-navy-22-a30)", cursor: "pointer" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
        <span style={{ fontSize: 10.5, color: "var(--muted)", minWidth: 16 }}>{r.seq ?? ""}</span>
        <span style={{ fontSize: 12.5, color: "var(--text)", fontWeight: 600 }}>{r.name}</span>
        {r.is_cp ? (
          <span style={{
            fontSize: 9.5, padding: "0 4px", borderRadius: 3,
            background: "rgba(232,167,38,0.14)", border: "1px solid rgba(232,167,38,0.4)", color: "#e8a726",
          }}>车峰</span>
        ) : null}
        <span style={{ marginLeft: "auto", fontSize: 11.5, color }}>
          {usedUp
            ? `已休${fmt(r.annual_used)} 已用完`
            : `休 ${fmt(r.annual_used)} / ${fmt(r.annual_total)}${over ? `（超${fmt(r.annual_used - r.annual_total)}）` : ""}`
          }
        </span>
      </div>
      <div style={{ height: 4, background: "var(--p-navy-22-a60)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2 }} />
      </div>
    </div>
  );
}

/**
 * 全组休假总览（默认折叠）
 *
 * props:
 *   hdrs   () => 管理员请求头
 */
export default function LeaveOverview({ hdrs }) {
  const [open, setOpen] = useState(false);          // 默认折叠（老韩：平时不看，以审批为主）
  const [year, setYear] = useState(2026);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState(null);
  const [sortBy, setSortBy] = useState("left");     // left=剩余从多到少 / used=已休从多到少

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    apiJson(`/api/leave/all?year=${year}`, { headers: hdrs() })
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setData({ rows: [] }); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, year]);

  const allRows = data?.rows || [];
  const regRows = allRows.filter((r) => !r.is_cp);
  const cpRows = allRows.filter((r) => r.is_cp);

  const sum = (arr, k) => arr.reduce((a, r) => a + (r[k] || 0), 0);
  const stat = {
    reg: { n: regRows.length, total: sum(regRows, "annual_total"), used: sum(regRows, "annual_used"), left: sum(regRows, "annual_left") },
    cp: { n: cpRows.length, total: sum(cpRows, "annual_total"), used: sum(cpRows, "annual_used"), left: sum(cpRows, "annual_left") },
  };

  const sortFn = sortBy === "left"
    ? (a, b) => b.annual_left - a.annual_left
    : (a, b) => b.annual_used - a.annual_used;

  const sortedReg = [...regRows].sort(sortFn);
  const sortedCp = [...cpRows].sort(sortFn);

  return (
    <div style={{
      background: "var(--card)", border: "1px solid var(--border)",
      borderRadius: 11, marginBottom: 12, overflow: "hidden",
    }}>
      {/* ── 标题行（可点，默认折叠）── */}
      <div onClick={() => setOpen(!open)} style={{
        display: "flex", alignItems: "center", gap: 8, padding: "11px 13px", cursor: "pointer",
      }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)" }}>全组休假总览</span>
        {!open && data && (
          <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
            在编 {stat.reg.n} 人 · 已休 {fmt(stat.reg.used)} / {fmt(stat.reg.total)} 天
          </span>
        )}
        <span style={{
          marginLeft: "auto", fontSize: 11, color: "var(--muted)",
          transform: open ? "rotate(180deg)" : "none", transition: "transform .2s",
        }}>▼</span>
      </div>

      {open && (
        <div style={{ padding: "0 13px 13px" }}>
          {/* ── 年份切换 ── */}
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            {[2026, 2027].map((y) => (
              <button key={y} onClick={() => setYear(y)} style={{
                flex: 1, padding: "6px 0", borderRadius: 8, fontSize: 12, cursor: "pointer",
                fontWeight: year === y ? 700 : 400,
                background: year === y ? "rgba(91,155,250,0.18)" : "transparent",
                border: `1px solid ${year === y ? "rgba(91,155,250,0.55)" : "var(--border)"}`,
                color: year === y ? "var(--blue)" : "var(--muted)",
              }}>{y} 年</button>
            ))}
          </div>

          {loading && <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div className="spinner" style={{ margin: "0 auto" }} />
          </div>}

          {!loading && data && (
            <>
              {/* ── 汇总（只算在编）── */}
              <div style={{
                background: "var(--p-navy-16-a60)", border: "1px solid var(--border)",
                borderRadius: 9, padding: "9px 11px", marginBottom: 10,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, marginBottom: 6 }}>
                  <span style={{ color: "var(--muted)" }}>在编 {stat.reg.n} 人合计</span>
                  {stat.cp.n > 0 && <span style={{ color: "var(--muted)", fontSize: 10.5 }}>车峰 {stat.cp.n} 人不计</span>}
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  {[["全年额度", stat.reg.total, "var(--text)"],
                    ["已休", stat.reg.used, "var(--text)"],
                    ["剩余", stat.reg.left, stat.reg.left < 0 ? "#e8723c" : "var(--blue)"]].map(([k, v, c]) => (
                    <div key={k} style={{ flex: 1, textAlign: "center" }}>
                      <div style={{ fontSize: 16, fontWeight: 700, color: c }}>{fmt(v)}</div>
                      <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>{k}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── 排序切换 ── */}
              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                {[["left", "剩余从多到少"], ["used", "已休从多到少"]].map(([k, label]) => (
                  <button key={k} onClick={() => setSortBy(k)} style={{
                    flex: 1, padding: "4px 0", borderRadius: 6, fontSize: 10.5, cursor: "pointer",
                    background: sortBy === k ? "rgba(91,155,250,0.14)" : "transparent",
                    border: `1px solid ${sortBy === k ? "rgba(91,155,250,0.45)" : "var(--border)"}`,
                    color: sortBy === k ? "var(--blue)" : "var(--muted)",
                  }}>{label}</button>
                ))}
              </div>

              {/* ── 在编人员 ── */}
              {sortedReg.map((r) => (
                <PersonRow key={r.staff_id} r={r} onOpen={() => setDetail(r)} />
              ))}

              {/* ── 车峰差异标注（不计入上方合计）── */}
              {sortedCp.length > 0 && (
                <>
                  <div style={{
                    marginTop: 12, padding: "7px 10px", borderRadius: 8,
                    background: "rgba(232,167,38,0.08)", border: "1px solid rgba(232,167,38,0.28)",
                    fontSize: 10.5, color: "#e8a726", lineHeight: 1.6,
                  }}>
                    以下 {stat.cp.n} 人为车峰（临时调整跑车方式，保留组籍）<br />
                    不计入上方在编合计，仅作差异标注
                  </div>
                  {sortedCp.map((r) => (
                    <PersonRow key={r.staff_id} r={r} onOpen={() => setDetail(r)} />
                  ))}
                </>
              )}
            </>
          )}
        </div>
      )}

      {detail && (
        <StaffDetailModal staffRow={detail} year={year} hdrs={hdrs} onClose={() => setDetail(null)} />
      )}
    </div>
  );
}
