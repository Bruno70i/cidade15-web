# Fonte populacional efetivamente usada em Guarujá

Verificação realizada em 02/11/2026, somente por leitura. Nenhum arquivo do backend, dado do banco ou serviço da VPS foi alterado. Foram criados apenas os documentos de evidência no frontend local.

## Conclusão comprovada

A execução **214**, da cidade **5 (Guarujá)**, processada em **01/11/2026 às 18h08 (America/Sao_Paulo)**, registra como fonte populacional:

`/opt/15minute-city/data/input/brazil/brasil_ibge_2022.gpkg`

O registro de `execution.population_source` e `execution.analysis_metadata.origin`, consultado em sessão PostgreSQL com `default_transaction_read_only=on`, informa:

- Coluna de população: `POPULATION`.
- Identificador de célula: `ID`.
- Células no recorte municipal: **3.541**.
- Células com população positiva: **1.192**.
- Soma da população considerada: **287.478**.
- Filtro espacial: ponto representativo da célula coberto pelo limite municipal (`representative_point_covered_by`).

A mesma seleção foi repetida lendo o GeoPackage, sem executar o pipeline de análise, e reproduziu exatamente as contagens e a soma registradas na execução. O log `logs/analises_sp_20261101_163743/cidade_204.log` também registra Guarujá, 1.192 células e peso total 287.478, seguido da preparação do pacote de simulação `214.fmc.gz`.

## Arquivos originais do IBGE

Cada uma das 1.192 células com população foi localizada nos arquivos originais do IBGE. Todos os identificadores `ID` correspondem a `ID_UNICO`, e todos os valores `POPULATION` coincidem com `TOTAL` dos originais:

| Arquivo oficial | Células com população usadas em Guarujá | População somada dessas células |
| --- | ---: | ---: |
| [grade_id25.zip](https://geoftp.ibge.gov.br/recortes_para_fins_estatisticos/grade_estatistica/censo_2022/grade_estatistica/grade_id25.zip) | 985 | 273.828 |
| [grade_id26.zip](https://geoftp.ibge.gov.br/recortes_para_fins_estatisticos/grade_estatistica/censo_2022/grade_estatistica/grade_id26.zip) | 207 | 13.650 |
| **Total** | **1.192** | **287.478** |

Os dois ZIPs foram baixados diretamente do domínio oficial do IBGE e comparados, por tamanho e SHA-256, com os arquivos presentes na VPS. Ambos são idênticos byte a byte:

| Arquivo | Bytes | SHA-256 |
| --- | ---: | --- |
| grade_id25.zip | 40.283.809 | `fa9f041962622254a17a3a5ef0f883152ce12ac925204c6be1618f545f4f37ab` |
| grade_id26.zip | 20.458.153 | `497df9f0f6d33a7db19a89dad8e94023626b7bf75bed61685779f6e74697457c` |

## Origem demográfica e resolução

Fonte oficial: **IBGE, Censo Demográfico 2022 — Grade Estatística, Notas metodológicas 01/2025**.

- [Notas metodológicas oficiais (PDF)](https://geoftp.ibge.gov.br/recortes_para_fins_estatisticos/grade_estatistica/censo_2022/Notas_metodologicas_grade_estatistica_2022.pdf).
- [Diretório oficial com os arquivos originais](https://geoftp.ibge.gov.br/recortes_para_fins_estatisticos/grade_estatistica/censo_2022/grade_estatistica/).
- O documento explica, nas páginas impressas 6–7, as células de 200 m e 1 km e a vinculação dos microdados do Censo 2022 ao CNEFE 2022.
- Na página impressa 12, o dicionário define `ID_UNICO` como o identificador da célula e `TOTAL` como o total de população na célula.
- Todas as 1.192 células com população selecionadas para essa execução de Guarujá têm identificadores `200M`, correspondentes à resolução de **200 × 200 metros**.

O total 287.478 é a soma do recorte adotado pelo processamento. Não representa uma estimativa populacional atualizada para 2026 nem foi conferido aqui como sendo o total municipal publicado em outra tabela do IBGE. A regra de seleção das células e o limite municipal usado pelo projeto influenciam esse recorte.

## Evidências entregues

- [guaruja-execucao-214-celulas.csv](guaruja-execucao-214-celulas.csv): relação das 1.192 células, com ID original, população, ZIP de origem e latitude/longitude do ponto representativo da célula. Essas coordenadas não são endereços de moradores.
- [guaruja-execucao-214.json](guaruja-execucao-214.json): metadados da execução, conferência dos arquivos oficiais, hashes e relação completa das células verificadas.

## O que esta verificação não comprova

O número **4.526 pessoas a mais** é um resultado derivado dos percentuais da simulação pelo frontend, e não uma contagem publicada pelo IBGE para o ponto clicado. Esta verificação comprova a fonte e a população-base da execução. Não reconstitui quais células passaram a ser atendidas naquela simulação específica: para isso seriam necessários os locais exatos enviados e a comparação das rotas antes/depois. A cor do mapa de calor continua representando a situação anterior à simulação.
