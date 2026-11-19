import { createApp, ref } from 'vue'
import { createPinia } from 'pinia'
import vuetify from './plugins/vuetify'
import App from './App.vue'
import router from './router'
import { ACCOUNT_STARTUP_READY } from './stores/userSettings'
import './style.css'

const app = createApp(App)

const pinia = createPinia()
app.use(pinia)

const accountStartupReady = ref(false)
app.provide(ACCOUNT_STARTUP_READY, accountStartupReady)
app.use(router)
app.use(vuetify)
app.mount('#app')
