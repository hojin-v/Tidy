#!/usr/bin/env python3
"""Check syntax, schemas, and packaged action defaults without changing desktop settings."""
import json
from pathlib import Path
import subprocess
import tempfile
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parent.parent
metadata = json.loads((root / 'metadata.json').read_text())
schema = ET.parse(root / 'schemas/org.gnome.shell.extensions.winubun.gschema.xml').getroot()[0]
assert metadata['settings-schema'] == schema.attrib['id']
for path in [*root.glob('*.js'), *(root / 'bin').glob('*.js'), *(root / 'lib').glob('*.js'), *(root / 'scripts').glob('*.js'), *(root / 'tests').glob('*.js')]:
    subprocess.run(['node', '--check', str(path)], check=True)
with tempfile.TemporaryDirectory() as directory:
    subprocess.run(['glib-compile-schemas', '--strict', '--targetdir', directory, str(root / 'schemas')], check=True)
actions = json.loads(subprocess.check_output(['node', '--input-type=module', '-e',
    "import {ACTIONS} from './lib/layouts.js'; console.log(JSON.stringify(ACTIONS));"], cwd=root, text=True))
keys = {key.attrib['name']: key for key in schema}
for key, _, _, default in actions:
    assert keys[key].attrib['type'] == 'as', key
    assert keys[key].findtext('default') == repr([default]), key
assert keys['snap-assist'].findtext('default') == 'false'
assert keys['resize-together'].findtext('default') == 'true'
assert keys['super-key-picker'].findtext('default') == 'true'
assert keys['disable-native-tiling-shortcuts'].findtext('default') == 'false'
assert keys['picker-scale'].findtext('default') == '100'
assert keys['overview-picker-scale'].findtext('default') == '100'
assert keys['auto-picker-scale'].findtext('default') == 'true'
assert keys['auto-trigger-width'].findtext('default') == 'true'
print('JavaScript 구문, GSettings 스키마, 단축키 기본값 검사 통과')
