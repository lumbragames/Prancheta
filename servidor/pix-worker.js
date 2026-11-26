// Servidor de pagamento do Prancheta (Cloudflare Worker + Mercado Pago Pix).
// Configuração: no Cloudflare, crie um Worker, cole este código e adicione a variável secreta MP_TOKEN
// com o "Access Token" de produção do Mercado Pago (Configurações → Variáveis e segredos).
// Rotas: GET /ping · POST /pix {pack, uid} · GET /status?id=...

const PACKS = {
  p100: { brl: 4.9, pf: 100, t: '100 Pranfixas' },
  p330: { brl: 12.9, pf: 330, t: '330 Pranfixas' },
  p800: { brl: 24.9, pf: 800, t: '800 Pranfixas' },
  p1900: { brl: 49.9, pf: 1900, t: '1900 Pranfixas' },
  vip30: { brl: 9.9, vip: 30, t: 'Sócio Prancheta 30 dias' },
};
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(req.url); const MP = 'https://api.mercadopago.com/v1/payments';
    const auth = { Authorization: 'Bearer ' + (env.MP_TOKEN || '') };
    try {
      if (url.pathname === '/ping') return J({ ok: true, token: !!env.MP_TOKEN });
      if (url.pathname === '/pix' && req.method === 'POST') {
        if (!env.MP_TOKEN) return J({ error: 'servidor sem MP_TOKEN' }, 500);
        const b = await req.json().catch(() => ({})); const pk = PACKS[b.pack];
        if (!pk) return J({ error: 'pacote inválido' }, 400);
        const uid = String(b.uid || 'anon').replace(/[^\w-]/g, '').slice(0, 40) || 'anon';
        const exp = new Date(Date.now() + 30 * 60e3).toISOString().replace('Z', '-00:00');
        const r = await fetch(MP, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify({ transaction_amount: pk.brl, description: 'Prancheta - ' + pk.t, payment_method_id: 'pix', date_of_expiration: exp,
            external_reference: `${b.pack}|${uid}`, payer: { email: `jogador.${uid.slice(0, 12).toLowerCase()}@lumbragames.com` } }) });
        const p = await r.json();
        if (!r.ok || !p.id) return J({ error: (p.message || 'erro no Mercado Pago').slice(0, 120) }, 502);
        const td = p.point_of_interaction?.transaction_data || {};
        return J({ id: String(p.id), qr: td.qr_code || '', b64: td.qr_code_base64 || '', exp, brl: pk.brl });
      }
      if (url.pathname === '/status') {
        const id = String(url.searchParams.get('id') || '').replace(/\D/g, ''); if (!id) return J({ error: 'id' }, 400);
        const r = await fetch(`${MP}/${id}`, { headers: auth }); const p = await r.json();
        if (!r.ok) return J({ status: 'unknown' });
        const [pack] = String(p.external_reference || '').split('|'); const pk = PACKS[pack];
        // só entrega se o valor pago bate com o pacote
        if (p.status === 'approved' && pk && Math.abs((p.transaction_amount || 0) - pk.brl) < 0.01) return J({ status: 'approved', pack, pf: pk.pf || 0, vip: pk.vip || 0, brl: pk.brl });
        return J({ status: p.status || 'pending' });
      }
      return J({ error: 'rota' }, 404);
    } catch (e) { return J({ error: String(e.message || e).slice(0, 120) }, 500); }
  },
};
