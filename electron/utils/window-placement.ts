interface Rectangle { x: number; y: number; width: number; height: number }

export function restoreWindowBounds(saved: Partial<Rectangle>, workArea: Rectangle): Rectangle {
  const finite = (value: number | undefined, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback
  const width = Math.min(workArea.width, Math.max(Math.min(1100, workArea.width), finite(saved.width, 1400)))
  const height = Math.min(workArea.height, Math.max(Math.min(700, workArea.height), finite(saved.height, 900)))
  return {
    width, height,
    x: Math.max(workArea.x, Math.min(workArea.x + workArea.width - width, finite(saved.x, workArea.x))),
    y: Math.max(workArea.y, Math.min(workArea.y + workArea.height - height, finite(saved.y, workArea.y))),
  }
}
