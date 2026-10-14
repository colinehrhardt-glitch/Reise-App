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

function largeSrc(src) {
  return /[?&]width=\d+/.test(src) ? src.replace(/([?&]width=)\d+/, '$11280') : src;
}

export function openLightbox(images, start = 0) {
  const previous = document.activeElement;
  const track = el('div', { class: 'lightbox__track' }, images.map((image) => el('figure', { class: 'lightbox__slide' },
    el('img', { src: largeSrc(image.full || image.src), alt: image.label || '', decoding: 'async', referrerpolicy: 'no-referrer' }),
    el('figcaption', { class: 'lightbox__caption' },
      image.label ? el('span', { class: 'lightbox__label', text: image.label }) : null,
      image.link ? el('a', { class: 'lightbox__credit', href: image.link, target: '_blank', rel: 'noopener noreferrer', text: t('photo.credit', { source: image.credit || 'Wikimedia Commons' }) }) : null))));
  const close = () => {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    if (previous && previous.focus) previous.focus({ preventScroll: true });
  };
  const onKey = (event) => {
    if (event.key === 'Escape') close();
    if (event.key === 'ArrowRight') track.scrollBy({ left: track.clientWidth, behavior: 'smooth' });
    if (event.key === 'ArrowLeft') track.scrollBy({ left: -track.clientWidth, behavior: 'smooth' });
  };
  const closeButton = el('button', { type: 'button', class: 'lightbox__close', 'aria-label': t('common.close'), onclick: close }, icon('close'));
  const overlay = el('div', { class: 'lightbox', role: 'dialog', 'aria-modal': 'true' }, track, closeButton);
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  requestAnimationFrame(() => {
    track.scrollLeft = start * track.clientWidth;
    closeButton.focus({ preventScroll: true });
  });
}

export function gallery(images) {
  const list = images.filter((image) => image && image.src);
  const slides = list.map((image, index) => {
    const img = el('img', { src: image.src, alt: image.label || '', loading: index > 2 ? 'lazy' : 'eager', decoding: 'async', referrerpolicy: 'no-referrer' });
    const slide = el('button', { type: 'button', class: 'gallery__slide', 'aria-label': image.label || t('gallery.open') }, img,
      image.label ? el('span', { class: 'gallery__label', text: image.label }) : null);
    slide.addEventListener('click', () => {
      const live = slides.filter((item) => item.slide.parentNode === track);
      openLightbox(live.map((item) => item.image), Math.max(0, live.findIndex((item) => item.slide === slide)));
    });
    img.addEventListener('error', () => {
      slide.remove();
      if (!track.children.length) root.remove();
    });
    return { slide, image };
  });
  const track = el('div', { class: 'gallery__track' }, slides.map((item) => item.slide));
  const root = el('div', { class: `gallery${list.length === 1 ? ' is-single' : ''}` }, track);
  return root;
}
