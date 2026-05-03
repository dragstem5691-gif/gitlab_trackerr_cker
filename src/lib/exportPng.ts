import { toPng } from 'html-to-image';

export async function exportElementToPng(node: HTMLElement, filename: string): Promise<void> {
  const prev = {
    maxHeight: node.style.maxHeight,
    overflow: node.style.overflow,
  };
  node.style.maxHeight = 'none';
  node.style.overflow = 'visible';
  node.setAttribute('data-exporting', 'true');

  try {
    const dataUrl = await toPng(node, {
      cacheBust: true,
      backgroundColor: '#ffffff',
      pixelRatio: 2,
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
    node.style.maxHeight = prev.maxHeight;
    node.style.overflow = prev.overflow;
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
