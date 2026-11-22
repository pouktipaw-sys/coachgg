// Envoi d'emails.
// • SMTP_URL défini (ex. smtps://user:pass@smtp.example.com:465) → envoi réel via SMTP.
// • Sinon, en développement/test : le message est écrit dans les logs serveur (pilote « console »)
//   et conservé dans une boîte d'envoi en mémoire (tests).
// • Sinon, en production : aucun envoi, avertissement dans les logs.
import type { Transporter } from "nodemailer";
import { env } from "@/lib/env";

export type MailMessage = { to: string; subject: string; text: string };
export type MailResult = { delivered: boolean; driver: "smtp" | "console" | "none"; error?: string; detail?: string };

/** Raison lisible d'un refus SMTP (jamais le mot de passe : seuls le code et la réponse du serveur). */
export function smtpErrorHint(e: unknown): string {
  const err = e as { code?: string; responseCode?: number; response?: string; message?: string };
  const resp = (err.response ?? err.message ?? "").replace(/smtps?:\/\/[^\s]+/g, "[SMTP_URL]").slice(0, 200);
  if (err.responseCode === 535 || err.code === "EAUTH")
    return `identifiants refusés (${err.responseCode ?? err.code}). Avec Gmail : la validation en deux étapes doit être activée, le mot de passe d'application doit venir du MÊME compte que l'adresse de SMTP_URL, et il s'écrit sans espaces.`;
  if (err.code === "ECONNECTION" || err.code === "ETIMEDOUT" || err.code === "ESOCKET")
    return `connexion impossible au serveur (${err.code}) : vérifie l'hôte et le port (smtp.gmail.com:465), ou un pare-feu / antivirus.`;
  if (err.code === "EENVELOPE" || err.responseCode === 553 || err.responseCode === 550)
    return `adresse refusée (${err.responseCode ?? err.code}) : MAIL_FROM doit être la même adresse que celle de SMTP_URL.`;
  return `${err.code ?? "erreur"}${err.responseCode ? ` ${err.responseCode}` : ""} : ${resp}`;
}

/** Derniers messages du pilote console (développement et tests uniquement). */
export const devOutbox: MailMessage[] = [];

let transporter: Promise<Transporter> | null = null;
let transporterUrl: string | null = null;

async function smtp(url: string) {
  if (!transporter || transporterUrl !== url) {
    transporterUrl = url;
    transporter = import("nodemailer").then((m) => m.createTransport(url));
  }
  return transporter;
}

export function mailerDriver(): MailResult["driver"] {
  if (env.smtpUrl) return "smtp";
  return env.isProd ? "none" : "console";
}

export async function sendMail(msg: MailMessage): Promise<MailResult> {
  const driver = mailerDriver();
  if (driver === "smtp") {
    try {
      const t = await smtp(env.smtpUrl!);
      await t.sendMail({ from: env.mailFrom, to: msg.to, subject: msg.subject, text: msg.text });
      return { delivered: true, driver };
    } catch (e) {
      // L'échec d'envoi ne doit pas faire échouer l'action (invitation, réinitialisation…).
      console.error("[mailer] échec SMTP :", e instanceof Error ? e.message : e);
      return { delivered: false, driver, error: "smtp_failed", detail: smtpErrorHint(e) };
    }
  }
  if (driver === "console") {
    devOutbox.push(msg);
    if (devOutbox.length > 50) devOutbox.shift();
    if (process.env.NODE_ENV !== "test") console.log(`[mailer:console — DEV UNIQUEMENT] À: ${msg.to} | ${msg.subject}\n${msg.text}`);
    return { delivered: false, driver };
  }
  console.warn("[mailer] aucun fournisseur email configuré (SMTP_URL) : message non envoyé.");
  return { delivered: false, driver };
}
