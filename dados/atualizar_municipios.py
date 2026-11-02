"""
Baixa do IBGE os contornos dos municípios de SP e grava municipios-sp.json.

O site usa uma cópia guardada (mais rápido e sem depender do IBGE estar no ar).
Os limites quase nunca mudam; rode de novo só se precisar atualizar:

    python previa/dados/atualizar_municipios.py

Fontes (gratuitas, sem chave):
  - Malhas:     https://servicodados.ibge.gov.br/api/docs/malhas?versao=3
  - Localidades: https://servicodados.ibge.gov.br/api/docs/localidades
Usa só a biblioteca padrão do Python.
"""

import gzip
import json
import urllib.request
from pathlib import Path

UF = "SP"
MALHA = (
    f"https://servicodados.ibge.gov.br/api/v3/malhas/estados/{UF}"
    "?formato=application/vnd.geo%2Bjson&qualidade=minima&intrarregiao=municipio"
)
NOMES = f"https://servicodados.ibge.gov.br/api/v1/localidades/estados/{UF}/municipios"
DESTINO = Path(__file__).resolve().parent / "municipios-sp.json"
CASAS = 4  # 4 casas decimais ≈ 11 m, suficiente para o mapa do estado


def baixar(url: str):
    pedido = urllib.request.Request(url, headers={"User-Agent": "cidade15-web/1.0"})
    with urllib.request.urlopen(pedido, timeout=60) as resposta:
        corpo = resposta.read()
    # O IBGE responde compactado (gzip) mesmo sem pedirmos.
    if corpo[:2] == b"\x1f\x8b":
        corpo = gzip.decompress(corpo)
    return json.loads(corpo)


def arredondar(coordenadas):
    if isinstance(coordenadas[0], (int, float)):
        return [round(valor, CASAS) for valor in coordenadas]
    return [arredondar(item) for item in coordenadas]


def main():
    nomes = {str(m["id"]): m["nome"] for m in baixar(NOMES)}
    malha = baixar(MALHA)
    municipios = []
    for feicao in malha["features"]:
        codigo = feicao["properties"]["codarea"]
        geometria = feicao["geometry"]
        municipios.append({
            "type": "Feature",
            "properties": {"codigo": codigo, "nome": nomes.get(codigo, codigo)},
            "geometry": {"type": geometria["type"], "coordinates": arredondar(geometria["coordinates"])},
        })
    saida = {
        "type": "FeatureCollection",
        "fonte": "IBGE — Malhas territoriais (qualidade mínima) e Localidades",
        "features": sorted(municipios, key=lambda f: f["properties"]["nome"]),
    }
    DESTINO.write_text(json.dumps(saida, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(municipios)} municípios gravados em {DESTINO} ({DESTINO.stat().st_size // 1024} kB)")


if __name__ == "__main__":
    main()
