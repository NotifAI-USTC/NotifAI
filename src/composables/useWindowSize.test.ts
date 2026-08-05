import { createApp, h, type App, type Ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useWindowSize } from './useWindowSize'

interface MountedConsumer {
  app: App
  element: HTMLDivElement
  isMobile: Ref<boolean>
}

function mountConsumer(): MountedConsumer {
  const element = document.createElement('div')
  document.body.appendChild(element)
  let isMobile!: Ref<boolean>

  const app = createApp({
    setup() {
      const windowSize = useWindowSize()
      isMobile = windowSize.isMobile
      return () => h('div')
    },
  })
  app.mount(element)

  return { app, element, isMobile }
}

function unmountConsumer(consumer: MountedConsumer) {
  consumer.app.unmount()
  consumer.element.remove()
}

describe('useWindowSize', () => {
  it('keeps the shared resize listener until the last consumer unmounts', () => {
    const originalWidth = window.innerWidth
    const addEventListener = vi.spyOn(window, 'addEventListener')
    const removeEventListener = vi.spyOn(window, 'removeEventListener')
    const first = mountConsumer()
    const second = mountConsumer()

    try {
      const resizeAdds = addEventListener.mock.calls.filter(([type]) => type === 'resize')
      expect(resizeAdds).toHaveLength(1)

      unmountConsumer(first)
      expect(removeEventListener.mock.calls.filter(([type]) => type === 'resize')).toHaveLength(0)

      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 })
      window.dispatchEvent(new Event('resize'))
      expect(second.isMobile.value).toBe(true)

      unmountConsumer(second)
      expect(removeEventListener.mock.calls.filter(([type]) => type === 'resize')).toHaveLength(1)
    } finally {
      if (first.element.isConnected) unmountConsumer(first)
      if (second.element.isConnected) unmountConsumer(second)
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        value: originalWidth,
      })
    }
  })
})
