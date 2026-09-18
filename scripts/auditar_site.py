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

    for path in sorted(APP.glob("*.html")):
        texto_html = path.read_text(encoding="utf-8")
        if "@supabase/supabase-js@2.116.0" not in texto_html:
            erro(f"{path.relative_to(ROOT)}: SDK Supabase deve permanecer fixado em 2.116.0")
        if re.search(r'@supabase/supabase-js@2(?:["\'])', texto_html):
            erro(f"{path.relative_to(ROOT)}: SDK Supabase voltou a usar versao flutuante")

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
        ("pacote.projeto", "validacao do projeto de origem do backup"),
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
    ):
        if obrigatorio not in sw:
            erro(f"service-worker: arquivo critico fora do precache: {obrigatorio}")

    for ref in re.findall(r'[\"\'](\./[^\"\']+)[\"\']', sw):
        ref_fs = unquote(urlsplit(ref).path).removeprefix("./")
        p = (ROOT / ref_fs).resolve()
        if not p.exists():
            erro(f"service-worker: precache inexistente {ref}")

    # Revisao arquitetural 2026-09: autenticacao, Dashboard, Consumos e semantica dos relatorios.
    dashboard_js = (APP / "dashboard-supabase.js").read_text(encoding="utf-8")
    login_html = (APP / "login.html").read_text(encoding="utf-8")
    index_html = (ROOT / "index.html").read_text(encoding="utf-8")
    pwa_compat = (ROOT / "pwa-consumo.js").read_text(encoding="utf-8") if (ROOT / "pwa-consumo.js").exists() else ""

    if (APP / "dashboard-startup-guard.js").exists():
        erro("dashboard: hotfix antigo voltou; retry deve permanecer integrado ao dashboard-supabase.js")
    if "MAX_TENTATIVAS_INICIAIS" not in dashboard_js or "tentativa + 1" not in dashboard_js:
        erro("dashboard: retry inicial nativo nao esta ativo")

    if "usuario_autorizado_atual" not in login_html:
        erro("login: falta validacao encapsulada do usuario autorizado")
    if "usuario_autorizado_atual" not in app_js:
        erro("app: paginas internas nao validam o usuario pela funcao encapsulada")
    if '.from("usuarios_autorizados")' in login_html or ".from('usuarios_autorizados')" in login_html:
        erro("login: nao deve consultar usuarios_autorizados diretamente")
    if '.from("usuarios_autorizados")' in app_js or ".from('usuarios_autorizados')" in app_js:
        erro("app: nao deve consultar usuarios_autorizados diretamente")
    if "for (let tentativa = 0; tentativa < 3; tentativa += 1)" not in login_html:
        erro("login: validacao de autorizacao sem retry contra falhas temporarias")
    if "for (let tentativa = 0; tentativa < 3; tentativa += 1)" not in app_js:
        erro("app: validacao de autorizacao sem retry contra falhas temporarias")
    if "if (erroAutorizacao || autorizado !== true)" in login_html or "if (erroAutorizacao || autorizado !== true)" in app_js:
        erro("autorizacao: falha tecnica voltou a ser tratada como usuario nao autorizado")

    if "Unidades consumidas" not in relatorios_js:
        erro("relatorios: card principal nao esta padronizado por unidades consumidas")
    if '$("stat-num-consumos").textContent = consumos.length' in relatorios_js:
        erro("relatorios: card voltou a contar lancamentos em vez de unidades")

    edicao_js_path = APP / "consumos-edicao.js"
    if not edicao_js_path.exists():
        erro("consumos: modulo de edicao ausente")
    if "abrirModalEdicaoConsumo" not in consumos_js or "btn-editar-consumo" not in consumos_js:
        erro("consumos: botao de edicao nao e renderizado diretamente pela tabela")

    if "service-worker.js?v=" in index_html or "service-worker.js?v=" in app_js or "service-worker.js?v=" in pwa_compat:
        erro("PWA: registros do mesmo Service Worker usam URLs diferentes por querystring")
    if 'updateViaCache: "none"' not in app_js:
        erro("PWA: registro interno nao força verificacao de atualizacao sem cache")

    # Supply-chain da CI: Actions oficiais fixadas em commits revisados.
    workflow_site = (ROOT / ".github/workflows/validar-site.yml").read_text(encoding="utf-8")
    workflow_isolamento = (ROOT / ".github/workflows/validar-isolamento.yml").read_text(encoding="utf-8")
    actions_obrigatorias = {
        "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1": "checkout v7.0.1",
        "actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97": "setup-python v7.0.0",
        "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020": "setup-node v7.0.0",
        "actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f": "upload-artifact v6.0.0",
    }
    for token, descricao in actions_obrigatorias.items():
        if token not in workflow_site:
            erro(f"CI: {descricao} nao esta fixada no commit revisado")
    if "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1" not in workflow_isolamento:
        erro("CI isolamento: checkout nao esta fixado no commit revisado")
    if "node-version: '24'" not in workflow_site:
        erro("CI: auditoria JavaScript deve usar Node 24")

    print("\n================ RESUMO ================")
    print("Erros:", len(ERROS))
    print("Avisos:", len(AVISOS))
    if ERROS:
        return 1
    print("Auditoria estrutural e de protecao de dados concluida com sucesso.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
