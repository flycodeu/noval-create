import { useEffect, useState } from 'react'

export interface ResponsivePanelHeightOptions {
  minHeight?: number
  maxHeight?: number
  ratio?: number
  fallback?: number
}

interface BrowserWindowLike {
  innerHeight: number
  addEventListener: (type: string, listener: () => void) => void
  removeEventListener: (type: string, listener: () => void) => void
}

function getBrowserWindow(): BrowserWindowLike | null {
  if (typeof globalThis === 'undefined') {
    return null
  }

  const candidate = globalThis as typeof globalThis & { innerHeight?: unknown }
  return typeof candidate.innerHeight === 'number' ? candidate as unknown as BrowserWindowLike : null
}

export function getResponsivePanelHeight(
  viewportHeight: number | undefined,
  {
    minHeight = 320,
    maxHeight = 720,
    ratio = 0.56,
    fallback = 480,
  }: ResponsivePanelHeightOptions = {},
) {
  if (!Number.isFinite(viewportHeight) || (viewportHeight ?? 0) <= 0) {
    return fallback
  }

  return Math.min(maxHeight, Math.max(minHeight, Math.round((viewportHeight as number) * ratio)))
}

export function useResponsivePanelHeight(options: ResponsivePanelHeightOptions = {}) {
  const { minHeight, maxHeight, ratio, fallback } = options
  const [height, setHeight] = useState(() => getResponsivePanelHeight(
    getBrowserWindow()?.innerHeight,
    options,
  ))

  useEffect(() => {
    const browserWindow = getBrowserWindow()
    if (!browserWindow) {
      return undefined
    }

    const updateHeight = () => {
      setHeight(getResponsivePanelHeight(browserWindow.innerHeight, { minHeight, maxHeight, ratio, fallback }))
    }

    browserWindow.addEventListener('resize', updateHeight)
    updateHeight()
    return () => browserWindow.removeEventListener('resize', updateHeight)
  }, [fallback, maxHeight, minHeight, ratio])

  return height
}
