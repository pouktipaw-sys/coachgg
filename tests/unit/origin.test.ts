import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { handler } from "@/server/http";

const ok = handler(async () => new Response("ok"));
const post = (headers: Record<string, string>) =>
  ok(new NextRequest("http://localhost:3000/api/x", { method: "POST", headers }), { params: Promise.resolve({}) });

describe("protection CSRF (origine)", () => {
  it("accepte la page servie via un tunnel ou un proxy HTTPS (même hôte)", async () => {
    expect((await post({ origin: "https://abc.trycloudflare.com", host: "abc.trycloudflare.com" })).status).toBe(200);
    expect((await post({ origin: "https://abc.trycloudflare.com", host: "localhost:3000", "x-forwarded-host": "abc.trycloudflare.com" })).status).toBe(200);
    expect((await post({ origin: "http://localhost:3000", host: "localhost:3000" })).status).toBe(200);
  });
  it("refuse un autre site", async () => {
    const r = await post({ origin: "https://site-pirate.com", host: "abc.trycloudflare.com" });
    expect(r.status).toBe(403);
    expect((await r.json()).message).toBe("Origine non autorisée.");
    expect((await post({ origin: "https://evil.trycloudflare.com", host: "abc.trycloudflare.com" })).status).toBe(403);
  });
});
