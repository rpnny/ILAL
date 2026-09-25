(function () {
  'use strict';

  const qs = (selector, root = document) => root.querySelector(selector);
  const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];
  const format = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 });
  let sessionToken = null;
  let consoleStatus = null;
  let localOrders = [];
  let preparedBatch = null;
  let metamaskProvider = null;

  window.addEventListener('eip6963:announceProvider', event => {
    if (String(event.detail?.info?.rdns || '').toLowerCase().includes('metamask')) metamaskProvider = event.detail.provider;
  });
  window.dispatchEvent(new Event('eip6963:requestProvider'));

  function walletProvider() {
    return metamaskProvider || window.ethereum?.providers?.find(item => item.isMetaMask && !item.isOkxWallet) || (window.ethereum?.isMetaMask && !window.ethereum?.isOkxWallet ? window.ethereum : null);
  }

  async function connectBrowserWallet() {
    const provider = walletProvider();
    if (!provider) throw new Error('MetaMask is not available.');
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x14a34' }] });
    const [account] = await provider.request({ method: 'eth_requestAccounts' });
    return { provider, account };
  }

  async function waitForWalletReceipt(provider, hash) {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const receipt = await provider.request({ method: 'eth_getTransactionReceipt', params: [hash] });
      if (receipt) {
        if (receipt.status !== '0x1') throw new Error(`Transaction reverted: ${hash}`);
        return receipt;
      }
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    throw new Error(`Transaction is still pending: ${hash}`);
  }

  async function api(path, options = {}) {
    if (!sessionToken) {
      const sessionResponse = await fetch('/api/session', { cache: 'no-store' });
      if (!sessionResponse.ok) throw new Error('The local CLI console is not available. Start it with: ilal console');
      sessionToken = (await sessionResponse.json()).token;
    }
    const response = await fetch(path, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.method && options.method !== 'GET' ? { 'X-ILAL-Console-Token': sessionToken } : {}),
        ...(options.headers || {})
      },
      cache: 'no-store'
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Local API request failed (${response.status}).`);
    return payload;
  }

  function shortHex(value, head = 8, tail = 6) {
    if (!value || value.length <= head + tail + 1) return value || '—';
    return `${value.slice(0, head)}…${value.slice(-tail)}`;
  }

  function humanRaw(value) {
    return format.format(Number(BigInt(value || '0')) / 1_000_000);
  }

  const titles = {
    orders: 'Orders',
    sessions: 'Sessions',
    batches: 'Solver batch',
    evidence: 'Evidence',
    settings: 'Settings'
  };

  function showView(name) {
    const viewName = titles[name] ? name : 'orders';
    qsa('[data-view]').forEach(view => view.classList.toggle('is-active', view.dataset.view === viewName));
    qsa('[data-view-target]').forEach(button => {
      if (button.dataset.viewTarget === viewName) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    qs('#topbarTitle').textContent = titles[viewName];
    history.replaceState(null, '', `#${viewName}`);
  }

  qsa('[data-view-target]').forEach(button => button.addEventListener('click', () => showView(button.dataset.viewTarget)));
  showView(location.hash.slice(1));

  const toast = qs('#toast');
  let toastTimer = null;
  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2600);
  }

  const custodyButton = qs('#custodyButton');
  custodyButton.addEventListener('click', () => {
    if (!consoleStatus) return showToast('Local CLI status is still loading.');
    const signerState = consoleStatus.signer;
    showToast(signerState.ready
      ? `${signerState.kind} ready: ${shortHex(signerState.address)}`
      : 'No local signer configured. Restart with --keystore and --password-file, or --rpc-account.');
  });

  const orderInputs = qsa('#orderForm input, #orderForm select');
  const sellAmount = qs('#sellAmount');
  const sellAsset = qs('#sellAsset');
  const receiveAsset = qs('#receiveAsset');
  const minOutput = qs('#minOutput');
  const maxAmm = qs('#maxAmm');
  const ttl = qs('#ttl');
  const signer = qs('#signer');
  const submittedMetric = qs('#submittedMetric');
  const matchedMetric = qs('#matchedMetric');
  const residualMetric = qs('#residualMetric');
  const matchedPercent = qs('#matchedPercent');
  const residualPercent = qs('#residualPercent');
  const matchedBar = qs('#matchedBar');
  const residualBar = qs('#residualBar');
  const orderCommand = qs('#orderCommand');
  const orderStatus = qs('#orderStatus span:last-child');
  const orderPrimary = qs('#orderPrimary');
  const orderBack = qs('#orderBack');
  const signedOutput = qs('#signedOutput');
  const orderHash = qs('#orderHash');
  let orderStage = 1;

  function safeNumber(input, fallback) {
    const value = Number(input.value);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  }

  function rawUnits(value) {
    return String(Math.round(value * 1_000_000));
  }

  function updateOrderPreview() {
    const submitted = Math.max(0.000001, safeNumber(sellAmount, 0.1));
    const residual = Math.min(submitted, safeNumber(maxAmm, 0.03));
    const matched = Math.max(0, submitted - residual);
    const matchPct = Math.round((matched / submitted) * 100);
    const residualPct = 100 - matchPct;

    submittedMetric.textContent = format.format(submitted);
    matchedMetric.textContent = format.format(matched);
    residualMetric.textContent = format.format(residual);
    matchedPercent.textContent = `${matchPct}%`;
    residualPercent.textContent = `${residualPct}%`;
    matchedBar.style.width = `${matchPct}%`;
    residualBar.style.width = `${residualPct}%`;

    const zeroForOne = sellAsset.value === 'zeroForOne';
    sellAmount.closest('.input-wrap').querySelector('b').textContent = zeroForOne ? 'USDC' : 'hUSDT';
    minOutput.closest('.input-wrap').querySelector('b').textContent = zeroForOne ? 'hUSDT' : 'USDC';
    receiveAsset.innerHTML = `<option>${zeroForOne ? 'hUSDT' : 'USDC'}</option>`;

    orderCommand.textContent = [
      'ilal --keystore institution.json --password-file institution.password \\',
      '  netting order sign \\',
      `  --${zeroForOne ? 'zero-for-one' : 'one-for-zero'} \\`,
      `  --amount-in ${rawUnits(submitted)} \\`,
      `  --min-amount-out ${rawUnits(safeNumber(minOutput, 0.099))} \\`,
      `  --max-amm-input ${rawUnits(residual)} \\`,
      '  --pool 0xeab91a1421cb5c170df74c1eaf676a8836eda1fc5a833f62ab9c2d516acfbc87 \\',
      '  --hook 0x8d1fA43F848701b2adB105D5c925A9247E600088 \\',
      '  --chain 84532 \\',
      `  --ttl ${ttl.value} \\`,
      '  --output signed-order.json'
    ].join('\n');
  }

  orderInputs.forEach(input => input.addEventListener('input', updateOrderPreview));
  updateOrderPreview();

  function setOrderStage(stage) {
    orderStage = stage;
    qsa('[data-order-step]').forEach(step => step.classList.toggle('is-active', Number(step.dataset.orderStep) <= stage));
    orderInputs.forEach(input => { input.disabled = stage !== 1 || input === signer || input === receiveAsset; });
    orderBack.classList.toggle('is-hidden', stage === 1 || stage === 4);
    signedOutput.classList.toggle('is-hidden', stage < 3);

    if (stage === 1) {
      orderPrimary.textContent = 'Review order';
      orderStatus.textContent = 'Draft remains local until review and signing.';
    } else if (stage === 2) {
      orderPrimary.textContent = 'Check & sign with MetaMask';
      orderStatus.textContent = 'Limits validated. Review the residual cap before signing.';
    } else if (stage === 3) {
      orderPrimary.textContent = 'Add to batch workspace';
      orderStatus.textContent = 'Order signed by the institution wallet. No private key entered the browser.';
    } else {
      orderPrimary.textContent = 'Create another order';
      orderStatus.textContent = 'Signed order is available in the local batch workspace.';
    }
  }

  orderPrimary.addEventListener('click', async () => {
    if (orderStage === 1) {
      if (safeNumber(maxAmm, 0) > safeNumber(sellAmount, 0)) {
        showToast('Maximum AMM exposure cannot exceed the sell amount.');
        maxAmm.focus();
        return;
      }
      setOrderStage(2);
    } else if (orderStage === 2) {
      orderPrimary.disabled = true;
      orderPrimary.textContent = 'Connecting institution wallet…';
      try {
        const wallet = await connectBrowserWallet();
        orderPrimary.textContent = 'Checking credential, balance and allowance…';
        const prepared = await api('/api/browser-orders/prepare', {
          method: 'POST',
          body: JSON.stringify({
            user: wallet.account,
            direction: sellAsset.value,
            amountIn: String(safeNumber(sellAmount, 0.1)),
            minAmountOut: String(safeNumber(minOutput, 0.099)),
            maxAmmInput: String(safeNumber(maxAmm, 0.03)),
            ttl: ttl.value
          })
        });
        if (prepared.approval) {
          orderPrimary.textContent = 'Confirm router allowance in MetaMask…';
          const approvalHash = await wallet.provider.request({
            method: 'eth_sendTransaction',
            params: [{ from: wallet.account, to: prepared.approval.to, data: prepared.approval.data, value: '0x0' }]
          });
          await waitForWalletReceipt(wallet.provider, approvalHash);
        }
        orderPrimary.textContent = 'Sign bounded order in MetaMask…';
        const signature = await wallet.provider.request({
          method: 'eth_signTypedData_v4', params: [wallet.account, JSON.stringify(prepared.typedData)]
        });
        const result = await api('/api/browser-orders/save', {
          method: 'POST', body: JSON.stringify({ challengeId: prepared.challengeId, signature })
        });
        orderHash.textContent = result.orderHash;
        setOrderStage(3);
        await loadOrders();
        showToast(`Institution order signed and saved as ${result.name}.`);
      } catch (error) {
        setOrderStage(2);
        orderStatus.textContent = error.message;
        showToast(error.message);
      } finally {
        orderPrimary.disabled = false;
      }
    } else if (orderStage === 3) {
      setOrderStage(4);
      showView('batches');
      showToast('Signed order is available in the local batch workspace.');
    } else {
      orderHash.textContent = '0x—';
      setOrderStage(1);
    }
  });

  orderBack.addEventListener('click', () => setOrderStage(1));

  const sessionCards = qsa('[data-session-step]');
  const sessionAction = qs('#sessionAction');
  const sessionStatus = qs('#sessionStatus');
  let sessionStage = 1;
  const sessionStates = [
    null,
    { button: 'Activate demo grant', status: 'Ready to activate a demo Policy Grant.' },
    { button: 'Create local session', status: 'Demo Policy Grant active for revision 12.' },
    { button: 'Validate demo action', status: 'One-time EIP-712 Session created locally.' },
    { button: 'Reset session demo', status: 'Demo action admitted; nonce consumed in local state.' }
  ];

  function updateSession() {
    sessionCards.forEach(card => {
      const step = Number(card.dataset.sessionStep);
      card.classList.toggle('is-complete', step <= sessionStage);
      card.querySelector('b').textContent = step <= sessionStage ? 'Complete' : 'Waiting';
    });
    sessionAction.textContent = sessionStates[sessionStage].button;
    sessionStatus.textContent = sessionStates[sessionStage].status;
  }
  updateSession();
  sessionAction.addEventListener('click', () => {
    sessionStage = sessionStage === 4 ? 1 : sessionStage + 1;
    updateSession();
  });

  const batchAction = qs('#batchAction');
  const batchStatus = qs('#batchStatus');
  const batchLog = qs('#batchLog');
  const orderTable = qs('#orderTable');
  const orderEmpty = qs('#orderEmpty');

  function appendOrderCell(row, tag, value) {
    const cell = document.createElement(tag);
    cell.textContent = value;
    row.appendChild(cell);
  }

  function renderOrders() {
    qsa('.order-row:not(.order-row-head)', orderTable).forEach(row => row.remove());
    orderEmpty.classList.toggle('is-hidden', localOrders.length > 0);
    qs('#orderCountBadge').textContent = `${localOrders.length} ORDER${localOrders.length === 1 ? '' : 'S'}`;
    localOrders.forEach(item => {
      const row = document.createElement('div');
      row.className = 'order-row';
      row.setAttribute('role', 'row');
      appendOrderCell(row, 'strong', shortHex(item.order.user));
      appendOrderCell(row, 'span', item.order.zeroForOne ? 'USDC → hUSDT' : 'hUSDT → USDC');
      appendOrderCell(row, 'span', humanRaw(item.order.amountIn));
      appendOrderCell(row, 'span', humanRaw(item.order.maxAmmInput));
      appendOrderCell(row, 'b', 'Signed');
      orderTable.appendChild(row);
    });
  }

  async function loadOrders() {
    try {
      localOrders = (await api('/api/orders')).orders;
      renderOrders();
    } catch (error) {
      batchStatus.textContent = error.message;
    }
  }

  batchAction.addEventListener('click', async () => {
    if (localOrders.length < 2) return showToast('Create at least two signed local orders first.');
    batchAction.disabled = true;
    try {
      const orderNames = localOrders.slice(0, 16).map(order => order.name);
      const phase = batchAction.dataset.phase || 'offline';
      if (phase === 'offline') {
        batchAction.textContent = 'Calculating commitment…';
        const result = await api('/api/batches/preview', {
          method: 'POST', body: JSON.stringify({ orders: orderNames })
        });
        const preview = result.preview;
        const gross = BigInt(preview.total0) + BigInt(preview.total1);
        const residual = BigInt(preview.residual0) + BigInt(preview.residual1);
        qs('#batchGross').textContent = humanRaw(gross);
        qs('#batchMatched').textContent = humanRaw(preview.exposureReduction);
        qs('#batchResidual').textContent = humanRaw(residual);
        qs('#batchHeadline').textContent = `${humanRaw(gross)} → ${humanRaw(preview.exposureReduction)} → ${humanRaw(residual)}`;
        batchStatus.textContent = 'Canonical offline commitment passed. Run the pinned live simulation next.';
        batchLog.textContent = [
          `$ ilal netting batch preview --orders ${orderNames.join(' ')}`,
          '', 'ordering:                 orderHash ascending',
          `submitted gross:          ${gross}`,
          `internally matched gross: ${preview.exposureReduction}`,
          `matched each side:        ${preview.matchedEachSide}`,
          `residual token0:          ${preview.residual0}`,
          `residual token1:          ${preview.residual1}`,
          `batchId:                  ${preview.batchId}`
        ].join('\n');
        batchAction.dataset.phase = 'preflight';
        batchAction.textContent = 'Run pinned live preflight';
      } else if (phase === 'preflight') {
        batchAction.textContent = 'Simulating full atomic settlement…';
        preparedBatch = await api('/api/browser-batches/prepare', {
          method: 'POST', body: JSON.stringify({ orders: orderNames })
        });
        const report = preparedBatch.report;
        batchStatus.textContent = `Executable at block ${report.snapshot.blockNumber}. Signatures, credentials, balances, allowances and Chainlink guard passed.`;
        batchLog.textContent += [
          '', '', '$ pinned full-execution preflight',
          `status:                   ${report.status}`,
          `snapshot:                 ${report.snapshot.blockNumber} (${report.snapshot.blockHash})`,
          `estimated gas:            ${report.fees.estimatedExecutionGas}`,
          `oracle:                   ${report.oracle?.status || 'unavailable'}`,
          `challenge expires:        ${new Date(preparedBatch.expiresAt).toLocaleTimeString()}`
        ].join('\n');
        batchAction.dataset.phase = 'broadcast';
        batchAction.textContent = 'Broadcast atomic batch with MetaMask';
        showToast('Live preflight passed. The next click requests a real Base Sepolia transaction.');
      } else if (phase === 'broadcast') {
        if (!preparedBatch) throw new Error('Live batch challenge is missing. Run preflight again.');
        const { provider, account } = await connectBrowserWallet();
        const built = await api('/api/browser-batches/build', {
          method: 'POST', body: JSON.stringify({ challengeId: preparedBatch.challengeId })
        });
        batchAction.textContent = 'Confirm atomic batch in MetaMask…';
        const transactionHash = await provider.request({
          method: 'eth_sendTransaction',
          params: [{ from: account, to: built.transaction.to, data: built.transaction.data, value: '0x0' }]
        });
        const receipt = await waitForWalletReceipt(provider, transactionHash);
        const explorerUrl = `https://sepolia.basescan.org/tx/${transactionHash}`;
        batchStatus.innerHTML = `Confirmed at block ${parseInt(receipt.blockNumber, 16)} · <a href="${explorerUrl}" target="_blank" rel="noreferrer">View on BaseScan ↗</a>`;
        batchLog.textContent += `\n\ntransaction hash:          ${transactionHash}\nstatus:                    confirmed`;
        batchAction.dataset.phase = 'confirmed';
        batchAction.textContent = 'Atomic batch confirmed';
        showToast('Netting batch confirmed on Base Sepolia.');
        await loadOrders();
      }
    } catch (error) {
      batchStatus.textContent = error.message;
      batchLog.textContent = `$ preview rejected\n\n${error.message}`;
      preparedBatch = null;
      batchAction.dataset.phase = 'offline';
      batchAction.textContent = 'Run offline preview';
      showToast(error.message);
    } finally {
      batchAction.disabled = batchAction.dataset.phase === 'confirmed';
    }
  });

  async function loadStatus() {
    const localStatus = qs('#localStatus');
    try {
      consoleStatus = await api('/api/status');
      const candidate = consoleStatus.candidate;
      const signerState = consoleStatus.signer;
      const live = consoleStatus.connected && consoleStatus.contractsReady;
      localStatus.classList.toggle('is-offline', !live);
      localStatus.querySelector('strong').textContent = live ? 'Local CLI connected' : 'CLI connected · RPC degraded';
      localStatus.querySelector('div span').textContent = live ? `Base Sepolia · block ${consoleStatus.blockNumber}` : '127.0.0.1 only';
      qs('#workspaceNetwork').textContent = `${candidate.network} · ${live ? 'Live candidate' : 'Offline candidate'}`;
      qs('#policyState').lastChild.textContent = consoleStatus.policy === true ? 'Policy active' : consoleStatus.policy === false ? 'Policy disabled' : 'Policy unreadable';
      custodyButton.textContent = signerState.ready ? `${signerState.kind} ready` : 'MetaMask on demand';
      custodyButton.classList.toggle('is-connected', true);
      signer.innerHTML = '';
      const option = document.createElement('option');
      option.textContent = signerState.ready ? `${signerState.kind} · ${shortHex(signerState.address)}` : 'Institution MetaMask · selected on sign';
      signer.appendChild(option);
      qs('#settingConnection').textContent = live ? `Connected · block ${consoleStatus.blockNumber}` : 'RPC unavailable';
      qs('#settingSigner').textContent = signerState.ready ? `${signerState.kind} · ${signerState.address || 'configured'}` : 'MetaMask · connected on demand';
      qs('#settingNetwork').textContent = `${candidate.network} · ${candidate.chainId}`;
      qs('#settingPool').textContent = candidate.poolId;
      qs('#settingHook').textContent = candidate.hook;
      qs('#settingRouter').textContent = candidate.router;
      qs('#settingOracle').textContent = candidate.oracle;
    } catch (error) {
      localStatus.classList.add('is-offline');
      localStatus.querySelector('strong').textContent = 'Static preview only';
      localStatus.querySelector('div span').textContent = 'Start with: ilal console';
      qs('#settingConnection').textContent = error.message;
    }
  }

  Promise.all([loadStatus(), loadOrders()]);
})();
