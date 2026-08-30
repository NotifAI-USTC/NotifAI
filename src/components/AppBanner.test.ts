import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AppBanner from './AppBanner.vue'

const alertStub = {
  name: 'VAlertStub',
  props: ['type', 'variant', 'density', 'icon'],
  template: '<div v-bind="$attrs"><slot name="prepend" /><slot /><slot name="append" /></div>',
}

describe('AppBanner', () => {
  it('uses compact tonal defaults and forwards banner slots and attributes', () => {
    const wrapper = mount(AppBanner, {
      attrs: { role: 'status', 'data-test': 'banner' },
      slots: {
        default: '正在同步最新通知',
        append: '重试',
      },
      global: {
        stubs: { VAlert: alertStub },
      },
    })

    const alert = wrapper.findComponent({ name: 'VAlertStub' })
    expect(alert.props('type')).toBe('info')
    expect(alert.props('variant')).toBe('tonal')
    expect(alert.props('density')).toBe('compact')
    expect(wrapper.find('.app-banner').exists()).toBe(true)
    expect(wrapper.get('[role="status"]').attributes('data-test')).toBe('banner')
    expect(wrapper.text()).toContain('正在同步最新通知')
    expect(wrapper.text()).toContain('重试')
  })
})
