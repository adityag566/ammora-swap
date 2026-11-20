import {
  AmmoraRouteClient, AmmoraDataApiClient, resolveAmmoraFinalizedHead,
  giwaSepoliaAutoRoute as route, giwaSepoliaAutoRouteCatalog as routeCatalog,
  giwaSepoliaAutoRouteDeploymentCatalog as deploymentCatalog,
  giwaSepoliaAutoRoutePoolProfiles as factoryProfiles,
} from '@ammora-protocol/sdk';
import { createPublicClient, http, isAddress, parseUnits, formatUnits, erc20Abi } from 'viem';

const $ = (id) => document.getElementById(id);
const DATA_API = 'https://ammora-giwa-sepolia-data.fly.dev';
const DEAD = '0x000000000000000000000000000000000000dEaD';
const rpcUrls = route.rpcUrls?.length ? route.rpcUrls : ['https://sepolia-rpc.giwa.io'];
const client = createPublicClient({ transport: http(rpcUrls[0]) });
const json = (o) => JSON.stringify(o, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
let last = $('pool');
document.querySelectorAll('input').forEach((i) => i.addEventListener('focus', () => (last = i)));

async function meta(address) {
  try {
    const [d, s] = await Promise.all(['decimals', 'symbol'].map((functionName) => client.readContract({ address, abi: erc20Abi, functionName })));
    return { decimals: Number(d), symbol: s };
  } catch { return { decimals: 18, symbol: '?' }; }
}
const panel = (html) => { const o = $('out'); o.style.display = 'block'; o.innerHTML = html; };

$('go').onclick = async () => {
  try {
    const [pool, tokenIn, tokenOut] = ['pool', 'tin', 'tout'].map((id) => $(id).value.trim());
    if (![pool, tokenIn, tokenOut].every(isAddress)) throw new Error('Pool, token in and token out must be valid 0x addresses.');
    panel('Fetching quote…');
    const [mi, mo] = await Promise.all([meta(tokenIn), meta(tokenOut)]);
    const amountIn = parseUnits($('amt').value.trim(), mi.decimals);
    const routes = await AmmoraRouteClient.create({
      chainId: route.chainId, rpcUrls, routeCatalog, deploymentCatalog, factoryProfiles,
      pools: [{ model: $('model').value, pool }],
      verificationBlock: await resolveAmmoraFinalizedHead([client], route.finality),
    });
    const quote = await routes.quoteExactIn({ tokenIn, tokenOut, amountIn, recipient: DEAD, slippageBps: Number($('slip').value) });
    const outs = Object.entries(quote).filter(([k, v]) => typeof v === 'bigint' && /out/i.test(k))
      .map(([k, v]) => `<div class="note">${k}</div><div class="big">${formatUnits(v, mo.decimals)} ${mo.symbol}</div>`).join('');
    panel(`<div class="note">${$('amt').value} ${mi.symbol} →</div>${outs}<label>Raw quote</label><pre>${json(quote)}</pre>`);
  } catch (e) { panel(`<div class="err">${String(e?.shortMessage ?? e?.message ?? e)}</div>`); }
};

$('load').onclick = async () => {
  const box = $('launches'); box.textContent = 'Loading…';
  try {
    const res = await new AmmoraDataApiClient(DATA_API).getLaunches({ chainId: 91_342n });
    const items = Array.isArray(res) ? res : res?.launches ?? res?.items ?? res?.data ?? [];
    if (!items.length) { box.innerHTML = `<pre>${json(res)}</pre>`; return; }
    box.innerHTML = items.slice(0, 30).map((it, n) => {
      const addrs = [...new Set(json(it).match(/0x[a-fA-F0-9]{40}/g) ?? [])];
      return `<div style="margin-top:.8rem"><b>${it.name ?? it.symbol ?? 'Launch ' + (n + 1)}</b><br>${addrs.map((a) => `<span class="chip" data-a="${a}">${a.slice(0, 8)}…${a.slice(-6)}</span>`).join('')}</div>`;
    }).join('');
    box.querySelectorAll('.chip').forEach((c) => (c.onclick = () => (last.value = c.dataset.a)));
  } catch (e) { box.innerHTML = `<div class="err">${String(e?.message ?? e)}</div>`; }
};
