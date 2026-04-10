import { defineConfig } from 'vitepress'
import path from 'node:path'

// markdown-it plugin: add v-pre to inline <code> elements containing {{ }}
// so VitePress doesn't try to compile them as Vue template expressions.
function vPreInlineCode(md: { core: { ruler: { push: (name: string, fn: (state: { tokens: Array<{ type: string; children: Array<{ type: string; content: string }> | null }> }) => void) => void } } }) {
  md.core.ruler.push('v_pre_inline_code', (state) => {
    for (const token of state.tokens) {
      if (token.type !== 'inline' || !token.children) continue
      for (const child of token.children) {
        if (child.type === 'code_inline' && child.content.includes('{{')) {
          child.type = 'html_inline'
          child.content = `<code v-pre>${child.content}</code>`
        }
      }
    }
  })
}

export default defineConfig({
  title: 'Hologram',
  description: 'Discord bot for collaborative worldbuilding and roleplay',
  head: [
    ['link', { rel: 'icon', href: '/hologram/favicon.ico', sizes: 'any' }],
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/hologram/icon.svg' }],
    ['link', { rel: 'icon', type: 'image/png', href: '/hologram/icon.png' }],
  ],
  base: '/hologram/',
  srcExclude: ['archive/**'],

  markdown: {
    config: (md) => {
      vPreInlineCode(md)
    },
  },

  vite: {
    resolve: {
      alias: {
        // Redirect expr.ts's import of src/ai/context to browser shim
        [path.resolve(__dirname, '../../src/ai/context')]:
          path.resolve(__dirname, 'playground/shims/ai-context.ts'),
      },
    },
    optimizeDeps: {
      include: ['monaco-editor/esm/vs/editor/editor.api.js'],
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('monaco-editor')) return 'monaco'
            if (id.includes('nunjucks')) return 'nunjucks'
            if (id.includes('playground') || id.includes('src/logic/expr')) return 'playground'
          },
        },
      },
    },
  },

  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Reference', link: '/reference/commands' },
      { text: 'Playground', link: '/playground/facts' },
    ],

    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting Started', link: '/guide/getting-started' },
          { text: 'Core Concepts', link: '/guide/concepts' },
          { text: 'Creating a Persona', link: '/guide/personas' },
          { text: 'Multi-Character Scenes', link: '/guide/multi-character' },
          { text: 'Permissions', link: '/guide/permissions' },
          { text: 'SillyTavern Migration', link: '/guide/sillytavern' },
          { text: 'Editor Setup', link: '/guide/editor-setup' },
        ]
      },
      {
        text: 'Reference',
        items: [
          { text: 'Commands', link: '/reference/commands' },
          { text: 'Facts & Directives', link: '/reference/facts' },
          { text: 'Expressions', link: '/reference/expressions' },
          { text: 'Custom Templates', link: '/reference/templates' },
          { text: 'Tool Calls', link: '/reference/tools' },
          { text: 'Configuration', link: '/reference/configuration' },
        ]
      },
      {
        text: 'Playground',
        items: [
          { text: 'Fact Evaluation', link: '/playground/facts' },
          { text: 'Template Rendering', link: '/playground/templates' },
        ]
      },
      {
        text: 'Architecture',
        items: [
          { text: 'Design Philosophy', link: '/philosophy' },
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/exo-place/hologram' }
    ],

    search: {
      provider: 'local'
    },

    editLink: {
      pattern: 'https://github.com/exo-place/hologram/edit/master/docs/:path',
      text: 'Edit this page on GitHub'
    },

    footer: {
      message: 'Released under the MIT License.',
    }
  }
})
