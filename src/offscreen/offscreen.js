/**
 * offscreen document：MediaRecorder + 用 <a download> 触发下载
 *
 * 关键点：
 *   - SW 没有 URL.createObjectURL，offscreen 有 DOM 上下文，所以让 offscreen
 *     自己创建 blob URL 并通过隐藏 <a download> 触发浏览器原生下载。
 *   - 视频不再单独下载，finalize 后把 Blob 缓存到 lastVideoBlob，
 *     由 background 在 export 阶段读取并打到 zip 里。
 *   - stop 严格时序：requestData() → 等 dataavailable → stop() → 等 onstop → finalize。
 */

const MSG = {
  OFFSCREEN_START: 'offscreen/start',
  OFFSCREEN_STOP: 'offscreen/stop',
  OFFSCREEN_PING: 'offscreen/ping',
  OFFSCREEN_DOWNLOAD: 'offscreen/download',
  OFFSCREEN_DOWNLOAD_ZIP: 'offscreen/download-zip',
  OFFSCREEN_GET_VIDEO: 'offscreen/get-video',
};

let recorder = null;
let stream = null;
let chunks = [];
let mimeType = 'video/webm';
let baseName = '';
let lastVideoBlob = null;   // finalize 后保留，供 export 打 zip 用
let lastVideoMime = '';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen') return false;
  (async () => {
    try {
      if (msg.cmd === MSG.OFFSCREEN_START) {
        await startRec(msg.streamId, msg.baseName);
        sendResponse({ ok: true });
      } else if (msg.cmd === MSG.OFFSCREEN_STOP) {
        await stopRec();
        sendResponse({ ok: true });
      } else if (msg.cmd === MSG.OFFSCREEN_PING) {
        sendResponse({ ok: true, alive: true, recording: !!recorder && recorder.state === 'recording' });
      } else if (msg.cmd === MSG.OFFSCREEN_DOWNLOAD) {
        downloadText(msg.filename, msg.text, msg.mime || 'text/plain');
        sendResponse({ ok: true });
      } else if (msg.cmd === MSG.OFFSCREEN_DOWNLOAD_ZIP) {
        const bytes = base64ToBytes(msg.base64);
        const blob = new Blob([bytes], { type: 'application/zip' });
        const url = URL.createObjectURL(blob);
        triggerDownload(url, msg.filename);
        setTimeout(() => { try { URL.revokeObjectURL(url); } catch {} }, 60_000);
        sendResponse({ ok: true });
      } else if (msg.cmd === MSG.OFFSCREEN_GET_VIDEO) {
        if (!lastVideoBlob) {
          sendResponse({ ok: false, error: 'no video' });
          return;
        }
        const b64 = await blobToBase64(lastVideoBlob);
        sendResponse({ ok: true, base64: b64, mime: lastVideoMime, size: lastVideoBlob.size });
      }
    } catch (e) {
      console.error('[offscreen]', e);
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
  })();
  return true;
});

async function startRec(streamId, externalBaseName) {
  if (recorder) await stopRec();
  chunks = [];
  lastVideoBlob = null;
  lastVideoMime = '';
  baseName = externalBaseName || `recording-${new Date().toISOString().replace(/[:.]/g, '-')}`;

  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    },
  });

  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  mimeType = candidates.find(t => MediaRecorder.isTypeSupported(t)) || 'video/webm';

  recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_500_000 });
  recorder.ondataavailable = ev => {
    if (ev.data && ev.data.size) chunks.push(ev.data);
  };
  recorder.onerror = e => console.error('[offscreen] recorder error', e);

  stream.getTracks().forEach(t => {
    t.onended = () => {
      console.warn('[offscreen] track ended');
      if (recorder && recorder.state === 'recording') {
        try { recorder.requestData(); } catch {}
        try { recorder.stop(); } catch {}
      }
    };
  });

  recorder.start(1000);
  console.log('[offscreen] recording started, mime=', mimeType);
}

async function stopRec() {
  if (!recorder) { cleanup(); return; }
  if (recorder.state === 'inactive') { await finalize(); return; }

  await new Promise(resolve => {
    let done = false;
    const finish = async () => {
      if (done) return;
      done = true;
      try { await finalize(); } finally { resolve(); }
    };
    recorder.addEventListener('stop', finish, { once: true });
    const timer = setTimeout(() => {
      console.warn('[offscreen] stop timeout, force finalize');
      finish();
    }, 5000);
    recorder.addEventListener('stop', () => clearTimeout(timer), { once: true });

    try {
      recorder.requestData();
      setTimeout(() => {
        try { recorder.stop(); }
        catch (e) { console.error('[offscreen] stop error', e); finish(); }
      }, 200);
    } catch (e) {
      console.error('[offscreen] requestData error', e);
      try { recorder.stop(); } catch {}
    }
  });
}

async function finalize() {
  console.log(`[offscreen] finalize, chunks=${chunks.length}`);
  if (!chunks.length) { cleanup(); return; }
  try {
    const blob = new Blob(chunks, { type: mimeType });
    lastVideoBlob = blob;
    lastVideoMime = mimeType;
    console.log(`[offscreen] video Blob ready, size=${blob.size}b, mime=${mimeType}`);
  } catch (e) {
    console.error('[offscreen] finalize failed', e);
  } finally {
    cleanup();
  }
}

function triggerDownload(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 1000);
}

function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function cleanup() {
  if (stream) {
    stream.getTracks().forEach(t => { try { t.stop(); } catch {} });
    stream = null;
  }
  recorder = null;
  chunks = [];
  // 注意：不清 lastVideoBlob，留给 export 用；下次 startRec 才清
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = r.result || '';
      const i = String(s).indexOf(',');
      resolve(i >= 0 ? String(s).slice(i + 1) : '');
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

self.addEventListener('beforeunload', () => {
  if (recorder && recorder.state === 'recording') {
    try { recorder.requestData(); } catch {}
    try { recorder.stop(); } catch {}
  }
});
