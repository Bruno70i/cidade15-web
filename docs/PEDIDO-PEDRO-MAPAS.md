# Solicitação sobre capacidade e detalhe dos mapas

Texto preparado para encaminhamento pelo responsável. Não foi enviado e nenhuma alteração foi feita no backend, serviço de mapas, banco ou VPS.

## O que já foi resolvido somente no frontend

- Os movimentos e o zoom não voltam a consultar `/mapas/v1/`.
- Ao abrir uma cidade, o frontend obtém metadados e a amostra das categorias necessárias, sequencialmente.
- Respostas válidas são guardadas no navegador, limitadas por espaço e identificadas pela execução/data; erros não são guardados.
- Respostas 429/502/503/504 recebem até duas novas tentativas, com espera, sem rajadas paralelas por página.
- A visão geral usa `/api/v1/cities/boundaries` e IDs das cidades para incluir outros países.

## O que precisamos solicitar ao Pedro e ao responsável pelo serviço de mapas

1. **Capacidade multiusuário:** validar concorrência e limites ativos do serviço/Nginx e realizar um teste de carga em homologação. Não basta aumentar um limite sem medir consultas, CPU, memória e banco. O frontend não pode garantir capacidade global do servidor.
2. **Rede completa com zoom detalhado:** disponibilizar um pacote municipal por execução, comprimido e armazenável em cache, ou uma forma paginada de obter os pontos/serviços. Preservar ID de execução, categorias, limites da amostra e versão do formato. Os endpoints atuais retornam até 1.000 nós e 600 estabelecimentos por categoria, mesmo quando há mais resultados; sem um novo contrato não é possível baixar a rede completa em uma chamada.
3. **Distribuição de respostas compartilhadas:** avaliar cache e compressão no servidor/reverso, preferencialmente por execução, e sinalização de indisponibilidade temporária com `Retry-After`. Isso precisa ser decidido e aplicado pelos responsáveis pela infraestrutura.

## Evidências desta revisão

- Teste isolado com 20 movimentos: versão anterior fez 85 chamadas; versão nova, 5 chamadas iniciais e nenhuma adicional.
- Medição da prévia local com dados reais de Santos: 8 consultas de dados na abertura (resumo, contornos, indicadores, metadados e quatro categorias). A contagem permaneceu em 8 após 20 movimentos, 20 alterações de zoom, troca de categorias e reabertura da cidade.
- Dois clientes locais com origens diferentes abriram Santos simultaneamente sem mensagem de mapa ocupado. Esse é um teste funcional pequeno, não uma comprovação de capacidade para muitos usuários.
- As imagens do mapa-base OpenStreetMap continuam sendo requisitadas ao visitar áreas/níveis novos. São independentes das consultas de pontos do serviço de mapas.

## Limite atual comunicado na interface

O mapa da cidade apresenta uma amostra fixa municipal. Aproximar não acrescenta mais nós à amostra. Os indicadores populacionais continuam usando os resultados completos calculados pelo backend.

Na revisão local 15, o modo Pontos amplia a amostra com quatro áreas fixas da cidade, carregadas sequencialmente e guardadas no cliente. Isso permite até 4.000 nós por categoria, sem requisições por movimento, e não substitui um endpoint de rede completa. O modo Calor mantém o carregamento inicial leve.
