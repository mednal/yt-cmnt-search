/** Small DOM builders shared by the panel's sections. */

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`sidepanel.html is missing #${id}`);
  }
  return element as T;
}

/** A label/value line, as used by the status card. */
export function row(label: string, value: string): HTMLElement {
  const element = document.createElement('div');
  element.className = 'row';

  const key = document.createElement('span');
  key.className = 'row__label';
  key.textContent = label;

  const val = document.createElement('span');
  val.className = 'row__value';
  val.textContent = value;

  element.append(key, val);
  return element;
}

export function note(text: string, modifier?: string): HTMLElement {
  const element = document.createElement('p');
  element.className = modifier ? `note ${modifier}` : 'note';
  element.textContent = text;
  return element;
}

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}
