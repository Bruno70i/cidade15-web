# Fonte populacional efetivamente usada em Paris

Verificação de 02/11/2026. Consultas ao banco em sessão com `default_transaction_read_only=on`; leitura dos arquivos da VPS sem alterar backend, banco, configuração ou serviços. As evidências foram salvas somente no frontend local.

## Conclusão

A fonte usada na França é **INSEE — Filosofi 2021, dados em células de 200 × 200 metros**. O INSEE é o instituto francês de estatística. Nesta verificação, a análise francesa disponível era **Paris**, cidade **647**, execução **656**, com estado concluído e processamento registrado em **02/11/2026 às 11:04:33 UTC (08:04:33 em Brasília)**.

Não foi deduzido apenas pelo país ou pelo nome de uma documentação. A cadeia de evidências foi conferida:

1. O registro da execução informa `population_source = /opt/15minute-city/data/input/france/france_2021.gpkg`, coluna `POPULATION` e identificador `ID`.
2. A seleção das células foi reproduzida lendo esse GeoPackage, com a mesma regra registrada: ponto representativo da célula coberto pelo limite municipal de Paris, em EPSG:2154.
3. O resultado reproduziu as **2.031 células** e a soma **1.972.995,5**, exatamente como os metadados da execução. Esse valor é o peso populacional da base e do recorte usados, não uma estimativa atualizada da população municipal de 2026.
4. Todos os **2.031 identificadores e valores** foram comparados com `france_metro/carreaux_200m_met.shp`: `ID` coincide com `idcar_200m`, e `POPULATION` coincide com `ind`, sem divergências.
5. Os arquivos extraídos `.shp`, `.dbf` e `.prj` foram comparados por SHA-256 com os respectivos membros do pacote `Filosofi2021_carreaux_200m_shp.zip` presente na VPS: são idênticos.

## Fontes oficiais para citar

- [INSEE — Dados em células de 200 m, Filosofi 2021](https://www.insee.fr/fr/statistiques/8735162): explica a resolução, o ano de referência e o dicionário. A variável **`ind` significa número de indivíduos**. Página publicada em 12/02/2026, com dados de referência de 2021.
- [INSEE — Publicação Filosofi 2021](https://www.insee.fr/fr/statistiques/8735243).
- [INSEE — Documentação metodológica Filosofi 2021 (PDF)](https://www.insee.fr/fr/statistiques/fichier/8735106/documentation_donnees-carroyees_filosofi2021.pdf): página impressa 2 descreve as fontes fiscais e sociais; página 3 explica a população abrangida e as exclusões; as seções de imputação explicam as estimativas nas células.
- [INSEE — Pacote original Shapefile](https://www.insee.fr/fr/statistiques/fichier/8735162/Filosofi2021_carreaux_200m_shp.zip).

## Limites que devem acompanhar a interpretação

Filosofi é uma base de **domicílios fiscais**, construída a partir de registros fiscais e sociais; não é a mesma metodologia do Censo Demográfico brasileiro. A documentação do INSEE informa exclusões, como pessoas sem domicílio e residentes em coletividades, e limitações na localização de estudantes vinculados fiscalmente aos pais. Algumas células têm valores imputados para preservar a confidencialidade. Portanto, os pesos podem incluir casas decimais.

Os percentuais do projeto dependem dessa população-base, do recorte municipal, da rede caminhável e dos serviços considerados. A fonte populacional não prova, isoladamente, um ganho de acesso de uma simulação específica. As contagens de pessoas beneficiadas foram removidas da interface conforme solicitado.

## Evidências locais

- [Metadados e lista completa das 2.031 células](paris-execucao-656.json).
- [Lista das células em CSV](paris-execucao-656-celulas.csv).
- [Conferência dos membros do ZIP original](paris-originais-insee-conferencia.json).
- [Script de auditoria somente de leitura](auditar-fonte-populacao-paris.py).

O pacote presente na VPS possui **251.878.795 bytes** e SHA-256 `d329c833e3c1e1b3fda2d25c29169a564e944ee4accc6ea3914c48ad32522ef2`.

Esse hash se refere ao pacote da VPS. Uma nova transferência diretamente do site do INSEE não terminou no limite de 150 segundos, portanto não se afirma aqui que o download atualmente servido pelo site foi comparado integralmente byte a byte. Foram conferidos integralmente os arquivos extraídos contra o pacote da VPS e todas as células usadas em Paris contra esses arquivos, além da publicação e do dicionário oficiais.
