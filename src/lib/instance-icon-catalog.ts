const iconModules = import.meta.glob<string>(
  '../assets/portal-instance-icons/*.png',
  { eager: true, query: '?url', import: 'default' },
);

export const instanceIconCatalog = Object.entries(iconModules)
  .map(([path, src]) => {
    const file = path.split('/').pop() ?? '';
    const id = file.replace(/\.png$/i, '');
    const name = id
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
    return { id, name, src };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

export async function loadInstanceIconDataUrl(src: string): Promise<string> {
  const response = await fetch(src);
  if (!response.ok) throw new Error('Не удалось загрузить стандартную иконку.');
  const blob = await response.blob();
  if (blob.size > 8 * 1024 * 1024) throw new Error('Файл иконки превышает 8 МБ.');

  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Не удалось прочитать изображение иконки.'));
    };
    reader.onerror = () => reject(new Error('Не удалось прочитать изображение иконки.'));
    reader.readAsDataURL(blob);
  });
}
