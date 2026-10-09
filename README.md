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

**Editar layout** libera movimento e redimensionamento dos sete widgets da Main.
Configurações > Desenvolvimento permite comparar **Horizontal — 10 linhas** (inicial a cada
sessão) e **Responsivo atual** (motor da alpha.10, preservado). O horizontal usa dez linhas,
células quadradas calculadas pela altura da Main, uma única moldura fixa de 15px e rolagem
horizontal limitada ao conteúdo. A barra discreta fica dentro dos 15px inferiores, sem reservar
espaço. Alterar largura, altura ou divisores preserva as coordenadas lógicas. Cada modo carrega
e salva sua própria composição; somente **Salvar layout** grava o horizontal. Salve ou cancele
a edição antes de trocar de modo. Campos e plugins permanecem ativos fora da tela.

No responsivo, a grade usa 12×8 como composição de referência. Colunas e linhas se adaptam
à largura e à altura da Main, redistribuindo os widgets com células quadradas, centralização
permanente e sem rolagem.
Os tamanhos preferidos e a vizinhança são preservados quando há espaço; margens maiores em
proporções extremas recebem um aviso. Redimensionar a janela ou os divisores gera uma projeção
reversível, sem gravar nem acumular alterações no layout. Movimento e as oito bordas/cantos usam
unidades inteiras; setas no controle em foco também movem/redimensionam. Vizinhos podem ser
empurrados, comprimidos ou reorganizados dentro dos limites. Tentativas sem espaço mantêm a
última prévia válida. **Editar layout** parte da projeção visível; **Salvar layout** confirma sua
composição e seus limites atuais. **Cancelar** restaura a composição salva, projetada nesta janela.
O layout fracionário v1 continua preservado; sua conversão vira uma grade salva somente após
confirmação explícita. Falhas de recuperação oferecem importação ou prévia inicial nas Configurações.

Configurações > Desenvolvimento reúne seleção experimental, importação e prévia inicial do
modo ativo, além do painel de teste. O painel demonstra Overlay e Docked no responsivo;
no horizontal ele aparece em Overlay para preservar a geometria da Main. Overlay também permite
posição central. A barra inferior o reabre. Sidebar e Bottom têm divisores independentes em pixels,
por mouse ou teclado. Temas claro/escuro demonstram tokens visuais, não um instalador de temas.

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
