/** Save text to a file the user picks up in their Downloads (RT-404). Browser API wrapper. */
export function downloadText(filename: string, mime: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  // Revoking immediately can cancel the download in some browsers; one tick is enough.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
