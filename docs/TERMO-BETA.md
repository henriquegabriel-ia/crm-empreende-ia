# Termo da versão beta da base do CRM

**RASCUNHO PARA REVISÃO JURÍDICA.** Este texto ainda não foi revisado por advogado e não é o termo final. Até a versão revisada, valem os termos do contrato do programa Empreende IA. Os campos entre colchetes só o titular preenche.

Este termo complementa a [`LICENSE`](../LICENSE) da base (também em rascunho) e não amplia nenhuma permissão dela. Em caso de conflito entre os dois, vale a `LICENSE`. As palavras com inicial maiúscula (Titular, Base, Licenciado, Cliente Final, Instância) têm o sentido da seção 1 da `LICENSE`. A explicação da licença, em linguagem simples, está em [Licença da base](LICENCA.md).

Titular: [TITULAR, RAZÃO SOCIAL E CNPJ].

## 1. O que é a beta

As versões `1.0.0-beta.1`, `1.0.0-beta.2` e seguintes são a distribuição antecipada da Base: entregues à turma de beta do programa, antes da versão candidata (`1.0.0-rc.1`, usada no piloto) e da versão final (`1.0.0`). Servem para aprender, implantar em ambiente de teste e dar retorno ao programa. Cada versão chega pelo repositório de distribuição do programa, com uma tag `vX.Y.Z`, e o que mudou fica no [`CHANGELOG.md`](../CHANGELOG.md).

## 2. Sem garantia

A beta é entregue **sem garantia** de qualquer tipo, como na seção de garantia da `LICENSE`:

- pode ter falhas, inclusive que causem perda de dados de uma Instância;
- pode mudar de forma incompatível de uma beta para outra; as notas de cada versão no `CHANGELOG.md` dizem o que fazer ao atualizar ([Guia de atualização](ATUALIZACAO.md));
- o programa não promete prazo de correção, disponibilidade nem suporte individual além do que o contrato do programa disser. Prazo de resposta aos relatos: [PRAZO DE RESPOSTA].

## 3. Como reportar problemas

Pelo canal do programa: [CANAL DE SUPORTE DO PROGRAMA]. Para o relato ser útil, leve:

- a versão, que aparece no rodapé da "Ajuda do CRM" (por exemplo, "Versão 1.0.0-beta.1");
- os passos para repetir o problema, o que você esperava e o que aconteceu;
- o print da tela e a saída dos comandos (`npm run verify-instance`, `supabase/instance-check.sql`), quando o problema for de implantação.

**Nunca mande** senha, chave (`sb_secret_`, `service_role`, token do GitHub ou da Vercel), arquivo de backup, o `.env.local` ou o `supabase/.env`, nem dados pessoais de clientes. Troque nomes, e-mails e telefones por dados fictícios antes de enviar o print.

## 4. Dados de teste

Use a beta com dados de teste, fictícios: um projeto Supabase Free e, se quiser uma base de exemplo, os dados de demonstração (`supabase/seed-demo.sql`, [Guia de implantação, etapa 13](IMPLANTACAO.md#13-dados-de-demonstração-opcional-só-aula-e-beta)). Colocar dados pessoais reais numa Instância beta é decisão e responsabilidade da empresa, que nesse caso precisa do plano Pro, do backup ([Backup e restauração](BACKUP-RESTAURACAO.md)) e dos cuidados de [LGPD da instância](LGPD-INSTANCIA.md).

## 5. LGPD

A Base e o programa **não tratam** os dados das Instâncias: cada Instância roda nas contas da empresa (Supabase e hospedagem), e o programa não tem acesso a elas. Quem implanta é operador ou fornecedor da empresa, e a empresa é a controladora dos dados, como dizem a `LICENSE` e [LGPD da instância](LGPD-INSTANCIA.md). O que o Licenciado enviar num relato é usado só para entender e resolver o problema relatado e não é compartilhado com terceiros (texto a confirmar pelo titular e pelo advogado).

## 6. Fim da beta

A beta termina com a `1.0.0-rc.1` ou com a `1.0.0`; a partir daí, este termo deixa de valer para as versões novas. A atualização segue o [Guia de atualização](ATUALIZACAO.md). Uma beta antiga deixa de receber correções quando sai a seguinte: a correção chega numa versão nova.

## 7. Aceite

[FORMA DE ACEITE, COMO O CONTRATO DO PROGRAMA DEFINIR.]
