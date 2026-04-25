// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import starlightLinksValidator from "starlight-links-validator";
import mermaid from "astro-mermaid";

// https://astro.build/config
export default defineConfig({
  site: "https://ohah.github.io",
  base: "/bungae",
  integrations: [
    mermaid({
      theme: "dark",
      autoTheme: true,
    }),
    starlight({
      title: "Bungae",
      description: "Metro 호환 React Native 번들러 — Zig 코어 + Bun 런타임으로 5x 빠른 번들",
      logo: {
        src: "./public/favicon.svg",
      },
      expressiveCode: {
        themes: ["github-dark", "github-light"],
        styleOverrides: {
          borderRadius: "0.375rem",
          codePaddingBlock: "0.875rem",
          codePaddingInline: "1.125rem",
          codeFontSize: "0.875rem",
          codeLineHeight: "1.7",
          frames: {
            shadowColor: "rgba(0, 0, 0, 0.12)",
          },
        },
        defaultProps: {
          showLineNumbers: false,
          wrap: false,
        },
      },
      plugins: [starlightLinksValidator()],
      defaultLocale: "root",
      locales: {
        root: { label: "한국어", lang: "ko" },
        en: { label: "English", lang: "en" },
      },
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/ohah/bungae",
        },
      ],
      sidebar: [
        {
          label: "시작하기",
          translations: { en: "Getting Started" },
          items: [
            { label: "소개", slug: "guides/introduction", translations: { en: "Introduction" } },
            { label: "왜 빠른가", slug: "guides/why-fast", translations: { en: "Why It's Fast" } },
            { label: "설치", slug: "guides/installation", translations: { en: "Installation" } },
            { label: "빠른 시작", slug: "guides/quick-start", translations: { en: "Quick Start" } },
          ],
        },
        {
          label: "설정",
          translations: { en: "Configuration" },
          items: [
            { label: "설정 파일", slug: "guides/config-file", translations: { en: "Config File" } },
            { label: "Expo 통합", slug: "guides/expo", translations: { en: "Expo Integration" } },
          ],
        },
        {
          label: "아키텍처",
          translations: { en: "Architecture" },
          items: [
            { label: "개요", slug: "guides/architecture", translations: { en: "Overview" } },
            { label: "번들링 파이프라인", slug: "guides/pipeline", translations: { en: "Bundling Pipeline" } },
            { label: "플러그인 시스템", slug: "guides/plugins", translations: { en: "Plugin System" } },
          ],
        },
        {
          label: "개발 환경",
          translations: { en: "Development" },
          items: [
            { label: "개발 서버", slug: "guides/dev-server", translations: { en: "Dev Server" } },
            { label: "HMR & Fast Refresh", slug: "guides/hmr", translations: { en: "HMR & Fast Refresh" } },
            { label: "프로덕션 빌드", slug: "guides/production", translations: { en: "Production Build" } },
          ],
        },
        {
          label: "마이그레이션",
          translations: { en: "Migration" },
          items: [
            { label: "Metro에서 이관", slug: "guides/migration", translations: { en: "From Metro" } },
          ],
        },
        {
          label: "레퍼런스",
          translations: { en: "Reference" },
          items: [
            { label: "CLI", slug: "reference/cli", translations: { en: "CLI" } },
            { label: "설정 옵션", slug: "reference/config", translations: { en: "Config Options" } },
          ],
        },
      ],
      customCss: ["./src/styles/tailwind.css", "./src/styles/custom.css"],
      components: {
        PageTitle: "./src/overrides/PageTitle.astro",
      },
    }),
    react(),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
