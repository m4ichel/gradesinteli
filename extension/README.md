# Adalove Modern UI (extensão)

Duas coisas, num pacote só:

1. **Interface nova para o Adalove**, montada dentro da própria página. É o
   `adalove-ui/` compilado (`dist/adalove-ui.js`) — telas, rotas e arquitetura
   estão documentadas em [`../adalove-ui/README.md`](../adalove-ui/README.md).
2. **Importação de notas e faltas** para o [GradesInteli](https://www.gradesinteli.com),
   sem precisar salvar a página em HTML (CMD+S). É o fluxo original da extensão e
   segue funcionando igual.

## Como funciona

O Adalove, ao abrir a aba **Notas**, busca seus dados em
`GET https://apiv2.inteli.edu.br/sections/{turma}/userdata`. A extensão apenas
**observa essa resposta** (que o app já buscou, usando a sua própria sessão),
guarda localmente e, ao clicar no botão, abre o GradesInteli já preenchido.

A interface nova usa a mesma sessão: o content script roda no mundo ISOLADO **na
origem do Adalove**, então lê o token do `localStorage` dele e chama a apiv2
direto. A UI original nunca é destruída, só escondida por CSS.

- O login é o do Adalove. A tela de entrada é nossa, mas e-mail e senha vão
  direto para o Cognito da Inteli (o mesmo serviço que a página deles chama) e
  nada é guardado além da sessão que o próprio Adalove guardaria. Entrar com o
  Google aciona o botão original deles, sem intermediário.
- Não envia nada para servidores de terceiros — os dados vão direto do seu
  navegador (Adalove → GradesInteli) via `storage.local` da extensão + `postMessage`.

## Instalar (modo desenvolvedor)

**Chrome / Edge**

1. Abra `chrome://extensions` (ou `edge://extensions`).
2. Ative o **Modo do desenvolvedor**.
3. **Carregar sem compactação** / **Load unpacked** → selecione esta pasta (`extension`).

**Firefox** (128 ou mais novo)

1. Abra `about:debugging#/runtime/this-firefox`.
2. **Carregar extensão temporária…** → escolha o `manifest.json` desta pasta.
3. Em `about:addons` → Adalove Modern UI → **Permissões**, confira que o acesso a
   `adalove.inteli.edu.br` e `www.gradesinteli.com` está ligado. No MV3 do Firefox
   o acesso a sites é permissão que a pessoa pode desligar; sem ele nenhum
   content script roda.

A extensão temporária some ao fechar o Firefox. A pasta é a mesma nos dois
navegadores — ver [Chrome e Firefox](#chrome-e-firefox).

O `dist/adalove-ui.js` é gerado por `npm run build` dentro de `../adalove-ui` — não
é editado à mão.

## Usar

No Adalove logado aparecem dois botões nos cantos de baixo:

- **"✦ UI nova"**, à esquerda → liga a interface nova. A preferência fica no
  `storage.local` da extensão (`uiMode`), então nas próximas visitas ela já abre assim;
  dentro dela, **"UI original"** no pé do menu desliga.
- **"✓ Abrir no GradesInteli"**, à direita → abre o dashboard numa nova aba já com
  suas notas e faltas. Antes das atividades carregarem ele diz "Aguardando notas…".

## Arquivos

| Arquivo | Mundo | Onde roda | Papel |
|---|---|---|---|
| `adalove-inject.js` | isolado | adalove.inteli.edu.br | Injeta o interceptor no contexto da página |
| `adalove-interceptor.js` | página | adalove.inteli.edu.br | Captura a resposta `/userdata` via patch em fetch/XHR |
| `adalove-boot.js` | isolado | adalove.inteli.edu.br | `document_start`: esconde a UI deles antes do React montar, se a preferência é a UI nova |
| `adalove-content.js` | isolado | adalove.inteli.edu.br | Salva a captura e mostra o botão de importar |
| `dist/adalove-ui.js` | isolado | adalove.inteli.edu.br | A interface nova (shadow root) e o botão que liga ela |
| `adalove-capture.js` | MAIN | adalove.inteli.edu.br | Ferramenta de desenvolvimento: grava os payloads de uma página para reconstruí-la |
| `background.js` | worker | — | Busca a Ficha do aluno (Apps Script da Inteli) com o login Google, para a tela de Métricas avançadas |
| `authorize.html` / `.js` | página | janela da extensão | Pede a permissão opcional de `script.google.com` no clique |
| `grades-content.js` | isolado | www.gradesinteli.com | Entrega os dados à página via `postMessage` |

O app escuta `window.postMessage({ type: "GRADESINTELI_IMPORT", payload })` em
`src/hooks/useGradeDashboard.ts` e responde com `GRADESINTELI_IMPORT_OK`.

O `adalove-boot.js` carrega uma cópia da lista de rotas cobertas pela overlay
(`adalove-ui/src/shell/routes.ts` é a fonte da verdade): ele roda antes de
qualquer bundler e precisa decidir na hora se esconde o `#root` — numa rota que
não cobrimos, esconder daria tela branca.

## Chrome e Firefox

Um código só, e esta pasta carrega sem compactação nos dois. Os pisos são
**Chrome 121** e **Firefox 128** (`strict_min_version`).

- **Namespace.** Todo acesso à API passa por `browser` quando ele existe (Firefox)
  e por `chrome` senão — os dois devolvem promessas em MV3. Nos `.js` desta pasta
  é uma linha no topo de cada arquivo; no TS é `adalove-ui/src/lib/ext.ts`. O teste
  é `browser?.runtime?.id`, não só `browser`: no Firefox o `chrome` existe como
  alias de CALLBACKS (`await chrome.storage.local.get(k)` resolveria para
  `undefined` em silêncio), e uma página com um elemento `id="browser"` o expõe
  como global. Não usamos o `webextension-polyfill`: ele não acrescentaria nada
  no Chrome MV3, que já é baseado em promessas, e o único ponto em que os dois
  diferem — devolver uma Promise de dentro do `onMessage` — fica de fora porque o
  `background.js` usa `sendResponse` + `return true`, que funciona igual nos dois.
- **Background.** O manifest declara `service_worker` (Chrome) e `scripts`
  (Firefox, que roda o mesmo arquivo como event page). Cada navegador ignora a
  chave do outro a partir do 121 — é o arranjo que a [MDN recomenda](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background).
- **Interceptor.** É injetado como `<script src>` pelo `adalove-inject.js`, não
  declarado com `"world": "MAIN"` (que o Firefox só aceita desde o 128). Funciona
  nos dois porque o Adalove não manda CSP.
- **CSS da overlay.** Num content script do Firefox anterior ao 153 (ESR 128 e 140
  inclusive), atribuir `shadowRoot.adoptedStyleSheets` lança erro
  ([bug 1751346](https://bugzilla.mozilla.org/show_bug.cgi?id=1751346)); o
  `mount.tsx` cai para um `<style>` dentro do shadow root.
- **URLs internas.** Fontes e logos vêm de `runtime.getURL(...)` e estão em
  `web_accessible_resources` — `chrome-extension://` num, `moz-extension://` no outro.

### Pacotes para as lojas

```bash
npm run build --prefix adalove-ui   # só se a UI mudou
npm run build:extension             # na raiz do repo
```

O `scripts/build-extension.mjs` gera `build/extension/chrome/` e
`build/extension/firefox/` (pastas que também carregam sem compactação) e um
`.zip` de cada, com o manifest enxuto para o navegador: o do Chrome perde
`background.scripts` e `browser_specific_settings`; o do Firefox perde
`background.service_worker`. Ele para se o manifest citar um arquivo que não existe.

O AMO pede o código-fonte junto quando o pacote tem código compilado (o
`dist/adalove-ui.js`): envie o repositório com estas instruções de build.

Para validar o pacote do Firefox com o mesmo linter do AMO:

```bash
npx web-ext lint --source-dir build/extension/firefox
```

## Desenvolvimento local

O `manifest.json` também casa com `http://localhost/*`, então dá para testar o
fluxo com o GradesInteli rodando em `npm run dev` (qualquer porta).

Para a interface nova, 95% do trabalho acontece em `../adalove-ui` com
`npm run dev` — sem Adalove e sem rede, contra um fixture gravado.
