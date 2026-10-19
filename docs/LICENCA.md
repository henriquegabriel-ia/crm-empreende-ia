# Licença da base do CRM

Este documento explica, em linguagem simples, a licença da base do CRM ([`LICENSE`](../LICENSE), na raiz do repositório): o que quem comprou o programa pode e não pode fazer, de onde veio o texto e o que ainda falta decidir. O desenho técnico está na [seção 4 do desenho da licença, das versões e da atualização](arquitetura/1.7b.md#4-a-licença).

## 1. O que é e o que não é

- **É um rascunho para revisão jurídica.** O texto da `LICENSE` ainda não foi revisado por advogado e não é a licença final. Até a versão revisada, o uso da base segue os termos do contrato do programa Empreende IA.
- **A `LICENSE` prevalece sobre esta explicação.** Se algo aqui parecer diferente do texto da licença, vale o texto da licença.
- **Não é código aberto.** É uma licença proprietária com o código-fonte entregue a quem comprou o programa. "Código-fonte disponível", na decisão D4 do roteiro, quer dizer disponível para quem comprou, e não para o público. O texto não adota nenhum modelo pronto como está, nem o Fair Source: usa a estrutura da PolyForm Internal Use, com as permissões ampliadas para a D4 (seções 3 e 4).
- **Os campos entre colchetes** (titular, CNPJ, foro e contato) só o titular preenche.
- **Na beta, vale também o [termo de beta](TERMO-BETA.md)** (as versões `1.0.0-beta.N`): o que é a beta, sem garantia, como relatar problemas, dados de teste e LGPD. Ele complementa a `LICENSE`, não amplia nenhuma permissão dela e também é um rascunho para revisão jurídica.

## 2. Posso…?

| Pergunta | Resposta | Seção da `LICENSE` |
| --- | --- | --- |
| Usar o CRM na minha empresa? | Sim. | 3 (a) |
| Implantar o CRM para um cliente e cobrar por isso? | Sim. | 3 (b) |
| Entregar ao cliente o repositório com o código da instância dele? | Sim, só para operar, manter e personalizar aquela instância. O cliente não pode repassar o código nem usá-lo para outra empresa. | 4 |
| Revender o CRM como serviço (SaaS) com a minha marca? | Sim, com marca própria. | 3 (c) e 6 |
| Atender várias empresas numa mesma instalação? | Sim, como personalização sua (a base é de uma empresa por instância). | 3 (c) |
| Tirar o crédito "Feito com Empreende.IA"? | Sim, no serviço com marca própria. Numa instância de um cliente, o crédito fica (decisão aberta, seção 6). Tirar é configuração, sem editar código ([Trocar a marca](MARCA.md)). | 6 (b) |
| Deixar a marca do programa (logo e nome) na minha instância ou na de um cliente? | Sim, como a base vem configurada, até trocar ([Trocar a marca](MARCA.md)); se precisa trocar antes de pôr em uso é decisão aberta (seção 6). No serviço revendido, não: ele usa a sua marca. Usar a marca do programa fora do CRM (anúncios, materiais, domínio) depende de autorização do titular. | 6 (a) |
| Publicar o repositório no GitHub como público? | Não. O repositório da empresa é sempre privado. | 5 (b) |
| Vender o código como modelo, kit ou curso para outros desenvolvedores? | Não. | 5 (c) |
| Dar o código a um colega que não comprou o programa? | Não. | 5 (a) |
| Contratar um freelancer ou uma agência para mexer no código? | Sim, se a pessoa se obrigar por escrito a estes termos e ao sigilo. | 3 (d) |
| Ter garantia de funcionamento? | Não: a base é fornecida como está. | 11 e 12 |

## 3. Os modelos pesquisados

Consultados em 19/10/2026, cada um no texto oficial. A decisão D4 pede quatro coisas juntas: (R1) uso comercial; (R2) implantação para clientes; (R3) revenda como SaaS com marca própria; (R4) nenhuma redistribuição do código a quem não comprou.

| Modelo | R1 | R2 | R3 | R4 | Conclusão |
| --- | --- | --- | --- | --- | --- |
| [Business Source License 1.1](https://spdx.org/licenses/BUSL-1.1.html) | Só pela *Additional Use Grant* | Pela grant | Pela grant | **Não**: qualquer pessoa pode redistribuir; vira licença aberta na *Change Date* (no máximo 4 anos) | Descartado |
| [Elastic License 2.0](https://www.elastic.co/licensing/elastic-license) | Sim | Sim | **Não**: proíbe oferecer como serviço hospedado | **Não**: permite distribuir | Descartado |
| [PolyForm Internal Use 1.0.0](https://polyformproject.org/licenses/internal-use/1.0.0) | Só operações internas | **Não** | **Não** | Sim: proíbe distribuir | **Base da estrutura**, com as permissões ampliadas |
| [PolyForm Strict 1.0.0](https://polyformproject.org/licenses/strict/1.0.0) e as outras PolyForm | Varia | Varia | Varia | A Strict proíbe distribuir e também modificar; as outras permitem distribuir | Descartados |
| [Commons Clause](https://commonsclause.com/) (sobre uma licença aberta) | Sim, menos vender | **Não**, se cobrado | **Não**: vender inclui o serviço hospedado pago | **Não** | Descartado |
| [Fair Source](https://fair.io/about/) e [Functional Source License](https://fsl.software/) | Sim, menos uso concorrente | Sim | **Não**, se concorrer com o produtor | **Não**; a FSL vira Apache 2.0 ou MIT em 2 anos | Descartados |

Nenhum modelo cumpre os quatro requisitos juntos: os que permitem a revenda como serviço deixam qualquer pessoa redistribuir o código, e os que proíbem a redistribuição também proíbem o uso para clientes. O que mais se parece com a D4 são as licenças comerciais de modelos e kits vendidos a desenvolvedores (uso em projetos próprios e de clientes, sem revender o código como modelo), que não têm um texto padrão público e reutilizável.

## 4. O que foi adaptado de onde

- **Da PolyForm Internal Use:** a forma (seções curtas e numeradas, linguagem simples), a aceitação pelo uso, a regra de não distribuir, o "sem garantia" e o "sem responsabilidade" e a violação com prazo de correção depois de notificação, adaptado de 32 para 30 dias.
- **Da decisão D4:** as permissões (uso comercial, implantação para clientes e revenda como serviço com marca própria) e a proibição de redistribuir o código a quem não comprou.
- **Da decisão D3 e do item 1.6:** o crédito "Feito com Empreende.IA", que sai no serviço com marca própria.
- **Do item 1.10:** a seção dos dados das instâncias.
- **Do guia de implantação:** a cópia entregue ao cliente (seção 4 da `LICENSE`). O [Guia de implantação](IMPLANTACAO.md#1-o-código-da-empresa) cria o repositório no GitHub da empresa; sem essa seção, entregar o repositório ao cliente seria redistribuir o código a quem não comprou.
- **Ficaram de fora**, por falta de base para escrevê-las sem advogado: a cláusula de patente (a PolyForm a tem por ter nascido no direito norte-americano), a indenização, a auditoria e a multa.

## 5. Dados das instâncias

A base não envia dados das instâncias a ninguém (não há telemetria central), e o titular da base não acessa nem trata dados pessoais de nenhuma instância. Quem implanta e opera uma instância é operador ou fornecedor, e a empresa que usa o CRM é a controladora dos dados (seção 9 da `LICENSE`). O que isso exige de cada um está em [LGPD da instância](LGPD-INSTANCIA.md).

## 6. Decisões abertas

**Para o advogado (antes da liberação ampla):**

- o texto inteiro, em especial as duas entregas do código a quem não é Licenciado: a cópia entregue ao cliente (seção 4) e a entrega a prestadores contratados, que se obrigam por escrito aos termos e ao sigilo (seção 3 (d));
- o "sem garantia" e o "sem responsabilidade" diante do Código de Defesa do Consumidor (Lei 8.078/1990), que limita cláusulas que afastam a responsabilidade do fornecedor numa relação de consumo;
- o término e a preservação das instâncias de clientes já entregues (seção 13);
- a relação com a Lei 9.609/1998 (programa de computador, em que o uso é objeto de contrato de licença) e com a Lei 9.610/1998 (direitos autorais);
- se precisa de cláusula de patente e de uma versão em inglês.

**Para o titular (dono do produto):**

- preencher o titular, o CNPJ, o foro e o contato;
- se a licença das versões já recebidas continua valendo depois do fim do acesso ao programa (o rascunho propõe que sim, seção 10);
- se o crédito pode sair também numa instância de cliente com a marca do cliente (hoje a decisão D3 só fala no serviço revendido com marca própria);
- se uma instância em uso (a do aluno ou a de um cliente, fora de aula, demonstração e teste) pode continuar com a marca padrão do programa ou precisa trocar antes de pôr em uso. A D3 e a D4 só exigem a troca no serviço revendido, e o rascunho segue isso (seção 6 (a)); os guias tratam a marca como opcional na implantação ([etapa 6](IMPLANTACAO.md#6-marca-opcional-antes-de-publicar)). Se o titular decidir exigir a troca, a seção 6 (a), essa etapa e esta página mudam juntas;
- confirmar a numeração `1.0.0-beta.N` para a distribuição antecipada ([Guia de atualização](ATUALIZACAO.md#0-versões-e-notas));
- preencher os campos do [termo de beta](TERMO-BETA.md) (canal de suporte, prazo de resposta e forma de aceite), que o advogado revisa junto com a `LICENSE`, em especial o "sem garantia" e o uso do que o aluno envia num relato.

Quando a licença revisada substituir o rascunho, o [`CHANGELOG.md`](../CHANGELOG.md) registra a mudança em "Alterado", e o aviso de rascunho sai do topo da `LICENSE`.
