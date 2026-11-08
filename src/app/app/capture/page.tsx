import Link from "next/link";
import { ActionButton } from "@/components/ActionButton";
import { PairingCode } from "@/components/capture/PairingCode";
import { Badge, EmptyState, IntegrationNotice, PageHeader, RECORDING_STATUS, formatBytes, formatDate } from "@/components/ui";
import { requirePageUser } from "@/server/auth/page";
import { prisma } from "@/server/db";
import { listDevices } from "@/server/devices";

export const metadata = { title: "Capture PC" };
export const dynamic = "force-dynamic";

const STATE: Record<string, { label: string; tone: "ok" | "info" | "warn" | "bad" | "neutral" }> = {
  idle: { label: "Prêt", tone: "ok" },
  waiting_game: { label: "En attente d'une partie", tone: "ok" },
  recording: { label: "Enregistrement en cours", tone: "info" },
  processing: { label: "Finalisation", tone: "info" },
  uploading: { label: "Envoi en cours", tone: "info" },
  error: { label: "Erreur", tone: "bad" },
};

type Status = { state?: string; message?: string; queue?: number; diskUsedBytes?: number; diskLimitBytes?: number; captureBackend?: string; at?: string };

export default async function CapturePage() {
  const user = await requirePageUser();
  const [devices, recordings] = await Promise.all([
    listDevices(user.id),
    prisma.recording.findMany({ where: { ownerId: user.id, source: "DESKTOP_CAPTURE" }, orderBy: { createdAt: "desc" }, take: 10, include: { device: { select: { name: true } } } }),
  ]);
  const active = devices.filter((d) => !d.revokedAt);
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="Application PC de capture" subtitle="Enregistre automatiquement la fenêtre du jeu pendant vos parties et envoie la vidéo après le match." />

      <IntegrationNotice title="Version expérimentale — capture Windows non encore validée sur un vrai PC">
        L&apos;agent a été testé avec une source vidéo de test ; la capture de la fenêtre du jeu (Windows) doit être confirmée sur votre PC
        avec le <strong>test d&apos;enregistrement</strong> intégré. Il n&apos;existe pas encore d&apos;installeur signé : l&apos;agent se lance en ligne de commande.
      </IntegrationNotice>

      <section className="card space-y-3">
        <h2 className="h2">1 · Installer l&apos;agent</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>Installez <strong>Node.js 20+</strong> et <strong>FFmpeg</strong> (ffmpeg.exe dans le PATH).</li>
          <li>Récupérez le dossier CoachGG, puis dans un terminal : <code className="rounded bg-panel-2 px-1">npm install</code>.</li>
          <li>Lancez <code className="rounded bg-panel-2 px-1">npm run agent -- start</code> : l&apos;adresse de l&apos;interface locale s&apos;affiche.</li>
          <li>Dans le jeu, choisissez le mode d&apos;affichage <strong>Fenêtré sans bordure</strong>, puis lancez « Tester l&apos;enregistrement ».</li>
        </ol>
      </section>

      <section className="card space-y-3">
        <h2 className="h2">2 · Appairer ce PC à votre compte</h2>
        <p className="text-sm text-muted">Saisissez le code dans l&apos;interface locale de l&apos;agent (ou <code>npm run agent -- pair CODE --server {"<adresse>"}</code>).</p>
        <PairingCode />
      </section>

      <section className="card space-y-3">
        <h2 className="h2">Appareils ({active.length})</h2>
        {devices.length === 0 ? (
          <p className="text-sm text-muted">Aucun PC appairé.</p>
        ) : (
          <ul className="divide-y divide-line text-sm" data-testid="device-list">
            {devices.map((d) => {
              const s = (d.status ?? {}) as Status;
              const online = !d.revokedAt && d.lastSeenAt && Date.now() - d.lastSeenAt.getTime() < 2 * 60_000;
              const st = s.state ? STATE[s.state] : null;
              return (
                <li key={d.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div>
                    <p className="font-medium">
                      {d.name} <span className="text-xs text-muted">· {d.platform} · v{d.appVersion}</span>
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                      {d.revokedAt ? (
                        <Badge tone="neutral">Révoqué le {formatDate(d.revokedAt)}</Badge>
                      ) : online ? (
                        <>
                          <Badge tone="ok">En ligne</Badge>
                          {st && <Badge tone={st.tone}>{st.label}</Badge>}
                        </>
                      ) : (
                        <Badge tone="warn">Hors ligne{d.lastSeenAt ? ` — vu le ${formatDate(d.lastSeenAt)}` : ""}</Badge>
                      )}
                      {!d.revokedAt && s.diskLimitBytes ? <span>Disque {formatBytes(s.diskUsedBytes ?? 0)} / {formatBytes(s.diskLimitBytes)}</span> : null}
                      {!d.revokedAt && s.queue ? <span>· {s.queue} envoi(s) en attente</span> : null}
                      {!d.revokedAt && s.captureBackend ? <span>· capture : {s.captureBackend}</span> : null}
                    </p>
                    {!d.revokedAt && s.state === "error" && s.message && <p className="mt-1 text-xs text-loss">{s.message}</p>}
                  </div>
                  {!d.revokedAt && (
                    <ActionButton url={`/api/devices/${d.id}`} method="DELETE" label="Révoquer" className="btn-danger px-2.5 py-1 text-xs"
                      confirmText={`Révoquer « ${d.name} » ? Il ne pourra plus envoyer de vidéos.`} />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card space-y-3">
        <h2 className="h2">Dernières parties enregistrées</h2>
        {recordings.length === 0 ? (
          <EmptyState title="Aucune vidéo reçue d'un PC" text="Après votre prochaine partie, la vidéo apparaîtra ici et dans votre bibliothèque." />
        ) : (
          <ul className="divide-y divide-line text-sm">
            {recordings.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2">
                <Link className="hover:underline" href={`/app/videos/${r.id}`}>{r.title}</Link>
                <span className="flex items-center gap-2 text-xs text-muted">
                  {r.device?.name ?? "PC révoqué"} · {r.gameStartOffsetMs != null ? "synchronisée" : "non synchronisée"}
                  <Badge tone={RECORDING_STATUS[r.status]!.tone}>{RECORDING_STATUS[r.status]!.label}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card space-y-2 text-sm">
        <h2 className="h2">Ce que fait — et ne fait pas — l&apos;agent</h2>
        <ul className="list-disc space-y-1 pl-5 text-muted">
          <li>Capture la <strong>seule fenêtre du jeu</strong> (FFmpeg gdigrab). Pas de son, pas de micro, pas de webcam.</li>
          <li>Détecte le début et la fin de partie via l&apos;API locale du client, en lecture seule. Il mémorise les événements (morts, éliminations, objectifs) pour les exploiter <strong>après</strong> le match : synchronisation de la vidéo, découpage, mesure de précision.</li>
          <li>Aucun affichage ni conseil pendant la partie, aucune lecture mémoire, aucune interaction avec Vanguard.</li>
          <li>Stockage local limité (20 Go par défaut), nettoyage après envoi, reprise des envois et des enregistrements interrompus.</li>
        </ul>
      </section>
    </div>
  );
}
