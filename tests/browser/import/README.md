# Fixture da importação de planilha

`contatos-5000.csv` é a planilha sintética do E2E da importação (item 1.11 do [roteiro](../../../docs/ROADMAP-FINALIZACAO.md); seção 11.3 do [desenho](../../../docs/arquitetura/1.11.md)): 5.000 linhas com dados, no formato do "CSV (separado por vírgulas)" do Excel em português (Windows-1252, ";" e CRLF), com o cabeçalho em sinônimos (`Nome completo;E-mail;Celular;Empresa;Cargo;Origem;Responsável;Situação;Observações;Não contatar;Base legal;Registro da base legal;Data de nascimento`, a última ignorada), duas linhas em branco no meio e repetidas e erros conhecidos. Nada é dado real: os nomes, os e-mails (em `example.test`), as empresas, os cargos, as origens e as situações saem do gerador do item 0.10 ([volume-data.mjs](../../../scripts/lib/volume-data.mjs)), com a semente fixa, e os telefones são montados pela posição da linha.

O arquivo é gerado por [import-fixture.mjs](../../../scripts/lib/import-fixture.mjs), que também devolve as contagens esperadas (`expected`), calculadas pela construção de cada linha, sem o código do app. `scripts/lib/import-fixture.test.mjs` confere que o arquivo versionado tem os mesmos bytes do gerador e que a análise do app (`src/lib/contact-import.ts`) chega às mesmas contagens; `tests/browser/import.spec.ts` confere a prévia e a gravação na tela, com a fixture do navegador `withContactImport` (a equipe do item 1.2, com o Fulano Vendedor desativado, e os contatos com telefones nos formatos antigos).

Para mudar a fixture, edite o gerador e regenere o arquivo:

```bash
node scripts/lib/import-fixture.mjs --write
```

O `.gitattributes` marca `tests/browser/import/*.csv` como binário: o Git não troca o CRLF nem mexe no Windows-1252.
