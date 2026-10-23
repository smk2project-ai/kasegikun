const { ethers } = window;

// ===== 設定（チェーンごとの Uniswap v3 公式アドレス：developers.uniswap.org の deployments より） =====
const CHAINS = {
  robinhood: {
    id: 4663, hex: '0x1237', name: 'Robinhood Chain',
    rpc: 'https://rpc.mainnet.chain.robinhood.com', explorer: 'https://robinhoodchain.blockscout.com',
    npm: '0x73991a25c818bf1f1128deaab1492d45638de0d3', factory: '0x1f7d7550b1b028f7571e69a784071f0205fd2efa',
    router: '0xcaf681a66d020601342297493863e78c959e5cb2', quoter: '0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7',
    weth: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
    gecko: 'robinhood', geckoDex: 'uniswap-v3-robinhood', uni: 'robinhood',
    favs: [{ addr: '0xd29893ffac8b29ec4db2cfe0cdb3fe1377c028ff', name: 'Index / WETH 1%' }],
    known: { WETH: ['0x0bd7d308f8e1639fab988df18a8011f41eacad73'], USDG: ['0x5fc5360d0400a0fd4f2af552add042d716f1d168'] },
  },
  arbitrum: {
    id: 42161, hex: '0xa4b1', name: 'Arbitrum One',
    rpc: 'https://arb1.arbitrum.io/rpc', explorer: 'https://arbiscan.io',
    npm: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88', factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
    router: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45', quoter: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
    weth: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    gecko: 'arbitrum', geckoDex: 'uniswap_v3_arbitrum', uni: 'arbitrum',
    favs: [{ addr: '0xc6962004f452be9203591991d15f6b388e09e8d0', name: 'WETH / USDC 0.05%' }],
    known: {
      WETH: ['0x82af49447d8a07e3bd95bd0d56f35241523fbab1'],
      USDC: ['0xaf88d065e77c8cc2239327c5edb3a432268e5831', '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8'],
      'USD₮0': ['0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9'], USDT: ['0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9'],
      WBTC: ['0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f'], ARB: ['0x912ce59144191c1204e64559fe8253a0e49e6548'],
      DAI: ['0xda10009cbd5d07dd0cecc66161fc93d7c9000da1'],
    },
  },
  base: {
    id: 8453, hex: '0x2105', name: 'Base',
    rpc: 'https://mainnet.base.org', explorer: 'https://basescan.org',
    npm: '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1', factory: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
    router: '0x2626664c2603336E57B271c5C0b26F421741e481', quoter: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a',
    weth: '0x4200000000000000000000000000000000000006',
    gecko: 'base', geckoDex: 'uniswap-v3-base', uni: 'base',
    favs: [{ addr: '0xd0b53d9277642d899df5c87a3966a349a798f224', name: 'WETH / USDC 0.05%' }],
    known: {
      WETH: ['0x4200000000000000000000000000000000000006'], USDC: ['0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'],
      USDT: ['0xfde4c96c8593536e31f229ea8f37b2ada2699bb2'], DAI: ['0x50c5725949a6f0c72e6c4a641f24049a917db0cb'],
      CBBTC: ['0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf'],
    },
  },
};
// 使うチェーン：URLの ?chain= ＞ 前回の選択 ＞ Robinhood
const CHAIN_KEY = (() => {
  const q = new URLSearchParams(location.search).get('chain');
  let saved = null; try { saved = localStorage.getItem('nba.chain'); } catch {}
  return CHAINS[q] ? q : CHAINS[saved] ? saved : 'robinhood';
})();
const CHAIN = CHAINS[CHAIN_KEY];
const NPM = CHAIN.npm, FACTORY = CHAIN.factory, WETH = CHAIN.weth;
const DEFAULT_FAVS = CHAIN.favs;
// ペア一覧・ドル価格の取得元（GeckoTerminal 公開API・無料・1分30回まで）
const GECKO = 'https://api.geckoterminal.com/api/v2';
const GECKO_DEX = CHAIN.geckoDex;
const GECKO_GAP_MIN = 6500, GECKO_GAP_MAX = 15000; // 問い合わせの間隔（ミリ秒）。実測で1分8〜10回が上限。制限に当たると自動で広げる
const MAX128 = (1n << 128n) - 1n;
const MIN_TICK = -887272, MAX_TICK = 887272;
const FEE_LEVELS = [
  { fee: 100, label: '0.01%', desc: '非常に安定したペアに最適', ex: 'USDT/USDC など、価格がほぼ動かないペア' },
  { fee: 500, label: '0.05%', desc: '安定したペアに最適', ex: 'ETH/stETH など、値動きの小さいペア' },
  { fee: 3000, label: '0.3%', desc: 'ほとんどのペアに最適', ex: 'ETH/USDC など、人気のペア' },
  { fee: 10000, label: '1%', desc: 'マイナーなペアに最適', ex: '値動きの大きいペア' },
];

const NPM_ABI = [
  'function positions(uint256) view returns (uint96 nonce,address operator,address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint128 liquidity,uint256 fg0,uint256 fg1,uint128 tokensOwed0,uint128 tokensOwed1)',
  'function balanceOf(address) view returns (uint256)',
  'function ownerOf(uint256) view returns (address)',
  'function tokenOfOwnerByIndex(address,uint256) view returns (uint256)',
  'function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline)) payable returns (uint256,uint128,uint256,uint256)',
  'function increaseLiquidity((uint256 tokenId,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,uint256 deadline)) payable returns (uint128,uint256,uint256)',
  'function decreaseLiquidity((uint256 tokenId,uint128 liquidity,uint256 amount0Min,uint256 amount1Min,uint256 deadline)) payable returns (uint256,uint256)',
  'function collect((uint256 tokenId,address recipient,uint128 amount0Max,uint128 amount1Max)) payable returns (uint256 amount0,uint256 amount1)',
  'function multicall(bytes[] data) payable returns (bytes[])',
  'function refundETH() payable',
  'function unwrapWETH9(uint256 amountMinimum,address recipient) payable',
  'function sweepToken(address token,uint256 amountMinimum,address recipient) payable',
  'event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
  'event DecreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
  'event Collect(uint256 indexed tokenId, address recipient, uint256 amount0, uint256 amount1)',
];
const FACTORY_ABI = ['function getPool(address,address,uint24) view returns (address)'];
const ROUTER_ABI = [
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)',
  'function multicall(uint256 deadline,bytes[] data) payable returns (bytes[])',
  'function unwrapWETH9(uint256 amountMinimum,address recipient) payable',
];
const QUOTER_ABI = ['function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)'];
const ROUTER_THIS = '0x0000000000000000000000000000000000000002'; // SwapRouter02 の「ルーター自身」宛て
const POOL_ABI = [
  'function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16,uint16,uint16,uint8,bool)',
  'function tickSpacing() view returns (int24)',
  'function liquidity() view returns (uint128)',
  'function token0() view returns (address)', 'function token1() view returns (address)', 'function fee() view returns (uint24)',
];
const ERC20_ABI = [
  'function symbol() view returns (string)', 'function decimals() view returns (uint8)', 'function name() view returns (string)',
  'function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
];

const rpc = new ethers.JsonRpcProvider(CHAIN.rpc, CHAIN.id, { staticNetwork: true });
const npmR = new ethers.Contract(NPM, NPM_ABI, rpc);
const factoryR = new ethers.Contract(FACTORY, FACTORY_ABI, rpc);
const npmIface = new ethers.Interface(NPM_ABI);
const routerIface = new ethers.Interface(ROUTER_ABI);
const quoterR = new ethers.Contract(CHAIN.quoter, QUOTER_ABI, rpc);

const S = { account: null, signer: null, pool: null, invert: false, tokenCache: {}, prices: {}, tokInfo: {}, positions: {} };
const $ = id => document.getElementById(id);
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ===== 共通 =====
function log(msg, hash) {
  const t = new Date().toLocaleTimeString('ja-JP');
  const el = document.createElement('div');
  el.textContent = `[${t}] ${msg} `;
  if (hash) { const a = document.createElement('a'); a.href = `${CHAIN.explorer}/tx/${hash}`; a.target = '_blank'; a.textContent = '取引を見る'; el.appendChild(a); }
  $('log').prepend(el);
}
function errMsg(e) {
  if (e?.code === 'ACTION_REJECTED' || e?.info?.error?.code === 4001) return 'メタマスクでキャンセルされました';
  return e?.shortMessage || e?.reason || e?.message || String(e);
}
function fmt(x, d = 6) {
  if (!isFinite(x)) return '∞';
  if (x === 0) return '0';
  const a = Math.abs(x);
  if (a >= 1000) return x.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (a >= 1) return x.toLocaleString('en-US', { maximumFractionDigits: 4 });
  return x.toPrecision(d).replace(/\.?0+$/, '');
}
const usd = x => !isFinite(x) ? '-' : x >= 1e6 ? `$${(x / 1e6).toFixed(2)}M` : x >= 1e3 ? `$${(x / 1e3).toFixed(2)}K` : `$${x.toFixed(2)}`;
// 外部から来る名前は記号を除いてから画面に出す（悪意あるトークン名対策）
const clean = s => String(s).replace(/&amp;/g, '&').replace(/&/g, '＆').replace(/[<>"'`]/g, '').slice(0, 60);
const toNum = (big, dec) => Number(ethers.formatUnits(big, dec));
const floorBig = x => (x > 0 && isFinite(x)) ? BigInt(Math.floor(x)) : 0n;
const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
const tickToRaw = t => Math.pow(1.0001, t);
const sqrtAt = t => Math.pow(1.0001, t / 2);
const showSym = t => t.isWeth ? 'WETH' : t.symbol;
// 頭文字の丸アイコン（色はアドレスから決める）
function av(sym, addr = sym) {
  let h = 0; for (const c of String(addr)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `<span class="av" style="background:hsl(${h},45%,42%)">${clean(sym).slice(0, 3)}</span>`;
}
const priceOf = t => S.prices[(t.addr || t).toLowerCase()];

async function token(addr) {
  const k = addr.toLowerCase();
  if (!S.tokenCache[k]) {
    const c = new ethers.Contract(addr, ERC20_ABI, rpc);
    const [symbol, decimals] = await Promise.all([c.symbol(), c.decimals()]);
    S.tokenCache[k] = { addr: ethers.getAddress(addr), symbol: clean(symbol), decimals: Number(decimals), isWeth: k === WETH.toLowerCase() };
  }
  return S.tokenCache[k];
}

// 流動性 → 各トークン量（生の単位、浮動小数）
function amountsFromL(L, sqrtP, tl, tu) {
  const sa = sqrtAt(tl), sb = sqrtAt(tu);
  if (sqrtP <= sa) return [L * (sb - sa) / (sa * sb), 0];
  if (sqrtP >= sb) return [0, L * (sb - sa)];
  return [L * (sb - sqrtP) / (sqrtP * sb), L * (sqrtP - sa)];
}

// ===== 画面の切り替え =====
function showView(v) {
  $('viewPair').style.display = v === 'pair' ? '' : 'none';
  $('viewPos').style.display = v === 'pos' ? '' : 'none';
  $('viewEarn').style.display = v === 'earn' ? '' : 'none';
  $('navEarn').classList.toggle('on', v === 'earn');
  $('navPair').classList.toggle('on', v === 'pair');
  $('navPos').classList.toggle('on', v === 'pos');
}

// ===== ウォレット =====
async function connect() {
  if (!window.ethereum) { alert('メタマスクが見つかりません。Chromeにメタマスクを入れてください。'); return; }
  const btn = $('btnConnect'), label = btn.textContent;
  btn.textContent = '接続中…（メタマスクを確認）'; btn.disabled = true;
  try {
    await window.ethereum.request({ method: 'eth_requestAccounts' });
    await ensureChain();
    S.signer = await new ethers.BrowserProvider(window.ethereum).getSigner();
    S.account = await S.signer.getAddress();
    $('btnConnect').textContent = S.account.slice(0, 6) + '…' + S.account.slice(-4);
    $('acct').textContent = '接続中のウォレット ' + S.account;
    $('netChip').textContent = CHAIN.name; $('netChip').className = 'chip on';
    log('接続しました ' + S.account);
    if (S.pool) await refreshBalances();
    await loadPositions();
    loadPortfolio();
  } catch (e) {
    // 失敗の理由は画面下のログだけだと気づかれないので、その場で知らせる
    btn.textContent = label;
    const code = e?.code ?? e?.error?.code ?? e?.info?.error?.code;
    const msg = code === -32002
      ? 'メタマスクに確認画面が出たままになっています。\nChrome右上のメタマスク（キツネ）のアイコンを押して、出ている画面で「接続」や「承認」を押してください。\n（メタマスクにロックがかかっているときは、先にパスワードで開いてください）'
      : code === 4001 || e?.code === 'ACTION_REJECTED'
        ? 'メタマスクでキャンセルされました。もう一度「メタマスクに接続」を押してください。'
        : '接続できませんでした：' + errMsg(e);
    log('接続エラー: ' + msg.replace(/\n/g, ' '));
    alert(msg);
  } finally { btn.disabled = false; }
}
async function ensureChain() {
  const cur = await window.ethereum.request({ method: 'eth_chainId' });
  if (parseInt(cur, 16) === CHAIN.id) return;
  try {
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN.hex }] });
  } catch (e) {
    if (e.code === 4902 || e?.data?.originalError?.code === 4902) {
      await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{
        chainId: CHAIN.hex, chainName: CHAIN.name, rpcUrls: [CHAIN.rpc], blockExplorerUrls: [CHAIN.explorer],
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 } }] });
    } else throw e;
  }
}
async function signerReady() {
  if (!S.signer) { await connect(); if (!S.signer) throw new Error('ウォレット未接続'); }
  await ensureChain();
  S.signer = await new ethers.BrowserProvider(window.ethereum).getSigner();
  return S.signer;
}
async function sendTx(label, txPromise) {
  const tx = await txPromise;
  log(`${label}：送信しました。承認待ち…`, tx.hash);
  const r = await tx.wait();
  if (r.status !== 1) throw new Error('取引が失敗しました');
  log(`${label}：完了`, tx.hash);
  return r;
}
async function ensureAllowance(tok, amount, spender = NPM) {
  if (amount === 0n) return;
  const c = new ethers.Contract(tok.addr, ERC20_ABI, S.signer);
  const cur = await c.allowance(S.account, spender);
  if (cur >= amount) return;
  await sendTx(`${tok.symbol} の使用許可`, c.approve(spender, amount));
}

// ===== GeckoTerminal（一覧・ドル価格） =====
let geckoLast = 0, geckoGap = GECKO_GAP_MIN;
// 問い合わせは1本ずつ順番に（同時に投げると回数制限に当たりやすい）
// 今見ているペアの分（urgent）は、一覧やおすすめ分析の分より先に回す。skip() が真になった分（別のペアに移った）は問い合わせずに捨てる
const geckoJobs = []; let geckoBusy = false;
function gecko(path, o = {}) {
  return new Promise((resolve, reject) => {
    const job = { path, resolve, reject, urgent: !!o.urgent, skip: o.skip };
    const i = job.urgent ? geckoJobs.findIndex(j => !j.urgent) : -1;
    geckoJobs.splice(i < 0 ? geckoJobs.length : i, 0, job);
    geckoPump();
  });
}
async function geckoPump() {
  if (geckoBusy) return; geckoBusy = true;
  while (geckoJobs.length) {
    const j = geckoJobs.shift();
    if (j.skip?.()) { j.reject(new Error('別のペアに移ったため取りやめ')); continue; }
    try { j.resolve(await geckoFetch(j.path)); } catch (e) { j.reject(e); }
  }
  geckoBusy = false;
}
async function geckoFetch(path) {
  // 回数制限に当たると 429（CORSなしで Failed to fetch になることも）→ 間隔を広げて、待ってやり直す
  for (let i = 0; ; i++) {
    const wait = geckoLast + geckoGap - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    geckoLast = Date.now();
    let r = null;
    try { r = await fetch(GECKO + path, { headers: { accept: 'application/json' } }); } catch {}
    if (r?.ok) { geckoGap = Math.max(GECKO_GAP_MIN, geckoGap - 1000); const j = await r.json(); absorbGecko(j); return j; } // 成功が続けば間隔を少しずつ戻す
    geckoGap = Math.min(geckoGap * 2, GECKO_GAP_MAX);
    if (i >= 3) throw new Error('データの取得に失敗しました（回数制限）。1分ほど待ってからもう一度。');
    await new Promise(res => setTimeout(res, 10000 * (i + 1)));
  }
}
// 返ってきたデータから、トークン名とドル価格を覚えておく
function absorbGecko(j) {
  (j.included || []).forEach(t => {
    if (t.type !== 'token') return;
    const a = t.attributes; S.tokInfo[a.address.toLowerCase()] = { symbol: clean(a.symbol), name: clean(a.name || a.symbol) };
  });
  [].concat(j.data || []).forEach(x => {
    const a = x?.attributes, r = x?.relationships; if (!a || !r) return;
    const id = d => d?.data?.id?.split('_').pop()?.toLowerCase();
    const b = id(r.base_token), q = id(r.quote_token);
    if (b && a.base_token_price_usd) S.prices[b] = Number(a.base_token_price_usd);
    if (q && a.quote_token_price_usd) S.prices[q] = Number(a.quote_token_price_usd);
  });
}
async function ensurePrices(addrs) {
  const miss = [...new Set(addrs.map(a => a.toLowerCase()))].filter(a => S.prices[a] == null).slice(0, 30);
  if (!miss.length) return;
  try {
    const j = await gecko(`/simple/networks/${CHAIN.gecko}/token_price/${miss.join(',')}`);
    Object.entries(j?.data?.attributes?.token_prices || {}).forEach(([a, p]) => { if (p != null) S.prices[a.toLowerCase()] = Number(p); });
  } catch {}
}

// ===== 偽物・小さいプールの注意 =====
const LOW_TVL = 10000; // これより小さい流動性（ドル）は注意を出す
// 一覧に出ているプールから、トークンごとの流動性の合計と、同じ名前のトークンを集める
function tokenStats() {
  const tvl = {}, bySym = {};
  [...L.pools, ...(L.search || [])].forEach(p => [p.base, p.quote].forEach(a => { if (a) tvl[a] = (tvl[a] || 0) + p.tvl; }));
  Object.entries(S.tokInfo).forEach(([a, t]) => { const k = t.symbol.toUpperCase(); (bySym[k] = bySym[k] || []).push(a); });
  return { tvl, bySym };
}
function tokenWarn(addr, sym) {
  if (!addr) return '';
  addr = addr.toLowerCase(); const k = String(sym || S.tokInfo[addr]?.symbol || '').toUpperCase();
  const known = CHAIN.known[k];
  if (known) return known.includes(addr) ? '' : `本物の ${k} とアドレスが違います（偽物の可能性）`;
  if (Object.values(CHAIN.known).flat().includes(addr)) return '';
  if (k === 'ETH') return '「ETH」という名前のトークンは偽物の可能性があります（本物のETHはトークンではありません）';
  if (/[^\x20-\x7E]/.test(k)) return '名前に見慣れない文字が入っています（本物に似せた偽物の可能性）';
  const { tvl, bySym } = tokenStats(), same = bySym[k] || [];
  if (same.length > 1) {
    const top = same.reduce((a, b) => (tvl[b] || 0) > (tvl[a] || 0) ? b : a);
    if (top !== addr) return `同じ名前「${k}」のトークンが他にもあります（流動性が一番大きいのは ${top.slice(0, 8)}…）`;
  }
  return '';
}
function renderPoolWarn(tvl) {
  const P = S.pool; if (!P) return;
  const w = [P.t0, P.t1].map(t => tokenWarn(t.addr, t.symbol) && `${t.symbol}（${t.addr.slice(0, 8)}…）：${tokenWarn(t.addr, t.symbol)}`).filter(Boolean);
  if (tvl === undefined) tvl = P.tvl;
  if (tvl != null && isFinite(tvl) && tvl < LOW_TVL) w.push(`流動性が小さいプールです（${usd(tvl)}）。価格が急に動きやすく、交換の目減りも大きくなります。`);
  if (tvl === null) w.push('このプールの流動性の情報が取れませんでした。');
  S.warns = w;
  if (!w.length) { $('poolWarn').style.display = 'none'; S.warnAck = true; return; }
  S.warnAck = false;
  $('poolWarn').style.display = '';
  $('poolWarn').innerHTML = `<b class="warn">⚠ 注意</b><ul style="margin:6px 0 8px;padding-left:18px">${w.map(x => `<li class="sub" style="color:var(--text)">${x}</li>`).join('')}</ul>
    <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="warnAck"> 内容を確認したうえで進める</label>`;
  $('warnAck').onchange = () => { S.warnAck = $('warnAck').checked; };
}

// ===== ポートフォリオ（左） =====
async function loadPortfolio() {
  if (!S.account) return;
  try {
    const set = new Set([WETH.toLowerCase(), ...store.get('nba.pfTokens.' + CHAIN_KEY, [])]);
    if (S.pool) [S.pool.t0, S.pool.t1].forEach(t => set.add(t.addr.toLowerCase()));
    Object.values(S.positions).forEach(p => [p.t0, p.t1].forEach(t => set.add(t.addr.toLowerCase())));
    store.set('nba.pfTokens.' + CHAIN_KEY, [...set].slice(0, 30));
    const toks = await Promise.all([...set].map(token));
    const [eth, ...bals] = await Promise.all([rpc.getBalance(S.account), ...toks.map(t => new ethers.Contract(t.addr, ERC20_ABI, rpc).balanceOf(S.account))]);
    await ensurePrices([...set]);
    const rows = [{ sym: 'ETH', name: 'Ethereum', addr: 'eth', amt: toNum(eth, 18), p: priceOf(WETH) }]
      .concat(toks.map((t, i) => ({ sym: t.symbol, name: S.tokInfo[t.addr.toLowerCase()]?.name || t.symbol, addr: t.addr, amt: toNum(bals[i], t.decimals), p: priceOf(t) })))
      .filter(r => r.amt > 0);
    rows.forEach(r => r.v = r.p != null ? r.amt * r.p : null);
    rows.sort((a, b) => (b.v ?? -1) - (a.v ?? -1));
    $('pfTotal').textContent = usd(rows.reduce((s, r) => s + (r.v || 0), 0));
    $('pfList').innerHTML = rows.length ? rows.map(r => `<div class="pfRow">${av(r.sym, r.addr)}
      <div class="main"><div>${r.name}</div><div class="sub">${fmt(r.amt)} ${r.sym}</div></div>
      <div class="r">${r.v != null ? usd(r.v) : '<span class="sub">価格不明</span>'}</div></div>`).join('')
      : '<div class="sub">トークンがありません。</div>';
  } catch (e) { $('pfList').innerHTML = `<div class="sub">読み込みエラー：${errMsg(e)}</div>`; }
}

// ===== ペア一覧（中央） =====
const L = { sort: 'vol', page: 0, pools: [], search: null, favs: store.get('nba.favs.' + CHAIN_KEY, DEFAULT_FAVS), busy: false };
function geckoPools(json) {
  return (json.data || []).filter(x => x.relationships?.dex?.data?.id === GECKO_DEX).map(x => {
    const a = x.attributes, m = a.name.match(/([\d.]+)%\s*$/);
    const fee = m ? Number(m[1]) : null, tvl = Number(a.reserve_in_usd) || 0, vol = Number(a.volume_usd?.h24) || 0;
    const id = d => d?.data?.id?.split('_').pop()?.toLowerCase();
    return { addr: a.address.toLowerCase(), name: clean(a.name), fee, tvl, vol, apr: fee && tvl > 0 ? vol * fee / tvl * 365 : 0,
      base: id(x.relationships.base_token), quote: id(x.relationships.quote_token) };
  });
}
const isFav = addr => L.favs.some(f => f.addr === addr.toLowerCase());
function toggleFav(addr, name) {
  addr = addr.toLowerCase();
  L.favs = isFav(addr) ? L.favs.filter(f => f.addr !== addr) : [...L.favs, { addr, name }];
  store.set('nba.favs.' + CHAIN_KEY, L.favs);
  renderPairs(); if (S.pool) $('btnFav').textContent = isFav(S.pool.addr) ? '★' : '☆';
  $('btnFav').classList.toggle('on', !!S.pool && isFav(S.pool.addr));
}
async function loadMorePairs() {
  if (L.busy || L.page >= 10) return;
  L.busy = true; if (!L.search) $('pairMsg').textContent = '読み込み中…';
  try {
    const j = await gecko(`/networks/${CHAIN.gecko}/dexes/${GECKO_DEX}/pools?page=${L.page + 1}&sort=h24_volume_usd_desc&include=base_token,quote_token`);
    L.page++;
    const seen = new Set(L.pools.map(p => p.addr));
    L.pools.push(...geckoPools(j).filter(p => !seen.has(p.addr)));
    if (!L.search) $('pairMsg').textContent = `${L.pools.length}件（取引高の多い順に取得）`;
  } catch (e) { $('pairMsg').textContent = errMsg(e); }
  L.busy = false; renderPairs();
}
async function searchPairs(q) {
  q = q.trim();
  if (!q) { L.search = null; renderPairs(); return; }
  $('pairMsg').textContent = '検索中…';
  try {
    const j = ethers.isAddress(q)
      ? await gecko(`/networks/${CHAIN.gecko}/tokens/${q.toLowerCase()}/pools?page=1&include=base_token,quote_token`)
      : await gecko(`/search/pools?query=${encodeURIComponent(q)}&network=${CHAIN.gecko}&include=base_token,quote_token`);
    if ($('pairQ').value.trim() !== q) return; // 入力が変わっていたら捨てる
    L.search = geckoPools(j);
    $('pairMsg').textContent = `「${q}」の検索結果 ${L.search.length}件`;
  } catch (e) { $('pairMsg').textContent = errMsg(e); }
  renderPairs();
}
function renderPairs() {
  if (L.sort === 'ana') { renderAnalysis(); return; }
  const min = Number($('minTvl').value);
  let list;
  if (L.sort === 'fav') {
    const known = Object.fromEntries([...L.pools, ...(L.search || [])].map(p => [p.addr, p]));
    list = L.favs.map(f => known[f.addr] || { addr: f.addr, name: f.name, tvl: null });
  } else {
    list = (L.search || L.pools).filter(p => p.tvl >= min);
    const key = { vol: 'vol', apr: 'apr', tvl: 'tvl' }[L.sort];
    list = [...list].sort((a, b) => b[key] - a[key]);
  }
  $('btnMore').style.display = (L.sort === 'fav' || L.search) ? 'none' : '';
  if (!list.length) { $('pairList').innerHTML = `<div class="empty">${L.sort === 'fav' ? 'お気に入りはまだありません（☆で追加）' : '該当するペアがありません'}</div>`; return; }
  const sel = S.pool?.addr?.toLowerCase();
  $('pairList').innerHTML = list.map(p => {
    const title = p.name.replace(/\s*[\d.]+%\s*$/, ''), syms = title.split(' / ');
    const feeTxt = (p.name.match(/([\d.]+%)\s*$/) || [])[1] || '';
    const warn = [tokenWarn(p.base, syms[0]), tokenWarn(p.quote, syms[1])].filter(Boolean).join(' ／ ') || (p.tvl != null && p.tvl < LOW_TVL ? '預け入れ総額が小さいプールです' : '');
    return `<div class="pcard ${p.addr === sel ? 'sel' : ''}" data-addr="${p.addr}" data-name="${p.name}">
      <div class="top"><div class="avs">${av(syms[0] || '?', p.base || syms[0])}${av(syms[1] || '?', p.quote || syms[1])}</div>
        <div class="main"><b>${title}</b> ${feeTxt ? `<span class="chip">手数料率 ${feeTxt}</span>` : ''} ${warn ? `<span class="chip off" title="${warn}">⚠ 要確認</span>` : ''}
          <div class="sub" style="margin-top:4px">${p.tvl == null ? 'お気に入り' : `預け入れ総額 ${usd(p.tvl)}・24時間の取引額 ${usd(p.vol)}`}</div></div>
        <button class="star ${isFav(p.addr) ? 'on' : ''}" data-star="1">${isFav(p.addr) ? '★' : '☆'}</button></div>
      ${p.tvl == null ? '' : `<div class="bottom"><span>◆ 年利の目安: <span class="apr">${p.apr ? (p.apr >= 1000 ? Math.round(p.apr).toLocaleString() : p.apr.toFixed(2)) + '%' : '-'}</span></span><span class="sub">${p.addr.slice(0, 8)}…</span></div>`}
    </div>`;
  }).join('');
}

// ===== 分析順（過去30日の値動きから、手数料・インパーマネントロス・作り直しコストを見積もる） =====
// 「差し引き」＝全価格帯に入れた場合の 手数料の年利 − 予想ロス（σ²/8）。
// 「実質利回り」＝レンジ幅を決めたときの レンジ内の時間の割合 ×（レンジ内の手数料 − レンジ内の予想ロス）− 作り直しコスト。
//   レンジ内の手数料：チェーン上の今の有効流動性（pool.liquidity）と比べた自分の取り分で計算（他の人も狭いレンジに集まっている分を反映）。
//   レンジ内の予想ロス：同じ流動性を全価格帯に置いたときの価値÷運用額（集中度）× σ²/8。
//   レンジを外れるまでの平均日数：対数価格がブラウン運動するとして、±b の幅を抜けるまでの期待時間 b²/σ²（1日あたりσ）。
//   作り直し1回のコスト：手持ちの約半分を交換する手数料（プール手数料率×0.5）＋ガス代。
const ANA_KEY = 'nba.ana2.' + CHAIN_KEY, ANA_TTL = 24 * 3600 * 1000, ANA_N = 20, ANA_MIN_TVL = 50000;
const GAS_UNITS_REBUILD = 750000; // 閉じる＋交換＋作成のガスの目安
const GAS_UNITS_MINT = 500000;    // 新規作成のガスの目安（使用許可は別）
const MIN_CAPITAL = 50;           // 運用額の最低（ドル）
const WIDTHS = [0.05, 0.1, 0.2, 0.3, 0.5, 'full'];
const A = { busy: false, data: store.get(ANA_KEY, null), sort: 'lr',
  opt: store.get('nba.anaOpt', { width: 'auto', delay: 0.5, capital: 1000 }) };
A.opt.capital = Math.max(MIN_CAPITAL, Number(A.opt.capital) || 1000);
function normCdf(x) { // 標準正規分布の累積（近似）
  const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}
async function analyzePool(p, gasUsd, go = {}) {
  // 日足は1日保存して、分析し直すときに問い合わせを減らす（空で返ってきたときは保存しない＝次に取り直す）
  const ck = `nba.ohlcv.${CHAIN_KEY}.${p.addr}`, hit = store.get(ck, null);
  let list = hit && hit.list?.length && Date.now() - hit.ts < ANA_TTL ? hit.list : null;
  if (!list) {
    const j = await gecko(`/networks/${CHAIN.gecko}/pools/${p.addr}/ohlcv/day?aggregate=1&limit=31&currency=token`, go);
    list = j?.data?.attributes?.ohlcv_list || [];
    if (list.length) store.set(ck, { ts: Date.now(), list });
  }
  const rows = list.slice(1).reverse(); // 古い順。今日（途中）の分は除く
  const closes = rows.map(r => Number(r[4])).filter(c => c > 0);
  const rets = closes.slice(1).map((c, i) => Math.log(c / closes[i]));
  const n = rets.length;
  if (n < 7) return { addr: p.addr, days: closes.length, short: true };
  const mean = rets.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (n - 1)); // 1日の変動
  const sigmaY = sd * Math.sqrt(365);                                            // 年率の変動
  const vols = rows.map(r => Number(r[5]));
  const vMean = vols.reduce((a, b) => a + b, 0) / vols.length;
  const cv = vMean > 0 ? Math.sqrt(vols.reduce((a, v) => a + (v - vMean) ** 2, 0) / vols.length) / vMean : Infinity; // 取引高のばらつき
  const quoteUsd = S.prices[p.quote];
  const volUsd = quoteUsd != null ? vMean * quoteUsd : NaN; // 30日平均の取引高（ドル）
  const feeApr = p.fee && p.tvl > 0 && isFinite(volUsd) ? volUsd * p.fee / p.tvl * 365 : NaN; // %
  const ilApr = sigmaY ** 2 / 8 * 100;                                                       // %
  const z = sd > 0 ? Math.log(1.2) / (sd * Math.sqrt(7)) : Infinity;
  // チェーン上の今の状態（有効流動性・価格・桁数）
  const [t0a, t1a] = p.base < p.quote ? [p.base, p.quote] : [p.quote, p.base];
  const [t0, t1] = await Promise.all([token(t0a), token(t1a)]);
  const pc = new ethers.Contract(p.addr, POOL_ABI, rpc);
  const [s0, lact] = await retry(() => Promise.all([pc.slot0(), pc.liquidity()]));
  return { addr: p.addr, days: closes.length, sd, sigmaY: sigmaY * 100, cv, feeApr, ilApr, net: feeApr - ilApr, out7: 2 * (1 - normCdf(z)) * 100, volUsd,
    sqrtP: Number(s0.sqrtPriceX96) / 2 ** 96, lact: Number(lact), d0: t0.decimals, d1: t1.decimals, p0: S.prices[t0a], p1: S.prices[t1a], feePct: p.fee, gasUsd };
}
// 価格の幅 [sa, sb]（√価格・生の単位）で預けたときの実質の年利（すべて年率％）
function modelRange(x, sa, sb, delay = A.opt.delay, C = A.opt.capital) {
  const s = x.sqrtP, k0 = 10 ** x.d0, k1 = 10 ** x.d1;
  if (!(s > 0) || !(x.p0 > 0) || !(x.p1 > 0) || !(x.lact >= 0) || !(sb > sa)) return null;
  const usdOf = (a0, a1) => a0 / k0 * x.p0 + a1 / k1 * x.p1;
  const inNow = s > sa && s < sb;
  const v1 = s <= sa ? usdOf((sb - sa) / (sa * sb), 0) : s >= sb ? usdOf(0, sb - sa) : usdOf((sb - s) / (s * sb), s - sa); // 流動性1の価値（ドル）
  const L = C / v1, share = L / (x.lact + L);
  const feeIn = x.volUsd * x.feePct / 100 * share * 365 / C * 100;   // レンジ内にいる間の手数料（年率）
  const conc = usdOf(L / s, L * s) / C;                               // 集中度（同じ流動性を全価格帯に置いた価値÷運用額）
  const ilIn = conc * (x.sd * Math.sqrt(365)) ** 2 / 8 * 100;         // レンジ内にいる間の値動きによる目減り（年率）
  let inPct = 1, rebuilds = 0, days = Infinity;
  if (!inNow) { inPct = 0; days = 0; }
  else if (x.sd > 0) {
    const up = 2 * Math.log(sb / s), down = 2 * Math.log(s / sa);    // 上限・下限までの距離（価格の対数）
    days = up * down / (x.sd ** 2);                                  // 外れるまでの平均日数
    inPct = days / (days + delay); rebuilds = 365 / (days + delay);
  }
  const gasEach = (x.gasUsd || 0) / C * 100;
  const cost = rebuilds * (0.5 * x.feePct + gasEach);                // 作り直しのコスト（交換の手数料＋ガス代）
  return { feeIn, ilIn, inPct, rebuilds, days, cost, gasEach, gasYear: rebuilds * gasEach, inNow, eff: inPct * (feeIn - ilIn) - cost };
}
function yieldModel(x, w, delay, C) {
  const s = x.sqrtP;
  const m = w === 'full' ? modelRange(x, sqrtAt(MIN_TICK), sqrtAt(MAX_TICK), delay, C) : modelRange(x, s * Math.sqrt(1 - w), s * Math.sqrt(1 + w), delay, C);
  return m && { ...m, w };
}
// ローリスクの条件
const LR = { maxSigma: 80, maxCv: 1.0, minTvl: 100000, minIn: 0.95, maxReb: 12 }; // 作り直しは月1回以下
const AUTO_WIDTHS = [0.1, 0.2, 0.3, 0.5, 'full']; // 自動で選ぶ幅（±5%は外れやすいので候補にしない）
const fitsRange = m => m && m.inPct >= LR.minIn && m.rebuilds <= LR.maxReb;
// 幅：自動なら「レンジ内95%以上・作り直し月1回以下」を満たす幅の中で、実質の年利が一番高いもの
function bestModel(x) {
  if (A.opt.width !== 'auto') return yieldModel(x, A.opt.width === 'full' ? 'full' : Number(A.opt.width));
  const ok = AUTO_WIDTHS.map(w => yieldModel(x, w)).filter(fitsRange);
  return ok.length ? ok.reduce((a, b) => (b.eff > a.eff ? b : a)) : yieldModel(x, 'full');
}
const wLabel = w => w === 'full' ? 'フルレンジ' : `±${Math.round(w * 100)}%`;
const stability = cv => cv < 0.6 ? ['高', 'good'] : cv < 1.0 ? ['中', ''] : ['低', 'bad'];
const daysTxt = d => !isFinite(d) ? 'ほぼ外れない' : d >= 60 ? `約${Math.round(d / 30)}か月に1回` : d >= 14 ? `約${Math.round(d / 7)}週間に1回` : `約${d.toFixed(d < 3 ? 1 : 0)}日に1回`;
// ローリスク・ハイリターンの判定と、その理由
function judge(x, m) {
  const r = [], add = (c, t) => r.push({ c, t });
  if (x.sigmaY <= 50) add('ok', `値動きがとても小さい（1年で約${Math.round(x.sigmaY)}%）`);
  else if (x.sigmaY <= LR.maxSigma) add('ok', `値動きが小さめ（1年で約${Math.round(x.sigmaY)}%）`);
  else add('ng', `値動きが大きい（1年で約${Math.round(x.sigmaY)}%）`);
  if (x.cv < 0.6) add('ok', '毎日の取引額が安定している');
  else if (x.cv < LR.maxCv) add('wa', '取引額は日によって多少ばらつく');
  else add('ng', '日によって取引額のばらつきが大きい');
  if (x.tvl >= 1e6) add('ok', `預け入れ総額がとても大きい（${usd(x.tvl)}）`);
  else if (x.tvl >= LR.minTvl) add('ok', `預け入れ総額が大きい（${usd(x.tvl)}）`);
  else add('ng', `預け入れ総額が小さい（${usd(x.tvl)}）`);
  if (fitsRange(m)) add('ok', `${wLabel(m.w)}の幅なら、レンジ内にいる時間は約${Math.round(m.inPct * 100)}%・作り直しは${daysTxt(m.days)}`);
  else add('ng', `${wLabel(m.w)}の幅では、レンジを外れやすい（作り直し${daysTxt(m.days)}）`);
  if (m.eff <= 0) add('ng', '実質の年利がマイナス（手数料より目減りの方が大きい）');
  else if (m.eff < 10) add('wa', '年利は控えめ');
  else if (m.eff >= 50) add('ok', '実質の年利が高い');
  const pass = x.sigmaY <= LR.maxSigma && x.cv < LR.maxCv && x.tvl >= LR.minTvl && fitsRange(m) && m.eff > 0;
  return { pass, reasons: r };
}
async function runAnalysis() {
  if (A.busy) return; A.busy = true;
  try {
    while (L.pools.length < 80 && L.page < 4) await loadMorePairs(); // 候補を増やす
    const min = Math.max(Number($('minTvl').value), ANA_MIN_TVL);
    const ok = L.pools.filter(p => p.tvl >= min && p.fee && p.base && p.quote && !tokenWarn(p.base) && !tokenWarn(p.quote));
    // 候補：年利の目安が高い12件 ＋ 預け入れ総額が大きい12件（大きくて安定したプールも入れる）
    const pick = (k) => [...ok].sort((a, b) => b[k] - a[k]).slice(0, 12);
    const cand = [...new Map([...pick('apr'), ...pick('tvl')].map(p => [p.addr, p])).values()];
    let gasUsd = 0;
    try { const f = await retry(() => rpc.getFeeData()); gasUsd = Number(ethers.formatEther((f.gasPrice ?? 0n) * BigInt(GAS_UNITS_REBUILD))) * (priceOf(WETH) || 0); } catch {}
    const items = [];
    for (const [i, p] of cand.entries()) {
      A.progress = `分析しています… ${i + 1} / ${cand.length}（${p.name}）　残り約${Math.ceil((cand.length - i) * geckoGap / 60000)}分。待っている間も、ほかの画面は使えます。`;
      if ($('anaMsg')) $('anaMsg').textContent = A.progress;
      try { items.push({ ...p, ...(await analyzePool(p, gasUsd)) }); } catch (e) { items.push({ ...p, err: true }); }
    }
    A.data = { ts: Date.now(), min, gasUsd, items };
    store.set(ANA_KEY, A.data);
  } finally { A.busy = false; renderPairs(); }
}
const pct = (x, d = 1) => isFinite(x) ? x.toFixed(d) + '%' : '-';
const sgn = (x, d = 1) => isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(d) + '%' : '-';
function anaCard(p, i, showRank) {
  const title = p.name.replace(/\s*[\d.]+%\s*$/, ''), syms = title.split(' / '), feeTxt = (p.name.match(/([\d.]+%)\s*$/) || [])[1] || '';
  const m = p.m, [stTxt, stCls] = stability(p.cv), sel = S.pool?.addr?.toLowerCase();
  return `<div class="pcard ${p.addr === sel ? 'sel' : ''}" data-addr="${p.addr}" data-name="${p.name}" data-w="${m.w}">
    <div class="top">${showRank ? `<span class="chip ${i < 3 ? 'on' : ''}">${i + 1}位</span>` : ''}<div class="avs">${av(syms[0] || '?', p.base || syms[0])}${av(syms[1] || '?', p.quote || syms[1])}</div>
      <div class="main"><b>${title}</b> ${feeTxt ? `<span class="chip">手数料率 ${feeTxt}</span>` : ''}${p.days < 20 ? ' <span class="chip">データ少なめ</span>' : ''}
        <div class="sub" style="margin-top:4px">預け入れ総額 ${usd(p.tvl)}・30日平均の取引額 ${usd(p.volUsd)}/日</div></div>
      <button class="star ${isFav(p.addr) ? 'on' : ''}" data-star="1">${isFav(p.addr) ? '★' : '☆'}</button></div>
    <div class="effRow"><div><small>実質の年利（幅 ${wLabel(m.w)} で運用した場合）</small><b class="${m.eff >= 0 ? 'good' : 'bad'}">${sgn(m.eff)}</b></div>
      <div class="sub">月あたり 約${sgn(m.eff / 12)}<br>作り直し ${daysTxt(m.days)}</div></div>
    <ul class="reasons">${p.j.reasons.map(r => `<li class="${r.c}">${r.t}</li>`).join('')}</ul>
    <details style="margin-top:8px"><summary class="sub" style="cursor:pointer">くわしい数字</summary>
      <div class="metrics m4">
        <div><small>手数料（レンジ内・年率）</small><b class="good">${pct(m.feeIn)}</b></div>
        <div><small>値動きによる目減り（年率）</small><b class="bad">${pct(m.ilIn)}</b></div>
        <div><small>レンジ内にいる時間</small><b>${pct(m.inPct * 100, 0)}</b></div>
        <div><small>作り直しのコスト（年）</small><b class="bad">${pct(m.cost)}</b><small>うちガス代 ${pct(m.gasYear, m.gasYear < 1 ? 2 : 1)}</small></div>
        <div><small>1年あたりの値動き</small><b>${pct(p.sigmaY, 0)}</b></div>
        <div><small>取引額の安定度</small><b class="${stCls}">${stTxt}</b></div>
        <div><small>作り直し（年）</small><b>${m.rebuilds < 1 ? '1回未満' : Math.round(m.rebuilds) + '回'}</b></div>
        <div><small>ガス代（作り直し1回）</small><b>約$${(p.gasUsd || 0).toFixed(3)}</b><small>運用額の ${pct(m.gasEach, m.gasEach < 0.1 ? 3 : 2)}</small></div>
      </div></details></div>`;
}
function renderAnalysis() {
  $('btnMore').style.display = 'none';
  const head = `<div class="anaHead"><b style="color:var(--text)">おすすめ（分析）の見方</b><br>
    過去30日の値動き・取引額と、今の預け入れ状況から計算します。<b>① リスクが低いペアだけに絞り</b>（値動きが1年で${LR.maxSigma}%以下・取引額が安定・預け入れ総額${usd(LR.minTvl)}以上・その幅でレンジ内にいる時間${LR.minIn * 100}%以上で作り直しは月1回以下）、
    <b>② その中で「実質の年利」が高い順</b>に並べます。実質の年利＝レンジ内にいる時間の割合×（手数料 − 値動きによる目減り）− 作り直しのコスト（すべて年率、月あたりは約12分の1）。
    条件から外れるペアは「ハイリスク（参考）」に分けています。<b>過去のデータからの見積もりで、将来の利益を約束するものではありません。</b></div>`;
  if (A.busy) { $('pairList').innerHTML = head + `<div class="empty" id="anaMsg">${A.progress || '分析しています…'}</div>`; return; }
  const d = A.data;
  if (!d || Date.now() - d.ts > ANA_TTL) {
    $('pairList').innerHTML = head + `<div class="empty">${d ? '前回の分析から1日以上たっています。' : 'まだ分析していません。'}<br><br><button class="primary" id="btnAna">分析する（数分かかります）</button></div>`;
    $('btnAna').onclick = runAnalysis; return;
  }
  const all = d.items.filter(x => !x.err && !x.short && isFinite(x.net)).map(x => { const m = bestModel(x); return m && isFinite(m.eff) ? { ...x, m, j: judge(x, m) } : null; }).filter(Boolean);
  const skipped = d.items.length - all.length;
  $('pairMsg').textContent = `分析日時 ${new Date(d.ts).toLocaleString('ja-JP')}　${all.length}件${skipped ? `（データ不足で除外 ${skipped}件）` : ''}`;
  const o = A.opt, opt = (v, l, cur) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${l}</option>`;
  const controls = `<div class="row" style="margin:10px 0 6px;gap:6px">
      <label class="sub">幅 <select id="anaW">${opt('auto', '条件内で一番良い幅（おすすめ）', o.width)}${[0.05, 0.1, 0.2, 0.3, 0.5].map(w => opt(w, wLabel(w), o.width)).join('')}${opt('full', 'フルレンジ', o.width)}</select></label>
      <label class="sub">外れてから作り直すまで <select id="anaD">${opt(0.1, 'すぐ', o.delay)}${opt(0.5, '半日以内', o.delay)}${opt(1, '1日以内', o.delay)}${opt(2, '2日以内', o.delay)}</select></label>
      <label class="sub">運用額 $<input id="anaC" type="number" min="${MIN_CAPITAL}" step="1" value="${o.capital}" style="width:100px;padding:7px 8px" title="$${MIN_CAPITAL}以上で自由に入力（Enterで計算し直します）"></label></div>`;
  const tabs = `<div class="row between" style="margin:0 0 10px"><div class="tabs" style="margin:0">
      <button data-asort="lr" class="${A.sort === 'lr' ? 'on' : ''}">ローリスク・ハイリターン順</button>
      <button data-asort="eff" class="${A.sort === 'eff' ? 'on' : ''}">実質の年利順（リスク含む）</button>
      <button data-asort="vol" class="${A.sort === 'vol' ? 'on' : ''}">値動きの小さい順</button></div><button id="btnAna">分析し直す</button></div>`;
  let body;
  if (A.sort === 'lr') {
    const good = all.filter(x => x.j.pass).sort((a, b) => b.m.eff - a.m.eff);
    const risky = all.filter(x => !x.j.pass && x.m.eff > 0).sort((a, b) => b.m.eff - a.m.eff).slice(0, 5);
    body = (good.length ? good.map((p, i) => anaCard(p, i, true)).join('') : '<div class="empty">今は条件に合うペアがありません。</div>')
      + (risky.length ? `<div class="sec">ハイリスク（参考）：年利は高いが、リスクの条件を満たさないペア</div>` + risky.map((p, i) => anaCard(p, i, false)).join('') : '');
  } else {
    const list = [...all].sort((a, b) => A.sort === 'vol' ? a.sigmaY - b.sigmaY : b.m.eff - a.m.eff);
    body = list.map((p, i) => anaCard(p, i, true)).join('');
  }
  $('pairList').innerHTML = head + controls + tabs + body;
  $('btnAna').onclick = runAnalysis;
  document.querySelectorAll('[data-asort]').forEach(b => b.onclick = e => { e.stopPropagation(); A.sort = b.dataset.asort; renderAnalysis(); });
  const saveOpt = () => {
    const c = Math.max(MIN_CAPITAL, Math.round(Number($('anaC').value) || 0)); // 運用額は $50 以上
    A.opt = { width: $('anaW').value, delay: Number($('anaD').value), capital: c }; store.set('nba.anaOpt', A.opt); renderAnalysis(); renderRangeYield();
  };
  ['anaW', 'anaD', 'anaC'].forEach(id => { $(id).onchange = saveOpt; $(id).onclick = e => e.stopPropagation(); });
}
// 見込み年利のデータが取れなかったとき（回数制限など）。押すと取り直す
function yieldFail(e) {
  $('rangeYield').innerHTML = `<span class="sub">見込み年利を計算できませんでした（${errMsg(e)}）。</span>
    <button id="btnYieldRetry" style="margin-top:6px">もう一度計算する</button>`;
  $('btnYieldRetry').onclick = () => { $('rangeYield').innerHTML = '<span class="sub">この幅での見込み年利を計算中…（過去30日のデータを取得しています）</span>'; loadPoolDetail(); };
}
// 預ける画面：今の幅での見込み年利と、幅ごとの比較（Smart Vault の「全てのレンジを見る」にあたる）
function renderRangeYield() {
  const P = S.pool, el = $('rangeYield'); if (!P || !el) return;
  const x = P.stats;
  if (!x) { el.innerHTML = '<span class="sub">この幅での見込み年利を計算中…（過去30日のデータを取得しています）</span>'; return; }
  if (x.short) { el.innerHTML = '<span class="sub">過去のデータが足りないため、見込み年利を出せません。</span>'; return; }
  const T = getTicks(); if (!T) { el.innerHTML = '<span class="sub">価格の幅（上限・下限）を入れると、見込み年利が出ます。</span>'; return; }
  const g = gasUsdOf(GAS_UNITS_REBUILD); if (g != null) x.gasUsd = g;
  const C = Math.max(MIN_CAPITAL, Number($('totalUsd').value) || A.opt.capital);
  const cur = modelRange(x, sqrtAt(T[0]), sqrtAt(T[1]), A.opt.delay, C);
  if (!cur) { el.innerHTML = '<span class="sub">トークンのドル価格が分からないため、見込み年利を出せません。</span>'; return; }
  const rows = WIDTHS.map(w => yieldModel(x, w, A.opt.delay, C)).filter(Boolean);
  const mr = Number($('maxR').value), nr = Number($('minR').value);
  const curW = S.full ? 'full' : (mr > 0 && Math.abs(mr - nr) < 0.01 ? String(mr / 100) : null);
  el.innerHTML = (cur.inNow ? `<div class="row between" style="margin:0"><b>この幅での見込み年利</b><b class="${cur.eff >= 0 ? 'good' : 'bad'}" style="font-size:20px">${sgn(cur.eff)}</b></div>
      <div class="sub">月あたり 約${sgn(cur.eff / 12)}・レンジ内にいる時間 約${Math.round(cur.inPct * 100)}%・作り直し ${daysTxt(cur.days)}<br>
      内訳：手数料 +${pct(cur.feeIn * cur.inPct)}／値動きによる目減り −${pct(cur.ilIn * cur.inPct)}／作り直しのコスト −${pct(cur.cost)}（運用額 $${Math.round(C).toLocaleString()} で計算）</div>`
      : '<b class="warn">今の価格がこの幅の外です（このままでは手数料が入りません）</b>')
    + `<table class="wtbl"><tr><th>幅</th><th>見込み年利</th><th>レンジ内</th><th>作り直し</th><th></th></tr>
      ${rows.map(m => `<tr data-w="${m.w}" class="${curW === String(m.w) ? 'cur' : ''}"><td>${wLabel(m.w)}</td><td class="${m.eff >= 0 ? 'good' : 'bad'}">${sgn(m.eff)}</td>
        <td>${Math.round(m.inPct * 100)}%</td><td>${m.rebuilds < 1 ? '年1回未満' : '年' + Math.round(m.rebuilds) + '回'}</td><td>${fitsRange(m) ? '<span class="good">✓ 外れにくい</span>' : ''}</td></tr>`).join('')}</table>
      <div class="sub" style="margin-top:4px">行を押すとその幅にします。過去30日の値動き・取引額からの見積もりで、将来を約束するものではありません。</div>`;
  el.querySelectorAll('tr[data-w]').forEach(tr => tr.onclick = () => { const w = tr.dataset.w; $('pctIn').value = ''; setRangePct(w === 'full' ? 'full' : Math.round(Number(w) * 100)); });
}

// ===== 手数料レベル（カード） =====
// avail: { fee: { addr, tvl } | null }。null＝プールなし、undefined＝未確認
function feeCards(selFee, avail) {
  return FEE_LEVELS.map(f => {
    const a = avail ? avail[f.fee] : undefined;
    const info = a === undefined ? '' : a === null ? '<em class="sub">プールなし</em>'
      : `<em class="good">${a.tvl != null ? '預け入れ ' + usd(a.tvl) : 'プールあり'}${a.apr ? `<br>年利の目安 ${a.apr >= 1000 ? Math.round(a.apr).toLocaleString() : a.apr.toFixed(1)}%` : ''}</em>`;
    return `<button class="fee ${f.fee === selFee ? 'on' : ''} ${a === null ? 'none' : ''}" data-fee="${f.fee}" title="${f.ex}">
      <b>${f.label}</b><span>${f.desc}</span>${info}</button>`;
  }).join('');
}
async function feeAvail(a, b) {
  const [t0, t1] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
  const out = {};
  await Promise.all(FEE_LEVELS.map(async f => {
    const p = (await factoryR.getPool(t0, t1, f.fee)).toLowerCase();
    if (p === ethers.ZeroAddress) { out[f.fee] = null; return; }
    const known = [...L.pools, ...(L.search || [])].find(x => x.addr === p);
    out[f.fee] = { addr: p, tvl: known ? known.tvl : null, apr: known ? known.apr : null };
  }));
  return out;
}

// ===== ペアを作成（中央） =====
const C = { a: null, b: null, fee: 3000, target: 'a', avail: null };
function openCreate() {
  $('pickBox').style.display = 'none'; $('createBox').style.display = '';
  if (!C.a && S.pool) { C.a = S.pool.t0; C.b = S.pool.t1; C.fee = S.pool.fee; }
  renderCreate();
}
function closeCreate() { $('createBox').style.display = 'none'; $('pickBox').style.display = ''; }
async function renderCreate() {
  const lab = t => t ? `<span style="display:flex;align-items:center;gap:8px">${av(showSym(t), t.addr)}<b>${showSym(t)}</b><span class="sub mono">${t.addr.slice(0, 8)}…</span></span>` : '<span>トークンを選択</span>';
  $('cTokA').innerHTML = lab(C.a) + '<span>⌄</span>';
  $('cTokB').innerHTML = lab(C.b) + '<span>⌄</span>';
  $('cFees').innerHTML = feeCards(C.fee, C.avail);
  const tw = [C.a, C.b].filter(Boolean).map(t => tokenWarn(t.addr, t.symbol) && `⚠ ${t.symbol}：${tokenWarn(t.addr, t.symbol)}`).filter(Boolean);
  $('cMsg').innerHTML = tw.map(x => `<div class="bad">${x}</div>`).join('');
  if (C.a && C.b) {
    if (C.a.addr === C.b.addr) { $('cMsg').innerHTML = '<span class="bad">同じトークンは選べません</span>'; return; }
    $('cMsg').textContent = 'プールを確認中…';
    C.avail = await feeAvail(C.a.addr, C.b.addr);
    $('cFees').innerHTML = feeCards(C.fee, C.avail);
    const a = C.avail[C.fee];
    $('cMsg').innerHTML = tw.map(x => `<div class="bad">${x}</div>`).join('') + (a ? `<span class="good">このペア・手数料 ${C.fee / 10000}% のプールがあります。</span>`
      : '<span class="warn">この手数料レベルのプールはまだありません。「プールあり」のカードを選んでください。</span>');
  }
}
async function createGo() {
  if (!C.a || !C.b) { $('cMsg').innerHTML = '<span class="bad">トークンAとトークンBを選んでください</span>'; return; }
  if (!C.avail?.[C.fee]) { $('cMsg').innerHTML = '<span class="bad">この手数料レベルのプールがありません</span>'; return; }
  await loadPool(C.a.addr, C.b.addr, C.fee);
  if (!S.pool) return;
  $('memo').value = $('cMemo').value;
  closeCreate();
  $('provide').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
// トークン選択の窓
function openTokModal(target) {
  C.target = target; $('tokQ').value = ''; $('tokModal').classList.add('open'); renderTokList(''); $('tokQ').focus();
}
function knownTokens() {
  const count = {};
  L.pools.forEach(p => [p.base, p.quote].forEach(a => { if (a) count[a] = (count[a] || 0) + 1; }));
  return Object.entries(S.tokInfo).map(([addr, t]) => ({ addr, ...t, n: count[addr] || 0 })).sort((a, b) => b.n - a.n);
}
async function renderTokList(q) {
  q = q.trim();
  const all = knownTokens();
  const top = all.slice(0, 5);
  $('tokChips').innerHTML = top.map(t => `<button data-addr="${t.addr}">${av(t.symbol, t.addr)}${t.addr === WETH.toLowerCase() ? 'WETH（ETH）' : t.symbol}</button>`).join('');
  if (ethers.isAddress(q)) {
    $('tokList').innerHTML = '<div class="sub" style="padding:10px">読み込み中…</div>';
    try {
      const t = await token(q);
      $('tokList').innerHTML = `<div class="trow" data-addr="${t.addr}">${av(t.symbol, t.addr)}<div><div>${t.symbol}</div><div class="sub mono">${t.addr}</div></div></div>`;
    } catch { $('tokList').innerHTML = '<div class="sub" style="padding:10px">このアドレスのトークンが見つかりません</div>'; }
    return;
  }
  const ql = q.toLowerCase();
  const list = all.filter(t => !q || t.symbol.toLowerCase().includes(ql) || t.name.toLowerCase().includes(ql)).slice(0, 80);
  $('tokList').innerHTML = list.length ? list.map(t => { const w = tokenWarn(t.addr, t.symbol); return `<div class="trow" data-addr="${t.addr}">${av(t.symbol, t.addr)}
    <div><div>${t.name}</div><div class="sub">${t.symbol}　<span class="mono">${t.addr.slice(0, 8)}…</span>${t.addr === WETH.toLowerCase() ? '（ETHで払うときもこれ）' : ''}</div>${w ? `<div class="sub bad">⚠ ${w}</div>` : ''}</div></div>`; }).join('')
    : '<div class="sub" style="padding:10px">見つかりません。トークンのアドレスを貼り付けてください。</div>';
}
async function pickToken(addr) {
  try {
    const t = await token(addr);
    C[C.target] = t; C.avail = null;
    $('tokModal').classList.remove('open');
    renderCreate();
  } catch (e) { log('トークンを読めません: ' + errMsg(e)); }
}

// ===== プール（右） =====
// 一覧から選んだプール：中身はチェーンから読み、Uniswap v3 公式のプールか確かめる
async function selectPoolAddr(addr) {
  $('poolMsg').textContent = '読み込み中…';
  try {
    const c = new ethers.Contract(addr, POOL_ABI, rpc);
    const [a, b, fee] = await Promise.all([c.token0(), c.token1(), c.fee()]);
    await loadPool(a, b, Number(fee), addr);
  } catch (e) { $('poolMsg').textContent = 'このプールは使えません（Uniswap v3 ではない可能性）'; }
}
async function loadPool(a, b, fee, expectAddr) {
  $('poolMsg').textContent = '読み込み中…';
  try {
    if (!ethers.isAddress(a) || !ethers.isAddress(b)) throw new Error('トークンのアドレスが正しくありません');
    const [t0a, t1a] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
    const addr = await factoryR.getPool(t0a, t1a, fee);
    if (addr === ethers.ZeroAddress) throw new Error('このペア・手数料のプールはまだありません');
    if (expectAddr && addr.toLowerCase() !== expectAddr.toLowerCase()) throw new Error('Uniswap v3 公式のプールではありません');
    const [t0, t1] = await Promise.all([token(t0a), token(t1a)]);
    const pool = new ethers.Contract(addr, POOL_ABI, rpc);
    const [s0, spacing] = await Promise.all([pool.slot0(), pool.tickSpacing()]);
    S.pool = { addr, fee, t0, t1, spacing: Number(spacing), sqrtP: Number(s0.sqrtPriceX96) / 2 ** 96, tick: Number(s0.tick) };
    const stable = t => /^(USDG|USDC|USDT|DAI|USDe|PYUSD)$/i.test(t.symbol);
    S.invert = stable(t0) && !stable(t1); // ドル建てが単位側に来るように
    S.lastEdited = 0; $('amt0').value = ''; $('amt1').value = '';
    $('poolMsg').textContent = '';
    $('pairName').textContent = `${t0.symbol} と ${t1.symbol} を預ける`;
    S.pool.stats = null; $('totalUsd').value = '';
    $('btnFav').textContent = isFav(addr) ? '★' : '☆'; $('btnFav').classList.toggle('on', isFav(addr));
    renderPairs();
    $('poolInfo').style.display = '';
    $('lab0').innerHTML = av(t0.symbol, t0.addr) + t0.symbol; $('lab1').innerHTML = av(t1.symbol, t1.addr) + t1.symbol;
    $('slab0').textContent = t0.symbol; $('slab1').textContent = t1.symbol;
    $('use0').value = $('use1').value = ''; $('swapInfo').textContent = ''; $('swapGoRow').style.display = 'none'; S.swapPlan = null;
    $('ethPayRow').style.display = (t0.isWeth || t1.isWeth) ? '' : 'none';
    $('pctIn').value = '';
    renderPrice();
    setRangePct(20);
    $('pFees').innerHTML = feeCards(fee, undefined);
    feeAvail(t0.addr, t1.addr).then(avl => { if (S.pool?.addr === addr) { S.pool.avail = avl; $('pFees').innerHTML = feeCards(fee, avl); } });
    S.pool.tvl = undefined; renderPoolWarn();
    loadPoolDetail();
    await refreshBalances();
    if (S.account) loadPortfolio();
  } catch (e) { $('poolMsg').textContent = errMsg(e); }
}
async function loadPoolDetail() {
  const P = S.pool; if (!P) return;
  $('detailCard').style.display = '';
  $('detailTitle').textContent = `${P.t0.symbol}/${P.t1.symbol} プールの詳細`;
  $('poolSub').innerHTML = `プール <a href="${CHAIN.explorer}/address/${P.addr}" target="_blank" class="mono">${P.addr.slice(0, 10)}…</a>　手数料 ${P.fee / 10000}%　ティック間隔 ${P.spacing}`;
  try {
    const [r0, r1] = await Promise.all([P.t0, P.t1].map(t => new ethers.Contract(t.addr, ERC20_ABI, rpc).balanceOf(P.addr)));
    let g = null, gj = null, gerr = null;
    const go = { urgent: true, skip: () => S.pool !== P };
    // 一覧に載っているプールは一覧の値を使い、問い合わせを省く（回数制限に当たりにくくする）。一覧にないものは10分覚えておく
    // 見込み年利に要るのは「どちらが基準のトークンか」だけ。一覧に載っていれば一覧の値、一度わかったプールはブラウザに覚えておき、問い合わせを省く（回数制限に当たりにくくする）
    const key = P.addr.toLowerCase(), known = [...L.pools, ...(L.search || [])].find(x => x.addr === key);
    const bq = store.get('nba.bq.' + CHAIN_KEY, {}), saved = bq[key];
    const fake = (b, q, tvl, vol) => ({ attributes: tvl != null ? { reserve_in_usd: tvl, volume_usd: { h24: vol } } : null,
      relationships: { base_token: { data: { id: '_' + b } }, quote_token: { data: { id: '_' + q } } } });
    const memo = (S.gjCache = S.gjCache || {})[key], fresh = memo && Date.now() - memo.ts < 600000;
    const fetchGj = async () => {
      const j = (await gecko(`/networks/${CHAIN.gecko}/pools/${key}?include=base_token,quote_token`, go)).data;
      const id = r => j?.relationships?.[r]?.data?.id?.split('_').pop()?.toLowerCase();
      if (id('base_token') && id('quote_token')) { bq[key] = [id('base_token'), id('quote_token')]; store.set('nba.bq.' + CHAIN_KEY, bq); }
      S.gjCache[key] = { ts: Date.now(), gj: j }; return j;
    };
    let later = false; // 覚えていた向きで先に年利を出し、取引額などはあとから取り直す
    if (known?.base && known?.quote) gj = fake(known.base, known.quote, known.tvl, known.vol);
    else if (fresh) gj = memo.gj;
    else if (saved && priceOf(P.t0) != null && priceOf(P.t1) != null) { gj = fake(saved[0], saved[1]); later = true; } // ドル価格が未取得なら問い合わせ（価格も一緒に取れる）
    else try { gj = await fetchGj(); } catch (e) { gerr = e; }
    g = gj?.attributes || null;
    if (S.pool !== P) return;
    const a0 = toNum(r0, P.t0.decimals), a1 = toNum(r1, P.t1.decimals);
    const p0 = priceOf(P.t0), p1 = priceOf(P.t1);
    const tvl = g ? Number(g.reserve_in_usd) : (p0 != null && p1 != null ? a0 * p0 + a1 * p1 : NaN);
    const vol = g ? Number(g.volume_usd?.h24) : NaN;
    const apr = tvl > 0 && isFinite(vol) ? vol * (P.fee / 10000) / tvl * 365 : NaN;
    P.tvl = isFinite(tvl) ? tvl : null; renderPoolWarn(P.tvl);
    $('poolDetail').innerHTML = `
      <div>預け入れ総額</div><div>${usd(tvl)}</div>
      <div>24時間の取引額</div><div>${usd(vol)}</div>
      <div>年利の目安（全体平均）</div><div class="apr">${isFinite(apr) ? apr.toFixed(2) + '%' : '-'}</div>
      <div>${P.t0.symbol}</div><div>${fmt(a0)}　<span class="sub">${p0 != null ? usd(a0 * p0) : ''}</span></div>
      <div>${P.t1.symbol}</div><div>${fmt(a1)}　<span class="sub">${p1 != null ? usd(a1 * p1) : ''}</span></div>`
      + (() => { const x = A.data?.items?.find(i => i.addr === P.addr.toLowerCase() && isFinite(i.net)); return x ? `
      <div>1年あたりの値動き（30日から）</div><div>${pct(x.sigmaY, 0)}</div>`
      + (() => { const m = bestModel(x); return m ? `<div>おすすめ分析の実質の年利</div><div class="${m.eff >= 0 ? 'good' : 'bad'}">${sgn(m.eff)}（幅 ${wLabel(m.w)}）</div>` : ''; })() : ''; })();
    renderUsd();
    // 幅ごとの見込み年利のための統計（30日の値動き・取引額・今の流動性）
    const rel = id => gj?.relationships?.[id]?.data?.id?.split('_').pop()?.toLowerCase();
    if (gj && rel('base_token') && rel('quote_token')) {
      try {
        const st = await analyzePool({ addr: P.addr.toLowerCase(), base: rel('base_token'), quote: rel('quote_token'), fee: P.fee / 10000, tvl }, gasUsdOf(GAS_UNITS_REBUILD) || 0, go);
        if (S.pool === P) { P.stats = st; renderRangeYield(); }
        if (later) fetchGj().then(() => { if (S.pool === P) loadPoolDetail(); }).catch(() => {});
      } catch (e) { if (S.pool === P) yieldFail(e); }
    } else if (gerr) yieldFail(gerr);
    else $('rangeYield').innerHTML = '<span class="sub">このプールは値動きのデータがないため、見込み年利を出せません。</span>';
  } catch (e) { $('poolDetail').innerHTML = `<div>読み込みエラー</div><div>${errMsg(e)}</div>`; }
}
// 人が見る価格（1 t0 = ? t1）
function humanPrice(rawP, pool = S.pool) { return rawP * Math.pow(10, pool.t0.decimals - pool.t1.decimals); }
function rawFromHuman(h, pool = S.pool) { return h / Math.pow(10, pool.t0.decimals - pool.t1.decimals); }
const disp = h => S.invert ? 1 / h : h;
const curDisp = () => disp(humanPrice(S.pool.sqrtP ** 2));
function renderPrice() {
  const P = S.pool;
  const [base, quote] = S.invert ? [P.t1, P.t0] : [P.t0, P.t1];
  $('priceTxt').textContent = `今の価格：1 ${base.symbol} = ${fmt(curDisp())} ${quote.symbol}`;
  $('unitTxt').textContent = `価格の単位：${quote.symbol} / ${base.symbol}（1 ${base.symbol} あたり）`;
}
// ===== レンジ幅（最大・最小：価格⇔レート%） =====
const rnd = x => Number(x.toPrecision(6));
function setRates(up, down) {
  S.full = false;
  const c = curDisp();
  $('maxP').value = rnd(c * (1 + up / 100)); $('maxR').value = rnd(up);
  $('minP').value = rnd(c * (1 - down / 100)); $('minR').value = rnd(down);
  updateRange();
}
function setRangePct(pct) {
  if (pct === 'full') {
    S.full = true; ['maxP', 'maxR', 'minP', 'minR'].forEach(id => $(id).value = ''); updateRange(); return;
  }
  setRates(pct, pct);
}
function onMaxR() { const v = Number($('maxR').value); if ($('maxR').value !== '' && v > -100) { S.full = false; $('maxP').value = rnd(curDisp() * (1 + v / 100)); updateRange(); } }
function onMinR() { const v = Number($('minR').value); if ($('minR').value !== '' && v < 100) { S.full = false; $('minP').value = rnd(curDisp() * (1 - v / 100)); updateRange(); } }
function onMaxP() { const p = Number($('maxP').value); S.full = false; if (p > 0) $('maxR').value = Number(((p / curDisp() - 1) * 100).toFixed(2)); updateRange(); }
function onMinP() { const p = Number($('minP').value); S.full = false; if (p > 0) $('minR').value = Number(((1 - p / curDisp()) * 100).toFixed(2)); updateRange(); }
function getTicks() {
  const P = S.pool, sp = P.spacing;
  const lo = Math.ceil(MIN_TICK / sp) * sp, hi = Math.floor(MAX_TICK / sp) * sp;
  if (S.full) return [lo, hi];
  let a = Number($('minP').value), b = Number($('maxP').value);
  if (!(a > 0) || !(b > 0) || a >= b) return null;
  if (S.invert) [a, b] = [1 / b, 1 / a];
  const tick = h => Math.log(rawFromHuman(h)) / Math.log(1.0001);
  let tl = Math.floor(tick(a) / sp) * sp, tu = Math.ceil(tick(b) / sp) * sp;
  tl = Math.max(tl, lo); tu = Math.min(tu, hi);
  if (tu <= tl) tu = tl + sp;
  return [tl, tu];
}
function updateRange() {
  const T = getTicks();
  if (!T) { $('rangeInfo').innerHTML = '<span class="bad">最小 &lt; 最大 になるように入れてください</span>'; $('ratioTxt').textContent = ''; return; }
  const P = S.pool, [tl, tu] = T;
  const pl = disp(humanPrice(tickToRaw(tl))), pu = disp(humanPrice(tickToRaw(tu)));
  const [mn, mx] = pl < pu ? [pl, pu] : [pu, pl];
  let st = '';
  if (P.tick < tl || P.tick >= tu) st = '<br><span class="warn">今の価格はレンジ外です（片方のトークンだけ入ります・手数料は入りません）</span>';
  $('rangeInfo').innerHTML = S.full ? 'フルレンジ（全価格帯）' : `実際に使われるレンジ：${fmt(mn)} 〜 ${fmt(mx)}${st}`;
  const sqrtP = P.sqrtP;
  $('amt0').disabled = sqrtP >= sqrtAt(tu);
  $('amt1').disabled = sqrtP <= sqrtAt(tl);
  if ($('amt0').disabled) $('amt0').value = '';
  if ($('amt1').disabled) $('amt1').value = '';
  renderRatio(T);
  renderRangeYield();
  syncAmounts(S.lastEdited ?? 0);
}
// このレンジで入れるときの、トークンの割合（価値ベース）
function renderRatio(T) {
  const P = S.pool, [tl, tu] = T, sp = P.sqrtP, sa = sqrtAt(tl), sb = sqrtAt(tu), price = sp * sp;
  let s0;
  if (sp <= sa) s0 = 1; else if (sp >= sb) s0 = 0;
  else { const R = (sp - sa) * sp * sb / (sb - sp); s0 = 1 / (1 + R / price); }
  $('ratioTxt').innerHTML = `${P.t0.symbol}: <span class="good">${(s0 * 100).toFixed(2)}%</span> / ${P.t1.symbol}: <span class="good">${((1 - s0) * 100).toFixed(2)}%</span>`;
}
// 片方を入れたらもう片方を計算
function syncAmounts(i) {
  const T = getTicks(); if (!T) return;
  const P = S.pool, [tl, tu] = T, sqrtP = P.sqrtP, sa = sqrtAt(tl), sb = sqrtAt(tu);
  if (sqrtP > sa && sqrtP < sb) {
    const k = 10 ** (P.t0.decimals - P.t1.decimals); // 生 → 人の単位の換算
    const ratio = (sqrtP - sa) * sqrtP * sb / (sb - sqrtP); // amount1raw / amount0raw
    if (i === 0) { const v = Number($('amt0').value); $('amt1').value = v > 0 ? Number((v * ratio * k).toPrecision(10)) : ''; }
    else { const v = Number($('amt1').value); $('amt0').value = v > 0 ? Number((v / ratio / k).toPrecision(10)) : ''; }
  }
  renderUsd();
}
// 合計額（ドル）→ 今の幅の割合で2つのトークンに分ける
function splitTotal() {
  const P = S.pool, T = getTicks(), total = Number($('totalUsd').value);
  if (!P || !T || !(total > 0)) return;
  const p0 = priceOf(P.t0), p1 = priceOf(P.t1);
  if (p0 == null || p1 == null) { $('needBox').innerHTML = '<span class="warn">トークンのドル価格がまだ分からないため、分けられません。少し待ってからもう一度。</span>'; return; }
  const s0 = shareOf0(T);
  if (!$('amt0').disabled && s0 > 0) { $('amt0').value = Number((total * s0 / p0).toPrecision(8)); S.lastEdited = 0; syncAmounts(0); }
  else { $('amt1').value = Number((total * (1 - s0) / p1).toPrecision(8)); S.lastEdited = 1; syncAmounts(1); }
}
// このレンジで預けるときの token0 の価値の割合
function shareOf0(T) {
  const P = S.pool, [tl, tu] = T, sp = P.sqrtP, sa = sqrtAt(tl), sb = sqrtAt(tu), price = sp * sp;
  if (sp <= sa) return 1; if (sp >= sb) return 0;
  const R = (sp - sa) * sp * sb / (sb - sp); return 1 / (1 + R / price);
}
// 必要なもの（どのチェーンの、どのトークンを、いくつ）と、足りているか
function renderNeed() {
  const P = S.pool; if (!P) return;
  const [a0, a1] = desiredAmounts(P, $('amt0').value, $('amt1').value);
  if (a0 === 0n && a1 === 0n) { $('needBox').innerHTML = `<span class="sub">必要なもの：<b>${CHAIN.name}</b> の ${showName(P.t0)} と ${showName(P.t1)}、ガス代用のETHを少し</span>`; return; }
  const row = (i, a) => {
    const t = i ? P.t1 : P.t0, nm = showName(t);
    if (a === 0n) return '';
    const have = S.bal ? spendable(i) : null;
    const st = have == null ? '<span class="sub">（つなぐと確認できます）</span>'
      : have >= a ? '<span class="good">✓ 足りています</span>'
      : `<span class="bad">あと ${fmt(toNum(a - have, t.decimals))} 足りません</span>`;
    return `<span>${nm}</span><b>${fmt(toNum(a, t.decimals))}</b>${st}`;
  };
  const gas = gasUsdOf(GAS_UNITS_MINT);
  let html = `<div class="sub" style="margin-bottom:6px">必要なもの（<b>${CHAIN.name}</b> のウォレットに）</div><div class="need">${row(0, a0)}${row(1, a1)}
    <span>ガス代用のETH</span><b>少し</b><span class="sub">${gas != null ? `1回 約$${gas.toFixed(3)}` : ''}</span></div>`;
  // 片方が足りないが、もう片方が多ければ「自動で交換して預ける」
  if (S.bal) {
    const h0 = spendable(0), h1 = spendable(1), price = P.sqrtP ** 2;
    const short = h0 < a0 || h1 < a1;
    const enough = Number(h0) + Number(h1) / price >= (Number(a0) + Number(a1) / price) * 1.02; // 交換の目減り分の余裕
    if (short && enough) html += `<button class="primary" id="btnAuto" style="width:100%;margin-top:10px">足りない分を自動で交換して預ける</button>
      <div class="sub" style="margin-top:4px">持っているもう片方のトークンを、一番得なプールで必要な分だけ交換してから預けます（メタマスクの承認が2〜4回出ます）。</div>`;
    else if (short) html += '<div class="bad" style="margin-top:8px">2つのトークンを合わせても足りません。額を減らすか、トークンを用意してください。</div>';
  }
  $('needBox').innerHTML = html;
  if ($('btnAuto')) { $('btnAuto').onclick = () => provideOnce(autoProvide); $('btnAuto').disabled = !!S.providing; }
}
// 「預ける」「自動で交換して預ける」は、どちらか1つが終わるまでもう押せない。終わったらその場で知らせ、入れた額を空にする（続けて押して2つ作らないように）
async function provideOnce(fn) {
  if (S.providing) return;
  S.providing = true; S.lastMinted = null;
  const btns = () => [$('btnMint'), $('btnAuto')].filter(Boolean);
  btns().forEach(b => b.disabled = true);
  try {
    if (await fn()) {
      ['totalUsd', 'amt0', 'amt1'].forEach(id => { if ($(id)) $(id).value = ''; });
      renderUsd();
      alert(`ポジション${S.lastMinted ? ' #' + S.lastMinted : ''} を作りました。\n「運用中のペア」で確認できます。\n（同じものをもう1つ作るときだけ、もう一度額を入れて押してください）`);
    }
  } finally { S.providing = false; btns().forEach(b => b.disabled = false); }
}
const showName = t => t.isWeth && $('payEth').checked ? 'ETH（WETHとして預けます）' : t.symbol;
async function autoProvide() {
  try {
    await signerReady(); await refreshBalances();
    const P = S.pool, [a0, a1] = desiredAmounts(P, $('amt0').value, $('amt1').value);
    const h0 = spendable(0), h1 = spendable(1), price = P.sqrtP ** 2;
    // 足りない側の量を、多い側から交換して作る（目減り分 3% 上乗せ）
    let from, amountIn;
    if (h1 < a1) { from = 0; amountIn = floorBig(Number(a1 - h1) / price * 1.03); if (h0 - amountIn < a0 * 97n / 100n) throw new Error('交換すると、もう片方が足りなくなります'); }
    else if (h0 < a0) { from = 1; amountIn = floorBig(Number(a0 - h0) * price * 1.03); if (h1 - amountIn < a1 * 97n / 100n) throw new Error('交換すると、もう片方が足りなくなります'); }
    else return await mint();
    const inTok = from === 0 ? P.t0 : P.t1, outTok = from === 0 ? P.t1 : P.t0;
    log(`自動で交換：${fmt(toNum(amountIn, inTok.decimals))} ${inTok.symbol} → ${outTok.symbol}`);
    const q = await bestQuote(inTok, outTok, amountIn);
    S.swapPlan = { inTok, outTok, amountIn, out: q.out, from, u0: h0, u1: h1, fee: q.fee };
    if (!(await doSwap())) throw new Error('交換で止まりました');
    await refreshBalances();
    const n0 = spendable(0), n1 = spendable(1);
    fillAfterSwap(n0 < a0 ? n0 : a0, n1 < a1 ? n1 : a1); // 目標額の範囲で、比率どおりに入れ直す
    return await mint();
  } catch (e) { log('自動で預ける：' + errMsg(e)); alert('自動で預ける：' + errMsg(e)); return false; }
}
function renderUsd() {
  if (!S.pool) return;
  const v = i => { const t = i ? S.pool.t1 : S.pool.t0, p = priceOf(t), a = Number($('amt' + i).value) || 0; return p != null ? a * p : null; };
  const u0 = v(0), u1 = v(1);
  $('usd0').textContent = u0 != null ? usd(u0) : '$-'; $('usd1').textContent = u1 != null ? usd(u1) : '$-';
  const total = u0 != null && u1 != null ? u0 + u1 : null;
  $('usdTotal').textContent = total != null ? usd(total) : '-';
  if (document.activeElement !== $('totalUsd')) $('totalUsd').value = total > 0 ? Number(total.toFixed(2)) : '';
  renderNeed();
  // ガス代の目安（入れる額に対する割合）
  const gm = gasUsdOf(GAS_UNITS_MINT), gr = gasUsdOf(GAS_UNITS_REBUILD);
  const share = g => total > 0 && g != null ? `（${(g / total * 100).toFixed(g / total * 100 < 0.1 ? 3 : 2)}%）` : '';
  $('gasInfo').innerHTML = gm == null ? '' : `ガス代の目安：作成 約$${gm.toFixed(3)}${share(gm)}・作り直し1回 約$${gr.toFixed(3)}${share(gr)}`
    + (total > 0 && total < MIN_CAPITAL ? `<br><span class="warn">入れる額が$${MIN_CAPITAL}未満です。ガス代の割合が大きくなるので、$${MIN_CAPITAL}以上がおすすめです。</span>` : '');
}
async function refreshBalances() {
  if (!S.account || !S.pool) return;
  const P = S.pool;
  const bal = async t => {
    const c = new ethers.Contract(t.addr, ERC20_ABI, rpc);
    const b = await c.balanceOf(S.account);
    const eth = t.isWeth ? await rpc.getBalance(S.account) : 0n;
    return { erc: b, eth };
  };
  const [b0, b1] = await Promise.all([bal(P.t0), bal(P.t1)]);
  S.bal = [b0, b1];
  const show = i => { const t = i ? P.t1 : P.t0; return `使用可能: ${fmt(toNum(spendable(i), t.decimals))} ${usesEth(t) ? 'ETH' : t.symbol}`; };
  $('bal0').textContent = show(0); $('bal1').textContent = show(1);
}
// ===== 比率をそろえる（スワップ） =====
const GAS_RESERVE = 10n ** 15n; // ガス代として 0.001 ETH 残す
const usesEth = t => t.isWeth && $('payEth').checked;
function spendable(i) {
  const t = i === 0 ? S.pool.t0 : S.pool.t1, b = S.bal[i];
  if (usesEth(t)) return b.eth > GAS_RESERVE ? b.eth - GAS_RESERVE : 0n;
  return b.erc;
}
function useBalances() {
  if (!S.bal) { log('先にメタマスクに接続してください'); return; }
  $('use0').value = ethers.formatUnits(spendable(0), S.pool.t0.decimals);
  $('use1').value = ethers.formatUnits(spendable(1), S.pool.t1.decimals);
}
// 手持ち h0,h1 から、レンジの比率にするには何をいくら交換するか（価格は今の値で概算）
function planSwap(h0, h1) {
  const P = S.pool, T = getTicks(); if (!T) throw new Error('レンジを正しく入力してください');
  const [tl, tu] = T, sp = P.sqrtP, sa = sqrtAt(tl), sb = sqrtAt(tu), price = sp * sp; // 生の単位：token1 / token0
  let a0; // 交換後に持っていたい token0（生）
  if (sp <= sa) a0 = h0 + h1 / price;           // レンジが今より上：token0 だけ必要
  else if (sp >= sb) a0 = 0;                    // レンジが今より下：token1 だけ必要
  else { const R = (sp - sa) * sp * sb / (sb - sp); a0 = (h0 + h1 / price) / (1 + R / price); }
  if (h0 > a0) return { from: 0, amount: h0 - a0 };
  return { from: 1, amount: (a0 - h0) * price };
}
// 同じトークンの組み合わせのプール（手数料率ちがい）を全部見積もって、一番多く受け取れるものを使う
async function bestQuote(inTok, outTok, amountIn) {
  const P = S.pool, avail = P.avail || { [P.fee]: { addr: P.addr } };
  const tiers = Object.entries(avail).filter(([, a]) => a).map(([f]) => Number(f));
  let best = null;
  for (const fee of tiers) {
    try {
      const q = await quoterR.quoteExactInputSingle.staticCall({ tokenIn: inTok.addr, tokenOut: outTok.addr, amountIn, fee, sqrtPriceLimitX96: 0n });
      if (!best || q.amountOut > best.out) best = { out: q.amountOut, fee };
    } catch {}
  }
  if (!best) throw new Error('交換の見積もりができませんでした');
  return best;
}
async function quoteSwap() {
  try {
    const P = S.pool;
    const [u0, u1] = desiredAmounts(P, $('use0').value, $('use1').value);
    if (u0 === 0n && u1 === 0n) throw new Error('使う量を入れてください（「残高を入れる」も使えます）');
    const plan = planSwap(Number(u0), Number(u1));
    const inTok = plan.from === 0 ? P.t0 : P.t1, outTok = plan.from === 0 ? P.t1 : P.t0;
    const amountIn = floorBig(plan.amount);
    if (amountIn === 0n || plan.amount < Number(plan.from === 0 ? u0 : u1) * 0.002) {
      S.swapPlan = null; $('swapGoRow').style.display = 'none';
      $('swapInfo').innerHTML = 'すでにほぼ必要な比率です。交換は要りません。'; fillAfterSwap(u0, u1); return true;
    }
    $('swapInfo').textContent = '見積もり中…';
    const { out, fee: swapFee } = await bestQuote(inTok, outTok, amountIn);
    const spot = plan.from === 0 ? P.sqrtP ** 2 : 1 / P.sqrtP ** 2; // out生 / in生
    const ideal = Number(amountIn) * spot;
    const impact = Math.max(0, 1 - Number(out) / ideal) * 100; // 手数料込みの目減り
    S.swapPlan = { inTok, outTok, amountIn, out, from: plan.from, u0, u1, fee: swapFee };
    $('swapInfo').innerHTML = `<b>${fmt(toNum(amountIn, inTok.decimals))} ${inTok.symbol}</b> → 約 <b>${fmt(toNum(out, outTok.decimals))} ${outTok.symbol}</b> に交換<br>
      目減り 約${impact.toFixed(2)}%（交換に使うプールの手数料率 ${swapFee / 10000}% ＋ 価格への影響）${impact > 3 ? '<br><span class="warn">目減りが大きいです。量を減らすか、流動性の大きいペアを選んでください。</span>' : ''}`;
    $('swapGoRow').style.display = '';
    return true;
  } catch (e) { $('swapInfo').innerHTML = `<span class="bad">${errMsg(e)}</span>`; return false; }
}
async function doSwap() {
  const btn = $('btnSwap'); btn.disabled = true;
  try {
    await signerReady();
    const P = S.pool, X = S.swapPlan; if (!X) throw new Error('先に見積もりをしてください');
    const slip = Number($('slip').value);
    const minOut = withSlip(X.out, slip);
    const ethIn = usesEth(X.inTok), ethOut = usesEth(X.outTok);
    if (!ethIn) await ensureAllowance(X.inTok, X.amountIn, CHAIN.router);
    const params = { tokenIn: X.inTok.addr, tokenOut: X.outTok.addr, fee: X.fee || P.fee, recipient: ethOut ? ROUTER_THIS : S.account,
      amountIn: X.amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n };
    const calls = [routerIface.encodeFunctionData('exactInputSingle', [params])];
    if (ethOut) calls.push(routerIface.encodeFunctionData('unwrapWETH9', [minOut, S.account]));
    const router = new ethers.Contract(CHAIN.router, ROUTER_ABI, S.signer);
    await sendTx(`${X.inTok.symbol} → ${X.outTok.symbol} 交換`, router.multicall(deadline(), calls, { value: ethIn ? X.amountIn : 0n }));
    // 交換後の量で「入れる額」を埋める（受け取りは最低保証額で見積もる）
    const n0 = X.from === 0 ? X.u0 - X.amountIn : X.u0 + minOut;
    const n1 = X.from === 0 ? X.u1 + minOut : X.u1 - X.amountIn;
    S.swapPlan = null; $('swapGoRow').style.display = 'none';
    $('swapInfo').textContent = '交換しました。下の「流動性を提供」で追加できます。';
    await refreshBalances();
    fillAfterSwap(n0, n1);
    return true;
  } catch (e) { log('交換エラー: ' + errMsg(e)); return false; }
  finally { btn.disabled = false; }
}
// 持っている量 n0,n1 の範囲で、比率どおりの「入れる額」を入れる
function fillAfterSwap(n0, n1) {
  const P = S.pool;
  $('amt0').value = $('amt0').disabled ? '' : ethers.formatUnits(n0, P.t0.decimals);
  S.lastEdited = 0; syncAmounts(0);
  const need1 = Number($('amt1').value || 0), have1 = toNum(n1, P.t1.decimals);
  if ($('amt0').disabled || need1 > have1) {
    $('amt1').value = $('amt1').disabled ? '' : ethers.formatUnits(n1, P.t1.decimals);
    S.lastEdited = 1; syncAmounts(1);
  }
}
// 25/50/75/100% ボタン：使用可能な残高の割合を入れる
function fracAmount(i, frac) {
  if (!S.bal) { log('先にメタマスクに接続してください'); return; }
  if ($('amt' + i).disabled) return;
  const t = i === 0 ? S.pool.t0 : S.pool.t1;
  const v = spendable(i) * BigInt(Math.round(frac * 10000)) / 10000n;
  $('amt' + i).value = ethers.formatUnits(v, t.decimals);
  S.lastEdited = i; syncAmounts(i);
}

// 入れる額 → BigInt（片方は入力値、もう片方は計算値）
function desiredAmounts(P, inp0, inp1) {
  const toBig = (s, dec) => {
    s = String(s || '').trim(); if (!s || !(Number(s) > 0)) return 0n;
    if (!/^\d*\.?\d*$/.test(s)) s = Number(s).toFixed(dec); // 指数表記のときだけ数値経由
    const [i, f = ''] = s.split('.');
    return ethers.parseUnits(`${i || '0'}.${f.slice(0, dec) || '0'}`, dec); // 桁あふれは切り捨て
  };
  return [toBig(inp0, P.t0.decimals), toBig(inp1, P.t1.decimals)];
}
function withSlip(x, slipPct) { return x * BigInt(Math.round((100 - slipPct) * 100)) / 10000n; }

// ETH払いのとき：WETH分をvalueで送り、multicall(mint/increase, refundETH)
function ethPlan(P, a0, a1, payEth) {
  if (!payEth) return { value: 0n, wethSide: -1 };
  if (P.t0.isWeth) return { value: a0, wethSide: 0 };
  if (P.t1.isWeth) return { value: a1, wethSide: 1 };
  return { value: 0n, wethSide: -1 };
}

// ===== メモ（ポジションごと・このブラウザに保存） =====
const memos = () => store.get('nba.memo.' + CHAIN_KEY, {});
function setMemo(id, text) { const m = memos(); if (text) m[String(id)] = clean(text).slice(0, 15); else delete m[String(id)]; store.set('nba.memo.' + CHAIN_KEY, m); }

// ===== レンジを作り直す（閉じる → 比率をそろえる → 新しいレンジで追加） =====
async function startRebuild(pos) {
  showView('pair');
  await loadPool(pos.t0.addr, pos.t1.addr, pos.fee);
  if (!S.pool) return;
  // 前と同じ幅のまま、今の価格を真ん中にしたレンジを入れておく
  const w = Math.sqrt(tickToRaw(pos.tu - pos.tl));
  const c = curDisp();
  S.full = false;
  $('maxP').value = rnd(c * w); $('minP').value = rnd(c / w); onMaxP(); onMinP();
  $('memo').value = memos()[String(pos.id)] || '';
  S.rebuild = pos;
  $('rebuildTxt').textContent = `#${pos.id} を閉じて、下のレンジ（前と同じ幅・今の価格が真ん中）で作り直します。レンジを確かめて、必要なら変えてから「作り直す」を押してください。メタマスクの承認は3〜5回出ます。`;
  $('rebuildStep').textContent = '';
  $('rebuildBox').style.display = '';
  $('rebuildBox').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
async function refreshPoolPrice() {
  const s0 = await new ethers.Contract(S.pool.addr, POOL_ABI, rpc).slot0();
  S.pool.sqrtP = Number(s0.sqrtPriceX96) / 2 ** 96; S.pool.tick = Number(s0.tick);
  renderPrice(); updateRange();
}
async function runRebuild() {
  const pos = S.rebuild; if (!pos) return;
  const btn = $('btnRebuild'); btn.disabled = true;
  const step = t => { $('rebuildStep').textContent = t; log('作り直し：' + t); };
  try {
    await signerReady();
    if (!getTicks()) throw new Error('レンジを正しく入力してください');
    $('payEth').checked = $('recvEth').checked; // 受け取りと支払いで ETH／WETH をそろえる
    await refreshBalances(); const before = S.bal;
    step('1/3 ポジションを閉じています…');
    await doDecrease(pos, 100);
    await refreshBalances(); const after = S.bal;
    const got = i => {
      const t = i === 0 ? S.pool.t0 : S.pool.t1;
      const d = (after[i].erc - before[i].erc) + (usesEth(t) ? after[i].eth - before[i].eth : 0n);
      return d > 0n ? d : 0n;
    };
    const g0 = got(0), g1 = got(1);
    if (g0 === 0n && g1 === 0n) throw new Error('閉じた結果の受け取りが確認できません。「私の流動性」と残高を確かめてください');
    $('use0').value = ethers.formatUnits(g0, S.pool.t0.decimals);
    $('use1').value = ethers.formatUnits(g1, S.pool.t1.decimals);
    step('2/3 比率をそろえています…');
    await refreshPoolPrice();
    if (!(await quoteSwap())) throw new Error('交換の見積もりで止まりました');
    if (S.swapPlan && !(await doSwap())) throw new Error('交換で止まりました');
    step('3/3 新しいレンジで追加しています…');
    if (!(await mint())) throw new Error('追加で止まりました');
    step('作り直しが完了しました。');
    S.rebuild = null;
  } catch (e) { step('止まりました：' + errMsg(e) + '（ここから先は画面の各ボタンで手動で続けられます）'); loadPositions(); }
  finally { btn.disabled = false; }
}

async function mint() {
  const btn = $('btnMint'); btn.disabled = true;
  try {
    await signerReady();
    const P = S.pool, T = getTicks();
    if (!T) throw new Error('レンジを正しく入力してください');
    if (S.warns?.length && !S.warnAck && !S.rebuild) throw new Error('上の「⚠ 注意」を読んで、「内容を確認したうえで進める」にチェックしてください');
    const [a0, a1] = desiredAmounts(P, $('amt0').value, $('amt1').value);
    if (a0 === 0n && a1 === 0n) throw new Error('入れる額を入力してください');
    const slip = Number($('slip').value);
    const ep = ethPlan(P, a0, a1, $('payEth').checked && $('ethPayRow').style.display !== 'none');
    if (ep.wethSide !== 0) await ensureAllowance(P.t0, a0);
    if (ep.wethSide !== 1) await ensureAllowance(P.t1, a1);
    const params = { token0: P.t0.addr, token1: P.t1.addr, fee: P.fee, tickLower: T[0], tickUpper: T[1],
      amount0Desired: a0, amount1Desired: a1, amount0Min: withSlip(a0, slip), amount1Min: withSlip(a1, slip),
      recipient: S.account, deadline: deadline() };
    const npm = new ethers.Contract(NPM, NPM_ABI, S.signer);
    const calls = [npmIface.encodeFunctionData('mint', [params])];
    if (ep.value > 0n) calls.push(npmIface.encodeFunctionData('refundETH', []));
    const r = await sendTx('新規ポジション作成', npm.multicall(calls, { value: ep.value }));
    // 新しいポジション番号を取り出してメモを付ける
    for (const lg of r.logs) {
      if (lg.address.toLowerCase() !== NPM.toLowerCase()) continue;
      try { const ev = npmIface.parseLog(lg); if (ev?.name === 'IncreaseLiquidity') { setMemo(ev.args.tokenId, $('memo').value.trim()); S.lastMinted = String(ev.args.tokenId); log(`ポジション #${ev.args.tokenId} を作りました`); break; } } catch {}
    }
    $('memo').value = '';
    await Promise.all([refreshBalances(), loadPositions()]);
    loadPortfolio();
    return true;
  } catch (e) { log('作成エラー: ' + errMsg(e)); if (S.providing) alert('作成できませんでした：' + errMsg(e)); return false; }
  finally { btn.disabled = false; }
}

// ===== ポジション =====
async function readPosition(id) {
  const p = await npmR.positions(id);
  const [t0, t1] = await Promise.all([token(p.token0), token(p.token1)]);
  const poolAddr = await factoryR.getPool(p.token0, p.token1, p.fee);
  const s0 = await new ethers.Contract(poolAddr, POOL_ABI, rpc).slot0();
  const pos = { id: BigInt(id), t0, t1, fee: Number(p.fee), tl: Number(p.tickLower), tu: Number(p.tickUpper), pool: poolAddr,
    L: p.liquidity, sqrtP: Number(s0.sqrtPriceX96) / 2 ** 96, tick: Number(s0.tick), owed: [p.tokensOwed0, p.tokensOwed1] };
  const [r0, r1] = amountsFromL(Number(pos.L), pos.sqrtP, pos.tl, pos.tu);
  pos.amt = [r0, r1];
  // 未回収の手数料（所有者として collect を試算）
  try {
    const owner = await npmR.ownerOf(id);
    pos.owner = owner;
    const f = await npmR.collect.staticCall({ tokenId: id, recipient: owner, amount0Max: MAX128, amount1Max: MAX128 }, { from: owner });
    pos.fees = [f.amount0, f.amount1];
  } catch { pos.fees = pos.owed; }
  return pos;
}
function posValues(pos) {
  const a0 = pos.amt[0] / 10 ** pos.t0.decimals, a1 = pos.amt[1] / 10 ** pos.t1.decimals;
  const f0 = toNum(pos.fees[0], pos.t0.decimals), f1 = toNum(pos.fees[1], pos.t1.decimals);
  const p0 = priceOf(pos.t0), p1 = priceOf(pos.t1), ok = p0 != null && p1 != null;
  return { a0, a1, f0, f1, val: ok ? a0 * p0 + a1 * p1 : null, fval: ok ? f0 * p0 + f1 * p1 : null };
}
function posHTML(pos, mine) {
  const pool = { t0: pos.t0, t1: pos.t1 };
  const inRange = pos.tick >= pos.tl && pos.tick < pos.tu;
  const closed = pos.L === 0n;
  const inv = /^(USDG|USDC|USDT|DAI|USDe|PYUSD)$/i.test(pos.t0.symbol) && !/^(USDG|USDC|USDT|DAI|USDe|PYUSD)$/i.test(pos.t1.symbol);
  const show = h => inv ? 1 / h : h;
  const [pl, pu] = [show(humanPrice(tickToRaw(pos.tl), pool)), show(humanPrice(tickToRaw(pos.tu), pool))].sort((x, y) => x - y);
  const pc = show(humanPrice(pos.sqrtP ** 2, pool));
  const unit = inv ? `${pos.t0.symbol}/${pos.t1.symbol}` : `${pos.t1.symbol}/${pos.t0.symbol}`;
  const v = posValues(pos);
  const memo = memos()[String(pos.id)];
  const chip = closed ? '<span class="chip">閉じています</span>' : inRange ? '<span class="chip on">レンジ内</span>' : '<span class="chip off">レンジ外</span>';
  // レンジのバー：表示範囲はレンジの外側に余白をとる。今の価格の位置に縦線
  const lo = Math.log(pl), hi = Math.log(pu), padL = (hi - lo) * 0.35;
  const x = val => Math.min(100, Math.max(0, (Math.log(val) - (lo - padL)) / ((hi - lo) + 2 * padL) * 100));
  const bar = `<div class="bar"><div class="in" style="left:${x(pl)}%;right:${100 - x(pu)}%"></div>
    <div class="now" style="left:${x(pc)}%;background:${inRange ? 'var(--text)' : 'var(--bad)'}"></div>
    <span class="nowLbl ${inRange ? '' : 'bad'}" style="left:${x(pc)}%">今 ${fmt(pc)}</span>
    <span class="lbl" style="left:${x(pl)}%">${fmt(pl)}</span><span class="lbl" style="left:${x(pu)}%">${fmt(pu)}</span></div>`;
  return `<div class="pos" data-id="${pos.id}">
    <div class="head"><div class="avs">${av(pos.t0.symbol, pos.t0.addr)}${av(pos.t1.symbol, pos.t1.addr)}</div>
      <div style="flex:1;min-width:0"><b>${pos.t0.symbol}/${pos.t1.symbol}</b> <span class="chip">手数料 ${pos.fee / 10000}%</span>
        <div class="sub">#${pos.id}${memo ? '　メモ：' + memo : ''}</div></div>${chip}</div>
    ${closed ? '' : bar}
    <div class="kv">
      <div>レンジ（${unit}）</div><div>${fmt(pl)} 〜 ${fmt(pu)}</div>
      <div>入っている量</div><div>${fmt(v.a0)} ${pos.t0.symbol}<br>${fmt(v.a1)} ${pos.t1.symbol}</div>
      <div>評価額</div><div><b>${v.val != null ? usd(v.val) : '-'}</b></div>
      <div>未回収の手数料</div><div><b class="good">${v.fval != null ? usd(v.fval) : ''}</b><br><span class="sub">${fmt(v.f0)} ${pos.t0.symbol} ＋ ${fmt(v.f1)} ${pos.t1.symbol}</span></div>
      ${mine ? '' : `<div>持ち主</div><div class="sub mono">${pos.owner ? pos.owner.slice(0, 10) + '…' : '-'}</div>`}
    </div>
    ${mine ? `<div class="acts">
      <button data-act="collect">手数料を回収</button>
      <button data-act="add" ${closed ? 'disabled' : ''}>流動性を追加</button>
      <button data-act="remove" ${closed ? 'disabled' : ''}>一部を引き出す</button>
      <button data-act="rebuild" ${closed ? 'disabled' : ''}>レンジを作り直す</button>
      <button data-act="close" class="danger" ${closed ? 'disabled' : ''}>閉じて全額回収</button>
      <button data-act="memo">メモ</button>
      <a class="sub" style="align-self:center" href="https://app.uniswap.org/positions/v3/${CHAIN.uni}/${pos.id}" target="_blank">Uniswapで見る</a>
    </div><div class="panelBox"></div>` : `<div class="sub" style="margin-top:8px"><a href="https://app.uniswap.org/positions/v3/${CHAIN.uni}/${pos.id}" target="_blank">Uniswapで見る</a></div>`}
  </div>`;
}
async function loadPositions() {
  if (!S.account) return;
  $('posList').innerHTML = '<div class="empty">読み込み中…</div>';
  try {
    const n = Number(await npmR.balanceOf(S.account));
    const ids = await Promise.all([...Array(n).keys()].map(i => npmR.tokenOfOwnerByIndex(S.account, i)));
    const all = await Promise.all(ids.map(readPosition));
    S.positions = Object.fromEntries(all.map(p => [String(p.id), p]));
    await ensurePrices(all.flatMap(p => [p.t0.addr, p.t1.addr]));
    const list = all.filter(p => $('showClosed').checked || p.L > 0n || p.fees[0] > 0n || p.fees[1] > 0n).sort((a, b) => Number(b.id - a.id));
    const open = all.filter(p => p.L > 0n), vals = open.map(posValues);
    const sum = k => vals.reduce((s, v) => s + (v[k] || 0), 0);
    const outN = open.filter(p => !(p.tick >= p.tl && p.tick < p.tu)).length;
    $('posStats').innerHTML = `<div class="stat"><div class="sub">提供中の評価額</div><div class="v">${usd(sum('val'))}</div></div>
      <div class="stat"><div class="sub">未回収の手数料</div><div class="v good">${usd(sum('fval'))}</div></div>
      <div class="stat"><div class="sub">ポジション</div><div class="v">${open.length}件 ${outN ? `<span class="bad" style="font-size:13px">レンジ外 ${outN}件</span>` : ''}</div></div>`;
    $('navPos').textContent = open.length ? `私の流動性（${open.length}）` : '私の流動性';
    $('posList').innerHTML = list.length ? `<div class="posGrid">${list.map(p => posHTML(p, true)).join('')}</div>` : '<div class="empty">このウォレットのポジションはまだありません。</div>';
  } catch (e) { $('posList').innerHTML = `<div class="empty">読み込みエラー：${errMsg(e)}</div>`; }
}

// 受け取り：WETHをETHに戻す場合は collect先をNPMにして unwrap＋sweep
function collectCalls(pos, extraFirst = []) {
  const recvEth = $('recvEth').checked && (pos.t0.isWeth || pos.t1.isWeth);
  const calls = [...extraFirst];
  calls.push(npmIface.encodeFunctionData('collect', [{ tokenId: pos.id, recipient: recvEth ? ethers.ZeroAddress : S.account, amount0Max: MAX128, amount1Max: MAX128 }]));
  if (recvEth) {
    const other = pos.t0.isWeth ? pos.t1 : pos.t0;
    calls.push(npmIface.encodeFunctionData('unwrapWETH9', [0n, S.account]));
    calls.push(npmIface.encodeFunctionData('sweepToken', [other.addr, 0n, S.account]));
  }
  return calls;
}
async function doCollect(pos) {
  await signerReady();
  const npm = new ethers.Contract(NPM, NPM_ABI, S.signer);
  await sendTx(`#${pos.id} 手数料回収`, npm.multicall(collectCalls(pos)));
}
async function doDecrease(pos, pct) {
  await signerReady();
  const slip = Number($('slip').value);
  const liq = pos.L * BigInt(pct) / 100n;
  const [e0, e1] = amountsFromL(Number(liq), pos.sqrtP, pos.tl, pos.tu);
  const dec = npmIface.encodeFunctionData('decreaseLiquidity', [{ tokenId: pos.id, liquidity: liq,
    amount0Min: withSlip(floorBig(e0), slip), amount1Min: withSlip(floorBig(e1), slip), deadline: deadline() }]);
  const npm = new ethers.Contract(NPM, NPM_ABI, S.signer);
  await sendTx(`#${pos.id} ${pct}% 引き出し`, npm.multicall(collectCalls(pos, [dec])));
}
async function doIncrease(pos, in0, in1) {
  await signerReady();
  const pool = { t0: pos.t0, t1: pos.t1 };
  const [a0, a1] = desiredAmounts(pool, in0, in1);
  if (a0 === 0n && a1 === 0n) throw new Error('額を入力してください');
  const slip = Number($('slip').value);
  const ep = ethPlan(pool, a0, a1, $('recvEth').checked);
  if (ep.wethSide !== 0) await ensureAllowance(pos.t0, a0);
  if (ep.wethSide !== 1) await ensureAllowance(pos.t1, a1);
  const calls = [npmIface.encodeFunctionData('increaseLiquidity', [{ tokenId: pos.id, amount0Desired: a0, amount1Desired: a1,
    amount0Min: withSlip(a0, slip), amount1Min: withSlip(a1, slip), deadline: deadline() }])];
  if (ep.value > 0n) calls.push(npmIface.encodeFunctionData('refundETH', []));
  const npm = new ethers.Contract(NPM, NPM_ABI, S.signer);
  await sendTx(`#${pos.id} 流動性追加`, npm.multicall(calls, { value: ep.value }));
}
function openPanel(card, pos, act) {
  const box = card.querySelector('.panelBox');
  if (act === 'remove') {
    box.innerHTML = `<div class="panel"><div class="row"><span class="sub">引き出す割合</span>
      <select class="pct"><option>25</option><option selected>50</option><option>75</option><option>100</option></select>%
      <button class="primary go">引き出す（手数料も回収）</button><button class="cancel">やめる</button></div></div>`;
    box.querySelector('.go').onclick = () => run(card, () => doDecrease(pos, Number(box.querySelector('.pct').value)));
  } else if (act === 'add') {
    const sa = sqrtAt(pos.tl), sb = sqrtAt(pos.tu), sp = pos.sqrtP;
    const k = 10 ** (pos.t0.decimals - pos.t1.decimals);
    const ratio = (sp > sa && sp < sb) ? (sp - sa) * sp * sb / (sb - sp) : null;
    box.innerHTML = `<div class="panel">
      <div class="row"><span class="sub" style="min-width:60px">${pos.t0.symbol}</span><input class="i0" type="number" step="any" style="flex:1" ${sp >= sb ? 'disabled' : ''}></div>
      <div class="row"><span class="sub" style="min-width:60px">${pos.t1.symbol}</span><input class="i1" type="number" step="any" style="flex:1" ${sp <= sa ? 'disabled' : ''}></div>
      <div class="sub">WETHのペアは、右の「WETHはETHに戻して受け取る」がオンならETHで払います。</div>
      <div class="row" style="margin-top:8px"><button class="primary go">追加する</button><button class="cancel">やめる</button></div></div>`;
    const i0 = box.querySelector('.i0'), i1 = box.querySelector('.i1');
    if (ratio) {
      i0.oninput = () => { const v = Number(i0.value); i1.value = v > 0 ? Number((v * ratio * k).toPrecision(10)) : ''; };
      i1.oninput = () => { const v = Number(i1.value); i0.value = v > 0 ? Number((v / ratio / k).toPrecision(10)) : ''; };
    }
    box.querySelector('.go').onclick = () => run(card, () => doIncrease(pos, i0.value, i1.value));
  } else if (act === 'close') {
    box.innerHTML = `<div class="panel"><div class="row"><span>全額と手数料をウォレットに戻します。よろしいですか？</span>
      <button class="danger go">閉じる</button><button class="cancel">やめる</button></div></div>`;
    box.querySelector('.go').onclick = () => run(card, () => doDecrease(pos, 100));
  } else if (act === 'memo') {
    box.innerHTML = `<div class="panel"><div class="row"><input class="m" maxlength="15" style="flex:1" placeholder="最大15文字">
      <button class="primary go">保存</button><button class="cancel">やめる</button></div></div>`;
    box.querySelector('.m').value = memos()[String(pos.id)] || '';
    box.querySelector('.go').onclick = () => { setMemo(pos.id, box.querySelector('.m').value.trim()); loadPositions(); };
  }
  box.querySelector('.cancel').onclick = () => box.innerHTML = '';
}
async function run(card, fn) {
  card.querySelectorAll('button').forEach(b => b.disabled = true);
  try { await fn(); } catch (e) { log('エラー: ' + errMsg(e)); }
  await Promise.all([loadPositions(), refreshBalances()]);
  loadPortfolio();
}

// ===== ガス代の表示 =====
async function updateGas() {
  try {
    const f = await rpc.getFeeData(); S.gasPrice = f.gasPrice ?? 0n;
    $('gasChip').textContent = `Gas: ${Number(ethers.formatUnits(S.gasPrice, 'gwei')).toPrecision(3)} Gwei`;
    renderUsd();
  } catch {}
}
// ガス量 → ドル（今の相場とETHの価格で）
const gasUsdOf = units => S.gasPrice != null && priceOf(WETH) ? Number(ethers.formatEther(S.gasPrice * BigInt(units))) * priceOf(WETH) : null;

// ===== 収益概要 =====
// ポジションごとに、作成・追加・引き出し・回収の記録（イベント）をチェーンから読む。
// RPCの制限：1回に 1,000万ブロックまで・ポジション番号は1つずつ。新しい方から過去へ読み、作成の記録まで見つかったら止める。
const EV = {
  inc: npmIface.getEvent('IncreaseLiquidity').topicHash, dec: npmIface.getEvent('DecreaseLiquidity').topicHash,
  col: npmIface.getEvent('Collect').topicHash, transfer: ethers.id('Transfer(address,address,uint256)'),
};
const LOG_SPAN = 10_000_000, MAX_CHUNKS = 60;
const E = { busy: false };
// 回数制限に当たると失敗する（Failed to fetch／Too Many Requests）ので、待ってやり直す
async function retry(fn) {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) { if (i >= 5) throw e; await new Promise(r => setTimeout(r, [1500, 3000, 6000, 10000, 15000][i])); }
  }
}
async function getLogsSafe(params) {
  await new Promise(r => setTimeout(r, 250)); // 続けて問い合わせすぎないように少し空ける
  return retry(() => rpc.send('eth_getLogs', [params]));
}
function parseEvents(raw) {
  return raw.filter(l => [EV.inc, EV.dec, EV.col].includes(l.topics[0])).map(l => {
    const ev = npmIface.parseLog(l);
    const k = l.topics[0] === EV.inc ? 'inc' : l.topics[0] === EV.dec ? 'dec' : 'col';
    return { k, liq: k === 'col' ? '0' : ev.args.liquidity.toString(), a0: ev.args.amount0.toString(), a1: ev.args.amount1.toString(),
      block: parseInt(l.blockNumber, 16), ts: l.blockTimestamp ? parseInt(l.blockTimestamp, 16) : 0, tx: l.transactionHash, li: parseInt(l.logIndex, 16) };
  });
}
async function isMintTx(txHash, id) {
  const r = await retry(() => rpc.getTransactionReceipt(txHash));
  return r.logs.some(l => l.address.toLowerCase() === NPM.toLowerCase() && l.topics[0] === EV.transfer && BigInt(l.topics[1]) === 0n && BigInt(l.topics[3]) === BigInt(id));
}
async function positionEvents(pos, latest) {
  const key = `nba.ev.${CHAIN_KEY}.${pos.id}`, cache = store.get(key, null), idTopic = ethers.toBeHex(pos.id, 32);
  const range = (f, t) => getLogsSafe({ address: NPM, topics: [null, idTopic], fromBlock: ethers.toQuantity(f), toBlock: ethers.toQuantity(t) });
  let evs = cache?.evs || [];
  if (cache?.complete) {
    for (let f = cache.upto + 1; f <= latest; f += LOG_SPAN) evs.push(...parseEvents(await range(f, Math.min(latest, f + LOG_SPAN - 1))));
  } else {
    evs = []; let complete = false;
    for (let n = 0, t = latest; n < MAX_CHUNKS && t >= 0; n++, t -= LOG_SPAN) {
      evs.push(...parseEvents(await range(Math.max(0, t - LOG_SPAN + 1), t)));
      const inc = evs.filter(e => e.k === 'inc');
      const net = inc.reduce((s, e) => s + BigInt(e.liq), 0n) - evs.filter(e => e.k === 'dec').reduce((s, e) => s + BigInt(e.liq), 0n);
      // 流動性の出入りの合計が今の流動性と合い、いちばん古い追加が「作成」の取引なら全部そろった
      if (inc.length && net === pos.L) {
        const first = inc.reduce((a, b) => (a.block < b.block || (a.block === b.block && a.li < b.li)) ? a : b);
        if (await isMintTx(first.tx, pos.id)) { complete = true; break; }
      }
    }
    if (!complete) log(`#${pos.id} の記録をすべては読めませんでした（古すぎる可能性）。集計は読めた分だけです。`);
    store.set(key, { upto: latest, complete, evs });
    return evs.sort((a, b) => a.block - b.block || a.li - b.li);
  }
  store.set(key, { upto: latest, complete: true, evs });
  return evs.sort((a, b) => a.block - b.block || a.li - b.li);
}
// 1ポジションの集計：引き出した元本と、回収した手数料を分ける（回収のうち引き出し分までが元本、残りが手数料）
function summarizePosition(pos, evs) {
  const z = () => [0n, 0n];
  const dep = z(), wd = z(), fee = z(), pend = z(), rows = [];
  let first = true;
  const byTx = {};
  for (const e of evs) (byTx[e.tx] = byTx[e.tx] || { ts: e.ts, block: e.block, tx: e.tx, inc: z(), dec: z(), fee: z() });
  for (const e of evs) {
    const a = [BigInt(e.a0), BigInt(e.a1)], g = byTx[e.tx];
    if (e.k === 'inc') { for (const i of [0, 1]) { dep[i] += a[i]; g.inc[i] += a[i]; } if (first) { g.mint = true; first = false; } }
    if (e.k === 'dec') for (const i of [0, 1]) { wd[i] += a[i]; pend[i] += a[i]; g.dec[i] += a[i]; }
    if (e.k === 'col') for (const i of [0, 1]) { const p = a[i] < pend[i] ? a[i] : pend[i]; pend[i] -= p; fee[i] += a[i] - p; g.fee[i] += a[i] - p; }
  }
  return { pos, dep, wd, fee, txs: Object.values(byTx) };
}
// 記録に日時が入っていないチェーン（Robinhood は 0 になる）では、ブロックの日時を問い合わせて補う。調べた日時は保存
async function fillTimestamps(evs) {
  const key = 'nba.bts.' + CHAIN_KEY, bts = store.get(key, {});
  const need = [...new Set(evs.filter(e => !e.ts && !bts[e.block]).map(e => e.block))];
  for (const [i, b] of need.entries()) {
    $('earnMsg').textContent = `取引の日時を調べています… ${i + 1} / ${need.length}`;
    const blk = await retry(() => rpc.getBlock(b));
    bts[b] = blk.timestamp;
    if (i % 10 === 9) store.set(key, bts);
  }
  store.set(key, bts);
  evs.forEach(e => { if (!e.ts) e.ts = bts[e.block] || 0; });
}
async function loadEarnings(force) {
  if (!S.account) { $('earnStats').innerHTML = '<div class="empty">メタマスクに接続すると表示されます。</div>'; return; }
  if (E.busy) return; E.busy = true;
  try {
    $('earnMsg').textContent = 'ポジションを読み込んでいます…（回数制限に当たると少し時間がかかります）';
    if (force || !Object.keys(S.positions).length) await loadPositions();
    const list = Object.values(S.positions).sort((a, b) => Number(a.id - b.id));
    if (!list.length) { $('earnStats').innerHTML = '<div class="empty">このウォレットのポジションはまだありません。</div>'; return; }
    const latest = await retry(() => rpc.getBlockNumber());
    const sums = [];
    const evsList = [];
    for (const [i, p] of list.entries()) {
      $('earnMsg').textContent = `記録を読んでいます… ${i + 1} / ${list.length}（#${p.id}）`;
      evsList.push(await positionEvents(p, latest));
    }
    await fillTimestamps(evsList.flat());
    list.forEach((p, i) => sums.push(summarizePosition(p, evsList[i])));
    $('earnMsg').textContent = '';
    await ensurePrices(list.flatMap(p => [p.t0.addr, p.t1.addr]));
    renderEarnings(sums);
  } catch (e) { $('earnMsg').textContent = '読み込みエラー：' + errMsg(e); }
  finally { E.busy = false; }
}
function renderEarnings(sums) {
  const val = (t, raw) => { const p = priceOf(t); return p != null ? toNum(raw, t.decimals) * p : null; };
  const pair = (pos, a) => { const v0 = val(pos.t0, a[0]), v1 = val(pos.t1, a[1]); return v0 == null || v1 == null ? null : v0 + v1; };
  const tot = { dep: 0, wd: 0, fee: 0, unc: 0, cur: 0 }, rows = [], hist = [], months = {};
  let missing = false;
  for (const s of sums) {
    const P = s.pos, v = posValues(P);
    const r = { dep: pair(P, s.dep), wd: pair(P, s.wd), fee: pair(P, s.fee), unc: v.fval, cur: P.L > 0n ? v.val : 0 };
    if (Object.values(r).some(x => x == null)) missing = true;
    for (const k in tot) tot[k] += r[k] || 0;
    r.pl = (r.cur || 0) + (r.wd || 0) + (r.fee || 0) + (r.unc || 0) - (r.dep || 0);
    rows.push({ P, r });
    for (const g of s.txs) {
      const d = g.ts ? new Date(g.ts * 1000) : null;
      const push = (kind, a, sign) => { const u = pair(P, a); hist.push({ ts: g.ts, d, kind, P, a, u, tx: g.tx, sign }); return u; };
      if (g.inc[0] || g.inc[1]) push(g.mint ? 'ペアを作成' : '流動性を追加', g.inc);
      if (g.dec[0] || g.dec[1]) push('引き出し', g.dec);
      if (g.fee[0] || g.fee[1]) {
        const u = push('手数料を回収', g.fee, '+');
        if (d && u != null) { const m = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}`; months[m] = (months[m] || 0) + u; }
      }
    }
  }
  const pl = tot.cur + tot.wd + tot.fee + tot.unc - tot.dep;
  const stat = (label, v, cls = '') => `<div class="stat"><div class="sub">${label}</div><div class="v ${cls}">${usd(v)}</div></div>`;
  $('earnStats').innerHTML = stat('入れた額の合計', tot.dep) + stat('引き出した額', tot.wd) + stat('回収した手数料', tot.fee, 'good')
    + stat('未回収の手数料', tot.unc, 'good') + stat('今の評価額', tot.cur) + `<div class="stat"><div class="sub">損益</div><div class="v ${pl >= 0 ? 'good' : 'bad'}">${pl >= 0 ? '+' : '−'}${usd(Math.abs(pl))}</div></div>`;
  $('earnMsg').innerHTML = (missing ? '<span class="warn">価格が分からないトークンがあり、一部のドル換算が入っていません。</span><br>' : '')
    + '損益＝今の評価額＋引き出した額＋回収した手数料＋未回収の手数料−入れた額（すべて今の価格で換算）。価格の上下による増減（インパーマネントロス）もここに含まれます。';
  // 月ごとの手数料
  const keys = Object.keys(months).sort().slice(-12);
  if (!keys.length) $('earnBars').innerHTML = '<div class="empty">まだ手数料の回収はありません。</div>';
  else {
    const max = Math.max(...keys.map(k => months[k]));
    $('earnBars').innerHTML = `<div class="bars">${keys.map(k => `<div class="b"><span>${usd(months[k])}</span><i style="height:${Math.max(2, months[k] / max * 120)}px"></i></div>`).join('')}</div>
      <div class="blabels">${keys.map(k => `<span>${k}</span>`).join('')}</div>`;
  }
  // ポジション別
  rows.sort((a, b) => Number(b.P.id - a.P.id));
  const f = x => x == null ? '-' : usd(x);
  $('earnTable').innerHTML = `<table class="tbl"><tr><th>ポジション</th><th>状態</th><th>入れた額</th><th>引き出した額</th><th title="回収した分＋未回収の分">手数料</th><th>今の評価額</th><th>損益</th></tr>
    ${rows.map(({ P, r }) => {
      const inR = P.tick >= P.tl && P.tick < P.tu, st = P.L === 0n ? '閉じた' : inR ? '<span class="good">レンジ内</span>' : '<span class="bad">レンジ外</span>';
      const memo = memos()[String(P.id)];
      return `<tr><td><b>${P.t0.symbol}/${P.t1.symbol}</b> <span class="sub">${P.fee / 10000}%</span><br><span class="sub">#${P.id}${memo ? '　' + memo : ''}</span></td><td>${st}</td>
        <td>${f(r.dep)}</td><td>${f(r.wd)}</td><td class="good">${f((r.fee || 0) + (r.unc || 0))}</td><td>${f(r.cur)}</td>
        <td class="${r.pl >= 0 ? 'good' : 'bad'}">${r.pl >= 0 ? '+' : '−'}${usd(Math.abs(r.pl))}</td></tr>`;
    }).join('')}</table>`;
  // 操作履歴
  hist.sort((a, b) => b.ts - a.ts);
  const day0 = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const ago = d => { if (!d) return ''; const days = Math.round((day0(new Date()) - day0(d)) / 864e5); return days <= 0 ? '今日' : days === 1 ? '昨日' : `${days}日前`; };
  $('earnHist').innerHTML = hist.length ? hist.slice(0, 150).map(h => `<div class="hrow">
      <div class="t"><span>${ago(h.d)}</span><span>${h.d ? h.d.toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}</span></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px"><b>${h.kind}</b><span class="sub">#${h.P.id} ${h.P.t0.symbol}/${h.P.t1.symbol}</span></div>
      <div class="v ${h.sign ? 'good' : ''}">${h.u != null ? (h.sign || '') + usd(h.u) : '-'}</div>
      <div class="sub">${fmt(toNum(h.a[0], h.P.t0.decimals))} ${h.P.t0.symbol}　${fmt(toNum(h.a[1], h.P.t1.decimals))} ${h.P.t1.symbol}　<a href="${CHAIN.explorer}/tx/${h.tx}" target="_blank">取引</a></div>
    </div>`).join('') : '<div class="empty">記録がありません。</div>';
}

// ===== イベント =====
Object.entries(CHAINS).forEach(([k, c]) => $('chainSel').add(new Option(c.name, k, false, k === CHAIN_KEY)));
$('chainSel').onchange = () => {
  try { localStorage.setItem('nba.chain', $('chainSel').value); } catch {}
  location.href = location.pathname + '?chain=' + $('chainSel').value;
};
$('btnConnect').onclick = connect;
$('navPair').onclick = () => showView('pair');
$('navPos').onclick = () => { showView('pos'); if (S.account) loadPositions(); };
$('navEarn').onclick = () => { showView('earn'); loadEarnings(); };
$('btnEarnReload').onclick = () => loadEarnings(true);
$('btnPfReload').onclick = loadPortfolio;
document.querySelectorAll('#pickTabs button').forEach(b => b.onclick = () => {
  document.querySelectorAll('#pickTabs button').forEach(x => x.classList.toggle('on', x === b));
  L.sort = b.dataset.sort; renderPairs();
});
let qTimer;
$('pairQ').oninput = () => { clearTimeout(qTimer); qTimer = setTimeout(() => searchPairs($('pairQ').value), 700); };
$('minTvl').onchange = renderPairs;
$('btnMore').onclick = loadMorePairs;
$('pairList').onclick = e => {
  const row = e.target.closest('.pcard'); if (!row) return;
  if (e.target.closest('details') || e.target.closest('select') || e.target.closest('input')) return;
  if (e.target.closest('[data-star]')) { toggleFav(row.dataset.addr, row.dataset.name); return; }
  const w = row.dataset.w; // おすすめから選んだときは、その幅を入れる
  selectPoolAddr(row.dataset.addr).then(() => { if (w && S.pool?.addr?.toLowerCase() === row.dataset.addr) { $('pctIn').value = ''; setRangePct(w === 'full' ? 'full' : Math.round(Number(w) * 100)); } });
};
$('btnFav').onclick = () => S.pool && toggleFav(S.pool.addr, `${S.pool.t0.symbol} / ${S.pool.t1.symbol} ${S.pool.fee / 10000}%`);
$('btnInvert').onclick = () => {
  S.invert = !S.invert;
  const a = Number($('minP').value), b = Number($('maxP').value);
  if (a > 0 && b > 0) { $('minP').value = rnd(1 / b); $('maxP').value = rnd(1 / a); onMinP(); onMaxP(); }
  renderPrice(); updateRange();
};
document.querySelectorAll('[data-pct]').forEach(b => b.onclick = () => { $('pctIn').value = ''; setRangePct(b.dataset.pct === 'full' ? 'full' : Number(b.dataset.pct)); });
// 手入力の幅（±%）：打つたびに反映。0〜99% の範囲だけ受け付ける
$('pctIn').oninput = () => { const v = Number($('pctIn').value); if (S.pool && v > 0 && v < 100) setRangePct(v); };
$('maxP').oninput = onMaxP; $('minP').oninput = onMinP;
$('maxR').oninput = onMaxR; $('minR').oninput = onMinR;
$('pFees').onclick = e => {
  const b = e.target.closest('[data-fee]'); if (!b || !S.pool) return;
  const f = Number(b.dataset.fee), a = S.pool.avail?.[f];
  if (f === S.pool.fee) return;
  if (a === null) { log(`手数料 ${f / 10000}% のプールはまだありません`); return; }
  loadPool(S.pool.t0.addr, S.pool.t1.addr, f);
};
$('totalUsd').oninput = () => { splitTotal(); renderRangeYield(); };
$('amt0').oninput = () => { S.lastEdited = 0; syncAmounts(0); };
$('amt1').oninput = () => { S.lastEdited = 1; syncAmounts(1); };
document.querySelectorAll('.fracs').forEach(g => g.onclick = e => { const b = e.target.closest('[data-frac]'); if (b) fracAmount(Number(g.dataset.i), Number(b.dataset.frac)); });
$('payEth').onchange = () => { refreshBalances(); };
$('btnMint').onclick = () => provideOnce(mint);
$('btnRebuild').onclick = runRebuild;
$('btnRebuildCancel').onclick = () => { S.rebuild = null; $('rebuildBox').style.display = 'none'; };
$('btnUseBal').onclick = useBalances;
$('btnQuote').onclick = quoteSwap;
$('btnSwap').onclick = doSwap;
$('use0').oninput = $('use1').oninput = () => { S.swapPlan = null; $('swapGoRow').style.display = 'none'; };
// ペアを作成
$('btnShowCreate').onclick = openCreate;
$('btnCreateCancel').onclick = closeCreate;
$('cTokA').onclick = () => openTokModal('a');
$('cTokB').onclick = () => openTokModal('b');
$('cFees').onclick = e => { const b = e.target.closest('[data-fee]'); if (!b) return; C.fee = Number(b.dataset.fee); renderCreate(); };
$('btnCreate').onclick = createGo;
$('tokClose').onclick = () => $('tokModal').classList.remove('open');
$('tokModal').onclick = e => { if (e.target === $('tokModal')) $('tokModal').classList.remove('open'); };
let tTimer;
$('tokQ').oninput = () => { clearTimeout(tTimer); tTimer = setTimeout(() => renderTokList($('tokQ').value), 300); };
$('tokChips').onclick = e => { const b = e.target.closest('[data-addr]'); if (b) pickToken(b.dataset.addr); };
$('tokList').onclick = e => { const r = e.target.closest('[data-addr]'); if (r) pickToken(r.dataset.addr); };
// 私の流動性
$('btnReload').onclick = () => { loadPositions(); refreshBalances(); loadPortfolio(); };
$('showClosed').onchange = loadPositions;
$('posList').onclick = e => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const card = b.closest('.pos'), pos = S.positions[card.dataset.id];
  if (b.dataset.act === 'collect') run(card, () => doCollect(pos));
  else if (b.dataset.act === 'rebuild') startRebuild(pos);
  else openPanel(card, pos, b.dataset.act);
};
$('btnLook').onclick = async () => {
  const id = $('lookId').value.trim(); if (!id) return;
  $('lookBox').innerHTML = '<div class="sub">読み込み中…</div>';
  try { const p = await readPosition(id); await ensurePrices([p.t0.addr, p.t1.addr]); $('lookBox').innerHTML = posHTML(p, false); }
  catch (e) { $('lookBox').innerHTML = `<div class="bad">${errMsg(e)}</div>`; }
};
if (window.ethereum) {
  window.ethereum.on?.('accountsChanged', () => { S.signer = null; connect(); });
  window.ethereum.on?.('chainChanged', () => location.reload());
}
updateGas(); setInterval(updateGas, 30000);
selectPoolAddr((L.favs[0] || DEFAULT_FAVS[0]).addr);
(async () => { for (let i = 0; i < 2; i++) await loadMorePairs(); })(); // 最初は40件
