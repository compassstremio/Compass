import { PT } from './locales/pt.js';
import { PT_PT } from './locales/pt-PT.js';
import { RU } from './locales/ru.js';
import { AR } from './locales/ar.js';
import { CINEMA } from './locales/cinema.js';

const DICT = {
  pt: Object.assign({}, PT, CINEMA.pt),
  'pt-PT': Object.assign({}, PT, CINEMA.pt, PT_PT, CINEMA['pt-PT']),
  ru: Object.assign({}, RU, CINEMA.ru),
  ar: Object.assign({}, AR, CINEMA.ar)
};

export function dictionaryFor(code) {
  return DICT[code] || {};
}

const RTL = new Set(['ar']);

export const VARIANTS = [
  { code: 'en', label: 'English' },
  { code: 'pt', label: 'Português (Brasil)' },
  { code: 'pt-PT', label: 'Português (Portugal)' },
  { code: 'ru', label: 'Русский' },
  { code: 'ar', label: 'العربية' }
];

export const CONTINUE_CYCLE = [
  'Continue',
  'Continuar',
  'Продолжить',
  'متابعة'
];

let current = 'en';
const listeners = new Set();

export function getLocale() {
  return current;
}

export function baseLocale(code) {
  return String(code || current).split('-')[0];
}

export function isRTL(code) {
  return RTL.has(baseLocale(code));
}

export function setLocale(code) {
  const next = code === 'en' || DICT[code] ? code : 'en';
  if (next === current) return false;
  current = next;
  const root = document.documentElement;
  root.setAttribute('lang', next);
  root.setAttribute('dir', isRTL(next) ? 'rtl' : 'ltr');
  listeners.forEach((fn) => {
    try {
      fn(next);
    } catch (err) {
      console.error('[compass-installer] locale listener threw', err);
    }
  });
  return true;
}

export function onLocaleChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function t(key, vars) {
  const table = DICT[current];
  let out = (table && table[key]) || key;
  if (vars) {
    Object.keys(vars).forEach((name) => {
      out = out.split('{' + name + '}').join(String(vars[name]));
    });
  }
  return out;
}
