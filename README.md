# GeppIO

Base local de um workbench desktop. O nome do produto é **GeppIO**; o namespace técnico é `geppio`.
O produto começa do zero: nenhum código do aplicativo anterior, nenhum plugin ChatGPT/Codex,
nenhum terminal real, login, serviço remoto ou aplicativo do BootCrate foi incluído.

## Começar no Windows

Use **Node.js 24.x**, **pnpm 11.25.0** e Git. A primeira instalação precisa de internet para
baixar dependências e o Electron; depois disso a execução desta base não usa serviços externos.

```powershell
npm install --global pnpm@11.25.0
pnpm install
pnpm run doctor
pnpm check
pnpm dev
```

Se o pnpm indicado já estiver instalado, ignore o primeiro comando. Não use versões diferentes
silenciosamente. `pnpm run doctor` executa o diagnóstico do projeto; `pnpm doctor` pode selecionar
o comando nativo do gerenciador. Antes de instalar dependências, execute o diagnóstico diretamente
com `node --experimental-strip-types tools/doctor.ts` para evitar a instalação automática do pnpm.

O checkout inclui o lockfile real; use `pnpm install --frozen-lockfile` nas instalações seguintes. A criação do Git já foi concluída; as instruções do ZIP abaixo são históricas e não devem ser repetidas. **O ZIP original não incluía `node_modules`, um executável pronto nem um lockfile fabricado.**
O ambiente de geração não acessou o registro npm. O primeiro `pnpm install` deve produzir
`pnpm-lock.yaml`; revise e inclua esse arquivo no primeiro commit. O build completo e o teste
gráfico Windows devem ser executados localmente antes de aceitar a fundação. A configuração de
CI usa instalação congelada e exige esse lockfile real.

Para testar a versão compilada:

```powershell
pnpm build
pnpm start
pnpm test:desktop
```

## Atalhos no VS Code

Abra a pasta do projeto no VS Code e instale a extensão recomendada
**Task Buttons** (`spencerwmiles.vscode-task-buttons`). A barra de status mostra
**Dev**, **Start**, **Plugins** e **Check**; as mesmas tarefas ficam disponíveis em
**Terminal > Run Task**, mesmo sem a extensão.

**Dev** executa `pnpm dev --watch`: atualiza o renderer ao salvar e recompila Main/preload
quando mudam. **Start** executa `pnpm start`; o electron-vite compila antes de abrir o preview.
**Plugins** gera os exemplos independentes e **Check** executa a validação completa.
Instale as dependências antes de usar os atalhos.

Cada tarefa usa um terminal dedicado e permite uma instância por janela do workspace.
Para encerrar Dev/Start, use **Terminal > Terminate Task** e escolha a tarefa, ou a lixeira
do terminal correspondente. Encerre Dev antes de executar Start/Check, pois eles escrevem
no mesmo `out/`. Feche também qualquer execução manual anterior antes de iniciar Dev:
a porta local é fixa e os atalhos não encerram processos iniciados fora das tarefas.

## O que há na tela

Cabeçalho fixo, Sidebar, Main e Bottom. Dez tipos de widgets fictícios: sete na Main, uma
navegação lateral, a barra inferior e um painel recolhível de demonstração. Os exemplos não
executam integrações: servem para testar espaço, leitura, rolagem e interação.

**Editar layout** libera posições e dimensões livres em pixels CSS, sem células ou encaixe
obrigatório. Arraste pelo título ou use setas (1px; Shift: 10px). Main permite movimento e oito
direções de redimensionamento; Sidebar organiza verticalmente e acompanha sua largura interna;
Bottom organiza horizontalmente e acompanha sua altura interna. Selecione um widget e use
**Mover widget** no cabeçalho para transferi-lo a uma região compatível. A navegação e a toolbar
continuam fixas. Bottom precisa ser ampliada antes de receber os exemplos compatíveis.

Vizinhos podem ser empurrados, comprimidos até seus mínimos em pixels e recuperar tamanhos
preferidos. Rearranjos são limitados; tentativas impossíveis preservam a última prévia válida.
Não há gravidade nem compactação de espaços vazios. Cada região tem uma margem interna de 15px;
o afastamento entre widgets é de aproximadamente 10px.

**Ativar expansão horizontal**, em Configurações > Desenvolvimento, começa desligado e persiste
independentemente da composição. Quando ativo, Main e Bottom expandem somente até os widgets
ocupados, sem margem vazia permanente à direita. Sidebar mantém sua organização vertical.
Campos e Workers continuam montados e ativos fora da tela. O plugin experimental ainda usa
sua própria faixa; esta versão não adiciona integração geral de plugins às regiões.

Janela e divisores geram projeções reversíveis a partir de uma referência estável, sem gravar
posições. Quando os mínimos não cabem, uma área recuperável com rolagem conserva a composição
e mostra um aviso. **Salvar layout** adota a prévia em uma nova representação livre; **Cancelar**
restaura a composição anterior. Layouts fracionário v1, responsivo v2 e horizontal v1 permanecem
intactos. Configurações oferece prévias históricas separadas, importação de cópias JSON e composição inicial;
somente Salvar confirma a adoção. Conversões impossíveis informam o limite e preservam o original.

Sidebar e Bottom mantêm os divisores em pixels e os limites anteriores. Arrastar além do mínimo
recolhe a região completamente; **Reabrir Sidebar/Bottom** no cabeçalho restaura o tamanho pedido.
Setas operam os divisores; Home recolhe e Escape cancela a sequência ou o gesto em andamento.
Uma faixa estrutural vazia de 15px permanece fixa na base da janela, fora da disposição dos widgets.
O painel de teste mantém Overlay/Docked e suas bordas. Temas claro/escuro demonstram tokens visuais.

## Plugins locais de teste

A versão `0.1.0-alpha.2` carrega pacotes externos confiáveis. Para gerar os dois exemplos,
execute `pnpm plugins:build` e abra o app com `pnpm dev` ou `pnpm start` após `pnpm build`.
Em **Configurações > Plugins > Instalar pasta local**, escolha
`.local/plugin-packages/counter` e `.local/plugin-packages/pulse` separadamente.
A instalação começa desativada; **Ativar** executa o pacote. O contador contribui um widget
interativo na Main; o pulso não possui widgets e mostra sua atividade nos eventos do gerenciamento.
**Desativar** descarta o Worker e **Remover** exclui a cópia gerenciada. Instalações e preferências
persistem ao reiniciar; o estado interno do contador recomeça em cada ativação.

Cada exemplo possui seu próprio `plugin.json` e fonte TypeScript em `examples/plugins/`.
Adicionar uma nova pasta de exemplo e gerar seus assets não exige editar ou recompilar o core.
O app copia apenas pacotes prontos de arquivos `.js`/`.json`; escolha a pasta gerada, não a fonte.
Atualizações exigem remover e reinstalar. Widgets de plugins aparecem em uma faixa na Main,
sem entrar ainda na persistência/movimentação do layout das fixtures.

Use somente código local revisado e confiável. Workers executam a lógica sem DOM ou ponte
Node/Electron; isso **não certifica isolamento para terceiros**. Não há marketplace, broker,
vault, HTML/CSS arbitrário ou superfícies próprias. Veja o [contrato técnico](docs/architecture/plugins.md).

## Git e fluxo do projeto

O repositório atual é **`rabrunos/GeppIO`** (ID GitHub `1409287329`), após o rename realizado pelo proprietário em 2026-10-08. O proprietário também atualizou `origin`. A autorização de Git continua restrita a esse mesmo repositório e à `main`, com todos os gates anteriores. O Git e as Issues já existem. Commits e pushes de implementações aprovadas seguem a [política de tarefas](docs/.ai/TASK_POLICY.md), após validação e revisão. Publicação e fechamento de Issues exigem autorização separada.

### Handoff histórico do ZIP

Extraia o conteúdo para a pasta que será a raiz do projeto. Não existe `.git` nem remote no ZIP.

```powershell
git init -b main
```

Faça a instalação, os checks e a revisão do conteúdo antes do primeiro commit. Quando estiver
validado, prepare o commit com o token `[0.1.0-alpha.1]`. Crie um repositório **vazio** no GitHub
e configure `origin` usando o endereço que ele fornecer. O ZIP não cria repositórios nem envia commits.

Depois de configurar `origin`, use o GitHub CLI autenticado (`gh`) para preparar os metadados:

```powershell
node --experimental-strip-types tools/github-prepare.ts --repo SEU_USUARIO/SEU_REPOSITORIO
node --experimental-strip-types tools/github-prepare.ts --repo SEU_USUARIO/SEU_REPOSITORIO --apply
```

O primeiro comando só mostra a prévia. O segundo autoriza criar/atualizar as labels deste projeto
e criar, se ainda não existir, **uma Issue inicial de validação da fundação**. Ele confere o
repositório contra `origin`, preserva labels não relacionadas e não fecha Issues nem faz push.
Use sua identidade real no lugar dos exemplos. Mais detalhes em [GitHub](docs/development/github.md).

## ChatGPT e Codex

| Para quem | Arquivo de entrada |
| --- | --- |
| ChatGPT, planejamento/orquestração | [PROJECT_GUIDE.md](PROJECT_GUIDE.md) |
| Codex local, implementação | [AGENTS.md](AGENTS.md) |
| Primeiro teste local com Codex | [FIRST_LOCAL_RUN.md](docs/.ai/prompts/FIRST_LOCAL_RUN.md) |
| Requisitos consolidados | [requirements.md](docs/product/requirements.md) |
| Testes e critérios de aceite | [testing.md](docs/development/testing.md) |

O intake foi convertido em requisitos e perfil do projeto; não há questionário a refazer.
O método fica nos arquivos de orientação, nas configurações do Codex, nas skills e no GitHub.
**A situação das tarefas, a evidência e o aceite pertencem às Issues**, não a arquivos de status
paralelos. A conta do ChatGPT/Codex continua sendo a sua; nenhuma chave ou API paga foi adicionada.

A fonte da versão é `package.json`. A migração da Issue #6 usa `geppio://app`, `window.geppio` e o perfil `%APPDATA%\geppio`. Com o perfil novo ausente, copia plugins e armazenamento local de `%APPDATA%\semnome`, sem alterar o original. Layouts válidos são transferidos para a nova chave; dados presentes no destino têm prioridade.

Feche a versão anterior antes de abrir GeppIO. Consulte o [procedimento de recuperação](docs/development/renaming.md) para backup, rollback, corrupção ou perfis novos já existentes. Não apague o perfil antigo.
