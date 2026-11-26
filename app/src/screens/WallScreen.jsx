// ─── 留言墙 ──────────────────────────────────────────────────────
// 老韩定：不审核、直接显示、后台能查；
//   卡片上显示最近三条留言；点进去看全部；右下角 ➕ 发留言（填名字 + 内容）
import { useState, useEffect } from "react";
import { apiJson } from "../shared.jsx";


function timeAgo(ts) {
  if (!ts) return '';
  const d = new Date(ts.replace(' ', 'T'));
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff/60)}分钟前`;
  if (diff < 86400) return `${Math.floor(diff/3600)}小时前`;
  if (diff < 86400*7) return `${Math.floor(diff/86400)}天前`;
  return ts.slice(5, 10);
}

// ── 卡片上用：最近三条 ──
export function WallCardBody({ refreshKey }) {
  const [posts, setPosts] = useState(null);
  useEffect(() => {
    apiJson('/api/wall/posts?limit=3')
      .then(d => setPosts(d?.posts || []))
      .catch(() => setPosts([]));
  }, [refreshKey]);

  if (posts === null) return <div style={{ fontSize: 10, color: 'var(--muted)' }}>加载中…</div>;
  if (posts.length === 0) return <div style={{ fontSize: 10, color: 'var(--muted)' }}>还没有人说话，来抢第一条</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, width: '100%' }}>
      {posts.map(p => {
        const text = (p.content || '').trim();
        const label = !text && p.image ? '发了一张图片' : text;
        return (
        <div key={p.id} style={{
          display: 'flex', gap: 3, alignItems: 'baseline',
          fontSize: 9.5, lineHeight: 1.3, minWidth: 0,
        }}>
          <span style={{
            color: '#7ec8f0', fontWeight: 700, flexShrink: 0, maxWidth: 48,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{p.nick}</span>
          <span style={{
            color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis',
            whiteSpace: 'nowrap', flex: 1, minWidth: 0,
          }}>{label}</span>
        </div>
        );
      })}
    </div>
  );
}

// ── 完整页面 ──
export default function WallScreen({ onBack, user }) {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [nick, setNick] = useState('');
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');
  const [file, setFile] = useState(null);          // 选中的图片 File
  const [filePreview, setFilePreview] = useState(null);  // objectURL
  const [preview, setPreview] = useState(null);    // 图片放大预览

  const load = () => {
    setLoading(true);
    apiJson('/api/wall/posts?limit=100')
      .then(d => setPosts(d?.posts || []))
      .catch(() => setPosts([]))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const submit = async () => {
    setErr('');
    if (!nick.trim()) { setErr('名字要填一个，随便叫什么都行'); return; }
    if (!content.trim() && !file) { setErr('写点内容或传张图'); return; }
    setSending(true);
    try {
      const sid = user?.staffId || user?.id;
      if (!sid) { setErr('登录状态失效，请回首页重新登录'); setSending(false); return; }
      const fd = new FormData();
      fd.append('nick', nick.trim());
      fd.append('content', content.trim());
      if (file) fd.append('image', file);
      const r = await apiJson('/api/wall/posts', {
        method: 'POST',
        headers: { 'x-staff-id': String(sid) },   // 不设 Content-Type，浏览器自带 boundary
        body: fd,
      });
      if (r?.error) { setErr(r.error); }
      else {
        setShowAdd(false); setContent(''); setNick(''); setFile(null); setFilePreview(null);
        setToast('发出去了');
        setTimeout(() => setToast(''), 1800);
        load();
      }
    } catch (e) { setErr(String(e)); }
    setSending(false);
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', paddingBottom: 80, position: 'relative' }}>
      {/* 顶栏 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '16px 16px 12px', position: 'sticky', top: 0,
        background: 'var(--bg)', zIndex: 10, borderBottom: '1px solid var(--border)',
      }}>
        <button onClick={onBack} style={{
          background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 9,
          padding: '5px 11px', fontSize: 12, color: 'var(--text)', cursor: 'pointer',
          fontFamily: 'var(--font)',
        }}>‹ 返回</button>
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>留言墙</span>
        <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>{posts.length} 条</span>
      </div>

      {/* 留言列表 */}
      <div style={{ padding: '10px 12px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px 0', fontSize: 12, color: 'var(--muted)' }}>加载中…</div>
        ) : posts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '50px 20px', fontSize: 12.5, color: 'var(--muted)' }}>
            还没有人留言<br />
            <span style={{ fontSize: 11, opacity: 0.7 }}>点右下角 ➕ 说第一句</span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {posts.map(p => (
              <div key={p.id} style={{
                background: 'var(--card)', border: '1px solid var(--border)',
                borderRadius: 13, padding: '11px 13px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 5 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: '#7ec8f0' }}>{p.nick}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 9.5, color: 'var(--muted)' }}>{timeAgo(p.created_at)}</span>
                </div>
                {p.content ? (
                  <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--text)', wordBreak: 'break-word' }}>
                    {p.content}
                  </div>
                ) : null}
                {p.image ? (
                  <img src={p.image} alt="留言图片"
                    onClick={() => setPreview(p.image)}
                    style={{
                      display: 'block', marginTop: p.content ? 8 : 0,
                      width: '100%', maxHeight: 260, objectFit: 'cover',
                      borderRadius: 9, border: '1px solid var(--border)', cursor: 'zoom-in',
                    }} />
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 右下角 ➕ */}
      <button onClick={() => setShowAdd(true)} style={{
        position: 'fixed', right: 18, bottom: 24,
        width: 52, height: 52, borderRadius: 26,
        background: 'linear-gradient(145deg, #4caf6e, #2f8f52)',
        border: '1px solid rgba(120,230,160,0.5)',
        boxShadow: '0 6px 20px rgba(76,175,110,0.45)',
        color: '#fff', fontSize: 25, lineHeight: 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', zIndex: 20,
        WebkitTapHighlightColor: 'transparent',
      }}>＋</button>

      {/* 发送成功提示 */}
      {toast ? (
        <div style={{
          position: 'fixed', left: '50%', bottom: 90, transform: 'translateX(-50%)',
          background: 'rgba(76,175,110,0.92)', color: '#fff', fontSize: 12,
          padding: '7px 16px', borderRadius: 20, zIndex: 30, whiteSpace: 'nowrap',
        }}>{toast}</div>
      ) : null}

      {/* 图片放大预览 */}
      {preview ? (
        <div onClick={() => setPreview(null)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 60, padding: 16, cursor: 'zoom-out',
        }}>
          <img src={preview} alt="预览" style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 8 }} />
        </div>
      ) : null}

      {/* 添加留言弹窗 */}
      {showAdd ? (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 20, zIndex: 40,
        }} onClick={() => !sending && setShowAdd(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            width: '100%', maxWidth: 360, background: 'var(--card)',
            border: '1px solid var(--border)', borderRadius: 17, padding: '18px 16px',
          }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text)', marginBottom: 3 }}>
              说点什么
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--muted)', marginBottom: 13 }}>
              随便叫什么都行，不记名
            </div>

            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>名字</div>
            <input
              value={nick}
              onChange={e => setNick(e.target.value)}
              placeholder="比如：张飞"
              maxLength={12}
              style={{
                width: '100%', boxSizing: 'border-box',
                background: 'var(--card-deep)', border: '1px solid var(--border)',
                borderRadius: 10, padding: '9px 11px', fontSize: 13,
                color: 'var(--text)', fontFamily: 'var(--font)', marginBottom: 11,
                outline: 'none',
              }}
            />

            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>内容</div>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="比如：今天想吃牛肉面"
              maxLength={200}
              rows={4}
              style={{
                width: '100%', boxSizing: 'border-box', resize: 'none',
                background: 'var(--card-deep)', border: '1px solid var(--border)',
                borderRadius: 10, padding: '9px 11px', fontSize: 13, lineHeight: 1.5,
                color: 'var(--text)', fontFamily: 'var(--font)',
                outline: 'none',
              }}
            />
            <div style={{ textAlign: 'right', fontSize: 9.5, color: 'var(--muted)', marginTop: 3 }}>
              {content.length}/200
            </div>

            {/* 图片选择 */}
            <div style={{ marginTop: 10 }}>
              <input id="wall-img-input" type="file" accept="image/*"
                onChange={e => {
                  const f = e.target.files && e.target.files[0];
                  if (!f) return;
                  if (f.size > 12 * 1024 * 1024) { setErr('图片太大，别超过 12MB'); return; }
                  setErr('');
                  setFile(f);
                  setFilePreview(URL.createObjectURL(f));
                }}
                style={{ display: 'none' }} />
              {filePreview ? (
                <div style={{ position: 'relative', display: 'inline-block' }}>
                  <img src={filePreview} alt="预览"
                    style={{ maxWidth: '100%', maxHeight: 130, borderRadius: 9, border: '1px solid var(--border)', display: 'block' }} />
                  <button onClick={() => { setFile(null); setFilePreview(null); }}
                    style={{
                      position: 'absolute', top: -6, right: -6, width: 20, height: 20,
                      borderRadius: 10, background: 'rgba(220,60,60,0.95)', border: 'none',
                      color: '#fff', fontSize: 12, lineHeight: 1, cursor: 'pointer',
                    }}>×</button>
                </div>
              ) : (
                <label htmlFor="wall-img-input" style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  padding: '10px 0', borderRadius: 10, cursor: 'pointer',
                  background: 'var(--card-deep)', border: '1px dashed var(--border)',
                  fontSize: 12, color: 'var(--muted)',
                }}>🖼 加一张图片（可选）</label>
              )}
            </div>

            {err ? (
              <div style={{ fontSize: 11, color: 'var(--p-red-60)', marginTop: 8 }}>{err}</div>
            ) : null}

            <div style={{ display: 'flex', gap: 9, marginTop: 14 }}>
              <button
                onClick={() => { setShowAdd(false); setErr(''); }}
                disabled={sending}
                style={{
                  flex: 1, padding: '10px 0', borderRadius: 11, fontSize: 13,
                  background: 'var(--card-deep)', border: '1px solid var(--border)',
                  color: 'var(--text)', cursor: 'pointer', fontFamily: 'var(--font)',
                }}>取消</button>
              <button
                onClick={submit}
                disabled={sending}
                style={{
                  flex: 1.4, padding: '10px 0', borderRadius: 11, fontSize: 13, fontWeight: 700,
                  background: sending ? 'rgba(76,175,110,0.4)' : 'linear-gradient(145deg, #4caf6e, #2f8f52)',
                  border: '1px solid rgba(120,230,160,0.45)',
                  color: '#fff', cursor: sending ? 'default' : 'pointer', fontFamily: 'var(--font)',
                }}>{sending ? '发送中…' : '发出去'}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
