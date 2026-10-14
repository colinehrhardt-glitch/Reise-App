import { t, getLanguage } from './i18n.js';
import { svg } from './map.js';

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'style') node.style.cssText = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child !== null && child !== undefined && child !== false) node.append(child);
  }
  return node;
}

export function icon(name) {
  const template = document.createElement('template');
  template.innerHTML = svg(name);
  return template.content.firstElementChild;
}

export function link(href, label, className = null) {
  return el('a', { class: className, href, target: '_blank', rel: 'noopener noreferrer', text: label });
}

export function formatNumber(n) {
  return new Intl.NumberFormat(getLanguage()).format(n);
}

export function distance(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function errorMessage(error) {
  const code = error && error.code ? error.code : 'server';
  const key = `errors.${code}`;
  const message = t(key);
  return message === key ? t('errors.server') : message;
}

export function toast(message, { type = 'info', action = null, duration = 4000 } = {}) {
  const container = document.getElementById('toasts');
  if (!container) return;
  for (const existing of container.querySelectorAll('.toast')) {
    if (existing.dataset.message === message) existing.remove();
  }
  const node = el('div', {
    class: `toast${type === 'error' ? ' toast--error' : ''}`,
    role: type === 'error' ? 'alert' : 'status',
    'data-message': message
  }, el('span', { class: 'toast__text', text: message }));
  let timer = 0;
  const dismiss = () => {
    clearTimeout(timer);
    node.classList.add('is-leaving');
    setTimeout(() => node.remove(), 260);
  };
  if (action) {
    node.append(el('button', {
      type: 'button',
      class: 'toast__action',
      text: action.label,
      onclick: () => {
        dismiss();
        action.onClick();
      }
    }));
  }
  container.append(node);
  while (container.children.length > 3) container.firstElementChild.remove();
  timer = setTimeout(dismiss, duration);
}

export function gallery(images) {
  const list = images.filter((image) => image && image.src);
  const slides = list.map((image, index) => {
    const img = el('img', { src: image.src, alt: '', loading: index ? 'lazy' : 'eager', decoding: 'async', referrerpolicy: 'no-referrer' });
    const slide = el('figure', { class: 'gallery__slide' }, img);
    img.addEventListener('error', () => {
      slide.remove();
      update();
    });
    return { slide, image };
  });
  const track = el('div', { class: 'gallery__track' }, slides.map((item) => item.slide));
  const dots = el('div', { class: 'gallery__dots', 'aria-hidden': 'true' });
  const counter = el('span', { class: 'gallery__count' });
  const credit = el('a', { class: 'gallery__credit', target: '_blank', rel: 'noopener noreferrer' });
  const prev = el('button', { type: 'button', class: 'gallery__nav gallery__nav--prev', 'aria-label': t('gallery.prev'), onclick: () => step(-1) }, icon('chevron'));
  const next = el('button', { type: 'button', class: 'gallery__nav gallery__nav--next', 'aria-label': t('gallery.next'), onclick: () => step(1) }, icon('chevron'));
  const root = el('div', { class: 'gallery' }, track, prev, next, counter, dots, credit);
  const live = () => slides.filter((item) => item.slide.parentNode === track);
  const index = () => Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
  function step(direction) {
    track.scrollTo({ left: (index() + direction) * track.clientWidth, behavior: 'smooth' });
  }
  function update() {
    const items = live();
    if (!items.length) {
      root.remove();
      return;
    }
    const current = Math.min(items.length - 1, Math.max(0, index()));
    const many = items.length > 1;
    root.classList.toggle('is-single', !many);
    counter.textContent = many ? `${current + 1}/${items.length}` : '';
    dots.replaceChildren(...(many ? items.map((_, position) => el('span', { class: position === current ? 'is-active' : null })) : []));
    prev.disabled = current === 0;
    next.disabled = current === items.length - 1;
    const image = items[current].image;
    credit.href = image.link || image.src;
    credit.textContent = t('photo.credit', { source: image.credit || 'Wikimedia Commons' });
  }
  let frame = 0;
  track.addEventListener('scroll', () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(update);
  }, { passive: true });
  update();
  return root;
}
