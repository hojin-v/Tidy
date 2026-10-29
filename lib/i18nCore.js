// English source strings are the fallback for languages without a catalog.
export function languageFor(languages) {
    for (const language of languages) {
        const base = language.toLowerCase().split(/[_@.\-]/)[0];
        if (base === 'ko') return 'ko';
        if (base === 'en' || base === 'c' || base === 'posix') return 'en';
    }
    return 'en';
}

export function createTranslator(catalogs, languages) {
    const catalog = catalogs[languageFor(languages)] ?? {};
    return (message, values = {}) => (catalog[message] ?? message).replace(/\{(\w+)\}/g,
        (placeholder, key) => Object.hasOwn(values, key) ? String(values[key]) : placeholder);
}
