// Envoi SMTP réel vers un serveur SMTP minimal local (aucun service externe).
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { sendMail } from "@/server/mailer";

function fakeSmtp() {
  const received: { from: string; to: string[]; data: string }[] = [];
  const server = net.createServer((sock) => {
    let buf = "";
    let cur = { from: "", to: [] as string[], data: "" };
    let inData = false;
    sock.write("220 test ESMTP\r\n");
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let i;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            received.push(cur);
            cur = { from: "", to: [], data: "" };
            sock.write("250 OK\r\n");
          } else cur.data += line + "\n";
          continue;
        }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === "EHLO" || cmd === "HELO") sock.write("250 test\r\n");
        else if (cmd === "MAIL") (cur.from = line), sock.write("250 OK\r\n");
        else if (cmd === "RCPT") cur.to.push(line), sock.write("250 OK\r\n");
        else if (cmd === "DATA") (inData = true), sock.write("354 go\r\n");
        else if (cmd === "QUIT") sock.end("221 bye\r\n");
        else sock.write("250 OK\r\n");
      }
    });
  });
  return new Promise<{ port: number; received: typeof received; close: () => void }>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ port: (server.address() as net.AddressInfo).port, received, close: () => server.close() })),
  );
}

describe("mailer SMTP", () => {
  afterEach(() => {
    delete process.env.SMTP_URL;
    delete process.env.MAIL_FROM;
  });

  it("envoie via SMTP quand SMTP_URL est défini", async () => {
    const srv = await fakeSmtp();
    process.env.SMTP_URL = `smtp://127.0.0.1:${srv.port}?ignoreTLS=true`;
    process.env.MAIL_FROM = "CoachGG <no-reply@coachgg.test>";
    const r = await sendMail({ to: "ami@test.dev", subject: "Invitation", text: "Bonjour" });
    srv.close();
    expect(r).toEqual({ delivered: true, driver: "smtp" });
    expect(srv.received).toHaveLength(1);
    expect(srv.received[0]!.from).toContain("no-reply@coachgg.test");
    expect(srv.received[0]!.to[0]).toContain("ami@test.dev");
    expect(srv.received[0]!.data).toContain("Subject: Invitation");
  });

  it("un serveur SMTP injoignable ne fait pas échouer l'action", async () => {
    process.env.SMTP_URL = "smtp://127.0.0.1:1?ignoreTLS=true&connectionTimeout=500";
    const r = await sendMail({ to: "ami@test.dev", subject: "x", text: "y" });
    expect(r).toMatchObject({ delivered: false, driver: "smtp", error: "smtp_failed" });
  });

  it("sans SMTP_URL, en test/dev : pilote console", async () => {
    expect((await sendMail({ to: "a@test.dev", subject: "x", text: "y" })).driver).toBe("console");
  });
});
