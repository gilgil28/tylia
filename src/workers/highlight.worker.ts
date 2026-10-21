// Syntax highlighting off the main thread (docs/ARCHITECTURE.md). Shiki with its JavaScript
// regex engine — the app's CSP allows neither WebAssembly nor eval. Grammars and themes
// load on first use.

import {
  createHighlighterCore,
  type HighlighterCore,
  type LanguageRegistration,
  type ThemeRegistration,
} from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

import type {
  HighlightRequest,
  HighlightResponse,
  HighlightTheme,
} from "@/features/diff/highlight";
import type { HighlightLang } from "@/features/diff/language";
import type { Token } from "@/features/diff/segments";

type Loader<T> = () => Promise<{ default: T }>;

const LANGS = {
  c: () => import("shiki/langs/c.mjs"),
  cpp: () => import("shiki/langs/cpp.mjs"),
  csharp: () => import("shiki/langs/csharp.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  dart: () => import("shiki/langs/dart.mjs"),
  docker: () => import("shiki/langs/docker.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  ini: () => import("shiki/langs/ini.mjs"),
  java: () => import("shiki/langs/java.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  jsonc: () => import("shiki/langs/jsonc.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  kotlin: () => import("shiki/langs/kotlin.mjs"),
  less: () => import("shiki/langs/less.mjs"),
  lua: () => import("shiki/langs/lua.mjs"),
  make: () => import("shiki/langs/make.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  php: () => import("shiki/langs/php.mjs"),
  powershell: () => import("shiki/langs/powershell.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  ruby: () => import("shiki/langs/ruby.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  scss: () => import("shiki/langs/scss.mjs"),
  shellscript: () => import("shiki/langs/shellscript.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  svelte: () => import("shiki/langs/svelte.mjs"),
  swift: () => import("shiki/langs/swift.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  vue: () => import("shiki/langs/vue.mjs"),
  xml: () => import("shiki/langs/xml.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
} satisfies Record<HighlightLang, Loader<LanguageRegistration[]>>;

// GitHub's default themes: designed for exactly this background family (#fff / #0d1117)
// and to stay legible on top of green and red diff tints.
const THEMES = {
  light: {
    name: "github-light-default",
    load: () => import("shiki/themes/github-light-default.mjs"),
  },
  dark: { name: "github-dark-default", load: () => import("shiki/themes/github-dark-default.mjs") },
} satisfies Record<HighlightTheme, { name: string; load: Loader<ThemeRegistration> }>;

/** Lines longer than this are left plain; tokenizing minified code is slow and useless. */
const MAX_LINE_LENGTH = 2000;
/** `FontStyle.Italic` in vscode-textmate (not re-exported by Shiki). */
const ITALIC = 1;

const engine = createJavaScriptRegexEngine({ forgiving: true });
let highlighter: Promise<HighlighterCore> | undefined;
const loaded = new Map<string, Promise<void>>();

/** Loads a grammar or theme into the highlighter once. */
function ensure(key: string, load: () => Promise<void>): Promise<void> {
  let promise = loaded.get(key);
  if (!promise) {
    promise = load();
    loaded.set(key, promise);
  }
  return promise;
}

async function highlight({ lines, lang, theme }: HighlightRequest): Promise<Token[][]> {
  const h = await (highlighter ??= createHighlighterCore({ engine }));
  const { name, load } = THEMES[theme];
  await Promise.all([
    ensure(`lang:${lang}`, async () => h.loadLanguage((await LANGS[lang]()).default)),
    ensure(`theme:${theme}`, async () => h.loadTheme((await load()).default)),
  ]);
  const result = h.codeToTokens(lines.join("\n"), {
    lang,
    theme: name,
    tokenizeMaxLineLength: MAX_LINE_LENGTH,
  });
  // Plain text inherits the app's text colour instead of the theme's.
  const fg = result.fg?.toLowerCase();
  return result.tokens.map((line) =>
    line.map((tok): Token => {
      const color = tok.color && tok.color.toLowerCase() !== fg ? tok.color : undefined;
      const italic = tok.fontStyle !== undefined && (tok.fontStyle & ITALIC) !== 0;
      return { content: tok.content, ...(color && { color }), ...(italic && { italic }) };
    }),
  );
}

self.onmessage = async (e: MessageEvent<HighlightRequest>) => {
  const { id } = e.data;
  let response: HighlightResponse;
  try {
    response = { id, tokens: await highlight(e.data) };
  } catch (err) {
    response = { id, error: err instanceof Error ? err.message : String(err) };
  }
  self.postMessage(response);
};
