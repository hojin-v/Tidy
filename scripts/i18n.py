"""Share the application's catalogs and GLib locale precedence with the CLI."""
import json
from pathlib import Path
import re
from gi.repository import GLib

CATALOGS = json.loads((Path(__file__).resolve().parent.parent / 'lib/translations.json').read_text())


def language_for(languages):
    for language in languages:
        base = re.split(r'[_@.\-]', language.lower())[0]
        if base == 'ko':
            return 'ko'
        if base in ('en', 'c', 'posix'):
            return 'en'
    return 'en'


def _(message, **values):
    catalog = CATALOGS.get(language_for(GLib.get_language_names()), {})
    return re.sub(r'\{(\w+)\}', lambda match: str(values.get(match[1], match[0])),
                  catalog.get(message, message))
