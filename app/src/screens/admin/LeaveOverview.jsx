// screens/admin/LeaveOverview.jsx
//
// 全组休假总览
//
// ══════════════════════════════════════════════════════════════════
// 这块界面 2026-11-26 做过，但代码没进 git，11-27 规范化部署时被覆盖丢失。
// 本文件严格照《leave-overview-SPEC.md》复原，那份文档是从
// 11-26~11-27 聊天记录原文 + server/routes/leave.js 注释里逐条抠出来的。
//
// 接口：GET /api/leave/overview?year=2026   ← 必须用这个
//   不是 /api/leave/all。overview 的剩余是「各假别正剩余相加」
//   （leave.js 2308-2311 行注释：超支不连累其他假别），all 是错的口径。
//
// 老韩原话对照：
//   11-26 15:53  可视化全组休假预览，在编30人总额 + 每个人休假情况
//   11-26 16:05  默认折叠，平时不看，处理审批为主
//   11-26 16:22  车峰加到总览下方做差异标注
//   11-26 16:42  休超了也正常显示，需要数据真实记录
//   11-26 17:10  加切换年份按钮 / 总人数还是41 / 名字前面加序号
//   11-26 17:29  就车峰就行不用编外 / 序号顶头不动
//   11-26 17:34  序号我要的是 1,2,3,4 一直固定   ← 行号，不是身份编号
//   11-27 09:26  顶部只要 假期总额/已休/剩余；个人类目详细一点；
//                艾凌风还有育儿假不能算已休完；列表按每个人假期总额来
//   11-27 09:37  序号 1,2,3,4 固定，不因假期多少变化
//   11-26 17:47  点某人弹窗显示休假记录，时间线倒序，无记录的显示
//                「无相关记录」+ 补录按钮，休超的加备注按钮
// ══════════════════════════════════════════════════════════════════

import { useState, useEffect } from "react";
import { apiJson } from "../../shared.jsx";

const fmt = (n) => {
  if (n === null || n === undefined) return "-";
  const v = Math.round(n * 10) / 10;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
};

// 进度条配色：蓝=休得少 / 橙=休过半 / 红=用完或超出
const barColor = (used, total) => {
  if (total <= 0) return "#e8723c";
  const r = used / total;
  if (r >= 1) return "#e8723c";
  if (r > 0.5) return "#e8a726";
  return "#6ba5fb";
};

const STATUS_LABEL = {
  verified: "已核对", locked: "已锁定", reported: "已报车场组",
  released: "已销假", submitted: "待审批", cancel_pending: "撤销待批",
  rejected: "已驳回", cancelled: "已撤销", draft: "草稿",
};

const SOURCE_LABEL = { workshop: "车间表", supplement: "补录", app: "本人申报", edge_test: "测试" };

/** 单假别显示文字（超支带括号、额度0显示已用完，全按 SPEC 口径） */
function typeText(t) {
  if (t.total === 0 && t.used > 0) return `已休${fmt(t.used)} 已用完`;
  if (t.total > 0 && t.used > t.total) return `${fmt(t.used)}/${fmt(t.total)}（超${fmt(t.used - t.total)}）`;
  return `${fmt(t.used)}/${fmt(t.total)}`;
}

// ══════════════════════════════════════════════════════════════════
// 单人弹窗：各假别额度 + 休假记录时间线 + 备注/补录
// ══════════════════════════════════════════════════════════════════
function StaffDetailModal({ person, year, hdrs, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [noteFor, setNoteFor] = useState(null);   // 正在编辑备注的记录 id
  const [noteText, setNoteText] = useState("");
  const [adding, setAdding] = useState(false);    // 补录表单
  const [form, setForm] = useState({ leave_type: "年休", start_date: "", end_date: "", days: "1", note: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = () => {
    setLoading(true);
    apiJson(`/api/leave/staff/${person.staff_id}?year=${year}`, { headers: hdrs() })
      .then(setData)
      .catch(() => setData({ records: [], lines: [] }))
      .finally(() => setLoading(false));
  };
  useEffect(load, [person.staff_id, year]);

  const records = data?.records || [];
  const lines = data?.lines || [];

  const saveNote = async (recId) => {
    setBusy(true); setErr("");
    try {
      await apiJson(`/api/leave/${recId}/note`, {
        method: "PATCH",
        headers: { ...hdrs(), "Content-Type": "application/json" },
        body: JSON.stringify({ note: noteText }),
      });
      setNoteFor(null); setNoteText(""); load(); onChanged?.();
    } catch (e) { setErr(String(e.message || e)); }
    finally { setBusy(false); }
  };

  const submitAdd = async () => {
    if (!form.start_date) { setErr("请填开始日期"); return; }
    setBusy(true); setErr("");
    try {
      await apiJson("/api/leave/supplement", {
        method: "POST",
        headers: { ...hdrs(), "Content-Type": "application/json" },
        body: JSON.stringify({
          staff_id: person.staff_id,
          leave_type: form.leave_type,
          start_date: form.start_date,
          end_date: form.end_date || form.start_date,
          days: Number(form.days),
          note: form.note,
        }),
      });
      setAdding(false);
      setForm({ leave_type: "年休", start_date: "", end_date: "", days: "1", note: "" });
      load(); onChanged?.();
    } catch (e) { setErr(String(e.message || e)); }
    finally { setBusy(false); }
  };

  const inputStyle = {
    width: "100%", background: "var(--p-navy-16-a60)", border: "1px solid var(--border)",
    borderRadius: 7, padding: "7px 9px", color: "var(--text)", fontSize: 12,
    outline: "none", boxSizing: "border-box",
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.68)",
      display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 100,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "100%", maxWidth: 460, background: "var(--card)",
        border: "1px solid var(--border)", borderRadius: "16px 16px 0 0",
        padding: "15px 15px 26px", maxHeight: "84vh", overflowY: "auto",
      }}>
        {/* 头部 */}
        <div style={{ display: "flex", alignItems: "flex-start", marginBottom: 11 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
              {person.name}
              {person.is_cp ? <span style={{
                marginLeft: 6, fontSize: 9.5, padding: "1px 5px", borderRadius: 3,
                background: "rgba(232,167,38,0.14)", border: "1px solid rgba(232,167,38,0.4)",
                color: "#e8a726", fontWeight: 400,
              }}>车峰</span> : null}
            </div>
            <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 3 }}>
              {year} 年 · {records.length} 条记录
            </div>
          </div>
          <button onClick={onClose} style={{
            background: "none", border: "1px solid var(--border)", color: "var(--muted)",
            borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 12,
          }}>✕</button>
        </div>

        {loading && <div style={{ textAlign: "center", padding: "22px 0" }}>
          <div className="spinner" style={{ margin: "0 auto" }} />
        </div>}

        {/* 各假别额度 */}
        {!loading && lines.length > 0 && (
          <div style={{
            display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12,
          }}>
            {lines.map((l) => {
              const over = l.total > 0 && l.used > l.total;
              return (
                <span key={l.name} style={{
                  fontSize: 11, padding: "3px 9px", borderRadius: 6,
                  background: "var(--p-navy-16-a60)",
                  border: `1px solid ${over ? "rgba(232,114,60,0.5)" : "var(--border)"}`,
                  color: over ? "#e8723c" : "var(--text)",
                }}>{l.name} {typeText(l)}</span>
              );
            })}
          </div>
        )}

        {/* 无记录 */}
        {!loading && records.length === 0 && (
          <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 12.5, padding: "22px 0 18px" }}>
            无相关记录
          </div>
        )}

        {/* 记录时间线（后端已按 start_date 倒序） */}
        {!loading && records.map((r) => {
          const voided = r.status === "cancelled" || r.status === "rejected";
          const dateStr = r.start_date === r.end_date ? r.start_date : `${r.start_date} ~ ${r.end_date}`;
          return (
            <div key={r.id} style={{
              background: "var(--p-navy-16-a60)", border: "1px solid var(--border)",
              borderRadius: 10, padding: "9px 11px", marginBottom: 7,
              opacity: voided ? 0.5 : 1,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                <span style={{
                  fontSize: 10, padding: "1px 6px", borderRadius: 4,
                  background: "rgba(91,155,250,0.16)", border: "1px solid rgba(91,155,250,0.4)",
                  color: "#7ec8f0",
                }}>{r.leave_type}</span>
                <span style={{ fontSize: 10, color: "var(--muted)" }}>
                  {STATUS_LABEL[r.status] || r.status}
                </span>
                {r.source && (
                  <span style={{
                    fontSize: 9.5, padding: "0 4px", borderRadius: 3,
                    background: r.source === "supplement" ? "rgba(232,167,38,0.14)" : "transparent",
                    border: `1px solid ${r.source === "supplement" ? "rgba(232,167,38,0.4)" : "var(--border)"}`,
                    color: r.source === "supplement" ? "#e8a726" : "var(--muted)",
                  }}>{SOURCE_LABEL[r.source] || r.source}</span>
                )}
                <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--muted)" }}>{dateStr}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", minWidth: 34, textAlign: "right" }}>
                  {fmt(r.days)}天
                </span>
              </div>

              {/* 备注 */}
              {r.relief_note && noteFor !== r.id && (
                <div style={{
                  fontSize: 10.5, color: "var(--muted)", lineHeight: 1.6, marginTop: 4,
                  paddingLeft: 8, borderLeft: "2px solid var(--border)",
                }}>{r.relief_note}</div>
              )}

              {/* 备注编辑 */}
              {noteFor === r.id ? (
                <div style={{ marginTop: 6 }}>
                  <textarea
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    rows={2}
                    placeholder="写备注（车间表漏记 / 休超说明 等）"
                    style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
                  />
                  <div style={{ display: "flex", gap: 6, marginTop: 5 }}>
                    <button disabled={busy} onClick={() => { setNoteFor(null); setNoteText(""); }} style={{
                      flex: 1, padding: "5px 0", borderRadius: 6, fontSize: 11.5, cursor: "pointer",
                      background: "transparent", border: "1px solid var(--border)", color: "var(--muted)",
                    }}>取消</button>
                    <button disabled={busy} onClick={() => saveNote(r.id)} style={{
                      flex: 1, padding: "5px 0", borderRadius: 6, fontSize: 11.5, cursor: "pointer",
                      background: "rgba(91,155,250,0.2)", border: "1px solid rgba(91,155,250,0.55)",
                      color: "var(--blue)",
                    }}>{busy ? "保存中" : "保存"}</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 3 }}>
                  <button onClick={() => { setNoteFor(r.id); setNoteText(r.relief_note || ""); }} style={{
                    background: "none", border: "none", cursor: "pointer",
                    fontSize: 10.5, color: "var(--blue)", padding: "2px 0",
                  }}>{r.relief_note ? "改备注" : "＋备注"}</button>
                </div>
              )}
            </div>
          );
        })}

        {err && <div style={{ fontSize: 11, color: "#e8723c", marginTop: 6 }}>{err}</div>}

        {/* 补录表单 */}
        {adding ? (
          <div style={{
            marginTop: 10, padding: "11px", borderRadius: 10,
            background: "var(--p-navy-16-a60)", border: "1px solid var(--border)",
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>
              补录一条休假记录
            </div>
            {[
              ["假别", "leave_type", "select"],
              ["开始日期", "start_date", "date"],
              ["结束日期（留空=同开始）", "end_date", "date"],
              ["扣假天数", "days", "number"],
              ["备注", "note", "text"],
            ].map(([label, key, type]) => (
              <div key={key} style={{ marginBottom: 7 }}>
                <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 3 }}>{label}</div>
                {type === "select" ? (
                  <select
                    value={form[key]}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                    style={inputStyle}
                  >
                    {/* 补录要能选全部假别：不能用后端返回的 leave_options
                        （那个是按这个人已有记录动态生成的，曹枝满只有年休
                          就会只列出年休+病假/事假/丧假，选不到婚假/陪产假/育儿假） */}
                    {["年休", "婚假", "陪产假", "育儿假", "病假", "事假", "丧假"].map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={type}
                    step={type === "number" ? "0.5" : undefined}
                    value={form[key]}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                    style={inputStyle}
                  />
                )}
              </div>
            ))}
            <div style={{ display: "flex", gap: 6, marginTop: 9 }}>
              <button disabled={busy} onClick={() => setAdding(false)} style={{
                flex: 1, padding: "7px 0", borderRadius: 7, fontSize: 12, cursor: "pointer",
                background: "transparent", border: "1px solid var(--border)", color: "var(--muted)",
              }}>取消</button>
              <button disabled={busy} onClick={submitAdd} style={{
                flex: 1, padding: "7px 0", borderRadius: 7, fontSize: 12, cursor: "pointer",
                background: "rgba(91,155,250,0.2)", border: "1px solid rgba(91,155,250,0.55)",
                color: "var(--blue)",
              }}>{busy ? "提交中" : "确认补录"}</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} style={{
            width: "100%", marginTop: 10, padding: "8px 0", borderRadius: 9, fontSize: 12,
            cursor: "pointer", background: "transparent",
            border: "1px dashed var(--border)", color: "var(--muted)",
          }}>＋ 补录一条</button>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// 在编人员一行：序号(行号) 姓名 角色 合计 进度条 假别明细
// ══════════════════════════════════════════════════════════════════
function PersonRow({ p, idx, onOpen }) {
  const pct = p.total > 0 ? Math.min(100, (p.used / p.total) * 100) : 100;
  const color = barColor(p.used, p.total);
  const over = p.used > p.total;
  const usedUp = p.total > 0 && p.left === 0;

  return (
    <div onClick={onOpen} style={{
      display: "flex", gap: 8, alignItems: "flex-start",
      padding: "9px 2px", borderBottom: "1px solid var(--p-navy-22-a30)", cursor: "pointer",
    }}>
      {/* 序号 = 行号，第一行永远 1 */}
      <div style={{
        minWidth: 22, height: 22, borderRadius: 5, flexShrink: 0, marginTop: 1,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "var(--p-navy-22-a60)", border: "1px solid var(--border)",
        fontSize: 10.5, color: "var(--muted)", fontWeight: 600,
      }}>{idx + 1}</div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 5, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, color: "var(--text)", fontWeight: 600 }}>{p.name}</span>
          {p.is_leader && <span style={{
            fontSize: 9, padding: "0 4px", borderRadius: 3,
            background: "rgba(169,146,247,0.16)", border: "1px solid rgba(169,146,247,0.4)",
            color: "#a992f7",
          }}>组长</span>}
          {p.is_instructor && <span style={{
            fontSize: 9, padding: "0 4px", borderRadius: 3,
            background: "rgba(92,194,124,0.14)", border: "1px solid rgba(92,194,124,0.4)",
            color: "#5cc27c",
          }}>教员</span>}
          {p.pending > 0 && <span style={{ fontSize: 9.5, color: "#e8a726" }}>待批{fmt(p.pending)}天</span>}
          <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--text)", whiteSpace: "nowrap" }}>
            {fmt(p.used)} / {fmt(p.total)}
            <span style={{ color, fontWeight: 700, marginLeft: 6 }}>
              {over ? `超${fmt(p.used - p.total)}` : usedUp ? "已用完" : `剩 ${fmt(p.left)}`}
            </span>
          </span>
        </div>

        <div style={{ height: 4, background: "var(--p-navy-22-a60)", borderRadius: 2, overflow: "hidden", marginBottom: 5 }}>
          <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2 }} />
        </div>

        {p.by_type?.length > 0 && (
          <div style={{ fontSize: 10, color: "var(--muted)", lineHeight: 1.7 }}>
            {p.by_type.map((t, i) => (
              <span key={t.name} style={{ color: t.over ? "#e8723c" : "var(--muted)" }}>
                {i > 0 && <span style={{ margin: "0 6px", opacity: 0.4 }}>·</span>}
                {t.name} {typeText(t)}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** 车峰一行：灰色小字单行，不展开明细 */
function CpRow({ p, idx }) {
  const over = p.used > p.total;
  const usedUp = p.total > 0 && p.left === 0;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 7,
      padding: "4px 2px", fontSize: 10.5, color: "var(--muted)", lineHeight: 1.6,
    }}>
      <span style={{ minWidth: 16, opacity: 0.65 }}>{idx + 1}</span>
      <span>{p.name}</span>
      <span style={{ marginLeft: "auto", color: over ? "#e8723c" : "var(--muted)" }}>
        {p.total === 0 && p.used > 0
          ? `已休${fmt(p.used)}`
          : `${fmt(p.used)}/${fmt(p.total)}`}
        {over ? `（超${fmt(p.used - p.total)}）` : usedUp ? " 已用完" : ""}
      </span>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// 主组件
// ══════════════════════════════════════════════════════════════════
export default function LeaveOverview({ hdrs }) {
  const [open, setOpen] = useState(false);       // 11-26 16:05 默认折叠
  const [year, setYear] = useState(2026);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState(null);
  const [sortBy, setSortBy] = useState("left");  // left=剩余从多到少 / used=已休从少到多

  const load = () => {
    setLoading(true);
    apiJson(`/api/leave/overview?year=${year}`, { headers: hdrs() })
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => { if (open) load(); }, [open, year]);

  const people = data?.people || [];
  const cpPeople = data?.cp_people || [];
  const sum = data?.summary || { total: 0, used: 0, left: 0 };

  // 排序（11-27：剩余从多到少 / 已休从少到多）
  const sorted = sortBy === "left"
    ? [...people].sort((a, b) => b.left - a.left)
    : [...people].sort((a, b) => a.used - b.used);
  const sortedCp = [...cpPeople].sort((a, b) => (a.seq ?? 999) - (b.seq ?? 999));

  const years = data?.available_years || [2026, 2027];

  return (
    <div style={{
      background: "var(--card)", border: "1px solid var(--border)",
      borderRadius: 11, marginBottom: 12, overflow: "hidden",
    }}>
      {/* 标题栏 */}
      <div onClick={() => setOpen(!open)} style={{
        display: "flex", alignItems: "center", gap: 8, padding: "11px 13px", cursor: "pointer",
      }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)" }}>全组休假总览</span>
        {!open && data && (
          <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
            {data.headcount}人 · 剩 {fmt(sum.left)} / {fmt(sum.total)}天
          </span>
        )}
        <span style={{
          marginLeft: "auto", fontSize: 11, color: "var(--muted)",
          transform: open ? "rotate(180deg)" : "none", transition: "transform .2s",
        }}>▼</span>
      </div>

      {open && (
        <div style={{ padding: "0 13px 13px" }}>
          {/* 年份切换 */}
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            {years.map((y) => (
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
              {/* 顶部汇总 —— 只三列 */}
              <div style={{
                background: "var(--p-navy-16-a60)", border: "1px solid var(--border)",
                borderRadius: 9, padding: "10px 11px", marginBottom: 10,
              }}>
                <div style={{
                  display: "flex", justifyContent: "space-between",
                  fontSize: 10.5, color: "var(--muted)", marginBottom: 8,
                }}>
                  <span>在编 {data.headcount} 人合计</span>
                  <span>全组 {data.headcount + data.cp_excluded} 人（在编 {data.headcount} + 车峰 {data.cp_excluded}）</span>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  {[
                    ["假期总额", sum.total, "var(--text)"],
                    ["已休", sum.used, "var(--text)"],
                    ["剩余", sum.left, sum.left < 0 ? "#e8723c" : "var(--blue)"],
                  ].map(([k, v, c]) => (
                    <div key={k} style={{ flex: 1, textAlign: "center" }}>
                      <div style={{ fontSize: 17, fontWeight: 700, color: c }}>{fmt(v)}</div>
                      <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>{k}</div>
                    </div>
                  ))}
                </div>
                {sum.pending > 0 && (
                  <div style={{ fontSize: 10, color: "#e8a726", textAlign: "center", marginTop: 6 }}>
                    另有 {fmt(sum.pending)} 天待批
                  </div>
                )}
              </div>

              {/* 排序切换 */}
              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                {[["left", "剩余从多到少"], ["used", "已休从少到多"]].map(([k, label]) => (
                  <button key={k} onClick={() => setSortBy(k)} style={{
                    flex: 1, padding: "4px 0", borderRadius: 6, fontSize: 10.5, cursor: "pointer",
                    background: sortBy === k ? "rgba(91,155,250,0.14)" : "transparent",
                    border: `1px solid ${sortBy === k ? "rgba(91,155,250,0.45)" : "var(--border)"}`,
                    color: sortBy === k ? "var(--blue)" : "var(--muted)",
                  }}>{label}</button>
                ))}
              </div>

              {/* 在编人员 */}
              {sorted.map((p, idx) => (
                <PersonRow key={p.staff_id} p={p} idx={idx} onOpen={() => setDetail(p)} />
              ))}

              {/* 车峰区 */}
              {sortedCp.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{
                    fontSize: 10, color: "#e8a726", opacity: 0.9, lineHeight: 1.7,
                    padding: "7px 0 4px", borderTop: "1px dashed var(--border)",
                  }}>
                    以下 {sortedCp.length} 人为车峰（临时调整跑车方式，保留组籍）<br />
                    不计入上方在编 {data.headcount} 人合计，仅作差异标注
                  </div>
                  {sortedCp.map((p, idx) => (
                    <div key={p.staff_id} onClick={() => setDetail({ ...p, is_cp: true })}
                         style={{ cursor: "pointer" }}>
                      <CpRow p={p} idx={idx} />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {detail && (
        <StaffDetailModal
          person={detail}
          year={year}
          hdrs={hdrs}
          onClose={() => setDetail(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}
