export type Speaking = boolean

declare module 'claude-code' {
  interface PluginState {
    jarvis: { isSpeaking: Speaking }
  }
}
