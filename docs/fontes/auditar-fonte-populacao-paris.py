"""Leitura da execucao 656 e dos arquivos populacionais, sem alterar a VPS.

Executar na VPS com Python do projeto, via stdin e -B. Saida: JSON em stdout.
"""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import subprocess
import geopandas as gpd
from shapely.geometry import shape


def select(query):
    result = subprocess.run([
        'sudo', '-u', 'postgres', 'env',
        'PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=8000',
        'psql', '-X', '-d', 'fifteen_minute_city', '-At', '-v', 'ON_ERROR_STOP=1', '-c', query,
    ], check=True, capture_output=True, text=True)
    return json.loads(result.stdout)


record = select("SELECT json_build_object('execution_id',id,'city_id',city_id,'processed_at',processed_at,'population_source',population_source,'analysis_metadata',analysis_metadata) FROM execution WHERE id=656")
boundary = gpd.GeoDataFrame(geometry=[shape(select('SELECT ST_AsGeoJSON(geom_boundary) FROM city WHERE id=647'))], crs=4326).to_crs(2154)
source = Path(record['population_source'])
origin = record['analysis_metadata']['origin']
grid = gpd.read_file(source, layer='population', bbox=tuple(boundary.total_bounds))
grid = grid[grid.geometry.representative_point().covered_by(boundary.geometry.union_all())]
assert len(grid) == origin['municipality_feature_count'] == 2031
assert float(grid.POPULATION.sum()) == origin['total_population'] == 1972995.5
raw_path = source.parent/'france_metro/carreaux_200m_met.shp'
raw = gpd.read_file(raw_path, bbox=tuple(boundary.total_bounds))
lookup = {str(cell.idcar_200m): float(cell.ind) for _, cell in raw.iterrows()}
cells = []
for _, cell in grid.sort_values('ID').iterrows():
    assert lookup[cell.ID] == float(cell.POPULATION)
    cells.append({'id': cell.ID, 'population': float(cell.POPULATION)})
archive = source.parent/'Filosofi2021_carreaux_200m_shp.zip'
with archive.open('rb') as stream:
    digest = hashlib.file_digest(stream, 'sha256').hexdigest()
print(json.dumps({
    'checked_at_utc': datetime.now(timezone.utc).isoformat(), 'mode': 'read_only',
    'execution_id': 656, 'city_id': 647, 'city': 'Paris', 'country': 'France',
    'processed_at': record['processed_at'], 'population_source': str(source),
    'origin_metadata': origin, 'selected_cells': len(grid),
    'population_sum': float(grid.POPULATION.sum()),
    'all_selected_ids_and_population_values_match_raw_insee_shapefile': True,
    'raw_population_column': 'ind', 'raw_id_column': 'idcar_200m',
    'source_file': {'name': archive.name, 'bytes': archive.stat().st_size, 'sha256': digest,
        'official_url': 'https://www.insee.fr/fr/statistiques/fichier/8735162/Filosofi2021_carreaux_200m_shp.zip'},
    'cells': cells,
}, ensure_ascii=True))
