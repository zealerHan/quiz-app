// screens/admin/QuestionBankParts.jsx
//
// 题库 tab 的全部子组件（从 AdminScreen.jsx 抽出，2026-11-27）
//
// 为什么拆：AdminScreen.jsx 原 3,572 行，光这几个组件就 959 行。
// 它们已经是自包含的独立组件（状态在内部、数据走 props），
// 所以这次只是「搬家」，逻辑一行没改。
//
// 依赖关系：
//   BankTypeSelect      被 ManualEntryForm / ExcelImportForm 用
//   GroupedBankSelect   嵌在 AddQuestionPanel 内部
//
// 改这些组件时注意：它们拿到的 pwd / hdrs 是父组件传进来的，
// 自己不发请求鉴权头，别在这里另起一套。

import { useState, useEffect, useRef } from "react";
import { api, adminHeaders } from "../../shared.jsx";
import { BANK_TYPES, BANK_TYPE_MAP, groupBanksByType } from "./bankConstants.js";

export function BankTypeSelect({ banks, bankId, setBankId, newBankName, setNewBankName, newBankType, setNewBankType }) {
  const groups = groupBanksByType(banks);

  // 从当前 bankId / newBankType 推断初始分类
  const initCat = () => {
    if (bankId) { const b = banks.find(x => String(x.id) === String(bankId)); return b?.bank_type || null; }
    if (newBankName?.trim()) return newBankType || 'essential';
    return null;
  };
  const [selCat, setSelCat] = useState(initCat);
  const [showNew, setShowNew] = useState(false);

  const banksInCat = selCat ? (groups[selCat] || []) : [];

  const pickCat = (key) => {
    setSelCat(key); setShowNew(false);
    setBankId(''); setNewBankName?.(''); setNewBankType?.(key);
  };

  const chip = (active) => ({
    padding:'5px 10px', borderRadius:6, fontFamily:'inherit', cursor:'pointer', fontSize:11,
    border:`1px solid ${active?'var(--blue)':'var(--border)'}`,
    background: active?'var(--p-blue-60-a15)':'none',
    color: active?'var(--p-blue-68)':'var(--muted)',
  });

  return (
    <div style={{display:'flex',flexDirection:'column',gap:8}}>
      {/* Step 1: 5 类卡片 */}
      <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
        {BANK_TYPES.map(t => {
          const active = selCat === t.key;
          return (
            <button key={t.key} onClick={()=>pickCat(t.key)}
              style={{flex:1,minWidth:54,padding:'7px 2px',borderRadius:7,border:`2px solid ${active?t.color:'var(--border)'}`,
                background:active?`${t.color}22`:'var(--p-navy-07-a40)',color:active?t.color:'var(--muted)',
                cursor:'pointer',textAlign:'center',lineHeight:1.3,fontFamily:'inherit'}}>
              <div style={{fontSize:14}}>{t.icon}</div>
              <div style={{fontSize:11,marginTop:1}}>{t.label}</div>
            </button>
          );
        })}
      </div>

      {/* Step 2: 该类下的题库 chip + 新建 */}
      {selCat && (
        <div style={{display:'flex',gap:5,flexWrap:'wrap',alignItems:'center'}}>
          {banksInCat.map(b => (
            <button key={b.id}
              onClick={()=>{ setBankId(String(b.id)); setNewBankName?.(''); setShowNew(false); }}
              style={chip(String(bankId)===String(b.id))}>
              {b.name}
            </button>
          ))}
          {setNewBankName && (
            <button onClick={()=>{ setShowNew(true); setBankId(''); setNewBankName?.(''); }}
              style={chip(showNew||!!newBankName?.trim())}>
              ＋ 新建
            </button>
          )}
        </div>
      )}

      {/* 新建题库名称输入 */}
      {showNew && setNewBankName && (
        <input autoFocus value={newBankName}
          onChange={e=>{ setNewBankName(e.target.value); setBankId(''); setNewBankType?.(selCat); }}
          placeholder={`新题库名称（将归入 ${BANK_TYPE_MAP[selCat]?.label}）`}
          style={{width:'100%',padding:'7px 10px',borderRadius:7,border:'1px solid var(--blue)',
            background:'var(--p-navy-07)',color:'var(--text)',fontSize:12,boxSizing:'border-box',fontFamily:'inherit'}}/>
      )}
    </div>
  );
}

// ─── MembersTab Component ─────────────────────────────────────────────────

export function AddQuestionPanel({ pwd, banks, hdrs, onDone }) {
  // Section 1: AI 辅助出题
  const [srcFile, setSrcFile] = useState(null);
  const [pasteText, setPasteText] = useState('');
  const [splitMode, setSplitMode] = useState(true); // 智能分块出题（默认开：长材料一步到位，管理员无需理解问题模板）
  const [aiOutline, setAiOutline] = useState(null); // 分块识别到的条目清单（用于结果摘要展示）
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
    const sel = { padding:'6px 8px', borderRadius:6, border:'1px solid var(--border)', background:'var(--p-navy-07)', color:'var(--text)', fontSize:12, flex:1, minWidth:0 };
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
    if (!splitMode && allQuestions.length === 0) { setAiMsg('❌ 请至少选择一个问题模板或输入自定义题目'); return; }
    if (!srcFile && !pasteText.trim()) { setAiMsg('❌ 请上传文件或粘贴内容'); return; }
    setAiParsing(true); setAiMsg(''); setParsedQs([]); setCheckedQs([]); setAiOutline(null);
    const fd = new FormData();
    if (splitMode) {
      fd.append('mode', 'split');   // 智能分块：AI 先识别文档结构，再逐条出题
    } else {
      fd.append('mode', 'custom');
      fd.append('custom_questions', JSON.stringify(allQuestions));
    }
    if (srcFile) fd.append('file', srcFile);
    else fd.append('paste_text', pasteText.trim());
    try {
      const r = await fetch('/api/admin/banks/parse-doc', { method:'POST', headers:{'x-admin-password':pwd}, body:fd });
      const d = await r.json();
      if (!d.ok) { setAiMsg('❌ ' + (d.error||'解析失败')); }
      else {
        setParsedQs(d.questions||[]);
        setCheckedQs((d.questions||[]).map((_,i)=>i));
        setAiOutline(d.outline||null);
        // 未选已有题库时，用材料文件名自动预填题库名，管理员不必自己想
        const base = srcFile ? srcFile.name.replace(/\.[^.]+$/, '') : '';
        if (!aiBank && !aiNewBank.trim() && base) setAiNewBank(base);
      }
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


  const inp = { background:'var(--p-navy-07)', border:'1px solid var(--border)', color:'var(--text)', borderRadius:6, padding:'7px 10px', fontSize:12, width:'100%', boxSizing:'border-box', fontFamily:'inherit' };
  const divider = <div style={{borderTop:'1px solid var(--border)',margin:'14px 0'}}/>;
  const sectionLabel = (icon, text) => <div style={{fontSize:11,color:'var(--muted)',fontWeight:700,letterSpacing:0.5,marginBottom:8}}>{icon} {text}</div>;

  return (
    <div style={{marginTop:10,padding:'14px',border:'1px solid var(--border)',borderRadius:8,background:'var(--p-navy-07-a60)'}}>

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
          <label style={{display:'flex',flexDirection:'column',alignItems:'center',gap:4,padding:'8px 10px',border:'1px dashed var(--border)',borderRadius:6,cursor:'pointer',background:srcFile?'var(--p-blue-60-a10)':'transparent',minWidth:72}}>
            <input ref={s1Ref} type="file" accept=".docx,.pdf,.jpg,.jpeg,.png,.gif,.webp" style={{display:'none'}} onChange={e=>{const f=e.target.files?.[0];if(f){setSrcFile(f);setPasteText('');}e.target.value='';}}/>
            <span style={{fontSize:18}}>{srcFile?'📄':'📁'}</span>
            <span style={{fontSize:11,color:srcFile?'var(--p-blue-68)':'var(--muted)',textAlign:'center',lineHeight:1.2}}>{srcFile?srcFile.name.slice(0,12)+(srcFile.name.length>12?'…':''):'上传文件'}</span>
          </label>
          {srcFile&&<button onClick={()=>setSrcFile(null)} style={{fontSize:11,color:'var(--muted)',background:'none',border:'none',cursor:'pointer',padding:0}}>✕ 清除</button>}
        </div>
      </div>

      {/* 智能分块开关 */}
      <label style={{display:'flex',alignItems:'flex-start',gap:8,marginBottom:10,padding:'8px 10px',borderRadius:6,border:`1px solid ${splitMode?'var(--blue)':'var(--border)'}`,background:splitMode?'var(--p-blue-60-a08)':'transparent',cursor:'pointer'}}>
        <input type="checkbox" checked={splitMode} onChange={e=>setSplitMode(e.target.checked)} style={{marginTop:3,accentColor:'var(--blue)',flexShrink:0}}/>
        <div style={{flex:1}}>
          <div style={{fontSize:12,color:'var(--text)',fontWeight:600}}>🧩 智能分块出题（长材料 / 多事件）</div>
          <div style={{fontSize:11,color:'var(--muted)',marginTop:3,lineHeight:1.45}}>
            先让 AI 读懂文档里有几个独立事件/条目，再逐条出题（事件类自动出「经过 / 问题 / 整改」三题）。
            适合月度学习材料、多起事件通报。打开后无需选择下面的问题模板。
          </div>
        </div>
      </label>

      {/* 问题模板（仅在关闭“智能分块”时需要，默认隐藏以减少困惑）*/}
      {!splitMode && (<div style={{marginBottom:8}}>
        <div style={{fontSize:11,color:'var(--muted)',marginBottom:6}}>选择要提问的方向：</div>
        <div style={{display:'flex',flexDirection:'column',gap:5}}>
          {TEMPLATES.map((t,i)=>(
            <label key={i} style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer'}}>
              <div onClick={()=>setTplSelected(prev=>prev.includes(i)?prev.filter(x=>x!==i):[...prev,i])}
                style={{width:15,height:15,borderRadius:3,border:`2px solid ${tplSelected.includes(i)?'var(--blue)':'var(--p-blue-27)'}`,background:tplSelected.includes(i)?'var(--blue)':'none',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center'}}>
                {tplSelected.includes(i)&&<span style={{color:'var(--text)',fontSize:11,lineHeight:1}}>✓</span>}
              </div>
              <span style={{fontSize:12,color:tplSelected.includes(i)?'var(--text)':'var(--muted)'}}>{t}</span>
            </label>
          ))}
        </div>
        <textarea value={customTplText} onChange={e=>setCustomTplText(e.target.value)}
          placeholder="自定义题目（每行一个，AI 将从内容中提取对应答案）"
          rows={2} style={{...inp,marginTop:8,resize:'vertical'}}/>
      </div>)}

      {/* AI 识别按钮 */}
      <button onClick={doAiParse} disabled={aiParsing}
        style={{width:'100%',padding:'9px',background:'linear-gradient(135deg,var(--p-navy-25),var(--blue))',border:'none',borderRadius:7,color:'var(--text)',fontSize:13,fontWeight:600,cursor:'pointer',opacity:aiParsing?0.6:1,marginBottom:8}}>
        {aiParsing?'AI 识别中，请稍候…':'🤖 AI 识别并生成答案'}
      </button>

      {/* AI 结果预览 */}
      {parsedQs.length>0&&(
        <div>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
            <span style={{fontSize:11,color:'var(--muted)'}}>识别结果（{parsedQs.length} 题，已选 {checkedQs.length}）</span>
            <div style={{display:'flex',gap:5}}>
              <button onClick={()=>setCheckedQs(parsedQs.map((_,i)=>i))} style={{fontSize:11,padding:'2px 7px',borderRadius:4,border:'1px solid var(--border)',background:'var(--input-bg)',color:'var(--muted)',cursor:'pointer'}}>全选</button>
              <button onClick={()=>setCheckedQs([])} style={{fontSize:11,padding:'2px 7px',borderRadius:4,border:'1px solid var(--border)',background:'var(--input-bg)',color:'var(--muted)',cursor:'pointer'}}>取消</button>
            </div>
          </div>
          {aiOutline && aiOutline.length>0 && (
            <div style={{fontSize:11,color:'var(--p-blue-68)',marginBottom:8,lineHeight:1.5,padding:'6px 8px',borderRadius:5,background:'var(--p-blue-60-a08)'}}>
              🧩 已识别 {aiOutline.length} 个独立条目：{aiOutline.map(o=>o.name).join('、')}
            </div>
          )}
          <div style={{maxHeight:320,overflowY:'auto',marginBottom:8}}>
            {parsedQs.map((q,i)=>{
              const isExp = expandedQsIdx === i;
              const normCat = STANDARD_CATS.includes(q.category) ? q.category : '业务知识';
              const showGroup = q.group && (i===0 || parsedQs[i-1].group !== q.group);
              return (
                <>
                {showGroup && (
                  <div style={{fontSize:11,color:'var(--p-blue-68)',fontWeight:600,marginTop:i===0?0:10,marginBottom:4}}>
                    📌 {q.group}{q.groupKind==='event'?'':' · 归入 '+(BANK_TYPE_MAP[q.groupCat]?.label||'应知必会')}
                  </div>
                )}
                <div key={i} style={{marginBottom:5,borderRadius:6,border:`1px solid ${checkedQs.includes(i)?'var(--blue)':'var(--border)'}`,background:checkedQs.includes(i)?'var(--p-blue-60-a08)':'transparent'}}>
                  <div style={{display:'flex',gap:8,alignItems:'flex-start',padding:'8px 10px',cursor:'pointer'}} onClick={()=>setCheckedQs(prev=>prev.includes(i)?prev.filter(x=>x!==i):[...prev,i])}>
                    <span style={{color:checkedQs.includes(i)?'var(--blue)':'var(--muted)',fontSize:14,flexShrink:0,marginTop:1}}>{checkedQs.includes(i)?'☑':'☐'}</span>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,color:'var(--text)',marginBottom:3}}>{q.text}</div>
                      {!isExp&&<div style={{fontSize:11,color:'var(--muted)',wordBreak:'break-all'}}>{(q.reference||'').slice(0,60)}{(q.reference||'').length>60?'…':''}</div>}
                    </div>
                    <button onClick={e=>{e.stopPropagation();setExpandedQsIdx(isExp?null:i);}} style={{flexShrink:0,background:'none',border:'none',color:'var(--muted)',cursor:'pointer',fontSize:13,padding:'0 2px'}}>{isExp?'▲':'✏️'}</button>
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:6,paddingLeft:32,paddingRight:10,paddingBottom:isExp?2:8}} onClick={e=>e.stopPropagation()}>
                    <span style={{fontSize:11,color:'var(--muted)',flexShrink:0}}>评分方式</span>
                    <select value={normCat} onChange={e=>updateParsedQ(i,'category',e.target.value)} style={{fontSize:11,padding:'3px 8px',borderRadius:4,border:'1px solid var(--border)',background:'var(--p-navy-07)',color:'var(--p-blue-68)',cursor:'pointer',minWidth:90}}>
                      {STANDARD_CATS.map(c=><option key={c} value={c}>{c}</option>)}
                    </select>
                    <span style={{fontSize:11,color:'var(--muted)'}}>（与题库分类无关）</span>
                  </div>
                  {isExp&&(
                    <div style={{padding:'4px 10px 10px 10px',display:'flex',flexDirection:'column',gap:6}} onClick={e=>e.stopPropagation()}>
                      <div style={{fontSize:11,color:'var(--muted)'}}>题目文本</div>
                      <textarea value={q.text} onChange={e=>updateParsedQ(i,'text',e.target.value)} rows={2} style={{width:'100%',boxSizing:'border-box',background:'var(--p-navy-07)',border:'1px solid var(--border)',color:'var(--text)',borderRadius:5,padding:'6px 8px',fontSize:12,fontFamily:'inherit',resize:'vertical'}}/>
                      <div style={{fontSize:11,color:'var(--muted)'}}>参考答案</div>
                      <textarea value={q.reference||''} onChange={e=>updateParsedQ(i,'reference',e.target.value)} rows={3} style={{width:'100%',boxSizing:'border-box',background:'var(--p-navy-07)',border:'1px solid var(--border)',color:'var(--text)',borderRadius:5,padding:'6px 8px',fontSize:12,fontFamily:'inherit',resize:'vertical'}}/>
                    </div>
                  )}
                </div>
                </>
              );
            })}
          </div>
          <GroupedBankSelect value={aiBank} onChange={setAiBank} newValue={aiNewBank} onNewChange={setAiNewBank}/>
          <button onClick={doAiSave} disabled={aiSaving||checkedQs.length===0}
            style={{width:'100%',marginTop:6,padding:'8px',background:'var(--card)',border:'none',borderRadius:7,color:'var(--text)',fontSize:13,fontWeight:600,cursor:'pointer',opacity:(aiSaving||checkedQs.length===0)?0.5:1}}>
            {aiSaving?'保存中…':`保存选中 ${checkedQs.length} 题`}
          </button>
        </div>
      )}
      {aiMsg&&<div style={{fontSize:12,marginTop:6,color:aiMsg.startsWith('✅')?'var(--green)':'var(--red)'}}>{aiMsg}</div>}

      {divider}

      {/* ── Section 2: 手动出题 ── */}
      {sectionLabel('✍️','手动出题')}
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        <select value={manCat} onChange={e=>setManCat(e.target.value)} style={{...inp,width:'auto'}}>
          {['安全事件','应急处置','业务知识','设备操作','规章制度'].map(c=><option key={c}>{c}</option>)}
        </select>
        <textarea value={manQ} onChange={e=>setManQ(e.target.value)} placeholder="输入题目内容…" rows={3} style={{...inp,resize:'vertical'}}/>
        <textarea value={manA} onChange={e=>setManA(e.target.value)} placeholder="输入参考答案（各要点用分号分隔）…" rows={4} style={{...inp,resize:'vertical'}}/>
        <label style={{display:'flex',alignItems:'center',gap:8,padding:'7px 10px',border:'1px dashed var(--border)',borderRadius:6,cursor:manAiLoading||!manQ.trim()?'default':'pointer',background:'var(--p-blue-60-a04)',opacity:!manQ.trim()?0.5:1}}>
          <input ref={s2Ref} type="file" accept=".docx,.pdf,.jpg,.jpeg,.png,.gif,.webp" style={{display:'none'}}
            onChange={()=>{ if(!manQ.trim()){setManMsg('❌ 请先填写题目');return;} doManAiExtract(); }} disabled={manAiLoading||!manQ.trim()}/>
          <span style={{fontSize:14}}>{manAiLoading?'🤖':'📎'}</span>
          <span style={{fontSize:12,color:'var(--muted)'}}>{manAiLoading?'AI 提取中…':'上传文件，AI 从文件中提取参考答案'}</span>
        </label>
        <GroupedBankSelect value={manBank} onChange={setManBank} newValue={manNewBank} onNewChange={setManNewBank}/>
        <button onClick={doManSave} disabled={manSaving||!manQ.trim()||!manA.trim()}
          style={{padding:'9px',background:'var(--card)',border:'none',borderRadius:7,color:'var(--text)',fontSize:13,fontWeight:600,cursor:'pointer',opacity:(manSaving||!manQ.trim()||!manA.trim())?0.5:1}}>
          {manSaving?'保存中…':'保存题目'}
        </button>
        {manMsg&&<div style={{fontSize:12,color:manMsg.startsWith('✅')?'var(--green)':'var(--red)'}}>{manMsg}</div>}
      </div>


    </div>
  );
}


export function BankImportCard({ pwd, onImported }) {
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
    <label className="card" style={{border:'1px dashed var(--border)',textAlign:'center',padding:'22px',cursor:'pointer',display:'block'}}>
      <input type="file" accept=".xlsx,.xls,.csv" style={{display:'none'}} onChange={doImport}/>
      <div style={{fontSize:28,marginBottom:6}}>{importing ? '⏳' : '＋'}</div>
      <div style={{fontSize:13,color:'var(--muted)'}}>{importing ? '导入中…' : '点击上传题库（Excel / CSV）'}</div>
      {importMsg && <div style={{fontSize:12,marginTop:8,color:importMsg.startsWith('✅')?'var(--green)':'var(--red)'}}>{importMsg}</div>}
    </label>
  );
}

const STANDARD_CATS = ['安全事件', '应急处置', '故障处置', '业务知识', '设备操作', '规章制度', '隐患排查'];

const DOC_CAT_BTNS = [
  { key: 'incident',  icon: '📋', label: '安全事件',   color: 'var(--amber)' },
  { key: 'theory',    icon: '📖', label: '理论题目',   color: 'var(--blue)' },
  { key: 'emergency', icon: '🚨', label: '应急处置',   color: 'var(--red)' },
  { key: 'risk',      icon: '⚠️', label: '风险数据库', color: 'var(--p-indigo-76)' },
];


export function DocParseCard({ pwd, banks, onImported }) {
  const [step, setStep] = useState('idle'); // idle | parsing | preview | saving
  const [msg, setMsg] = useState('');
  const [questions, setQuestions] = useState([]);
  const [checked, setChecked] = useState([]);
  const [expandedIdx, setExpandedIdx] = useState(null);
  const [extractedText, setExtractedText] = useState(''); // AI识别出的原始文本
  const [showRawText, setShowRawText] = useState(false);  // 是否展开原文
  const [destCat, setDestCat] = useState(''); // 'emergency'|'event'|'essential'|'compliance'|'theory'
  const [destBankId, setDestBankId] = useState(''); // 选已有题库
  const [destNewName, setDestNewName] = useState(''); // 新建题库名（event固定新建）
  const [outline, setOutline] = useState(null); // 智能分块识别到的独立条目清单
  const fileRef = useRef();

  const hdrs = () => ({ 'x-admin-password': pwd });
  const bankGroups = groupBanksByType(banks);

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
    setDestBankId(''); setDestNewName('');
    // event 类：预填第一个 event 银行名供参考
    if (key === 'event') setDestNewName('');
    // 其他类：自动选中该类第一个题库
    else if (bankGroups[key]?.length > 0) setDestBankId(String(bankGroups[key][0].id));
  };

  const doParse = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    e.target.value = '';
    parseFile(file);
  };

  // 上传后自动识别：走智能分块（AI 自己判断文档里有几个独立事件/条目，逐个出题并归类）
  const parseFile = async (file) => {
    setStep('parsing'); setMsg(''); setQuestions([]); setChecked([]); setExtractedText(''); setShowRawText(false); setOutline(null);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('mode', 'split');
    try {
      const r = await fetch('/api/admin/banks/parse-doc', { method:'POST', headers:hdrs(), body:fd });
      const d = await r.json();
      if (!d.ok) { setMsg('❌ ' + (d.error||'解析失败')); setStep('idle'); return; }
      const qs = d.questions || [];
      setQuestions(qs);
      setChecked(qs.map((_,i)=>i));
      setOutline(d.outline || null);
      if (d.extractedText) setExtractedText(d.extractedText);
      setStep('preview');
    } catch { setMsg('❌ 网络错误'); setStep('idle'); }
  };

  const doSave = async () => {
    const toSave = questions.filter((_,i) => checked.includes(i));
    if (toSave.length === 0) { setMsg('❌ 请至少勾选一道题'); return; }
    setStep('saving'); setMsg('');
    // 按识别出的条目自动归类：每个事件/条目归一个题库（同名题库自动复用，不重复新建）
    const groups = {};
    toSave.forEach(q => {
      const key = q.group || '未归类题目';
      (groups[key] = groups[key] || []).push(q);
    });
    let total = 0; const okNames = []; const failNames = []; const merged = []; let skipped = 0;
    for (const [name, qs] of Object.entries(groups)) {
      const isEvent = qs[0]?.groupKind === 'event';
      // 归档分类：事件→event；知识类按 AI 判断的 cat（应知必会/非正常情况行车/违法乱纪），无效值回退应知必会
      const ALLOWED_CATS = ['emergency','essential','event','abnormal','compliance'];
      const gc = qs[0]?.groupCat;
      const bankType = isEvent ? 'event' : (ALLOWED_CATS.includes(gc) ? gc : 'essential');
      const payload = qs.map(({ group, groupKind, groupCat, ...rest }) => rest); // 分组字段不入库
      try {
        const r = await fetch('/api/admin/questions/batch-save', {
          method:'POST', headers:{...hdrs(),'Content-Type':'application/json'},
          body: JSON.stringify({ questions: payload, bank_name: name, bank_type: bankType })
        });
        const d = await r.json();
        if (d.ok) {
          total += d.count;
          if (d.reusedBank && d.reusedBank !== name) merged.push(`${name} → 并入已有《${d.reusedBank}》`);
          else okNames.push(name);
          skipped += (d.skippedEventNames || []).length;
        } else failNames.push(name);
      } catch { failNames.push(name); }
    }
    if (total > 0 || merged.length) {
      const parts = [`✅ 已录入 ${total} 题`];
      if (okNames.length) parts.push(`自动归入 ${okNames.length} 个题库`);
      if (merged.length) parts.push(`同事件并入已有题库：${merged.join('；')}`);
      if (skipped) parts.push(`跳过 ${skipped} 道重复事件题`);
      if (failNames.length) parts.push(`（${failNames.length} 个失败：${failNames.join('、')}）`);
      setMsg(parts.join('，'));
      setStep('idle'); setQuestions([]); setChecked([]);
      onImported?.();
    } else {
      setMsg('❌ 录入失败，请重试'); setStep('preview');
    }
  };

  const toggleCheck = (i) => setChecked(prev => prev.includes(i) ? prev.filter(x=>x!==i) : [...prev,i]);
  const updateQuestion = (i, field, val) => setQuestions(prev => prev.map((q,j) => j===i ? {...q,[field]:val} : q));

  /* ── IDLE / PARSING ── */
  if (step === 'idle' || step === 'parsing') return (
    <div className="card" style={{border:'1px solid var(--p-navy-25)',padding:14,background:'var(--p-blue-60-a04)'}}>
      {/* 一步到位：上传 → 自动识别 → 自动归类 */}
      <label style={{display:'block',textAlign:'center',padding:'18px 16px',border:`1px dashed ${step==='parsing'?'var(--blue)':'var(--p-navy-25)'}`,borderRadius:8,cursor:step==='parsing'?'default':'pointer',background:'var(--p-navy-11-a40)'}}>
        <input ref={fileRef} type="file" accept=".docx,.pdf,.jpg,.jpeg,.png,.gif,.webp" style={{display:'none'}} onChange={doParse} disabled={step==='parsing'}/>
        <div style={{fontSize:24,marginBottom:5}}>{step==='parsing'?'🤖':'📄'}</div>
        <div style={{fontSize:13,color:'var(--blue)',fontWeight:600}}>{step==='parsing'?'AI 分析中，请稍候…':'点击上传（Word / PDF / 图片）'}</div>
        <div style={{fontSize:11,color:'var(--muted)',marginTop:7,lineHeight:1.55}}>
          系统会自动读完材料，识别出里面有几个独立事件/知识点，逐个出题，<br/>
          并按事件自动归类到题库。你只需在结果里勾选要录入的题（默认全选）。
        </div>
      </label>
      {msg && <div style={{fontSize:12,marginTop:8,color:msg.startsWith('✅')?'var(--green)':'var(--red)'}}>{msg}</div>}
    </div>
  );

  /* ── PREVIEW ── */
  const canSave = step!=='saving' && checked.length>0;

  return (
    <div className="card" style={{border:'1px solid var(--p-navy-25)',padding:'16px'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
        <div style={{fontSize:13,fontWeight:700,color:'var(--blue)'}}>🤖 AI识别结果</div>
        <button onClick={()=>{setStep('idle');setMsg('');}} style={{background:'none',border:'none',color:'var(--muted)',cursor:'pointer',fontSize:12}}>重新上传</button>
      </div>

      {/* 识别原文（可展开） */}
      {extractedText && (
        <div style={{marginBottom:10,borderRadius:7,border:'1px solid var(--p-blue-60-a20)',overflow:'hidden'}}>
          <button onClick={()=>setShowRawText(v=>!v)}
            style={{width:'100%',padding:'7px 10px',background:'var(--p-blue-60-a06)',border:'none',color:'var(--muted)',fontSize:11,cursor:'pointer',textAlign:'left',display:'flex',justifyContent:'space-between'}}>
            <span>📄 识别原文（点击查看，可对照核查）</span>
            <span>{showRawText?'▲':'▼'}</span>
          </button>
          {showRawText && (
            <div style={{padding:'8px 10px',background:'var(--p-navy-07-a60)',maxHeight:200,overflowY:'auto',fontSize:11,color:'var(--muted)',lineHeight:1.6,whiteSpace:'pre-wrap',wordBreak:'break-all'}}>
              {extractedText}
            </div>
          )}
        </div>
      )}

      {/* 识别摘要：让操作人一眼看出系统读懂了什么 */}
      {outline && outline.length>0 && (
        <div style={{fontSize:11,color:'var(--p-blue-68)',marginBottom:10,lineHeight:1.6,padding:'7px 10px',borderRadius:6,background:'var(--p-blue-60-a08)'}}>
          🧩 已识别 <b>{outline.length}</b> 个独立条目：{outline.map(o=>o.name).join('、')}
        </div>
      )}

      {/* 题目列表 — 直接内联编辑 */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
        <span style={{fontSize:11,color:'var(--muted)'}}>共 {questions.length} 道，已选 {checked.length} 道</span>
        <div style={{display:'flex',gap:6}}>
          <button onClick={()=>setChecked(questions.map((_,i)=>i))} style={{fontSize:11,padding:'2px 8px',borderRadius:4,border:'1px solid var(--border)',background:'var(--input-bg)',color:'var(--muted)',cursor:'pointer'}}>全选</button>
          <button onClick={()=>setChecked([])} style={{fontSize:11,padding:'2px 8px',borderRadius:4,border:'1px solid var(--border)',background:'var(--input-bg)',color:'var(--muted)',cursor:'pointer'}}>取消</button>
        </div>
      </div>
      <div style={{marginBottom:12,display:'flex',flexDirection:'column',gap:8}}>
        {questions.map((q,i) => {
          const normCat = STANDARD_CATS.includes(q.category) ? q.category : '业务知识';
          const sel = checked.includes(i);
          const showGroup = q.group && (i===0 || questions[i-1].group !== q.group);
          return (
            <>
            {showGroup && (
              <div style={{fontSize:11,color:'var(--p-blue-68)',fontWeight:700,marginTop:i===0?0:6,marginBottom:1}}>
                📌 {q.group}{q.groupKind==='event'?'':' · 归入 '+(BANK_TYPE_MAP[q.groupCat]?.label||'应知必会')}
              </div>
            )}
            <div key={i} style={{borderRadius:8,border:`1px solid ${sel?'var(--p-blue-60-a40)':'var(--border)'}`,background:sel?'var(--p-blue-60-a06)':'var(--p-navy-07-a40)',padding:'10px 12px'}}>
              {/* 勾选 + 序号 */}
              <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:6,cursor:'pointer'}} onClick={()=>toggleCheck(i)}>
                <span style={{color:sel?'var(--blue)':'var(--muted)',fontSize:14,flexShrink:0}}>{sel?'☑':'☐'}</span>
                <span style={{fontSize:11,color:sel?'var(--p-blue-68)':'var(--muted)',fontWeight:700}}>第 {i+1} 题</span>
                <span style={{marginLeft:'auto',fontSize:11,color:'var(--muted)',flexShrink:0}}>评分方式</span>
                <select value={normCat} onChange={e=>{e.stopPropagation();updateQuestion(i,'category',e.target.value);}}
                  onClick={e=>e.stopPropagation()}
                  style={{fontSize:11,padding:'2px 6px',borderRadius:4,border:'1px solid var(--border)',background:'var(--p-navy-07)',color:'var(--p-blue-68)',cursor:'pointer'}}>
                  {STANDARD_CATS.map(c=><option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              {/* 题目文本 */}
              <textarea value={q.text} onChange={e=>updateQuestion(i,'text',e.target.value)}
                rows={2} placeholder="题目"
                style={{width:'100%',boxSizing:'border-box',background:'var(--p-navy-07)',border:'1px solid var(--border)',color:'var(--text)',borderRadius:5,padding:'6px 8px',fontSize:12,fontFamily:'inherit',resize:'vertical',marginBottom:6}}/>
              {/* 参考答案 */}
              <div style={{fontSize:11,color:'var(--p-blue-68-a70)',marginBottom:3,fontWeight:600}}>参考答案</div>
              <textarea value={q.reference||''} onChange={e=>updateQuestion(i,'reference',e.target.value)}
                rows={3} placeholder="参考答案（各要点用分号分隔）"
                style={{width:'100%',boxSizing:'border-box',background:'var(--p-navy-07)',border:'1px solid var(--p-blue-60-a20)',color:'var(--muted)',borderRadius:5,padding:'6px 8px',fontSize:11,fontFamily:'inherit',resize:'vertical'}}/>
            </div>
            </>
          );
        })}
      </div>

      {/* 自动归类说明 + 保存 */}
      <div style={{background:'var(--p-navy-07-a60)',border:'1px solid var(--border)',borderRadius:8,padding:'10px 12px',marginBottom:10}}>
        <div style={{fontSize:11,color:'var(--muted)',fontWeight:600,marginBottom:6}}>录入后自动归类（每个事件/条目一个题库，同名题库自动合并）</div>
        <div style={{fontSize:11,color:'var(--muted)',marginBottom:6,lineHeight:1.5}}>题库的分类标签（应急 / 应知必会 / 非正常情况行车 / 违法乱纪）由 AI 按内容自动判定，预览里每条会显示「· 归入 XXX」；题干右侧的「评分方式」只决定 AI 怎么判分（事件复述 / 按得分点 / 按操作步骤），<b style={{color:'var(--p-blue-68)'}}>与题库分类无关，一般不用动</b>。</div>
        <div style={{fontSize:11,color:'var(--p-blue-68)',lineHeight:1.7}}>
          {(() => {
            const sel = questions.filter((_,i)=>checked.includes(i));
            const m = {};
            sel.forEach(q => { const k = q.group || '未归类题目'; m[k] = (m[k]||0)+1; });
            const parts = Object.entries(m).map(([k,v]) => `📌 ${k}（${v}题）`);
            return parts.length ? parts.join('　') : '—';
          })()}
        </div>
      </div>

      <button onClick={doSave} disabled={!canSave}
        style={{width:'100%',padding:'10px',background:'linear-gradient(135deg,var(--p-navy-25),var(--blue))',border:'none',borderRadius:7,color:'var(--text)',fontSize:13,fontWeight:600,cursor:'pointer',opacity:canSave?1:0.4}}>
        {step==='saving'?'录入中…':`✅ 确认录入选中的 ${checked.length} 题`}
      </button>
      {msg && <div style={{fontSize:12,marginTop:8,color:msg.startsWith('✅')?'var(--green)':'var(--red)'}}>{msg}</div>}
    </div>
  );
}


// ─── ManualEntryForm ──────────────────────────────────────────────────────────

export function ManualEntryForm({ pwd, banks, hdrs, onDone }) {
  const [text, setText] = useState('');
  const [reference, setReference] = useState('');
  const [keywords, setKeywords] = useState('');
  const [bankId, setBankId] = useState('');
  const [newBankName, setNewBankName] = useState('');
  const [newBankType, setNewBankType] = useState('essential');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const doSave = async () => {
    if (!text.trim()) { setMsg('❌ 请输入题目'); return; }
    if (!reference.trim()) { setMsg('❌ 请输入参考答案'); return; }
    if (!bankId && !newBankName.trim()) { setMsg('❌ 请选择或新建题库'); return; }
    setSaving(true);
    const r = await fetch('/api/admin/questions/batch-save', {
      method:'POST', headers:{...hdrs(),'Content-Type':'application/json'},
      body: JSON.stringify({ questions:[{text:text.trim(),reference:reference.trim(),keywords:keywords.trim(),category:'业务知识'}], bank_id:bankId?parseInt(bankId):undefined, bank_name:newBankName.trim()||undefined, bank_type:newBankName.trim()?newBankType:undefined })
    }).then(r=>r.json()).catch(()=>null);
    setSaving(false);
    if (r?.ok) { setText(''); setReference(''); setKeywords(''); setBankId(''); setNewBankName(''); setMsg('✅ 已保存'); onDone?.(); }
    else setMsg('❌ '+(r?.error||'保存失败'));
  };
  const fi = {width:'100%',padding:'7px 10px',borderRadius:7,border:'1px solid var(--border)',background:'var(--p-navy-07)',color:'var(--text)',fontSize:12,boxSizing:'border-box',fontFamily:'inherit'};
  return (
    <div style={{display:'flex',flexDirection:'column',gap:10,paddingTop:4}}>
      <div>
        <div style={{fontSize:11,color:'var(--muted)',marginBottom:4}}>题目</div>
        <textarea value={text} onChange={e=>setText(e.target.value)} rows={3} style={{...fi,resize:'vertical'}} placeholder="输入题目…"/>
      </div>
      <div>
        <div style={{fontSize:11,color:'var(--muted)',marginBottom:4}}>参考答案（各要点用分号分隔）</div>
        <textarea value={reference} onChange={e=>setReference(e.target.value)} rows={4} style={{...fi,resize:'vertical'}} placeholder="要点1；要点2；要点3"/>
      </div>
      <div>
        <div style={{fontSize:11,color:'var(--muted)',marginBottom:4}}>关键词（逗号分隔，可选）</div>
        <input value={keywords} onChange={e=>setKeywords(e.target.value)} style={fi} placeholder="关键词1,关键词2"/>
      </div>
      <div>
        <div style={{fontSize:11,color:'var(--muted)',marginBottom:4}}>保存到题库</div>
        <BankTypeSelect banks={banks} bankId={bankId} setBankId={setBankId} newBankName={newBankName} setNewBankName={setNewBankName} newBankType={newBankType} setNewBankType={setNewBankType}/>
      </div>
      <button disabled={saving} onClick={doSave} style={{padding:'10px',borderRadius:8,border:'none',background:'linear-gradient(135deg,var(--p-navy-25),var(--blue))',color:'white',fontSize:13,fontWeight:600,cursor:saving?'not-allowed':'pointer',fontFamily:'inherit',opacity:saving?0.7:1}}>
        {saving?'保存中…':'保存'}
      </button>
      {msg&&<div style={{fontSize:12,color:msg.startsWith('✅')?'var(--green)':'var(--red)',textAlign:'center'}}>{msg}</div>}
    </div>
  );
}

// ─── ExcelImportForm ──────────────────────────────────────────────────────────

export function ExcelImportForm({ pwd, banks, onDone }) {
  const [bankId, setBankId] = useState('');
  const [newBankName, setNewBankName] = useState('');
  const [newBankType, setNewBankType] = useState('essential');
  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState('');
  const fileRef = useRef();
  const doImport = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    if (!bankId && !newBankName.trim()) { setMsg('❌ 请先选择或新建题库'); if (fileRef.current) fileRef.current.value=''; return; }
    setImporting(true); setMsg('');
    const fd = new FormData();
    fd.append('file', file);
    if (newBankName.trim()) { fd.append('bank_name', newBankName.trim()); fd.append('bank_type', newBankType); }
    else fd.append('bank_id', bankId);
    const r = await fetch('/api/admin/banks/import', {method:'POST',headers:{'x-admin-password':pwd},body:fd})
      .then(r=>r.json()).catch(()=>null);
    setImporting(false); if (fileRef.current) fileRef.current.value='';
    if (r?.ok) { setMsg(`✅ 成功导入 ${r.count} 题`); onDone?.(); }
    else setMsg('❌ '+(r?.error||'导入失败'));
  };
  return (
    <div style={{display:'flex',flexDirection:'column',gap:10,paddingTop:4}}>
      <div>
        <div style={{fontSize:11,color:'var(--muted)',marginBottom:4}}>目标题库</div>
        <BankTypeSelect banks={banks} bankId={bankId} setBankId={setBankId} newBankName={newBankName} setNewBankName={setNewBankName} newBankType={newBankType} setNewBankType={setNewBankType}/>
      </div>
      <label style={{display:'flex',flexDirection:'column',alignItems:'center',padding:'20px 16px',border:'1px dashed var(--border)',borderRadius:8,cursor:'pointer',background:'var(--p-navy-07-a40)'}}>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{display:'none'}} onChange={doImport}/>
        <div style={{fontSize:28,marginBottom:6}}>{importing?'⏳':'📊'}</div>
        <div style={{fontSize:13,color:'var(--muted)'}}>{importing?'导入中…':'点击上传 Excel / CSV'}</div>
        <div style={{fontSize:11,color:'var(--p-blue-35)',marginTop:4}}>每行：题目, 参考答案, 关键词, 分类</div>
      </label>
      {msg&&<div style={{fontSize:12,color:msg.startsWith('✅')?'var(--green)':'var(--red)',textAlign:'center'}}>{msg}</div>}
    </div>
  );
}

// ── 导入培训计划卡片 ──────────────────────────────────────────────────────────
const TRAIN_TYPES_YP = ['示范','实操','理论','实践','其他'];
const TYPE_COLOR_YP = {'示范':'var(--p-indigo-76)','实操':'var(--p-green-52)','理论':'var(--p-cyan-60)','实践':'var(--p-amber-61)','其他':'var(--muted)'};


export function ImportPlanCard({ hdrs }) {
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

  const statusBadge = s => s==='done'?{t:'已识别',c:'var(--green)'}:s==='processing'?{t:'识别中…',c:'var(--amber)'}:s==='error'?{t:'识别失败',c:'var(--red)'}:{t:'待识别',c:'var(--muted)'};

  const MONTHS = Array.from({length:12},(_,i)=>i+1);

  return (
    <div className="card" style={{padding:0,overflow:'hidden'}}>

      {/* ── 文件上传区 ── */}
      <div style={{padding:'14px 16px 12px',borderBottom:'1px solid var(--border)'}}>
        <div style={{fontSize:11,color:'var(--muted)',letterSpacing:1,marginBottom:10,fontWeight:600}}>导入培训计划文件</div>
        <label style={{display:'block',border:'1px dashed var(--p-blue-60-a40)',borderRadius:8,padding:'12px',textAlign:'center',cursor:'pointer',background:'var(--p-blue-60-a04)',marginBottom:8}}>
          <input type="file" multiple accept="image/*,.xlsx,.xls,.csv,.pdf,.doc,.docx" style={{display:'none'}}
            onChange={e=>{upload(e.target.files);e.target.value='';}} disabled={uploading}/>
          <div style={{fontSize:16,marginBottom:2}}>{uploading?'⏳':'＋'}</div>
          <div style={{fontSize:11,color:'var(--muted)'}}>{uploading?'上传中…':'点击上传排班图片 / Excel / PDF / Word'}</div>
        </label>
        {fileList && fileList.map(f => {
          const b = statusBadge(f.parse_status);
          return (
            <div key={f.id} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 0',borderTop:'1px solid var(--p-navy-22-a35)'}}>
              <span style={{fontSize:14,flexShrink:0}}>{iconFor(f.original_name||f.filename)}</span>
              <div style={{flex:1,overflow:'hidden'}}>
                <div style={{fontSize:11,color:'var(--text)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{f.original_name||f.filename}</div>
                <div style={{fontSize:11,color:'var(--muted)'}}>{(f.uploaded_at||'').slice(0,16)}</div>
              </div>
              <span style={{fontSize:11,color:b.c,flexShrink:0}}>{b.t}</span>
              {f.parse_status!=='processing' && (
                <button onClick={()=>parseFile(f.id)} disabled={!!parsing[f.id]}
                  style={{fontSize:11,padding:'3px 8px',borderRadius:5,border:'1px solid var(--p-blue-60-a40)',background:'var(--p-blue-60-a10)',color:'var(--p-blue-68)',cursor:'pointer',flexShrink:0,opacity:parsing[f.id]?0.5:1}}>
                  🤖 {f.parse_status==='done'?'重新识别':'识别'}
                </button>
              )}
              <a href={`/training-imports/${f.filename}`} target="_blank" style={{fontSize:11,color:'var(--muted)',textDecoration:'none',flexShrink:0}}>查看</a>
              <button onClick={()=>delFile(f.id)} style={{background:'none',border:'none',color:'var(--p-blue-27)',fontSize:16,cursor:'pointer',padding:0,flexShrink:0}}>×</button>
            </div>
          );
        })}
      </div>

      {/* ── 年度培训计划表 ── */}
      {/* 表头 */}
      <div style={{display:'grid',gridTemplateColumns:'52px 1fr 64px 80px',background:'var(--p-navy-22-a60)',borderBottom:'1px solid var(--border)'}}>
        {['月份','培训项点','培训方式','操作'].map(h=>(
          <div key={h} style={{padding:'7px 8px',fontSize:11,fontWeight:700,color:'var(--muted)',letterSpacing:1,textAlign:'center'}}>{h}</div>
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
          <div key={m} style={{borderBottom:'1px solid var(--p-navy-22-a40)'}}>
            {/* 月份折叠标题 */}
            <div onClick={()=>setExpanded(e=>({...e,[m]:!isOpen}))}
              style={{display:'flex',alignItems:'center',padding:'8px 12px',cursor:'pointer',
                background:isCur?'var(--p-blue-60-a07)':isPast?'var(--p-black-00-a12)':'transparent',
                borderLeft:`3px solid ${isCur?'var(--blue)':isPast?'var(--p-navy-25)':'transparent'}`}}>
              <span style={{fontSize:12,fontWeight:isCur?700:400,color:isCur?'var(--p-blue-78)':isPast?'var(--muted)':'var(--muted)',minWidth:56}}>
                {m}月 {isCur&&<span style={{fontSize:11,background:'var(--p-blue-60-a25)',color:'var(--p-blue-68)',borderRadius:3,padding:'0 4px',marginLeft:3}}>本月</span>}
              </span>
              <span style={{fontSize:11,color:'var(--p-blue-27)',flex:1}}>{rows.length>0?`${rows.length}项`:'暂无'}</span>
              <span style={{fontSize:11,color:'var(--p-blue-27)'}}>{isOpen?'▾':'›'}</span>
            </div>

            {/* 展开内容 */}
            {isOpen && (<>
              {/* 数据行 */}
              {(isEditing?buf:rows).map((r,idx)=>(
                <div key={idx} style={{display:'grid',gridTemplateColumns:'52px 1fr 64px 80px',borderTop:'1px solid var(--p-navy-22-a25)',background:idx%2===0?'transparent':'var(--p-black-00-a08)'}}>
                  <div style={{padding:'7px 8px',fontSize:11,color:'var(--muted)',textAlign:'center',alignSelf:'center'}}>{m}/{idx+1}</div>
                  {isEditing ? (
                    <input value={r.item||''} onChange={e=>bufUpdate(m,idx,'item',e.target.value)}
                      style={{margin:'4px 4px',padding:'4px 6px',background:'var(--input-bg)',border:'1px solid var(--p-blue-33)',borderRadius:4,color:'var(--text)',fontSize:11,fontFamily:'inherit',outline:'none'}}/>
                  ) : (
                    <div style={{padding:'7px 8px',fontSize:11,color:'var(--text)',lineHeight:1.5,alignSelf:'center'}}>{r.item}</div>
                  )}
                  {isEditing ? (
                    <select value={r.trainType||'实操'} onChange={e=>bufUpdate(m,idx,'trainType',e.target.value)}
                      style={{margin:'4px 2px',padding:'4px 4px',background:'var(--input-bg)',border:'1px solid var(--p-blue-33)',borderRadius:4,color:TYPE_COLOR_YP[r.trainType]||'var(--muted)',fontSize:11,fontFamily:'inherit',outline:'none'}}>
                      {TRAIN_TYPES_YP.map(t=><option key={t} value={t}>{t}</option>)}
                    </select>
                  ) : (
                    <div style={{padding:'7px 4px',textAlign:'center',alignSelf:'center'}}>
                      <span style={{fontSize:11,padding:'2px 6px',borderRadius:4,border:`1px solid ${TYPE_COLOR_YP[r.trainType]||'var(--muted)'}44`,color:TYPE_COLOR_YP[r.trainType]||'var(--muted)',background:`${TYPE_COLOR_YP[r.trainType]||'var(--muted)'}11`}}>{r.trainType||'—'}</span>
                    </div>
                  )}
                  <div style={{padding:'4px 6px',display:'flex',alignItems:'center',justifyContent:'center'}}>
                    {isEditing && <button onClick={()=>bufDel(m,idx)} style={{background:'none',border:'none',color:'var(--muted)',fontSize:14,cursor:'pointer',padding:'0 4px'}}>×</button>}
                  </div>
                </div>
              ))}

              {/* 空提示 */}
              {!isEditing && rows.length===0 && (
                <div style={{padding:'10px 12px',fontSize:11,color:'var(--p-blue-27)',textAlign:'center'}}>暂无培训项点</div>
              )}

              {/* 编辑模式：添加行 + 保存取消 */}
              {isEditing && (
                <div style={{padding:'6px 12px',borderTop:'1px solid var(--p-navy-22-a30)',display:'flex',gap:8,alignItems:'center',background:'var(--p-black-00-a10)'}}>
                  <button onClick={()=>bufAdd(m)} style={{fontSize:11,padding:'4px 10px',borderRadius:5,border:'1px dashed var(--p-blue-60-a40)',background:'var(--p-blue-60-a06)',color:'var(--p-blue-68)',cursor:'pointer',fontFamily:'inherit'}}>＋ 添加</button>
                  <span style={{flex:1}}/>
                  <button onClick={()=>cancelEdit(m)} style={{fontSize:11,padding:'4px 10px',borderRadius:5,border:'1px solid var(--border)',background:'transparent',color:'var(--muted)',cursor:'pointer',fontFamily:'inherit'}}>取消</button>
                  <button onClick={()=>saveEdit(m)} disabled={saving} style={{fontSize:11,padding:'4px 12px',borderRadius:5,border:'none',background:'var(--blue)',color:'var(--text)',cursor:'pointer',fontFamily:'inherit',fontWeight:600}}>
                    {saving?'保存中…':'保存'}
                  </button>
                </div>
              )}

              {/* 非编辑模式：修改按钮 */}
              {!isEditing && (
                <div style={{padding:'5px 12px',borderTop:'1px solid var(--p-navy-22-a20)',background:'var(--p-black-00-a08)',display:'flex',justifyContent:'flex-end'}}>
                  <button onClick={()=>startEdit(m)} style={{fontSize:11,padding:'3px 10px',borderRadius:5,border:'1px solid var(--border)',background:'transparent',color:'var(--muted)',cursor:'pointer',fontFamily:'inherit'}}>✎ 修改</button>
                </div>
              )}
            </>)}
          </div>
        );
      })}
    </div>
  );
}

