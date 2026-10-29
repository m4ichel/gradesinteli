#!/usr/bin/env node
// Empacota a extensão para cada navegador a partir de extension/.
//
// O extension/manifest.json continua sendo a fonte da verdade e carrega sem
// compactação nos dois navegadores: o `background` declara `service_worker`
// (Chrome) E `scripts` (Firefox), e cada um ignora a chave do outro — Chrome
// 121+ e Firefox 121+. Para as lojas, cada pacote leva só as chaves que o seu
// navegador usa:
//
//   build/extension/chrome/   + build/extension/adalove-modern-ui-chrome-<versão>.zip
//   build/extension/firefox/  + build/extension/adalove-modern-ui-firefox-<versão>.zip
//
// O dist/adalove-ui.js NÃO é gerado aqui: se a UI mudou, rode antes
// `npm run build` em adalove-ui.

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = path.join(ROOT, "extension");
const OUT = path.join(ROOT, "build", "extension");

// Documentação do repo, não da extensão.
const EXCLUDE = new Set(["README.md"]);

const TARGETS = {
  chrome(manifest) {
    // O Chrome roda o service worker; `scripts` e `browser_specific_settings`
    // são chaves que ele só ignora.
    delete manifest.background.scripts;
    delete manifest.browser_specific_settings;
    return manifest;
  },
  firefox(manifest) {
    // O Firefox não tem service worker de extensão: `scripts` vira event page.
    delete manifest.background.service_worker;
    return manifest;
  },
};

async function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(full, base)));
    else out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out.sort();
}

/** Todo arquivo que o manifest cita pelo nome (os globs de
 *  web_accessible_resources ficam de fora). */
function referencedFiles(manifest) {
  const refs = [
    ...Object.values(manifest.icons ?? {}),
    manifest.background?.service_worker,
    ...(manifest.background?.scripts ?? []),
    ...(manifest.content_scripts ?? []).flatMap((cs) => [...(cs.js ?? []), ...(cs.css ?? [])]),
    ...(manifest.web_accessible_resources ?? []).flatMap((war) => war.resources),
  ];
  return refs.filter((ref) => typeof ref === "string" && !ref.includes("*"));
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Zip mínimo (deflate, sem zip64) — basta para as duas lojas e evita uma
 *  dependência só para isso. Data fixa em 1980-01-01: o mesmo conteúdo gera
 *  sempre o mesmo arquivo. */
function zip(entries) {
  const DOS_DATE = (1 << 5) | 1;
  const parts = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const packed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // versão mínima para extrair
    local.writeUInt16LE(0x0800, 6); // nomes em UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    parts.push(local, nameBuf, packed);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(8, 10);
    header.writeUInt16LE(DOS_DATE, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(packed.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(nameBuf.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(header, nameBuf);

    offset += local.length + nameBuf.length + packed.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

const manifest = JSON.parse(await readFile(path.join(SRC, "manifest.json"), "utf8"));
const files = (await listFiles(SRC)).filter((f) => f !== "manifest.json" && !EXCLUDE.has(f));

// Sem o bundle a UI nova some em silêncio; melhor parar aqui.
const missing = referencedFiles(manifest).filter((ref) => !files.includes(ref));
if (missing.length) {
  console.error(`O manifest cita arquivos que não existem em extension/: ${missing.join(", ")}`);
  if (missing.includes("dist/adalove-ui.js")) console.error("Rode `npm run build` em adalove-ui antes.");
  process.exit(1);
}

await rm(OUT, { recursive: true, force: true });

for (const [target, transform] of Object.entries(TARGETS)) {
  const targetManifest = transform(structuredClone(manifest));
  const entries = [
    { name: "manifest.json", data: Buffer.from(`${JSON.stringify(targetManifest, null, 2)}\n`) },
    ...(await Promise.all(files.map(async (name) => ({ name, data: await readFile(path.join(SRC, name)) })))),
  ];

  const dir = path.join(OUT, target);
  for (const { name, data } of entries) {
    await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await writeFile(path.join(dir, name), data);
  }

  const zipName = `adalove-modern-ui-${target}-${manifest.version}.zip`;
  await writeFile(path.join(OUT, zipName), zip(entries));
  console.log(`${target}: build/extension/${target}/ e build/extension/${zipName} (${entries.length} arquivos)`);
}
