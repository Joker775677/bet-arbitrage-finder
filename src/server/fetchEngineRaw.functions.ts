import { createServerFn } from "@tanstack/react-start";

const ENGINE_PATH = {
  fonbet: "/fonbet?scope=1600",
  pari: "/pari?scope=2300",
  leon: "/leon",
  zenit: "/zenit",
} as const;

export type EngineKey = keyof typeof ENGINE_PATH;

export const fetchEngineRaw = createServerFn({ method: "POST" })
  .inputValidator((d: { engine: EngineKey }) => {
    if (!d || !(d.engine in ENGINE_PATH)) throw new Error("invalid engine");
    return { engine: d.engine };
  })
  .handler(async ({ data }) => {
    const base = process.env.SCRAPER_URL;
    const token = process.env.SCRAPER_TOKEN;
    if (!base || !token) throw new Error("SCRAPER_URL/SCRAPER_TOKEN not configured");
    const t0 = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60000);
    try {
      const r = await fetch(`${base.replace(/\/+$/, "")}${ENGINE_PATH[data.engine]}`, {
        headers: { "x-token": token },
        signal: ctrl.signal,
      });
      const payload = await r.json();
      return { ok: true as const, engine: data.engine, ms: Date.now() - t0, payload };
    } finally {
      clearTimeout(timer);
    }
  });
