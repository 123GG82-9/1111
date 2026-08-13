(() => {
  const REPORT_ACTION = 'REPORT_STATUS';

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function report(type, message, payload) {
    chrome.runtime.sendMessage({
      action: REPORT_ACTION,
      type,
      message,
      level: /ERROR|FAIL/.test(type) ? 'error' : 'info',
      payload: payload || null
    });
  }

  function normalizeText(v) {
    return String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  }

  function parseDateValue(value) {
    if (value == null || value === '') return null;
    if (value instanceof Date) return value;
    if (typeof value === 'number') {
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      return new Date(excelEpoch.getTime() + Math.round(value * 86400000));
    }
    const s = String(value).trim();
    if (!s) return null;
    const direct = new Date(s);
    if (!Number.isNaN(direct.getTime())) return direct;
    const m = s.match(/^(\d{4})[-\/.年](\d{1,2})[-\/.月](\d{1,2})(?:日)?(?:\s+(\d{1,2})[:时](\d{1,2})(?:[:分](\d{1,2}))?)?$/);
    if (!m) return null;
    const [, y, mo, d, hh = '0', mm = '0', ss = '0'] = m;
    return new Date(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm), Number(ss));
  }

  function formatDateTime(date) {
    const p = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
  }

  function dispatchInputChange(el) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function getLabelTextCandidates(el) {
    const list = [];
    if (!el) return list;
    const id = el.getAttribute('id');
    if (id) {
      const linked = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (linked) list.push(normalizeText(linked.textContent));
    }
    let node = el.closest('.el-form-item, .form-item, td, th, .cell, .ant-form-item');
    if (node) {
      const lbl = node.querySelector('.el-form-item__label, label, .form-label, .label, th');
      if (lbl) list.push(normalizeText(lbl.textContent));
    }
    const previous = el.previousElementSibling;
    if (previous && /label|span|div/i.test(previous.tagName)) {
      list.push(normalizeText(previous.textContent));
    }
    return list.filter(Boolean);
  }

  function findFieldByKeywords(keywords) {
    const keySet = keywords.map((k) => normalizeText(k)).filter(Boolean);
    const all = Array.from(document.querySelectorAll('input,textarea,select,.el-input__inner,.el-select input'));
    for (const el of all) {
      const labels = getLabelTextCandidates(el);
      if (labels.some((t) => keySet.some((k) => t.includes(k)))) return el;
      const placeholder = normalizeText(el.getAttribute('placeholder'));
      if (keySet.some((k) => placeholder.includes(k))) return el;
      const name = normalizeText(el.getAttribute('name'));
      if (keySet.some((k) => name.includes(k))) return el;
    }
    return null;
  }

  async function fillInput(field, value) {
    if (!field) throw new Error('输入框不存在');
    field.focus();
    field.value = value == null ? '' : String(value);
    dispatchInputChange(field);
    await sleep(20);
  }

  function getVisibleSelectDropdowns() {
    return Array.from(document.querySelectorAll('.el-select-dropdown, .ant-select-dropdown, .select-dropdown, .dropdown-menu'))
      .filter((node) => {
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      });
  }

  function typeSelectSearch(selectField, text) {
    const searchInput = selectField.matches('input') ? selectField : selectField.querySelector('input');
    if (!searchInput) return false;
    searchInput.focus();
    searchInput.value = text;
    dispatchInputChange(searchInput);
    return true;
  }

  function collectClickableOptions(dropdown) {
    return Array.from(dropdown.querySelectorAll('.el-select-dropdown__item, .ant-select-item-option, li, .option, [role="option"]'))
      .filter((el) => {
        const disabled = el.classList.contains('is-disabled') || el.classList.contains('disabled') || el.getAttribute('aria-disabled') === 'true';
        if (disabled) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
      });
  }

  async function openSelectDropdown(field) {
    field.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    field.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(80);
  }

  async function fillSelect(field, expectedText, options = {}) {
    if (!field) throw new Error('下拉字段不存在');
    const expect = normalizeText(expectedText);
    if (!expect) return;

    await openSelectDropdown(field);

    if (options.allowSearchInput !== false) {
      typeSelectSearch(field, expect);
      await sleep(80);
    }

    const timeoutMs = options.timeoutMs || 800;
    const started = Date.now();
    let clicked = false;

    while (Date.now() - started < timeoutMs) {
      const dropdowns = getVisibleSelectDropdowns();
      for (const dd of dropdowns) {
        const opts = collectClickableOptions(dd);
        const exact = opts.find((o) => normalizeText(o.textContent) === expect);
        const partial = opts.find((o) => normalizeText(o.textContent).includes(expect));
        const target = exact || partial;
        if (target) {
          target.scrollIntoView({ block: 'nearest' });
          target.click();
          clicked = true;
          break;
        }
      }
      if (clicked) break;
      await sleep(60);
    }

    if (!clicked && options.retryOnce) {
      await sleep(120);
      await openSelectDropdown(field);
      return fillSelect(field, expectedText, { ...options, retryOnce: false, timeoutMs: 600 });
    }

    if (!clicked) {
      throw new Error(`未找到下拉选项：${expect}`);
    }

    if (field.tagName === 'SELECT') {
      const matched = Array.from(field.options).find((o) => normalizeText(o.textContent) === expect || normalizeText(o.textContent).includes(expect));
      if (matched) {
        field.value = matched.value;
        dispatchInputChange(field);
      }
    }

    await sleep(30);
  }

  function findElementUiPickerPanel() {
    const panels = Array.from(document.querySelectorAll('.el-picker-panel, .el-date-picker, .el-time-panel, .el-picker-dropdown'));
    return panels.find((p) => {
      const style = window.getComputedStyle(p);
      const rect = p.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    });
  }

  function findPickerConfirmButton(panel) {
    if (!panel) return null;
    const candidates = Array.from(panel.querySelectorAll('button, .el-picker-panel__link-btn, .el-button'));
    return candidates.find((btn) => /确定|确认|ok/i.test(normalizeText(btn.textContent)) && !btn.disabled && !btn.classList.contains('is-disabled')) || null;
  }

  async function fillDateTime(field, rawValue) {
    const date = parseDateValue(rawValue);
    if (!date) throw new Error(`转出时间无效：${rawValue}`);

    const formatted = formatDateTime(date);

    field.focus();
    field.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(80);

    field.value = formatted;
    dispatchInputChange(field);

    let panel = null;
    for (let i = 0; i < 6; i += 1) {
      panel = findElementUiPickerPanel();
      if (panel) break;
      await sleep(100);
    }

    if (panel) {
      const panelInput = panel.querySelector('input');
      if (panelInput) {
        panelInput.focus();
        panelInput.value = formatted;
        dispatchInputChange(panelInput);
      }

      const confirmBtn = findPickerConfirmButton(panel);
      if (confirmBtn) {
        confirmBtn.click();
      } else {
        field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        field.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
      }
    } else {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      field.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
    }

    await sleep(80);

    const finalValue = normalizeText(field.value);
    if (!finalValue) {
      throw new Error('转出时间填写后为空，未生效');
    }
    if (!finalValue.includes(String(date.getFullYear()))) {
      throw new Error(`转出时间校验失败，当前值：${finalValue}`);
    }
  }

  function findOperatorModal() {
    const dialogs = Array.from(document.querySelectorAll('.el-dialog, .ant-modal, [role="dialog"], .modal'));
    return dialogs.find((d) => {
      const title = normalizeText((d.querySelector('.el-dialog__title, .ant-modal-title, h2, h3, .modal-title') || {}).textContent || d.textContent);
      const style = window.getComputedStyle(d);
      const rect = d.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0 && /经办|警官|人员/.test(title);
    }) || null;
  }

  function findOperatorRows(modal) {
    return Array.from(modal.querySelectorAll('tr, .el-table__row, .ant-table-row')).filter((row) => {
      const text = normalizeText(row.textContent);
      return !!text;
    });
  }

  function findCheckControlInRow(row) {
    const checkbox = row.querySelector('input[type="checkbox"], .el-checkbox__input, .ant-checkbox-input, .ant-checkbox');
    return checkbox || null;
  }

  function ensureChecked(control) {
    if (!control) return false;
    if (control.matches('input[type="checkbox"]')) {
      if (!control.checked) {
        control.click();
      }
      return control.checked;
    }
    const parent = control.closest('.el-checkbox, .ant-checkbox-wrapper, label') || control;
    const isChecked = parent.classList.contains('is-checked') || parent.classList.contains('ant-checkbox-checked') || control.getAttribute('aria-checked') === 'true';
    if (!isChecked) {
      parent.click();
    }
    const checkedAfter = parent.classList.contains('is-checked') || parent.classList.contains('ant-checkbox-checked') || control.getAttribute('aria-checked') === 'true';
    return checkedAfter;
  }

  async function openOperatorPicker(operatorNames) {
    const names = (operatorNames || []).map((n) => normalizeText(n)).filter(Boolean);
    if (!names.length) {
      return { ok: false, skipped: true, reason: 'operatorNames 为空' };
    }

    const openBtn = Array.from(document.querySelectorAll('button, .el-button, .ant-btn, a')).find((el) => /经办|警官|选择人员|选择经办/.test(normalizeText(el.textContent)));
    if (openBtn) {
      openBtn.click();
      await sleep(120);
    }

    let modal = null;
    for (let i = 0; i < 8; i += 1) {
      modal = findOperatorModal();
      if (modal) break;
      await sleep(100);
    }

    if (!modal) {
      return { ok: false, skipped: true, reason: '未找到经办警官弹窗' };
    }

    const selected = [];
    const missing = [];
    const rows = findOperatorRows(modal);

    for (const name of names) {
      const row = rows.find((r) => normalizeText(r.textContent).includes(name));
      if (!row) {
        missing.push(name);
        continue;
      }
      const control = findCheckControlInRow(row);
      if (!control) {
        missing.push(name);
        continue;
      }
      const checked = ensureChecked(control);
      if (checked) selected.push(name);
      else missing.push(name);
    }

    const confirmBtn = Array.from(modal.querySelectorAll('button, .el-button, .ant-btn')).find((btn) => /确定|确认|提交/.test(normalizeText(btn.textContent)) && !btn.disabled && !btn.classList.contains('is-disabled'));

    if (!confirmBtn) {
      return { ok: false, error: '弹窗内未找到确定按钮', selected, missing };
    }

    confirmBtn.click();
    await sleep(150);

    const stillOpen = !!findOperatorModal();
    if (stillOpen) {
      return { ok: false, error: '点击确定后弹窗未关闭', selected, missing };
    }

    if (missing.length) {
      return { ok: false, skipped: true, reason: `以下经办人未匹配或勾选失败：${missing.join('、')}`, selected, missing };
    }

    report('OPERATOR_PICK_OK', '经办警官选择成功', { selected });
    return { ok: true, selected };
  }

  async function fillOneRow(row, ctx) {
    const isBank = ctx.mode === 'bank';
    const accountType = row['止付账号类别'] || row['账号类别'] || '个人';
    const account = row['止付账号'] || row['账号'] || '';
    const bankName = row['止付账户所属银行'] || row['所属银行'] || '';
    const transferTime = row['转出时间'] || row['交易时间'] || '';

    const accountTypeField = findFieldByKeywords(['止付账号类别', '账号类别']);
    if (accountTypeField) {
      try {
        await fillSelect(accountTypeField, accountType, { timeoutMs: 800, retryOnce: true });
      } catch (error) {
        report('FIELD_FILL_ERROR', `止付账号类别填写失败：${error.message}`, { field: '止付账号类别', value: accountType });
        throw error;
      }
    }

    const accountField = findFieldByKeywords(['止付账号', '账号']);
    if (accountField) {
      try {
        await fillInput(accountField, account);
      } catch (error) {
        report('FIELD_FILL_ERROR', `止付账号填写失败：${error.message}`, { field: '止付账号', value: account });
        throw error;
      }
    }

    if (isBank) {
      const bankField = findFieldByKeywords(['止付账户所属银行', '所属银行']);
      if (bankField && bankName) {
        try {
          await fillSelect(bankField, bankName, { timeoutMs: 800, retryOnce: true, allowSearchInput: true });
        } catch (error) {
          report('FIELD_FILL_ERROR', `止付账户所属银行填写失败：${error.message}`, { field: '止付账户所属银行', value: bankName });
          throw error;
        }
      }
    }

    const timeField = findFieldByKeywords(['转出时间', '交易时间']);
    if (timeField && transferTime) {
      try {
        await fillDateTime(timeField, transferTime);
      } catch (error) {
        report('FIELD_FILL_ERROR', `转出时间填写失败：${error.message}`, { field: '转出时间', value: transferTime });
        throw error;
      }
    }

    const submitBtn = Array.from(document.querySelectorAll('button, .el-button, .ant-btn, input[type="button"], input[type="submit"]')).find((btn) => {
      const text = normalizeText(btn.textContent || btn.value || '');
      return /提交|保存|确认提交/.test(text) && !btn.disabled;
    });

    if (!submitBtn) {
      throw new Error('未找到提交按钮');
    }

    submitBtn.click();
    await sleep(120);
  }

  async function fillForm(rows, start, mode, operatorNames) {
    const batchRows = Array.isArray(rows) ? rows : [];
    const isBank = mode === 'bank';

    if (!batchRows.length) {
      return { ok: true, filled: 0, skipped: true };
    }
    if (!Array.isArray(operatorNames) || !operatorNames.length) {
      return { ok: false, error: 'operatorNames 为空，禁止提交' };
    }

    try {
      for (let i = 0; i < batchRows.length; i += 1) {
        await fillOneRow(batchRows[i], { mode, index: start + i, isBank });
      }
      report('FILL_FORM_SUCCESS', `成功填充 ${batchRows.length} 行`, { startIndex: start, batchSize: batchRows.length, isBank });
      return { ok: true, filled: batchRows.length };
    } catch (error) {
      report('FILL_FORM_ERROR', error.message, { startIndex: start, batchSize: batchRows.length, isBank });
      throw error;
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.action) return;

    if (msg.action === 'PING') {
      sendResponse({ ok: true, title: document.title });
      return;
    }

    if (msg.action === 'OPEN_OPERATOR_PICKER') {
      openOperatorPicker(msg.operatorNames || [])
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (msg.action === 'FILL_FORM') {
      fillForm(msg.rows || [], Number(msg.startIndex) || 0, msg.mode || 'bank', msg.operatorNames || [])
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }
  });
})();
