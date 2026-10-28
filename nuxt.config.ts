export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',

  modules: ['@nuxt/ui'],

  devtools: { enabled: false },

  css: ['~/assets/css/main.css'],

  app: {
    head: {
      htmlAttrs: { lang: 'it' },
      title: 'Marketer',
    },
  },
})
