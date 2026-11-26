# GeppIO Editor

O pacote local inclui a API básica do Monaco 0.58.0, integração opcional de Workers com Vite e declarações TypeScript. Use a configuração de produção `worker: { format: 'es' }` do Vite. Disponibilize os assets produzidos pelo build na mesma origem do aplicativo. O Monaco traz os estilos da sua interface por seus módulos ESM.

```ts
import { acquireWorkers, createBasicEditor, createModel, setTheme } from '@geppio/editor'
import { createViteWorker } from '@geppio/editor/vite-workers'
import '@geppio/editor/styles.css'

const workers = acquireWorkers(createViteWorker)
const model = createModel('const mensagem = "Olá"', 'javascript')
const editor = createBasicEditor(container, { model, ariaLabel: 'Código' })
setTheme('vs-dark')

// Ao fechar a apresentação
editor.dispose()
// Ao fechar o documento e o último consumidor
model.dispose()
workers.dispose()
```

Reserve largura e altura para `container`. Em React, crie e descarte a apresentação em um efeito. Mantenha o modelo no dono da sessão. Duas apresentações podem compartilhar o mesmo modelo e histórico e preservar seleções e rolagem separadas. Cada modelo usa texto de edição LF. No GeppIO, EditorSession reconcilia o texto com os finais de linha originais e DocumentStore responde pela codificação e pelos bytes confirmados.

A inicialização dos Workers é explícita. Clientes na mesma página devem usar a mesma função de criação e liberar a referência após seus editores. Outra integração pode fornecer uma fábrica para os rótulos editor, JSON, TS/JS, HTML e CSS. O pacote inclui avisos de terceiros em `legal/`. O uso local mantém a decisão da Issue #49 sobre a versão do Monaco. Uma distribuição pública requer a revisão prevista nessa decisão.
