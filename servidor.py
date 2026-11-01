"""
Servidor local do site cidade15-web.

Faz no seu PC o mesmo papel que o nginx faz na VPS:
  1. Entrega os arquivos do site (index.html, *.js, *.css, metodologia/, vendor/).
  2. Repassa os pedidos /api/... (API do Pedro, com a chave X-API-Key) e
     /mapas/v1/... (serviço de mapas) para o servidor definido em API_URL.
     Assim a chave nunca aparece no JavaScript.

Como rodar:  python servidor.py   e abrir http://localhost:8080
Usa só a biblioteca padrão do Python (nada para instalar).
API_URL precisa ser https://cidade15.com.br (o serviço de mapas não responde pelo IP).
"""

import json
import os
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PASTA = Path(__file__).resolve().parent

# Caminhos repassados ao servidor remoto (os mesmos que o nginx repassa na VPS).
PREFIXOS_REMOTOS = ("/api/", "/mapas/v1/")

# Arquivos que NUNCA são entregues ao navegador (as mesmas regras do nginx).
EXTENSOES_BLOQUEADAS = (".py", ".md")


def caminho_bloqueado(caminho: str) -> bool:
    """Bloqueia arquivos ocultos (.env, .git...) e arquivos .py/.md."""
    partes = [p for p in caminho.split("/") if p]
    return any(p.startswith(".") for p in partes) or caminho.lower().endswith(EXTENSOES_BLOQUEADAS)


def ler_env(caminho: Path) -> dict:
    """Lê um arquivo .env simples (linhas CHAVE=valor; '#' é comentário)."""
    valores = {}
    if caminho.exists():
        for linha in caminho.read_text(encoding="utf-8").splitlines():
            linha = linha.strip()
            if linha and not linha.startswith("#") and "=" in linha:
                chave, valor = linha.split("=", 1)
                valores[chave.strip()] = valor.strip()
    return valores


# Variáveis de ambiente do sistema têm prioridade sobre o arquivo .env.
config = {**ler_env(PASTA / ".env"), **os.environ}
API_URL = config.get("API_URL", "").rstrip("/")
API_KEY = config.get("API_KEY", "")
PORTA = int(config.get("PORTA", "8080"))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PASTA), **kwargs)

    def do_GET(self):
        if self.path.startswith(PREFIXOS_REMOTOS):
            self.repassar_para_api()
            return

        caminho = self.path.split("?", 1)[0]
        if caminho_bloqueado(caminho):
            self.send_error(404, "Arquivo nao encontrado")
            return
        # O próprio Python entrega o arquivo (e o index.html das pastas).
        super().do_GET()

    def list_directory(self, path):
        """Não mostra a lista de arquivos de uma pasta (ex.: /vendor/)."""
        self.send_error(404, "Arquivo nao encontrado")
        return None

    def do_POST(self):
        """Só pedidos /api/ podem ser enviados com POST (ex.: a simulação)."""
        if not self.path.startswith("/api/"):
            self.send_error(404, "Arquivo nao encontrado")
            return
        tamanho = int(self.headers.get("Content-Length", 0))
        corpo = self.rfile.read(tamanho)
        self.repassar_para_api(corpo)

    def repassar_para_api(self, corpo=None):
        """Faz o pedido à API da VPS e devolve a resposta ao navegador."""
        pedido = urllib.request.Request(
            API_URL + self.path,
            data=corpo,
            method="POST" if corpo is not None else "GET",
            headers={
                # O Cloudflare bloqueia o nome padrão "Python-urllib" (erro 1010).
                "User-Agent": "cidade15-web-servidor-local/1.0",
                "X-API-Key": API_KEY,
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(pedido, timeout=30) as resposta:
                self.responder(resposta.status, resposta.read())
        except urllib.error.HTTPError as erro:
            # A API respondeu com erro (401 chave errada, 404 não encontrado...):
            # repassamos o mesmo código e a mesma mensagem.
            self.responder(erro.code, erro.read())
        except (urllib.error.URLError, TimeoutError) as erro:
            # Nem chegou na API (sem internet, VPS fora do ar, endereço errado).
            corpo = json.dumps({"detail": f"Nao foi possivel falar com a API: {erro}"})
            self.responder(502, corpo.encode("utf-8"))

    def responder(self, status: int, corpo: bytes):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)


if __name__ == "__main__":
    if not API_URL or not API_KEY or API_KEY == "COLE_A_CHAVE_AQUI":
        raise SystemExit("Configure API_URL e API_KEY no arquivo .env antes de rodar.")

    # 127.0.0.1 = só este computador acessa (ninguém da rede consegue entrar).
    servidor = ThreadingHTTPServer(("127.0.0.1", PORTA), Handler)
    print(f"Site no ar em http://localhost:{PORTA}  (API: {API_URL})")
    print("Para parar: Ctrl+C")
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor parado.")
