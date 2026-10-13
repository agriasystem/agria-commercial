// Costruzione di elementi DOM per tutte le pagine di Agria Commercial. Il testo va sempre a schermo
// come testo (textContent), mai come HTML.

/** el('p', { class: 'x', text: 'ciao', onclick, onchange }, figlio1, figlio2…): gli eventi sono funzioni, mai attributi */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'text') node.textContent = v;
    else if (/^on[a-z]+$/.test(k) && typeof v === 'function') node.addEventListener(k.slice(2), v); // onclick, onchange…
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const child of children.flat()) {
    if (child == null || child === false || child === '') continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}
