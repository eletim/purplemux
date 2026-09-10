export const CUSTOM_CSS_ELEMENT_ID = 'purplemux-custom-css';

interface ICustomCssDocument {
  getElementById: (id: string) => HTMLElement | null;
  createElement: (tagName: 'style') => HTMLStyleElement;
  head: Pick<HTMLHeadElement, 'appendChild'>;
}

export const syncCustomCss = (document: ICustomCssDocument, customCSS: string) => {
  let element = document.getElementById(CUSTOM_CSS_ELEMENT_ID);

  if (!customCSS) {
    element?.remove();
    return;
  }

  if (!element) {
    element = document.createElement('style');
    element.id = CUSTOM_CSS_ELEMENT_ID;
    document.head.appendChild(element);
  }

  element.textContent = customCSS;
};
