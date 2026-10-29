import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {createTranslator} from './i18nCore.js';

const directory = Gio.File.new_for_uri(import.meta.url).get_parent();
const [, contents] = directory.get_child('translations.json').load_contents(null);
export const _ = createTranslator(JSON.parse(new TextDecoder().decode(contents)), GLib.get_language_names());
