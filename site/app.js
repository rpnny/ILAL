(function () {
  'use strict';

  const qs = (selector, root = document) => root.querySelector(selector);
  const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];
  const money = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 });
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let currentMode = localStorage.getItem('ilal-institution-mode') || 'netting';
  let paySymbol = 'USDC';
  let receiveSymbol = 'hUSDT';
  let activeSheet = null;
  let sheetTrigger = null;
  let toastTimer = null;
  let consoleToken = null;
  let localStatus = null;
  let preparedSwap = null;
  let preparedOrder = null;
  let preparedBatch = null;
  let walletStatus = null;
  let instantTokens = [];
  let nettingTokens = [];
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
    try {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x14a34' }] });
    } catch (error) {
      if (error.code !== 4902 && !String(error.message).includes('Unrecognized chain')) throw error;
      await provider.request({ method: 'wallet_addEthereumChain', params: [{ chainId: '0x14a34', chainName: 'Base Sepolia', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://sepolia.base.org'], blockExplorerUrls: ['https://sepolia.basescan.org'] }] });
    }
    const [account] = await provider.request({ method: 'eth_requestAccounts' });
    await refreshWalletStatus(account);
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

  function numericInput(value) {
    const parsed = Number(String(value).replace(/[^0-9.]/g, ''));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  function tokenButton(button, symbol) {
    button.innerHTML = `${symbol} <span>⌄</span>`;
  }

  function activeTokens() {
    return currentMode === 'instant' ? instantTokens : nettingTokens;
  }

  function selectedToken(symbol) {
    return activeTokens().find(token => token.symbol === symbol);
  }

  function decimalToRaw(value, decimals) {
    const normalized = String(value);
    const [whole = '0', fraction = ''] = normalized.split('.');
    const padded = (fraction + '0'.repeat(decimals)).slice(0, decimals);
    return (BigInt(whole || '0') * (10n ** BigInt(decimals)) + BigInt(padded || '0')).toString();
  }

  function rawToNumber(value, decimals = 6) {
    const raw = BigInt(value || '0');
    const base = 10n ** BigInt(decimals);
    return Number(raw / base) + Number(raw % base) / Number(base);
  }

  function walletToken(symbol) {
    return walletStatus?.tokens?.find(token => token.symbol === symbol);
  }

  function renderWalletStatus() {
    const token = walletToken(paySymbol);
    const label = qs('#tradeBalanceLabel');
    if (!walletStatus || !token) {
      label.textContent = currentMode === 'instant'
        ? 'Wallet balance + allowance checked during preflight'
        : 'Connect MetaMask to read the institution balance';
      return;
    }
    label.textContent = `${money.format(Number(token.balance))} ${token.symbol} · ${walletStatus.credential ? 'institution eligible' : 'credential required'}`;
    qs('#eligibilityLabel').textContent = walletStatus.credential ? 'Eligible' : 'Not eligible';
    qs('#settingEligibility').textContent = walletStatus.credential ? 'Eligible' : 'Credential required';
    qs('#accountNetwork').textContent = `Base Sepolia · ${walletStatus.user.slice(0, 6)}…${walletStatus.user.slice(-4)}`;
  }

  async function refreshWalletStatus(account) {
    walletStatus = await apiPost('/api/browser-wallet/status', { user: account });
    renderWalletStatus();
    return walletStatus;
  }

  function showToast(message) {
    const toast = qs('#appToast');
    toast.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2800);
  }

  function setSurface(name) {
    qsa('[data-surface-view]').forEach(view => view.classList.toggle('is-active', view.dataset.surfaceView === name));
    qsa('[data-surface]').forEach(button => button.classList.toggle('is-active', button.dataset.surface === name));
  }

  qsa('[data-surface]').forEach(button => button.addEventListener('click', () => setSurface(button.dataset.surface)));

  const payAmount = qs('#payAmount');
  const receiveAmount = qs('#receiveAmount');
  const payToken = qs('#payToken');
  const receiveToken = qs('#receiveToken');
  const executionSwitch = qs('.execution-switch');

  function currentSlippageBps() {
    return Number(qs('#slippage').value.split(' ')[0]) || 10;
  }

  function currentAmmLimit() {
    return Number(qs('#ammLimit').value) || 30;
  }

  function currentOrderTtl() {
    return Number(qs('#orderExpiry').value) || 900;
  }

  function updateQuote() {
    const amount = numericInput(payAmount.value);
    const slippage = currentSlippageBps();
    const minimum = Math.max(0, amount * (1 - slippage / 10000));
    const ammPercent = currentAmmLimit();
    const matched = amount * (1 - ammPercent / 100);
    const residual = amount - matched;
    receiveAmount.textContent = money.format(minimum);
    qs('#matchedValue').textContent = `${money.format(matched)} ${paySymbol}`;
    qs('#residualValue').textContent = `${money.format(residual)} ${paySymbol}`;
    qs('#matchTrack').style.width = `${100 - ammPercent}%`;
    qs('#residualTrack').style.width = `${ammPercent}%`;
  }

  function setMode(mode, persist = true) {
    currentMode = mode === 'instant' ? 'instant' : 'netting';
    executionSwitch.dataset.mode = currentMode;
    qsa('[data-mode]', executionSwitch).forEach(button => {
      const selected = button.dataset.mode === currentMode;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-checked', String(selected));
    });
    const instant = currentMode === 'instant';
    const tokens = activeTokens();
    if (tokens.length === 2) {
      paySymbol = tokens[0].symbol;
      receiveSymbol = tokens[1].symbol;
      tokenButton(payToken, paySymbol);
      tokenButton(receiveToken, receiveSymbol);
    }
    if (instant && numericInput(payAmount.value) >= 1000) payAmount.value = '0.001';
    if (!instant && numericInput(payAmount.value) < 0.01) payAmount.value = '0.1';
    qs('#nettingInsight').classList.toggle('is-instant', instant);
    qs('#nettingInsight p').innerHTML = instant
      ? '<span class="mini-status"></span>Policy Grant + one-time Session before direct execution'
      : '<span class="mini-status"></span>Policy + CNF checked before atomic settlement';
    qs('#reviewTrade').textContent = instant ? 'Review instant swap' : 'Review institutional swap';
    qs('#tradeRouteLabel').textContent = instant ? 'Instant · V2 Session candidate' : 'Institutional Netting · SOEE candidate';
    qs('#quoteCaption').textContent = instant ? 'Direct quote · signed minimum output' : 'Bounded by signed minimum output';
    renderWalletStatus();
    qs('#defaultMode').value = currentMode;
    if (persist) localStorage.setItem('ilal-institution-mode', currentMode);
    updateQuote();
  }

  qsa('[data-mode]', executionSwitch).forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
  payAmount.addEventListener('input', updateQuote);
  payAmount.addEventListener('blur', () => { payAmount.value = money.format(numericInput(payAmount.value)); });
  qs('#swapDirection').addEventListener('click', () => {
    [paySymbol, receiveSymbol] = [receiveSymbol, paySymbol];
    tokenButton(payToken, paySymbol);
    tokenButton(receiveToken, receiveSymbol);
    updateQuote();
    renderWalletStatus();
  });

  function openSheet(sheet, trigger) {
    if (activeSheet && activeSheet !== sheet) closeSheet(false);
    activeSheet = sheet;
    sheetTrigger = trigger;
    const scrim = qs('#scrim');
    scrim.hidden = false;
    sheet.hidden = false;
    requestAnimationFrame(() => {
      scrim.classList.add('is-open');
      sheet.classList.add('is-open');
      sheet.querySelector('.close-button')?.focus({ preventScroll: true });
    });
    qs('#accountButton').setAttribute('aria-expanded', String(sheet === qs('#settingsSheet')));
  }

  function closeSheet(restoreFocus = true) {
    if (!activeSheet) return;
    const closing = activeSheet;
    const trigger = sheetTrigger;
    qs('#scrim').classList.remove('is-open');
    closing.classList.remove('is-open');
    qs('#accountButton').setAttribute('aria-expanded', 'false');
    const finish = () => {
      closing.hidden = true;
      qs('#scrim').hidden = true;
      if (restoreFocus) trigger?.focus({ preventScroll: true });
      if (activeSheet === closing) activeSheet = null;
    };
    if (reducedMotion.matches) finish();
    else setTimeout(finish, 360);
  }

  qs('#accountButton').addEventListener('click', event => openSheet(qs('#settingsSheet'), event.currentTarget));
  qs('#tradeSettingsButton').addEventListener('click', event => openSheet(qs('#settingsSheet'), event.currentTarget));
  qsa('[data-close-sheet]').forEach(button => button.addEventListener('click', () => closeSheet()));
  qs('#scrim').addEventListener('click', () => closeSheet());
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && activeSheet) closeSheet();
  });

  function reviewLine(label, value) {
    return `<div class="review-line"><span>${label}</span><strong>${value}</strong></div>`;
  }

  function tradeReviewMarkup() {
    const amount = numericInput(payAmount.value);
    const minimum = numericInput(receiveAmount.textContent);
    const netting = currentMode === 'netting';
    const ammLimit = currentAmmLimit();
    const lines = netting
      ? [
          reviewLine('Execution', 'Institutional Netting'),
          reviewLine('Expected internal match', `${money.format(amount * (1 - ammLimit / 100))} ${paySymbol}`),
          reviewLine('Maximum market exposure', `${money.format(amount * ammLimit / 100)} ${paySymbol}`),
          reviewLine('Order expiry', `${currentOrderTtl() / 60} minutes`),
          reviewLine('Settlement', 'Solver broadcasts the atomic batch')
        ]
      : [
          reviewLine('Execution', 'Instant compliant swap'),
          reviewLine('Route', 'ILAL Router → Uniswap v4'),
          reviewLine('Maximum slippage', `${currentSlippageBps()} bps`),
          reviewLine('Authorization', 'One-time Session'),
          reviewLine('Network', 'Base Sepolia · public transaction')
        ];
    return `
      <div class="review-hero"><span>You receive at least</span><strong>${money.format(minimum)} ${receiveSymbol}</strong><small>for ${money.format(amount)} ${paySymbol}</small></div>
      <div class="review-list">${lines.join('')}</div>
      <div class="review-checks"><div><i>✓</i>Institution policy checked by the local CLI</div><div><i>✓</i>Limits are bound to this request</div><div><i>✓</i>No private key enters the browser</div></div>
      ${netting ? '<p class="execution-note">Your institution signs an order. The Solver later broadcasts the atomic batch; that settlement hash appears on BaseScan.</p>' : '<p class="execution-note danger-note">Step 1 runs a real preflight. Step 2 signs and broadcasts an irreversible Base Sepolia transaction.</p>'}`;
  }

  function liquidityReviewMarkup() {
    return `
      <div class="review-hero"><span>Position capital</span><strong>1,000,000</strong><small>500,000 USDC + 500,000 hUSDT</small></div>
      <div class="review-list">${reviewLine('Pool', 'USDC / hUSDT')}${reviewLine('Strategy', 'Stable range')}${reviewLine('Authorization', 'One-time LP Session')}${reviewLine('Maximum spend', '500,000 per token')}${reviewLine('Custody approval', 'Safe · 2 of 3')}</div>
      <div class="review-checks"><div><i>✓</i>V2 Policy Grant active in candidate flow</div><div><i>✓</i>Hook-gated add liquidity</div><div><i>✓</i>Maximum token spends are explicit</div></div>`;
  }

  function openReview(kind, trigger) {
    const liquidity = kind === 'liquidity';
    qs('#reviewEyebrow').textContent = liquidity ? 'Institutional liquidity' : 'Institutional execution';
    qs('#reviewTitle').textContent = liquidity ? 'Review position' : 'Review swap';
    qs('#reviewBody').innerHTML = liquidity ? liquidityReviewMarkup() : tradeReviewMarkup();
    const approvalButton = qs('#approvalButton');
    preparedSwap = null;
    preparedOrder = null;
    preparedBatch = null;
    approvalButton.dataset.phase = 'prepare';
    approvalButton.textContent = liquidity ? 'Prepare liquidity approval' : currentMode === 'instant' ? 'Run live preflight' : 'Sign netting order';
    approvalButton.disabled = false;
    approvalButton.dataset.kind = kind;
    openSheet(qs('#reviewSheet'), trigger);
  }

  qs('#reviewTrade').addEventListener('click', event => openReview('trade', event.currentTarget));
  qs('#reviewLiquidity').addEventListener('click', event => openReview('liquidity', event.currentTarget));
  qs('#advancedTrade').addEventListener('click', event => openReview('trade', event.currentTarget));
  qs('#advancedLiquidity').addEventListener('click', event => openReview('liquidity', event.currentTarget));
  async function apiPost(path, body) {
    if (!consoleToken) {
      const session = await fetch('/api/session', { cache: 'no-store' });
      if (!session.ok) throw new Error('Local CLI session unavailable.');
      consoleToken = (await session.json()).token;
    }
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-ILAL-Console-Token': consoleToken },
      body: JSON.stringify(body)
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Local CLI request failed.');
    return payload;
  }

  async function apiGet(path) {
    const response = await fetch(path, { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Local CLI request failed.');
    return payload;
  }

  function renderExecutionError(message) {
    const existing = qs('.execution-result', qs('#reviewBody'));
    existing?.remove();
    const panel = document.createElement('div');
    panel.className = 'execution-result is-error';
    panel.textContent = message;
    qs('#reviewBody').append(panel);
  }

  function recordActivity(result) {
    const card = qs('.activity-card');
    const empty = qs('.activity-empty', card);
    if (empty) empty.remove();
    const row = document.createElement('article');
    row.className = 'activity-row';
    row.innerHTML = `<div><span>CONFIRMED · BASE SEPOLIA</span><strong>${result.amountIn} ${result.tokenSymbol} swap</strong><small>Block ${result.blockNumber} · gas ${result.gasUsed}</small></div><a href="${result.explorerUrl}" target="_blank" rel="noreferrer">View on BaseScan ↗</a>`;
    card.prepend(row);
  }

  function recordNettingActivity({ state, orderHash, amount, symbol, details = '', explorerUrl = null, transactionHash = null }) {
    const card = qs('.activity-card');
    const empty = qs('.activity-empty', card);
    if (empty) empty.remove();
    let row = qs(`[data-order-hash="${orderHash}"]`, card);
    if (!row) {
      row = document.createElement('article');
      row.className = 'activity-row';
      row.dataset.orderHash = orderHash;
      card.prepend(row);
    }
    const stateLabel = state === 'settled' ? 'SETTLED · BASE SEPOLIA' : state === 'matched' ? 'MATCHED · READY TO SETTLE' : 'SIGNED · WAITING FOR MATCH';
    row.innerHTML = `<div><span>${stateLabel}</span><strong>${money.format(amount)} ${symbol} netting order</strong><small>${details || orderHash}</small></div>${explorerUrl ? `<a href="${explorerUrl}" target="_blank" rel="noreferrer">View on BaseScan ↗</a>` : '<b class="activity-state">Netting</b>'}`;
    if (transactionHash) row.dataset.transactionHash = transactionHash;
  }

  async function prepareNettingMatch(saved, button) {
    const panel = qs('.execution-result', qs('#reviewBody'));
    const payload = await apiGet('/api/orders');
    const current = payload.orders.find(item => item.name === saved.name);
    if (!current) throw new Error('The signed order was not found in the local institutional orderbook.');
    const now = Math.floor(Date.now() / 1000) + 20;
    const counterpart = payload.orders.find(item => item.name !== saved.name
      && item.order.poolId.toLowerCase() === current.order.poolId.toLowerCase()
      && item.order.zeroForOne !== current.order.zeroForOne
      && Number(item.order.deadline) > now);
    if (!counterpart) {
      panel.innerHTML = `<strong>Order submitted</strong><code>${saved.orderHash}</code><span>Waiting for an eligible institution with the opposite order.</span><span>The Solver will settle automatically when a match is available.</span>`;
      recordNettingActivity({ state: 'waiting', orderHash: saved.orderHash, amount: numericInput(payAmount.value), symbol: paySymbol, details: 'Waiting for an opposing institutional order' });
      button.dataset.phase = 'waiting-match';
      button.textContent = 'Check for match';
      return;
    }
    button.textContent = 'Matching orders and running live preflight…';
    const orderNames = [saved.name, counterpart.name];
    const [{ preview }, batch] = await Promise.all([
      apiPost('/api/batches/preview', { orders: orderNames }),
      apiPost('/api/browser-batches/prepare', { orders: orderNames })
    ]);
    preparedBatch = { ...batch, preview, orderNames, browserWallet: preparedOrder.browserWallet };
    const gross = rawToNumber(BigInt(preview.total0) + BigInt(preview.total1));
    const matchedGross = rawToNumber(BigInt(preview.exposureReduction));
    const residual = rawToNumber(BigInt(preview.residual0) + BigInt(preview.residual1));
    panel.innerHTML = `<strong>Institutional match found</strong><span>${money.format(gross)} submitted · ${money.format(matchedGross)} internally matched</span><span>${money.format(residual)} residual routed to Uniswap v4</span><span>Live preflight passed at block ${batch.report.snapshot.blockNumber}</span><code>${preview.batchId}</code>`;
    recordNettingActivity({ state: 'matched', orderHash: saved.orderHash, amount: numericInput(payAmount.value), symbol: paySymbol, details: `${money.format(matchedGross)} gross internally matched · ${money.format(residual)} residual` });
    button.dataset.phase = 'batch-ready';
    button.textContent = 'Review matched settlement';
  }

  function renderFinalBatchReview(button) {
    const preview = preparedBatch.preview;
    const gross = rawToNumber(BigInt(preview.total0) + BigInt(preview.total1));
    const matchedGross = rawToNumber(BigInt(preview.exposureReduction));
    const residual = rawToNumber(BigInt(preview.residual0) + BigInt(preview.residual1));
    const panel = qs('.execution-result', qs('#reviewBody'));
    panel.innerHTML = `<strong>Final Base Sepolia settlement</strong><span>${money.format(gross)} gross orders</span><span>${money.format(matchedGross)} settled internally</span><span>${money.format(residual)} maximum AMM residual</span><span>The next action opens MetaMask for one real atomic batch transaction.</span>`;
    button.dataset.phase = 'broadcast-batch';
    button.textContent = 'Confirm atomic settlement on Base Sepolia';
  }

  qs('#approvalButton').addEventListener('click', async event => {
    const button = event.currentTarget;
    const kind = button.dataset.kind;
    if (kind !== 'trade') {
      button.disabled = true;
      button.textContent = 'Liquidity approval prepared';
      showToast('Liquidity broadcast is not enabled in this demo yet.');
      return;
    }
    if (currentMode === 'netting') {
      try {
        button.disabled = true;
        if (button.dataset.phase === 'prepare') {
          const tokenIn = selectedToken(paySymbol);
          if (!tokenIn) throw new Error('Netting candidate token metadata is unavailable.');
          const browserWallet = await connectBrowserWallet();
          const amount = numericInput(payAmount.value);
          const minimum = numericInput(receiveAmount.textContent);
          const maxAmmInput = amount * currentAmmLimit() / 100;
          button.textContent = 'Checking credential, balance and allowance…';
          preparedOrder = await apiPost('/api/browser-orders/prepare', {
            user: browserWallet.account,
            direction: tokenIn.address.toLowerCase() === localStatus.candidate.token0.address.toLowerCase() ? 'zeroForOne' : 'oneForZero',
            amountIn: String(amount), minAmountOut: String(minimum),
            maxAmmInput: String(maxAmmInput), ttl: String(currentOrderTtl())
          });
          preparedOrder.browserWallet = browserWallet;
          const panel = document.createElement('div');
          panel.className = 'execution-result is-ready';
          panel.innerHTML = `<strong>Order checks passed</strong><span>Signer ${preparedOrder.preview.signer.slice(0, 8)}…${preparedOrder.preview.signer.slice(-6)}</span><span>Maximum AMM input ${preparedOrder.preview.maxAmmInputRaw} raw units</span><span>Order expires ${new Date(Number(preparedOrder.typedData.message.deadline) * 1000).toLocaleTimeString()}</span>`;
          qs('#reviewBody').append(panel);
          button.dataset.phase = preparedOrder.approval ? 'approve-order' : 'sign-order';
          button.textContent = preparedOrder.approval ? `Approve ${paySymbol} for Batch Router` : 'Sign netting order in MetaMask';
          showToast('Order checks passed. The next step is explicit wallet authorization.');
        } else if (button.dataset.phase === 'approve-order') {
          const { provider, account } = preparedOrder.browserWallet;
          button.textContent = `Confirm ${paySymbol} approval in MetaMask…`;
          const hash = await provider.request({ method: 'eth_sendTransaction', params: [{ from: account, to: preparedOrder.approval.to, data: preparedOrder.approval.data, value: '0x0' }] });
          await waitForWalletReceipt(provider, hash);
          button.dataset.phase = 'sign-order';
          button.textContent = 'Sign netting order in MetaMask';
          showToast('Router allowance confirmed. The order itself is still only a signature.');
        } else if (button.dataset.phase === 'sign-order') {
          const { provider, account } = preparedOrder.browserWallet;
          button.textContent = 'Sign bounded order in MetaMask…';
          const signature = await provider.request({ method: 'eth_signTypedData_v4', params: [account, JSON.stringify(preparedOrder.typedData)] });
          const saved = await apiPost('/api/browser-orders/save', { challengeId: preparedOrder.challengeId, signature });
          const panel = qs('.execution-result', qs('#reviewBody'));
          panel.className = 'execution-result is-success';
          panel.innerHTML = `<strong>Signed order submitted</strong><code>${saved.orderHash}</code><span>Searching the local institutional orderbook…</span>`;
          preparedOrder.saved = saved;
          await prepareNettingMatch(saved, button);
          showToast(button.dataset.phase === 'batch-ready' ? 'Institutional match found. Live preflight passed.' : 'Order submitted. Waiting for an opposing institution.');
        } else if (button.dataset.phase === 'waiting-match') {
          if (!preparedOrder?.saved) throw new Error('The submitted order is unavailable. Review the order again.');
          await prepareNettingMatch(preparedOrder.saved, button);
        } else if (button.dataset.phase === 'batch-ready') {
          if (!preparedBatch) throw new Error('The matched batch is unavailable. Check for a match again.');
          renderFinalBatchReview(button);
        } else if (button.dataset.phase === 'broadcast-batch') {
          if (!preparedBatch) throw new Error('The matched batch is unavailable. Run live preflight again.');
          const { provider, account } = preparedBatch.browserWallet;
          button.textContent = 'Refreshing final atomic simulation…';
          const built = await apiPost('/api/browser-batches/build', { challengeId: preparedBatch.challengeId });
          button.textContent = 'Confirm atomic batch in MetaMask…';
          const transactionHash = await provider.request({ method: 'eth_sendTransaction', params: [{ from: account, to: built.transaction.to, data: built.transaction.data, value: '0x0' }] });
          const receipt = await waitForWalletReceipt(provider, transactionHash);
          const preview = preparedBatch.preview;
          const matchedGross = rawToNumber(BigInt(preview.exposureReduction));
          const residual = rawToNumber(BigInt(preview.residual0) + BigInt(preview.residual1));
          const explorerUrl = `https://sepolia.basescan.org/tx/${transactionHash}`;
          const panel = qs('.execution-result', qs('#reviewBody'));
          panel.className = 'execution-result is-success';
          panel.innerHTML = `<strong>Netting batch settled</strong><span>${money.format(matchedGross)} gross matched internally · ${money.format(residual)} residual</span><code>${transactionHash}</code><a href="${explorerUrl}" target="_blank" rel="noreferrer">View atomic batch on BaseScan ↗</a>`;
          recordNettingActivity({ state: 'settled', orderHash: preparedOrder.saved.orderHash, amount: numericInput(payAmount.value), symbol: paySymbol, details: `Block ${parseInt(receipt.blockNumber, 16)} · ${money.format(matchedGross)} internally matched`, explorerUrl, transactionHash });
          button.dataset.phase = 'done';
          button.textContent = 'Netting settlement confirmed';
          showToast('Atomic Netting batch confirmed. BaseScan evidence is ready.');
          setSurface('activity');
        }
      } catch (error) {
        renderExecutionError(error.message || String(error));
        button.dataset.phase = 'prepare';
        button.textContent = 'Review and try again';
        preparedOrder = null;
      } finally {
        button.disabled = button.dataset.phase === 'done';
      }
      return;
    }
    try {
      button.disabled = true;
      if (button.dataset.phase === 'prepare') {
        const tokenIn = selectedToken(paySymbol);
        const tokenOut = selectedToken(receiveSymbol);
        if (!tokenIn || !tokenOut) throw new Error('Instant candidate token metadata is unavailable.');
        button.textContent = 'Running policy, balance and route checks…';
        const minimumHuman = numericInput(receiveAmount.textContent);
        const cliSignerReady = Boolean(localStatus?.signer?.ready);
        let browserWallet = null;
        if (!cliSignerReady) browserWallet = await connectBrowserWallet();
        preparedSwap = await apiPost(cliSignerReady ? '/api/swaps/prepare' : '/api/browser-swaps/prepare', {
          amountIn: String(numericInput(payAmount.value)),
          minAmountOut: decimalToRaw(minimumHuman, Number(tokenOut.decimals)),
          tokenIn: tokenIn.address,
          ttl: '600',
          ...(browserWallet ? { user: browserWallet.account } : {})
        });
        preparedSwap.browserWallet = browserWallet;
        const preview = preparedSwap.preview;
        const panel = document.createElement('div');
        panel.className = 'execution-result is-ready';
        panel.innerHTML = `<strong>Preflight passed</strong><span>Signer ${preview.signer.slice(0, 8)}…${preview.signer.slice(-6)}</span><span>Exact debit limit ${preview.totalDebitRaw} raw units</span><span>Challenge expires ${new Date(preparedSwap.expiresAt).toLocaleTimeString()}</span>`;
        qs('#reviewBody').append(panel);
        button.dataset.phase = 'broadcast';
        button.textContent = 'Confirm & broadcast to Base Sepolia';
        showToast('Preflight passed. Review once more before broadcasting.');
      } else {
        if (!preparedSwap) throw new Error('Preflight challenge is missing.');
        button.textContent = 'Signing and broadcasting…';
        let result;
        if (preparedSwap.browserWallet) {
          const { provider, account } = preparedSwap.browserWallet;
          button.textContent = 'Sign one-time Session in MetaMask…';
          const signature = await provider.request({ method: 'eth_signTypedData_v4', params: [account, JSON.stringify(preparedSwap.typedData)] });
          const built = await apiPost('/api/browser-swaps/build', { challengeId: preparedSwap.challengeId, signature });
          let approvalHash = null;
          if (built.approval) {
            button.textContent = 'Confirm token approval in MetaMask…';
            approvalHash = await provider.request({ method: 'eth_sendTransaction', params: [{ from: account, to: built.approval.to, data: built.approval.data, value: '0x0' }] });
            await waitForWalletReceipt(provider, approvalHash);
          }
          button.textContent = 'Confirm swap broadcast in MetaMask…';
          const transactionHash = await provider.request({ method: 'eth_sendTransaction', params: [{ from: account, to: built.swap.to, data: built.swap.data, value: '0x0' }] });
          const receipt = await waitForWalletReceipt(provider, transactionHash);
          result = {
            amountIn: String(numericInput(payAmount.value)), tokenSymbol: paySymbol,
            transactionHash, explorerUrl: `https://sepolia.basescan.org/tx/${transactionHash}`,
            approvalExplorerUrl: approvalHash ? `https://sepolia.basescan.org/tx/${approvalHash}` : null,
            blockNumber: parseInt(receipt.blockNumber, 16).toString(), gasUsed: BigInt(receipt.gasUsed).toString()
          };
        } else {
          const payload = await apiPost('/api/swaps/broadcast', {
            challengeId: preparedSwap.challengeId,
            confirmation: preparedSwap.confirmation
          });
          result = payload.result;
        }
        const panel = qs('.execution-result', qs('#reviewBody'));
        panel.className = 'execution-result is-success';
        panel.innerHTML = `<strong>Confirmed on Base Sepolia</strong><code>${result.transactionHash}</code><a href="${result.explorerUrl}" target="_blank" rel="noreferrer">View transaction on BaseScan ↗</a>${result.approvalExplorerUrl ? `<a href="${result.approvalExplorerUrl}" target="_blank" rel="noreferrer">View token approval ↗</a>` : ''}`;
        button.textContent = 'Transaction confirmed';
        recordActivity(result);
        showToast('Swap confirmed. BaseScan evidence is ready.');
        setSurface('activity');
      }
    } catch (error) {
      renderExecutionError(error.message || String(error));
      button.dataset.phase = 'prepare';
      button.textContent = 'Run live preflight again';
    } finally {
      button.disabled = button.textContent === 'Transaction confirmed';
    }
  });

  qs('#defaultMode').addEventListener('change', event => setMode(event.target.value));
  qs('#slippage').addEventListener('change', () => { updateQuote(); showToast('Local trading preference updated.'); });
  qs('#ammLimit').addEventListener('change', () => { updateQuote(); showToast('Institutional AMM exposure limit updated locally.'); });

  async function loadLocalStatus() {
    try {
      const response = await fetch('/api/status', { cache: 'no-store' });
      if (!response.ok) throw new Error('Local CLI unavailable');
      const status = await response.json();
      localStatus = status;
      nettingTokens = status.candidate ? [status.candidate.token0, status.candidate.token1] : [];
      instantTokens = status.instantCandidate?.tokens || [];
      const signer = status.signer || {};
      const eligibility = status.credential === true ? 'Eligible' : status.policy === true ? 'Demo eligible' : 'Policy unavailable';
      qs('#eligibilityLabel').textContent = eligibility;
      qs('#settingEligibility').textContent = eligibility;
      qs('#accountNetwork').textContent = status.connected ? `${status.candidate.network} · Live` : 'Base Sepolia · Offline';
      qs('#settingSigningMethod').textContent = signer.ready ? `${signer.kind} · ${signer.address ? `${signer.address.slice(0, 8)}…${signer.address.slice(-6)}` : 'ready'}` : 'MetaMask · connected on demand';
      qs('#settingApprovalPolicy').textContent = 'Preflight → Session → wallet broadcast';
      qs('#settingHook').textContent = status.instantCandidate?.hook || status.candidate.hook;
      setMode(currentMode, false);
    } catch {
      qs('#eligibilityLabel').textContent = 'Demo profile';
      qs('#settingEligibility').textContent = 'Demo profile';
      qs('#settingSigningMethod').textContent = 'Static preview';
    }
  }

  async function refreshConnectedWallet() {
    try {
      const provider = walletProvider();
      if (!provider) return;
      const accounts = await provider.request({ method: 'eth_accounts' });
      if (accounts?.[0]) await refreshWalletStatus(accounts[0]);
    } catch {
      // A disconnected wallet is a valid initial state; explicit connection happens during review.
    }
  }

  setMode(currentMode, false);
  updateQuote();
  loadLocalStatus();
  setTimeout(refreshConnectedWallet, 250);
})();
