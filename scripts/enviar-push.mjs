process.on('unhandledRejection', e => { console.log('::error::' + (e && e.stack || e)); process.exit(1); });
// Manda o "toque" de notificação pra cada aparelho inscrito em Firestore push/{id}.
// O texto é montado no próprio aparelho (sw.js) com os números de lá.
import { readFileSync } from 'node:fs';
import webpush from 'web-push';

// ::error:: / ::notice:: viram anotações no GitHub (dá pra ler pela API, sem abrir o log)
const erro = m => { console.log('::error::' + String(m).replace(/\r?\n/g, ' ').slice(0, 900)); process.exit(1); };

const tipo = process.env.TIPO === 'noite' ? 'noite' : 'manha';
const privada = process.env.VAPID_PRIVATE;
if (!privada) {
  erro('Falta o secret VAPID_PRIVATE (Settings → Secrets and variables → Actions).');
}

// chave pública e config do Firebase saem do próprio app, pra não duplicar
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const publica = html.match(/const VAPID_PUBLIC='([^']+)'/)[1];
const apiKey = html.match(/apiKey:"([^"]+)"/)[1];
const projectId = html.match(/projectId:"([^"]+)"/)[1];

try { webpush.setVapidDetails('https://castrox-dev.github.io/financas-casal/', publica, privada.trim()); } catch (e) { erro('Chave VAPID inválida: ' + e.message); }

const login = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"returnSecureToken":true}',
}).then(r => r.json());
if (!login.idToken) erro('Login anônimo falhou: ' + JSON.stringify(login));
const auth = { Authorization: 'Bearer ' + login.idToken };
const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

const docs = [];
let pageToken = '';
do {
  const r = await fetch(`${base}/push?pageSize=300${pageToken ? '&pageToken=' + pageToken : ''}`, { headers: auth });
  if (!r.ok) erro('Não consegui ler push/ no Firestore: ' + r.status + ' ' + (await r.text()));
  const j = await r.json();
  docs.push(...(j.documents || []));
  pageToken = j.nextPageToken || '';
} while (pageToken);

let enviados = 0, pulados = 0, removidos = 0, falhas = 0;
for (const d of docs) {
  const f = d.fields || {};
  if (f[tipo] && f[tipo].booleanValue === false) { pulados++; continue; }
  let sub;
  try { sub = JSON.parse(f.sub.stringValue); } catch { falhas++; continue; }
  try {
    await webpush.sendNotification(sub, JSON.stringify({ tipo }), { TTL: 6 * 3600, urgency: 'normal' });
    enviados++;
  } catch (e) {
    if (e.statusCode === 404 || e.statusCode === 410) {
      // aparelho desinstalou ou revogou: limpa a inscrição
      await fetch(`https://firestore.googleapis.com/v1/${d.name}`, { method: 'DELETE', headers: auth });
      removidos++;
    } else {
      console.log('::warning::Falha ao enviar: ' + e.statusCode + ' ' + String(e.body).slice(0, 300));
      falhas++;
    }
  }
}
console.log(`::notice::tipo=${tipo} aparelhos=${docs.length} enviados=${enviados} desligados=${pulados} removidos=${removidos} falhas=${falhas}`);
