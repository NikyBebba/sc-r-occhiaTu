'use strict';
// Shared, presentation-only suggestions for values already present in group nights.
const HistoryAutocomplete = (() => {
  const bindings = new Map();
  const normalize = value => String(value ?? '').trim().toLocaleLowerCase('it');
  function recency(night) {
    const date = typeof night?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(night.date) ? night.date : '';
    const created = String(night?.created_at || '');
    return date ? `${date}T23:59:59` : created;
  }
  function rank(nights, field, query) {
    const term = normalize(query);
    if (term.length < 2 || !Array.isArray(nights)) return [];
    const values = new Map();
    for (const night of nights) {
      const value = String(night?.[field] ?? '').trim();
      const key = normalize(value);
      if (!key) continue;
      const stamp = recency(night), previous = values.get(key);
      if (!previous) values.set(key, { value, count: 1, latest: stamp });
      else {
        previous.count++;
        if (stamp > previous.latest) { previous.latest = stamp; previous.value = value; }
      }
    }
    return [...values.values()]
      .filter(item => normalize(item.value).includes(term))
      .sort((a, b) => b.count - a.count || b.latest.localeCompare(a.latest) || a.value.localeCompare(b.value, 'it'))
      .slice(0, 5).map(item => item.value);
  }
  function bind(input, list, field, getNights) {
    if (!input || !list || !['snack', 'location'].includes(field)) return () => {};
    const ownerDocument=list.ownerDocument||input.ownerDocument||(typeof document!=='undefined'?document:null);
    const prior = bindings.get(input);
    if (prior) { prior.list = list; prior.field = field; prior.getNights = getNights; prior.render(); return prior.refresh; }
    let active = -1;
    const clearList=()=>{if(typeof list.replaceChildren==='function')list.replaceChildren();else list.innerHTML='';};
    const close = () => {
      list.classList.add('hidden'); clearList();
      input.setAttribute('aria-expanded', 'false'); input.removeAttribute?.('aria-activedescendant'); active = -1;
    };
    const render = () => {
      clearList(); active = -1;
      const hits = rank(getNights?.(), field, input.value);
      if (!hits.length) { close(); return; }
      hits.forEach((value, index) => {
        const option = ownerDocument.createElement('button');
        option.type = 'button'; option.id = `${list.id}-option-${index}`;
        option.setAttribute('role', 'option'); option.setAttribute('aria-selected', 'false');
        option.textContent = value;
        option.addEventListener('click', () => { input.value = value; close(); input.focus(); input.dispatchEvent(new Event('change', { bubbles: true })); });
        list.appendChild(option);
      });
      list.classList.remove('hidden'); input.setAttribute('aria-expanded', 'true');
    };
    const keydown = event => {
      const options = [...list.querySelectorAll('[role="option"]')];
      if (event.key === 'Escape') { close(); return; }
      if (!options.length) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        active = event.key === 'ArrowDown' ? (active + 1) % options.length : (active < 0 ? options.length - 1 : (active - 1 + options.length) % options.length);
        options.forEach((option, index) => option.setAttribute('aria-selected', String(index === active)));
        input.setAttribute('aria-activedescendant', options[active].id);
      } else if (event.key === 'Enter' && active >= 0) { event.preventDefault(); options[active].click(); }
    };
    const outside = event => { if (event.target !== input && !input.contains(event.target) && !list.contains(event.target)) close(); };
    input.addEventListener('input', render); input.addEventListener('keydown', keydown);
    ownerDocument?.addEventListener?.('pointerdown', outside); ownerDocument?.addEventListener?.('focusin', outside);
    const binding = { list, field, getNights, render, refresh: render, close,
      dispose(){close();input.removeEventListener('input',render);input.removeEventListener('keydown',keydown);ownerDocument?.removeEventListener?.('pointerdown',outside);ownerDocument?.removeEventListener?.('focusin',outside);} };
    bindings.set(input, binding); render(); return binding.refresh;
  }
  function refreshAll() {
    for (const [input, binding] of bindings) {
      if (!input.isConnected) { closeBinding(input, binding); continue; }
      if (!binding.list.isConnected) { closeBinding(input, binding); continue; }
      binding.render();
    }
  }
  function closeBinding(input, binding) {
    binding.dispose?.();
    bindings.delete(input);
  }
  return Object.freeze({ bind, rank, refreshAll });
})();
if (typeof module !== 'undefined' && module.exports) module.exports = HistoryAutocomplete;
