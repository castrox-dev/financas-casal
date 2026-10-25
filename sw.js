const CACHE = 'financas-v31';
const ESTADO = 'financas-estado'; // escrito pelo app; o push lê daqui
const FILES = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png', './icon-180.png', './fonts/bricolage.woff2'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== ESTADO).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(r => {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return r;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});

/* ---------- notificações ----------
   O servidor só manda {tipo:'manha'|'noite'}. O texto sai do estado que o
   app salvou da última vez que foi aberto (gasto de hoje, quanto dá pra
   gastar por dia, faturas vencendo). No iPhone todo push precisa mostrar
   uma notificação, então sempre tem uma mensagem. */
const BRL = v => 'R$ ' + (Math.round(v * 100) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function hojeStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
async function lerEstado() {
  try {
    const c = await caches.open(ESTADO);
    const r = await c.match('./estado.json');
    return r ? await r.json() : null;
  } catch (e) { return null; }
}
function diasAte(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const h = new Date(); h.setHours(0, 0, 0, 0);
  return Math.round((new Date(y, m - 1, d) - h) / 864e5);
}
function montar(tipo, est) {
  const hoje = hojeStr();
  if (tipo === 'noite') {
    if (est && est.hoje === hoje && est.lancouHoje)
      return { title: 'Dia anotado ✓', body: `Hoje você lançou ${BRL(est.gastoHoje)}. Algo mais que esqueceu?` };
    return { title: 'Gastou algo hoje?', body: 'Lança no app agora, leva 3 segundos. Se não gastou nada, melhor ainda.' };
  }
  // manhã
  const fat = ((est && est.faturas) || []).map(f => ({ ...f, dias: diasAte(f.vence) })).filter(f => f.dias >= 0 && f.dias <= 5).sort((a, b) => a.dias - b.dias)[0];
  if (fat) {
    const q = fat.dias === 0 ? 'vence hoje' : fat.dias === 1 ? 'vence amanhã' : `vence em ${fat.dias} dias`;
    return { title: `Fatura do ${fat.nome} ${q}`, body: `${BRL(fat.total)}. Paga o valor inteiro pra não cair no rotativo.` };
  }
  if (est && est.alerta) return { title: 'Atenção no orçamento', body: est.alerta };
  if (est && est.porDia > 0) return { title: 'Bom dia!', body: `Hoje dá pra gastar até ${BRL(est.porDia)} sem sair do plano.` };
  if (est && est.porDia <= 0) return { title: 'Bom dia!', body: 'O orçamento do mês já foi. Hoje, só o essencial.' };
  return { title: 'Bom dia!', body: 'Abre o app pra ver quanto dá pra gastar hoje.' };
}
self.addEventListener('push', e => {
  let tipo = 'manha';
  try { tipo = (e.data && e.data.json().tipo) || 'manha'; } catch (err) {}
  e.waitUntil(lerEstado().then(est => {
    const n = montar(tipo, est);
    return self.registration.showNotification(n.title, { body: n.body, icon: 'icon-192.png', badge: 'icon-192.png', tag: 'financas-' + tipo, data: { url: './' } });
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    const c = cs.find(x => 'focus' in x);
    return c ? c.focus() : self.clients.openWindow((e.notification.data && e.notification.data.url) || './');
  }));
});
