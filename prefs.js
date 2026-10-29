import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {populatePreferences} from './lib/preferences.js';

export default class TidyPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        populatePreferences(window, this.getSettings());
    }
}
