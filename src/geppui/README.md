# GeppUI

Controles React para Chromium e navegadores com suporte a dialog, popover, ResizeObserver e Pointer Events. Instale o arquivo local de `@geppio/ui` junto com React 19.3.0. Importe a folha de estilos uma vez no ponto de entrada. O tema escuro usa `document.documentElement.dataset.theme = 'dark'`. Rótulos e decisões de abertura pertencem ao consumidor.

```tsx
import { IconButton, Dialog } from '@geppio/ui'
import '@geppio/ui/styles.css'

function Ajuda({ aberta, abrir, fechar }) {
  return <>
    <IconButton label="Abrir ajuda" onClick={abrir}>?</IconButton>
    {aberta && <Dialog title="Ajuda" closeLabel="Fechar" close={fechar}>
      <p>Use as setas para navegar.</p>
    </Dialog>}
  </>
}
```

`Popover` recebe o estado de abertura, uma âncora ou ponto em pixels CSS, o conteúdo e o callback de fechamento. `ScrollArea` acompanha as direções de rolagem disponíveis. O módulo puro `@geppio/ui/layout` exporta cálculo de limites e movimento de teclado para quadros flutuantes.

Na raiz do monorepo, `pnpm libraries:pack` gera os pacotes locais com JavaScript, tipos e CSS.
