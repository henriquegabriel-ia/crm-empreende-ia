/**
 * Dados de trabalho que a equipe altera ao mesmo tempo: o snapshot de Hoje, Agenda, Atividades, Tarefas, contatos e
 * empresas, e as oportunidades e próximas ações do Pipeline. Ao voltar para a aba, a tela recarrega o que tiver mais
 * de 30 s, para mostrar o que um colega acabou de fazer (o padrão do app é não recarregar no foco e considerar os
 * dados frescos por 5 min).
 *
 * Sem recarga periódica (refetchInterval): quem fica na aba vê a última leitura, e as gravações usam a guarda de
 * updated_at, que recusa sobrescrever a versão de outra pessoa. Formulários abertos guardam a versão que editam e não
 * são trocados pelo recarregamento.
 */
export const TEAM_DATA_REFRESH = { staleTime: 30_000, refetchOnWindowFocus: true } as const;
