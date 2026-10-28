"""Segnali dei Comuni di una regione, dai dati aperti, per il fit di CityFix.

Raccoglie per ogni Comune già salvato da una ricerca it_comuni:
- rigenerazione urbana: progetti PNRR (Italia Domani) e di coesione (OpenCoesione);
- digitale: misure di PA digitale 2026 adottate;
- manutenzione: affidamenti di strade, verde, illuminazione e decoro dal 2024 (ANAC), e acquisti di
  piattaforme di segnalazione.

Scrive un JSON che scripts/segnali.ts completa con i siti dei Comuni e importa. Solo libreria standard.
Uso: python3 -I scripts/segnali_comuni.py --regione Puglia --db data/marketer.db --out data/segnali/puglia.json
"""
import argparse
import collections
import csv
import datetime
import glob
import io
import json
import os
import re
import sqlite3
import ssl
import sys
import time
import unicodedata
import urllib.error
import urllib.request
import zipfile

csv.field_size_limit(10**9)
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
CACHE_DAYS = 30
SINCE_YEAR = 2024
# Le fonti si verificano con i certificati del sistema (il Python di python.org non ne ha di suoi).
SOURCES_TLS = ssl.create_default_context(cafile='/etc/ssl/cert.pem' if os.path.exists('/etc/ssl/cert.pem') else None)
# ISTAT manda una catena che il bundle di sistema non chiude: solo nomi e codici pubblici dei Comuni.
ISTAT_TLS = ssl.create_default_context()
ISTAT_TLS.check_hostname = False
ISTAT_TLS.verify_mode = ssl.CERT_NONE

# Italia Domani cambia percorso a ogni rilascio: da aggiornare quando ne esce uno nuovo.
PNRR = 'https://www.italiadomani.gov.it/content/dam/sogei-ng/opendata_febbraio26'
PNRR_RELEASE = 'febbraio 2026'
ISTAT = 'https://www.istat.it/storage/codici-unita-amministrative/Elenco-comuni-italiani.csv'
IPA = 'https://indicepa.gov.it/ipa-dati/datastore/dump/d09adf99-dc10-4349-8c53-27b1e5aa97b6?format=csv'
OPENCOESIONE = 'https://opencoesione.gov.it/it/opendata/regioni/progetti_esteso_{}.zip'
ANAC = 'https://dati.anticorruzione.it/opendata'
OC_REGION = {
    'Piemonte': 'PIE', "Valle d'Aosta": 'VDA', 'Lombardia': 'LOM', 'Veneto': 'VEN', 'Friuli-Venezia Giulia': 'FVG',
    'Liguria': 'LIG', 'Emilia-Romagna': 'EMR', 'Toscana': 'TOS', 'Umbria': 'UMB', 'Marche': 'MAR', 'Lazio': 'LAZ',
    'Abruzzo': 'ABR', 'Molise': 'MOL', 'Campania': 'CAM', 'Puglia': 'PUG', 'Basilicata': 'BAS', 'Calabria': 'CAL',
    'Sicilia': 'SIC', 'Sardegna': 'SAR',
}

# Misure PNRR che dicono rigenerazione urbana e cura dello spazio pubblico, con il nome da citare.
REGENERATION = {
    'M5C2I2.01': 'rigenerazione urbana',
    'M5C2I2.02': 'piano urbano integrato',
    'M5C2I2.03': "qualità dell'abitare (PINQuA)",
    'M1C3I2.01': 'attrattività dei borghi',
    'M1C3I2.03': 'parchi e giardini storici',
    'M2C4I2.02': 'resilienza e valorizzazione del territorio',
    'M2C4I3.01': 'verde urbano',
    'M2C2I4.01': 'ciclovie urbane',
    'M5C2I3.01': 'sport e inclusione sociale',
}
# Misure di PA digitale 2026 per i Comuni.
DIGITAL = {
    'M1C1I1.04.01': 'servizi al cittadino e sito',
    'M1C1I1.04.03': 'pagoPA e app IO',
    'M1C1I1.04.04': 'SPID e CIE',
    'M1C1I1.04.05': 'notifiche digitali',
    'M1C1I1.02': 'cloud',
    'M1C1I1.03.01': 'interoperabilità dei dati',
    'M1C1I2.02.03': 'SUAP e SUE digitali',
    'M1C1I1.07': 'facilitazione digitale',
}
URBAN_TITLE = re.compile(r'(?i)rigenera|riqualifica|arredo urban|decoro|piazz|centro storico|marciapied|viabilit|strad|illuminazione pubblica|pubblica illuminazione|verde pubblico|parco urban|spazi pubblici|periferi')
MAINT = re.compile(r'(?i)manutenz|riparaz|ripristin|sfalci|potatur|pulizia|rifacimento|messa in sicurezza|sistemazione|diserb')
# Servizi che parlano di strade o di pulizia ma non sono interventi da segnalare.
NOT_MAINT = re.compile(r'(?i)rifiut(?!i abbandonat)|trattamento|concession|project financing|finanza di progetto|parchegg|sosta|parcometr|trasport|mensa|scuolabus|raccolta|igiene urbana|rifiuti solidi|conferimento|smaltimento|cimiter|votiva|riscaldament|calore|ascensor|software|assicura|refezione|pulizia (?:degli )?(?:uffici|immobili|edifici|locali)')
# Gli interventi piccoli e frequenti sono il lavoro di CityFix: le opere grandi sono investimenti.
MAINT_MAX = 500_000
MAINT_KINDS = {
    'strade': re.compile(r'(?i)strad|viabilit|marciapied|buche|asfalt|bitum|segnaletica|carreggiat|manto'),
    'verde': re.compile(r'(?i)verde pubblic|aree verdi|potatur|sfalci|diserb|giardin|parchi|alberat'),
    'illuminazione': re.compile(r'(?i)illuminazione pubblica|pubblica illuminazione|lampion|impiant[io] di illuminazione|punti luce'),
    'decoro': re.compile(r'(?i)decoro|arredo urbano|graffit|rifiuti abbandonat|pulizia (?:delle )?strad|spazzamento'),
}
REPORT_PURCHASE = re.compile(r'(?i)segnalazion\w* (?:di )?disserviz|segnalazion\w* (?:dei|da parte dei) cittadin|app\w* (?:per le |di )?segnalazion|piattaforma (?:per le |di )?segnalazion')


def log(*args):
    print(*args, file=sys.stderr, flush=True)


def key(text):
    return re.sub(r'[^A-Z0-9]', '', unicodedata.normalize('NFD', text).encode('ascii', 'ignore').decode().upper())


def comune_key(name):
    """Il nome di un ente che è un Comune, confrontabile con ISTAT; None se non è un Comune."""
    n = name.upper().strip()
    if n == 'ROMA CAPITALE':
        return 'ROMA'
    m = re.match(r"COMUNE (?:DI |D'|DELLA |DEL )?(.*)", n)
    return key(m.group(1)) if m else None


def fetch(url, timeout=60, tls=SOURCES_TLS):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept-Language': 'it'})
    return urllib.request.urlopen(req, timeout=timeout, context=tls)


def cached(cache, name, url, max_days=CACHE_DAYS, tls=SOURCES_TLS):
    """Il file della fonte; max_days None per i file che non cambiano più (un mese chiuso, un rilascio)."""
    path = os.path.join(cache, name)
    if os.path.exists(path) and (max_days is None or time.time() - os.path.getmtime(path) < max_days * 86400):
        return path
    log('scarico', url)
    with fetch(url, timeout=1800, tls=tls) as res, open(path + '.part', 'wb') as out:
        while chunk := res.read(1 << 20):
            out.write(chunk)
    os.replace(path + '.part', path)
    return path


def optional(cache, name, url):
    """Un file mensile che può non essere ancora pubblicato: se manca si va avanti senza."""
    try:
        return cached(cache, name, url, None)
    except urllib.error.HTTPError as err:
        log('manca', url, err.code)
        return None


def anac_releases(cache, dataset):
    """I rilasci mensili dell'anno in corso (CIG nuovi e aggiornati); se la pagina non risponde, quelli in cache."""
    try:
        with fetch(f'{ANAC}/dataset/{dataset}') as res:
            found = sorted(set(re.findall(rf'href="([^"]*/(\d{{8}})-{dataset}_csv\.zip)"', res.read().decode('utf-8', 'replace'))))
        return [cached(cache, f'{dataset}_{day}.zip', url, None) for url, day in found]
    except (urllib.error.URLError, TimeoutError) as err:
        log('ANAC non risponde, uso la cache:', err)
        return sorted(glob.glob(os.path.join(cache, f'{dataset}_[0-9]' + '[0-9]' * 7 + '.zip')))


def rows(path, sep=';', encoding='utf-8-sig'):
    with open(path, encoding=encoding, newline='') as f:
        yield from csv.DictReader(f, delimiter=sep)


def zip_rows(path, sep=';'):
    with zipfile.ZipFile(path) as zf:
        for name in zf.namelist():
            if name.endswith('.csv'):
                yield from csv.DictReader(io.TextIOWrapper(zf.open(name), encoding='utf-8-sig', newline=''), delimiter=sep)


def project_title(r):
    """Il titolo PNRR, che ReGiS spesso tronca a 40 caratteri: allora la prima frase della sintesi."""
    title = r['Titolo Progetto'].strip()
    summary = re.split(r'(?<=\.)\s', r['Sintesi Progetto'].strip())[0][:160].strip()
    return summary if len(title) >= 40 and len(summary) > len(title) else title


def euro(text):
    try:
        return float((text or '0').replace(',', '.'))
    except ValueError:
        return 0.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--regione', required=True)
    ap.add_argument('--db', required=True)
    ap.add_argument('--out', required=True)
    args = ap.parse_args()
    cache = os.path.join(os.path.dirname(os.path.abspath(args.db)), 'cache', 'segnali')
    os.makedirs(cache, exist_ok=True)

    # I Comuni della regione e quelli salvati da Marketer.
    region_key = key(args.regione)
    istat_names = {}
    for r in csv.reader(open(cached(cache, 'istat.csv', ISTAT, tls=ISTAT_TLS), encoding='cp1252'), delimiter=';'):
        if len(r) > 14 and key(r[10]).startswith(region_key):
            istat_names[r[4]] = key(r[6])
    if not istat_names:
        raise SystemExit(f'Regione sconosciuta: {args.regione}')
    db = sqlite3.connect(f'file:{args.db}?mode=ro', uri=True)
    comuni = {}
    for reg, name, population, website in db.execute("select registry_id, name, population, website from prospects where source = 'it_comuni'"):
        code = reg[6:]
        if code in istat_names:
            comuni[code] = {'name': name, 'population': population or 0, 'website': website}
    if not comuni:
        log(f'Nessun Comune di {args.regione} tra i prospect: prima lancia una ricerca «Comuni italiani».')
        sys.exit(2)
    log('Comuni da studiare:', len(comuni))

    # Codici fiscali: IndicePA, più le partite IVA con cui i Comuni compaiono nel PNRR.
    cf = {}
    for r in rows(cached(cache, 'ipa.csv', IPA), sep=','):
        if r['Codice_Categoria'] == 'L6' and r['Codice_comune_ISTAT'] in comuni and comune_key(r['Denominazione_ente']):
            cf[r['Codice_fiscale_ente']] = r['Codice_comune_ISTAT']

    # PNRR: il rilascio è fissato in PNRR, i file non cambiano più.
    located = collections.defaultdict(set)
    for r in rows(cached(cache, 'pnrr_localizzazione.csv', f'{PNRR}/PNRR_Localizzazione.csv', None)):
        code = r['Provincia'] + r['Comune']
        if code in comuni:
            located[r['CUP']].add(code)
    projects = []
    for r in rows(cached(cache, 'pnrr_progetti.csv', f'{PNRR}/PNRR_Progetti.csv', None)):
        if r['CUP'] not in located:
            continue
        name = comune_key(r['Soggetto Attuatore'])
        for code in located[r['CUP']] if name else ():
            if istat_names.get(code) == name:
                cf[r['Codice Fiscale Soggetto Attuatore']] = code
        sub = r['Codice Univoco Submisura']
        reg = next((v for k, v in REGENERATION.items() if sub.startswith(k)), None)
        dig = next((k for k in DIGITAL if sub.startswith(k)), None)
        if reg or dig:
            projects.append((r['CUP'], reg, dig, project_title(r), euro(r['Finanziamento PNRR']), r['Codice Fiscale Soggetto Attuatore']))
    owners = collections.defaultdict(set)
    for r in rows(cached(cache, 'pnrr_soggetti.csv', f'{PNRR}/PNRR_Soggetti.csv', None)):
        if r['Codice Fiscale Soggetto'] in cf:
            owners[r['CUP']].add(cf[r['Codice Fiscale Soggetto']])
    pnrr = collections.defaultdict(lambda: {'regen': [], 'digital': set()})
    for cup, reg, dig, title, amount, attuatore in projects:
        those = owners.get(cup, set()) | ({cf[attuatore]} if attuatore in cf else set())
        for code in those:
            if reg:
                # Un progetto di più Comuni (es. della Città metropolitana): a ognuno conta la sua parte.
                pnrr[code]['regen'].append({'measure': reg, 'title': title.strip(), 'amount': amount, 'partners': len(those), 'cup': cup})
            if dig:
                pnrr[code]['digital'].add(dig)
    log('PNRR: Comuni con rigenerazione', sum(1 for p in pnrr.values() if p['regen']))

    # OpenCoesione: progetti urbani di cui il Comune è beneficiario.
    cohesion = collections.defaultdict(list)
    oc = next((v for k, v in OC_REGION.items() if key(k).startswith(region_key) or region_key.startswith(key(k))), None)
    if oc:
        for r in zip_rows(cached(cache, f'opencoesione_{oc}.zip', OPENCOESIONE.format(oc))):
            code = cf.get(r['OC_CODFISC_BENEFICIARIO'])
            if code and (URBAN_TITLE.search(r['OC_TITOLO_PROGETTO']) or r['CUP_DESCR_SOTTOSETTORE'].lower().startswith(('riqualificazione urbana', 'arredo urbano'))):
                url = r['OC_LINK'] if r['OC_LINK'].startswith('https://opencoesione.gov.it/') else None
                cohesion[code].append({'title': r['OC_TITOLO_PROGETTO'].strip(), 'amount': euro(r['FINANZ_TOTALE_PUBBLICO']), 'cycle': r['OC_DESCR_CICLO'][-9:], 'url': url})
    else:
        log(f'OpenCoesione non ha un file per {args.regione}: niente progetti di coesione')

    # ANAC: gare con CIG e SmartCIG dal 2024, mese per mese; per l'anno in corso, i rilasci mensili.
    this_year = datetime.date.today().year
    files = [optional(cache, f'{ds}_{y}_{m:02d}.zip', f'{ANAC}/download/dataset/{ds}-{y}/filesystem/{ds}_csv_{y}_{m:02d}.zip')
             for y in range(SINCE_YEAR, this_year) for m in range(1, 13) for ds in ('cig', 'smartcig')]
    files = [f for f in files if f] + anac_releases(cache, 'cig') + anac_releases(cache, 'smartcig')
    maint = collections.defaultdict(lambda: {'contracts': 0, 'amount': 0.0, 'kinds': collections.Counter(), 'top': [], 'purchases': []})
    seen = set()
    for f in files:
        for r in zip_rows(f):
            cig = r.get('cig')
            year = r.get('anno_pubblicazione') or r.get('anno_comunicazione') or (r.get('data_comunicazione') or '')[:4]
            if not cig or not year or year < str(SINCE_YEAR):
                continue
            code = cf.get(r.get('cf_amministrazione_appaltante'))
            istat = r.get('luogo_istat') or r.get('istat_comune')
            if not code and istat in comuni and comune_key(r.get('denominazione_amministrazione_appaltante', '')):
                code = istat
            # Lo stesso CIG torna nei rilasci successivi: si conta una volta.
            if not code or cig in seen:
                continue
            seen.add(cig)
            subject = r.get('oggetto_lotto') or r.get('oggetto_gara') or ''
            item = {'subject': subject[:160], 'amount': euro(r.get('importo_lotto')), 'cig': cig, 'year': year}
            m = maint[code]
            if REPORT_PURCHASE.search(subject):
                m['purchases'].append(item)
            kinds = [k for k, p in MAINT_KINDS.items() if p.search(subject)]
            if kinds and MAINT.search(subject) and not NOT_MAINT.search(subject) and 0 < item['amount'] <= MAINT_MAX:
                m['contracts'] += 1
                m['amount'] += item['amount']
                m['kinds'].update(kinds)
                m['top'].append(item)
    log('ANAC: Comuni con manutenzioni', sum(1 for m in maint.values() if m['contracts']))

    regen_eur = {c: sum(p['amount'] / p['partners'] for p in pnrr[c]['regen']) + sum(p['amount'] for p in cohesion[c]) for c in comuni}

    out = {'region': args.regione, 'collectedAt': datetime.date.today().isoformat(), 'sinceYear': SINCE_YEAR, 'sources': {
        'pnrr': f'Italia Domani, open data PNRR ({PNRR_RELEASE})',
        'opencoesione': 'OpenCoesione, progetti della regione',
        'anac': f"ANAC, open data dei contratti pubblici (CIG e SmartCIG dal {SINCE_YEAR}, fino a {f'{MAINT_MAX:,}'.replace(',', '.')} euro)",
        'site': 'sito istituzionale del Comune',
    }, 'comuni': {}}
    for c in comuni:
        regen = sorted(pnrr[c]['regen'], key=lambda p: -p['amount'] / p['partners'])
        coh = sorted(cohesion[c], key=lambda p: -p['amount'])
        m = maint[c]
        out['comuni'][c] = {
            'regeneration': {'amount': round(regen_eur[c]), 'pnrr': regen[:4], 'cohesion': coh[:3]},
            'digital': {'measures': [DIGITAL[k] for k in sorted(pnrr[c]['digital'])]},
            'maintenance': {'contracts': m['contracts'], 'amount': round(m['amount']), 'kinds': dict(m['kinds']), 'top': sorted(m['top'], key=lambda t: -t['amount'])[:3], 'purchases': m['purchases'][:3]},
        }
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    json.dump(out, open(args.out, 'w'), ensure_ascii=False)
    log('Scritto', args.out)


if __name__ == '__main__':
    main()
