from __future__ import annotations

import json
import re
import subprocess
import sys
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "CONTROLE DE CONSUMO"
ERROS = []
AVISOS = []


def erro(msg):
    ERROS.append(msg)
    print("ERRO:", msg)


def aviso(msg):
    AVISOS.append(msg)
    print("AVISO:", msg)


class ColetorHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ids = []
        self.labels = []
        self.refs = []
        self.imgs_sem_alt = 0
        self._form_depth = 0
        self.buttons_sem_type_em_form = 0

    def handle_starttag(self, tag, attrs_list):
        attrs = dict(attrs_list)
        if attrs.get("id"):
            self.ids.append(attrs["id"])
        if tag == "label" and attrs.get("for"):
            self.labels.append(attrs["for"])
        if tag == "img" and "alt" not in attrs:
            self.imgs_sem_alt += 1
        if tag == "form":
            self._form_depth += 1
        elif tag == "button" and self._form_depth and not attrs.get("type"):
            self.buttons_sem_type_em_form += 1
        for attr in ("href", "src"):
            if attrs.get(attr):
                self.refs.append((tag, attr, attrs[attr]))

    def handle_endtag(self, tag):
        if tag == "form" and self._form_depth:
            self._form_depth -= 1


def local_path(base_html, ref):
    ref = ref.strip()
    if not ref or ref.startswith(("#", "mailto:", "tel:", "data:", "javascript:")):
        return None
    parts = urlsplit(ref)
    if parts.scheme or parts.netloc:
        return None
    caminho = unquote(parts.path)
    if not caminho:
        return None
    return (base_html.parent / caminho).resolve()


def auditar_html(path, versao):
    texto = path.read_text(encoding="utf-8")
    parser = ColetorHTML()
    try:
        parser.feed(texto)
    except Exception as exc:
        erro(f"{path.relative_to(ROOT)}: HTML invalido: {exc}")
        return

    duplicados = [x for x, n in Counter(parser.ids).items() if n > 1]
    if duplicados:
        erro(f"{path.relative_to(ROOT)}: IDs duplicados: {', '.join(duplicados)}")

    ids = set(parser.ids)
    labels_quebrados = sorted({x for x in parser.labels if x not in ids})
    if labels_quebrados:
        erro(f"{path.relative_to(ROOT)}: label for sem campo: {', '.join(labels_quebrados)}")

    if parser.imgs_sem_alt:
        aviso(f"{path.relative_to(ROOT)}: {parser.imgs_sem_alt} imagem(ns) sem alt")
    if parser.buttons_sem_type_em_form:
        erro(f"{path.relative_to(ROOT)}: botao em form sem type explicito")
    if "<title" not in texto.lower():
        erro(f"{path.relative_to(ROOT)}: sem title")
    if "name=\"viewport\"" not in texto.lower() and "name='viewport'" not in texto.lower():
        erro(f"{path.relative_to(ROOT)}: sem meta viewport")

    for tag, attr, ref in parser.refs:
        p = local_path(path, ref)
        if p is not None and not p.exists():
            erro(f"{path.relative_to(ROOT)}: referencia inexistente {tag}[{attr}]={ref}")

    if path.parent == APP:
        for m in re.finditer(r'(?:src|href)=[\"\']([^\"\']+\.(?:js|css)\?v=([0-9.]+))[\"\']', texto, re.I):
            if m.group(2) != versao:
                erro(f"{path.relative_to(ROOT)}: versao de cache {m.group(1)} difere de {versao}")
        if path.name != "login.html" and "sidebar" not in texto:
            erro(f"{path.relative_to(ROOT)}: pagina interna sem sidebar")
        if path.name != "login.html" and "topbar" not in texto:
            erro(f"{path.relative_to(ROOT)}: pagina interna sem topbar")


def checar_css(path):
    texto = path.read_text(encoding="utf-8")
    texto = re.sub(r"/\*.*?\*/", "", texto, flags=re.S)
    saldo = 0
    for ch in texto:
        if ch == "{":
            saldo += 1
        elif ch == "}":
            saldo -= 1
            if saldo < 0:
                erro(f"{path.relative_to(ROOT)}: chave CSS fechando sem abertura")
                return
    if saldo:
        erro(f"{path.relative_to(ROOT)}: {saldo} chave(s) CSS sem fechamento")
    if "scrollbar-gutter: stable both-edges" in texto:
        erro(f"{path.relative_to(ROOT)}: regra que pode recriar faixa branca lateral")


def checar_js():
    arquivos = sorted(APP.glob("*.js")) + [ROOT / "service-worker.js"]
    for path in arquivos:
        proc = subprocess.run(["node", "--check", str(path)], capture_output=True, text=True)
        if proc.returncode:
            erro(f"{path.relative_to(ROOT)}: erro de sintaxe JS: {proc.stderr.strip()}")


def main():
    app_js = (APP / "app.js").read_text(encoding="utf-8")
    m = re.search(r'window\.XBURGUER_VERSAO\s*=\s*[\"\']([0-9.]+)[\"\']', app_js)
    versao = m.group(1) if m else ""
    if not versao:
        erro("app.js: versao nao encontrada")
    else:
        print("Versao detectada:", versao)

    for path in sorted(ROOT.glob("*.html")) + sorted(APP.glob("*.html")):
        auditar_html(path, versao)

    checar_js()
    for path in sorted(APP.glob("*.css")):
        checar_css(path)

    try:
        manifest = json.loads((ROOT / "manifest.webmanifest").read_text(encoding="utf-8"))
    except Exception as exc:
        erro(f"manifest.webmanifest invalido: {exc}")
        manifest = {}

    for item in manifest.get("icons", []):
        p = local_path(ROOT / "index.html", item.get("src", ""))
        if p and not p.exists():
            erro(f"manifest: icone inexistente {item.get('src')}")

    for shortcut in manifest.get("shortcuts", []):
        p = local_path(ROOT / "index.html", shortcut.get("url", ""))
        if p and not p.exists():
            erro(f"manifest: atalho inexistente {shortcut.get('url')}")

    # Regras funcionais criticas que ja causaram regressao no sistema.
    faltas_html = (APP / "faltas.html").read_text(encoding="utf-8")
    faltas_js = (APP / "faltas-supabase.js").read_text(encoding="utf-8")
    relatorios_js = (APP / "relatorios-supabase.js").read_text(encoding="utf-8")
    configuracoes_js = (APP / "configuracoes-supabase.js").read_text(encoding="utf-8")
    configuracoes_html = (APP / "configuracoes.html").read_text(encoding="utf-8")
    consumos_js = (APP / "consumos-supabase.js").read_text(encoding="utf-8")

    if "cad-descontar-falta" not in faltas_html or "cad-valor-desconto-falta" not in faltas_html:
        erro("faltas: controles de desconto nao estao presentes na tela")
    if "valor_desconto" not in faltas_js:
        erro("faltas: valor_desconto nao esta integrado ao CRUD")
    if "valor_desconto" not in relatorios_js or "Desconto Faltas" not in relatorios_js:
        erro("relatorios: desconto de faltas nao esta integrado ao relatorio mensal")
    if "valor_desconto: Math.max(0, Number(r.valor_desconto || 0))" not in configuracoes_js:
        erro("backup legado: restauracao de faltas nao preserva valor_desconto")
    if (APP / "desconto-faltas.js").exists():
        erro("faltas: camada antiga desconto-faltas.js ainda existe")
    if "valor_total: precoUnitario * quantidade" in consumos_js:
        erro("consumos: valor_total e coluna gerada pelo banco e nao deve ser enviado no insert")
    if "carregarConsumosPaginados" not in consumos_js:
        erro("consumos: consulta principal sem paginacao")
    if "lerConsultaPaginada" not in relatorios_js:
        erro("relatorios: consultas sem paginacao, risco de truncamento")
    historico_js = (APP / "historico-supabase.js").read_text(encoding="utf-8")
    if "buscarHistoricoCompleto" not in historico_js:
        erro("historico: consulta sem paginacao")

    # Protecao de dados v3: impede regressao silenciosa do backup e da recuperacao.
    protecao_js_path = APP / "data-protection-v3.js"
    protecao_css_path = APP / "data-protection-v3.css"
    if not protecao_js_path.exists():
        erro("protecao de dados: data-protection-v3.js ausente")
        protecao_js = ""
    else:
        protecao_js = protecao_js_path.read_text(encoding="utf-8")
    if not protecao_css_path.exists():
        erro("protecao de dados: data-protection-v3.css ausente")

    for token, descricao in [
        ("criar_backup_protegido", "criacao de backup protegido"),
        ("restaurar_backup_seguro", "restauracao transacional"),
        ("restaurar_da_lixeira", "restauracao da lixeira"),
        ("SHA-256", "verificacao de integridade"),
        ("antes-restauracao", "backup antes de restaurar"),
        ("apos-restauracao", "backup depois de restaurar"),
    ]:
        if token not in protecao_js:
            erro(f"protecao de dados: {descricao} nao esta ativa no frontend")

    if "data-protection-v3.js" not in configuracoes_html:
        erro("configuracoes: camada de protecao v3 nao esta carregada")
    if "data-protection-v3.css" not in configuracoes_html:
        erro("configuracoes: estilos da protecao v3 nao estao carregados")
    for id_obrigatorio in (
        "backup-interno-ultimo",
        "backup-interno-total",
        "lixeira-protegida",
        "auditoria-protegida",
        "lista-lixeira-protegida",
    ):
        if f'id="{id_obrigatorio}"' not in configuracoes_html:
            erro(f"configuracoes: indicador de protecao ausente: {id_obrigatorio}")

    for path in APP.glob("*.js"):
        texto = path.read_text(encoding="utf-8")
        if 'avatar.textContent = "X"' in texto:
            erro(f"{path.relative_to(ROOT)}: identidade antiga do avatar ainda presente")

    sw = (ROOT / "service-worker.js").read_text(encoding="utf-8")
    if versao and f"xburguer-pwa-v{versao}" not in sw:
        erro(f"service-worker: cache nao corresponde a versao {versao}")
    if "caches.match(request" in sw:
        erro("service-worker: busca global de cache pode misturar aplicativos da mesma origem")
    if "const cache = await caches.open(CACHE_NAME)" not in sw or "cache.match(request" not in sw:
        erro("service-worker: cache exclusivo do Consumo nao esta sendo usado")

    for obrigatorio in (
        "./CONTROLE%20DE%20CONSUMO/data-protection-v3.js",
        "./CONTROLE%20DE%20CONSUMO/data-protection-v3.css",
        "./CONTROLE%20DE%20CONSUMO/ios-mobile-fix.css",
        "./CONTROLE%20DE%20CONSUMO/dashboard-startup-guard.js",
    ):
        if obrigatorio not in sw:
            erro(f"service-worker: arquivo critico fora do precache: {obrigatorio}")

    for ref in re.findall(r'[\"\'](\./[^\"\']+)[\"\']', sw):
        ref_fs = unquote(urlsplit(ref).path).removeprefix("./")
        p = (ROOT / ref_fs).resolve()
        if not p.exists():
            erro(f"service-worker: precache inexistente {ref}")

    print("\n================ RESUMO ================")
    print("Erros:", len(ERROS))
    print("Avisos:", len(AVISOS))
    if ERROS:
        return 1
    print("Auditoria estrutural e de protecao de dados concluida com sucesso.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
