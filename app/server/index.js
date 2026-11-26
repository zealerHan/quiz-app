require('dotenv').config();
const express = require('express');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

const { ensureCurrentCycle } = require('./helpers');
require('./db_leave'); // 休假模块建表（幂等，已存在则跳过）
// 登录设备留痕建表（老韩 2026-11-26：只留痕不拦，让「替人答」可发现）
{ const { loginDevices } = require('./loginDevices'); const { db: _db } = require('./db'); loginDevices(_db); }
const workshopRouter = require('./routes/workshop');
const quizRouter = require('./routes/quiz');
const adminRouter = require('./routes/admin');
require('./jobs'); // 启动定时推送任务

// 启动时初始化
ensureCurrentCycle();
// 每小时检查一次是否需要切换轮次
setInterval(ensureCurrentCycle, 60 * 60 * 1000);


app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'dist')));
app.use('/training-photos', express.static(path.join(__dirname, '..', 'data', 'training-photos')));
// 留言墙图片（压缩后落盘，public 只读）
app.use('/wall-images', express.static(path.join(__dirname, '..', 'data', 'wall-images')));
// 下周休假申报图（钉钉 markdown 嵌图用，必须公网匿名可访问，不能加鉴权）
app.use('/leave-charts', express.static(path.join(__dirname, '..', 'data', 'leave-charts')));
// ─── 本地录音二次识别（流式 ASR 失败/超时时兜底）────────────────────────────
// 前端把本地留存的 PCM(16k/16bit/mono) 原样 POST 上来，这里重放给 paraformer-realtime-v2
function replayPcmToDashScope(pcmBuf, key) {
  return new Promise((resolve) => {
    const taskId = crypto.randomUUID().replace(/-/g, '');
    const dashWs = new WebSocket('wss://dashscope.aliyuncs.com/api-ws/v1/inference', {
      headers: { Authorization: `bearer ${key}` },
    });
    let finalText = '', partial = '', finished = false;
    const done = () => { if (finished) return; finished = true; clearTimeout(timer); try { dashWs.close(); } catch(_){} resolve((finalText + partial).trim()); };
    const timer = setTimeout(done, 120000);

    dashWs.on('open', () => {
      dashWs.send(JSON.stringify({
        header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
        payload: {
          task_group: 'audio', task: 'asr', function: 'recognition',
          model: 'paraformer-realtime-v2',
          parameters: {
            format: 'pcm', sample_rate: 16000, sentence_silence_duration: 800,
            ...(process.env.DASHSCOPE_VOCABULARY_ID ? { vocabulary_id: process.env.DASHSCOPE_VOCABULARY_ID } : {}),
          },
          input: {},
        },
      }));
    });

    dashWs.on('message', (data) => {
      if (data instanceof Buffer && data[0] !== 123) return;
      let msg; try { msg = JSON.parse(data.toString()); } catch { return; }
      const ev = msg.header && msg.header.event;
      if (ev === 'task-started') {
        // 全速重放：每块 3200B(≈100ms)，间隔 5ms → 1 分钟录音约 3 秒发完
        let off = 0;
        const pump = () => {
          if (finished || dashWs.readyState !== WebSocket.OPEN) return;
          if (off >= pcmBuf.length) {
            try { dashWs.send(JSON.stringify({ header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' }, payload: { input: {} } })); } catch(_){}
            return;
          }
          const chunk = pcmBuf.slice(off, off + 3200); off += 3200;
          dashWs.send(chunk, () => setTimeout(pump, 5));
        };
        pump();
      } else if (ev === 'result-generated') {
        const s = msg.payload && msg.payload.output && msg.payload.output.sentence;
        if (!s) return;
        if (s.sentence_end) { finalText += (s.text || ''); partial = ''; }
        else partial = s.text || '';
      } else if (ev === 'task-finished') { done(); }
      else if (ev === 'task-failed') { console.error('[ASR二次识别] task-failed:', msg.header && msg.header.error_message); done(); }
    });
    dashWs.on('error', (e) => { console.error('[ASR二次识别] ws error:', e.message); done(); });
    dashWs.on('close', done);
  });
}

app.post('/api/asr/replay', express.raw({ type: 'application/octet-stream', limit: '24mb' }), async (req, res) => {
  const key = process.env.DASHSCOPE_API_KEY;
  if (!key) return res.status(503).json({ error: '未配置 DASHSCOPE_API_KEY', text: '' });
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length < 6400) return res.status(400).json({ error: '音频太短', text: '' });
  try {
    const t0 = Date.now();
    const text = await replayPcmToDashScope(buf, key);
    console.log(`[ASR二次识别] ${(buf.length / 32).toFixed(0)}ms 音频 → ${text.length} 字，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    res.json({ text: text || '' });
  } catch (e) {
    console.error('[ASR二次识别] 异常:', e.message);
    res.status(500).json({ error: 'replay failed', text: '' });
  }
});

app.use(workshopRouter);
app.use(quizRouter);
app.use(adminRouter);
app.use(require('./routes/leave'));

// ─── 全局错误兜底（2026-11-26）────────────────────────────────────────────
// 为什么需要：quiz.js 有 40 个路由但只有 4 个 try-catch，/answer /finish /score
// 三个核心路由都没有。实测给非法 session id 会返回 500 白屏 —— 学生答完题看到
// 报错页，以为没交上，实际可能已经写了一半。
//
// 这里兜住所有路由抛出的异常：
//   · 记录完整堆栈到日志（排查用）
//   · 给前端返回结构化 JSON，前端能弹正常提示而不是白屏
//   · 绝不吞掉 —— 4xx 保持原样，只有真异常才走这里
app.use((err, req, res, next) => {
  // body-parser 的 JSON 解析错误属于客户端问题，给 400 更准确
  const isBadJson = err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError);
  const isTooLarge = err && err.type === 'entity.too.large';

  console.error('[ERROR]', req.method, req.originalUrl || req.url);
  console.error('       ', err && (err.stack || err.message || String(err)));

  if (res.headersSent) return next(err);   // 已经开始响应就不再插手

  if (isTooLarge) return res.status(413).json({ error: '请求内容过大' });
  if (isBadJson) return res.status(400).json({ error: '请求格式错误' });
  return res.status(500).json({ error: '服务器处理出错，请重试或联系管理员' });
});

// ─── 进程级兜底（2026-11-26）──────────────────────────────────────────────
// Express 兜不住的（async 里 reject 没人接、定时器里抛错）会冒到这里。
// 只记录，不退出 —— 一场答题中途重启服务比留个错更糟。
process.on('uncaughtException', (e) => {
  console.error('[UNCAUGHT]', e && (e.stack || e.message || String(e)));
});
process.on('unhandledRejection', (e) => {
  console.error('[UNHANDLED-REJECTION]', e && (e.stack || e.message || String(e)));
});

// ─── DashScope Paraformer-realtime-v2 实时语音识别 ───────────────────────────
const wss = new WebSocket.Server({ noServer: true });
wss.on('connection', (clientWs) => {
  const taskId = require('crypto').randomUUID().replace(/-/g, '');
  let dashWs = null;
  let finalText = '';
  let audioQueue = [];
  let taskStarted = false;
  let pendingStop = false;
  let stopTimer = null;

  const DASHSCOPE_KEY = process.env.DASHSCOPE_API_KEY;
  if (!DASHSCOPE_KEY) {
    clientWs.send(JSON.stringify({ type: 'error', text: '未配置 DASHSCOPE_API_KEY' }));
    clientWs.close();
    return;
  }

  dashWs = new WebSocket('wss://dashscope.aliyuncs.com/api-ws/v1/inference/', {
    headers: { 'Authorization': `bearer ${DASHSCOPE_KEY}` },
  });

  const sendFinishTask = () => {
    dashWs.send(JSON.stringify({
      header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
      payload: { input: {} },
    }));
    stopTimer = setTimeout(() => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ type: 'final', text: finalText }));
      }
      try { dashWs.close(); } catch(e) {}
    }, 5000);
  };

  dashWs.on('open', () => {
    dashWs.send(JSON.stringify({
      header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
      payload: {
        task_group: 'audio',
        task: 'asr',
        function: 'recognition',
        model: 'paraformer-realtime-v2',
        parameters: {
          format: 'pcm',
          sample_rate: 16000,
          sentence_silence_duration: 800,
          ...(process.env.DASHSCOPE_VOCABULARY_ID ? { vocabulary_id: process.env.DASHSCOPE_VOCABULARY_ID } : {}),
        },
        input: {},
      },
    }));
  });

  dashWs.on('message', (data) => {
    if (data instanceof Buffer && data[0] !== 123) return; // 非 JSON 二进制帧
    try {
      const msg = JSON.parse(data.toString());
      const event = msg.header?.event;
      if (event === 'task-started') {
        taskStarted = true;
        while (audioQueue.length > 0) dashWs.send(audioQueue.shift());
        if (pendingStop) sendFinishTask();
      } else if (event === 'result-generated') {
        const sentence = msg.payload?.output?.sentence;
        if (!sentence) return;
        if (!sentence.sentence_end) {
          clientWs.send(JSON.stringify({ type: 'partial', text: finalText + (sentence.text || '') }));
        } else {
          finalText += (sentence.text || '');
          clientWs.send(JSON.stringify({ type: 'partial', text: finalText }));
        }
      } else if (event === 'task-finished') {
        if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
        clientWs.send(JSON.stringify({ type: 'final', text: finalText }));
        dashWs.close();
      } else if (event === 'task-failed') {
        const errMsg = msg.header?.error_message || '识别失败';
        console.error('[Paraformer] task-failed:', errMsg);
        clientWs.send(JSON.stringify({ type: 'error', text: '语音识别失败，请在下方文本框手动输入答案' }));
        dashWs.close();
      }
    } catch(e) {}
  });

  dashWs.on('error', (err) => {
    console.error('[Paraformer] WS error:', err.message);
    clientWs.send(JSON.stringify({ type: 'error', text: '识别服务异常，请在下方文本框手动输入答案' }));
  });

  dashWs.on('close', () => {
    if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
  });

  clientWs.on('message', (data) => {
    if (!dashWs) return;
    const isJson = typeof data === 'string' || (data instanceof Buffer && data[0] === 123);
    if (isJson) {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'stop') {
          if (taskStarted) sendFinishTask();
          else pendingStop = true;
        }
      } catch(e) {}
    } else {
      if (taskStarted && dashWs.readyState === WebSocket.OPEN) {
        dashWs.send(data);
      } else {
        audioQueue.push(data);
      }
    }
  });

  clientWs.on('close', () => {
    if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
    if (dashWs && dashWs.readyState === WebSocket.OPEN) {
      try {
        dashWs.send(JSON.stringify({
          header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
          payload: { input: {} },
        }));
      } catch(e) {}
    }
  });
});

const httpServer = require('http').createServer(app);
httpServer.on('upgrade', (req, socket, head) => {
  if (req.url === '/ws/ali-asr') {
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  } else if (req.url && req.url.startsWith('/ws/iat')) {
    wssXunfei.handleUpgrade(req, socket, head, ws => wssXunfei.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});
httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ 端口 ${PORT} 已被占用，服务器无法启动。请先终止占用端口的进程。\n`);
    process.exit(1);
  } else {
    throw err;
  }
});
httpServer.listen(PORT,'0.0.0.0',()=>{
  const nets=os.networkInterfaces(); let ip='localhost';
  for(const n of Object.values(nets)) for(const i of n) if(i.family==='IPv4'&&!i.internal){ip=i.address;break;}
  const spark=process.env.XFYUN_APP_ID&&process.env.XFYUN_APP_ID!=='你的AppID';
  console.log(`\n🚇 武汉地铁5号线 · 乘务四组 乘务系统\n${'═'.repeat(40)}`);
  console.log(`  本机: http://localhost:${PORT}  内网: http://${ip}:${PORT}`);
  console.log(`  AI评分: ${spark?'✅ 讯飞星火':'⚠  关键词模式（未配置讯飞）'}\n`);
});

// ─── 讯飞 IAT WebSocket 代理 ─────────────────────────────────────────────────
const wssXunfei = new WebSocket.Server({ noServer: true });
wssXunfei.on('connection', (clientWs, req) => {
  console.log('[WSS] 客户端连接 ' + req.socket.remoteAddress);
  const appId = process.env.XFYUN_APP_ID;
  const apiKey = process.env.XFYUN_API_KEY;
  const apiSecret = process.env.XFYUN_API_SECRET;
  const host = 'iat-api.xfyun.cn';
  const date = new Date().toUTCString();
  const signStr = `host: ${host}\ndate: ${date}\nGET /v2/iat HTTP/1.1`;
  const sign = crypto.createHmac('sha256', apiSecret).update(signStr).digest('base64');
  const auth = Buffer.from(`api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${sign}"`).toString('base64');
  const xfUrl = `wss://${host}/v2/iat?authorization=${auth}&date=${encodeURIComponent(date)}&host=${host}`;
  
  const xfWs = new WebSocket(xfUrl);
  let started = false;
  let endPending = false;
  let fullText = '';
  const sentences = {};

  xfWs.on('open', () => {
    // 发送第一帧参数
    xfWs.send(JSON.stringify({
      common: {app_id: appId},
      business: {language:'zh_cn', domain:'iat', accent:'mandarin', dwa:'wpgs', vad_eos:4000,ptt:0,nunum:1},
      data: {status:0, format:'audio/L16;rate=16000', encoding:'raw', audio:''}
    }));
    started = true;
    clientWs.send(JSON.stringify({type:'ready'}));
    if (endPending) {
      xfWs.send(JSON.stringify({
        data: {status:2, format:'audio/L16;rate=16000', encoding:'raw', audio:''}
      }));
    }
  });

  xfWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.code !== 0) { clientWs.send(JSON.stringify({type:'error', msg: msg.message})); return; }
      const result = msg.data?.result;
      if (!result) return;
      const sn = result.sn;
      const ls = result.ls;
      const pgs = result.pgs;
      const ws = result.ws || [];
      const text = ws.map(w => w.cw?.[0]?.w || '').join('');
      
      if (pgs === 'rpl') {
        const rg = result.rg || [];
        for (let i = rg[0]; i <= rg[1]; i++) delete sentences[i];
      }
      sentences[sn] = text;
      
      const combined = Object.keys(sentences).sort((a,b)=>a-b).map(k=>sentences[k]).join('');
      clientWs.send(JSON.stringify({type:'result', text: combined, final: ls}));
      
      if (ls) {
        fullText = combined;
        clientWs.send(JSON.stringify({type:'done', text: fullText}));
      }
    } catch(e) {}
  });

  xfWs.on('error', (e) => clientWs.send(JSON.stringify({type:'error', msg: e.message})));
  xfWs.on('close', () => { if (clientWs.readyState === WebSocket.OPEN) clientWs.close(); });

  clientWs.on('message', (data) => {
    if (typeof data === 'string') {
      const msg = JSON.parse(data);
      if (msg.type === 'end') {
        console.log('[IAT-END] started='+started+' xfWs.readyState='+xfWs.readyState+' endPending='+endPending);
        if (started && xfWs.readyState === WebSocket.OPEN) {
          console.log('[IAT-END] 发送status:2');
          xfWs.send(JSON.stringify({
            data: {status:2, format:'audio/L16;rate=16000', encoding:'raw', audio:''}
          }));
        } else {
          endPending = true;
          console.log('[IAT-END] 标记endPending');
        }
      }
    } else {
      if (!started || xfWs.readyState !== WebSocket.OPEN) return;
      const audioB64 = data.toString('base64');
      xfWs.send(JSON.stringify({
        data: {status:1, format:'audio/L16;rate=16000', encoding:'raw', audio: audioB64}
      }));
    }
  });

  clientWs.on('close', () => {
    if (xfWs.readyState === WebSocket.OPEN) xfWs.close();
  });
});
