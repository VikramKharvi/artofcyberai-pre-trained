const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const progressBar = document.querySelector('.scroll-progress span');
const parallaxItems = [...document.querySelectorAll('[data-parallax]')];

const mediumPosts = window.MEDIUM_POSTS || {};
document.querySelectorAll('[data-medium-post]').forEach((link) => {
  const mediumUrl = mediumPosts[link.dataset.mediumPost];
  if (!mediumUrl) return;
  link.href = mediumUrl;
  link.hidden = false;
});

function updateScrollEffects() {
  const scrollTop = window.scrollY;
  const scrollRange = document.documentElement.scrollHeight - window.innerHeight;
  const progress = scrollRange > 0 ? scrollTop / scrollRange : 0;
  progressBar.style.transform = `scaleX(${progress})`;

  if (!reducedMotion.matches) {
    parallaxItems.forEach((item) => {
      const speed = Number(item.dataset.parallax) || 0;
      const rect = item.getBoundingClientRect();
      const distanceFromCenter = rect.top + rect.height / 2 - window.innerHeight / 2;
      const shift = Math.max(-26, Math.min(26, distanceFromCenter * -speed));
      item.style.setProperty('--parallax-y', `${shift}px`);
    });
  }
}

let ticking = false;
function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    updateScrollEffects();
    ticking = false;
  });
}

const revealObserver = new IntersectionObserver((entries, observer) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add('is-visible');
    observer.unobserve(entry.target);
  });
}, { threshold: 0.14, rootMargin: '0px 0px -6% 0px' });

document.querySelectorAll('.reveal:not(.is-visible)').forEach((item) => revealObserver.observe(item));

const navLinks = [...document.querySelectorAll('.nav-links a')];
const trackedSections = navLinks
  .filter((link) => link.getAttribute('href')?.startsWith('#'))
  .map((link) => document.querySelector(link.getAttribute('href')))
  .filter(Boolean);

const sectionObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    navLinks.forEach((link) => {
      const active = link.getAttribute('href') === `#${entry.target.id}`;
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  });
}, { rootMargin: '-20% 0px -65% 0px' });

trackedSections.forEach((section) => sectionObserver.observe(section));

function updateLocalTime() {
  const timeTarget = document.querySelector('#local-time');
  if (!timeTarget) return;
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(new Date());
  timeTarget.textContent = `${time} PT`;
}

window.addEventListener('scroll', onScroll, { passive: true });
window.addEventListener('resize', onScroll, { passive: true });
reducedMotion.addEventListener?.('change', onScroll);
updateLocalTime();
updateScrollEffects();

import("./site-chat.js?v=fieldnotes1").catch((error) => console.warn("Site chat unavailable:", error));
