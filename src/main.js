import {
  AmmoraRouteClient, AmmoraDataApiClient, resolveAmmoraFinalizedHead,
  giwaSepoliaAutoRoute as route, giwaSepoliaAutoRouteCatalog as routeCatalog,
  giwaSepoliaAutoRouteDeploymentCatalog as deploymentCatalog,
  giwaSepoliaAutoRoutePoolProfiles as factoryProfiles,
} from '@ammora-protocol/sdk';
import { createPublicClient, http, isAddress, parseUnits, formatUnits, erc20Abi } from 'viem';

const $ = (id) => document.getElementById(id);
const DEAD = '0x000000000000000000000000000000000000dEaD';
const CHAIN_HEX = '0x' + (91342).toString(16);
const rpcUrls = route.rpcUrls?.length ? route.rpcUrls : ['https://sepolia-rpc.giwa.io'];
const client = createPublicClient({ transport: http(rpcUrls[0]) });
const json = (o) => JSON.stringify(o, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
const short = (a) => a.slice(0, 6) + '…' + a.slice(-4);
const val = (id) => $(id).value.trim();
let account = null, side = 'buy', balance = 0n, inMeta = { decimals: 18, symbol: '–' }, timer, last = $('pool');

// ---- navigation ----
document.querySelectorAll('nav button').forEach((b) => (b.onclick = () => {
  document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('on', x === b));
  $('v-swap').classList.toggle('hide', b.dataset.v !== 'swap');
  $('v-explore').classList.toggle('hide', b.dataset.v !== 'explore');
}));
document.querySelectorAll('input').forEach((i) => i.addEventListener('focus', () => (last = i)));

// ---- wallet ----
function paintWallet() {
  $('wbtn').textContent = account ? short(account) : 'Connect Wallet';
  $('go').textContent = account ? 'Refresh quote' : 'Connect Wallet';
  loadBalance();
}
async function connect() {
  const eth = window.ethereum;
  if (!eth) { $('msg').textContent = 'No wallet found. Please install MetaMask.'; return; }
  try {
    const [addr] = await eth.request({ method: 'eth_requestAccounts' });
    try { await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_HEX }] }); }
    catch (e) {
      if (e?.code !== 4902 && e?.data?.originalError?.code !== 4902) throw e;
      await eth.request({ method: 'wallet_addEthereumChain', params: [{ chainId: CHAIN_HEX, chainName: 'GIWA Sepolia',
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://sepolia-rpc.giwa.io'],
        blockExplorerUrls: ['https://sepolia-explorer.giwa.io'] }] });
    }
    account = addr; $('msg').textContent = ''; paintWallet();
  } catch (e) { $('msg').textContent = String(e?.message ?? e).slice(0, 120); }
}
$('wbtn').onclick = () => (account ? ((account = null), paintWallet()) : connect());
window.ethereum?.on?.('accountsChanged', (a) => { account = a[0] ?? null; paintWallet(); });

// ---- helpers ----
const pair = () => (side === 'buy' ? { inT: val('ta'), outT: val('tb') } : { inT: val('tb'), outT: val('ta') });
async function meta(address) {
  try {
    const [d, s] = await Promise.all(['decimals', 'symbol'].map((functionName) => client.readContract({ address, abi: erc20Abi, functionName })));
    return { decimals: Number(d), symbol: s };
  } catch { return { decimals: 18, symbol: '?' }; }
}
async function loadBalance() {
  const { inT } = pair();
  if (!account || !isAddress(inT)) { $('bal').textContent = 'Balance –'; balance = 0n; return; }
  try {
    balance = await client.readContract({ address: inT, abi: erc20Abi, functionName: 'balanceOf', args: [account] });
    $('bal').textContent = `Balance ${Number(formatUnits(balance, inMeta.decimals)).toFixed(4)} ${inMeta.symbol}`;
  } catch { $('bal').textContent = 'Balance –'; }
}
function setSide(s) {
  side = s;
  $('t-buy').classList.toggle('on', s === 'buy'); $('t-sell').classList.toggle('on', s === 'sell');
  $('est').textContent = '0'; $('minr').textContent = '–'; quoteSoon();
}
$('t-buy').onclick = () => setSide('buy'); $('t-sell').onclick = () => setSide('sell');
document.querySelectorAll('.chips button').forEach((b) => (b.onclick = () => {
  $('amt').value = b.dataset.a === 'max' ? formatUnits(balance, inMeta.decimals) : b.dataset.a; quoteSoon();
}));
['amt', 'slip', 'model', 'pool', 'ta', 'tb'].forEach((id) => $(id).addEventListener('input', quoteSoon));
$('go').onclick = () => (account ? doQuote() : connect());

// ---- quote ----
function quoteSoon() { clearTimeout(timer); timer = setTimeout(doQuote, 600); }
async function doQuote() {
  const msg = $('msg'); msg.textContent = '';
  const { inT, outT } = pair();
  if (!isAddress(val('pool')) || !isAddress(inT) || !isAddress(outT)) return;
  const amtText = val('amt');
  if (!amtText || Number(amtText) <= 0) return;
  try {
    $('est').textContent = '…';
    const [mi, mo] = await Promise.all([meta(inT), meta(outT)]);
    inMeta = mi;
    $('sym-in').textContent = mi.symbol; $('sym-out').textContent = mo.symbol;
    $('s-pair').textContent = side === 'buy' ? `${mi.symbol} / ${mo.symbol}` : `${mo.symbol} / ${mi.symbol}`;
    $('s-model').textContent = val('model');
    loadBalance();
    const routes = await AmmoraRouteClient.create({
      chainId: route.chainId, rpcUrls, routeCatalog, deploymentCatalog, factoryProfiles,
      pools: [{ model: val('model'), pool: val('pool') }],
      verificationBlock: await resolveAmmoraFinalizedHead([client], route.finality),
    });
    const quote = await routes.quoteExactIn({ tokenIn: inT, tokenOut: outT, amountIn: parseUnits(amtText, mi.decimals), recipient: account ?? DEAD, slippageBps: Number($('slip').value) });
    const big = Object.entries(quote).filter(([, v]) => typeof v === 'bigint');
    const min = big.find(([k]) => /min/i.test(k));
    const est = big.find(([k]) => /out/i.test(k) && !/min/i.test(k));
    const f = (e) => (e ? `${Number(formatUnits(e[1], mo.decimals)).toLocaleString(undefined, { maximumFractionDigits: 6 })}` : '–');
    $('est').textContent = f(est);
    $('minr').textContent = min ? `${f(min)} ${mo.symbol}` : '–';
    $('raw').textContent = json(quote); $('rawcard').classList.remove('hide');
  } catch (e) { $('est').textContent = '0'; msg.textContent = String(e?.shortMessage ?? e?.message ?? e).slice(0, 200); }
}

// ---- explore ----
$('load').onclick = async () => {
  const box = $('launches'); box.textContent = 'Loading…';
  try {
    const res = await new AmmoraDataApiClient('https://ammora-giwa-sepolia-data.fly.dev').getLaunches({ chainId: 91_342n });
    const items = Array.isArray(res) ? res : res?.launches ?? res?.items ?? res?.data ?? [];
    if (!items.length) { box.innerHTML = `<pre>${json(res)}</pre>`; return; }
    box.innerHTML = items.slice(0, 30).map((it, n) => {
      const addrs = [...new Set(json(it).match(/0x[a-fA-F0-9]{40}/g) ?? [])];
      return `<div style="margin-top:.9rem"><b>${it.name ?? it.symbol ?? 'Launch ' + (n + 1)}</b><br>${addrs.map((a) => `<span class="chip" data-a="${a}">${short(a)}</span>`).join('')}</div>`;
    }).join('');
    box.querySelectorAll('.chip').forEach((c) => (c.onclick = () => { last.value = c.dataset.a; last.dispatchEvent(new Event('input')); }));
  } catch (e) { box.innerHTML = `<div class="err">${String(e?.message ?? e)}</div>`; }
};
paintWallet();
