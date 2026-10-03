(inputs) => {
  const rows = Array.isArray(inputs[0].data) ? inputs[0].data : [];
  return {
    tag: 'svg',
    attrs: { viewBox: '0 0 640 200' },
    children: [
      { tag: 'rect', attrs: { width: 640, height: 200, rx: 12, fill: '#18282b' } },
      { tag: 'text', attrs: { x: 28, y: 48, fill: '#91d4b8', 'font-size': 19 }, text: inputs[0].title },
      ...rows.slice(0, 4).map((row, i) => ({
        tag: 'text',
        attrs: { x: 28, y: 87 + i * 27, fill: '#a6bcb9', 'font-size': 13 },
        text: Object.values(row).join('  ·  '),
      })),
    ],
  };
}
