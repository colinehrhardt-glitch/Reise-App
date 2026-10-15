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
  if (/[?&]width=\d+/.test(src)) return src.replace(/([?&]width=)\d+/, '$11280');
  return /\/thumb\/.+\/\d+px-[^/]+$/.test(src) ? src.replace(/\/(\d+)px-([^/]+)$/, (match, size, name) => (Number(size) < 1280 ? `/1280px-${name}` : match)) : src;
}

export function openLightbox(images, start = 0) {
  const previous = document.activeElement;
  const picture = (image) => {
    const source = image.full || image.src;
    const img = el('img', { src: largeSrc(source), alt: image.label || '', decoding: 'async', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => {
      if (img.getAttribute('src') !== source) img.src = source;
    }, { once: true });
    return img;
  };
  const track = el('div', { class: 'lightbox__track' }, images.map((image, index) => el('figure', { class: 'lightbox__slide', 'aria-label': `${index + 1} / ${images.length}` },
    picture(image),
    el('figcaption', { class: 'lightbox__caption' },
      image.label ? el('span', { class: 'lightbox__label', text: image.label }) : null,
      image.link ? el('a', { class: 'lightbox__credit', href: image.link, target: '_blank', rel: 'noopener noreferrer', text: t('photo.credit', { source: image.credit || 'Wikimedia Commons' }) }) : null))));
  const step = (direction) => track.scrollBy({ left: direction * track.clientWidth, behavior: 'smooth' });
  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    if (previous && previous.isConnected && previous.focus) previous.focus({ preventScroll: true });
  };
  const onKey = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'ArrowRight') step(1);
    else if (event.key === 'ArrowLeft') step(-1);
    else if (event.key === 'Tab') {
      const focusable = [...overlay.querySelectorAll('button, a[href]')];
      const index = focusable.indexOf(document.activeElement);
      const next = event.shiftKey ? (index <= 0 ? focusable.length - 1 : index - 1) : (index + 1) % focusable.length;
      event.preventDefault();
      focusable[next].focus();
    }
  };
  const closeButton = el('button', { type: 'button', class: 'lightbox__close', 'aria-label': t('common.close'), onclick: close }, icon('close'));
  const arrows = images.length > 1 ? [
    el('button', { type: 'button', class: 'lightbox__nav lightbox__nav--prev', 'aria-label': t('gallery.prev'), onclick: () => step(-1) }, icon('chevron')),
    el('button', { type: 'button', class: 'lightbox__nav lightbox__nav--next', 'aria-label': t('gallery.next'), onclick: () => step(1) }, icon('chevron'))
  ] : [];
  const label = images[start] && images[start].label ? images[start].label : t('gallery.open');
  const overlay = el('div', { class: 'lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': label }, track, ...arrows, closeButton);
  document.addEventListener('keydown', onKey, true);
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
