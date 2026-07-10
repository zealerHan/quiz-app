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
app.use(workshopRouter);
app.use(quizRouter);
app.use(adminRouter);

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
  console.log(`\n🚇 武汉地铁5号线 乘务考核系统 v3\n${'═'.repeat(40)}`);
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
