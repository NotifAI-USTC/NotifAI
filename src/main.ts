import { createApp } from 'vue'
import { createPinia } from 'pinia'
import vuetify from './plugins/vuetify'
import App from './App.vue'
import router from './router'
import { useAccountStore } from './stores/account'
import './style.css'

const app = createApp(App)

const pinia = createPinia()
app.use(pinia)

async function mount() {
  await useAccountStore(pinia).bootstrap()
  app.use(router)
  app.use(vuetify)
  app.mount('#app')
}

void mount()
