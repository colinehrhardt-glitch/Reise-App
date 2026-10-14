import json
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


def get(url):
    request = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(request, timeout=40) as response:
        return json.load(response)


def german(countries):
    data = get('https://www.auswaertiges-amt.de/opendata/travelwarning')
    root = data.get('response', data) if isinstance(data, dict) else {}
    count = 0
    for value in root.values():
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
        countries.setdefault(str(value['countryCode']).lower(), {})['de'] = level
        count += 1
    return count


def american(countries):
    data = get('https://cadataapi.state.gov/api/TravelAdvisories')
    count = 0
    for item in data if isinstance(data, list) else []:
        match = re.match(r'^\s*(.*?)\s*[-–]\s*Level\s*(\d)', item.get('Title', ''))
        if not match:
            continue
        code = iso_code(match.group(1))
        if code:
            countries.setdefault(code, {})['us'] = int(match.group(2))
            count += 1
    return count


UK_LEVELS = [
    ('avoid_all_travel_to_whole_country', 4),
    ('avoid_all_but_essential_travel_to_whole_country', 4),
    ('avoid_all_travel_to_parts', 3),
    ('avoid_all_but_essential_travel_to_parts', 2),
]


def british(countries):
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
        status = ' '.join(child.get('details', {}).get('alert_status') or [])
        if not status:
            try:
                page = get('https://www.gov.uk/api/content' + path)
                status = ' '.join(page.get('details', {}).get('alert_status') or [])
            except Exception as error:
                print('uk page', path, error, file=sys.stderr)
                continue
            time.sleep(0.12)
        level = next((value for key, value in UK_LEVELS if key in status), 1)
        countries.setdefault(code, {})['uk'] = [level, path.rsplit('/', 1)[-1]]
        count += 1
    return count


def main(path):
    countries = {}
    for name, task in (('de', german), ('us', american), ('uk', british)):
        try:
            print(name, task(countries))
        except Exception as error:
            print(name, 'failed', error, file=sys.stderr)
    if not countries:
        sys.exit(1)
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
