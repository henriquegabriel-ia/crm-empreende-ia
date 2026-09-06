# Receptor de revisões da Fecha IA

As funções desta pasta recebem uma **nota comercial revisada** e, quando solicitada com atribuição e prazo explícitos, uma tarefa. Não enviam mensagens, não importam a transcrição completa e não alteram oportunidades nem pagamentos.

## Configuração do projeto CRM

Aplicar a migração `20260906075018_fecha_ai_review_receiver.sql` depois da cadeia comercial existente e publicar as funções `fecha-ai-integration` e `manage-fecha-ai-connections`. Esta implementação e seus testes não publicam nem alteram projetos remotos.

O runtime usa `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` do próprio projeto CRM. Configurar `CRM_ALLOWED_ORIGINS` com as origens exatas da interface CRM, separadas por vírgula. Não usar curinga. O gerenciamento confirma o JWT atual com Supabase Auth e revalida dono/administrador e organização no banco. O receptor recusa requisições com `Origin`, porque seu transporte é entre servidores.

Em Integrações do CRM, um dono ou administrador autoriza uma conexão, informa o ID da organização da Fecha IA e seleciona os atores CRM permitidos. A credencial `fecrm_…` contém 256 bits aleatórios, aparece somente na resposta de criação e deve ser cadastrada no servidor Fecha IA. O CRM persiste somente SHA-256. A validade deve ficar entre uma hora e 90 dias; revogação bloqueia imediatamente novas operações. Para renovar a credencial, criar uma nova conexão e revogar a antiga.

Todas as operações de gerenciamento incluem `organizationId` esperado: ele é uma guarda contra troca de organização, e nunca a autoridade para escolher onde gravar. A organização vem do perfil verificado. Nenhum papel pode consultar diretamente tokens, hashes ou recibos pelas tabelas da Data API.

## Protocolo v1

`POST /functions/v1/fecha-ai-integration`, com `Authorization: Bearer fecrm_<64 caracteres hexadecimais>`, aceita cinco operações estritas em `crm-contract.ts`:

- `describe`: identidade da conexão, validade, capacidades e atores permitidos ainda ativos.
- `lookup`: opções de contato, empresa, oportunidade ou responsável, com organização e IDs explícitos; busca literal, até 50 opções e cursor UUID.
- `validate`: valida o envelope e retorna os nomes dos vínculos para prévia, sem escrever atividades.
- `deliver`: persiste nota, tarefa opcional e recibo em uma transação. `renderCrmReviewNote` define o texto exato compartilhado com a prévia Fecha IA.
- `receipt`: retorna recibo histórico persistido. Ausência retorna HTTP 404 com código `receipt_not_found`.

A chave identifica conexão, organização de origem, conversa e revisão confirmada. SHA-256 cobre o envelope canônico sem o próprio hash. Repetição da mesma chave e hash devolve os mesmos IDs; conteúdo diferente retorna 409. Nenhuma resposta de aceitação em fila é interpretada como recibo persistido.

`append_note_preserve_task` exige o último recibo da mesma conversa, uma revisão crescente e os mesmos vínculos. Acrescenta uma nota e preserva a tarefa anterior, inclusive edições e conclusão feitas no CRM. Não cria outra tarefa nem modifica a existente. Tarefa anterior excluída ou alterada para outro tipo exige resolução e retorna `previous_task_missing`. Troca de vínculos retorna `target_change_requires_resolution`.

O RPC é exclusivo de `service_role`, revalida token, expiração, escopo, ator, responsável e vínculos sob bloqueios de transação. O ator aprovado é aplicado a claims locais somente durante a gravação, para que os gatilhos nativos de autoria e auditoria registrem a identidade correta. As claims anteriores são restauradas; erro desfaz toda a transação. Resultado e pagamento permanecem texto da nota.

## Verificação local

Executar `deno task --config supabase/functions/deno.json check`, `deno task --config supabase/functions/deno.json test` e `bash scripts/test-database.sh` (PostgreSQL e Deno instalados). O script cria e remove um cluster descartável, aplica todas as migrações, verifica isolamento e atomicidade, envia 20 repetições concorrentes e valida os recibos PostgreSQL reais contra os schemas/hash portáteis. `CRM_RUN_ADVISORS=1 bash scripts/test-database.sh` também solicita advisors de segurança ao cluster local. Fixtures são sintéticas; não contêm tokens operacionais ou clientes reais.
