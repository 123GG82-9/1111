(() => {
  const STORAGE_KEYS = {
    rows: 'gr_rows',
    history: 'gr_submit_history',
    images: 'gr_image_library',
    templates: 'gr_templates',
    lastState: 'gr_last_state',
    operatorList: 'gr_selected_operator_list',
    errors: 'gr_errors'
  };

  const state = {
    rows: [],
    running: false,
    stopRequested: false,
    activeTabId: null
  };

  const $ = (id) => document.getElementById(id);
  const ui = {
    taskType: $('taskType'),
    batchSize: $('batchSize'),
    startIndex: $('startIndex'),
    operatorInput: $('operatorInput'),
    excelFile: $('excelFile'),
    imageFiles: $('imageFiles'),
    runBtn: $('runBtn'),
    resumeBtn: $('resumeBtn'),
    stopBtn: $('stopBtn'),
    importExcelBtn: $('importExcelBtn'),
    saveImagesBtn: $('saveImagesBtn'),
    openAccountsBtn: $('openAccountsBtn'),
    statusLine: $('statusLine'),
    previewTable: $('previewTable'),
    logBox: $('logBox'),
    errorBox: $('errorBox'),
    refreshTabBtn: $('refreshTabBtn'),
    saveTemplateBtn: $('saveTemplateBtn'),
    loadTemplateBtn: $('loadTemplateBtn'),
    clearHistoryBtn: $('clearHistoryBtn'),
    exportHistoryBtn: $('exportHistoryBtn'),
    clearErrorBtn: $('clearErrorBtn')
  };

  function nowText() {
    return new Date().toLocaleString('zh-CN', { hour12: false });
  }

  function addLog(message, level = 'info', extra) {
    const line = `[${nowText()}] [${level}] ${message}` + (extra ? ` ${JSON.stringify(extra)}` : '');
    ui.logBox.textContent += `${line}\n`;
    ui.logBox.scrollTop = ui.logBox.scrollHeight;
  }

  async function addError(message, extra) {
    const current = await chrome.storage.local.get([STORAGE_KEYS.errors]);
    const arr = Array.isArray(current[STORAGE_KEYS.errors]) ? current[STORAGE_KEYS.errors] : [];
    arr.push({ at: Date.now(), message, extra: extra || null });
    await chrome.storage.local.set({ [STORAGE_KEYS.errors]: arr.slice(-300) });
    renderErrors(arr);
  }

  function setStatus(message, cls) {
    ui.statusLine.textContent = message;
    ui.statusLine.className = cls || 'muted';
  }

  function parseOperatorNames(raw) {
    return String(raw || '')
      .split(/[\n,，;；]/g)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async function getActiveTabId() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || !tabs.length) throw new Error('未找到当前激活标签页');
    return tabs[0].id;
  }

  async function sendToTab(tabId, payload) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, payload, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(resp || {});
      });
    });
  }

  function renderRows(rows) {
    const head = ui.previewTable.querySelector('thead');
    const body = ui.previewTable.querySelector('tbody');
    head.innerHTML = '';
    body.innerHTML = '';
    if (!rows.length) return;
    const cols = Object.keys(rows[0]);
    const hr = document.createElement('tr');
    cols.forEach((c) => {
      const th = document.createElement('th');
      th.textContent = c;
      hr.appendChild(th);
    });
    head.appendChild(hr);
    rows.slice(0, 120).forEach((row) => {
      const tr = document.createElement('tr');
      cols.forEach((c) => {
        const td = document.createElement('td');
        td.textContent = row[c] == null ? '' : String(row[c]);
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
  }

  function readRowsFromXlsxFile(file) {
    return new Promise((resolve, reject) => {
      if (!window.XLSX) {
        reject(new Error('缺少 lib/xlsx.full.min.js')); return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const wb = XLSX.read(reader.result, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
          resolve(rows);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(new Error('读取 Excel 失败'));
      reader.readAsArrayBuffer(file);
    });
  }

  async function persistState(partial) {
    const nextState = {
      taskType: ui.taskType.value,
      batchSize: Number(ui.batchSize.value) || 20,
      startIndex: Number(ui.startIndex.value) || 0,
      operators: ui.operatorInput.value,
      ...partial
    };
    await chrome.storage.local.set({ [STORAGE_KEYS.lastState]: nextState });
  }

  async function restoreState() {
    const result = await chrome.storage.local.get([STORAGE_KEYS.lastState, STORAGE_KEYS.rows, STORAGE_KEYS.errors]);
    const s = result[STORAGE_KEYS.lastState] || {};
    ui.taskType.value = s.taskType || 'bank';
    ui.batchSize.value = s.batchSize || 20;
    ui.startIndex.value = s.startIndex || 0;
    ui.operatorInput.value = s.operators || '';
    state.rows = Array.isArray(result[STORAGE_KEYS.rows]) ? result[STORAGE_KEYS.rows] : [];
    renderRows(state.rows);
    renderErrors(Array.isArray(result[STORAGE_KEYS.errors]) ? result[STORAGE_KEYS.errors] : []);
  }

  function renderErrors(errors) {
    ui.errorBox.textContent = (errors || []).slice(-200).map((e) => {
      const at = new Date(e.at || Date.now()).toLocaleString('zh-CN', { hour12: false });
      return `[${at}] ${e.message}${e.extra ? ` ${JSON.stringify(e.extra)}` : ''}`;
    }).join('\n');
    ui.errorBox.scrollTop = ui.errorBox.scrollHeight;
  }

  async function runAutoStep(stepIndex) {
    const rows = state.rows;
    if (!rows.length) throw new Error('无可提交数据');
    const start = Number(ui.startIndex.value) || 0;
    const batchSize = Math.max(1, Number(ui.batchSize.value) || 20);
    const batchRows = rows.slice(start, start + batchSize);
    const operatorNames = parseOperatorNames(ui.operatorInput.value);

    if (!operatorNames.length) {
      throw new Error('经办警官不能为空，且支持多个姓名');
    }

    await chrome.storage.local.set({ [STORAGE_KEYS.operatorList]: operatorNames });

    const tabId = state.activeTabId || await getActiveTabId();
    state.activeTabId = tabId;

    addLog('STEP_OPEN_OPERATOR_PICKER', 'info', { operatorNames, stepIndex });
    const picker = await sendToTab(tabId, { action: 'OPEN_OPERATOR_PICKER', operatorNames });
    if (!picker || picker.ok !== true) {
      const reason = picker?.reason || picker?.error || '经办警官选择失败';
      await addError('OPEN_OPERATOR_PICKER 失败，已暂停提交', { stepIndex, reason });
      throw new Error(reason);
    }

    const payload = {
      action: 'FILL_FORM',
      rows: batchRows,
      startIndex: start,
      mode: ui.taskType.value,
      operatorNames
    };

    addLog('STEP_FILL_FORM', 'info', { rows: batchRows.length, startIndex: start });
    const result = await sendToTab(tabId, payload);
    if (!result || result.ok !== true) {
      const reason = result?.error || result?.reason || '填充失败';
      await addError('FILL_FORM 失败', { stepIndex, reason, result });
      throw new Error(reason);
    }

    const nextStart = start + batchRows.length;
    ui.startIndex.value = String(nextStart);
    await persistState({ startIndex: nextStart });
    await appendHistory({
      at: Date.now(),
      taskType: ui.taskType.value,
      start,
      size: batchRows.length,
      operatorNames,
      result
    });
    addLog('STEP_SUCCESS', 'ok', { stepIndex, start, size: batchRows.length });
    return result;
  }

  async function appendHistory(item) {
    const r = await chrome.storage.local.get([STORAGE_KEYS.history]);
    const arr = Array.isArray(r[STORAGE_KEYS.history]) ? r[STORAGE_KEYS.history] : [];
    arr.push(item);
    await chrome.storage.local.set({ [STORAGE_KEYS.history]: arr.slice(-1000) });
  }

  async function runBatches({ resume = false } = {}) {
    if (state.running) return;
    state.running = true;
    state.stopRequested = false;
    setStatus('任务执行中...', 'status-warn');
    try {
      if (!resume) await persistState();
      let step = 0;
      while (!state.stopRequested) {
        const start = Number(ui.startIndex.value) || 0;
        if (start >= state.rows.length) break;
        await runAutoStep(step++);
      }
      if (state.stopRequested) {
        setStatus('已暂停，可继续断点续传', 'status-warn');
      } else {
        setStatus('全部批次完成', 'status-ok');
      }
    } catch (error) {
      setStatus(`执行失败：${error.message}`, 'status-err');
      await addError('运行中断', { message: error.message });
    } finally {
      state.running = false;
    }
  }

  function onImportExcel() {
    const file = ui.excelFile.files?.[0];
    if (!file) {
      setStatus('请先选择 Excel 文件', 'status-warn');
      return;
    }
    readRowsFromXlsxFile(file)
      .then(async (rows) => {
        state.rows = rows;
        renderRows(rows);
        await chrome.storage.local.set({ [STORAGE_KEYS.rows]: rows });
        setStatus(`已导入 ${rows.length} 行`, 'status-ok');
        addLog('IMPORT_EXCEL', 'info', { file: file.name, rows: rows.length });
      })
      .catch(async (error) => {
        setStatus(`导入失败：${error.message}`, 'status-err');
        await addError('Excel 导入失败', { message: error.message });
      });
  }

  function onSaveImages() {
    const files = Array.from(ui.imageFiles.files || []);
    if (!files.length) {
      setStatus('未选择图片素材', 'status-warn');
      return;
    }
    const readers = files.map((file) => new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve({ name: file.name, type: file.type, data: fr.result });
      fr.onerror = () => reject(new Error(`读取失败:${file.name}`));
      fr.readAsDataURL(file);
    }));
    Promise.all(readers).then(async (images) => {
      await chrome.storage.local.set({ [STORAGE_KEYS.images]: images });
      setStatus(`素材库已保存 ${images.length} 张图片`, 'status-ok');
      addLog('SAVE_IMAGES', 'info', { size: images.length });
    }).catch(async (error) => {
      setStatus(error.message, 'status-err');
      await addError('图片素材保存失败', { message: error.message });
    });
  }

  async function exportHistory() {
    const result = await chrome.storage.local.get([STORAGE_KEYS.history]);
    const text = JSON.stringify(result[STORAGE_KEYS.history] || [], null, 2);
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `submit-history-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function clearHistory() {
    await chrome.storage.local.remove([STORAGE_KEYS.history]);
    addLog('CLEAR_HISTORY', 'info');
  }

  async function clearErrors() {
    await chrome.storage.local.remove([STORAGE_KEYS.errors]);
    renderErrors([]);
    setStatus('异常记录已清空', 'status-ok');
  }

  async function saveTemplate() {
    const name = prompt('输入模板名称', 'default');
    if (!name) return;
    const data = {
      taskType: ui.taskType.value,
      batchSize: Number(ui.batchSize.value) || 20,
      operators: ui.operatorInput.value
    };
    const result = await chrome.storage.local.get([STORAGE_KEYS.templates]);
    const templates = result[STORAGE_KEYS.templates] || {};
    templates[name] = data;
    await chrome.storage.local.set({ [STORAGE_KEYS.templates]: templates });
    setStatus(`模板已保存：${name}`, 'status-ok');
  }

  async function loadTemplate() {
    const result = await chrome.storage.local.get([STORAGE_KEYS.templates]);
    const templates = result[STORAGE_KEYS.templates] || {};
    const names = Object.keys(templates);
    if (!names.length) {
      setStatus('无可用模板', 'status-warn');
      return;
    }
    const name = prompt(`输入模板名称：${names.join(', ')}`, names[0]);
    if (!name || !templates[name]) {
      setStatus('模板不存在', 'status-warn');
      return;
    }
    const t = templates[name];
    ui.taskType.value = t.taskType || 'bank';
    ui.batchSize.value = t.batchSize || 20;
    ui.operatorInput.value = t.operators || '';
    await persistState();
    setStatus(`模板已载入：${name}`, 'status-ok');
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.action !== 'REPORT_STATUS') return;
    const level = msg.level || 'info';
    addLog(msg.type || 'STATUS', level, msg.payload);
    if (level === 'error') addError(msg.message || msg.type || '未知错误', msg.payload);
  });

  ui.importExcelBtn.addEventListener('click', onImportExcel);
  ui.saveImagesBtn.addEventListener('click', onSaveImages);
  ui.runBtn.addEventListener('click', () => runBatches({ resume: false }));
  ui.resumeBtn.addEventListener('click', () => runBatches({ resume: true }));
  ui.stopBtn.addEventListener('click', () => { state.stopRequested = true; setStatus('正在请求暂停...', 'status-warn'); });
  ui.openAccountsBtn.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'OPEN_ACCOUNTS_PAGE', category: ui.taskType.value }));
  ui.refreshTabBtn.addEventListener('click', async () => {
    try {
      state.activeTabId = await getActiveTabId();
      setStatus(`已连接标签页 ${state.activeTabId}`, 'status-ok');
    } catch (error) {
      setStatus(error.message, 'status-err');
    }
  });
  ui.saveTemplateBtn.addEventListener('click', saveTemplate);
  ui.loadTemplateBtn.addEventListener('click', loadTemplate);
  ui.clearHistoryBtn.addEventListener('click', clearHistory);
  ui.exportHistoryBtn.addEventListener('click', exportHistory);
  ui.clearErrorBtn.addEventListener('click', clearErrors);

  restoreState().then(() => {
    setStatus('控制台就绪', 'status-ok');
    addLog('DASHBOARD_READY', 'ok');
  }).catch((error) => {
    setStatus(`初始化失败：${error.message}`, 'status-err');
  });
})();
