import { createServerFn } from "@tanstack/react-start";

export const importFonbet = createServerFn({ method: "POST" }).handler(async () => {
  const { importEngine } = await import("./fonbetImport.server");
  return importEngine("fonbet");
});
export const importPari = createServerFn({ method: "POST" }).handler(async () => {
  const { importEngine } = await import("./fonbetImport.server");
  return importEngine("pari");
});
export const importLeon = createServerFn({ method: "POST" }).handler(async () => {
  const { importEngine } = await import("./fonbetImport.server");
  return importEngine("leon");
});
export const importZenit = createServerFn({ method: "POST" }).handler(async () => {
  const { importEngine } = await import("./fonbetImport.server");
  return importEngine("zenit");
});
export const importWinline = createServerFn({ method: "POST" }).handler(async () => {
  const { importEngine } = await import("./fonbetImport.server");
  return importEngine("winline");
});
