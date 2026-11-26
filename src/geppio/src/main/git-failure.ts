import { ExplorerFailure } from './explorer.ts'
import type { GitError, GitResult } from '../shared/git.ts'

const messages: Record<GitError, string> = {
  'not-repository': 'A pasta selecionada não contém .git. Selecione a raiz exata do repositório; pastas internas não são descobertas automaticamente.',
  version: 'Versão do Git não suportada. Este piloto requer Git para Windows 2.40 ou superior na instalação padrão.',
  uncertain: 'O Git pode ter alterado o índice antes da interrupção. Atualize para conferir; a operação não será repetida nem desfeita automaticamente.',
  invalid: 'Solicitação Git inválida.', stale: 'A pasta ou a consulta Git mudou. Atualize ou selecione a pasta novamente.',
  busy: 'Aguarde a consulta Git em andamento.', unsupported: 'Operação Git não suportada para este formato ou arquivo. O status pode continuar disponível quando uma ação individual é recusada.',
  limit: 'Limite Git excedido: 512 alterações, 256 KiB por texto, 64 MiB de metadados ou 20.000 entradas. Escolha um repositório menor.',
  unavailable: 'Não foi possível consultar o Git. Atualize e tente novamente.', missing: 'Git para Windows não encontrado na instalação padrão em Arquivos de Programas.', timeout: 'A consulta Git excedeu 15 segundos. Tente um repositório menor.'
}
/** Main-only categories. Never contain filenames, configuration values or native paths. */
export type GitFailureReason = 'layout' | 'metadata' | 'configuration' | 'index' | 'worktree-redirect' | 'worktree-special' | 'worktree-rules' | 'worktree-budget' | 'history-mode' | 'history-binary' | 'history-blob-size'
const reasons: Partial<Record<GitFailureReason, string>> = {
  'history-mode': 'Comparação histórica indisponível para links simbólicos e submódulos.',
  'history-binary': 'Comparação histórica indisponível para conteúdo binário ou texto fora de UTF-8.',
  'history-blob-size': 'Comparação histórica indisponível: um dos textos excede 256 KiB.',
  layout: 'Formato de repositório não suportado: selecione uma raiz local com diretório .git próprio, sem worktree vinculado, repositório aninhado ou histórico raso.',
  metadata: 'Metadados Git recusados: link, redirecionamento de objetos, arquivo especial ou estrutura incompatível. Nenhum reparo automático foi feito.',
  configuration: 'Configuração Git não suportada: filtros, extensões ou redirecionamentos nativos exigem outro escopo seguro. Nenhum programa do projeto foi executado.',
  index: 'Formato ou caminho do índice Git não suportado para esta consulta.',
  'worktree-redirect': 'Um caminho visível redireciona a árvore de trabalho ou tem tipo de link que não pode ser confirmado com segurança. Dependências não rastreadas e ignoradas não são percorridas.',
  'worktree-special': 'A árvore de trabalho visível contém um arquivo ou nome não suportado. Entradas ignoradas não são abertas.',
  'worktree-rules': 'As regras locais de ignore/atributos não puderam ser confirmadas com segurança. Confira links, tamanho ou alterações simultâneas nesses arquivos.'
}
export class GitFailure extends Error {
  readonly kind: GitError
  readonly reason?: GitFailureReason
  constructor(kind: GitError, reason?: GitFailureReason) { super(messages[kind]); this.kind = kind; this.reason = reason }
}
export function gitFailure(error: unknown): GitResult {
  const code = error instanceof GitFailure || error instanceof ExplorerFailure ? error.kind : 'unavailable'
  return { ok: false, code, error: error instanceof GitFailure && error.reason ? reasons[error.reason] ?? messages[code] : messages[code] }
}
