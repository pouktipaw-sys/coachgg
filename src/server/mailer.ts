// Envoi d'emails.
// • SMTP_URL défini (ex. smtps://user:pass@smtp.example.com:465) → envoi réel via SMTP.
// • Sinon, en développement/test : le message est écrit dans les logs serveur (pilote « console »)
//   et conservé dans une boîte d'envoi en mémoire (tests).
// • Sinon, en production : aucun envoi, avertissement dans les logs.
import type { Transporter } from "nodemailer";
import { env } from "@/lib/env";

export type MailMessage = { to: string; subject: string; text: string };
export type MailResult = { delivered: boolean; driver: "smtp" | "console" | "none"; error?: string };

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
      return { delivered: false, driver, error: "smtp_failed" };
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
