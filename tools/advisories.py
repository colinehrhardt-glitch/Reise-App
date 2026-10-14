import html
import json
import os
import re
import sys
import time
import unicodedata
import urllib.request
from datetime import datetime, timezone

import pycountry

HEADERS = {
    'User-Agent': 'Viaro travel app (https://github.com/colinehrhardt-glitch/Reise-App)',
    'Accept': 'application/json',
}
ALIASES = {
    'burma': 'mm', 'myanmar': 'mm', 'south korea': 'kr', 'korea south': 'kr', 'north korea': 'kp', 'korea north': 'kp',
    'kosovo': 'xk', 'the gambia': 'gm', 'gambia': 'gm', 'the bahamas': 'bs', 'bahamas': 'bs', 'cote d ivoire': 'ci',
    'ivory coast': 'ci', 'democratic republic of the congo': 'cd', 'congo democratic republic of the': 'cd',
    'drc': 'cd', 'republic of the congo': 'cg', 'congo republic of the': 'cg', 'congo': 'cg', 'macau': 'mo', 'macao': 'mo',
    'turkey': 'tr', 'turkiye': 'tr', 'russia': 'ru', 'laos': 'la', 'vietnam': 'vn', 'syria': 'sy', 'iran': 'ir',
    'bolivia': 'bo', 'venezuela': 've', 'tanzania': 'tz', 'moldova': 'md', 'micronesia': 'fm', 'eswatini': 'sz',
    'czechia': 'cz', 'czech republic': 'cz', 'brunei': 'bn', 'cabo verde': 'cv', 'cape verde': 'cv', 'timor leste': 'tl',
    'east timor': 'tl', 'taiwan': 'tw', 'palestine': 'ps', 'the occupied palestinian territories': 'ps',
    'israel the west bank and gaza': 'il', 'mainland china': 'cn', 'china': 'cn', 'hong kong': 'hk', 'uk': 'gb',
    'united kingdom': 'gb', 'usa': 'us', 'united states': 'us', 'vatican city': 'va', 'holy see': 'va',
    'st lucia': 'lc', 'saint lucia': 'lc', 'st kitts and nevis': 'kn', 'saint kitts and nevis': 'kn',
    'st vincent and the grenadines': 'vc', 'saint vincent and the grenadines': 'vc', 'st helena': 'sh',
    'st maarten': 'sx', 'sint maarten': 'sx', 'st martin': 'mf', 'curacao': 'cw', 'north macedonia': 'mk',
    'netherlands the': 'nl', 'the netherlands': 'nl', 'the philippines': 'ph', 'philippines': 'ph',
}


def normalize(name):
    text = unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode().lower()
    text = re.sub(r'[^a-z]+', ' ', text).strip()
    return text


def iso_code(name):
    key = normalize(name)
    if key in ALIASES:
        return ALIASES[key]
    try:
        return pycountry.countries.lookup(name).alpha_2.lower()
    except LookupError:
        pass
    try:
        return pycountry.countries.search_fuzzy(name)[0].alpha_2.lower()
    except LookupError:
        return None


def strip(markup):
    text = re.sub(r'<(script|style)[^>]*>.*?</\1>', ' ', markup or '', flags=re.S | re.I)
    text = re.sub(r'<br\s*/?>|</(p|li|h\d|div|tr)>', '\n', text, flags=re.I)
    text = re.sub(r'<[^>]+>', ' ', text)
    text = html.unescape(text)
    return re.sub(r'[ \t\r\f\v]+', ' ', text).strip()


def clip(text, limit=4000):
    return re.sub(r'\s*\n\s*', '\n', text).strip()[:limit]


def get(url):
    request = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(request, timeout=40) as response:
        return json.load(response)


def german_areas(identifier):
    data = get(f'https://www.auswaertiges-amt.de/opendata/travelwarning/{identifier}')
    root = data.get('response', data) if isinstance(data, dict) else {}
    entry = root.get(str(identifier)) if isinstance(root, dict) else None
    if not isinstance(entry, dict):
        entry = next((value for value in root.values() if isinstance(value, dict) and value.get('content')), {})
    text = strip(entry.get('content', ''))
    sentences = re.split(r'(?<=[.!?])\s+', text)
    warned = [item for item in sentences if re.search(r'wird\s+(ausdrücklich\s+)?gewarnt|reisewarnung\s+für', item, re.I)]
    advised = [item for item in sentences if re.search(r'abgeraten', item, re.I)]
    return {'4': clip('\n'.join(warned)), '3': clip('\n'.join(advised))}


def german(countries, areas):
    data = get('https://www.auswaertiges-amt.de/opendata/travelwarning')
    root = data.get('response', data) if isinstance(data, dict) else {}
    count = 0
    for identifier, value in root.items():
        if not isinstance(value, dict) or not value.get('countryCode'):
            continue
        if value.get('warning'):
            level = 4
        elif value.get('partialWarning'):
            level = 3
        elif value.get('situationWarning') or value.get('situationPartWarning'):
            level = 2
        else:
            level = 1
        code = str(value['countryCode']).lower()
        countries.setdefault(code, {})['de'] = level
        if level == 3:
            try:
                areas.setdefault(code, {})['de'] = german_areas(identifier)
            except Exception as error:
                print('de areas', code, error, file=sys.stderr)
            time.sleep(0.12)
        count += 1
    return count


def section(text, start, stops):
    match = re.search(start, text, re.I)
    if not match:
        return ''
    rest = text[match.end():]
    ends = [found.start() for pattern in stops for found in [re.search(pattern, rest, re.I)] if found]
    return clip(rest[:min(ends)] if ends else rest, 3000)


def american(countries, areas):
    data = get('https://cadataapi.state.gov/api/TravelAdvisories')
    count = 0
    for item in data if isinstance(data, list) else []:
        match = re.match(r'^\s*(.*?)\s*[-–]\s*Level\s*(\d)', item.get('Title', ''))
        if not match:
            continue
        code = iso_code(match.group(1))
        if code:
            countries.setdefault(code, {})['us'] = int(match.group(2))
            text = strip(item.get('Summary', ''))
            found = {
                '4': section(text, r'do not travel to', [r'reconsider travel to', r'exercise (increased|normal)', r'country summary', r'read the']),
                '3': section(text, r'reconsider travel to', [r'do not travel to', r'exercise (increased|normal)', r'country summary', r'read the'])
            }
            if found['4'] or found['3']:
                areas.setdefault(code, {})['us'] = found
            count += 1
    return count


UK_LEVELS = [
    ('avoid_all_travel_to_whole_country', 4),
    ('avoid_all_but_essential_travel_to_whole_country', 4),
    ('avoid_all_travel_to_parts', 3),
    ('avoid_all_but_essential_travel_to_parts', 2),
]


def british_areas(page):
    parts = page.get('details', {}).get('parts') or []
    body = ' '.join(part.get('body', '') for part in parts if part.get('slug') in ('warnings-and-insurance', 'safety-and-security'))
    if not body:
        return None
    chunks = re.split(r'<(h[234])[^>]*>(.*?)</h[234]>', body, flags=re.S | re.I)
    result = {'4': [], '3': []}
    bucket = None
    for index in range(1, len(chunks) - 2, 3):
        tag = chunks[index].lower()
        heading = strip(chunks[index + 1])
        lower = heading.lower()
        if 'against all travel' in lower and 'but essential' not in lower:
            bucket = '4'
        elif 'all but essential travel' in lower:
            bucket = '3'
        elif tag == 'h2':
            bucket = None
        elif bucket:
            result[bucket].append(heading)
        if bucket:
            result[bucket].append(strip(chunks[index + 2]))
    found = {key: clip('\n'.join(value)) for key, value in result.items()}
    return found if found['4'] or found['3'] else None


def british(countries, areas):
    index = get('https://www.gov.uk/api/content/foreign-travel-advice')
    children = index.get('links', {}).get('children', [])
    count = 0
    for child in children:
        path = child.get('base_path', '')
        if not path.startswith('/foreign-travel-advice/'):
            continue
        name = (child.get('details') or {}).get('country', {}).get('name') or child.get('title', '')
        code = iso_code(name)
        if not code:
            continue
        try:
            page = get('https://www.gov.uk/api/content' + path)
        except Exception as error:
            print('uk page', path, error, file=sys.stderr)
            continue
        time.sleep(0.12)
        status = ' '.join(page.get('details', {}).get('alert_status') or child.get('details', {}).get('alert_status') or [])
        level = next((value for key, value in UK_LEVELS if key in status), 1)
        countries.setdefault(code, {})['uk'] = [level, path.rsplit('/', 1)[-1]]
        if 1 < level < 4:
            found = british_areas(page)
            if found:
                areas.setdefault(code, {})['uk'] = found
        count += 1
    return count


def write_areas(folder, areas):
    os.makedirs(folder, exist_ok=True)
    for code, value in areas.items():
        target = os.path.join(folder, f'{code}.json')
        content = json.dumps(value, ensure_ascii=False, separators=(',', ':'), sort_keys=True)
        try:
            with open(target, encoding='utf-8') as handle:
                if handle.read() == content:
                    continue
        except OSError:
            pass
        with open(target, 'w', encoding='utf-8') as handle:
            handle.write(content)
    for name in os.listdir(folder):
        if name.endswith('.json') and name[:-5] not in areas:
            os.remove(os.path.join(folder, name))


def main(path):
    countries = {}
    areas = {}
    for name, task in (('de', german), ('us', american), ('uk', british)):
        try:
            print(name, task(countries, areas))
        except Exception as error:
            print(name, 'failed', error, file=sys.stderr)
    if not countries:
        sys.exit(1)
    write_areas(os.path.join(os.path.dirname(path) or '.', 'advice'), areas)
    print('areas', len(areas))
    try:
        with open(path, encoding='utf-8') as handle:
            previous = json.load(handle)
    except (OSError, ValueError):
        previous = {}
    if previous.get('countries') == countries:
        print('unchanged')
        return
    result = {'updated': datetime.now(timezone.utc).strftime('%Y-%m-%d'), 'countries': dict(sorted(countries.items()))}
    with open(path, 'w', encoding='utf-8') as handle:
        json.dump(result, handle, ensure_ascii=False, separators=(',', ':'))
    print('written', len(countries))


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'data/advisories.json')
