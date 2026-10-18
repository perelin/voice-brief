export type Speaking = boolean

declare module 'claude-code' {
  interface PluginState {
    'voice-brief': { isSpeaking: Speaking }
  }
}
