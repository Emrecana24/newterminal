(function() {
  'use strict';

  const state = {
    url: localStorage.getItem('cs_url') || '',
    token: localStorage.getItem('cs_token') || '',
    geminiKey: localStorage.getItem('gemini_key') || '',
    customModel: localStorage.getItem('custom_model') || '',
    confirmDanger: localStorage.getItem('confirm_danger') !== 'false',
    fontSize: parseInt(localStorage.getItem('font_size') || '13', 10),
    keepAwake: localStorage.getItem('keep_awake') === 'true',
    activeTab: 'terminal',
    sid: sessionStorage.getItem('cs_sid') || '',
    currentPath: localStorage.getItem('cs_last_path') || '/workspaces/newterminal',
    showHiddenFiles: false,
    files: [],
    aiHistory: [],
    activeRuns: {}
  };

  let term = null;
  let fitAddon = null;
  let ws = null;
  let reconnectTimer = null;
  let pingTimer = null;

  function showToast(text) {
    const box = document.getElementById('toasts');
    if (!box) return;
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    box.appendChild(t);
    setTimeout(() => t.remove(), 2500);
  }

  function updatePill(tabEl) {
    const pill = document.getElementById('tab-pill');
    if (!pill || !tabEl) return;
    pill.style.transform = 'translateX(' + tabEl.offsetLeft + 'px)';
    pill.style.width = tabEl.offsetWidth + 'px';
  }

  function switchTab(tabName) {
    state.activeTab = tabName;
    document.body.setAttribute('data-tab', tabName);
    document.querySelectorAll('.tab').forEach(t => {
      const active = t.dataset.tab === tabName;
      t.classList.toggle('active', active);
      if (active) updatePill(t);
    });

    if (tabName === 'terminal' || tabName === 'ai') {
      setTimeout(() => {
        if (term && fitAddon) {
          fitAddon.fit();
          sendResize();
        }
      }, 60);
    }
    if (tabName === 'files' && state.url && state.token) {
      loadFiles(state.currentPath);
    }
  }

  function setStatus(st, txt) {
    const dot = document.getElementById('status-dot');
    const label = document.getElementById('conn-text');
    if (dot) {
      dot.className = '';
      if (st === 'on') dot.className = 'on';
      else if (st === 'connecting') dot.className = 'connecting';
      else dot.className = 'off';
    }
    if (label) label.textContent = txt;
  }

  // --- Terminal & WebSocket ---
  function initTerminal() {
    const view = document.getElementById('terminal-view');
    if (!view || term) return;

    term = new Terminal({
      cursorBlink: true,
      fontSize: state.fontSize,
      fontFamily: '"Droid Sans Mono", Menlo, Consolas, monospace',
      theme: {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor: '#58a6ff',
        selectionBackground: 'rgba(88, 166, 255, 0.3)'
      }
    });

    fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(view);
    fitAddon.fit();

    term.onData(data => sendInput(data));

    window.addEventListener('resize', () => {
      if (fitAddon) {
        fitAddon.fit();
        sendResize();
      }
    });
  }

  function sendResize() {
    if (ws && ws.readyState === WebSocket.OPEN && term) {
      ws.send(JSON.stringify({ t: 'resize', cols: term.cols, rows: term.rows }));
    }
  }

  function sendInput(data) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ t: 'i', d: data }));
  }

  function connectWS() {
    if (!state.url) {
      setStatus('off', 'Kurulum');
      openSettings();
      return;
    }

    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;

    clearTimeout(reconnectTimer);
    clearInterval(pingTimer);
    setStatus('connecting', 'Bağlanıyor...');

    let clean = state.url.trim().replace(/\/$/, '');
    let proto = clean.startsWith('https') ? 'wss:' : 'ws:';
    let host = clean.replace(/^https?:\/\//, '');
    let sidParam = state.sid ? '&sid=' + encodeURIComponent(state.sid) : '';
    let wsUrl = proto + '//' + host + '/?token=' + encodeURIComponent(state.token) + sidParam;

    try {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        setStatus('on', 'Bağlı');
        sendResize();
        pingTimer = setInterval(() => {
          if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'ping' }));
        }, 25000);
      };

      ws.onmessage = e => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.t === 'hello') {
            state.sid = msg.sid;
            sessionStorage.setItem('cs_sid', msg.sid);
            if (msg.replay && term) term.write(msg.replay);
          } else if (msg.t === 'o' && msg.d) {
            if (term) term.write(msg.d);
          }
        } catch (_) {
          if (term) term.write(e.data);
        }
      };

      ws.onclose = () => {
        setStatus('off', 'Koptu');
        clearInterval(pingTimer);
        reconnectTimer = setTimeout(connectWS, 3500);
      };

      ws.onerror = () => setStatus('off', 'Hata');
    } catch (_) {
      setStatus('off', 'Hata');
      reconnectTimer = setTimeout(connectWS, 3500);
    }
  }

  function apiFetch(endpoint, options = {}) {
    const base = state.url.trim().replace(/\/$/, '');
    const headers = options.headers || {};
    headers['Authorization'] = 'Bearer ' + state.token;
    return fetch(base + endpoint, { ...options, headers });
  }

  // --- Dosya Gezgini ---
  async function loadFiles(path) {
    if (!state.url) return;
    const listEl = document.getElementById('file-list');
    const pathEl = document.getElementById('current-path');
    listEl.innerHTML = '<div style="padding:16px;text-align:center;color:var(--mut);">Dosyalar listeleniyor...</div>';

    state.currentPath = path || '/workspaces/newterminal';
    localStorage.setItem('cs_last_path', state.currentPath);
    pathEl.textContent = state.currentPath;

    try {
      const res = await apiFetch('/api/list?path=' + encodeURIComponent(state.currentPath));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      state.files = Array.isArray(data) ? data : [];
      renderFiles();
    } catch (err) {
      listEl.innerHTML = '<div style="padding:16px;text-align:center;color:var(--err);">Dizin okunamadı: ' + err.message + '</div>';
    }
  }

  function renderFiles() {
    const listEl = document.getElementById('file-list');
    const q = (document.getElementById('f-filter').value || '').toLowerCase();
    listEl.innerHTML = '';

    const filtered = state.files.filter(f => {
      if (!state.showHiddenFiles && f.name.startsWith('.')) return false;
      if (q && !f.name.toLowerCase().includes(q)) return false;
      return true;
    });

    if (filtered.length === 0) {
      listEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--mut);">Bu dizinde dosya yok</div>';
      return;
    }

    filtered.forEach(item => {
      const el = document.createElement('div');
      el.className = 'file rp';

      let sizeTxt = item.isDir ? 'Klasör' : formatBytes(item.size);
      el.innerHTML = `
        <div class="f-ic">${item.isDir ? '📁' : '📄'}</div>
        <div class="f-info">
          <div class="f-name">${item.name}</div>
          <div class="f-meta">${sizeTxt}</div>
        </div>
        <div class="f-go">${item.isDir ? '›' : '⋮'}</div>
      `;

      el.onclick = () => {
        if (item.isDir) {
          const next = (state.currentPath === '/' ? '' : state.currentPath) + '/' + item.name;
          loadFiles(next);
        } else {
          openFileActionSheet(item);
        }
      };

      let pressTimer = null;
      el.addEventListener('touchstart', () => {
        pressTimer = setTimeout(() => {
          if (window.AndroidBridge && window.AndroidBridge.vibrate) window.AndroidBridge.vibrate(40);
          openFileActionSheet(item);
        }, 500);
      }, { passive: true });
      el.addEventListener('touchend', () => clearTimeout(pressTimer));
      el.addEventListener('touchmove', () => clearTimeout(pressTimer));

      listEl.appendChild(el);
    });
  }

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function openFileActionSheet(item) {
    const sheet = document.getElementById('sheet');
    document.getElementById('sheet-title').textContent = item.name;
    document.getElementById('sheet-sub').textContent = state.currentPath;
    const actions = document.getElementById('sheet-actions');
    const fullItemPath = (state.currentPath === '/' ? '' : state.currentPath) + '/' + item.name;

    if (item.isDir) {
      actions.innerHTML = `
        <button id="sh-enter-dir" class="s-act rp"><span class="ai">📂</span> Klasörün İçine Gir</button>
        <button id="sh-dl-dir" class="s-act rp"><span class="ai">📦</span> Bu Klasörü İndir (.tar.gz Arşivi)</button>
        <button id="sh-copy-dir" class="s-act rp"><span class="ai">📋</span> Klasör Yolunu Kopyala</button>
        <button id="sh-cancel" class="s-act cancel rp">İptal</button>
      `;
      document.getElementById('sh-enter-dir').onclick = () => { sheet.classList.remove('open'); loadFiles(fullItemPath); };
      document.getElementById('sh-dl-dir').onclick = () => { sheet.classList.remove('open'); downloadUrl(fullItemPath, item.name + '.tar.gz'); };
      document.getElementById('sh-copy-dir').onclick = () => { sheet.classList.remove('open'); copyToClipboard(fullItemPath); };
    } else {
      actions.innerHTML = `
        <button id="sh-read-file" class="s-act rp"><span class="ai">📖</span> Metin Olarak Oku (Txt Okuyucu)</button>
        <button id="sh-dl-file" class="s-act rp"><span class="ai">⬇️</span> Bu Dosyayı İndir</button>
        <button id="sh-copy-file" class="s-act rp"><span class="ai">📋</span> Dosya Yolunu Kopyala</button>
        <button id="sh-cancel" class="s-act cancel rp">İptal</button>
      `;
      document.getElementById('sh-read-file').onclick = () => { sheet.classList.remove('open'); openInTxtReader(fullItemPath, item.name); };
      document.getElementById('sh-dl-file').onclick = () => { sheet.classList.remove('open'); downloadUrl(fullItemPath, item.name); };
      document.getElementById('sh-copy-file').onclick = () => { sheet.classList.remove('open'); copyToClipboard(fullItemPath); };
    }

    document.getElementById('sh-cancel').onclick = () => sheet.classList.remove('open');
    sheet.classList.add('open');
  }

  async function openInTxtReader(fullPath, name) {
    try {
      showToast('Dosya okunuyor...');
      const res = await apiFetch('/api/read?path=' + encodeURIComponent(fullPath));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      document.getElementById('reader-title').textContent = name;
      document.getElementById('reader-content').textContent = text || '(Dosya boş)';
      document.getElementById('reader').classList.add('open');
    } catch (e) {
      showToast('Okuma hatası: ' + e.message);
    }
  }

  function downloadUrl(fullPath, name) {
    const base = state.url.trim().replace(/\/$/, '');
    const dlLink = base + '/api/download?path=' + encodeURIComponent(fullPath);
    if (window.AndroidBridge && window.AndroidBridge.downloadFile) {
      window.AndroidBridge.downloadFile(dlLink, name, state.token);
    } else {
      window.open(dlLink, '_blank');
    }
  }

  function copyToClipboard(text) {
    if (window.AndroidBridge && window.AndroidBridge.copyText) {
      window.AndroidBridge.copyText(text);
    } else {
      navigator.clipboard.writeText(text);
    }
    showToast('Kopyalandı');
  }

  // --- Gemini AI Terminal Ajanı (Düzeltilmiş Standart Rol Yapısı) ---
  const sysPrompt = "Sen GitHub Codespace Linux terminalini doğrudan yöneten bir yapay zekâ asistanısın. " +
    "Kullanıcı senden sistem bilgisi, donanım, dosya durumu veya herhangi bir işlem istediğinde tahmin yürütme; 'exec_command' aracını çağırarak bash komutunu çalıştır. " +
    "Komut çıktısı sana dönecektir. Çıktıyı inceleyip kullanıcıya Türkçe, net ve eksiksiz olarak açıkla.";

  function isDangerous(cmd) {
    return /\b(rm\s+-[rfRF]+|sudo|mkfs|dd\s+if=|git\s+push\s+.*--force|shutdown|reboot)\b/i.test(cmd);
  }

  function addActionCard(cmd, isDanger) {
    const box = document.getElementById('ai-messages');
    const card = document.createElement('div');
    card.className = 'card' + (isDanger ? ' warn' : ' running');
    card.innerHTML = `
      <div class="card-head">
        <span class="card-ic">▶</span>
        <span class="card-cmd">${cmd}</span>
        <span class="card-st">${isDanger ? 'Onay Bekliyor' : 'Çalışıyor...'}</span>
      </div>
      <div class="card-confirm ${isDanger ? 'show' : ''}">
        <div>⚠️ Bu komut sistemde kritik değişiklikler yapabilir. Çalıştırılsın mı?</div>
        <div class="row">
          <button class="btn primary rp btn-accept">Onayla ve Çalıştır</button>
          <button class="btn danger rp btn-deny">Reddet</button>
        </div>
      </div>
      <pre class="card-out"></pre>
    `;
    box.appendChild(card);
    card.querySelector('.card-head').onclick = () => card.classList.toggle('open');
    box.scrollTop = box.scrollHeight;
    return card;
  }

  async function callGeminiWithRetry(contents, runObj, typingBox) {
    const modelSelect = document.getElementById('ai-model').value;
    const model = (modelSelect === 'custom' && state.customModel) ? state.customModel : modelSelect;
    const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(state.geminiKey);

    const tools = [{
      functionDeclarations: [{
        name: "exec_command",
        description: "Codespace terminalinde bash komutu çalıştırır ve çıktısını (stdout, stderr, exitCode) döner.",
        parameters: {
          type: "OBJECT",
          properties: { command: { type: "STRING", description: "Çalıştırılacak Linux bash komutu (örn: uname -a, lscpu, free -h, cat /etc/os-release)" } },
          required: ["command"]
        }
      }]
    }];

    const retryDelays = [0, 10, 30, 60];

    for (let attempt = 0; attempt < retryDelays.length; attempt++) {
      if (runObj.cancelled) throw new Error('Durduruldu');

      if (retryDelays[attempt] > 0) {
        let remaining = retryDelays[attempt];
        while (remaining > 0) {
          if (runObj.cancelled) throw new Error('Durduruldu');
          if (typingBox) {
            let badge = typingBox.querySelector('.ai-timer');
            if (badge) badge.textContent = '⏱ Yeniden deneniyor (' + remaining + 's) [' + attempt + '/3]';
          }
          await new Promise(r => setTimeout(r, 1000));
          remaining--;
        }
      }

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          signal: runObj.controller.signal,
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': state.geminiKey
          },
          body: JSON.stringify({
            contents: contents,
            tools: tools,
            systemInstruction: { parts: [{ text: sysPrompt }] }
          })
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error ? errData.error.message : 'API Hatası (' + res.status + ')');
        }

        return await res.json();
      } catch (err) {
        if (runObj.cancelled || err.name === 'AbortError') throw new Error('Durduruldu');
        if (attempt === retryDelays.length - 1) throw err;
      }
    }
  }

  async function runAgent(userText) {
    if (!state.geminiKey) {
      showToast('Lütfen ayarlardan Gemini API anahtarını girin');
      openSettings();
      return;
    }

    const runId = 'r_' + Date.now();
    const runObj = { controller: new AbortController(), cancelled: false, timer: null };
    state.activeRuns[runId] = runObj;

    const box = document.getElementById('ai-messages');
    const uMsg = document.createElement('div');
    uMsg.className = 'msg user';
    uMsg.innerHTML = `
      <div>${userText}</div>
      <div class="msg-actions">
        <button class="msg-btn stop btn-stop-r">⏹ Durdur</button>
        <button class="msg-btn copy btn-copy-r">📋 Kopyala</button>
      </div>
    `;
    box.appendChild(uMsg);

    uMsg.querySelector('.btn-stop-r').onclick = () => {
      runObj.cancelled = true;
      runObj.controller.abort();
      showToast('İstek durduruldu');
    };
    uMsg.querySelector('.btn-copy-r').onclick = () => copyToClipboard(userText);

    state.aiHistory.push({ role: 'user', parts: [{ text: userText }] });

    const startTime = Date.now();
    let steps = 0;
    const maxSteps = 8;

    try {
      while (steps < maxSteps) {
        if (runObj.cancelled) break;
        steps++;

        const typing = document.createElement('div');
        typing.className = 'msg ai typing';
        typing.innerHTML = '<i></i><i></i><i></i><div class="ai-timer">⏱ Düşünülüyor: <span class="sec-c">0.0s</span></div>';
        box.appendChild(typing);
        box.scrollTop = box.scrollHeight;

        const secEl = typing.querySelector('.sec-c');
        runObj.timer = setInterval(() => {
          if (secEl) secEl.textContent = ((Date.now() - startTime) / 1000).toFixed(1) + 's';
        }, 100);

        const data = await callGeminiWithRetry(state.aiHistory, runObj, typing);
        clearInterval(runObj.timer);
        typing.remove();

        if (runObj.cancelled) break;

        const candidate = data.candidates && data.candidates[0];
        if (!candidate || !candidate.content) throw new Error('Modelden yanıt alınamadı');

        const modelMessage = candidate.content;
        state.aiHistory.push(modelMessage);

        const callPart = modelMessage.parts && modelMessage.parts.find(p => p.functionCall);
        const textPart = modelMessage.parts && modelMessage.parts.find(p => p.text);

        if (textPart) {
          const totalDur = ((Date.now() - startTime) / 1000).toFixed(1);
          const aiMsg = document.createElement('div');
          aiMsg.className = 'msg ai md';
          aiMsg.innerHTML = `
            <div>${textPart.text.replace(/\n/g, '<br>')}</div>
            <div class="msg-actions">
              <button class="msg-btn copy btn-copy-ai">📋 Kopyala</button>
              <span class="ai-meta-badge">⏱ ${totalDur}s</span>
            </div>
          `;
          aiMsg.querySelector('.btn-copy-ai').onclick = () => copyToClipboard(textPart.text);
          box.appendChild(aiMsg);
          box.scrollTop = box.scrollHeight;
        }

        if (callPart) {
          const call = callPart.functionCall;
          if (call.name === 'exec_command') {
            const cmd = call.args.command;
            const danger = state.confirmDanger && isDangerous(cmd);
            const card = addActionCard(cmd, danger);

            let allowed = !danger;
            if (danger) {
              allowed = await new Promise(resolve => {
                card.querySelector('.btn-accept').onclick = () => {
                  card.querySelector('.card-confirm').classList.remove('show');
                  resolve(true);
                };
                card.querySelector('.btn-deny').onclick = () => {
                  card.querySelector('.card-confirm').classList.remove('show');
                  resolve(false);
                };
              });
            }

            let toolResult = "";
            if (!allowed) {
              card.className = 'card denied';
              card.querySelector('.card-st').textContent = 'Kullanıcı Reddetti';
              toolResult = "Hata: Kullanıcı bu kritik komutun çalıştırılmasını güvenlik gerekçesiyle onaylamadı.";
            } else {
              // Canlı üst terminale yazdır
              if (term) {
                term.writeln('\r\n\x1b[1;35m[AI Ajanı]:\x1b[0m \x1b[1;33m' + cmd + '\x1b[0m');
              }

              try {
                const execRes = await apiFetch('/api/exec', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ cmd: cmd })
                }).then(r => r.json());

                const outText = (execRes.stdout || '') + (execRes.stderr ? ('\n[Hata]: ' + execRes.stderr) : '');

                if (term && outText.trim()) {
                  term.writeln(outText.trim().replace(/\n/g, '\r\n'));
                }

                card.className = 'card ok open';
                card.querySelector('.card-st').textContent = 'Tamamlandı (' + (execRes.exitCode || 0) + ')';
                card.querySelector('.card-out').textContent = outText || '(çıktı yok)';
                toolResult = outText || 'Komut çalıştırıldı (çıktı boş).';
              } catch (cmdErr) {
                card.className = 'card warn open';
                card.querySelector('.card-st').textContent = 'Hata';
                card.querySelector('.card-out').textContent = cmdErr.message;
                toolResult = 'Komut hatası: ' + cmdErr.message;
              }
            }

            // DÜZELTME: Gemini REST API protokolünde araç cevabı rolü 'user' olmak zorundadır!
            state.aiHistory.push({
              role: 'user',
              parts: [{
                functionResponse: {
                  name: "exec_command",
                  response: { output: toolResult }
                }
              }]
            });
            continue;
          }
        }
        break;
      }
    } catch (err) {
      if (runObj.timer) clearInterval(runObj.timer);
      const errMsg = document.createElement('div');
      errMsg.className = 'msg err';
      errMsg.textContent = err.message.includes('Durduruldu') ? '⏹ İstek durduruldu.' : 'Hata: ' + err.message;
      box.appendChild(errMsg);
    } finally {
      if (runObj.timer) clearInterval(runObj.timer);
      delete state.activeRuns[runId];
      const sBtn = uMsg.querySelector('.btn-stop-r');
      if (sBtn) sBtn.remove();
      box.scrollTop = box.scrollHeight;
    }
  }

  function initAI() {
    const select = document.getElementById('ai-model');
    select.innerHTML = `
      <option value="gemini-3.5-flash-lite" selected>Gemini 3.5 Flash-Lite (varsayılan)</option>
      <option value="gemini-3.6-flash">Gemini 3.6 Flash</option>
      <option value="gemini-3.8-flash">Gemini 3.8 Flash</option>
      <option value="custom">Özel Model</option>
    `;

    document.getElementById('btn-ai-clear').onclick = () => {
      state.aiHistory = [];
      document.getElementById('ai-messages').innerHTML = '<div style="text-align:center;color:var(--mut);padding:10px;">Hafıza temizlendi</div>';
    };

    document.getElementById('btn-ai-send').onclick = () => {
      const inp = document.getElementById('ai-input');
      const q = inp.value.trim();
      if (q) {
        inp.value = '';
        runAgent(q);
      }
    };

    document.getElementById('ai-input').addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        document.getElementById('btn-ai-send').click();
      }
    });

    // Bölücü Çubuğu (Splitter) Boyutlandırma
    let isDraggingSplitter = false;
    let startY = 0;
    let startH = 190;
    const splitter = document.getElementById('splitter');
    if (splitter) {
      const onStart = (clientY) => {
        isDraggingSplitter = true;
        startY = clientY;
        const termPane = document.getElementById('term-pane');
        startH = termPane ? termPane.offsetHeight : 190;
      };
      const onMove = (clientY) => {
        if (!isDraggingSplitter) return;
        const dy = clientY - startY;
        const newH = Math.max(80, Math.min(window.innerHeight * 0.65, startH + dy));
        document.documentElement.style.setProperty('--ai-term-h', newH + 'px');
        if (fitAddon) fitAddon.fit();
      };
      const onEnd = () => {
        if (isDraggingSplitter) {
          isDraggingSplitter = false;
          if (fitAddon) { fitAddon.fit(); sendResize(); }
        }
      };
      splitter.addEventListener('touchstart', e => onStart(e.touches[0].clientY), { passive: true });
      window.addEventListener('touchmove', e => { if (isDraggingSplitter) onMove(e.touches[0].clientY); }, { passive: true });
      window.addEventListener('touchend', onEnd);
      splitter.addEventListener('mousedown', e => onStart(e.clientY));
      window.addEventListener('mousemove', e => { if (isDraggingSplitter) onMove(e.clientY); });
      window.addEventListener('mouseup', onEnd);
    }
  }

  function openSettings() {
    document.getElementById('in-url').value = state.url;
    document.getElementById('in-token').value = state.token;
    document.getElementById('in-key').value = state.geminiKey;
    document.getElementById('in-custom').value = state.customModel;
    document.getElementById('font-label').textContent = state.fontSize + 'px';
    document.getElementById('settings').classList.add('open');
  }

  function closeSettings() {
    document.getElementById('settings').classList.remove('open');
  }

  function saveSettings() {
    state.url = document.getElementById('in-url').value.trim();
    state.token = document.getElementById('in-token').value.trim();
    state.geminiKey = document.getElementById('in-key').value.trim();
    state.customModel = document.getElementById('in-custom').value.trim();
    localStorage.setItem('cs_url', state.url);
    localStorage.setItem('cs_token', state.token);
    localStorage.setItem('gemini_key', state.geminiKey);
    localStorage.setItem('custom_model', state.customModel);
    closeSettings();
    showToast('Kaydedildi');
    if (ws) { ws.close(); ws = null; }
    connectWS();
  }

  window.handleBack = function() {
    const reader = document.getElementById('reader');
    const sheet = document.getElementById('sheet');
    const settings = document.getElementById('settings');
    if (reader && reader.classList.contains('open')) { reader.classList.remove('open'); return true; }
    if (sheet && sheet.classList.contains('open')) { sheet.classList.remove('open'); return true; }
    if (settings && settings.classList.contains('open')) { settings.classList.remove('open'); return true; }
    if (state.activeTab !== 'terminal') { switchTab('terminal'); return true; }
    return false;
  };

  document.addEventListener('DOMContentLoaded', () => {
    initTerminal();
    initAI();

    document.querySelectorAll('.tab').forEach(t => t.onclick = () => switchTab(t.dataset.tab));
    document.getElementById('conn-chip').onclick = openSettings;
    document.getElementById('btn-settings').onclick = openSettings;
    document.getElementById('btn-close-settings').onclick = closeSettings;
    document.getElementById('btn-save').onclick = saveSettings;

    document.getElementById('reader-copy').onclick = () => {
      const allText = document.getElementById('reader-content').textContent;
      copyToClipboard(allText);
    };
    document.getElementById('reader-close').onclick = () => document.getElementById('reader').classList.remove('open');

    document.getElementById('f-up').onclick = () => {
      if (state.currentPath === '/' || state.currentPath === '') return;
      const parts = state.currentPath.split('/').filter(Boolean);
      parts.pop();
      loadFiles(parts.length === 0 ? '/' : '/' + parts.join('/'));
    };
    document.getElementById('f-refresh').onclick = () => loadFiles(state.currentPath);
    document.getElementById('f-hidden').onclick = () => {
      state.showHiddenFiles = !state.showHiddenFiles;
      renderFiles();
    };
    document.getElementById('f-filter').oninput = renderFiles;

    setTimeout(connectWS, 300);
  });
})();
