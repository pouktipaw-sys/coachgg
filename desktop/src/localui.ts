// Interface locale de l'agent : http://127.0.0.1:47800/?t=<jeton>
// • Écoute uniquement sur 127.0.0.1.
// • Vérifie l'en-tête Host (anti « DNS rebinding ») et exige un jeton aléatoire par
//   lancement pour toute action (un site web tiers ne peut ni le lire ni le deviner).
import { randomBytes, timingSafeEqual } from "node:crypto";
import http from "node:http";
import os from "node:os";
import { CoachApi } from "./api";
import { AGENT_VERSION, configSchema, saveConfig, type AgentConfig } from "./config";
import type { Agent } from "./agent";
import { testRecording } from "./diagnostics";

export function startLocalUi(agent: Agent, opts: { port?: number; home?: string } = {}) {
  const port = opts.port ?? 47800;
  const token = randomBytes(18).toString("base64url");
  const okToken = (t: string | null) => !!t && t.length === token.length && timingSafeEqual(Buffer.from(t), Buffer.from(token));

  const server = http.createServer(async (req, res) => {
    const host = req.headers.host ?? "";
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      res.writeHead(421).end();
      return;
    }
    const url = new URL(req.url ?? "/", `http://${host}`);
    const send = (code: number, body: unknown, type = "application/json") => {
      res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store", "X-Frame-Options": "DENY" });
      res.end(typeof body === "string" ? body : JSON.stringify(body));
    };
    try {
      if (req.method === "GET" && url.pathname === "/") {
        if (!okToken(url.searchParams.get("t"))) return send(403, "Ouvrez l'adresse affichée dans la console de l'agent.", "text/plain; charset=utf-8");
        return send(200, page(token), "text/html; charset=utf-8");
      }
      if (!okToken(req.headers["x-coachgg-token"] as string | null)) return send(403, { message: "Jeton manquant." });
      const body = req.method === "POST" ? await readBody(req) : null;
      if (req.method === "GET" && url.pathname === "/api/status") {
        const { deviceToken, ...cfg } = agent.cfg;
        return send(200, { status: agent.status(), paired: !!deviceToken, config: cfg, queue: agent.queue.items.slice(-20) });
      }
      if (req.method === "POST" && url.pathname === "/api/pair") {
        const { code, serverUrl } = body as { code: string; serverUrl?: string };
        const server = serverUrl || agent.cfg.serverUrl;
        const r = await new CoachApi(server, null).pair(code, agent.cfg.deviceName || os.hostname(), process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux", AGENT_VERSION);
        agent.cfg = configSchema.parse({ ...agent.cfg, serverUrl: server, deviceToken: r.token });
        saveConfig(agent.cfg, opts.home);
        return send(200, { ok: true, device: r.device });
      }
      if (req.method === "POST" && url.pathname === "/api/config") {
        const patch = body as Partial<AgentConfig>;
        agent.cfg = configSchema.parse({ ...agent.cfg, ...patch, deviceToken: agent.cfg.deviceToken });
        saveConfig(agent.cfg, opts.home);
        return send(200, { ok: true });
      }
      if (req.method === "POST" && url.pathname === "/api/test") return send(200, await testRecording(agent.cfg));
      if (req.method === "POST" && url.pathname === "/api/retry") {
        agent.queue.retryFailed();
        return send(200, { ok: true });
      }
      if (req.method === "POST" && url.pathname === "/api/unpair") {
        agent.cfg = configSchema.parse({ ...agent.cfg, deviceToken: null });
        saveConfig(agent.cfg, opts.home);
        return send(200, { ok: true });
      }
      return send(404, { message: "Introuvable." });
    } catch (e) {
      return send(400, { message: e instanceof Error ? e.message : String(e) });
    }
  });
  server.listen(port, "127.0.0.1");
  return { server, url: `http://127.0.0.1:${port}/?t=${token}`, token, port };
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let b = "";
    req.on("data", (d) => {
      b += d;
      if (b.length > 100_000) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(b ? JSON.parse(b) : {});
      } catch {
        reject(new Error("JSON invalide"));
      }
    });
  });
}

function page(token: string) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CoachGG — agent PC</title>
<style>
body{font-family:system-ui,sans-serif;background:#0a0d14;color:#e6e9ef;margin:0;padding:24px;max-width:760px}
h1{font-size:22px}h2{font-size:16px;margin-top:28px}section{background:#111622;border:1px solid #232b3b;border-radius:12px;padding:16px;margin:12px 0}
input,select{background:#171d2b;color:#e6e9ef;border:1px solid #232b3b;border-radius:8px;padding:8px;width:100%;box-sizing:border-box}
button{background:#4c9dff;color:#fff;border:0;border-radius:8px;padding:8px 14px;cursor:pointer;margin-top:8px}button.ghost{background:#171d2b;border:1px solid #232b3b}
.muted{color:#8b95a8;font-size:13px}.ok{color:#34d399}.bad{color:#f87171}label{display:block;font-size:12px;color:#8b95a8;margin:8px 0 4px}
table{width:100%;font-size:13px;border-collapse:collapse}td{padding:4px;border-top:1px solid #232b3b}
</style></head><body>
<h1>CoachGG — agent PC <span class="muted">v${AGENT_VERSION}</span></h1>
<p class="muted">Enregistre automatiquement la fenêtre du jeu pendant vos parties, puis envoie la vidéo après le match. Aucun micro, aucune webcam, aucun conseil pendant la partie, aucune lecture mémoire.</p>
<section><h2 style="margin-top:0">État</h2><div id="status">…</div></section>
<section id="pairing"><h2 style="margin-top:0">Appairage</h2>
<p class="muted">Sur le site CoachGG : Capture PC → « Générer un code ». Saisissez-le ici.</p>
<label>Serveur</label><input id="server"><label>Code d'appairage</label><input id="code" placeholder="ABCD-EFGH">
<button onclick="pair()">Appairer ce PC</button> <button class="ghost" onclick="post('/api/unpair').then(load)">Dissocier</button><div id="pairMsg" class="muted"></div></section>
<section><h2 style="margin-top:0">Capture</h2>
<label>Titre de la fenêtre du jeu</label><input id="title">
<label>Images par seconde</label><select id="fps"><option>30</option><option>60</option></select>
<label>Hauteur maximale</label><select id="height"><option>720</option><option>1080</option><option>1440</option></select>
<label>Encodeur</label><select id="encoder"><option value="libx264">Processeur (libx264)</option><option value="h264_nvenc">NVIDIA (NVENC)</option><option value="h264_amf">AMD (AMF)</option><option value="h264_qsv">Intel (Quick Sync)</option></select>
<label>Envoi</label><select id="mode"><option value="full">Partie entière</option><option value="clips">Séquences autour de mes événements (morts, éliminations, objectifs)</option></select>
<label>Limite d'espace disque (Go)</label><input id="disk" type="number" min="1">
<label><input id="del" type="checkbox" style="width:auto"> Supprimer la vidéo locale après envoi</label>
<p class="muted">Micro et webcam : désactivés (non disponibles dans cette version). Son du jeu : non capturé.</p>
<button onclick="save()">Enregistrer</button> <button class="ghost" onclick="test()">Tester l'enregistrement (4 s)</button><div id="testMsg"></div></section>
<section><h2 style="margin-top:0">File d'envoi</h2><div id="queue"></div><button class="ghost" onclick="post('/api/retry').then(load)">Réessayer les envois en échec</button></section>
<script>
const T=${JSON.stringify(token)};
const H={'X-CoachGG-Token':T,'Content-Type':'application/json'};
const get=p=>fetch(p,{headers:H}).then(r=>r.json());
const post=(p,b)=>fetch(p,{method:'POST',headers:H,body:JSON.stringify(b||{})}).then(async r=>{const j=await r.json();if(!r.ok)throw new Error(j.message);return j});
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
async function load(){const d=await get('/api/status');const s=d.status;
const L={idle:'Prêt',waiting_game:'En attente d\\'une partie',recording:'Enregistrement en cours',processing:'Finalisation',uploading:'Envoi en cours',error:'Erreur'};const G=1073741824;
document.getElementById('status').innerHTML='<b class="'+(s.state==='error'?'bad':'')+'">'+esc(L[s.state]||s.state)+'</b> — '+esc(s.message)+'<br><span class="muted">Appairé : '+(d.paired?'<span class=ok>oui</span>':'<span class=bad>non</span>')+' · capture : '+esc(s.captureBackend)+' · disque : '+(s.diskUsedBytes/G).toFixed(2)+' / '+(s.diskLimitBytes/G).toFixed(0)+' Go · en attente : '+s.queue+'</span>';
const c=d.config;server.value=c.serverUrl;title.value=c.capture.windowTitle;fps.value=c.capture.fps;height.value=c.capture.maxHeight;encoder.value=c.capture.encoder;mode.value=c.upload.mode;disk.value=Math.round(c.storage.maxDiskBytes/1073741824);del.checked=c.storage.deleteAfterUpload;
document.getElementById('queue').innerHTML=d.queue.length?'<table>'+d.queue.slice().reverse().map(i=>'<tr><td>'+esc(i.title)+'</td><td>'+esc(i.status)+'</td><td class=muted>'+esc(i.lastError||'')+'</td></tr>').join('')+'</table>':'<p class=muted>Vide.</p>';}
async function pair(){try{const r=await post('/api/pair',{code:code.value,serverUrl:server.value});pairMsg.textContent='Appairé : '+r.device.name;load()}catch(e){pairMsg.textContent=e.message}}
async function save(){await post('/api/config',{capture:{...(await get('/api/status')).config.capture,windowTitle:title.value,fps:+fps.value,maxHeight:+height.value,encoder:encoder.value},upload:{...(await get('/api/status')).config.upload,mode:mode.value},storage:{maxDiskBytes:Math.round(+disk.value*1073741824),deleteAfterUpload:del.checked}});load()}
async function test(){testMsg.textContent='Test en cours…';try{const r=await post('/api/test');testMsg.innerHTML='<span class="'+(r.ok?'ok':'bad')+'">'+esc(r.message)+'</span>'}catch(e){testMsg.textContent=e.message}}
load();setInterval(load,3000);
</script></body></html>`;
}
