(() => {
  const DB_NAME = 'gr_account_db';
  const DB_VERSION = 1;
  const STORE = 'accounts';

  const ui = {
    category: document.getElementById('category'),
    operators: document.getElementById('operators'),
    saveOperatorsBtn: document.getElementById('saveOperatorsBtn'),
    runBatchBtn: document.getElementById('runBatchBtn'),
    account: document.getElementById('account'),
    name: document.getElementById('name'),
    addBtn: document.getElementById('addBtn'),
    tableBody: document.querySelector('#accountTable tbody')
  };

  function parseOperatorNames(text) {
    return String(text || '')
      .split(/[\n,，;；]/g)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
          store.createIndex('category', 'category', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB 打开失败'));
    });
  }

  async function withStore(mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      const result = fn(store);
      tx.oncomplete = () => { db.close(); resolve(result); };
      tx.onerror = () => { db.close(); reject(tx.error || new Error('事务失败')); };
    });
  }

  async function addAccount(data) {
    await withStore('readwrite', (store) => store.add(data));
  }

  async function removeAccount(id) {
    await withStore('readwrite', (store) => store.delete(id));
  }

  async function getAllAccounts() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error || new Error('读取账号失败'));
      tx.oncomplete = () => db.close();
    });
  }

  async function renderTable() {
    const rows = await getAllAccounts();
    const currentCategory = ui.category.value;
    ui.tableBody.innerHTML = '';
    rows.filter((r) => r.category === currentCategory).forEach((r) => {
      const tr = document.createElement('tr');
      const tdId = document.createElement('td');
      tdId.textContent = String(r.id);
      const tdCategory = document.createElement('td');
      tdCategory.textContent = r.category || '';
      const tdAccount = document.createElement('td');
      tdAccount.textContent = r.account || '';
      const tdName = document.createElement('td');
      tdName.textContent = r.name || '';
      const tdAction = document.createElement('td');
      const btn = document.createElement('button');
      btn.setAttribute('data-id', String(r.id));
      btn.textContent = '删除';
      tdAction.appendChild(btn);
      tr.append(tdId, tdCategory, tdAccount, tdName, tdAction);
      ui.tableBody.appendChild(tr);
    });
    ui.tableBody.querySelectorAll('button[data-id]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await removeAccount(Number(btn.getAttribute('data-id')));
        await renderTable();
      });
    });
  }

  async function saveOperators() {
    const category = ui.category.value;
    const operatorNames = parseOperatorNames(ui.operators.value);
    await chrome.storage.local.set({
      [`gr_operator_names_${category}`]: operatorNames,
      gr_selected_operator_list: operatorNames
    });
    alert(`已保存 ${operatorNames.length} 位经办警官`);
  }

  async function runBatchOnCurrentTab() {
    const category = ui.category.value;
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs.length) throw new Error('未找到活动标签页');
    const tabId = tabs[0].id;

    const storage = await chrome.storage.local.get([`gr_operator_names_${category}`]);
    const operatorNames = Array.isArray(storage[`gr_operator_names_${category}`]) ? storage[`gr_operator_names_${category}`] : [];

    if (!operatorNames.length) {
      throw new Error('经办警官为空，请先在本页保存经办警官');
    }

    const openResult = await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, { action: 'OPEN_OPERATOR_PICKER', operatorNames }, (resp) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        resolve(resp || {});
      });
    });

    if (!openResult || openResult.ok !== true) {
      throw new Error(openResult?.reason || openResult?.error || '经办警官选择失败，已阻止提交');
    }

    const rows = (await getAllAccounts()).filter((r) => r.category === category).map((r) => ({
      止付账号: r.account,
      账号名称: r.name,
      止付账号类别: '个人'
    }));

    const submit = await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, {
        action: 'FILL_FORM',
        rows,
        startIndex: 0,
        mode: category,
        operatorNames
      }, (resp) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        resolve(resp || {});
      });
    });

    if (!submit || submit.ok !== true) {
      throw new Error(submit?.error || '填充失败');
    }
    alert(`执行完成：${submit.filled || 0} 条`);
  }

  ui.addBtn.addEventListener('click', async () => {
    const category = ui.category.value;
    const account = ui.account.value.trim();
    const name = ui.name.value.trim();
    if (!account) return;
    await addAccount({ category, account, name, createdAt: Date.now() });
    ui.account.value = '';
    ui.name.value = '';
    await renderTable();
  });

  ui.category.addEventListener('change', async () => {
    await renderTable();
    const category = ui.category.value;
    const data = await chrome.storage.local.get([`gr_operator_names_${category}`]);
    ui.operators.value = (data[`gr_operator_names_${category}`] || []).join('\n');
  });

  ui.saveOperatorsBtn.addEventListener('click', () => saveOperators().catch((e) => alert(e.message)));
  ui.runBatchBtn.addEventListener('click', () => runBatchOnCurrentTab().catch((e) => alert(e.message)));

  (async () => {
    await renderTable();
    const category = ui.category.value;
    const data = await chrome.storage.local.get([`gr_operator_names_${category}`]);
    ui.operators.value = (data[`gr_operator_names_${category}`] || []).join('\n');
  })().catch((e) => alert(e.message));
})();
