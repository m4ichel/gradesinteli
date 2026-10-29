// grades-content.js — mundo isolado, roda no GradesInteli.
// Entrega ao app os dados capturados no Adalove (via storage.local da extensão)
// por dois caminhos:
//   1) ao abrir a aba (lê o pendingImport existente);
//   2) ao vivo, via storage.onChanged — assim, se a aba já estiver aberta, todo
//      novo clique no botão do Adalove atualiza o dashboard na hora, sem
//      precisar recarregar.
// O app escuta "GRADESINTELI_IMPORT" e responde "GRADESINTELI_IMPORT_OK".

(function () {
  // Ver adalove-inject.js: `browser` no Firefox, `chrome` no Chrome, ambos com
  // promessas.
  const api = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;

  // Só importa cliques recentes. Cada clique no botão do Adalove grava um
  // pendingImport com requestedAt novo; uma visita avulsa ao site não dispara
  // reimport e não atropela edições manuais.
  const MAX_AGE_MS = 60 * 1000;

  let acked = false;
  window.addEventListener("message", (e) => {
    if (e.source === window && e.data && e.data.type === "GRADESINTELI_IMPORT_OK") {
      acked = true;
    }
  });

  function deliver(pending) {
    if (!pending || typeof pending.json !== "string") return;
    const age = Date.now() - (pending.requestedAt || 0);
    if (age > MAX_AGE_MS) {
      console.debug("[GradesInteli] import ignorado (antigo, %dms)", age);
      api.storage.local.remove("pendingImport");
      return;
    }

    console.debug("[GradesInteli] entregando import ao app");
    // Consome de uma vez para não reimportar sozinho depois.
    api.storage.local.remove("pendingImport");

    const json = pending.json;
    acked = false;

    // O listener do app é registrado num useEffect após a montagem do React.
    // Reenviamos algumas vezes até receber o ack, para não perder a corrida.
    let tries = 0;
    (function send() {
      if (acked || tries > 15) return;
      tries++;
      window.postMessage({ type: "GRADESINTELI_IMPORT", payload: json }, "*");
      setTimeout(send, 300);
    })();
  }

  // 1) Import pendente ao abrir a aba.
  api.storage.local.get("pendingImport").then((res) => deliver(res && res.pendingImport));

  // 2) Import ao vivo: aba já aberta + novo clique no Adalove.
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.pendingImport) return;
    const nv = changes.pendingImport.newValue;
    if (nv) {
      console.debug("[GradesInteli] novo clique detectado (storage.onChanged)");
      deliver(nv);
    }
  });

  console.debug("[GradesInteli] content script ativo (com onChanged) ✓");
})();
