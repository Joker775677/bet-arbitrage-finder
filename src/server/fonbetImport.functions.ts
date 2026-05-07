import { createServerFn } from "@tanstack/react-start";
import { importEngine } from "./fonbetImport.server";

export const importFonbet = createServerFn({ method: "POST" }).handler(() => importEngine("fonbet"));
export const importPari   = createServerFn({ method: "POST" }).handler(() => importEngine("pari"));
export const importLeon   = createServerFn({ method: "POST" }).handler(() => importEngine("leon"));
export const importZenit  = createServerFn({ method: "POST" }).handler(() => importEngine("zenit"));
