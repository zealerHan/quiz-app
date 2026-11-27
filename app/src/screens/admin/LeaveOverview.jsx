// screens/admin/LeaveOverview.jsx
//
// 全组休假总览（2026-11-27 重建）
//
// 背景：这块界面原先存在过（老韩截图证明），但代码没进 git，
// 规范化部署时被覆盖了。现在按后端接口 + 老韩截图 + 后端注释里的设计要求重建。
//
// 后端接口（server/routes/leave.js）：
//   GET /api/leave/all?year=
//       → { year, rows: [{ staff_id, name, annual_total, annual_used, annual_left, detail:{年休:{total,used,left,upcoming,pending},...} }] }
//
//   GET /api/leave/staff/:id?year=
//       → { year, staff_id, name, is_cp, seq, lines:[{name,total,used,left,left_show,used_up,no_quota,over}],
//           gaps:[{leave_type,lack,total,used,kind}], leave_options:[...], records:[{id,leave_type,start_date,end_date,days,status,source,relief_note,cancel_reason,reject_reason,created_by,created_at}] }
//
// 设计要求（来自后端注释，是老韩当时提的）：
//   · 记录按日期倒序，最近的在上面
//   · 无记录的人弹窗显示「无相关记录」
//   · 下方要有差异标注 —— 车峰不计入在编 30 人的额度合计
//
// 数据口径（别搞混）：
//   已休 = status IN ('verified','locked','reported','released')
//   剩余 = 额度 - 已休，可为负（超支如实显示，不修正）
//   额度 0 → 显示「已用完」，不标警告

import { useState, useEffect } from "react";
import { apiJson } from "../../shared.jsx";

const fmt = (n) => {
  if (n === null || n === undefined) return "-";
  const v = Math.round(n * 10) / 10;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
};

/** 剩余天数颜色：>0 蓝 / 0 灰 / <0 红 */
const leftColor = (left) => {
  if (left > 0) return "var(--blue)";
  if (left < 0) return "#e8723c";
  return "var(--muted)";
};

const STATUS_LABEL = {
  verified: "已核实",
  locked: "已锁定",
  reported: "已报车场组",
  released: "已销假",
  submitted: "待审",
  cancel_pending: "撤销待批",
  rejected: "已驳回",
  cancelled: "已撤销",
  draft: "草稿",
};

/** 单人明细弹窗 */
function StaffDetailModal({ staffRow, year, hdrs, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    apiJson(`/api/leave/staff/${staffRow.staff_id}?year=${year}`, { headers: hdrs() })
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setData({ records: [], lines: [], gaps: [] }); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [staffRow.staff_id, year]);

  const records = data?.records || [];
  const lines = data?.lines || [];

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)",
        display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 440, background: "var(--card)",
          border: "1px solid var(--border)", borderRadius: "16px 16px 0 0",
          padding: "16px 16px 28px", maxHeight: "80vh", overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
              {staffRow.name}
              {data?.is_cp && (
                <span style={{
                  marginLeft: 6, fontSize: 9.5, padding: "1px 5px", borderRadius: 3,
                  background: "rgba(232,167,38,0.14)", border: "1px solid rgba(232,167,38,0.4)",
                  color: "#e8a726", fontWeight: 400,
                }}>车峰</span>
              )}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
              Y{staffRow.staff_id} · {year} 年
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none", border: "1px solid var(--border)", color: "var(--muted)",
              borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 12,
            }}
          >关闭</button>
        </div>

        {loading && (
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <div className="spinner" style={{ margin: "0 auto" }} />
          </div>
        )}

        {/* ── 各假别额度条 ── */}
        {!loading && lines.length > 0 && (
          <div style={{
            background: "var(--p-navy-16-a60)", border: "1px solid var(--border)",
            borderRadius: 9, padding: "9px 11px", marginBottom: 12,
          }}>
            {lines.map((l) => (
              <div key={l.name} style={{
                display: "flex", justifyContent: "space-between",
                fontSize: 12, padding: "3px 0",
              }}>
                <span style={{ color: "var(--muted)" }}>{l.name}</span>
                <span style={{ color: l.over ? "#e8723c" : "var(--text)" }}>
                  {fmt(l.used)} / {fmt(l.total)}
                  {l.total === 0 ? "（无额度）" : `　剩 ${fmt(l.left)}`}
                  {l.over && <span style={{ marginLeft: 4, fontSize: 10.5 }}>超支</span>}
                </span>
              </div>
            ))}
          </div>
        )}

        {!loading && records.length === 0 && (
          <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, padding: "28px 0" }}>
            无相关记录
          </div>
        )}

        {/* ── 休假记录（已由后端按日期倒序）── */}
        {!loading && records.map((r) => (
          <div
            key={r.id}
            style={{
              background: "var(--p-navy-16-a60)", border: "1px solid var(--border)",
              borderRadius: 10, padding: "10px 12px", marginBottom: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{
                fontSize: 10.5, padding: "1px 7px", borderRadius: 5,
                background: "rgba(91,155,250,0.16)", border: "1px solid rgba(91,155,250,0.4)",
                color: "#7ec8f0",
              }}>{r.leave_type}</span>
              {r.status && r.status !== "verified" && (
                <span style={{ fontSize: 10, color: "var(--muted)" }}>
                  {STATUS_LABEL[r.status] || r.status}
                </span>
              )}
              <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--muted)" }}>
                {r.start_date === r.end_date ? r.start_date : `${r.start_date} ~ ${r.end_date}`}
              </span>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text)" }}>
              扣 <b>{fmt(r.days)}</b> 天
              {r.created_by && (
                <span style={{ marginLeft: 8, fontSize: 10.5, color: "var(--muted)" }}>
                  {r.created_by}
                </span>
              )}
            </div>
            {r.relief_note && (
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, lineHeight: 1.6 }}>
                备注：{r.relief_note}
              </div>
            )}
            {r.cancel_reason && (
              <div style={{ fontSize: 11, color: "#e8a726", marginTop: 4 }}>
                撤销原因：{r.cancel_reason}
              </div>
            )}
            {r.reject_reason && (
              <div style={{ fontSize: 11, color: "#e8723c", marginTop: 4 }}>
                驳回原因：{r.reject_reason}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 全组休假总览
 *
 * props:
 *   hdrs          () => 管理员请求头
 *   members       人员列表（AdminScreen 已加载过，用来判断谁是非编车峰）
 *   defaultOpen   默认是否展开（默认折叠，老韩定的）
 */
export default function LeaveOverview({ hdrs, members = [], defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const [year, setYear] = useState(2026);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState(null);

  // 车峰 id 集合（非编人员，额度不计入在编合计）
  const cpIds = new Set(
    (members || []).filter((m) => m.is_cp === 1).map((m) => String(m.id))
  );

  useEffect(() => {
    if (!open) return;                  // 折叠着就不请求
    let alive = true;
    setLoading(true);
    apiJson(`/api/leave/all?year=${year}`, { headers: hdrs() })
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setData({ rows: [] }); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, year]);

  const rows = data?.rows || [];

  // 在编 vs 车峰分池统计（后端注释要求「放总览下方做差异标注」）
  const stat = rows.reduce(
    (a, r) => {
      const cp = cpIds.has(String(r.staff_id));
      const k = cp ? "cp" : "reg";
      a[k].total += r.annual_total || 0;
      a[k].used += r.annual_used || 0;
      a[k].left += r.annual_left || 0;
      a[k].n += 1;
      a.all.total += r.annual_total || 0;
      a.all.used += r.annual_used || 0;
      a.all.left += r.annual_left || 0;
      return a;
    },
    {
      reg: { total: 0, used: 0, left: 0, n: 0 },
      cp: { total: 0, used: 0, left: 0, n: 0 },
      all: { total: 0, used: 0, left: 0 },
    }
  );

  return (
    <div style={{
      background: "var(--card)", border: "1px solid var(--border)",
      borderRadius: 11, marginBottom: 12, overflow: "hidden",
    }}>
      {/* ── 标题行（整行可点，默认折叠）── */}
      <div
        onClick={() => setOpen(!open)}
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 13px", cursor: "pointer" }}
      >
        <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)" }}>全组休假总览</span>
        {!open && !loading && data && (
          <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
            {rows.length} 人 · 剩余 {fmt(stat.all.left)} 天
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
              <button
                key={y}
                onClick={() => setYear(y)}
                style={{
                  flex: 1, padding: "6px 0", borderRadius: 8, fontSize: 12, cursor: "pointer",
                  fontWeight: year === y ? 700 : 400,
                  background: year === y ? "rgba(91,155,250,0.18)" : "transparent",
                  border: `1px solid ${year === y ? "rgba(91,155,250,0.55)" : "var(--border)"}`,
                  color: year === y ? "var(--blue)" : "var(--muted)",
                }}
              >{y} 年</button>
            ))}
          </div>

          {loading && (
            <div style={{ textAlign: "center", padding: "20px 0" }}>
              <div className="spinner" style={{ margin: "0 auto" }} />
            </div>
          )}

          {!loading && data && (
            <>
              {/* ── 合计条 ── */}
              <div style={{
                background: "var(--p-navy-16-a60)", border: "1px solid var(--border)",
                borderRadius: 9, padding: "9px 11px", marginBottom: 10,
              }}>
                {[
                  ["总天数", stat.all.total, "var(--text)", true],
                  ["已休", stat.all.used, "var(--text)", false],
                  ["剩余", stat.all.left, leftColor(stat.all.left), true],
                ].map(([label, val, color, bold]) => (
                  <div key={label} style={{
                    display: "flex", justifyContent: "space-between",
                    fontSize: 12, marginTop: label === "总天数" ? 0 : 4,
                  }}>
                    <span style={{ color: "var(--muted)" }}>{label}</span>
                    <span style={{ color, fontWeight: bold ? 700 : 400 }}>{fmt(val)} 天</span>
                  </div>
                ))}
              </div>

              {/* ── 逐人列表 ── */}
              <div style={{
                fontSize: 10.5, color: "var(--muted)", display: "flex",
                padding: "0 2px 5px", borderBottom: "1px solid var(--border)", marginBottom: 2,
              }}>
                <span style={{ flex: 1 }}>姓名</span>
                <span style={{ width: 52, textAlign: "right" }}>已休</span>
                <span style={{ width: 56, textAlign: "right" }}>剩余</span>
              </div>

              {rows.map((r) => {
                const cp = cpIds.has(String(r.staff_id));
                return (
                  <div
                    key={r.staff_id}
                    onClick={() => setDetail(r)}
                    style={{
                      display: "flex", alignItems: "center", cursor: "pointer",
                      padding: "7px 2px", borderBottom: "1px solid var(--p-navy-22-a30)",
                    }}
                  >
                    <span style={{ flex: 1, fontSize: 12.5, color: "var(--text)" }}>
                      {r.name}
                      {cp && (
                        <span style={{
                          marginLeft: 5, fontSize: 9.5, padding: "0 4px", borderRadius: 3,
                          background: "rgba(232,167,38,0.14)", border: "1px solid rgba(232,167,38,0.4)",
                          color: "#e8a726",
                        }}>车峰</span>
                      )}
                    </span>
                    <span style={{ width: 52, textAlign: "right", fontSize: 12, color: "var(--muted)" }}>
                      {fmt(r.annual_used)}
                    </span>
                    <span style={{
                      width: 56, textAlign: "right", fontSize: 12.5, fontWeight: 700,
                      color: leftColor(r.annual_left),
                    }}>
                      {r.annual_total === 0 && r.annual_used === 0 ? "已用完" : fmt(r.annual_left)}
                    </span>
                  </div>
                );
              })}

              {/* ── 差异标注：在编 vs 车峰 ── */}
              {stat.cp.n > 0 && (
                <div style={{
                  marginTop: 10, padding: "8px 10px", borderRadius: 8,
                  background: "rgba(232,167,38,0.08)", border: "1px solid rgba(232,167,38,0.28)",
                  fontSize: 10.5, color: "var(--muted)", lineHeight: 1.75,
                }}>
                  <div>在编 {stat.reg.n} 人：额度 {fmt(stat.reg.total)} 天 · 已休 {fmt(stat.reg.used)} · 剩 {fmt(stat.reg.left)}</div>
                  <div>车峰 {stat.cp.n} 人：额度 {fmt(stat.cp.total)} 天 · 已休 {fmt(stat.cp.used)} · 剩 {fmt(stat.cp.left)}（不计入在编合计）</div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {detail && (
        <StaffDetailModal
          staffRow={detail}
          year={year}
          hdrs={hdrs}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}
