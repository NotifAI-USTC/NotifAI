import { flushPromises, shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUserSettingsStore } from '../stores/userSettings'
import OnboardingModal from './OnboardingModal.vue'

vi.mock('../utils/request', () => ({
  fetchSources: vi.fn().mockResolvedValue([
    { name: '教务处', group: '校级部门', noticeCount: 10 },
    { name: '学生事务中心', group: '校级部门', noticeCount: 3 },
    { name: '计算机学院', group: '二级学院', noticeCount: 2 },
    { name: '大数据学院', group: '二级学院', noticeCount: 1 },
  ]),
}))

const stubs = {
  VDialog: {
    name: 'VDialogStub',
    props: { persistent: Boolean },
    template: '<div v-bind="$attrs"><slot /></div>',
  },
  VCard: { template: '<div><slot /></div>' },
  VCardTitle: { template: '<div><slot /></div>' },
  VCardText: { template: '<div><slot /></div>' },
  VCardActions: { template: '<div><slot /></div>' },
  VAvatar: { template: '<span><slot /></span>' },
  VIcon: { template: '<span><slot /></span>' },
  VChip: { template: '<button v-bind="$attrs"><slot /></button>' },
  VBtn: {
    props: ['disabled'],
    template: '<button v-bind="$attrs" :disabled="disabled"><slot /></button>',
  },
  VProgressLinear: true,
  VSpacer: { template: '<span />' },
  VTextField: true,
  VAlert: { template: '<div><slot /></div>' },
}

function mountModal() {
  return shallowMount(OnboardingModal, {
    global: {
      plugins: [createPinia()],
      stubs,
    },
  })
}

function findButton(wrapper: ReturnType<typeof mountModal>, text: string) {
  const button = wrapper.findAll('button').find((item) => item.text().includes(text))
  if (!button) throw new Error(`未找到按钮：${text}`)
  return button
}

describe('OnboardingModal', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    window.localStorage.clear()
  })

  it('is persistent and commits the selected onboarding profile', async () => {
    const wrapper = mountModal()
    const dialog = wrapper.findComponent({ name: 'VDialogStub' })

    expect(dialog.props('persistent')).toBe(true)
    expect(wrapper.text()).toContain('欢迎使用 NotifAI-USTC')

    await findButton(wrapper, '开始个性化配置').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('学生事务中心')
    await findButton(wrapper, '本科生关注教务、本科生院等本科培养信息').trigger('click')
    await findButton(wrapper, '下一步：选择二级学院').trigger('click')
    await flushPromises()
    await findButton(wrapper, '下一步：AI 过滤设置').trigger('click')
    await findButton(wrapper, '开启我的智能看板').trigger('click')
    await flushPromises()

    const store = useUserSettingsStore()
    expect(store.hasOnboarded).toBe(true)
    expect(store.userIdentity).toBe('undergraduate')
    expect(store.subscribedChannels).toEqual(['教务处', '本科生院'])
  })

  it('loads secondary schools from the API and supports multiple selections', async () => {
    const wrapper = mountModal()

    await findButton(wrapper, '开始个性化配置').trigger('click')
    await findButton(wrapper, '新生').trigger('click')
    await findButton(wrapper, '下一步：选择二级学院').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('计算机学院')
    expect(wrapper.text()).toContain('大数据学院')
    await findButton(wrapper, '计算机学院').trigger('click')
    await findButton(wrapper, '大数据学院').trigger('click')
    await findButton(wrapper, '下一步：AI 过滤设置').trigger('click')
    await findButton(wrapper, '开启我的智能看板').trigger('click')
    await flushPromises()

    const store = useUserSettingsStore()
    expect(store.subscribedChannels).toEqual([
      '教务处',
      '本科生院',
      '迎新特辑',
      '计算机学院',
      '大数据学院',
    ])
  })

  it('allows continuing without selecting any secondary school', async () => {
    const wrapper = mountModal()

    await findButton(wrapper, '开始个性化配置').trigger('click')
    await findButton(wrapper, '新生').trigger('click')
    await findButton(wrapper, '下一步：选择二级学院').trigger('click')
    await flushPromises()
    await findButton(wrapper, '下一步：AI 过滤设置').trigger('click')
    await findButton(wrapper, '开启我的智能看板').trigger('click')
    await flushPromises()

    const store = useUserSettingsStore()
    expect(store.subscribedChannels).toEqual(['教务处', '本科生院', '迎新特辑'])
  })
})
