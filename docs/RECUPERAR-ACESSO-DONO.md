# Recuperar o acesso de dono

Procedimento de emergência (break-glass) para devolver o papel de **Dono** do CRM a uma conta, quando ninguém mais consegue fazer isso pela tela **Equipe**. Vale para qualquer instância do CRM a partir do item 1.1 do [roteiro](ROADMAP-FINALIZACAO.md), que criou a função `private.restore_owner`.

## Quando usar

Use só quando a tela **Equipe** não resolve:

- o único dono perdeu o papel (por exemplo, foi rebaixado por engano) e não há outro dono para devolvê-lo;
- uma pessoa estranha fez o primeiro cadastro logo depois da publicação e ficou com o papel de Dono, e o dono real não consegue entrar (o CRM só aceita conta nova com convite);
- a conta do dono existe, mas ficou sem empresa.

Se ainda existe outro dono, não use este guia: ele entra no CRM, abre **Equipe** e usa **Alterar papel**.

## Aviso de segurança

- O editor SQL do painel do Supabase tem **acesso total** ao banco: ignora a RLS e as permissões do CRM. Só quem administra o projeto Supabase da instância deve usá-lo.
- Proteja a conta do Supabase com verificação em duas etapas e não compartilhe o acesso ao painel.
- **Confira o e-mail antes de rodar.** Um erro de digitação dá o papel de Dono a outra pessoa, que passa a ver e alterar todos os dados da empresa.
- Rode só os comandos deste guia, com o e-mail certo: as consultas só leem dados, e o único comando que altera algo é o `restore_owner`. **Nunca cole no editor SQL um código enviado por outra pessoa**, mesmo que pareça vir do suporte.
- A alteração fica registrada no histórico de alterações, em **Administração → Segurança**, como **Alteração** ou **Criação** de **Permissão** (ou **Criação** de **Convite**, quando não há conta com o e-mail). A tela não mostra quem fez cada alteração; para conferir que veio do painel, use a consulta do histórico abaixo: as linhas sem autor (`user_id` vazio) vieram do editor SQL.

## Passo a passo

1. Entre no painel do Supabase com a conta que administra o projeto da instância e abra o projeto do CRM.
2. Abra **SQL Editor** e crie uma consulta nova (**New query**).
3. Cole o comando, trocando o e-mail pelo da conta que deve ser dona:

   ```sql
   select private.restore_owner('dono@empresa.com.br');
   ```

4. Confira o e-mail mais uma vez e clique em **Run**.
5. Leia a resposta na aba **Results** e siga a linha correspondente da tabela abaixo.

A função aceita o e-mail com maiúsculas ou espaços nas pontas. Se a instância tiver mais de uma organização (só acontece em instâncias antigas ou personalizadas), ela pede o ID da organização no segundo parâmetro: `select private.restore_owner('dono@empresa.com.br', '<ID da organização>');`. A consulta de conferência abaixo mostra os IDs.

## O que cada resposta significa

| Resposta | O que aconteceu | Próximo passo |
| --- | --- | --- |
| "A conta … agora tem o papel de Dono." | A conta já era da empresa e voltou a ser dona. | Entrar no CRM com essa conta. |
| "A conta … entrou na empresa com o papel de Dono." | A conta existia sem empresa e foi colocada na empresa como dona. | Entrar no CRM com essa conta. |
| "Não há conta com este e-mail. Convite de dono criado: abra <endereço do CRM>/?invite=…, cadastre-se com este e-mail e confirme-o." | Não havia conta com o e-mail; foi criado um convite de dono, válido por 7 dias. | Seguir [Depois do convite de dono](#depois-do-convite-de-dono). |
| Erro "Este CRM ainda não tem empresa…" | A instância não tem empresa: nada foi alterado. | Entrar (ou se cadastrar) com o e-mail e usar **Criar empresa**. |
| Erro "Este CRM tem N organizações. Informe qual em p_org_id." | A instância tem mais de uma organização: nada foi alterado. | Rodar a consulta de conferência e repetir o comando com o ID da organização. |
| Erro "A conta … pertence a outra organização deste CRM…" ou "A organização … não existe neste CRM." | O ID informado não confere: nada foi alterado. | Conferir o ID com a consulta abaixo. |
| Erro "Há N contas com o e-mail …" | Há contas repetidas no Auth: nada foi alterado. | Remover a conta indevida em **Authentication → Users** e rodar de novo. |
| Erro "A conta … ainda não confirmou o e-mail, e o papel de Dono só vai para conta confirmada…" | A conta existe, mas o e-mail nunca foi confirmado: nada foi alterado. Uma conta assim pode ter sido criada por outra pessoa com o seu e-mail e uma senha que só ela conhece. | Excluir a conta em **Authentication → Users**, rodar de novo e seguir a nova resposta: com a empresa criada, sem conta, o comando cria um convite de dono, e o aceite pelo convite exige a prova do e-mail (o link de confirmação) e a criação da senha. |
| Erro "A conta … não tem perfil no CRM." | A conta existe no Auth, mas o CRM não criou o perfil dela (por exemplo, foi criada antes da instalação do CRM): nada foi alterado. | Excluir a conta em **Authentication → Users**, rodar de novo e seguir a nova resposta (com a empresa criada, o convite de dono). |
| Erro "Informe o e-mail da conta que deve ficar com o papel de Dono." | O comando foi rodado sem e-mail (ou só com espaços): nada foi alterado. | Repetir com o e-mail entre aspas simples, como no passo 3. |

Os erros não alteram nada: o comando pode ser repetido depois da correção.

## Depois do convite de dono

Quem está com o papel de Dono vê esse convite em **Equipe** e pode revogá-lo. Sabendo o e-mail, também pode criar antes a conta desse e-mail com uma senha própria, mas isso não lhe dá mais a conta: quando o dono do e-mail a confirma pelo link, o banco descarta a senha anterior (reforço do item 1.1, de 12/10/2026), e o aceite exige a prova do e-mail. Mesmo assim:

1. Logo depois de rodar o comando, confira que ninguém criou a conta desse e-mail (o comando acabou de dizer que não havia nenhuma):

   ```sql
   select email, email_confirmed_at as confirmada_em, created_at as criada_em
   from auth.users
   where lower(email) = lower('dono@empresa.com.br');
   ```

   Se aparecer uma conta que você não criou, exclua-a em **Authentication → Users**: ela não daria acesso a quem a criou, mas assim o nome dela também some.

2. Abra o endereço do CRM com o `?invite=` informado, informe o nome e esse mesmo e-mail na aba **Cadastrar** e abra o link que chega no e-mail. O CRM pede que você crie a senha em **Crie sua senha** e aceite o convite; a senha nasce aí, e as outras sessões abertas com esse e-mail são encerradas.
3. Se o aceite disser "Convite não encontrado", o convite foi revogado. Rode o comando de novo: com a conta já confirmada, ele a coloca na empresa como dona, sem passar pelo aceite. Nesse caso, siga o passo 1 de [Depois de recuperar](#depois-de-recuperar) antes de qualquer outra coisa.

Em vez do cadastro pelo link (passo 2), quem administra o projeto pode criar a conta em **Authentication → Users → Add user → Create new user**, com esse e-mail, uma senha forte e **Auto Confirm User** marcado (o convite de dono libera o e-mail para o cadastro), e rodar o comando de novo, que coloca a conta na empresa como dona. Aqui o Auto Confirm é necessário, ao contrário do que o [guia de publicação](PUBLICACAO-CRM.md#primeiro-dono-e-convites) recomenda para as demais contas criadas pelo painel: o comando recusa conta não confirmada, e o painel não envia o e-mail de confirmação. Assim, a recuperação não depende de o convite continuar valendo. A pessoa entra com essa senha, segue [Depois de recuperar](#depois-de-recuperar) e, em **Equipe**, revoga o convite de dono que sobrou para o e-mail dela.

## Consulta de conferência

Mostra o e-mail e o papel de cada pessoa da empresa, e o ID da organização:

```sql
select o.id as organizacao, o.name as empresa, u.email, r.role as papel
from public.user_roles r
join public.organizations o on o.id = r.org_id
join auth.users u on u.id = r.user_id
order by o.name, r.role, u.email;
```

`owner` é Dono, `admin` é Administrador, `member` é Colaborador e `viewer` é Somente leitura.

## Consulta do histórico

Mostra as últimas alterações sem autor, que são as feitas pelo editor SQL do painel (como este procedimento):

```sql
select created_at as quando, entity_type as registro, action as acao, changed_fields as campos
from public.audit_logs
where user_id is null
order by created_at desc
limit 10;
```

`user_roles` é Permissão e `invitations` é Convite; `create` é Criação, `update` é Alteração e `delete` é Exclusão.

## Depois de recuperar

1. Em qualquer caso, defina uma senha nova para a conta que voltou a ser dona antes de usar o CRM: na tela de entrada do CRM, informe o e-mail na aba **Entrar**, use **Esqueceu a senha?** e siga o link que chega por e-mail. A troca encerra as outras sessões dessa conta, e nenhuma senha antiga continua valendo. Vale também para quem entrou pelo convite de dono: a senha criada no aceite já é só dela, mas, se o convite foi revogado e o comando rodado de novo (ou a conta foi criada pelo painel), a conta virou dona sem passar por ele. Uma sessão aberta antes da troca ainda lê os dados até o acesso dela expirar (1 hora, no padrão do Supabase).
2. Entre no CRM com a conta que voltou a ser dona, abra **Equipe**, rebaixe quem não deveria ser dono (**Alterar papel**, de preferência para Somente leitura) e revogue os convites que não reconhece.
3. Se uma pessoa estranha fez o primeiro cadastro:
   - peça a cada pessoa que administra o CRM que também defina uma senha nova por **Esqueceu a senha?**;
   - liste no editor SQL as contas que nunca confirmaram o e-mail e exclua em **Authentication → Users** as que ninguém da equipe reconhece. Antes da empresa, qualquer pessoa podia criar conta com o e-mail de outra, e uma conta assim guarda uma senha que só quem a criou conhece:

     ```sql
     select email, created_at as criada_em
     from auth.users
     where email_confirmed_at is null
     order by created_at;
     ```

   - confira os dados criados no CRM.

**Limite atual:** rebaixar uma conta não corta o acesso dela. Com o papel Somente leitura, ela não altera nada, mas continua lendo os dados da empresa. Desativar um membro, que corta o acesso, chega com o item 1.2 do roteiro.
