(() => {
  let readerId = 0;

  class FolioReader {
    constructor({ root, container, templates, onChange = () => {} }) {
      this.root = root;
      this.container = container;
      this.templates = Array.from(templates, node => node.cloneNode(true));
      this.onChange = onChange;
      this.id = ++readerId;
      this.state = { page: 0, part: 0, parts: 1 };
      this.layout = null;
    }

    getState() { return { ...this.state }; }

    render(page = this.state.page, { resetPart = false } = {}) {
      page = this._pageIndex(page);
      const part = resetPart || page !== this.state.page ? 0 : this.state.part;
      return this._render(page, part);
    }

    step(delta) {
      const direction = Math.sign(delta);
      if (!direction) return this.getState();
      for (let count = 0; count < Math.abs(Math.trunc(delta)); count++) {
        const { page, part, parts } = this.state;
        if (direction > 0 && part + 1 < parts) {
          this.state.part++;
          this._show();
        } else if (direction < 0 && part > 0) {
          this.state.part--;
          this._show();
        } else if (page + direction >= 0 && page + direction < this.templates.length) {
          this._render(page + direction, direction < 0 ? Infinity : 0, false);
        } else break;
      }
      this.onChange(this.getState());
      return this.getState();
    }

    _pageIndex(page) {
      return Math.max(0, Math.min(this.templates.length - 1, Number.isFinite(Number(page)) ? Math.trunc(Number(page)) : 0));
    }

    _render(page, part, notify = true) {
      const style = getComputedStyle(this.container);
      const width = Math.min(680, this.container.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
      const height = this.container.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      if (width < 1 || height < 1 || !this.templates[page]) return this.getState();
      const model = this._model(this.templates[page]);
      const measure = this._surface(model.title, true);
      measure.style.width = width + 'px';
      measure.style.height = height + 'px';
      this.container.appendChild(measure);
      const body = measure.querySelector('.fr-content');
      let parts;
      try {
        parts = this._paginate(model.blocks, body);
      } finally {
        measure.remove();
      }
      this.layout = { title: model.title, parts };
      this.state = { page, part: Math.max(0, Math.min(parts.length - 1, part)), parts: parts.length };
      this._show();
      if (notify) this.onChange(this.getState());
      return this.getState();
    }

    _surface(title, measuring = false) {
      const surface = document.createElement('article');
      surface.className = 'fr-surface' + (measuring ? ' fr-measure' : '');
      const heading = title.cloneNode(true);
      heading.classList.add('fr-title');
      if (measuring) {
        surface.inert = true;
        surface.setAttribute('aria-hidden', 'true');
        heading.removeAttribute('id');
      } else {
        surface.dataset.readerPage = '';
        surface.tabIndex = -1;
        heading.id = 'folio-reader-heading-' + this.id;
        surface.setAttribute('aria-labelledby', heading.id);
      }
      const body = document.createElement('div');
      body.className = 'fr-content';
      surface.append(heading, body);
      return surface;
    }

    _show() {
      if (!this.layout) return;
      const surface = this._surface(this.layout.title);
      surface.dataset.readerPart = String(this.state.part);
      surface.querySelector('.fr-content').append(...this.layout.parts[this.state.part].map(node => node.cloneNode(true)));
      this.container.replaceChildren(surface);
    }

    _model(template) {
      const page = template.querySelector('.bk-page') || template;
      const originalTitle = page.querySelector('h1, h2, .bk-last-title');
      const title = document.createElement(originalTitle?.tagName === 'H1' ? 'h1' : 'h2');
      if (originalTitle) {
        title.className = originalTitle.className;
        title.append(...Array.from(originalTitle.childNodes, node => node.cloneNode(true)));
      } else title.textContent = template.getAttribute('aria-label') || 'Portfolio';
      const blocks = [];
      const add = (node, atomic = false) => {
        const clone = node.cloneNode(true);
        clone.classList.add('fr-block');
        if (atomic) clone.dataset.readerAtomic = '';
        blocks.push(clone);
      };
      for (const child of page.children) {
        if (child === originalTitle || child.matches('.bk-page-top, .bk-page-number, .bk-cover-top, .bk-cover-bottom')) continue;
        if (child.matches('.bk-index')) {
          for (const button of child.children) {
            const wrapper = document.createElement('div');
            wrapper.className = 'bk-index';
            wrapper.appendChild(button.cloneNode(true));
            add(wrapper, true);
          }
        } else if (child.matches('.bk-practice-sections, .bk-education-history, .bk-steps')) {
          for (const section of child.children) add(section);
        } else if (child.matches('.bk-work-ledger')) {
          for (const row of child.children) {
            const paragraph = document.createElement('p');
            const label = document.createElement('strong');
            label.textContent = row.querySelector('dt')?.textContent || '';
            paragraph.append(label, ' ');
            const description = row.querySelector('dd');
            if (description) paragraph.append(...Array.from(description.childNodes, node => node.cloneNode(true)));
            add(paragraph);
          }
        } else if (child.matches('figure')) {
          for (const item of child.children) {
            if (item.matches('figcaption')) {
              const caption = document.createElement('p');
              caption.className = 'fr-caption';
              caption.append(...Array.from(item.childNodes, node => node.cloneNode(true)));
              add(caption);
            } else add(item, item.matches('button, a'));
          }
        } else add(child, child.matches('button, a'));
      }
      return { title, blocks };
    }

    _paginate(blocks, body) {
      const pages = [];
      let current = [];
      const fits = node => {
        body.appendChild(node);
        const result = body.scrollHeight <= body.clientHeight + 0.5;
        node.remove();
        return result;
      };
      const accept = node => { body.appendChild(node); current.push(node); };
      const finish = () => {
        if (current.length) pages.push(current);
        current = [];
        body.replaceChildren();
      };
      for (let block of blocks) {
        this._fitVisual(block, body.clientHeight);
        while (block) {
          if (fits(block)) { accept(block); break; }
          const split = !block.hasAttribute('data-reader-atomic') && this._split(block, fits, current.length > 0);
          if (split) {
            accept(split[0]);
            finish();
            block = split[1];
          } else if (current.length) finish();
          else {
            // A normal device has room for a line; never silently discard content.
            throw new Error('The reading area is too short for this content.');
          }
        }
      }
      finish();
      return pages.length ? pages : [[]];
    }

    _fitVisual(block, availableHeight) {
      block.querySelectorAll('[data-legacy-site]').forEach(visual => {
        const width = Math.max(1, availableHeight - 44) * 16 / 9;
        visual.style.width = 'min(100%, ' + width + 'px)';
        visual.style.marginInline = 'auto';
      });
    }

    _split(block, fits, avoidShortFragment) {
      const points = [];
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (const match of node.textContent.matchAll(/\S+/g)) points.push({ node, offset: match.index + match[0].length });
      }
      if (points.length < 2) return null;
      const fragment = (point, before) => {
        const range = document.createRange();
        range.selectNodeContents(block);
        if (before) range.setEnd(point.node, point.offset);
        else range.setStart(point.node, point.offset);
        const result = block.cloneNode(false);
        result.appendChild(range.cloneContents());
        this._trimStart(result);
        return result;
      };
      let low = 1, high = points.length - 1, best = 0;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        if (fits(fragment(points[middle - 1], true))) { best = middle; low = middle + 1; }
        else high = middle - 1;
      }
      if (!best || (avoidShortFragment && best < 3)) return null;
      const left = fragment(points[best - 1], true);
      const right = fragment(points[best - 1], false);
      const heading = left.querySelector('h3');
      if (heading && left.textContent.trim() === heading.textContent.trim()) return null;
      if (!left.textContent.trim() || !right.textContent.trim()) return null;
      return [left, right];
    }

    _trimStart(node) {
      while (node.firstChild) {
        const first = node.firstChild;
        if (first.nodeType === Node.TEXT_NODE && !first.textContent.trim()) first.remove();
        else if (first.nodeType === Node.ELEMENT_NODE && first.tagName === 'BR') first.remove();
        else if (first.nodeType === Node.ELEMENT_NODE && !first.textContent.trim() && !first.querySelector('svg, img, video')) first.remove();
        else {
          if (first.nodeType === Node.ELEMENT_NODE) this._trimStart(first);
          break;
        }
      }
    }
  }

  window.FolioReader = FolioReader;
})();
