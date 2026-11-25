# Aplicativo Standalone do GeppIO

Em um checkout preparado no Windows x64, execute um dos exemplos a partir da raiz. O diretório de destino deve ser novo e a pasta pai deve existir.

```powershell
pnpm standalone:generate examples/standalone/desk.json .local/Caderno
pnpm standalone:generate examples/standalone/board.json .local/Quadro
```

O primeiro exemplo gera `.local/Caderno/geppio-export-desk-notes.exe`. O segundo gera `.local/Quadro/geppio-export-board-and-stamp.exe`. Copie o **diretório inteiro** para outra pasta Windows x64. O executável usa o Electron e os recursos incluídos ao seu lado. O aplicativo inicia diretamente, inclusive após remover a pasta de autoria e o GeppIO.

## Definição e seleção

Use um objeto JSON com `schema: 1`, `productId`, `name` e `tiles`. Cada item tem um `id` único, `title` e `kind`. `note` mantém uma anotação e `counter` mantém uma contagem. `surface` recebe também `source`, o nome da pasta de um plugin API 3 em `plugins/` ao lado da definição. Os exemplos completos estão em [desk.json](../../examples/standalone/desk.json) e [board.json](../../examples/standalone/board.json).

Escolha um `productId` exclusivo por produto. Os identificadores aceitam de 1 a 40 caracteres, começando por uma letra minúscula e usando letras minúsculas, números e hífens. A composição admite de 1 a 16 itens. A lista define tanto a ordem de apresentação quanto as capacidades a iniciar.

Anotações e contadores usam a origem do próprio produto e chaves derivadas do tipo e do identificador de cada item. Preserve esses identificadores nas versões seguintes para continuar lendo os dados correspondentes. O gerador exige um destino novo. Se a geração falhar, inspecione o diretório parcial e selecione um destino novo para a próxima tentativa.

## Dados e transporte

Por padrão, o perfil usa `%APPDATA%/geppio-export-<productId>`. Para levar também os dados na pasta do produto, use `--portable` em um diretório gravável.

```powershell
.\.local\Caderno\geppio-export-desk-notes.exe --portable
```

Esse modo grava em `data/geppio-export-<productId>/` junto ao executável. Uma cópia da distribuição recém-gerada contém a definição, os recursos de apresentação selecionados e o runtime. Depois de usar o modo portátil, a pasta `data/` contém os dados daquela instalação. A cópia dessa pasta passa a ser uma decisão explícita de transporte de dados.

O exemplo de quadro e carimbo abre cada apresentação com seu próprio canal. Para exibir o carimbo como contribuição no quadro, marque a permissão de slot. Para consultar o serviço ou receber anúncios do quadro, marque a permissão correspondente. Reiniciar a execução exige conceder essas permissões novamente.

## Verificação

`pnpm test:isolated standalone` gera dois produtos em um diretório temporário e exercita os fluxos A/B/A/B com quatro janelas no Windows. A jornada remove a pasta de autoria, verifica os dados de cada produto, o conjunto de arquivos, a ativação seletiva, a chamada entre plugins e a remoção do slot ao revogar a permissão. A cópia de teste do desktop privado carrega a atestação antes do Main. O shard do CI hospedado lança os executáveis com os arquivos originais da geração.

A distribuição atual é uma pasta local Windows x64, sem instalador, assinatura Authenticode ou atualizador público. As superfícies exportadas usam HTML/CSS/JS preparados a partir das pastas API 3 selecionadas. A pasta gerada contém os avisos do Electron e do Chromium.
