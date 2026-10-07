# semnome

Base local de um workbench desktop. O nome é provisório, sempre escrito `semnome`.
O produto começa do zero: nenhum código do aplicativo anterior, nenhum plugin ChatGPT/Codex,
nenhum terminal real, login, serviço remoto ou aplicativo do BootCrate foi incluído.

## Começar no Windows

Use **Node.js 24.x**, **pnpm 11.25.0** e Git. A primeira instalação precisa de internet para
baixar dependências e o Electron; depois disso a execução desta base não usa serviços externos.

```powershell
npm install --global pnpm@11.25.0
pnpm install
pnpm doctor
pnpm check
pnpm dev
```

Se o pnpm indicado já estiver instalado, ignore o primeiro comando. Não use versões diferentes
silenciosamente. `pnpm doctor` explica recursos ausentes sem instalar nada por conta própria.

**Este ZIP não inclui `node_modules`, um executável pronto nem um lockfile fabricado.**
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

## O que há na tela

Cabeçalho fixo, Sidebar, Main e Bottom. Dez tipos de widgets fictícios: sete na Main, uma
navegação lateral, a barra inferior e um painel recolhível de demonstração. Os exemplos não
executam integrações: servem para testar espaço, leitura, rolagem e interação.

**Editar layout** libera movimento e redimensionamento dos sete widgets da Main.
O movimento é contínuo; guias/snap são opcionais e `Alt` suspende o snap durante o movimento.
Soltar sobre outro widget volta à posição anterior. **Salvar** aplica a composição e
**Cancelar** restaura a anterior. As regras de colisão são uma hipótese inicial de protótipo,
não uma decisão definitiva de produto.

O painel demonstra Overlay e Docked nas quatro bordas; Overlay também permite posição central.
A barra inferior o reabre. Temas claro/escuro demonstram tokens visuais, não um instalador de temas.
A sidebar e a barra inferior ainda possuem dimensões fixas nesta fundação.

## Criar o Git e conectar o fluxo

Extraia o conteúdo para a pasta que será a raiz do projeto. Não existe `.git` nem remote no ZIP.

```powershell
git init -b main
```

Faça a instalação, os checks e a revisão do conteúdo antes do primeiro commit. Quando estiver
validado, prepare o commit com o token `[0.1.0-alpha.1]`. Crie um repositório **vazio** no GitHub
e configure `origin` usando o endereço que ele fornecer. O ZIP não cria repositórios nem envia commits.

Depois de configurar `origin`, use o GitHub CLI autenticado (`gh`) para preparar os metadados:

```powershell
pnpm github:prepare --repo SEU_USUARIO/SEU_REPOSITORIO
pnpm github:prepare --repo SEU_USUARIO/SEU_REPOSITORIO --apply
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

A fonte da versão é `package.json`. Não mude o nome agora por substituição indiscriminada:
quando escolhermos a identidade definitiva, use o [mapa de renomeação](docs/development/renaming.md).
