// adalove-inject.js — mundo ISOLADO, document_start.
//
// Coloca o `adalove-interceptor.js` para rodar no contexto da PÁGINA. No Chrome
// isso era declarado no manifest com `"world": "MAIN"`, chave que o Firefox só
// passou a aceitar no 128 — e sem o interceptor no contexto da página, o patch
// em fetch/XHR não enxergaria as chamadas do Adalove.
//
// A injeção por <script src> funciona nos dois (o Adalove não manda CSP que a
// bloqueie), então é UM caminho só em vez de um manifest por navegador. O
// arquivo precisa estar em `web_accessible_resources` para a página carregá-lo.

(function () {
  // `browser` no Firefox, `chrome` no Chrome — os dois devolvem promessas em
  // MV3. O `runtime.id` descarta um elemento `id="browser"` da página, que o
  // navegador expõe como global (mesmo teste do webextension-polyfill).
  const api = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;
  const url = api.runtime.getURL("adalove-interceptor.js");

  const script = document.createElement("script");
  script.src = url;
  // `async = false` preserva a ordem contra os outros scripts da página; é o mais
  // perto que dá para chegar do document_start do mundo MAIN.
  script.async = false;
  // Ao terminar, o <script> sai do DOM: o patch já está aplicado no fetch/XHR da
  // página e a tag só sujaria o HTML de quem inspecionar.
  script.onload = () => script.remove();

  // Em document_start o <head> pode ainda não existir; o <html> sempre existe.
  (document.head ?? document.documentElement).appendChild(script);
})();
