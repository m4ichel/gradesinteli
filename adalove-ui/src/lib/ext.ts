// Namespace da extensão, resolvido uma vez.
//
// No Firefox o padrão é `browser`, que devolve PROMESSAS; o `chrome` existe lá
// como alias, mas na versão de callbacks — `await chrome.storage.local.get(k)`
// resolveria para `undefined` em vez de falhar, que é o pior tipo de quebra.
// No Chrome só existe `chrome`, e em MV3 ele já é baseado em promessas.
//
// O teste é o `runtime.id`, que só existe dentro da extensão: uma página comum
// do Chrome também tem `window.chrome` (sem as APIs), e um elemento da página
// com `id="browser"` aparece como global — o webextension-polyfill faz o mesmo.
//
// No harness de dev não existe nenhum dos dois: por isso pode ser `undefined`,
// e quem usa precisa tratar (é o que `prefs.ts` faz, caindo no localStorage).

type ExtApi = typeof chrome;

const browserApi = (globalThis as { browser?: ExtApi }).browser;
const chromeApi = typeof chrome !== "undefined" ? chrome : undefined;

export const ext: ExtApi | undefined = browserApi?.runtime?.id
  ? browserApi
  : chromeApi?.runtime?.id
    ? chromeApi
    : undefined;

/** Dentro da extensão isto é sempre verdadeiro; fora, nunca. */
export const inExtension = !!ext?.storage?.local;
