// ==UserScript==
// @name         IVAC Auto 105 (Direct Require)
// @namespace    http://tampermonkey.net/
// @version      10.2
// @match        https://appointment.ivacbd.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        unsafeWindow
// @connect      raw.githubusercontent.com
// @connect      slotbd.online
// @require      
// @run-at       document-end
// ==/UserScript==

// এখানে আলাদা করে আর পুরো কোড পেস্ট করার দরকার নেই, 
// গিটহাবের ফাইলটি অটোমেটিক `@require` এর মাধ্যমে রান হয়ে যাবে।
(function () {
  'use strict';

  // ── Storage (GM_ based — reload safe) ────────────────────────
  function loadProfiles() {
    try { return JSON.parse(GM_getValue('ivac_profiles', '[]')) || []; }
    catch { return []; }
  }

  function saveProfiles(list) {
    GM_setValue('ivac_profiles', JSON.stringify(list));
  }

  function getLastIdx() { return GM_getValue('ivac_last_profile', ''); }
  function setLastIdx(v) { GM_setValue('ivac_last_profile', String(v)); }
  function clearLastIdx() { GM_setValue('ivac_last_profile', ''); }

  let savedProfiles = loadProfiles();

  let PHONE = GM_getValue('ivac_phone', '');
  let PASSWORD = GM_getValue('ivac_password', '');

  const OTP_API = () => `https://slotbd.online/api/get-sms?phone=${PHONE}`;

  let otpPoller = null;
  let otpPageDetected = false;
  let autoClickInterval = null;
  let autoClickCount = 0;
  let countdownInterval = null;
  let otpAutoDone = false;
  let otpTimerInterval = null;
  let otpTimerRemaining = 0;
  let otpTimerActive = false;

  // ── Utility ──────────────────────────────────────────────────
  function wordsToDigits(text) {
    const map = { 'zero':'0','one':'1','two':'2','three':'3','four':'4','five':'5','six':'6','seven':'7','eight':'8','nine':'9' };
    return text.toLowerCase().replace(/-/g, ' ').replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine)\b/g, m => map[m]);
  }

  function toBengaliDigits(text) {
    const map = { '০':'0','১':'1','২':'2','৩':'3','৪':'4','৫':'5','৬':'6','৭':'7','৮':'8','৯':'9' };
    return text.replace(/[০-৯]/g, d => map[d]);
  }

  function setNativeValue(el, value) {
    const proto = el.tagName === 'INPUT' ? HTMLInputElement : HTMLTextAreaElement;
    const desc = Object.getOwnPropertyDescriptor(proto.prototype, 'value');
    desc.set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function gmFetch(url) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'undefined') {
        GM_xmlhttpRequest({ method: 'GET', url, onload: r => resolve(r.responseText), onerror: reject });
      } else {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url);
        xhr.onload = () => resolve(xhr.responseText);
        xhr.onerror = () => reject(new Error('XHR failed'));
        xhr.send();
      }
    });
  }

  function addPressEffect(el) {
    el.addEventListener('mousedown', () => { el.style.filter = 'brightness(0.8)'; el.style.transform = 'scale(0.97)'; });
    el.addEventListener('mouseup',   () => { el.style.filter = ''; el.style.transform = ''; });
    el.addEventListener('mouseleave',() => { el.style.filter = ''; el.style.transform = ''; });
  }

  // ── Panel ─────────────────────────────────────────────────────
  const panel = document.createElement('div');
  Object.assign(panel.style, {
    position: 'fixed', bottom: '20px', right: '0px', zIndex: '99999',
    background: '#ffffff', borderRadius: '4px', padding: '8px',
    display: 'flex', flexDirection: 'column', gap: '4px',
    boxShadow: '0 10px 25px -5px rgba(0,0,0,0.2)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    width: '300px', boxSizing: 'border-box', border: '1px solid #e2e8f0'
  });

  const LEFT_WIDTH = '55px';
  const RIGHT_WIDTH = '55px';

  // Row 0: Dropdown | Settings
  const row0 = document.createElement('div');
  Object.assign(row0.style, { display: 'flex', gap: '4px', alignItems: 'center' });

  const profileSelect = document.createElement('select');
  Object.assign(profileSelect.style, {
    flex: '1', padding: '8px 10px', borderRadius: '4px', border: '1px solid #cbd5e1',
    fontSize: '12px', fontWeight: '500', background: '#f8fafc',
    color: '#0f172a', outline: 'none', cursor: 'pointer', minWidth: '0',
  });

  const settingsBtn = document.createElement('button');
  settingsBtn.innerHTML = '⚙️';
  Object.assign(settingsBtn.style, {
    width: '55px', height: '34px', boxSizing: 'border-box',
    padding: '0', background: '#f1f5f9', border: '1px solid #cbd5e1',
    borderRadius: '4px', fontSize: '16px', cursor: 'pointer', textAlign: 'center', flexShrink: '0'
  });

  row0.appendChild(profileSelect);
  row0.appendChild(settingsBtn);

  // ── Settings Modal ────────────────────────────────────────────
  const modal = document.createElement('div');
  Object.assign(modal.style, {
    display: 'none', position: 'fixed', bottom: '200px', right: '0px',
    zIndex: '999999', background: '#fff', border: '1px solid #e2e8f0',
    borderRadius: '8px', padding: '12px', width: '300px', boxSizing: 'border-box',
    boxShadow: '0 10px 25px -5px rgba(0,0,0,0.2)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    flexDirection: 'column', gap: '8px'
  });

  const modalTitle = document.createElement('div');
  Object.assign(modalTitle.style, {
    fontSize: '13px', fontWeight: '700', color: '#0f172a',
    borderBottom: '1px solid #e2e8f0', paddingBottom: '8px',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
  });
  modalTitle.innerHTML = '<span>⚙️ Profile Settings</span>';

  const closeModalBtn = document.createElement('button');
  closeModalBtn.textContent = '✕';
  Object.assign(closeModalBtn.style, { background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', color: '#94a3b8', fontWeight: '700' });
  modalTitle.appendChild(closeModalBtn);

  // Modal top row: profile list dropdown | export | import
  const modalTopRow = document.createElement('div');
  Object.assign(modalTopRow.style, { display: 'flex', gap: '4px', alignItems: 'center' });

  const modalProfileSelect = document.createElement('select');
  Object.assign(modalProfileSelect.style, {
    flex: '1', padding: '6px 8px', borderRadius: '4px', border: '1px solid #cbd5e1',
    fontSize: '12px', background: '#f8fafc', color: '#0f172a', outline: 'none', cursor: 'pointer', minWidth: '0'
  });

 const exportBtn = document.createElement('button');
  exportBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3"/><path d="m7 10 5 5 5-5"/><path d="M3 21h18"/></svg>`;
  exportBtn.title = 'Export JSON';
  Object.assign(exportBtn.style, {
    width: '28px', height: '29px', padding: '0', background: '#0f172a', color: '#94a3b8',
    border: '1px solid #334155', borderRadius: '4px', fontSize: '13px', cursor: 'pointer', flexShrink: '0',
    display: 'flex', alignItems: 'center', justifyContent: 'center'
  });

  const importBtn = document.createElement('button');
  importBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v12"/><path d="m7 14 5-5 5 5"/><path d="M3 3h18"/></svg>`;
  importBtn.title = 'Import JSON';
  Object.assign(importBtn.style, {
    width: '28px', height: '29px', padding: '0', background: '#0f172a', color: '#94a3b8',
    border: '1px solid #334155', borderRadius: '4px', fontSize: '13px', cursor: 'pointer', flexShrink: '0',
    display: 'flex', alignItems: 'center', justifyContent: 'center'
  });

  const fileInput = document.createElement('input');
  fileInput.type = 'file'; fileInput.accept = '.json'; fileInput.style.display = 'none';

  modalTopRow.appendChild(modalProfileSelect);
  modalTopRow.appendChild(exportBtn);
  modalTopRow.appendChild(importBtn);
  modalTopRow.appendChild(fileInput);

  // formRow0: Name | Type | Count
  const formRow0 = document.createElement('div');
  Object.assign(formRow0.style, { display: 'flex', gap: '4px' });

  const modalName = document.createElement('input');
  modalName.placeholder = 'Buyer Name';
  Object.assign(modalName.style, {
    width: '85px', padding: '6px 6px', borderRadius: '4px', border: '1px solid #cbd5e1',
    fontSize: '12px', background: '#f8fafc', color: '#0f172a', outline: 'none', flexShrink: '0'
  });


    const modalType = document.createElement('select');
  Object.assign(modalType.style, {
    flex: '1', padding: '6px 4px', borderRadius: '4px', border: '1px solid #cbd5e1',
    fontSize: '12px', background: '#f8fafc', color: '#0f172a', outline: 'none', cursor: 'pointer', minWidth: '0'
  });

  const typeDefaultOpt = document.createElement('option');
  typeDefaultOpt.value = '';
  typeDefaultOpt.textContent = 'Visa Type';
  typeDefaultOpt.disabled = true;
  typeDefaultOpt.selected = true;
  modalType.appendChild(typeDefaultOpt);

    [['Tourist','Tourist'],['Medical','Medical'],['Double Entry','Double Entry'],['Business','Business'],['Student','Student']].forEach(([val, label]) => {

    const opt = document.createElement('option');
    opt.value = val; opt.textContent = label;
    modalType.appendChild(opt);
  });


  const modalCount = document.createElement('select');
  Object.assign(modalCount.style, {
    width: '70px', padding: '6px 4px', borderRadius: '4px', border: '1px solid #cbd5e1',
    fontSize: '12px', background: '#f8fafc', color: '#0f172a', outline: 'none', cursor: 'pointer', flexShrink: '0'
  });
  [['1','1 BGD'],['2','2 BGD'],['3','3 BGD'],['4','4 BGD']].forEach(([val, label]) => {
    const opt = document.createElement('option');
    opt.value = val; opt.textContent = label;
    modalCount.appendChild(opt);
  });

  formRow0.appendChild(modalName);
  formRow0.appendChild(modalType);
  formRow0.appendChild(modalCount);

  // formRow1: Phone | Password
  const formRow1 = document.createElement('div');
  Object.assign(formRow1.style, { display: 'flex', gap: '4px' });

  const modalPhone = document.createElement('input');
  modalPhone.placeholder = 'Phone';
  modalPhone.maxLength = 11;
  modalPhone.inputMode = 'numeric';
  Object.assign(modalPhone.style, {
    flex: '1', padding: '6px 8px', borderRadius: '4px', border: '1px solid #cbd5e1',
    fontSize: '12px', background: '#f8fafc', color: '#0f172a', outline: 'none', minWidth: '0'
  });
  modalPhone.addEventListener('input', () => {
    modalPhone.value = modalPhone.value.replace(/\D/g, '').slice(0, 11);
  });

  const modalPass = document.createElement('input');
  modalPass.placeholder = 'Password';
  Object.assign(modalPass.style, {
    flex: '1', padding: '6px 8px', borderRadius: '4px', border: '1px solid #cbd5e1',
    fontSize: '12px', background: '#f8fafc', color: '#0f172a', outline: 'none', minWidth: '0'
  });
  modalPass.addEventListener('input', () => {
    modalPass.value = modalPass.value.replace(/\s/g, '');
  });

  formRow1.appendChild(modalPhone);
  formRow1.appendChild(modalPass);

  // formRow2: Save | Delete
  const formRow2 = document.createElement('div');
  Object.assign(formRow2.style, { display: 'flex', gap: '4px' });

  const modalSaveBtn = document.createElement('button');
  modalSaveBtn.textContent = '💾 Save';
  Object.assign(modalSaveBtn.style, {
    flex: '1', padding: '7px', background: '#2563eb', color: '#fff',
    border: 'none', borderRadius: '4px', fontWeight: '600', fontSize: '12px', cursor: 'pointer'
  });

  const modalDelBtn = document.createElement('button');
  modalDelBtn.textContent = '🗑 Delete';
  Object.assign(modalDelBtn.style, {
    flex: '1', padding: '7px', background: '#fef2f2', color: '#dc2626',
    border: '1px solid #fca5a5', borderRadius: '4px', fontWeight: '600', fontSize: '12px', cursor: 'pointer'
  });

    const modalClearBtn = document.createElement('button');
  modalClearBtn.textContent = '🗑 Clear All';
  Object.assign(modalClearBtn.style, {
    flex: '1', padding: '7px', background: '#7f1d1d', color: '#fca5a5',
    border: '1px solid #fca5a5', borderRadius: '4px', fontWeight: '600', fontSize: '12px', cursor: 'pointer'
  });

  formRow2.appendChild(modalSaveBtn);
  formRow2.appendChild(modalDelBtn);
  formRow2.appendChild(modalClearBtn);



  modal.appendChild(modalTitle);
  modal.appendChild(modalTopRow);
  modal.appendChild(formRow0);
  modal.appendChild(formRow1);
  modal.appendChild(formRow2);
  document.body.appendChild(modal);

  // Row 1: Phone | Password | Signin
  const row1 = document.createElement('div');
  Object.assign(row1.style, { display: 'flex', gap: '4px', alignItems: 'center' });

  const phoneInput = document.createElement('input');
  phoneInput.type = 'text'; phoneInput.placeholder = 'Phone'; phoneInput.value = PHONE;
  Object.assign(phoneInput.style, {
    flex: '1', padding: '8px 10px', borderRadius: '4px', border: '1px solid #cbd5e1',
    fontSize: '12px', fontWeight: '500', background: '#f8fafc', color: '#0f172a', outline: 'none', minWidth: '0',
  });

  const passInput = document.createElement('input');
  passInput.type = 'text'; passInput.placeholder = 'Password'; passInput.value = PASSWORD;
  Object.assign(passInput.style, {
    flex: '1', padding: '8px 10px', borderRadius: '4px', border: '1px solid #cbd5e1',
    fontSize: '12px', fontWeight: '500', background: '#f8fafc', color: '#0f172a', outline: 'none', minWidth: '0',
  });

  const signinBtn = document.createElement('button');
  signinBtn.textContent = 'Signin';
  Object.assign(signinBtn.style, {
    width: RIGHT_WIDTH, height: '32px', boxSizing: 'border-box',
    padding: '0 4px', background: '#16a34a', color: '#fff',
    border: 'none', borderRadius: '4px', fontWeight: '600', fontSize: '12px', cursor: 'pointer', whiteSpace: 'nowrap', textAlign: 'center'
  });

  row1.appendChild(phoneInput);
  row1.appendChild(passInput);
  row1.appendChild(signinBtn);

  // Row 2: Get OTP | OTP | Verify
  const row2 = document.createElement('div');
  Object.assign(row2.style, { display: 'flex', gap: '4px', alignItems: 'center' });

  const getOtpBtn = document.createElement('button');
  getOtpBtn.textContent = 'Get OTP';
  Object.assign(getOtpBtn.style, {
    width: LEFT_WIDTH, height: '32px', boxSizing: 'border-box',
    padding: '0 2px', background: '#f1f5f9', color: '#475569',
    border: '1px solid #cbd5e1', borderRadius: '4px', fontWeight: '600', fontSize: '11px', cursor: 'pointer', whiteSpace: 'nowrap', textAlign: 'center'
  });

  const otpInput = document.createElement('input');
  otpInput.placeholder = 'OTP'; otpInput.maxLength = 200;
  Object.assign(otpInput.style, {
    flex: '1', padding: '8px 10px', borderRadius: '4px', border: '1px solid #cbd5e1',
    fontSize: '12px', fontWeight: '600', background: '#f8fafc',
    color: '#0f172a', outline: 'none', minWidth: '0', letterSpacing: '2px', textAlign: 'center'
  });

  const verifyBtn = document.createElement('button');
  verifyBtn.textContent = 'Verify';
  Object.assign(verifyBtn.style, {
    width: RIGHT_WIDTH, height: '32px', boxSizing: 'border-box',
    padding: '0 4px', background: '#16a34a', color: '#fff',
    border: 'none', borderRadius: '4px', fontWeight: '600', fontSize: '12px', cursor: 'pointer', whiteSpace: 'nowrap', textAlign: 'center'
  });

  row2.appendChild(getOtpBtn);
  row2.appendChild(otpInput);
  row2.appendChild(verifyBtn);

  // Row 3: Delay | Reserve | Toggle
  const row3 = document.createElement('div');
  Object.assign(row3.style, { display: 'flex', gap: '4px', alignItems: 'center' });

  const delayInput = document.createElement('input');
  delayInput.type = 'text'; delayInput.value = '20.2';
  Object.assign(delayInput.style, {
    width: LEFT_WIDTH, height: '32px', boxSizing: 'border-box',
    padding: '8px 4px', borderRadius: '4px', border: '1px solid #cbd5e1',
    fontSize: '12px', fontWeight: '700', background: '#f8fafc', color: '#0f172a', outline: 'none', textAlign: 'center', flexShrink: '0',
  });

  const clickCountBtn = document.createElement('button');
  clickCountBtn.textContent = 'Reserve slot (0)';
  Object.assign(clickCountBtn.style, {
    flex: '1', padding: '8px 10px', background: '#FF671F', color: '#ffffff',
    border: 'none', borderRadius: '4px', fontWeight: '600', fontSize: '12px', cursor: 'pointer', whiteSpace: 'nowrap', minWidth: '0', textAlign: 'center',
  });

  const autoClickToggle = document.createElement('button');
  autoClickToggle.textContent = 'OFF';
  Object.assign(autoClickToggle.style, {
    width: RIGHT_WIDTH, height: '32px', boxSizing: 'border-box',
    padding: '0 4px', background: '#cbd5e1', color: '#334155',
    border: 'none', borderRadius: '4px', fontWeight: '700', fontSize: '12px', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: '0', textAlign: 'center'
  });

  row3.appendChild(delayInput);
  row3.appendChild(clickCountBtn);
  row3.appendChild(autoClickToggle);

  const statusEl = document.createElement('div');
  Object.assign(statusEl.style, {
    color: '#94a3b8', fontSize: '10px', textAlign: 'center', height: '14px', lineHeight: '14px', overflow: 'hidden',
  });

  const otpTimerEl = document.createElement('div');
  Object.assign(otpTimerEl.style, {
    color: '#94a3b8', fontSize: '11px', fontWeight: '700', textAlign: 'center', height: '14px', lineHeight: '14px', overflow: 'hidden',
  });

  panel.appendChild(row0);
  panel.appendChild(row1);
  panel.appendChild(row2);
  // ── Captured info rows (Reservation ID / Payment URL) ────────
  function createCaptureRow(bg) {
    const row = document.createElement('div');
    Object.assign(row.style, { display: 'none', gap: '4px', alignItems: 'center' });
    const input = document.createElement('input');
    input.type = 'text';
    input.readOnly = true;
    Object.assign(input.style, {
      flex: '1', padding: '6px 8px', borderRadius: '4px', border: '1px solid #cbd5e1',
      fontSize: '10px', background: bg, color: '#0f172a', outline: 'none', minWidth: '0',
      fontFamily: 'monospace', cursor: 'text',
    });
    const copyBtn = document.createElement('button');
    copyBtn.textContent = '📋';
    copyBtn.title = 'Copy';
    Object.assign(copyBtn.style, {
      width: '30px', height: '30px', boxSizing: 'border-box', border: '1px solid #cbd5e1',
      borderRadius: '4px', background: '#f1f5f9', cursor: 'pointer', fontSize: '13px', flexShrink: '0',
    });
    row.appendChild(input);
    row.appendChild(copyBtn);
    return { row, input, copyBtn };
  }

  const reservationCapture = createCaptureRow('#eff6ff');
  const paymentCapture = createCaptureRow('#faf5ff');

  let capturedReservationId = '';
  let capturedWebviewUrl = '';

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }
  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    Object.assign(ta.style, { position: 'fixed', opacity: '0' });
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch {}
    document.body.removeChild(ta);
  }

  function showReservationId(id) {
    capturedReservationId = id;
    reservationCapture.input.value = `Res ID: ${id}`;
    reservationCapture.row.style.display = 'flex';
  }
  function showWebviewUrl(url) {
    capturedWebviewUrl = url;
    paymentCapture.input.value = `Pay: ${url}`;
    paymentCapture.row.style.display = 'flex';
  }

  reservationCapture.copyBtn.onclick = () => {
    if (!capturedReservationId) return;
    copyToClipboard(capturedReservationId);
    setStatus('Reservation ID copied!', '#4ade80');
    setTimeout(() => setStatus(''), 2000);
  };
  paymentCapture.copyBtn.onclick = () => {
    if (!capturedWebviewUrl) return;
    copyToClipboard(capturedWebviewUrl);
    setStatus('Payment URL copied!', '#4ade80');
    setTimeout(() => setStatus(''), 2000);
  };
  addPressEffect(reservationCapture.copyBtn);
  addPressEffect(paymentCapture.copyBtn);

  panel.appendChild(row3);
  panel.appendChild(reservationCapture.row);
  panel.appendChild(paymentCapture.row);
  panel.appendChild(otpTimerEl);
  panel.appendChild(statusEl);
  document.body.appendChild(panel);

 [signinBtn, getOtpBtn, verifyBtn, settingsBtn, autoClickToggle, clickCountBtn,
   modalSaveBtn, modalDelBtn, modalClearBtn, exportBtn, importBtn].forEach(addPressEffect);

  // ── Helpers ───────────────────────────────────────────────────
  function setStatus(msg, color) {
    statusEl.style.color = color || '#94a3b8';
    statusEl.textContent = msg || '';
  }

  function saveCredentials() {
    PHONE = phoneInput.value.trim();
    PASSWORD = passInput.value;
    GM_setValue('ivac_phone', PHONE);
    GM_setValue('ivac_password', PASSWORD);
  }

  function getOptLabel(p, i, short) {
    const type = p.type || 'T';
    const count = p.count || 1;
    const name = p.name ? `${p.name} ` : '';
    if (short) return `${i + 1}. ${name}[${type}-${count}]`;
    return `${i + 1}. ${name}${p.phone} [${type}-${count}]`;
  }

  function refreshProfileDropdown() {
    savedProfiles = loadProfiles(); // সবসময় fresh load
    const lastIdx = getLastIdx();
    profileSelect.innerHTML = '';
    const defOpt = document.createElement('option');
    defOpt.value = ''; defOpt.textContent = 'Select profile...';
    profileSelect.appendChild(defOpt);
    savedProfiles.forEach((p, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = String(i) === String(lastIdx)
        ? getOptLabel(p, i, true)
        : getOptLabel(p, i, false);
      profileSelect.appendChild(opt);
    });
    if (lastIdx !== '' && savedProfiles[lastIdx]) {
      profileSelect.value = lastIdx;
      const p = savedProfiles[lastIdx];
      phoneInput.value = p.phone;
      passInput.value = p.password;
      PHONE = p.phone;
      PASSWORD = p.password;
    }
  }

  function refreshModalDropdown(selectIdx) {
    savedProfiles = loadProfiles();
    modalProfileSelect.innerHTML = '';
    const defOpt = document.createElement('option');
    defOpt.value = ''; defOpt.textContent = '-- New Profile --';
    modalProfileSelect.appendChild(defOpt);
    savedProfiles.forEach((p, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      const name = p.name ? `${p.name} ` : '';
      opt.textContent = `${i + 1}. ${name}${p.phone} [${p.type || 'T'}-${p.count || 1}]`;
      modalProfileSelect.appendChild(opt);
    });
    if (selectIdx !== undefined) modalProfileSelect.value = String(selectIdx);
  }

  function loadFormFromProfile(idx) {
    if (idx === '' || !savedProfiles[idx]) {
      modalName.value = '';
      modalPhone.value = '';
      modalPass.value = '';
      modalType.value = '';
      modalCount.value = '1';
      return;
    }
    const p = savedProfiles[idx];
    modalName.value = p.name || '';
    modalPhone.value = p.phone;
    modalPass.value = p.password;
    // type map — পুরনো full name থেকে short code এ convert
    const typeMap = { 'Tourist':'T','Medical':'M','Double Entry':'DE','Business':'B','Student':'S' };
    modalType.value = typeMap[p.type] || p.type || '';
    modalCount.value = String(p.count || '1');
  }

  function processText(rawText) {
    return wordsToDigits(toBengaliDigits(rawText)).replace(/\s+/g, '').replace(/\D/g, '').slice(0, 6);
  }

  // ── Modal Events ──────────────────────────────────────────────
  settingsBtn.onclick = (e) => {
    e.stopPropagation();
    if (modal.style.display === 'flex') { modal.style.display = 'none'; return; }
    const curIdx = profileSelect.value;
    refreshModalDropdown(curIdx !== '' ? curIdx : undefined);
    loadFormFromProfile(curIdx);
    if (curIdx !== '') modalProfileSelect.value = curIdx;
    modal.style.display = 'flex';
    modal.style.flexDirection = 'column';
  };

  closeModalBtn.onclick = (e) => { e.stopPropagation(); modal.style.display = 'none'; };

  document.addEventListener('click', (e) => {
    if (!modal.contains(e.target) && e.target !== settingsBtn) modal.style.display = 'none';
  });

  modalProfileSelect.addEventListener('change', () => {
    loadFormFromProfile(modalProfileSelect.value);
  });

  modalSaveBtn.onclick = () => {
    const name = modalName.value.trim();
    const phone = modalPhone.value.trim();
    const pass = modalPass.value.trim();
    const type = modalType.value;
    const count = parseInt(modalCount.value) || 1;
    if (!phone || !pass) { setStatus('Phone & password required', '#f87171'); setTimeout(() => setStatus(''), 2000); return; }

    savedProfiles = loadProfiles();
    const val = modalProfileSelect.value;
    let targetIdx;

    if (val === '') {
      // new profile
      savedProfiles.push({ name, phone, password: pass, type, count });
      targetIdx = savedProfiles.length - 1;
    } else {
      // update existing
      savedProfiles[parseInt(val)] = { name, phone, password: pass, type, count };
      targetIdx = parseInt(val);
    }

    saveProfiles(savedProfiles);
    setLastIdx(targetIdx);
    refreshProfileDropdown();
    refreshModalDropdown(targetIdx);
    loadFormFromProfile(targetIdx);
    setStatus('Profile saved ✅', '#4ade80');
    setTimeout(() => setStatus(''), 2000);
  };

  modalDelBtn.onclick = () => {
    const val = modalProfileSelect.value;
    if (val === '') { setStatus('Select a profile to delete', '#f87171'); return; }
    const p = savedProfiles[parseInt(val)];
    if (!confirm(`Delete: ${p.name || p.phone}?`)) return;
    savedProfiles = loadProfiles();
    savedProfiles.splice(parseInt(val), 1);
    saveProfiles(savedProfiles);
    clearLastIdx();
    refreshProfileDropdown();
    refreshModalDropdown();
    loadFormFromProfile('');
    setStatus('Profile deleted', '#f87171');
    setTimeout(() => setStatus(''), 2000);
  };

    modalClearBtn.onclick = () => {
    if (!confirm('All profiles delete করবেন?')) return;
    saveProfiles([]);
    savedProfiles = [];
    clearLastIdx();
    refreshProfileDropdown();
    refreshModalDropdown();
    loadFormFromProfile('');
    phoneInput.value = '';
    passInput.value = '';
    setStatus('All profiles cleared', '#f87171');
    setTimeout(() => setStatus(''), 2000);
  };

  exportBtn.onclick = () => {
    const list = loadProfiles();
    if (!list.length) { setStatus('No profiles', '#f87171'); return; }
    const blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'ivac_profiles.json'; a.click();
    URL.revokeObjectURL(url);
    setStatus('Exported ✅', '#4ade80');
    setTimeout(() => setStatus(''), 2000);
  };

  importBtn.onclick = () => fileInput.click();

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (!Array.isArray(parsed)) throw new Error('Invalid format');
        const valid = parsed.filter(p => p.phone);
        if (!valid.length) throw new Error('No valid profiles');
        saveProfiles(valid);
        savedProfiles = valid;
        clearLastIdx();
        refreshProfileDropdown();
        refreshModalDropdown();
        loadFormFromProfile('');
        modal.style.display = 'none';
        setStatus(`✅ ${valid.length} profiles imported`, '#4ade80');
        setTimeout(() => setStatus(''), 3000);
      } catch (err) {
        setStatus(`❌ ${err.message}`, '#f87171');
        setTimeout(() => setStatus(''), 3000);
      }
      fileInput.value = '';
    };
    reader.readAsText(file);
  });

  // ── OTP ───────────────────────────────────────────────────────
  function isOtpPage() {
    if (document.querySelector('input[id^="otp-"]')) return true;
    const boxes = [...document.querySelectorAll('input')].filter(
      el => el !== otpInput && el !== phoneInput && el !== passInput && el !== delayInput &&
            (el.maxLength === 1 || el.getAttribute('maxlength') === '1')
    );
    if (boxes.length >= 4) return true;
    if (document.querySelector('input[autocomplete="one-time-code"], input[name="otp"]')) return true;
    return false;
  }

  function simulateInput(el, char) {
    el.focus();
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    nativeSetter.call(el, char);
    const tracker = el._valueTracker;
    if (tracker) tracker.setValue('');
    ['keydown','keypress','keyup'].forEach(type => {
      el.dispatchEvent(new KeyboardEvent(type, { key: char, code: `Digit${char}`, keyCode: 48 + parseInt(char), which: 48 + parseInt(char), bubbles: true, cancelable: true }));
    });
    el.dispatchEvent(new InputEvent('input', { data: char, bubbles: true, cancelable: true, inputType: 'insertText' }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
  }

  function fillOtpBoxes(otp) {
    const digits = String(otp).replace(/\D/g, '');
    const byId = [...Array(6)].map((_, i) => document.getElementById(`otp-${i}`)).filter(Boolean);
    const byMaxLen = [...document.querySelectorAll('input')].filter(
      el => el !== otpInput && el !== phoneInput && el !== passInput && el !== delayInput &&
            (el.maxLength === 1 || el.getAttribute('maxlength') === '1')
    );
    const boxes = byId.length >= 4 ? byId : byMaxLen;
    if (boxes.length >= 4) { boxes.forEach((el, i) => setTimeout(() => simulateInput(el, digits[i] || ''), i * 100)); return; }
    const single = document.querySelector('input[autocomplete="one-time-code"], input[name="otp"], input[type="number"][maxlength="6"]');
    if (single) { simulateInput(single, digits); return; }
    const otpFields = [...document.querySelectorAll('input:not([type="hidden"]):not([type="submit"])')].filter(el => {
      if (el === otpInput || el === phoneInput || el === passInput || el === delayInput) return false;
      const ph = (el.placeholder || '').toLowerCase();
      const nm = (el.name || '').toLowerCase();
      const id = (el.id || '').toLowerCase();
      return ph.includes('otp') || nm.includes('otp') || id.includes('otp') || ph.includes('code') || nm.includes('code') || id.includes('code');
    });
    if (otpFields.length > 0) otpFields.forEach((el, i) => setTimeout(() => simulateInput(el, digits[i] || ''), i * 100));
  }

  function stopPolling() {
    if (otpPoller) { clearInterval(otpPoller); otpPoller = null; }
    getOtpBtn.textContent = 'Get OTP';
    Object.assign(getOtpBtn.style, { background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1' });
  }

  function updateOtpTimerDisplay() {
    const m = Math.floor(otpTimerRemaining / 60);
    const s = otpTimerRemaining % 60;
    otpTimerEl.textContent = `⏱ OTP page: ${m}:${String(s).padStart(2, '0')}`;
    otpTimerEl.style.color = otpTimerRemaining <= 60 ? '#f87171' : (otpTimerRemaining <= 180 ? '#f97316' : '#94a3b8');
  }

  function startOtpTimer(minutes) {
    if (otpTimerActive) return; // already counting — don't restart
    otpTimerActive = true;
    otpTimerRemaining = (minutes || 15) * 60;
    updateOtpTimerDisplay();
    otpTimerInterval = setInterval(() => {
      otpTimerRemaining--;
      if (otpTimerRemaining <= 0) {
        clearInterval(otpTimerInterval);
        otpTimerInterval = null;
        otpTimerActive = false;
        otpTimerEl.textContent = '⏱ OTP session expired';
        otpTimerEl.style.color = '#f87171';
        return;
      }
      updateOtpTimerDisplay();
    }, 1000);
  }

  // সার্ভারের serverTime ফিল্ড থেকে anchor ধরে ১৫ মিনিট কাউন্ট শুরু করে
  // (রেসপন্স আসতে দেরি হলেও সেই ল্যাগটুকু বাদ দিয়ে হিসাব করে)
  function startOtpTimerFromServerTime(serverTimeStr, minutes) {
    if (otpTimerActive) return;
    const serverMs = new Date(serverTimeStr).getTime();
    if (isNaN(serverMs)) { startOtpTimer(minutes); return; }
    const totalSec = (minutes || 15) * 60;
    const elapsedSec = Math.floor((Date.now() - serverMs) / 1000);
    const remaining = totalSec - Math.max(0, elapsedSec);
    if (remaining <= 0) {
      otpTimerEl.textContent = '⏱ OTP session expired';
      otpTimerEl.style.color = '#f87171';
      return;
    }
    otpTimerActive = true;
    otpTimerRemaining = remaining;
    updateOtpTimerDisplay();
    otpTimerInterval = setInterval(() => {
      otpTimerRemaining--;
      if (otpTimerRemaining <= 0) {
        clearInterval(otpTimerInterval);
        otpTimerInterval = null;
        otpTimerActive = false;
        otpTimerEl.textContent = '⏱ OTP session expired';
        otpTimerEl.style.color = '#f87171';
        return;
      }
      updateOtpTimerDisplay();
    }, 1000);
  }

  function stopOtpTimer() {
    if (otpTimerInterval) { clearInterval(otpTimerInterval); otpTimerInterval = null; }
    otpTimerActive = false;
    otpTimerEl.textContent = '';
  }

  // ── Network watcher: detect login/token success, reservationId, payment webview_url ──
  function checkNetworkPayload(rawText) {
    let json = null;
    try { json = JSON.parse(rawText); } catch {}

    if (json) {
      // Reservation ID capture (e.g. { status: "OK_NEW", reservationId: "...", ... })
      if (json.reservationId) {
        showReservationId(json.reservationId);
      }
      // Payment webview URL capture (e.g. { data: { webview_url: "..." }, successFlag: true })
      if (json.data && json.data.webview_url) {
        showWebviewUrl(json.data.webview_url);
      }
      // Login/token success → anchor OTP timer to serverTime
      if (!otpTimerActive && json.successFlag === true && json.serverTime &&
          json.data && json.data.accessToken) {
        startOtpTimerFromServerTime(json.serverTime, 15);
      }
    }

    // fallback: generic "otp ... success/sent" text signal
    if (!otpTimerActive && /otp/i.test(rawText) && /success|sent/i.test(rawText)) {
      startOtpTimer(15);
    }
  }

  (function watchOtpNetwork() {
    const origFetch = window.fetch;
    if (typeof origFetch === 'function') {
      window.fetch = function (...args) {
        const result = origFetch.apply(this, args);
        result.then((res) => {
          try {
            if (res.ok) res.clone().text().then(checkNetworkPayload).catch(() => {});
          } catch {}
        }).catch(() => {});
        return result;
      };
    }

    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this._otpWatchUrl = url;
      return origOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function (...args) {
      this.addEventListener('load', function () {
        try {
          if (this.status >= 200 && this.status < 300) checkNetworkPayload(this.responseText);
        } catch {}
      });
      return origSend.apply(this, args);
    };
  })();

  function extractOtp(rawText) {
    const normalized = toBengaliDigits(rawText);
    let otp = '';
    try {
      const data = JSON.parse(normalized);
      const val = String(data.otp || data.code || data.sms || data.message || data.token || data.text || data.body || '');
      otp = wordsToDigits(toBengaliDigits(val)).replace(/\s+/g, '').replace(/\D/g, '').slice(0, 6);
      if (otp.length < 6) {
        const full = wordsToDigits(normalized).replace(/\s+/g, '');
        const cleaned = full.replace(new RegExp(PHONE, 'g'), 'X');
        const match = cleaned.match(/\d{6}/);
        otp = match ? match[0] : '';
      }
    } catch {
      const converted = wordsToDigits(normalized).replace(/\s+/g, '');
      const cleaned = converted.replace(new RegExp(PHONE, 'g'), 'X');
      const match = cleaned.match(/\d{6}/);
      otp = match ? match[0] : '';
    }
    return otp.length === 6 ? otp : '';
  }

  async function pollOnce() {
    saveCredentials();
    if (!PHONE) { setStatus('Phone number required', '#f87171'); return; }
    let otp = '';
    try { const text = await gmFetch(OTP_API()); otp = extractOtp(text); }
    catch (e) { console.warn('slotbd error:', e); }
    if (otp) {
      otpAutoDone = true;
      stopPolling();
      otpPageDetected = false;
      otpInput.value = otp;
      otpInput.style.color = '#4ade80';
      setTimeout(() => { otpInput.style.color = '#0f172a'; }, 2000);
      setStatus(`OTP: ${otp}`, '#4ade80');
      fillOtpBoxes(otp);
      setTimeout(() => {
        const submitBtn = document.querySelector('button[type="submit"]');
        if (submitBtn && !submitBtn.disabled) { submitBtn.click(); setStatus('Submitted!', '#4ade80'); }
        setTimeout(() => setStatus(''), 4000);
      }, 6 * 100 + 300);
    } else {
      setStatus('Waiting for OTP...', '#94a3b8');
    }
  }

  function startAutoPolling() {
    if (otpPoller) return;
    if (!PHONE) { setStatus('Phone number required', '#f87171'); return; }
    otpAutoDone = false;
    setStatus('Fetching OTP...', '#f97316');
    getOtpBtn.textContent = 'Stop';
    Object.assign(getOtpBtn.style, { background: '#7f1d1d', color: '#fca5a5', border: '1px solid #fca5a5' });
    pollOnce();
    otpPoller = setInterval(pollOnce, 2000);
  }

  // ── Auto Click ────────────────────────────────────────────────
  function findContinueBtn() {
    return [...document.querySelectorAll('button')].find(btn =>
      !panel.contains(btn) &&
      (btn.textContent.trim().includes('Continue Booking') ||
       btn.textContent.trim().includes('Reserve slot') ||
       btn.textContent.trim().includes('Reserve Slot'))
    ) || null;
  }

  function doAutoClick() {
    const btn = findContinueBtn();
    if (!btn) { setStatus('Waiting for button...', '#94a3b8'); return; }
    if (btn.disabled) { setStatus('Button disabled, waiting...', '#94a3b8'); return; }
    btn.click();
    autoClickCount++;
    setStatus(`Clicked! (${autoClickCount})`, '#a78bfa');
    setTimeout(() => setStatus(''), 1500);
  }

  function stopAutoClick() {
    if (autoClickInterval) { clearInterval(autoClickInterval); autoClickInterval = null; }
    if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
    autoClickToggle.textContent = 'OFF';
    Object.assign(autoClickToggle.style, { background: '#cbd5e1', color: '#334155', border: 'none' });
    clickCountBtn.textContent = `Reserve slot(${autoClickCount})`;
  }

  function startAutoClick() {
    if (autoClickInterval) stopAutoClick();
    autoClickCount = 0;
    const delay = parseFloat(delayInput.value) || 21;
    autoClickToggle.textContent = 'ON';
    Object.assign(autoClickToggle.style, { background: '#4c1d95', color: '#c4b5fd', border: '1px solid #7c3aed' });
    let remaining = delay;
    clickCountBtn.textContent = `Reserve slot(0) ${remaining.toFixed(1)}s`;
    doAutoClick();
    remaining = delay;

    countdownInterval = setInterval(() => {
      const btn = findContinueBtn();
      if (!btn || btn.disabled) { clickCountBtn.textContent = `Reserve ${autoClickCount} waiting...`; return; }
      remaining = Math.max(0, parseFloat((remaining - 0.1).toFixed(1)));
      if (remaining <= 0) remaining = delay;
      clickCountBtn.textContent = `Reserve slot(${autoClickCount}) ${remaining.toFixed(1)}s`;
    }, 100);

    autoClickInterval = setInterval(() => {
      const btn = findContinueBtn();
      if (btn && !btn.disabled) { doAutoClick(); remaining = delay; }
    }, delay * 1000);
  }

  // ── Events ────────────────────────────────────────────────────
  clickCountBtn.onclick = () => {
    const btn = findContinueBtn();
    if (!btn) { setStatus('Button not found', '#f87171'); return; }
    if (btn.disabled) { setStatus('Button is disabled', '#f87171'); return; }
    btn.click(); autoClickCount++;
    setStatus(`Manually clicked! (${autoClickCount})`, '#a78bfa');
    setTimeout(() => setStatus(''), 1500);
  };

  autoClickToggle.onclick = () => { if (autoClickInterval) stopAutoClick(); else startAutoClick(); };

  delayInput.addEventListener('change', () => {
    const v = parseFloat(delayInput.value);
    if (!v || v < 0.1) delayInput.value = '0.5';
    if (autoClickInterval) { stopAutoClick(); startAutoClick(); }
  });

  profileSelect.addEventListener('change', () => {
    const idx = profileSelect.value;
    if (idx === '') return;
    const p = savedProfiles[idx];
    phoneInput.value = p.phone;
    passInput.value = p.password;
    PHONE = p.phone;
    PASSWORD = p.password;
    setLastIdx(idx);
    [...profileSelect.options].forEach((opt) => {
      if (opt.value === '') return;
      const pp = savedProfiles[opt.value];
      if (!pp) return;
      opt.textContent = String(opt.value) === String(idx)
        ? getOptLabel(pp, parseInt(opt.value), true)
        : getOptLabel(pp, parseInt(opt.value), false);
    });
    setStatus(`Loaded: ${p.name || p.phone}`, '#4ade80');
    setTimeout(() => setStatus(''), 2000);
  });

  signinBtn.onclick = () => {
    saveCredentials();
    if (!PHONE || !PASSWORD) { setStatus('Enter phone & password', '#f87171'); return; }
    const phoneEl = document.querySelector('input[name="phone"]');
    const passEl  = document.querySelector('input[name="password"]');
    if (phoneEl) setNativeValue(phoneEl, PHONE);
    if (passEl)  setNativeValue(passEl, PASSWORD);
    setTimeout(() => {
      const submitBtn = [...document.querySelectorAll('button[type="submit"]')]
        .find(b => b.textContent.toLowerCase().includes('sign')) ||
        document.querySelector('button[type="submit"]');
      if (submitBtn && !submitBtn.disabled) {
        submitBtn.click();
        signinBtn.textContent = 'Done!';
        setTimeout(() => { signinBtn.textContent = 'Signin'; }, 2000);
      }
    }, 300);
  };

  getOtpBtn.onclick = () => {
    if (otpPoller) {
      stopPolling();
      otpPageDetected = false;
      otpAutoDone = true;
      setStatus('Stopped', '#f87171');
      setTimeout(() => setStatus(''), 1500);
    } else {
      saveCredentials();
      startAutoPolling();
    }
  };

  verifyBtn.onclick = () => {
    const digits = processText(otpInput.value);
    if (digits.length === 6) {
      fillOtpBoxes(digits);
      setStatus(`Filling: ${digits}`, '#4ade80');
      setTimeout(() => {
        const submitBtn = document.querySelector('button[type="submit"]');
        if (submitBtn && !submitBtn.disabled) { submitBtn.click(); setStatus('Submitted!', '#4ade80'); }
        setTimeout(() => setStatus(''), 3000);
      }, 6 * 100 + 300);
    } else {
      setStatus('Enter valid 6-digit OTP', '#f87171');
      setTimeout(() => setStatus(''), 3000);
    }
  };

  otpInput.addEventListener('paste', (e) => {
    e.preventDefault();
    const pasted = (e.clipboardData || window.clipboardData).getData('text');
    const digits = processText(pasted);
    otpInput.value = digits;
    setStatus(`Converted: ${digits}`, '#94a3b8');
    if (digits.length === 6) { fillOtpBoxes(digits); setTimeout(() => setStatus(''), 2000); }
  });

  otpInput.addEventListener('input', () => {
    const raw = otpInput.value;
    if (/^\d+$/.test(raw)) { if (raw.length === 6) fillOtpBoxes(raw); }
    else { const digits = processText(raw); otpInput.value = digits; if (digits.length === 6) fillOtpBoxes(digits); }
  });

  [phoneInput, passInput].forEach(el => {
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') signinBtn.click(); });
  });

  // ── Init ──────────────────────────────────────────────────────
  refreshProfileDropdown();
  setTimeout(() => startAutoClick(), 500);

  new MutationObserver(() => {
    if (!otpPageDetected && isOtpPage() && !otpAutoDone) {
      otpPageDetected = true;
      startOtpTimer(15);
      setTimeout(() => startAutoPolling(), 1000);
    }
    if (otpPageDetected && !isOtpPage()) {
      otpPageDetected = false;
      stopPolling();
      otpAutoDone = false;
    }
  }).observe(document.body, { childList: true, subtree: true });

  // ── HAR import (টেস্টিং-এর জন্য: HAR ফাইল থেকে সব রেসপন্স বডি পড়ে
  //    checkNetworkPayload দিয়ে যাচাই করে reservationId/webview_url/OTP সিগন্যাল বের করে) ──
  function importHar(harText) {
    let count = 0;
    try {
      const har = JSON.parse(harText);
      const entries = (har.log && har.log.entries) || [];
      entries.forEach((entry) => {
        try {
          const content = entry.response && entry.response.content;
          if (!content || !content.text) return;
          let text = content.text;
          if (content.encoding === 'base64') text = atob(text);
          checkNetworkPayload(text);
          count++;
        } catch {}
      });
    } catch (e) {
      console.error('[ivacDebug] Invalid HAR file:', e);
    }
    console.log(`[ivacDebug] HAR processed: ${count} response bodies scanned`);
    return count;
  }

  function pickHarFile() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.har,application/json';
    inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.onchange = () => {
      const file = inp.files[0];
      document.body.removeChild(inp);
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const count = importHar(reader.result);
        setStatus(`HAR scanned: ${count} responses`, '#4ade80');
        setTimeout(() => setStatus(''), 3000);
      };
      reader.readAsText(file);
    };
    inp.click();
  }

  if (isOtpPage() && !otpAutoDone) {
    otpPageDetected = true;
    startOtpTimer(15);
    setTimeout(() => startAutoPolling(), 1000);
  }

  // ── Debug hook (কনসোল থেকে ম্যানুয়ালি টেস্ট করার জন্য) ─────────
  // ব্যবহার: ব্রাউজার কনসোলে গিয়ে নিচের কমান্ডগুলো চালান
  unsafeWindow.ivacDebug = {
    checkNetworkPayload,
    startOtpTimer,
    startOtpTimerFromServerTime,
    stopOtpTimer,
    showReservationId,
    showWebviewUrl,
    savedProfiles: () => savedProfiles,
    importHar,
    pickHarFile,
  };

})();