# GeppIO

Workbench desktop local com widgets e plugins modulares. O nome do produto é **GeppIO**;
o namespace técnico é `geppio`. A base usa Electron, TypeScript, React, Tailwind, Heroicons
e Motion. A escolha de shadcn/ui para futuras incorporações está registrada na
[issue #8](https://github.com/rabrunos/GeppIO/issues/8); isso não significa integração já concluída.

O workbench tem geometria contínua, catálogo, barras, composições, histórico de edição e
persistência de layout. Há um runtime experimental real para plugins locais confiáveis.
O perfil novo abre Main, Sidebar e Bottom vazios; escolha widgets dos plugins instalados
no catálogo. Os sete demos foram retirados do uso normal. Layouts anteriores preservam
plugins, barras e composições; referências dos demos ficam guardadas para recuperação.
Editor de arquivos, projeto conectado ao filesystem, Git, terminal, ChatGPT, Codex e GitLayer
ainda são propostas, não ferramentas funcionais desta base. Não há conta GeppIO, backend,
sincronização em nuvem ou API paga de IA.

Windows é o primeiro alvo validado. A direção de produto inclui Windows e Linux, mas não há
validação equivalente do aplicativo Linux nem distribuição pronta para esses sistemas.
`pnpm build` gera artefatos locais; não gera instalador, assinatura ou release.

## Começar no checkout existente

Use **Node.js 24.x**, **pnpm 11.25.0** e Git. O repositório já inclui o lockfile real.
Na raiz do checkout, em PowerShell:

```powershell
node --version
npm install --global pnpm@11.25.0
node --experimental-strip-types tools/doctor.ts
pnpm install --frozen-lockfile
pnpm run doctor
pnpm check
pnpm dev
```

Ignore a instalação global se a versão indicada já estiver disponível. O diagnóstico anterior
à instalação pode informar dependências ausentes; repita-o depois de instalar. `pnpm run doctor`
é o diagnóstico do projeto; `pnpm doctor` pode selecionar o comando nativo do gerenciador.
A invocação direta pelo Node evita o preflight de dependências que o pnpm pode iniciar antes
de scripts. Não gere outro lockfile nem altere versões para contornar um erro de instalação.

A primeira instalação precisa de internet para os pacotes e o binário do Electron. Depois
do preparo, esta base local não exige serviço externo. Consulte a lista de comandos e os detalhes
em [desenvolvimento local](docs/development/local.md).

Para abrir o código compilado ou executar a suíte desktop em perfil descartável:

```powershell
pnpm build
pnpm start
pnpm test:desktop
```

Esses comandos não representam resultados já obtidos nesta máquina. Evidências por commit,
limites dos testes e aceites estão nas issues e no [guia de validação](docs/development/testing.md).

## Workspace Essentials local

Execute `pnpm plugins:build` e abra o aplicativo com `pnpm start` após `pnpm build`.
Abra o menu do perfil e **Configurações > Desenvolvimento e recuperação > Plugins > Instalar
pasta local**. Selecione `.local/plugin-packages/workspace-essentials` e clique **Ativar** em
**Workspace Essentials**. O menu **Plugins** do cabeçalho oferece o mesmo gerenciamento.
Entre em **Editar layout**, escolha cada widget no catálogo, selecione uma área compatível e conclua.
Ativar não adiciona widgets automaticamente. Anotações, Checklist e Prompts salvos aceitam
Main, Sidebar e Bottom; Rascunho permanece apenas na Main. Na Bottom, selecione e leia
anotações/prompts ou marque itens do checklist; os editores completos ficam na Main e na Sidebar.

- **Anotações:** use **Nova anotação**, edite título/texto e selecione outra anotação na lista.
- **Rascunho:** digite o texto; o autosave agrupa alterações por 500 ms. Aguarde **Salvo.**
- **Checklist:** escreva em **Novo item**, clique **Adicionar item** e marque a conclusão.
- **Prompts salvos:** use **Novo prompt**, edite título/texto e clique **Copiar prompt**.
  Se a política de clipboard impedir a cópia, selecione o texto e copie manualmente.

Os dados confirmados voltam ao reabrir, reiniciar e desativar/reativar a mesma instalação.
Remover um widget da Main preserva seus dados. Desinstalar também mantém o arquivo recuperável,
mas uma reinstalação recebe outra identidade e não herda os dados antigos. Não há transferência
ou exclusão automática. Em falha, o texto pendente continua disponível na ativação: tente salvar
novamente ou copie-o antes de fechar. Bytes inválidos/incompatíveis são preservados e bloqueiam
gravação; consulte [retenção e recuperação](docs/architecture/plugin-data.md).
São dados locais comuns, sem criptografia de credenciais ou isolamento contra plugins hostis.

Teste focado em perfil descartável: `pnpm test:essentials`. O contrato v1 de Counter/Pulse permanece.

## Time Tracker local

Após `pnpm plugins:build`, instale `.local/plugin-packages/time-tracker` pelo mesmo menu
**Plugins** e ative **Time Tracker**. Adicione **Cronômetro** e **Relatórios de tempo**
explicitamente em qualquer uma das três áreas. Os dois compartilham um histórico por instalação.
**Iniciar** começa a contagem por horário; ela continua ao ocultar o widget ou fechar o app
e termina em **Pausar**. Aguarde **Salvo.**; em falha, use **Tentar salvar novamente**.
O relatório oferece totais locais dos últimos sete dias e sessões paginadas, até 200 intervalos.
Sidebar e Bottom mostram resumos compactos. Teste focado: `pnpm test:time-tracker`.

## Alinhar, agrupar e maximizar na Main

Em **Editar layout**, arraste um widget Normal para ver guias próximas de bordas e centros.
As bordas e os cantos de resize também alinham, mantendo a borda oposta fixa. A guia
tracejada de **10px** mostra o espaçamento entre bordas, inclusive antes de os widgets
se encontrarem no outro eixo. Afaste o ponteiro para liberar o snap.
Para agrupar Anotações, Checklist e Prompts salvos, arraste **Abas** até **Agrupar** no
cabeçalho de outro widget compatível. Também é possível clicar **Abas** e escolher o destino.
Amplie um alvo pequeno antes de agrupar. No grupo, troque de aba pelo título; em Editar,
use as setas para reordenar ou **Separar aba** para voltar a um frame próprio, quando houver espaço.
**Salvar edição**, **Concluir**, **Cancelar** e desfazer/refazer preservam o contrato de edição.
Grupos seguem a geometria da área do seu quadro. Separe uma aba para movê-la sozinha;
separe todas antes de converter o grupo em espaços reservados de um formato.

No uso normal, o botão **Maximizar** de um widget compatível ou grupo ocupa a Main útil,
mantendo Sidebar e Bottom acessíveis. **Restaurar** retorna à disposição anterior.
As abas continuam disponíveis durante a maximização. O conteúdo permanece montado e
o quadro cresce sobre os demais widgets, com um blur leve somente na Main durante
a transição. Restaurar faz o caminho inverso. Movimento reduzido usa a mudança direta.
A apresentação maximizada é temporária. Testes focados: `pnpm test:maximize`,
`pnpm test:alignment` e `pnpm test:groups`; acrescente `--scale125` para DPR automatizado 1,25.

Grupos de abas compatíveis funcionam em Main, Bottom e nas barras principal e personalizadas da Sidebar. Em Editar layout, arraste o quadro inteiro para outra área: a prévia informa quantas abas vão e quantas ficam. A transferência preserva a ordem e só acontece se as duas partes forem válidas e houver espaço. Use o controle Abas para agrupar e Separar aba para destacar o membro selecionado.

Durante **Editar layout**, o conteúdo dos widgets continua visível, mas fica bloqueado para mouse e teclado, mesmo com o painel de opções fechado. Use os cabeçalhos e controles para mover, redimensionar, agrupar e trocar abas. **Concluir** ou **Cancelar** libera o conteúdo novamente; rascunhos já aceitos e cronômetros continuam preservados. Teste focado: `pnpm test:edit-lock`.

## O que existe no workbench

Cabeçalho fixo, barra contextual, Sidebar, Main, Bottom e barra de status compõem o shell.
Minimizar, maximizar e fechar operam a janela Electron real; maximizar a janela não maximiza
um widget dentro da Main. Tema claro/escuro, idioma e movimento reduzido fazem parte do host.

O registro de compatibilidade preserva sete tipos sintéticos: **Panorama**, **Fila de trabalho**,
**Biblioteca**, **Ideias em aberto**, **Atividade**, **Propriedades** e **Ritmo**. Eles ficam
fora do catálogo e do perfil inicial normal; fixtures descartáveis exercitam leitura,
formulários, layout e interação. Biblioteca não explora arquivos; Ritmo não mede recursos;
Fila e Atividade não consultam tarefas ou Git. O nome do projeto é metadado local renomeável;
`main`, `Clean`, caminho, abrir no Explorer e exportar configuração são demonstrações.
O perfil e avatar também são visuais, sem login real.

O catálogo tem busca, filtros, presença e avaliação de destino/espaço. É possível acrescentar,
mover e trocar widgets entre regiões compatíveis sem recriar o conteúdo montado. Elegibilidade,
restrições e multiplicidade são validadas pelo host; não implicam permissão nativa para um plugin.

### Regiões e interação

As posições usam pixels CSS contínuos, sem grade obrigatória de células. Main permite
movimento bidimensional e oito direções de resize; Sidebar organiza verticalmente e acompanha
sua largura útil; Bottom organiza horizontalmente e acompanha sua altura útil. Vizinhos podem
ser empurrados ou comprimidos dentro dos mínimos. Reverter antes de soltar restaura a base do
gesto; soltar consolida a referência para o próximo gesto. Tentativas impossíveis preservam uma
prévia válida, sem sobreposição, descarte ou compactação automática dos espaços vazios.

| Elemento | Medidas nominais atuais |
| --- | --- |
| Conteúdo Sidebar, sem rail | 180 a 430 px; inicial 283 px |
| Rail persistente | 48 px; permanece quando o painel recolhe |
| Sidebar flutuante | 238 px |
| Bottom | 125 a 250 px; inicial 167 px |
| Barra de status | 25 px, com conteúdo, fora do layout dos widgets |

Os limites efetivos consideram a janela e a reserva da Main. O shell usa espaçamento de 11 px
horizontal e 9 px vertical; Sidebar tem 15 px internos de cada lado. Widgets nativos elegíveis
foram adaptados aos 150 px úteis da Sidebar mínima e aos 105 px úteis da Bottom mínima.
O gap entre widgets é 10 px. Esses adaptadores não alteram os mínimos da Main ou dos legados.

Sidebar tem rolagem vertical própria; Bottom não rola. **Ativar expansão horizontal**, em
**Configurações > Desenvolvimento e recuperação**, começa desligado e limita a expansão da Main
ao conteúdo ocupado. Projeções por viewport não gravam novas posições. Conteúdo e Workers
permanecem montados durante rolagem, transferência e recolhimento.

Mover e redimensionar individualmente exige **Editar layout**. Divisores de pares adjacentes
também funcionam no modo normal e confirmam uma transação bilateral própria. Divisores regionais
e de pares mantêm teclado em produção; os atalhos experimentais de movimento/resize individual
são exclusivos do renderer Vite de desenvolvimento. A opção **Guia e encaixe no centro** equaliza
pares horizontais da Main e Bottom em 50%; não implementa todas as guias antigas nem bypass Alt.

### Barras composições e edição

Home é protegida. Barras personalizadas têm associações e posições independentes, reordenação,
arquivamento, restauração e biblioteca. São permitidas 14 novas barras personalizadas ativas além
de Home; documentos legados com até 20 continuam legíveis sem truncamento automático.

**Salvar edição** confirma um checkpoint e mantém a edição aberta. **Cancelar** retorna ao último
checkpoint; **Concluir** valida, confirma e sai. Desfazer e refazer registram intenções completas,
com histórico de sessão em memória de até 256 entradas; não são backup persistido ou histórico Git.

Novas composições salvam formato e associações dos widgets das áreas selecionadas. Main e Bottom
têm escopo explícito; Sidebar contribui apenas com a largura, sem barras ou widgets. Painéis
recolhidos começam desmarcados, mas podem ser incluídos. Restaurar preserva as áreas omitidas.
**Formato** e **Widgets** são ações diferentes; repetir Formato pode criar reservas, preenchidas
por catálogo ou view existente após validação de encaixe exato. Reservas transitórias não são
widgets executáveis persistidos. Composições não salvam notas, tarefas ou sessões de futuros plugins.

O envelope `geppio:workbench:v1` tem validação, Web Locks e comparação dos bytes observados para
detectar conflitos. As chaves históricas permanecem como fontes de recuperação. Importar JSON e
escolher uma prévia histórica são operações explícitas de desenvolvimento/recuperação; abrir a
prévia não substitui o original. Outras preferências, como tema e idioma, usam chaves próprias,
sem transação atômica geral.

O widget demonstrativo **Propriedades** tem controles visíveis junto ao nome do projeto para
**Normal**, **Docked**, **Overlay**, abrir/recolher e escolher a altura preferida do painel.
Docked reserva espaço acima da Bottom; Overlay cobre Main sem reorganizar seu layout. A posição
Normal fica reservada e o conteúdo continua montado. Para editar a geometria de Main, escolha Normal.
Apresentação, abertura explícita, dimensões preferidas e âncora persistem no mesmo envelope, agora
com versão 2; documentos anteriores continuam legíveis. Se Docked não couber, sua altura reduz
até 220px; sem espaço para os mínimos, recolhe temporariamente com aviso. Ampliar restaura a
preferência de abertura e o tamanho quando possível. Recolher explicitamente permanece salvo.
Esse piloto não executa terminal nem amplia a API de plugins.

## Plugins locais confiáveis

Gere os exemplos com `pnpm plugins:build`. No botão **Plugins** do cabeçalho, use **Instalar pasta
local** e selecione `.local/plugin-packages/counter` e `.local/plugin-packages/pulse` separadamente.
O gerenciamento também está disponível na área de desenvolvimento das configurações.

A instalação começa desativada. Counter publica contador e ação reais; Pulse executa atividade
em segundo plano sem widget. As contribuições v1 entram no catálogo como cards **Main only** e
**single view**, com movimentação e persistência de posição pelo host. O manifesto não oferece
campos públicos de categoria, região, appearance ou ação na rail. O SDK publica texto, ação e status;
não concede filesystem, PTY, processos, rede remota, segredos, APIs entre plugins ou storage próprio.

Remover apenas a presença do widget conserva o Worker. Desativar encerra a execução e retira a
publicação; uma presença já salva pode continuar na cena com mensagem de pausa. Reativar reinicia
o estado do Counter. Instalação e enabled persistem; o conteúdo próprio não ganha persistência por
salvar o layout. Atualizações exigem remover e reinstalar o pacote gerado, não editar a cópia fonte.

Os exemplos têm `plugin.json` e TypeScript independentes em `examples/plugins/`. Instale a pasta
gerada de `.js`/`.json`, não a fonte. Pacotes adicionais compatíveis não exigem recompilar o Core.
Use somente código local revisado e confiável: Workers compartilham autoridade de origem/storage
e não certificam isolamento comunitário. Não há marketplace, broker, cofre ou superfície HTML/CSS
arbitrária. Consulte [limites do runtime e SDK](docs/architecture/plugins.md).

## Atalhos no VS Code

As tarefas **Dev**, **Start**, **Plugins** e **Check** ficam em **Terminal > Run Task**. A extensão
recomendada **Task Buttons** (`spencerwmiles.vscode-task-buttons`) também as expõe na barra de status.
Dev chama `pnpm dev --watch`; Start abre o preview, que deve usar o build correspondente; Plugins
gera os exemplos e Check executa os checks completos. Instale as dependências antes de usá-las.

Cada tarefa usa terminal dedicado e permite uma instância por janela. Encerre Dev/Start em
**Terminal > Terminate Task** antes de outro comando que escreva no mesmo `out/`. A porta Vite é
fixa; os atalhos não encerram processos iniciados por fora das tarefas.

## Dados identidade e método

A migração da [issue #6](https://github.com/rabrunos/GeppIO/issues/6) usa `geppio://app`,
`window.geppio` e `%APPDATA%\geppio`. Se o destino estiver ausente, copia dados elegíveis do perfil
`%APPDATA%\semnome` sem alterar o original. Um destino existente não é mesclado ou sobrescrito.
Feche a versão antiga, mantenha os backups e siga o [procedimento de recuperação](docs/development/renaming.md).
Origens de desenvolvimento e produção podem manter estados de layout independentes.

| Uso | Entrada |
| --- | --- |
| Planejamento e orquestração | [PROJECT_GUIDE.md](PROJECT_GUIDE.md) |
| Implementação local | [AGENTS.md](AGENTS.md) e [contrato de execução](docs/.ai/prompts/EXECUTION.md) |
| Produto e limites | [Requisitos](docs/product/requirements.md) e [arquitetura](docs/architecture/overview.md) |
| Checks e aceites | [Validação](docs/development/testing.md) e a issue relevante |

GitHub e intake já estão materializados em **rabrunos/GeppIO**, ID `1409287329`. Não repita Git init,
bootstrap ou o handoff original. [FIRST_LOCAL_RUN](docs/.ai/prompts/FIRST_LOCAL_RUN.md) é contexto
histórico da fundação, usado apenas em continuação explicitamente autorizada. O ZIP inicial não
incluía dependências, executável ou lockfile resolvido; isso descreve a origem, não o checkout atual.

`package.json` é a fonte canônica da versão; `CHANGELOG.md` registra o histórico integrado.
**Issues mantêm tarefas, decisões, evidências e aceites.** Não há banco paralelo de status/roadmap.
Commit e push seguem a [política de tarefas](docs/.ai/TASK_POLICY.md) e o escopo autorizado;
publicação e fechamento exigem autoridade própria. Adoção deliberada de nova biblioteca ou código
externo requer aprovação individual conforme a [issue #19](https://github.com/rabrunos/GeppIO/issues/19);
o gate não exige aprovação de cada nó transitivo nem invalida a stack já escolhida.
Configuração do projeto expressa defaults solicitados; verifique os valores efetivos do cliente
separadamente. Integração, CI e documentação não concedem aceite global do aplicativo.
