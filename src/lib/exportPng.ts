import { toPng } from 'html-to-image';

export async function exportElementToPng(node: HTMLElement, filename: string): Promise<void> {
  const descendants = Array.from(node.querySelectorAll<HTMLElement>('*'));
  const targets = [node, ...descendants];
  const previous = targets.map((element) => ({
    element,
    maxHeight: element.style.maxHeight,
    maxWidth: element.style.maxWidth,
    height: element.style.height,
    width: element.style.width,
    overflow: element.style.overflow,
    overflowX: element.style.overflowX,
    overflowY: element.style.overflowY,
  }));

  for (const element of targets) {
    const computed = window.getComputedStyle(element);
    if (computed.overflow !== 'visible') element.style.overflow = 'visible';
    if (computed.overflowX !== 'visible') element.style.overflowX = 'visible';
    if (computed.overflowY !== 'visible') element.style.overflowY = 'visible';
    element.style.maxHeight = 'none';
    element.style.maxWidth = 'none';
  }

  node.setAttribute('data-exporting', 'true');

  const width = Math.max(node.scrollWidth, node.offsetWidth);
  const height = Math.max(node.scrollHeight, node.offsetHeight);

  try {
    const dataUrl = await toPng(node, {
      cacheBust: true,
      backgroundColor: '#ffffff',
      pixelRatio: 2,
      width,
      height,
      canvasWidth: width,
      canvasHeight: height,
      style: {
        transform: 'none',
      },
      filter: (el) => {
        if (!(el instanceof HTMLElement)) return true;
        return el.getAttribute('data-export') !== 'ignore';
      },
    });
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename.endsWith('.png') ? filename : `${filename}.png`;
    link.click();
  } finally {
    for (const snapshot of previous) {
      snapshot.element.style.maxHeight = snapshot.maxHeight;
      snapshot.element.style.maxWidth = snapshot.maxWidth;
      snapshot.element.style.height = snapshot.height;
      snapshot.element.style.width = snapshot.width;
      snapshot.element.style.overflow = snapshot.overflow;
      snapshot.element.style.overflowX = snapshot.overflowX;
      snapshot.element.style.overflowY = snapshot.overflowY;
    }
    node.removeAttribute('data-exporting');
  }
}

export function buildPngFilename(prefix: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const safePrefix = prefix.replace(/[^a-z0-9-_]+/gi, '-').replace(/-+/g, '-');
  return `${safePrefix}-${stamp}.png`;
}
