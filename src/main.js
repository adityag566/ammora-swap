import {
  AmmoraRouteClient, resolveAmmoraFinalizedHead,
  giwaSepoliaAutoRoute as route, giwaSepoliaAutoRouteCatalog as routeCatalog,
  giwaSepoliaAutoRouteDeploymentCatalog as deploymentCatalog,
  giwaSepoliaAutoRoutePoolProfiles as factoryProfiles,
} from '@ammora-protocol/sdk';
import { createPublicClient, http, isAddress, parseUnits, formatUnits, erc20Abi } from 'viem';

const $ = (id) => document.getElementById(id);
const WETH = '0x4200000000000000000000000000000000000006';
const TAMM = '0x10B3Cc2fc981277Ada576891CF649D0ABA768B06';
const DEAD = '0x000000000000000000000000000000000000dEaD';
const CHAIN_HEX = '0x' + (91342).toString(16);
const rpcUrls = route.rpcUrls?.length ? route.rpcUrls : ['https://sepolia-rpc.giwa.io'];
const client = createPublicClient({ transport: http(rpcUrls[0]) });
const json = (o) => JSON.stringify(o, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
const short = (a) => a.slice(0, 6) + '…' + a.slice(-4);
const val = (id) => $(id).value.trim();
const eq = (a, b) => a.toLowerCase() === b.toLowerCase();
let account = null, side = 'buy', balance = 0n, inMeta = { decimals: 18, symbol: 'ETH' }, timer;

// ---- fixed ETH / tAMM pair ----
$('ta').value = WETH; $('tb').value = TAMM; $('model').value = 'compounding';
[$('ta'), $('tb')].forEach((el) => { el.style.display = 'none'; el.previousElementSibling.style.display = 'none'; });
document.querySelector('nav button[data-v="explore"]').style.display = 'none';
$('s-pair').textContent = 'ETH / tAMM'; $('sym-in').textContent = 'ETH'; $('sym-out').textContent = 'tAMM';
$('pool').placeholder = 'tAMM pool address (0x...)';

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
const pair = () => (side === 'buy' ? { inT: WETH, outT: TAMM } : { inT: TAMM, outT: WETH });
async function meta(address) {
  if (eq(address, WETH)) return { decimals: 18, symbol: 'ETH' };
  try {
    const [d, s] = await Promise.all(['decimals', 'symbol'].map((functionName) => client.readContract({ address, abi: erc20Abi, functionName })));
    return { decimals: Number(d), symbol: s };
  } catch { return { decimals: 6, symbol: 'tAMM' }; }
}
async function loadBalance() {
  const { inT } = pair();
  inMeta = await meta(inT);
  $('sym-in').textContent = inMeta.symbol;
  $('sym-out').textContent = side === 'buy' ? 'tAMM' : 'ETH';
  if (!account) { $('bal').textContent = 'Balance –'; balance = 0n; return; }
  try {
    balance = eq(inT, WETH) ? await client.getBalance({ address: account })
      : await client.readContract({ address: inT, abi: erc20Abi, functionName: 'balanceOf', args: [account] });
    $('bal').textContent = `Balance ${Number(formatUnits(balance, inMeta.decimals)).toFixed(4)} ${inMeta.symbol}`;
  } catch { $('bal').textContent = 'Balance –'; }
}
function setSide(s) {
  side = s;
  $('t-buy').classList.toggle('on', s === 'buy'); $('t-sell').classList.toggle('on', s === 'sell');
  $('est').textContent = '0'; $('minr').textContent = '–'; $('amt').value = '';
  loadBalance(); quoteSoon();
}
$('t-buy').onclick = () => setSide('buy'); $('t-sell').onclick = () => setSide('sell');
document.querySelectorAll('.chips button').forEach((b) => (b.onclick = () => {
  if (b.dataset.a === 'max') {
    const reserve = eq(pair().inT, WETH) ? 1_000_000_000_000_000n : 0n;
    $('amt').value = formatUnits(balance > reserve ? balance - reserve : 0n, inMeta.decimals);
  } else $('amt').value = b.dataset.a;
  quoteSoon();
}));
['amt', 'slip', 'model', 'pool'].forEach((id) => $(id).addEventListener('input', quoteSoon));
$('go').onclick = () => (account ? doQuote() : connect());

// ---- quote ----
function quoteSoon() { clearTimeout(timer); timer = setTimeout(doQuote, 600); }
async function doQuote() {
  const msg = $('msg'); msg.textContent = '';
  if (!isAddress(val('pool'))) { msg.textContent = 'Enter the tAMM pool address to get a quote.'; return; }
  const amtText = val('amt');
  if (!amtText || Number(amtText) <= 0) return;
  const { inT, outT } = pair();
  try {
    $('est').textContent = '…';
    const [mi, mo] = await Promise.all([meta(inT), meta(outT)]);
    const routes = await AmmoraRouteClient.create({
      chainId: route.chainId, rpcUrls, routeCatalog, deploymentCatalog, factoryProfiles,
      pools: [{ model: val('model'), pool: val('pool') }],
      verificationBlock: await resolveAmmoraFinalizedHead([client], route.finality),
    });
    const quote = await routes.quoteExactIn({ tokenIn: inT, tokenOut: outT, amountIn: parseUnits(amtText, mi.decimals), recipient: account ?? DEAD, slippageBps: Number($('slip').value) });
    const big = Object.entries(quote).filter(([, v]) => typeof v === 'bigint');
    const min = big.find(([k]) => /min/i.test(k));
    const est = big.find(([k]) => /out/i.test(k) && !/min/i.test(k));
    const f = (e) => (e ? Number(formatUnits(e[1], mo.decimals)).toLocaleString(undefined, { maximumFractionDigits: 6 }) : '–');
    $('est').textContent = f(est);
    $('minr').textContent = min ? `${f(min)} ${mo.symbol}` : '–';
    $('raw').textContent = json(quote); $('rawcard').classList.remove('hide');
  } catch (e) { $('est').textContent = '0'; msg.textContent = String(e?.shortMessage ?? e?.message ?? e).slice(0, 220); }
}
paintWallet();
